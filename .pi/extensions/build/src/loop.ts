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
import type { AgentRole } from './models.ts';
import {
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
  recordOverride,
  reseedAgent,
  type AgentName,
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

interface ChunkBrief {
  chunk: TaskChunk;
  ask: string;
  plan: string;
  planPath: string | null;
  taskPath: string;
  /** Every chunk with its state, so an agent sees where its chunk sits in the whole. */
  outline: string;
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
    ...chunk.items.map((item) => `- ${item.text}`),
  ].join('\n');
}

function outlineOf(chunks: TaskChunk[], current: TaskChunk): string {
  return chunks
    .map(
      (chunk) =>
        `- [${chunk.complete ? 'x' : ' '}] Chunk ${chunk.number} — ${chunk.title}` +
        (chunk.id === current.id ? '   <- this chunk' : ''),
    )
    .join('\n');
}

// A first brief carries the ask, the plan, the whole task list and the chunk, plus
// the paths both documents live at, so an agent with no history can both act and go
// read for itself. That is what makes a per-chunk reset affordable: it costs
// continuity, not the brief.
function firstBrief(
  role: AgentRole,
  brief: ChunkBrief,
  round: number,
  priorReview: string,
): string {
  const where = sections(
    `Ask: ${brief.ask}`,
    brief.planPath
      ? `The plan is at ${brief.planPath} and the task list at ${brief.taskPath} — read them whenever you need more than this brief carries.`
      : `The task list is at ${brief.taskPath} — read it whenever you need more than this brief carries.`,
    `--- TASK LIST ---\n${brief.outline}`,
  );
  const preamble = sections(
    where,
    `--- THIS CHUNK ---\n${chunkText(brief.chunk)}`,
    brief.plan ? `--- PLAN ---\n${brief.plan}` : '',
  );

  if (role === 'coder') {
    return sections(
      'Implement exactly this chunk and nothing else, then report with submit_completion.',
      preamble,
    );
  }
  if (role === 'tester') {
    return sections(
      'Write and run tests for the chunk just implemented, then report with submit_test_result.',
      preamble,
    );
  }
  // The reviewer is new every round, so the round it is in has to be told to it.
  // Without it, each round is a first review by a reviewer with a slightly
  // different taste, and the standard only ever ratchets up.
  return sections(
    'Review the code and tests for this chunk against it, then report with submit_verdict.',
    preamble,
    round === 1
      ? ''
      : sections(
          `This is round ${round} for this chunk; earlier rounds were reviewed by an agent like you whose findings the coder has already acted on.`,
          priorReview
            ? `Confirm these are fixed and that fixing them broke nothing else. Anything an earlier round saw and did not block on is settled — do not re-open it.\n\n--- PREVIOUS REVIEW ---\n${priorReview}`
            : 'The previous round failed on its tests rather than its review, so the code has changed since a review passed it. Check the change, not the chunk from scratch.',
        ),
  );
}

// A later round in the same session: the agent still holds the brief it was given,
// so it gets the feedback and nothing else.
function briefFor(
  role: AgentRole,
  brief: ChunkBrief,
  feedback: string,
  fresh: boolean,
  round: number,
): string {
  if (fresh) return firstBrief(role, brief, round, feedback);

  if (role === 'coder') {
    return `Chunk ${brief.chunk.number} did not pass. Fix exactly this, then report again with submit_completion.\n\n--- FIX THESE ---\n${feedback}`;
  }
  return sections(
    `The coder has changed the code for chunk ${brief.chunk.number}. Re-run the tests, extend them where the fix needs it, then report again with submit_test_result.`,
    feedback ? `--- PREVIOUS FAILURES ---\n${feedback}` : '',
  );
}

