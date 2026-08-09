import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { parseStartArgs } from './args.ts';
import { isSafeCommand } from './bash-allowlist.ts';
import { registerClose } from './checks.ts';
import { CONFIG_PATH, loadConfig } from './config.ts';
import { registerGates, type Controller } from './gates.ts';
import { insideHerdr } from './herdr.ts';
import { closeBuildAgents } from './panes.ts';
import { registerLoop } from './loop.ts';
import { parseModelSpec, resolveModel, unresolvableModels } from './models.ts';
import { phasePrompt } from './prompts.ts';
import {
  buildArtifactPaths,
  findBuild,
  listBuilds,
  removeBuildArtifacts,
  saveBuild,
  uniqueSlug,
  type StoredBuild,
} from './store.ts';
import {
  createState,
  formatDate,
  mintSlug,
  setStatus,
  type BuildState,
  type Phase,
} from './state.ts';
import { setWorkflowToolsActive } from './workflow-tools.ts';

const ENTRY_TYPE = 'build-workflow';
const WITHHELD_TOOLS = ['edit', 'write'];

/** Phases whose thinking happens in this session, and so run on the plan model. */
const PLANNING_PHASES: readonly Phase[] = ['triage', 'grill', 'plan', 'tasks'];

interface Attachment {
  slug: string;
  date: string;
}

interface ModelChoice {
  provider: string;
  id: string;
  thinkingLevel: string | null;
}

type ManageAction = 'inspect' | 'resume' | 'pause' | 'abort' | 'delete';

function sameBuild(left: BuildState | null, right: BuildState): boolean {
  return Boolean(left && left.date === right.date && left.slug === right.slug);
}

function workflowLabel(state: BuildState, current: BuildState | null): string {
  const here = sameBuild(current, state) ? ' · this session' : '';
  return `${state.date} · ${state.slug} — ${state.phase} / ${state.status}${here}`;
}

function workflowDetails(state: BuildState): string {
  return [
    workflowLabel(state, null),
    `Ask: ${state.ask}`,
    `Created: ${state.createdAt}`,
    `Updated: ${state.updatedAt}`,
    `Last attached: ${state.lastAttachedAt ?? 'never'}`,
    `State: ${buildArtifactPaths(state)[0]}`,
    `Plan: ${state.planPath ?? 'not written'}`,
    `Tasks: ${state.taskPath ?? 'not written'}`,
  ].join('\n');
}

function isResumable(state: BuildState): boolean {
  return state.status === 'active' || state.status === 'paused';
}

