import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  approveRevision,
  buildPaths,
  mintSlug,
  phaseAfterTriage,
  renameSlug,
  revisionPaths,
  type BuildState,
  type Phase,
} from './state.ts';
import { renameBuild, uniqueSlug } from './store.ts';
import { hashContent, validateTasks } from './tasks.ts';

export interface Controller {
  current(): BuildState | null;
  update(state: BuildState): void;
  detach(ctx: ExtensionContext): void;
}

const say = (text: string): AgentToolResult<unknown> => ({
  content: [{ type: 'text', text }],
  details: undefined,
});

function requirePhase(
  controller: Controller,
  tool: string,
  ...phases: Phase[]
): BuildState {
  const state = controller.current();
  if (!state) throw new Error(`${tool} needs an active workflow. Start one with /build.`);
  if (!phases.includes(state.phase)) {
    throw new Error(
      `${tool} is not available in the ${state.phase} phase (needs ${phases.join(' or ')}).`,
    );
  }
  return state;
}

function documentContent(markdown: string): string {
  return markdown.endsWith('\n') ? markdown : `${markdown}\n`;
}

function writeDocument(cwd: string, relative: string, markdown: string): void {
  const path = join(cwd, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, documentContent(markdown), 'utf-8');
}

function writeSnapshot(
  cwd: string,
  relative: string,
  markdown: string,
  expectedHash: string,
): void {
  const path = join(cwd, relative);
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, documentContent(markdown), {
      encoding: 'utf-8',
      flag: 'wx',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (hashContent(readFileSync(path, 'utf-8')) !== expectedHash) {
      throw new Error(`Refusing to overwrite immutable approved snapshot ${relative}.`);
    }
  }
}

function validateDesignSummary(summary: string): string[] {
  const bullets = summary.split('\n').filter((line) => /^\s*[-*]\s+\S/.test(line));
  return bullets.length > 0
    ? []
    : ['Design summary must contain concise Markdown bullets.'];
}

function requireInteractive(ctx: ExtensionContext, gate: string): void {
  if (!ctx.hasUI) {
    throw new Error(`${gate} requires interactive human approval; no UI is available.`);
  }
}

