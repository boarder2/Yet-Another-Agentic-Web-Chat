/**
 * The crew: three interactive pi agents, each in its own herdr pane, driven by
 * prompt-and-wait rather than by a spawned process. The user watches the work
 * happen; the parent still decides everything, and still only believes a typed
 * result file.
 */
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgent } from './agents.ts';
import type { BuildConfig } from './config.ts';
import {
  agentPane,
  callerPaneId,
  closePane,
  isPaneBusy,
  promptAgent,
  renamePane,
  splitPane,
  startAgent,
  waitForAgent,
  type AgentStatus,
} from './herdr.ts';
import { AGENT_ROLES, type AgentRole } from './models.ts';
import {
  COMPLETION_TOOL,
  parseResult,
  RESULT_FILE_ENV,
  TEST_RESULT_TOOL,
  VERDICT_TOOL,
  type ResultEnvelope,
} from './verdict.ts';

const VERDICT_EXTENSION = fileURLToPath(
  new URL('./verdict-tool.ts', import.meta.url),
);

const SUBMIT_TOOLS = [VERDICT_TOOL, TEST_RESULT_TOOL, COMPLETION_TOOL];

/** Scratch lives beside the build state, so a workflow's files are all one prefix. */
function scratchPath(
  cwd: string,
  date: string,
  slug: string,
  role: AgentRole,
  suffix: string,
): string {
  return join(cwd, '.ai', 'builds', `${date}-${slug}-${role}.${suffix}`);
}

