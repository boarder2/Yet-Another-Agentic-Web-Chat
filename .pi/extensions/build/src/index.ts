import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { isSafeCommand } from './bash-allowlist.ts';
import { registerClose } from './checks.ts';
import { registerGates, type Controller } from './gates.ts';
import { registerLoop } from './loop.ts';
import { phasePrompt } from './prompts.ts';
import { findBuild, listBuilds, saveBuild, uniqueSlug } from './store.ts';
import {
  createState,
  formatDate,
  mintSlug,
  setStatus,
  type BuildState,
} from './state.ts';

const ENTRY_TYPE = 'build-workflow';
const WITHHELD_TOOLS = ['edit', 'write'];

interface Attachment {
  slug: string;
  date: string;
}

export default function buildWorkflow(pi: ExtensionAPI): void {
  let active: BuildState | null = null;
  let withheld: string[] = [];
  let projectCwd = process.cwd();

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

  function showStatus(ctx: ExtensionContext): void {
    ctx.ui.setStatus(
      'build',
      active
        ? ctx.ui.theme.fg('warning', `⚑ ${active.slug} · ${active.phase}`)
        : undefined,
    );
  }

  function attach(state: BuildState, ctx: ExtensionContext): void {
    active = state;
    enforceGating();
    pi.appendEntry(ENTRY_TYPE, { slug: state.slug, date: state.date });
    showStatus(ctx);
  }

  function detach(ctx: ExtensionContext): void {
    active = null;
    restoreTools();
    showStatus(ctx);
  }

  function persist(cwd: string, state: BuildState): void {
    active = state;
    saveBuild(cwd, state);
  }

  // The session records which workflow it drives; the workflow itself lives on
  // disk, so a resumed session re-reads the current phase rather than trusting
  // whatever the entry said when it was written.
  pi.on('session_start', async (_event, ctx) => {
    active = null;
    withheld = [];
    projectCwd = ctx.cwd;

    let attachment: Attachment | undefined;
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === 'custom' && entry.customType === ENTRY_TYPE) {
        attachment = entry.data as Attachment;
      }
    }
    if (!attachment) return;

    const stored = findBuild(ctx.cwd, attachment.slug);
    if (!stored || stored.state.status !== 'active') return;

    active = stored.state;
    enforceGating();
    showStatus(ctx);
  });

  // The tool set is rebuilt after session_start, so re-gate once resources are in.
  pi.on('resources_discover', async () => {
    enforceGating();
  });

  pi.on('before_agent_start', async (event) => {
    if (!active) return;
    enforceGating();
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
      enforceGating();
    },
  };

  registerGates(pi, controller);
  registerLoop(pi, controller);
  registerClose(pi, controller);

  pi.registerCommand('build:attach', {
    description: 'Print the command to open an agent session in another terminal',
    handler: async (args, ctx) => {
      if (!active) {
        ctx.ui.notify('No active workflow.', 'warning');
        return;
      }
      const role = args.trim() === 'tester' ? 'tester' : 'coder';
      ctx.ui.notify(
        `Open in another terminal (safe between chunks, not during one):\n` +
          `  pi --session ${active.agents[role].sessionId}`,
        'info',
      );
    },
  });

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

      const ask = args.trim();
      if (!ask) {
        ctx.ui.notify('Usage: /build <what you want built>', 'warning');
        return;
      }

      const now = new Date();
      const date = formatDate(now);
      const slug = uniqueSlug(ctx.cwd, date, mintSlug(ask));
      const state = createState(ask, slug, date, now);

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
      if (!active) {
        ctx.ui.notify('No active workflow.', 'warning');
        return;
      }

      const slug = active.slug;
      persist(ctx.cwd, setStatus(active, 'paused', new Date()));
      detach(ctx);
      ctx.ui.notify(`Workflow "${slug}" paused. Resume with /build:resume ${slug}`, 'info');
    },
  });

  pi.registerCommand('build:resume', {
    description: 'Resume a paused workflow by slug',
    handler: async (args, ctx) => {
      if (active) {
        ctx.ui.notify(
          `Workflow "${active.slug}" is active here. Pause it before resuming another.`,
          'warning',
        );
        return;
      }

      const slug = args.trim();
      const stored = slug ? findBuild(ctx.cwd, slug) : null;
      if (!stored) {
        ctx.ui.notify(
          slug ? `No workflow found for "${slug}".` : 'Usage: /build:resume <slug>',
          'warning',
        );
        return;
      }
      if (stored.state.status === 'aborted' || stored.state.status === 'done') {
        ctx.ui.notify(
          `Workflow "${slug}" is ${stored.state.status} and cannot be resumed.`,
          'warning',
        );
        return;
      }

      const now = new Date();
      const state = {
        ...setStatus(stored.state, 'active', now),
        lastAttachedAt: now.toISOString(),
      };
      persist(ctx.cwd, state);
      attach(state, ctx);
      ctx.ui.notify(`Workflow "${slug}" resumed in ${state.phase}.`, 'info');
    },
  });

  pi.registerCommand('build:abort', {
    description: 'Abandon the active workflow (plan and task files are kept)',
    handler: async (_args, ctx) => {
      if (!active) {
        ctx.ui.notify('No active workflow.', 'warning');
        return;
      }

      const slug = active.slug;
      const ok = !ctx.hasUI
        ? true
        : await ctx.ui.confirm(
            `Abort workflow "${slug}"?`,
            'Phase state is discarded. The plan and task files stay on disk.',
          );
      if (!ok) return;

      persist(ctx.cwd, setStatus(active, 'aborted', new Date()));
      detach(ctx);
      ctx.ui.notify(`Workflow "${slug}" aborted.`, 'info');
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
        const here = state.slug === active?.slug ? ' (this session)' : '';
        const seen = state.lastAttachedAt
          ? ` last attached ${state.lastAttachedAt}`
          : '';
        return `${state.slug} — ${state.phase} / ${state.status}${here}${seen}`;
      });
      ctx.ui.notify(lines.join('\n'), 'info');
    },
  });
}
