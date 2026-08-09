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
            ? `Triaged as complex. Grill the ask now — one question at a time, waiting for each answer. ` +
              `Call workflow_end_grilling only once the user has agreed in conversation that nothing is left open.`
            : `Triaged as simple. Go straight to planning and call workflow_write_plan.`,
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
          'Understanding agreed. Write the plan with workflow_write_plan.',
        );
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: 'workflow_write_plan',
      label: 'Write Plan',
      description:
        'Submit the implementation plan. The harness owns the path and validates structure; the user approves it.',
      parameters: Type.Object({
        markdown: Type.String({
          description:
            'The whole plan. Needs ## Problem, ## Scope, ## Approach, ## Changes (naming files), ## Acceptance Criteria.',
        }),
      }),

      async execute(_id, params, _signal, _onUpdate, ctx) {
        const state = requirePhase(controller, 'workflow_write_plan', 'plan');

        const failures = validatePlan(params.markdown);
        if (failures.length > 0) {
          throw new Error(
            `Plan rejected, not written. Fix and resubmit:\n- ${failures.join('\n- ')}`,
          );
        }

        const relative = buildPaths(state.date, state.slug).plan;
        writeDocument(ctx.cwd, relative, params.markdown);

        const approved = ctx.hasUI
          ? await ctx.ui.confirm(
              'Approve this plan?',
              `Written to ${relative}. Approving moves the workflow to the task list.`,
            )
          : true;
        if (!approved) {
          return say(
            `Plan written to ${relative} but not approved. Revise it and resubmit.`,
          );
        }

        controller.update(
          advance({ ...state, planPath: relative }, 'tasks', new Date()),
        );
        return say(
          `Plan approved (${relative}). Break it into chunks with workflow_write_tasks.`,
        );
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: 'workflow_write_tasks',
      label: 'Write Task List',
      description:
        'Submit the chunked task list. Chunk order is frozen once approved.',
      parameters: Type.Object({
        markdown: Type.String({
          description:
            'The whole task list. Each chunk is `## Chunk <n> — <name>` with `- [ ]` items.',
        }),
      }),

      async execute(_id, params, _signal, _onUpdate, ctx) {
        const state = requirePhase(controller, 'workflow_write_tasks', 'tasks');

        const failures = validateTasks(params.markdown);
        if (failures.length > 0) {
          throw new Error(
            `Task list rejected, not written. Fix and resubmit:\n- ${failures.join('\n- ')}`,
          );
        }

        const relative = buildPaths(state.date, state.slug).task;
        writeDocument(ctx.cwd, relative, params.markdown);

        const approved = ctx.hasUI
          ? await ctx.ui.confirm(
              'Approve this chunking?',
              `Written to ${relative}. Approving starts execution; chunk order is then frozen.`,
            )
          : true;
        if (!approved) {
          return say(
            `Task list written to ${relative} but not approved. Recut the chunks and resubmit.`,
          );
        }

        controller.update(
          advance({ ...state, taskPath: relative }, 'execute', new Date()),
        );
        return say(
          `Chunking approved (${relative}). Run chunks with workflow_run_chunk.`,
        );
      },
    }),
  );
}
