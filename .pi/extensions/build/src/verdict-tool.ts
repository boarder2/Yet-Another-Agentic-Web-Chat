/**
 * Injected into every subagent with `pi -e`. Each role reports through typed tool
 * arguments rather than prose, so the parent decodes a structure instead of
 * guessing at a hedged sentence.
 *
 * The agents run interactively in their own herdr panes, so their stdout belongs
 * to the terminal: each tool writes its payload to the file named by
 * `YAAWC_BUILD_RESULT`, which is the parent's only channel for the result.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import {
  BUILD_ROLE_ENV,
  COMPLETION_TOOL,
  parseBuildRole,
  parseResult,
  REPORT_TOOL_BY_ROLE,
  RESULT_FILE_ENV,
  serializeResult,
  TEST_RESULT_TOOL,
  VERDICT_TOOL,
} from './verdict.ts';

/** First report wins; an identical retry is harmless, but a conflicting answer is not. */
export function recordResult(
  path: string,
  kind: string,
  payload: Record<string, unknown>,
): void {
  const next = { kind, payload };
  try {
    writeFileSync(path, serializeResult(kind, payload), {
      encoding: 'utf-8',
      flag: 'wx',
    });
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }

  const current = parseResult(readFileSync(path, 'utf-8'));
  if (current && isDeepStrictEqual(current, next)) return;
  throw new Error(`A conflicting build result is already recorded at ${path}.`);
}

/**
 * A report the parent cannot read is not a report: fail the tool call loudly so
 * the agent surfaces it, rather than terminating on a result that went nowhere.
 */
function record(kind: string, payload: Record<string, unknown>): void {
  const path = process.env[RESULT_FILE_ENV];
  if (!path) {
    throw new Error(
      `${RESULT_FILE_ENV} is not set, so ${kind} has nowhere to report. This agent was not started by the /build workflow.`,
    );
  }
  recordResult(path, kind, payload);
}

const submitVerdict = defineTool({
  name: VERDICT_TOOL,
  label: 'Submit Verdict',
  description:
    'Report the review verdict. This must be your final action; a review that does not call it does not count.',
  promptSnippet: 'Report the review verdict as a terminating tool call',
  promptGuidelines: [
    `Always finish a review by calling ${VERDICT_TOOL}. Prose alone is not a verdict.`,
    'Use changes-required for implementation defects. Use needs-replan only when the approved design itself must change.',
  ],
  parameters: Type.Object({
    verdict: Type.String({
      description: 'Exactly "pass", "changes-required", or "needs-replan"',
    }),
    blocking: Type.Array(Type.String(), {
      description:
        'Blocking findings as `file:line — defect`. Empty only when passing.',
    }),
    notes: Type.String({
      description:
        'The reasoning behind the findings. This is the only prose the coder will see.',
    }),
    rationale: Type.String({
      description:
        'Required for needs-replan: the approved contract that must change and concrete evidence why.',
    }),
  }),

  async execute(_toolCallId, params) {
    record(VERDICT_TOOL, {
      verdict: params.verdict,
      blocking: params.blocking,
      notes: params.notes,
      rationale: params.rationale,
    });
    return {
      content: [{ type: 'text', text: `Verdict recorded: ${params.verdict}` }],
      details: { verdict: params.verdict, blocking: params.blocking },
      terminate: true,
    };
  },
});

const submitTestResult = defineTool({
  name: TEST_RESULT_TOOL,
  label: 'Submit Test Result',
  description:
    'Report the observed test run. This must be your final action, and the counts must come from a run you actually performed.',
  promptSnippet: 'Report the observed test counts as a terminating tool call',
  promptGuidelines: [
    `Always finish by calling ${TEST_RESULT_TOOL} with counts from a real run.`,
    'Use needs-replan only when testing proves the approved contract itself must change; never redesign it.',
  ],
  parameters: Type.Object({
    outcome: Type.String({
      description: 'Exactly "passed", "failed", "blocked", or "needs-replan"',
    }),
    passed: Type.Integer({ minimum: 0, description: 'Tests observed passing' }),
    failed: Type.Integer({ minimum: 0, description: 'Tests observed failing' }),
    output: Type.String({
      description: 'Verbatim failure output, or a short summary when green',
    }),
    rationale: Type.String({
      description: 'Required for blocked or needs-replan; otherwise an empty string.',
    }),
  }),

  async execute(_toolCallId, params) {
    record(TEST_RESULT_TOOL, {
      outcome: params.outcome,
      passed: params.passed,
      failed: params.failed,
      output: params.output,
      rationale: params.rationale,
    });
    return {
      content: [
        {
          type: 'text',
          text: `Tests recorded: ${params.outcome}; ${params.passed} passed, ${params.failed} failed`,
        },
      ],
      details: {
        outcome: params.outcome,
        passed: params.passed,
        failed: params.failed,
        output: params.output,
      },
      terminate: true,
    };
  },
});

const submitCompletion = defineTool({
  name: COMPLETION_TOOL,
  label: 'Submit Completion',
  description:
    'Report whether you implemented the chunk. This must be your final action; work that does not call it does not count as done.',
  promptSnippet: 'Report the chunk outcome as a terminating tool call',
  promptGuidelines: [
    `Always finish by calling ${COMPLETION_TOOL}.`,
    'Use needs-replan instead of inventing an architecture when the approved contract is wrong, ambiguous, or impossible.',
  ],
  parameters: Type.Object({
    status: Type.String({
      description: 'Exactly "completed", "blocked", or "needs-replan"',
    }),
    summary: Type.String({
      description: 'What you implemented, or a concise blocker summary.',
    }),
    rationale: Type.String({
      description: 'Required for blocked or needs-replan; otherwise an empty string.',
    }),
  }),

  async execute(_toolCallId, params) {
    record(COMPLETION_TOOL, {
      status: params.status,
      summary: params.summary,
      rationale: params.rationale,
    });
    return {
      content: [{ type: 'text', text: `Completion recorded: ${params.status}` }],
      details: { status: params.status, summary: params.summary },
      terminate: true,
    };
  },
});

const TOOL_BY_ROLE = {
  coder: submitCompletion,
  tester: submitTestResult,
  reviewer: submitVerdict,
} as const;

export default function verdictTools(
  pi: ExtensionAPI,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const role = parseBuildRole(env[BUILD_ROLE_ENV]);
  if (!role) {
    throw new Error(
      `${BUILD_ROLE_ENV} must be one of coder, tester, or reviewer; received ${JSON.stringify(env[BUILD_ROLE_ENV])}.`,
    );
  }

  const tool = TOOL_BY_ROLE[role];
  if (tool.name !== REPORT_TOOL_BY_ROLE[role]) {
    throw new Error(`Reporting tool configuration is inconsistent for ${role}.`);
  }
  pi.registerTool(tool);
}
