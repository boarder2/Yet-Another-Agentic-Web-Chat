import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  defineTool,
  type AgentToolResult,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { loadConfig, CONFIG_PATH } from './config.ts';
import type { Controller } from './gates.ts';
import { resolveModel, type AgentRole } from './models.ts';
import {
  closeBuildAgents,
  ensureCrew,
  retireRole,
  runRole,
  type Crew,
  type CrewContext,
} from './panes.ts';
import { sessionTokens } from './sessions.ts';
import {
  advance,
  agentSessionId,
  beginChunk,
  beginReview,
  recordOverride,
  reseedAgent,
  returnToPlanning,
  type AgentName,
  type BuildState,
  type ReplanRole,
} from './state.ts';
import {
  completeChunk,
  hashContent,
  nextChunk,
  parseTasks,
  type TaskChunk,
} from './tasks.ts';
import {
  decodeCompletion,
  decodeTestResult,
  decodeVerdict,
  isGreen,
} from './verdict.ts';

const DEFAULT_CONTEXT_WINDOW = 200_000;

interface WorkflowBrief {
  ask: string;
  plan: string;
  planPath: string | null;
  taskPath: string;
  outline: string;
}

interface ChunkBrief extends WorkflowBrief {
  chunk: TaskChunk;
}

function readDocument(cwd: string, relative: string | null): string {
  if (!relative) return '';
  try {
    return readFileSync(join(cwd, relative), 'utf-8');
  } catch {
    return '';
  }
}

const sections = (...parts: string[]): string =>
  parts.filter(Boolean).join('\n\n');

function chunkText(chunk: TaskChunk): string {
  return [
    `## Chunk ${chunk.number} — ${chunk.title}`,
    '### Implementation Contract',
    ...chunk.implementationContract,
    '### Verification',
    ...chunk.verification,
  ].join('\n');
}

function outlineOf(chunks: TaskChunk[], current?: TaskChunk): string {
  return chunks
    .map(
      (chunk) =>
        `- [${chunk.complete ? 'x' : ' '}] Chunk ${chunk.number} — ${chunk.title}` +
        (chunk.id === current?.id ? '   <- this chunk' : ''),
    )
    .join('\n');
}

function preamble(brief: WorkflowBrief): string {
  return sections(
    `Ask: ${brief.ask}`,
    brief.planPath
      ? `The plan is at ${brief.planPath} and the task list at ${brief.taskPath} — read them whenever you need more than this brief carries.`
      : `The task list is at ${brief.taskPath} — read it whenever you need more than this brief carries.`,
    `--- TASK LIST ---\n${brief.outline}`,
    brief.plan ? `--- PLAN ---\n${brief.plan}` : '',
  );
}

function firstChunkBrief(role: 'coder' | 'tester', brief: ChunkBrief): string {
  const context = sections(
    preamble(brief),
    `--- THIS CHUNK ---\n${chunkText(brief.chunk)}`,
  );
  return role === 'coder'
    ? sections(
        'Implement exactly this chunk and nothing else, then report with submit_completion.',
        context,
      )
    : sections(
        'Write and run tests for the chunk just implemented, then report with submit_test_result.',
        context,
      );
}

function chunkBriefFor(
  role: 'coder' | 'tester',
  brief: ChunkBrief,
  feedback: string,
  fresh: boolean,
): string {
  if (fresh) return firstChunkBrief(role, brief);
  if (role === 'coder') {
    return `Chunk ${brief.chunk.number} did not pass. Fix exactly this, then report again with submit_completion.\n\n--- FIX THESE ---\n${feedback}`;
  }
  return sections(
    `The coder has changed the code for chunk ${brief.chunk.number}. Re-run the tests, extend them where the fix needs it, then report again with submit_test_result.`,
    feedback ? `--- PREVIOUS FAILURES ---\n${feedback}` : '',
  );
}

function finalReviewBrief(brief: WorkflowBrief, priorReview = ''): string {
  return sections(
    'Review the completed build against the approved plan and task list, then report with submit_verdict. This is one final review of all chunks, not a per-chunk review.',
    preamble(brief),
    priorReview ? `--- PREVIOUS REVIEW FINDINGS ---\n${priorReview}` : '',
  );
}