export default function buildWorkflow(pi: ExtensionAPI): void {
  let active: BuildState | null = null;
  let withheld: string[] = [];
  let projectCwd = process.cwd();
  /** What this session was on before /build touched it, restored when it ends. */
  let priorModel: ModelChoice | null = null;
  /** The phase whose model has been applied, so a manual /model within it stands. */
  let modelledPhase: Phase | null = null;

  // Re-applied at every point the tool set can change, because `session_start`
  // fires before `resources_discover` rebuilds it — gate once and the rebuild
  // silently hands `edit` and `write` back. Records what it removed rather than
  // snapshotting the whole set, so tools added later survive the restore.
  function enforceGating(): void {
    if (!active) return;

    const current = pi.getActiveTools();
    const removing = current.filter((name) => WITHHELD_TOOLS.includes(name));
    if (removing.length === 0) return;

    withheld = [...new Set([...withheld, ...removing])];
    pi.setActiveTools(current.filter((name) => !WITHHELD_TOOLS.includes(name)));
  }

  function restoreTools(): void {
    if (withheld.length === 0) return;
    pi.setActiveTools([...new Set([...pi.getActiveTools(), ...withheld])]);
    withheld = [];
  }

  async function switchModel(
    ctx: ExtensionContext,
    choice: ModelChoice,
  ): Promise<boolean> {
    const model = ctx.modelRegistry.find(choice.provider, choice.id);
    if (!model || !(await pi.setModel(model))) return false;
    if (choice.thinkingLevel) {
      pi.setThinkingLevel(choice.thinkingLevel as never);
    }
    return true;
  }

  /**
   * The plan model covers triage through tasks; execution restores whatever the
   * session was on, since the driver narrates rather than designs. Applied only on
   * a phase change, so a manual `/model` mid-phase is never overridden.
   */
  async function applyPhaseModel(
    ctx: ExtensionContext,
    state: BuildState,
  ): Promise<void> {
    if (modelledPhase === state.phase) return;
    modelledPhase = state.phase;

    if (PLANNING_PHASES.includes(state.phase)) {
      const loaded = loadConfig(ctx.cwd);
      if (!loaded.ok) return;

      const spec = loaded.config.models.plan;
      const model = resolveModel(ctx.modelRegistry, spec);
      if (!model) return;
      if (!(await switchModel(ctx, resolvedChoice(model, spec)))) {
        ctx.ui.notify(`No API key for the plan model (${spec}).`, 'error');
      }
      return;
    }

    await restoreModel(ctx);
  }

  async function restoreModel(ctx: ExtensionContext): Promise<void> {
    if (!priorModel) return;
    const restoring = priorModel;
    priorModel = null;
    if (!(await switchModel(ctx, restoring))) {
      ctx.ui.notify(
        `Could not restore ${restoring.provider}/${restoring.id}. Pick a model with /model.`,
        'warning',
      );
    }
  }

  function rememberCurrentModel(ctx: ExtensionContext): void {
    if (priorModel || !ctx.model) return;
    priorModel = {
      provider: ctx.model.provider,
      id: ctx.model.id,
      thinkingLevel: ctx.thinkingLevel ?? null,
    };
  }

  function showStatus(ctx: ExtensionContext): void {
    ctx.ui.setStatus(
      'build',
      active
        ? ctx.ui.theme.fg('warning', `⚑ ${active.slug} · ${active.phase}`)
        : undefined,
    );
  }

  function syncWorkflowTools(): void {
    setWorkflowToolsActive(pi, active?.status === 'active');
  }

  function attach(state: BuildState, ctx: ExtensionContext): void {
    active = state;
    syncWorkflowTools();
    enforceGating();
    pi.appendEntry(ENTRY_TYPE, { slug: state.slug, date: state.date });
    showStatus(ctx);
    rememberCurrentModel(ctx);
    void applyPhaseModel(ctx, state);
  }

  function detach(ctx: ExtensionContext): void {
    active = null;
    syncWorkflowTools();
    modelledPhase = null;
    restoreTools();
    void restoreModel(ctx);
    showStatus(ctx);
  }

  function persist(cwd: string, state: BuildState): void {
    active = state;
    saveBuild(cwd, state);
  }

  /**
   * The workflow drives three interactive agents in herdr panes, so there is no
   * degraded mode to fall back to: without herdr there is nowhere to put them.
   */
  function herdrProblem(): string | null {
    return insideHerdr()
      ? null
      : 'This session is not running inside herdr (HERDR_ENV is not 1). ' +
          'The /build workflow runs its coder, tester and reviewer as live agents in herdr panes, ' +
          'so start pi inside a herdr pane and try again.';
  }

  function configProblems(ctx: ExtensionContext): string[] {
    const loaded = loadConfig(ctx.cwd);
    if (!loaded.ok) return loaded.problems;
    return unresolvableModels(ctx.modelRegistry, loaded.config.models).map(
      (entry) => `No model matches ${entry}.`,
    );
  }

  /** Every precondition, reported together rather than one restart at a time. */
  function blockers(ctx: ExtensionContext): string[] {
    const herdr = herdrProblem();
    return [...(herdr ? [herdr] : []), ...configProblems(ctx)];
  }

  function buildCompletions(
    prefix: string,
    predicate: (state: BuildState) => boolean,
  ) {
    const needle = prefix.trim();
    const items = listBuilds(projectCwd)
      .filter(({ state }) => predicate(state))
      .map(({ state }) => ({
        value: state.slug,
        label: `${state.slug} (${state.status}, ${state.phase}, ${state.date})`,
      }))
      .filter(({ value }) => value.startsWith(needle));
    return items.length > 0 ? items : null;
  }

  async function chooseBuild(
    ctx: ExtensionContext,
    predicate: (state: BuildState) => boolean,
    title: string,
  ): Promise<StoredBuild | null> {
    const builds = listBuilds(ctx.cwd).filter(({ state }) => predicate(state));
    if (builds.length === 0) {
      ctx.ui.notify('No matching workflows.', 'info');
      return null;
    }
    if (!ctx.hasUI) {
      ctx.ui.notify('This command needs a workflow slug in non-interactive mode.', 'warning');
      return null;
    }

    const labels = builds.map(({ state }) => workflowLabel(state, active));
    const selected = await ctx.ui.select(title, labels);
    if (!selected) return null;
    const index = labels.indexOf(selected);
    return builds[index] ?? null;
  }

  async function resumeStored(
    stored: StoredBuild,
    ctx: ExtensionContext,
  ): Promise<boolean> {
    if (active) {
      ctx.ui.notify(
        `Workflow "${active.slug}" is active here. Pause it before resuming another.`,
        'warning',
      );
      return false;
    }
    if (!isResumable(stored.state)) {
      ctx.ui.notify(
        `Workflow "${stored.state.slug}" is ${stored.state.status} and cannot be resumed.`,
        'warning',
      );
      return false;
    }

    const problems = blockers(ctx);
    if (problems.length) {
      ctx.ui.notify(
        `Cannot resume "${stored.state.slug}":\n- ${problems.join('\n- ')}`,
        'error',
      );
      return false;
    }

    const now = new Date();
    const state = {
      ...setStatus(stored.state, 'active', now),
      lastAttachedAt: now.toISOString(),
    };
    persist(ctx.cwd, state);
    attach(state, ctx);
    ctx.ui.notify(`Workflow "${state.slug}" resumed in ${state.phase}.`, 'info');
    return true;
  }

  function pauseCurrent(ctx: ExtensionContext): boolean {
    if (!active) {
      ctx.ui.notify('No active workflow.', 'warning');
      return false;
    }

    const slug = active.slug;
    persist(ctx.cwd, setStatus(active, 'paused', new Date()));
    detach(ctx);
    ctx.ui.notify(
      `Workflow "${slug}" paused. Resume with /build:resume or /build:resume ${slug}`,
      'info',
    );
    return true;
  }

  async function abortCurrent(ctx: ExtensionContext): Promise<boolean> {
    if (!active) {
      ctx.ui.notify('No active workflow.', 'warning');
      return false;
    }

    const slug = active.slug;
    const ok = !ctx.hasUI
      ? true
      : await ctx.ui.confirm(
          `Abort workflow "${slug}"?`,
          'Phase state is discarded. The plan and task files stay on disk, and the agent panes stay open.',
        );
    if (!ok) return false;

    persist(ctx.cwd, setStatus(active, 'aborted', new Date()));
    detach(ctx);
    ctx.ui.notify(`Workflow "${slug}" aborted.`, 'info');
    return true;
  }

  async function confirmDelete(
    state: BuildState,
    ctx: ExtensionContext,
  ): Promise<boolean> {
    if (!ctx.hasUI) return true;

    const files = buildArtifactPaths(state).map((path) => `- ${path}`).join('\n');
    return ctx.ui.confirm(
      `Delete workflow "${state.slug}" completely?`,
      `The following files will be deleted:\n${files}\n\n` +
        'The matching coder, tester, and reviewer panes will be closed. ' +
        'The existing Pi session attachment remains in the transcript.',
    );
  }

  async function deleteStored(
    stored: StoredBuild,
    ctx: ExtensionCommandContext,
  ): Promise<{ ok: boolean; missing: string[]; failed: string[]; error?: string }> {
    if (sameBuild(active, stored.state) && !ctx.isIdle()) {
      ctx.abort();
      await ctx.waitForIdle();
    }

    const cleanup = await closeBuildAgents(stored.state.slug);
    try {
      removeBuildArtifacts(ctx.cwd, stored.state, stored.file);
    } catch (error) {
      return {
        ok: false,
        missing: cleanup.missing,
        failed: cleanup.failed,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    if (sameBuild(active, stored.state)) detach(ctx);
    return {
      ok: true,
      missing: cleanup.missing,
      failed: cleanup.failed,
    };
  }

  function cleanupReport(
    missing: string[],
    failed: string[],
  ): string {
    const notes: string[] = [];
    if (missing.length > 0) {
      notes.push(`Agent panes already absent: ${missing.join(', ')}`);
    }
    if (failed.length > 0) {
      notes.push(`Agent panes could not be closed: ${failed.join(', ')}`);
    }
    return notes.length > 0 ? `\n${notes.join('\n')}` : '';
  }

  async function deleteOne(
    stored: StoredBuild,
    ctx: ExtensionCommandContext,
  ): Promise<boolean> {
    if (!(await confirmDelete(stored.state, ctx))) return false;

    const result = await deleteStored(stored, ctx);
    if (!result.ok) {
      ctx.ui.notify(
        `Could not completely delete workflow "${stored.state.slug}": ${result.error}` +
          cleanupReport(result.missing, result.failed),
        'error',
      );
      return false;
    }

    ctx.ui.notify(
      `Workflow "${stored.state.slug}" deleted.` +
        cleanupReport(result.missing, result.failed),
      'info',
    );
    return true;
  }

  function manageActions(
    state: BuildState,
    current: BuildState | null,
  ): ManageAction[] {
    const actions: ManageAction[] = ['inspect'];
    if (sameBuild(current, state) && state.status === 'active') {
      actions.push('pause', 'abort');
    } else if (!current && isResumable(state)) {
      actions.push('resume');
    }
    actions.push('delete');
    return actions;
  }

  const actionLabels: Record<ManageAction, string> = {
    inspect: 'Inspect details',
    resume: 'Resume workflow',
    pause: 'Pause workflow',
    abort: 'Abort workflow (keep plan and tasks)',
    delete: 'Delete workflow and all artifacts',
  };

  // The session records which workflow it drives; the workflow itself lives on
  // disk, so a resumed session re-reads the current phase rather than trusting
  // whatever the entry said when it was written.
  pi.on('session_start', async (_event, ctx) => {
    active = null;
    syncWorkflowTools();
    withheld = [];
    modelledPhase = null;
    projectCwd = ctx.cwd;

    let attachment: Attachment | undefined;
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === 'custom' && entry.customType === ENTRY_TYPE) {
        attachment = entry.data as Attachment;
      }
    }
    if (!attachment) return;

    const stored = findBuild(ctx.cwd, attachment.slug, attachment.date);
    if (!stored || stored.state.status !== 'active') return;

    active = stored.state;
    syncWorkflowTools();
    enforceGating();
    showStatus(ctx);
  });

  // The tool set is rebuilt after session_start, so restore the session's tool mode once resources are in.
  pi.on('resources_discover', async () => {
    syncWorkflowTools();
    enforceGating();
  });

  pi.on('before_agent_start', async (event, ctx) => {
    syncWorkflowTools();
    if (!active) return;
    enforceGating();
    rememberCurrentModel(ctx);
    await applyPhaseModel(ctx, active);
    return { systemPrompt: `${event.systemPrompt}\n\n${phasePrompt(active)}` };
  });

  pi.on('tool_call', async (event) => {
    if (!active || event.toolName !== 'bash') return;

    const command = String((event.input as { command?: unknown }).command ?? '');
    if (!isSafeCommand(command)) {
      return {
        block: true,
        reason:
          `/build (${active.phase}): bash is limited to read-only commands during a workflow. ` +
          `Code changes go through workflow_run_chunk, not bash.\nCommand: ${command}`,
      };
    }
  });

  const controller: Controller = {
    current: () => active,
    update: (state) => {
      persist(projectCwd, state);
      syncWorkflowTools();
      enforceGating();
    },
    detach,
  };

  registerGates(pi, controller);
  registerLoop(pi, controller);
  registerClose(pi, controller);

  pi.registerCommand('build', {
    description: 'Start a phase-gated build workflow',
    handler: async (args, ctx) => {
      if (active) {
        ctx.ui.notify(
          `Workflow "${active.slug}" is already active in this session. ` +
            'Use /build:pause first, or start the new one in another session.',
          'warning',
        );
        return;
      }

      const parsed = parseStartArgs(args);
      if (!parsed) {
        ctx.ui.notify(
          'Usage: /build <what you want built> or /build <slug> -- <what you want built>',
          'warning',
        );
        return;
      }

      const problems = blockers(ctx);
      if (problems.length) {
        ctx.ui.notify(
          `Cannot start a workflow:\n- ${problems.join('\n- ')}\n\nModels are declared per role in ${CONFIG_PATH}.`,
          'error',
        );
        return;
      }

      const now = new Date();
      const date = formatDate(now);
      const baseSlug = parsed.requestedSlug ?? mintSlug(parsed.ask);
      const slug = uniqueSlug(ctx.cwd, date, baseSlug);
      const state = createState(parsed.ask, slug, date, now);

      persist(ctx.cwd, state);
      attach(state, ctx);
      ctx.ui.notify(
        `Workflow "${slug}" started in triage. edit and write are withheld until it ends.`,
        'info',
      );
    },
  });

  pi.registerCommand('build:pause', {
    description: 'Pause the active workflow and restore normal tools',
    handler: async (_args, ctx) => {
      pauseCurrent(ctx);
    },
  });

  pi.registerCommand('build:resume', {
    description: 'Resume a workflow by slug, or choose one interactively',
    getArgumentCompletions: (prefix) =>
      buildCompletions(prefix, isResumable),
    handler: async (args, ctx) => {
      if (active) {
        ctx.ui.notify(
          `Workflow "${active.slug}" is active here. Pause it before resuming another.`,
          'warning',
        );
        return;
      }

      const slug = args.trim();
      const stored = slug
        ? findBuild(ctx.cwd, slug)
        : await chooseBuild(ctx, isResumable, 'Resume which workflow?');
      if (!stored) {
        if (slug) ctx.ui.notify(`No workflow found for "${slug}".`, 'warning');
        return;
      }
      await resumeStored(stored, ctx);
    },
  });

  pi.registerCommand('build:abort', {
    description: 'Abandon the active workflow (plan and task files are kept)',
    handler: async (_args, ctx) => {
      await abortCurrent(ctx);
    },
  });

  pi.registerCommand('build:delete', {
    description: 'Delete the current workflow and all of its artifacts',
    handler: async (_args, ctx) => {
      if (!active) {
        ctx.ui.notify('No current workflow. Use /build:manage to choose one.', 'warning');
        return;
      }
      await deleteOne({ state: active, file: '' }, ctx);
    },
  });

  pi.registerCommand('build:prune', {
    description: 'Delete all completed workflows and their artifacts',
    handler: async (_args, ctx) => {
      const completed = listBuilds(ctx.cwd).filter(
        ({ state }) => state.status === 'done',
      );
      if (completed.length === 0) {
        ctx.ui.notify('No completed workflows to prune.', 'info');
        return;
      }

      const names = completed
        .map(({ state }) => `- ${workflowLabel(state, active)}`)
        .join('\n');
      const ok = !ctx.hasUI
        ? true
        : await ctx.ui.confirm(
            `Prune ${completed.length} completed workflow${completed.length === 1 ? '' : 's'}?`,
            `Plans, task lists, state, agent scratch, and matching panes will be removed:\n${names}`,
          );
      if (!ok) return;

      let removed = 0;
      const missing: string[] = [];
      const failed: string[] = [];
      const errors: string[] = [];
      for (const stored of completed) {
        const result = await deleteStored(stored, ctx);
        if (!result.ok) {
          errors.push(`${stored.state.slug}: ${result.error}`);
          continue;
        }
        removed++;
        missing.push(...result.missing);
        failed.push(...result.failed);
      }

      const problems = [
        ...errors,
        ...(failed.length > 0
          ? [`Agent panes could not be closed: ${failed.join(', ')}`]
          : []),
      ];
      ctx.ui.notify(
        `Pruned ${removed} of ${completed.length} completed workflow${completed.length === 1 ? '' : 's'}.` +
          (problems.length ? `\n${problems.join('\n')}` : '') +
          (missing.length ? `\nAgent panes already absent: ${missing.join(', ')}` : ''),
        problems.length ? 'warning' : 'info',
      );
    },
  });

  pi.registerCommand('build:manage', {
    description: 'Choose a workflow and inspect or manage it interactively',
    getArgumentCompletions: (prefix) => buildCompletions(prefix, () => true),
    handler: async (args, ctx) => {
      const slug = args.trim();
      const stored = slug
        ? findBuild(ctx.cwd, slug)
        : await chooseBuild(ctx, () => true, 'Manage which workflow?');
      if (!stored) {
        if (slug) ctx.ui.notify(`No workflow found for "${slug}".`, 'warning');
        return;
      }

      if (!ctx.hasUI) {
        ctx.ui.notify(workflowDetails(stored.state), 'info');
        return;
      }

      const actions = manageActions(stored.state, active);
      const selected = await ctx.ui.select(
        `Manage ${stored.state.slug}`,
        actions.map((action) => actionLabels[action]),
      );
      if (!selected) return;

      const action = actions.find((candidate) => actionLabels[candidate] === selected);
      if (!action) return;

      switch (action) {
        case 'inspect':
          ctx.ui.notify(workflowDetails(stored.state), 'info');
          break;
        case 'resume':
          await resumeStored(stored, ctx);
          break;
        case 'pause':
          pauseCurrent(ctx);
          break;
        case 'abort':
          await abortCurrent(ctx);
          break;
        case 'delete':
          await deleteOne(stored, ctx);
          break;
      }
    },
  });

  pi.registerCommand('build:list', {
    description: 'List build workflows in this project',
    handler: async (_args, ctx) => {
      const builds = listBuilds(ctx.cwd);
      if (builds.length === 0) {
        ctx.ui.notify('No workflows yet. Start one with /build <ask>', 'info');
        return;
      }

      const lines = builds.map(({ state }) => {
        const here = sameBuild(active, state) ? ' (this session)' : '';
        const seen = state.lastAttachedAt
          ? ` last attached ${state.lastAttachedAt}`
          : '';
        return `${state.date} · ${state.slug} — ${state.phase} / ${state.status}${here}${seen}`;
      });
      ctx.ui.notify(lines.join('\n'), 'info');
    },
  });
}

/** The registry match decides provider and id; the spec only pins thinking level. */
function resolvedChoice(
  model: { provider: string; id: string },
  spec: string,
): ModelChoice {
  return {
    provider: model.provider,
    id: model.id,
    thinkingLevel: parseModelSpec(spec).thinkingLevel,
  };
}
