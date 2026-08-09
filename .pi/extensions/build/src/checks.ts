import {
  defineTool,
  type AgentToolResult,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { loadConfig } from './config.ts';
import type { Controller } from './gates.ts';
import { setStatus } from './state.ts';

export interface CheckOutcome {
  command: string;
  exitCode: number | null;
  output: string;
}

export function formatChecks(outcomes: readonly CheckOutcome[]): string {
  if (outcomes.length === 0) {
    return 'No checks configured (set `checks` in .pi/build.json).';
  }
  return outcomes
    .map(
      ({ command, exitCode, output }) =>
        `${exitCode === 0 ? 'PASS' : 'FAIL'} (exit ${exitCode}) ${command}\n${output.trim().slice(-1500)}`,
    )
    .join('\n\n');
}

export function registerClose(pi: ExtensionAPI, controller: Controller): void {
  pi.registerTool(
    defineTool({
      name: 'workflow_close',
      label: 'Close Workflow',
      description:
        'Run the configured checks and finish the workflow. Check results come from the processes themselves.',
      parameters: Type.Object({}),

      async execute(_id, _params, _signal, onUpdate, ctx) {
        const state = controller.current();
        if (!state) throw new Error('No active workflow.');
        if (state.phase !== 'close') {
          throw new Error(
            `workflow_close is not available in the ${state.phase} phase.`,
          );
        }

        const loaded = loadConfig(ctx.cwd);
        const checks = loaded.ok ? loaded.config.checks : [];
        const outcomes: CheckOutcome[] = [];

        for (const command of checks) {
          onUpdate?.(progress(`running ${command}`));
          const [bin, ...args] = command.split(/\s+/);
          const result = await pi.exec(bin, args, { cwd: ctx.cwd });
          outcomes.push({
            command,
            exitCode: result.code,
            output: `${result.stdout}\n${result.stderr}`,
          });
        }

        controller.update(setStatus(state, 'done', new Date()));
        controller.detach(ctx);

        const failed = outcomes.filter((outcome) => outcome.exitCode !== 0);
        // Advisory by design: a pre-existing failure must not deadlock the close.
        return say(
          [
            `Workflow ${state.slug} closed.`,
            formatChecks(outcomes),
            failed.length
              ? `${failed.length} check(s) failed. Report this plainly to the user; do not claim a pass.`
              : 'All configured checks passed.',
          ].join('\n\n'),
        );
      },
    }),
  );
}

const say = (text: string): AgentToolResult<unknown> => ({
  content: [{ type: 'text', text }],
  details: undefined,
});

const progress = say;
