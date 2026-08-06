/**
 * Injected into every subagent with `pi -e`. The tester and reviewer report
 * through typed tool arguments rather than prose, so the parent decodes a
 * structure instead of guessing at a hedged sentence.
 */
import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { TEST_RESULT_TOOL, VERDICT_TOOL } from './verdict.ts';

const submitVerdict = defineTool({
  name: VERDICT_TOOL,
  label: 'Submit Verdict',
  description:
    'Report the review verdict. This must be your final action; a review that does not call it does not count.',
  promptSnippet: 'Report the review verdict as a terminating tool call',
  promptGuidelines: [
    `Always finish a review by calling ${VERDICT_TOOL}. Prose alone is not a verdict.`,
    'Use changes-required whenever there is at least one blocking finding, and list every one.',
  ],
  parameters: Type.Object({
    verdict: Type.String({
      description: 'Exactly "pass" or "changes-required"',
    }),
    blocking: Type.Array(Type.String(), {
      description:
        'Blocking findings as `file:line — defect`. Empty only when passing.',
    }),
  }),

  async execute(_toolCallId, params) {
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
    'Never report a pass you did not observe; a failing suite is reported as failing.',
  ],
  parameters: Type.Object({
    passed: Type.Number({ description: 'Tests observed passing' }),
    failed: Type.Number({ description: 'Tests observed failing' }),
    output: Type.String({
      description: 'Verbatim failure output, or a short summary when green',
    }),
  }),

  async execute(_toolCallId, params) {
    return {
      content: [
        {
          type: 'text',
          text: `Tests recorded: ${params.passed} passed, ${params.failed} failed`,
        },
      ],
      details: {
        passed: params.passed,
        failed: params.failed,
        output: params.output,
      },
      terminate: true,
    };
  },
});

export default function verdictTools(pi: ExtensionAPI): void {
  pi.registerTool(submitVerdict);
  pi.registerTool(submitTestResult);
}