function repairBrief(
  role: 'coder' | 'tester',
  brief: WorkflowBrief,
  feedback: string,
  fresh: boolean,
): string {
  if (fresh) {
    return sections(
      role === 'coder'
        ? 'Fix the final review findings across the completed build, then report with submit_completion.'
        : 'Run and extend tests needed to validate the final review repairs, then report with submit_test_result.',
      preamble(brief),
      `--- REVIEW FEEDBACK ---\n${feedback}`,
    );
  }
  if (role === 'coder') {
    return `The final review repairs are not yet green. Fix exactly this, then report again with submit_completion.\n\n--- FIX THESE ---\n${feedback}`;
  }
  return sections(
    'The coder has changed the final-review repairs. Re-run the tests, extend them where the fix needs it, then report with submit_test_result.',
    feedback ? `--- PREVIOUS FAILURES ---\n${feedback}` : '',
  );
}

function testFailure(
  tests: ReturnType<typeof decodeTestResult>,
  problem?: string,
): string {
  if (!tests.ok) return `Tests: ${problem ?? tests.reason}`;
  if (isGreen(tests.value)) return '';
  if (tests.value.outcome === 'blocked') {
    return `Tests blocked: ${tests.value.rationale}`;
  }
  return `Tests: outcome ${tests.value.outcome}, ${tests.value.failed} failing.\n${tests.value.output.slice(0, 2000)}`;
}

function reviewFailure(
  verdict: ReturnType<typeof decodeVerdict>,
  problem?: string,
): string {
  if (!verdict.ok) return `Reviewer: ${problem ?? verdict.reason}`;
  if (verdict.value.verdict === 'pass') return '';
  return sections(
    `Reviewer blocking:\n- ${verdict.value.blocking.join('\n- ')}`,
    verdict.value.notes,
  );
}

export function approvedDocumentProblem(
  state: Pick<BuildState, 'planHash' | 'taskHash'>,
  plan: string,
  tasks: string,
): string | null {
  const changed = [
    ...(hashContent(plan) !== state.planHash ? ['plan'] : []),
    ...(hashContent(tasks) !== state.taskHash ? ['task list'] : []),
  ];
  return changed.length
    ? `Approved ${changed.join(' and ')} changed or disappeared after approval.`
    : null;
}

async function requestReplan(
  controller: Controller,
  state: BuildState,
  role: ReplanRole,
  rationale: string,
): Promise<AgentToolResult<unknown>> {
  controller.update(returnToPlanning(state, role, rationale, new Date()));
  const cleanup = await closeBuildAgents(state.slug);
  const cleanupNote = cleanup.failed.length
    ? ` Agent panes that could not be retired: ${cleanup.failed.join(', ')}.`
    : '';
  return say(
    `Revision ${state.revision} needs re-planning (${role}): ${rationale} ` +
      `The workflow returned to planning; all revised chunks will restart unchecked.${cleanupNote}`,
  );
}