export function registerLoop(pi: ExtensionAPI, controller: Controller): void {
  pi.registerTool(
    defineTool({
      name: 'workflow_run_chunk',
      label: 'Run Chunk',
      description:
        'Run the next unfinished chunk through coder, tester and reviewer in their herdr panes. Takes no arguments: the harness picks the chunk.',
      parameters: Type.Object({}),

      async execute(_id, _params, signal, onUpdate, ctx) {
        const state = controller.current();
        if (!state)
          throw new Error('No active workflow. Start one with /build.');
        if (state.phase !== 'execute') {
          throw new Error(
            `workflow_run_chunk is not available in the ${state.phase} phase.`,
          );
        }
        if (!state.taskPath) throw new Error('This workflow has no task list.');

        const loaded = loadConfig(ctx.cwd);
        if (!loaded.ok) {
          throw new Error(
            `${CONFIG_PATH} is not usable:\n- ${loaded.problems.join('\n- ')}`,
          );
        }
        const config = loaded.config;

        const taskFile = join(ctx.cwd, state.taskPath);
        const original = readFileSync(taskFile, 'utf-8');
        const hash = hashContent(original);

        if (state.taskHash && state.taskHash !== hash && ctx.hasUI) {
          const proceed = await ctx.ui.confirm(
            'The task list changed since the last chunk.',
            'Run the next unfinished chunk from the edited file?',
          );
          if (!proceed)
            return say('Stopped: the task list changed and was not confirmed.');
        }

        const chunk = nextChunk(parseTasks(original));
        if (!chunk) {
          controller.update(advance(state, 'close', new Date()));
          return say(
            'Every chunk is complete. Close the workflow with workflow_close.',
          );
        }

        const brief: ChunkBrief = {
          chunk,
          ask: state.ask,
          plan: readDocument(ctx.cwd, state.planPath),
          planPath: state.planPath,
          taskPath: state.taskPath,
          outline: outlineOf(parseTasks(original).chunks, chunk),
        };

        const activity: string[] = [];
        const note = (line: string) => {
          activity.push(line);
          onUpdate?.(say(activity.slice(-12).join('\n')));
        };

        const contextWindow =
          ctx.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
        let working = state;

        const chunkSessionId = (name: AgentName): string =>
          agentSessionId(working.slug, name, working.agents[name]);

        // The reviewer is ephemeral by design: no session id means `--no-session`.
        const sessionIdFor = (role: AgentRole): string | undefined =>
          role === 'reviewer' ? undefined : chunkSessionId(role);

        const crewContext = (): CrewContext => ({
          cwd: ctx.cwd,
          date: working.date,
          slug: working.slug,
          config,
          sessionIdFor,
          note,
          signal,
        });

        // Every chunk starts all three agents clean: the coder and tester move to a
        // new session, and their panes are closed so the new session is what comes
        // back up. Skipped when this chunk is being re-run, which reattaches to the
        // sessions already working on it instead of discarding their work.
        if (working.agents.coder.chunkId !== chunk.id) {
          note(`chunk ${chunk.number}: fresh coder and tester`);
          working = beginChunk(working, chunk.id, new Date());
          controller.update(working);
          await retireRole(crewContext(), 'coder');
          await retireRole(crewContext(), 'tester');
        }

        // Live agents are found by name in herdr on every pass, so the loop keeps no
        // record of the layout to fall out of step with what is on screen.
        let crew: Crew = {};

        // Roles whose current session has already had the full brief this call. The
        // reviewer is never in it: it is retired every round, so it is always new.
        const briefed = new Set<AgentRole>();

        const runOne = async (
          role: AgentRole,
          feedback: string,
          round: number,
        ) => {
          // A reseed only takes effect once the old agent is gone, since the new one
          // is adopted under the same name.
          if (role !== 'reviewer') {
            const name = role;
            const used = sessionTokens(ctx.cwd, chunkSessionId(name));
            if (used > contextWindow * config.contextBudget) {
              note(
                `${role}: context budget reached within the chunk, reseeding`,
              );
              working = reseedAgent(working, name, new Date());
              controller.update(working);
              await retireRole(crewContext(), role);
              briefed.delete(role);
            }
          }

          // Retired before the crew is brought back up, so ensureCrew rebuilds it as
          // a reviewer that has never seen this code.
          if (role === 'reviewer') {
            await retireRole(crewContext(), 'reviewer');
            briefed.delete('reviewer');
          }

          crew = await ensureCrew(crewContext());

          // A session that has not been briefed yet gets the whole thing; one that
          // has gets only what changed. Feedback the agent cannot act on without the
          // brief — a coder round with nothing to fix — falls back to the full text.
          const fresh = !briefed.has(role) || (role === 'coder' && !feedback);
          briefed.add(role);

          note(`${role}: working`);
          return runRole(
            crewContext(),
            crew,
            role,
            briefFor(role, brief, feedback, fresh, round),
            (blocked) => {
              note(`${blocked}: blocked — asking for input in its pane`);
              ctx.ui.notify(
                `The ${blocked} agent is blocked in its pane and needs you. ` +
                  `Answer it there; the workflow is waiting.`,
                'warning',
              );
            },
          );
        };

        let testFeedback = '';
        let reviewFeedback = '';
        const problems: string[] = [];

        for (let round = 1; round <= config.maxRounds; round++) {
          note(`--- round ${round} of ${config.maxRounds} ---`);

          const coderRun = await runOne(
            'coder',
            sections(testFeedback, reviewFeedback),
            round,
          );
          const completion = decodeCompletion(coderRun.envelope);
          // A coder that gave up is not a round to test and review: stop and say
          // why, rather than spending two more agents proving nothing changed.
          if (!completion.ok || completion.value.status === 'blocked') {
            const why = completion.ok
              ? completion.value.summary
              : (coderRun.problem ?? completion.reason);
            return say(
              `The coder stopped without implementing chunk ${chunk.number}: ${why}\n\n` +
                'Decide what to do and re-run the chunk, or revise the task list.',
            );
          }

          // The tester sees only test failures — review findings are the coder's to fix.
          const testerRun = await runOne('tester', testFeedback, round);
          const tests = decodeTestResult(testerRun.envelope);
          // The reviewer carries its predecessor's findings so a later round checks
          // the fixes instead of hunting the chunk from scratch at a higher bar.
          const reviewerRun = await runOne('reviewer', reviewFeedback, round);
          const verdict = decodeVerdict(reviewerRun.envelope);

          const testsGreen = tests.ok && isGreen(tests.value);
          const reviewPassed = verdict.ok && verdict.value.verdict === 'pass';

          if (testsGreen && reviewPassed) {
            writeFileSync(taskFile, completeChunk(original, chunk.id), 'utf-8');
            const finished = {
              ...working,
              taskHash: hashContent(readFileSync(taskFile, 'utf-8')),
              rounds: { ...working.rounds, [chunk.id]: round },
            };
            // Advance here when this was the last chunk, so close does not need a
            // further run_chunk call just to discover there is nothing left.
            const remaining = nextChunk(
              parseTasks(readFileSync(taskFile, 'utf-8')),
            );
            controller.update(
              remaining ? finished : advance(finished, 'close', new Date()),
            );
            return say(
              `Chunk ${chunk.number} (${chunk.title}) complete in round ${round}. ` +
                `Tests: ${tests.value.passed} passed. Reviewer: pass.` +
                (remaining
                  ? ''
                  : ' That was the last chunk — close the workflow with workflow_close.'),
            );
          }

          // Fail-closed: an undecodable signal is a failure with its reason, not a pass.
          testFeedback = tests.ok
            ? isGreen(tests.value)
              ? ''
              : `Tests: ${tests.value.failed} failing.\n${tests.value.output.slice(0, 2000)}`
            : `Tests: ${testerRun.problem ?? tests.reason}`;

          // The blocking list is only the headline; the reviewer's notes carry the
          // reasoning, and are the whole review when the verdict does not decode.
          reviewFeedback = verdict.ok
            ? verdict.value.verdict === 'pass'
              ? ''
              : sections(
                  `Reviewer blocking:\n- ${verdict.value.blocking.join('\n- ')}`,
                  verdict.value.notes,
                )
            : `Reviewer: ${reviewerRun.problem ?? verdict.reason}`;

          problems.push(
            `Round ${round}:\n${sections(testFeedback, reviewFeedback)}`,
          );
          note(`round ${round} failed`);
        }

        const summary = problems.join('\n\n');
        const choice = ctx.hasUI
          ? await ctx.ui.select(
              `Chunk ${chunk.number} still failing after ${config.maxRounds} rounds.`,
              ['Stop and let me look', 'Override — mark it complete anyway'],
            )
          : 'Stop and let me look';

        if (choice?.startsWith('Override')) {
          const reason =
            (await ctx.ui.editor('Why is this override justified?', '')) ?? '';
          if (!reason.trim()) {
            return say(`Override cancelled — no reason given.\n\n${summary}`);
          }

          writeFileSync(
            taskFile,
            completeChunk(original, chunk.id, { override: reason }),
            'utf-8',
          );
          const overridden = recordOverride(
            { ...working, taskHash: null },
            `Chunk ${chunk.number}`,
            reason,
            new Date(),
          );
          controller.update({
            ...overridden,
            taskHash: hashContent(readFileSync(taskFile, 'utf-8')),
          });
          return say(
            `Chunk ${chunk.number} marked complete by override: ${reason.trim()}`,
          );
        }

        return say(
          `Chunk ${chunk.number} did not pass in ${config.maxRounds} rounds. Stopping for the user.\n\n${summary}`,
        );
      },
    }),
  );
}

function say(text: string): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text }], details: undefined };
}