/** herdr agent names are `[a-z][a-z0-9_-]{0,31}`, so the slug gets truncated. */
export function agentName(slug: string, role: AgentRole): string {
  const sanitized = `${role}-${slug}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z]+/, '');
  return (sanitized || role).slice(0, 32);
}

export interface CrewPane {
  paneId: string;
  agent: string;
}

export type Crew = Partial<Record<AgentRole, CrewPane>>;

export interface CrewContext {
  cwd: string;
  date: string;
  slug: string;
  config: BuildConfig;
  sessionIdFor(role: AgentRole): string | undefined;
  note(line: string): void;
  signal?: AbortSignal;
}

function agentArgs(
  ctx: CrewContext,
  role: AgentRole,
  systemPromptFile: string,
): string[] {
  const agent = loadAgent(ctx.cwd, role);
  const args = [
    '--approve',
    '--model',
    ctx.config.models[role],
    '--append-system-prompt',
    systemPromptFile,
    '-e',
    VERDICT_EXTENSION,
  ];

  const sessionId = ctx.sessionIdFor(role);
  if (sessionId) args.push('--session-id', sessionId);
  else args.push('--no-session');

  // An agent's tool allowlist must never exclude the channel it reports through.
  if (agent.tools?.length) {
    args.push('--tools', [...new Set([...agent.tools, ...SUBMIT_TOOLS])].join(','));
  }
  return args;
}

interface Anchor {
  paneId: string;
  direction: 'right' | 'down';
  /** Share retained by the pane being split; the new pane takes the rest. */
  ratio: number;
}

/** The driver keeps the left third; the crew column takes the remaining two. */
const DRIVER_SHARE = 1 / 3;

/**
 * Driver on the left third, then coder, tester and reviewer stacked down the right
 * two thirds in equal parts: the coder keeps a third of the column, and what is left
 * is halved.
 *
 * The driver is split only to open the column, and never again while any crew pane
 * survives — splitting it twice is what shrinks the user's own pane to a sliver.
 * Every later pane is carved out of the right column instead.
 */
export function anchorFor(
  role: AgentRole,
  crew: Crew,
  driver: string | null,
): Anchor | null {
  const column = AGENT_ROLES.map((other) => crew[other]).filter(
    (pane): pane is CrewPane => Boolean(pane),
  );
  if (column.length === 0) {
    return driver
      ? { paneId: driver, direction: 'right', ratio: DRIVER_SHARE }
      : null;
  }

  // Building the column in order: thirds fall out of keeping 1/3 for the coder and
  // halving what is left.
  if (role === 'tester' && crew.coder && !crew.reviewer) {
    return { paneId: crew.coder.paneId, direction: 'down', ratio: 1 / 3 };
  }
  if (role === 'reviewer' && crew.tester) {
    return { paneId: crew.tester.paneId, direction: 'down', ratio: 0.5 };
  }

  // Rebuilding a single lost pane: halve whichever crew pane is still there.
  return {
    paneId: column[column.length - 1].paneId,
    direction: 'down',
    ratio: 0.5,
  };
}

async function createPane(
  ctx: CrewContext,
  role: AgentRole,
  anchor: Anchor,
): Promise<string> {
  const resultFile = scratchPath(ctx.cwd, ctx.date, ctx.slug, role, 'result.json');
  mkdirSync(dirname(resultFile), { recursive: true });

  const paneId = await splitPane({
    pane: anchor.paneId,
    direction: anchor.direction,
    ratio: anchor.ratio,
    cwd: ctx.cwd,
    env: { [RESULT_FILE_ENV]: resultFile },
    signal: ctx.signal,
  });

  // The label is decoration for the sidebar; a workflow must not die over it.
  await renamePane(paneId, role, ctx.signal).catch((error: unknown) => {
    ctx.note(`${role}: could not label the pane (${error})`);
  });
  return paneId;
}

/** How long a freshly split pane gets to become one herdr will start an agent in. */
const PANE_READY_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 750;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts one role in its pane, retrying while herdr says the pane is busy.
 *
 * A pane is not startable the instant `pane split` returns, and no observable
 * property of the pane says when it will be: its foreground process group reports
 * the shell as ready within milliseconds, while herdr keeps refusing for about a
 * second. So the retry asks the only authority there is, repeatedly. The refusal
 * comes back immediately, which makes polling it cheap.
 */
async function startRole(
  ctx: CrewContext,
  role: AgentRole,
  paneId: string,
  agent: string,
): Promise<void> {
  const systemPromptFile = scratchPath(
    ctx.cwd,
    ctx.date,
    ctx.slug,
    role,
    'system.md',
  );
  writeFileSync(systemPromptFile, loadAgent(ctx.cwd, role).systemPrompt, 'utf-8');

  const deadline = Date.now() + PANE_READY_TIMEOUT_MS;
  for (let attempt = 1; ; attempt++) {
    try {
      await startAgent({
        name: agent,
        pane: paneId,
        agentArgs: agentArgs(ctx, role, systemPromptFile),
        signal: ctx.signal,
      });
      return;
    } catch (error) {
      if (!isPaneBusy(error) || Date.now() >= deadline) throw error;
      if (attempt === 1) ctx.note(`${role}: waiting for the pane to be startable`);
      await sleep(RETRY_DELAY_MS);
    }
  }
}

/**
 * Brings the crew up to strength, adopting whatever is already live. Adoption is by
 * agent name — derived from the slug, and looked up in herdr — rather than from a
 * stored pane id: herdr is the authority on what exists and where, so a crashed or
 * half-built run reattaches instead of trying to start a second agent under a name
 * that is already taken.
 */
export async function ensureCrew(ctx: CrewContext): Promise<Crew> {
  const crew: Crew = {};
  for (const role of AGENT_ROLES) {
    const agent = agentName(ctx.slug, role);
    const paneId = await agentPane(agent, ctx.signal);
    if (paneId) crew[role] = { paneId, agent };
  }

  const driver = callerPaneId();

  for (const role of AGENT_ROLES) {
    if (crew[role]) continue;

    const anchor = anchorFor(role, crew, driver);
    if (!anchor) {
      throw new Error(
        `No pane to split for the ${role} agent. HERDR_PANE_ID is unset and no crew pane survives — run /build from inside a herdr pane.`,
      );
    }

    ctx.note(`${role}: opening pane`);
    const paneId = await createPane(ctx, role, anchor);
    const agent = agentName(ctx.slug, role);

    // A pane whose agent never started is unusable, and left behind it would be
    // split again by the next attempt — carving the screen up a little further on
    // every retry. Note that roles started before this one stay: they are live
    // agents, and the next call adopts them by name.
    try {
      ctx.note(`${role}: starting on ${ctx.config.models[role]}`);
      await startRole(ctx, role, paneId, agent);
    } catch (error) {
      await closePane(paneId, ctx.signal).catch(() => {});
      throw error;
    }

    crew[role] = { paneId, agent };
  }

  return crew;
}

export interface RoleRun {
  status: AgentStatus;
  envelope: ResultEnvelope | null;
  /** Set when the run could not produce a usable result. */
  problem?: string;
}

/**
 * One turn for one role. The result file is removed first, so a stale result from
 * the previous round can never be read as this round's answer.
 */
export async function runRole(
  ctx: CrewContext,
  crew: Crew,
  role: AgentRole,
  brief: string,
  onBlocked: (role: AgentRole) => void,
): Promise<RoleRun> {
  const pane = crew[role];
  if (!pane) throw new Error(`No pane for the ${role} agent.`);

  const resultFile = scratchPath(ctx.cwd, ctx.date, ctx.slug, role, 'result.json');
  rmSync(resultFile, { force: true });

  let status = await promptAgent({
    name: pane.agent,
    text: brief,
    waitTimeoutMs: ctx.config.turnTimeoutMs,
    signal: ctx.signal,
  });

  if (status === 'blocked') {
    onBlocked(role);
    try {
      status = await waitForAgent(
        pane.agent,
        ctx.config.blockedTimeoutMs,
        ['idle', 'done'],
        ctx.signal,
      );
    } catch {
      return {
        status: 'blocked',
        envelope: null,
        problem: `The ${role} agent is asking for input in its pane and was not unblocked in time.`,
      };
    }
  }

  const envelope = existsSync(resultFile)
    ? parseResult(readFileSync(resultFile, 'utf-8'))
    : null;
  return { status, envelope };
}

/**
 * Retires a role's agent by closing its pane, so `ensureCrew` builds a new one on a
 * fresh session. Closing the pane is what makes the retirement real: adoption goes
 * by agent name, so an agent left running would simply be picked up again.
 *
 * Used for the reviewer between chunks — it must not anchor on work it already
 * approved — and for a long-lived agent that has outgrown its context budget.
 */
export async function retireRole(
  ctx: CrewContext,
  role: AgentRole,
): Promise<void> {
  const paneId = await agentPane(agentName(ctx.slug, role), ctx.signal);
  if (!paneId) return;

  try {
    await closePane(paneId, ctx.signal);
  } catch {
    // Already gone — the point was that it stops existing.
  }
}