export function registerLoop(pi: ExtensionAPI, controller: Controller): void {
  pi.registerTool(
    defineTool({
      name: 'workflow_run_chunk',
      label: 'Run Chunk',
      description:
        'Run the next unfinished chunk through coder and tester in their herdr panes. Takes no arguments: the harness picks the chunk.',
      parameters: Type.Object({}),

      async execute(_id, _params, signal, onUpdate, ctx) {
        const state = controller.current();
        if (!state) throw new Error('No active workflow. Start one with /build.');
        if (state.phase !== 'execute') {
          throw new Error(`workflow_run_chunk is not available in the ${state.phase} phase.`);
        }
        if (!state.planPath || !state.taskPath || !state.planHash || !state.taskHash) {
          throw new Error('This workflow has no approved design revision.');
        }

        const loaded = loadConfig(ctx.cwd);
        if (!loaded.ok) {
          throw new Error(`${CONFIG_PATH} is not usable:\n- ${loaded.problems.join('\n- ')}`);
        }
        const config = loaded.config;
        const taskFile = join(ctx.cwd, state.taskPath);
        const plan = readDocument(ctx.cwd, state.planPath);
        const original = readDocument(ctx.cwd, state.taskPath);
        const integrityProblem = approvedDocumentProblem(state, plan, original);
        if (integrityProblem) {
          return requestReplan(
            controller,
            state,
            'integrity',
            integrityProblem,
          );
        }

        const tasks = parseTasks(original);
        const chunk = nextChunk(tasks);
        if (!chunk) {
          controller.update(advance(state, 'review', new Date()));
          return say('Every chunk is complete. Run the final review with workflow_run_review.');
        }

        const brief: ChunkBrief = {
          chunk,
          ask: state.ask,
          plan,
          planPath: state.planPath,
          taskPath: state.taskPath,
          outline: outlineOf(tasks.chunks, chunk),
        };
        const activity: string[] = [];
        const note = (line: string) => {
          activity.push(line);
          onUpdate?.(say(activity.slice(-12).join('\n')));
        };
        const contextWindowFor = (role: AgentRole) =>
          resolveModel(ctx.modelRegistry, config.models[role])?.contextWindow ??
          DEFAULT_CONTEXT_WINDOW;
        let working = state;
        const chunkSessionId = (name: AgentName): string =>
          agentSessionId(
            working.slug,
            working.revision,
            name,
            working.agents[name],
          );
        const crewContext = (): CrewContext => ({
          cwd: ctx.cwd,
          date: working.date,
          slug: working.slug,
          config,
          sessionIdFor: (role) =>
            role === 'reviewer' ? undefined : chunkSessionId(role),
          note,
          signal,
        });

        if (working.agents.coder.chunkId !== chunk.id) {
          note(`chunk ${chunk.number}: fresh coder and tester`);
          working = beginChunk(working, chunk.id, new Date());
          controller.update(working);
          await retireRole(crewContext(), 'coder');
          await retireRole(crewContext(), 'tester');
        }

        let crew: Crew = {};
        const briefed = new Set<'coder' | 'tester'>();
        const runOne = async (
          role: 'coder' | 'tester',
          feedback: string,
        ) => {
          const used = sessionTokens(ctx.cwd, chunkSessionId(role));
          if (used > contextWindowFor(role) * config.contextBudget) {
            note(`${role}: context budget reached within the chunk, reseeding`);
            working = reseedAgent(working, role, new Date());
            controller.update(working);
            await retireRole(crewContext(), role);
            briefed.delete(role);
          }
          crew = await ensureCrew(crewContext(), [role]);
          const fresh = !briefed.has(role) || (role === 'coder' && !feedback);
          briefed.add(role);
          note(`${role}: working`);
          return runRole(
            crewContext(),
            crew,
            role,
            chunkBriefFor(role, brief, feedback, fresh),
            (blocked) => notifyBlocked(ctx, note, blocked),
          );
        };

        let testFeedback = '';
        const problems: string[] = [];
        for (let round = 1; round <= config.maxRounds; round++) {
          note(`--- chunk round ${round} of ${config.maxRounds} ---`);
          const coderRun = await runOne('coder', testFeedback);
          const completion = decodeCompletion(coderRun.envelope);
          if (completion.ok && completion.value.status === 'needs-replan') {
            return requestReplan(
              controller,
              working,
              'coder',
              completion.value.rationale,
            );
          }
          if (!completion.ok || completion.value.status === 'blocked') {
            const why = completion.ok
              ? completion.value.rationale
              : (coderRun.problem ?? completion.reason);
            return say(
              `The coder stopped without implementing chunk ${chunk.number}: ${why}\n\n` +
                'Resolve the operational blocker and re-run the chunk.',
            );
          }

          const testerRun = await runOne('tester', testFeedback);
          const tests = decodeTestResult(testerRun.envelope);
          if (tests.ok && tests.value.outcome === 'needs-replan') {
            return requestReplan(
              controller,
              working,
              'tester',
              tests.value.rationale,
            );
          }
          if (tests.ok && tests.value.outcome === 'blocked') {
            return say(
              `The tester is blocked on chunk ${chunk.number}: ${tests.value.rationale}\n\n` +
                'Resolve the operational blocker and re-run the chunk.',
            );
          }
          if (tests.ok && isGreen(tests.value)) {
            const lateIntegrityProblem = approvedDocumentProblem(
              working,
              readDocument(ctx.cwd, state.planPath),
              readDocument(ctx.cwd, state.taskPath),
            );
            if (lateIntegrityProblem) {
              return requestReplan(
                controller,
                working,
                'integrity',
                lateIntegrityProblem,
              );
            }
            writeFileSync(taskFile, completeChunk(original, chunk.id), 'utf-8');
            const completedTasks = parseTasks(readFileSync(taskFile, 'utf-8'));
            const finished = {
              ...working,
              taskHash: hashContent(readFileSync(taskFile, 'utf-8')),
              rounds: { ...working.rounds, [chunk.id]: round },
            };
            const remaining = nextChunk(completedTasks);
            controller.update(
              remaining ? finished : advance(finished, 'review', new Date()),
            );
            return say(
              `Chunk ${chunk.number} (${chunk.title}) complete in round ${round}. ` +
                `Tests: ${tests.value.passed} passed.` +
                (remaining
                  ? ''
                  : ' All chunks are complete — run the final review with workflow_run_review.'),
            );
          }

          testFeedback = testFailure(tests, testerRun.problem);
          problems.push(`Round ${round}:\n${testFeedback}`);
          note(`chunk round ${round} failed`);
        }

        const lateIntegrityProblem = approvedDocumentProblem(
          working,
          readDocument(ctx.cwd, state.planPath),
          readDocument(ctx.cwd, state.taskPath),
        );
        if (lateIntegrityProblem) {
          return requestReplan(
            controller,
            working,
            'integrity',
            lateIntegrityProblem,
          );
        }
        return overrideChunk(
          ctx,
          controller,
          working,
          taskFile,
          original,
          chunk,
          problems.join('\n\n'),
        );
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: 'workflow_run_review',
      label: 'Run Final Review',
      description:
        'Review the completed build after every chunk is implemented. Blocking findings are repaired and retested before a fresh final verdict.',
      parameters: Type.Object({}),

      async execute(_id, _params, signal, onUpdate, ctx) {
        const state = controller.current();
        if (!state) throw new Error('No active workflow. Start one with /build.');
        if (state.phase !== 'review') {
          throw new Error(`workflow_run_review is not available in the ${state.phase} phase.`);
        }
        if (!state.planPath || !state.taskPath || !state.planHash || !state.taskHash) {
          throw new Error('This workflow has no approved design revision.');
        }

        const loaded = loadConfig(ctx.cwd);
        if (!loaded.ok) {
          throw new Error(`${CONFIG_PATH} is not usable:\n- ${loaded.problems.join('\n- ')}`);
        }
        const config = loaded.config;
        const plan = readDocument(ctx.cwd, state.planPath);
        const taskText = readDocument(ctx.cwd, state.taskPath);
        const integrityProblem = approvedDocumentProblem(state, plan, taskText);
        if (integrityProblem) {
          return requestReplan(
            controller,
            state,
            'integrity',
            integrityProblem,
          );
        }
        const tasks = parseTasks(taskText);
        if (nextChunk(tasks)) {
          throw new Error('Final review requires every chunk to be complete.');
        }

        const brief: WorkflowBrief = {
          ask: state.ask,
          plan,
          planPath: state.planPath,
          taskPath: state.taskPath,
          outline: outlineOf(tasks.chunks),
        };
        const activity: string[] = [];
        const note = (line: string) => {
          activity.push(line);
          onUpdate?.(say(activity.slice(-12).join('\n')));
        };
        const contextWindowFor = (role: AgentRole) =>
          resolveModel(ctx.modelRegistry, config.models[role])?.contextWindow ??
          DEFAULT_CONTEXT_WINDOW;
        let working = state;
        const sessionId = (role: AgentName) =>
          agentSessionId(
            working.slug,
            working.revision,
            role,
            working.agents[role],
          );
        const crewContext = (): CrewContext => ({
          cwd: ctx.cwd,
          date: working.date,
          slug: working.slug,
          config,
          sessionIdFor: (role) => (role === 'reviewer' ? undefined : sessionId(role)),
          note,
          signal,
        });
        let crew: Crew = {};

        const review = async (priorReview = '') => {
          await retireRole(crewContext(), 'reviewer');
          crew = await ensureCrew(crewContext(), ['reviewer']);
          note('reviewer: working');
          return runRole(
            crewContext(),
            crew,
            'reviewer',
            finalReviewBrief(brief, priorReview),
            (blocked) => notifyBlocked(ctx, note, blocked),
          );
        };

        const initialRun = await review();
        const initialVerdict = decodeVerdict(initialRun.envelope);
        if (!initialVerdict.ok) {
          return say(`The final reviewer did not produce a usable verdict: ${initialRun.problem ?? initialVerdict.reason}`);
        }
        if (initialVerdict.value.verdict === 'needs-replan') {
          return requestReplan(
            controller,
            working,
            'reviewer',
            initialVerdict.value.rationale,
          );
        }
        if (initialVerdict.value.verdict === 'pass') {
          const lateIntegrityProblem = approvedDocumentProblem(
            working,
            readDocument(ctx.cwd, state.planPath),
            readDocument(ctx.cwd, state.taskPath),
          );
          if (lateIntegrityProblem) {
            return requestReplan(
              controller,
              working,
              'integrity',
              lateIntegrityProblem,
            );
          }
          controller.update(advance(working, 'close', new Date()));
          return say('Final review passed. Close the workflow with workflow_close.');
        }

        let feedback = reviewFailure(initialVerdict, initialRun.problem);
        working = beginReview(working, new Date());
        controller.update(working);
        await retireRole(crewContext(), 'coder');
        await retireRole(crewContext(), 'tester');
        const briefed = new Set<'coder' | 'tester'>();

        const repair = async (role: 'coder' | 'tester', repairFeedback: string) => {
          const used = sessionTokens(ctx.cwd, sessionId(role));
          if (used > contextWindowFor(role) * config.contextBudget) {
            note(`${role}: context budget reached during final review, reseeding`);
            working = reseedAgent(working, role, new Date());
            controller.update(working);
            await retireRole(crewContext(), role);
            briefed.delete(role);
          }
          crew = await ensureCrew(crewContext(), [role]);
          const fresh = !briefed.has(role);
          briefed.add(role);
          note(`${role}: working`);
          return runRole(
            crewContext(),
            crew,
            role,
            repairBrief(role, brief, repairFeedback, fresh),
            (blocked) => notifyBlocked(ctx, note, blocked),
          );
        };

        const problems = [`Initial review:\n${feedback}`];
        for (let round = 1; round <= config.maxRounds; round++) {
          note(`--- final-review repair ${round} of ${config.maxRounds} ---`);
          const coderRun = await repair('coder', feedback);
          const completion = decodeCompletion(coderRun.envelope);
          if (completion.ok && completion.value.status === 'needs-replan') {
            return requestReplan(
              controller,
              working,
              'coder',
              completion.value.rationale,
            );
          }
          if (!completion.ok || completion.value.status === 'blocked') {
            const why = completion.ok
              ? completion.value.rationale
              : (coderRun.problem ?? completion.reason);
            return say(`The coder stopped during final-review repairs: ${why}`);
          }

          const testerRun = await repair('tester', feedback);
          const tests = decodeTestResult(testerRun.envelope);
          if (tests.ok && tests.value.outcome === 'needs-replan') {
            return requestReplan(
              controller,
              working,
              'tester',
              tests.value.rationale,
            );
          }
          if (tests.ok && tests.value.outcome === 'blocked') {
            return say(`The tester stopped during final-review repairs: ${tests.value.rationale}`);
          }
          const testsGreen = tests.ok && isGreen(tests.value);
          const testFeedback = testFailure(tests, testerRun.problem);
          const reviewerRun = await review(feedback);
          const verdict = decodeVerdict(reviewerRun.envelope);
          if (verdict.ok && verdict.value.verdict === 'needs-replan') {
            return requestReplan(
              controller,
              working,
              'reviewer',
              verdict.value.rationale,
            );
          }
          const reviewFeedback = reviewFailure(verdict, reviewerRun.problem);
          const reviewPassed = verdict.ok && verdict.value.verdict === 'pass';

          if (testsGreen && reviewPassed) {
            const lateIntegrityProblem = approvedDocumentProblem(
              working,
              readDocument(ctx.cwd, state.planPath),
              readDocument(ctx.cwd, state.taskPath),
            );
            if (lateIntegrityProblem) {
              return requestReplan(
                controller,
                working,
                'integrity',
                lateIntegrityProblem,
              );
            }
            controller.update(advance(working, 'close', new Date()));
            return say(
              `Final review passed after repair ${round}. Tests: ${tests.value.passed} passed. ` +
                'Close the workflow with workflow_close.',
            );
          }

          feedback = sections(testFeedback, reviewFeedback);
          problems.push(`Repair ${round}:\n${feedback}`);
          note(`final-review repair ${round} failed`);
        }

        return say(
          `Final review still has blocking work after ${config.maxRounds} repairs. Stopping for the user.\n\n${problems.join('\n\n')}`,
        );
      },
    }),
  );
}

function notifyBlocked(
  ctx: { ui: { notify(message: string, level: 'warning'): void } },
  note: (line: string) => void,
  blocked: AgentRole,
): void {
  note(`${blocked}: blocked — asking for input in its pane`);
  ctx.ui.notify(
    `The ${blocked} agent is blocked in its pane and needs you. Answer it there; the workflow is waiting.`,
    'warning',
  );
}

async function overrideChunk(
  ctx: {
    cwd: string;
    hasUI: boolean;
    ui: {
      select(title: string, options: string[]): Promise<string | undefined>;
      editor(title: string, initial: string): Promise<string | undefined>;
    };
  },
  controller: Controller,
  state: Parameters<typeof recordOverride>[0],
  taskFile: string,
  original: string,
  chunk: TaskChunk,
  summary: string,
): Promise<AgentToolResult<unknown>> {
  const choice = ctx.hasUI
    ? await ctx.ui.select(
        `Chunk ${chunk.number} still failing.`,
        ['Stop and let me look', 'Override — mark it complete anyway'],
      )
    : 'Stop and let me look';
  if (!choice?.startsWith('Override')) {
    return say(`Chunk ${chunk.number} did not pass. Stopping for the user.\n\n${summary}`);
  }

  const reason = (await ctx.ui.editor('Why is this override justified?', '')) ?? '';
  if (!reason.trim()) return say(`Override cancelled — no reason given.\n\n${summary}`);

  if (!state.planPath || !state.taskPath) {
    throw new Error('This workflow has no approved design revision.');
  }
  const integrityProblem = approvedDocumentProblem(
    state,
    readDocument(ctx.cwd, state.planPath),
    readDocument(ctx.cwd, state.taskPath),
  );
  if (integrityProblem) {
    return requestReplan(controller, state, 'integrity', integrityProblem);
  }

  writeFileSync(taskFile, completeChunk(original, chunk.id, { override: reason }), 'utf-8');
  const overridden = recordOverride(state, `Chunk ${chunk.number}`, reason, new Date());
  const finished = {
    ...overridden,
    taskHash: hashContent(readFileSync(taskFile, 'utf-8')),
  };
  const remaining = nextChunk(parseTasks(readFileSync(taskFile, 'utf-8')));
  controller.update(remaining ? finished : advance(finished, 'review', new Date()));
  return say(
    `Chunk ${chunk.number} marked complete by override: ${reason.trim()}` +
      (remaining ? '' : ' All chunks are complete — run the final review with workflow_run_review.'),
  );
}

function say(text: string): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text }], details: undefined };
}
