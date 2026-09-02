import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  defineTool,
  type AgentToolResult,
  type ExtensionAPI,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { validatePlan } from './plan.ts';
import { GRILLING_SKILL_REFERENCE } from './prompts.ts';
import {
  advance,
  buildPaths,
  mintSlug,
  phaseAfterTriage,
  renameSlug,
  type BuildState,
  type Phase,
} from './state.ts';
import { renameBuild, uniqueSlug } from './store.ts';
import { validateTasks } from './tasks.ts';

export interface Controller {
  current(): BuildState | null;
  update(state: BuildState): void;
  detach(ctx: ExtensionContext): void;
}

const say = (text: string): AgentToolResult<unknown> => ({
  content: [{ type: 'text', text }],
  details: undefined,
});

// Throws rather than returning: pi turns a thrown error into an error result the
// model must react to, and there is no `isError` flag to set.
function requirePhase(
  controller: Controller,
  tool: string,
  ...phases: Phase[]
): BuildState {
  const state = controller.current();
  if (!state) {
    throw new Error(`${tool} needs an active workflow. Start one with /build.`);
  }
  if (!phases.includes(state.phase)) {
    throw new Error(
      `${tool} is not available in the ${state.phase} phase (needs ${phases.join(' or ')}).`,
    );
  }
  return state;
}

function writeDocument(
  cwd: string,
  relative: string,
  markdown: string,
): string {
  const path = join(cwd, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    markdown.endsWith('\n') ? markdown : `${markdown}\n`,
    'utf-8',
  );
  return path;
}

export function registerGates(pi: ExtensionAPI, controller: Controller): void {
  pi.registerTool(
    defineTool({
      name: 'workflow_triage',
      label: 'Triage',
      description:
        'Classify the ask as simple or complex. The user confirms; a dismissed dialog means complex.',
      parameters: Type.Object({
        verdict: Type.String({ description: 'Exactly "simple" or "complex"' }),
        reasoning: Type.String({
          description: 'Why, in one or two sentences. Shown to the user.',
        }),
        slug: Type.Optional(
          Type.String({
            description:
              'Optional better short name for this workflow, 2-4 words, hyphenated.',
          }),
        ),
      }),

      async execute(_id, params, _signal, _onUpdate, ctx) {
        const state = requirePhase(controller, 'workflow_triage', 'triage');

        const proposed = params.verdict === 'simple' ? 'simple' : 'complex';
        const choice = ctx.hasUI
          ? await ctx.ui.select(
              `Triage: the agent says this is ${proposed}.\n${params.reasoning}`,
              ['Complex — grill it first', 'Simple — go straight to planning'],
            )
          : proposed === 'simple'
            ? 'Simple — go straight to planning'
            : 'Complex — grill it first';

        // Dismissal returns nothing, and the safe reading of "no answer" is complex.
        const complexity = choice?.startsWith('Simple') ? 'simple' : 'complex';

        let next = { ...state, complexity } as BuildState;
        const requested = params.slug?.trim();
        // A proposal that reduces to the current slug is a no-op: uniqueSlug would
        // otherwise treat this workflow's own state file as a collision and rename
        // it to `<slug>-2`.
        if (requested && mintSlug(requested) !== state.slug) {
          const slug = uniqueSlug(ctx.cwd, state.date, mintSlug(requested));
          if (slug !== state.slug) {
            const previous = state.slug;
            next = renameSlug(next, slug, new Date());
            renameBuild(ctx.cwd, previous, next);
          }
        }

        next = advance(next, phaseAfterTriage(complexity), new Date());
        controller.update(next);

        return say(
          complexity === 'complex'
            ? `Triaged as complex. ${GRILLING_SKILL_REFERENCE} ` +
                `Call workflow_end_grilling only once the user has agreed in conversation that nothing is left open.`
            : `Triaged as simple. Go straight to planning and call workflow_write_plan with the plan and its chunking.`,
        );
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: 'workflow_end_grilling',
      label: 'End Grilling',
      description:
        'Confirm an agreement the user has already voiced that grilling is done. Ask them in conversation first; this dialog records the agreement, it does not solicit one.',
      parameters: Type.Object({
        understanding: Type.String({
          description:
            'Your restatement of the ask, its boundary, and its acceptance criteria.',
        }),
      }),

      async execute(_id, params, _signal, _onUpdate, ctx) {
        const state = requirePhase(
          controller,
          'workflow_end_grilling',
          'grill',
        );

        const agreed = ctx.hasUI
          ? await ctx.ui.confirm(
              'Is this a shared understanding of the ask?',
              params.understanding,
            )
          : true;
        if (!agreed) {
          return say(
            'Not agreed. Ask what is still wrong or missing and keep grilling from there — do not re-propose the same understanding.',
          );
        }

        controller.update(advance(state, 'plan', new Date()));
        return say(
          'Understanding agreed. Write the plan and its chunked task list, and submit both with workflow_write_plan.',
        );
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: 'workflow_write_plan',
      label: 'Write Plan and Tasks',
      description:
        'Submit the implementation plan together with its chunked task list. The harness owns both paths and validates structure; one approval covers both and starts execution.',
      parameters: Type.Object({
        plan: Type.String({
          description:
            'The whole plan. Needs ## Problem, ## Scope, ## Approach, ## Changes (naming files), ## Code Structure, ## UI/UX Specification (each with an explicit not-applicable statement when appropriate), and ## Acceptance Criteria.',
        }),
        tasks: Type.String({
          description:
            'The whole task list chunking that plan. Each chunk is `## Chunk <n> — <name>` with `- [ ]` items.',
        }),
      }),

      async execute(_id, params, _signal, _onUpdate, ctx) {
        const state = requirePhase(controller, 'workflow_write_plan', 'plan');

        // Neither document is written unless both validate: a plan on disk with no
        // task list beside it is a half-submitted gate the user never approved.
        const failures = [
          ...validatePlan(params.plan).map((failure) => `Plan: ${failure}`),
          ...validateTasks(params.tasks).map((failure) => `Tasks: ${failure}`),
        ];
        if (failures.length > 0) {
          throw new Error(
            `Rejected, nothing written. Fix and resubmit both documents:\n- ${failures.join('\n- ')}`,
          );
        }

        const paths = buildPaths(state.date, state.slug);
        writeDocument(ctx.cwd, paths.plan, params.plan);
        writeDocument(ctx.cwd, paths.task, params.tasks);

        const approved = ctx.hasUI
          ? await ctx.ui.confirm(
              'Approve this plan and its chunking?',
              `Written to ${paths.plan} and ${paths.task}. Approving starts execution; chunk order is then frozen.`,
            )
          : true;
        if (!approved) {
          return say(
            `Written to ${paths.plan} and ${paths.task} but not approved. Ask what is wrong, revise both, and resubmit.`,
          );
        }

        controller.update(
          advance(
            { ...state, planPath: paths.plan, taskPath: paths.task },
            'execute',
            new Date(),
          ),
        );
        return say(
          `Plan and chunking approved (${paths.plan}, ${paths.task}). Run chunks with workflow_run_chunk.`,
        );
      },
    }),
  );
}
