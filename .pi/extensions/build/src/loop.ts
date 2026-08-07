import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  defineTool,
  type AgentToolResult,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { loadAgent, type AgentRole } from './agents.ts';
import { loadConfig } from './config.ts';
import type { Controller } from './gates.ts';
import { runAgent } from './runner.ts';
import {
  advance,
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
import { decodeTestResult, decodeVerdict, isGreen } from './verdict.ts';

const DEFAULT_CONTEXT_WINDOW = 200_000;

interface ChunkBrief {
  chunk: TaskChunk;
  plan: string;
  completed: string[];
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

// Every task carries the plan and the chunk, so a reseeded agent with no history
// still has what it needs — the reseed costs continuity, not context.
function briefFor(
  role: AgentRole,
  brief: ChunkBrief,
  feedback: string,
): string {
  const done = brief.completed.length
    ? `\n\nAlready merged: ${brief.completed.join(', ')}.`
    : '';
  const preamble = `${chunkText(brief.chunk)}\n\n--- PLAN ---\n${brief.plan}${done}`;

  if (role === 'coder') {
    return `Implement exactly this chunk and nothing else.\n\n${preamble}${
      feedback ? `\n\n--- FIX THESE ---\n${feedback}` : ''
    }`;
  }
  if (role === 'tester') {
    return `Write and run tests for the chunk just implemented, then report with submit_test_result.\n\n${preamble}${
      feedback ? `\n\n--- PREVIOUS FAILURES ---\n${feedback}` : ''
    }`;
  }
  return `Review the code and tests for this chunk against it, then report with submit_verdict.\n\n${preamble}`;
}

export function registerLoop(pi: ExtensionAPI, controller: Controller): void {
  pi.registerTool(
    defineTool({
      name: 'workflow_run_chunk',
      label: 'Run Chunk',
      description:
        'Run the next unfinished chunk through coder, tester and reviewer. Takes no arguments: the harness picks the chunk.',
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

        const config = loadConfig(ctx.cwd);
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
          plan: readDocument(ctx.cwd, state.planPath),
          completed: parseTasks(original)
            .chunks.filter((candidate) => candidate.complete)
            .map((candidate) => `Chunk ${candidate.number}`),
        };

        const activity: string[] = [];
        const note = (line: string) => {
          activity.push(line);
          onUpdate?.(say(activity.slice(-12).join('\n')));
        };

        const contextWindow =
          ctx.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
        let working = state;

        const runRole = async (role: AgentRole, feedback: string) => {
          const agent = loadAgent(ctx.cwd, role);
          const persistent = role !== 'reviewer';
          const name = role as AgentName;

          if (persistent) {
            const used = working.agents[name].tokensUsed;
            if (used > contextWindow * config.contextBudget) {
              working = reseedAgent(working, name, new Date());
              controller.update(working);
              note(`${role}: context budget reached, reseeded`);
            }
          }

          note(`${role}: running`);
          const result = await runAgent({
            agent,
            task: briefFor(role, brief, feedback),
            cwd: ctx.cwd,
            sessionId: persistent ? working.agents[name].sessionId : undefined,
            model: role === 'reviewer' ? config.reviewerModel : agent.model,
            signal,
            onActivity: (line) => note(`${role}: ${line}`),
          });

          if (persistent) {
            working = {
              ...working,
              agents: {
                ...working.agents,
                [name]: {
                  ...working.agents[name],
                  tokensUsed: result.tokensUsed,
                },
              },
            };
            controller.update(working);
          }
          return result;
        };

        let testFeedback = '';
        let reviewFeedback = '';
        const problems: string[] = [];

        for (let round = 1; round <= config.maxRounds; round++) {
          note(`--- round ${round} of ${config.maxRounds} ---`);

          const coder = await runRole(
            'coder',
            sections(testFeedback, reviewFeedback),
          );
          if (coder.exitCode !== 0) {
            throw new Error(
              `The coder agent failed (exit ${coder.exitCode}).\n${coder.stderr.slice(0, 500)}`,
            );
          }

          // The tester sees only test failures — review findings are the coder's to fix.
          const tester = await runRole('tester', testFeedback);
          const tests = decodeTestResult(tester.toolCalls);
          const reviewer = await runRole('reviewer', '');
          const verdict = decodeVerdict(reviewer.toolCalls);

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
            : `Tests: ${tests.reason}`;

          // The blocking list is only the headline; the prose carries the reasoning behind
          // each finding, and is the whole review when the verdict itself does not decode.
          const report = reviewer.text.trim();
          reviewFeedback = verdict.ok
            ? verdict.value.verdict === 'pass'
              ? ''
              : sections(
                  `Reviewer blocking:\n- ${verdict.value.blocking.join('\n- ')}`,
                  report,
                )
            : sections(
                `Reviewer: ${verdict.reason}`,
                report && `Reviewer report:\n${report}`,
              );

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