export function registerGates(pi: ExtensionAPI, controller: Controller): void {
  pi.registerTool(
    defineTool({
      name: 'workflow_triage',
      label: 'Triage',
      description: 'Classify the ask as simple or complex. A human confirms the result.',
      parameters: Type.Object({
        verdict: Type.String({ description: 'Exactly "simple" or "complex"' }),
        reasoning: Type.String({ description: 'Why, in one or two sentences.' }),
        slug: Type.Optional(Type.String({
          description: 'Optional better short name, 2-4 words, hyphenated.',
        })),
      }),

      async execute(_id, params, _signal, _onUpdate, ctx) {
        const state = requirePhase(controller, 'workflow_triage', 'triage');
        requireInteractive(ctx, 'Triage');
        const proposed = params.verdict === 'simple' ? 'simple' : 'complex';
        const choice = await ctx.ui.select(
          `Triage: the agent says this is ${proposed}.\n${params.reasoning}`,
          ['Complex — grill it first', 'Simple — go straight to planning'],
        );
        const complexity = choice?.startsWith('Simple') ? 'simple' : 'complex';

        let next = { ...state, complexity } as BuildState;
        const requested = params.slug?.trim();
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
            ? `Triaged as complex. ${GRILLING_SKILL_REFERENCE} Call workflow_end_grilling only after the user agrees nothing is open.`
            : 'Triaged as simple. Investigate and submit the complete design, task contracts, and design summary with workflow_write_plan.',
        );
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: 'workflow_end_grilling',
      label: 'End Grilling',
      description: 'Record a shared understanding the user has already confirmed in conversation.',
      parameters: Type.Object({
        understanding: Type.String({
          description: 'Restatement of the ask, boundary, and acceptance criteria.',
        }),
      }),

      async execute(_id, params, _signal, _onUpdate, ctx) {
        const state = requirePhase(controller, 'workflow_end_grilling', 'grill');
        requireInteractive(ctx, 'Ending grilling');
        const agreed = await ctx.ui.confirm(
          'Is this a shared understanding of the ask?',
          params.understanding,
        );
        if (!agreed) {
          return say('Not agreed. Ask what is wrong or missing and continue grilling.');
        }
        controller.update(advance(state, 'plan', new Date()));
        return say('Understanding agreed. Write the implementation-ready plan and chunk contracts.');
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: 'workflow_write_plan',
      label: 'Write Plan and Tasks',
      description: 'Validate a complete design and chunk contracts, then ask a human to approve a revision.',
      parameters: Type.Object({
        plan: Type.String({
          description: 'The complete plan using every required top-level and Code Structure subsection.',
        }),
        tasks: Type.String({
          description: 'Unchecked chunks, each with Implementation Contract and Verification subsections.',
        }),
        designSummary: Type.String({
          description: 'Concise bullets for human approval: domains, decisions, alternatives, contracts, compatibility, risks, and chunks.',
        }),
      }),

      async execute(_id, params, _signal, _onUpdate, ctx) {
        const state = requirePhase(controller, 'workflow_write_plan', 'plan');
        const failures = [
          ...validatePlan(params.plan).map((failure) => `Plan: ${failure}`),
          ...validateTasks(params.tasks).map((failure) => `Tasks: ${failure}`),
          ...validateDesignSummary(params.designSummary).map((failure) => `Summary: ${failure}`),
        ];
        if (failures.length > 0) {
          throw new Error(
            `Rejected, nothing written. Fix and resubmit all artifacts:\n- ${failures.join('\n- ')}`,
          );
        }

        const candidates = buildPaths(state.date, state.slug);
        const planContent = documentContent(params.plan);
        const taskContent = documentContent(params.tasks);
        const planHash = hashContent(planContent);
        const taskHash = hashContent(taskContent);
        writeDocument(ctx.cwd, candidates.planCandidate, planContent);
        writeDocument(ctx.cwd, candidates.taskCandidate, taskContent);

        if (!ctx.hasUI) {
          return say(
            `Candidates written to ${candidates.planCandidate} and ${candidates.taskCandidate}, but approval requires an interactive human.`,
          );
        }

        const nextRevision = state.revision + 1;
        const approved = await ctx.ui.confirm(
          `Approve design revision ${nextRevision}?`,
          [
            params.designSummary.trim(),
            '',
            `Plan: ${candidates.planCandidate}`,
            `Tasks: ${candidates.taskCandidate}`,
            `Plan SHA-256: ${planHash}`,
            `Task SHA-256: ${taskHash}`,
            '',
            'Approval snapshots this design and starts execution.',
          ].join('\n'),
        );
        if (!approved) {
          return say('Candidate not approved. Ask what must change, revise all artifacts, and resubmit.');
        }

        const approvedPaths = revisionPaths(state.date, state.slug, nextRevision);
        writeSnapshot(ctx.cwd, approvedPaths.plan, planContent, planHash);
        writeSnapshot(ctx.cwd, approvedPaths.task, taskContent, taskHash);

        controller.update(
          approveRevision(
            state,
            {
              planPath: approvedPaths.plan,
              taskPath: approvedPaths.task,
              planHash,
              taskHash,
              designSummary: params.designSummary.trim(),
            },
            new Date(),
          ),
        );
        rmSync(join(ctx.cwd, candidates.planCandidate), { force: true });
        rmSync(join(ctx.cwd, candidates.taskCandidate), { force: true });
        return say(
          `Revision ${nextRevision} approved (${approvedPaths.plan}, ${approvedPaths.task}). Run chunks with workflow_run_chunk.`,
        );
      },
    }),
  );
}
