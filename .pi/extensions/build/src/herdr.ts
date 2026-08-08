/**
 * The herdr control surface. Every pane and agent operation the workflow needs,
 * in one module, so the loop reads as orchestration rather than as CLI plumbing.
 *
 * herdr answers on stdout as JSON and reports server errors as JSON on stderr
 * with exit 1, so a failed call is always distinguishable from a call that
 * succeeded with an empty result.
 */
import { spawn } from 'node:child_process';

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

/** `{"error":{"code":"agent_pane_busy",…}}` on stderr — the code is what callers branch on. */
export function errorCode(output: string): string | null {
  try {
    const parsed = JSON.parse(output) as { error?: { code?: unknown } };
    return typeof parsed.error?.code === 'string' ? parsed.error.code : null;
  } catch {
    return null;
  }
}

export class HerdrError extends Error {
  readonly code: string | null;

  constructor(
    readonly command: readonly string[],
    readonly exitCode: number | null,
    readonly output: string,
  ) {
    super(
      `herdr ${command.join(' ')} failed (exit ${exitCode}): ${output.trim().slice(0, 500)}`,
    );
    this.name = 'HerdrError';
    this.code = errorCode(output);
  }
}

/**
 * `agent start` refuses a pane it does not yet consider an available shell. It is
 * the only authority on that: a pane's foreground process group reports the shell as
 * ready milliseconds after a split, while herdr still declines for a second or so.
 * So the refusal is transient and worth retrying, never a reason to fail a chunk.
 */
export function isPaneBusy(error: unknown): boolean {
  return error instanceof HerdrError && error.code === 'agent_pane_busy';
}

export function insideHerdr(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HERDR_ENV === '1';
}

export function callerPaneId(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.HERDR_PANE_ID || null;
}

async function run(
  args: string[],
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const child = spawn('herdr', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  const abort = () => child.kill('SIGTERM');
  signal?.addEventListener('abort', abort, { once: true });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('close', resolve);
    child.on('error', (error) => {
      stderr += String(error);
      resolve(null);
    });
  });
  signal?.removeEventListener('abort', abort);

  if (exitCode !== 0) throw new HerdrError(args, exitCode, stderr || stdout);

  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const result = (response: Record<string, unknown>): Record<string, unknown> =>
  (response.result as Record<string, unknown>) ?? {};

export interface SplitOptions {
  /** Pane to split. Splitting produces a sibling of this pane. */
  pane: string;
  direction: 'right' | 'down';
  cwd: string;
  /** Share retained by `pane`; the new pane takes the remainder. */
  ratio?: number;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

/** Returns the new pane's id. */
export async function splitPane(options: SplitOptions): Promise<string> {
  const args = [
    'pane',
    'split',
    '--pane',
    options.pane,
    '--direction',
    options.direction,
    '--cwd',
    options.cwd,
    '--no-focus',
  ];
  if (options.ratio !== undefined) args.push('--ratio', String(options.ratio));
  for (const [key, value] of Object.entries(options.env ?? {})) {
    args.push('--env', `${key}=${value}`);
  }

  const pane = result(await run(args, options.signal)).pane as
    | { pane_id?: string }
    | undefined;
  if (!pane?.pane_id) {
    throw new Error('herdr pane split returned no pane id');
  }
  return pane.pane_id;
}

// `pane rename` and `pane close` take the id positionally — unlike `pane split`,
// they have no `--pane` flag, and passing one is read as the id itself.
export async function renamePane(
  pane: string,
  name: string,
  signal?: AbortSignal,
): Promise<void> {
  await run(['pane', 'rename', pane, name], signal);
}

export async function closePane(
  pane: string,
  signal?: AbortSignal,
): Promise<void> {
  await run(['pane', 'close', pane], signal);
}

export interface StartAgentOptions {
  name: string;
  pane: string;
  /** Native args handed to `pi` itself, after herdr's `--`. */
  agentArgs: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Returns once herdr has detected pi in the pane and considers it ready for
 * input, so the first prompt cannot race the agent's startup.
 */
export async function startAgent(options: StartAgentOptions): Promise<void> {
  const args = [
    'agent',
    'start',
    options.name,
    '--kind',
    'pi',
    '--pane',
    options.pane,
  ];
  if (options.timeoutMs) args.push('--timeout', String(options.timeoutMs));
  await run([...args, '--', ...options.agentArgs], options.signal);
}

/**
 * The pane a named agent currently occupies, or null if no such agent is live.
 * Agent names are derived from the slug, so this — not a stored pane id — is the
 * authority on where a role's agent is: herdr reassigns pane ids when a pane moves,
 * and a crashed workflow's notes about its own layout are worth nothing.
 */
export async function agentPane(
  name: string,
  signal?: AbortSignal,
): Promise<string | null> {
  let response: Record<string, unknown>;
  try {
    response = await run(['agent', 'get', name], signal);
  } catch {
    return null;
  }

  const payload = result(response);
  const agent = (payload.agent ?? payload) as { pane_id?: unknown };
  return typeof agent.pane_id === 'string' ? agent.pane_id : null;
}

function statusOf(response: Record<string, unknown>): AgentStatus {
  const payload = result(response);
  const agent = (payload.agent ?? payload) as { status?: unknown };
  const status = agent.status ?? payload.status;
  const known: AgentStatus[] = ['idle', 'working', 'blocked', 'done', 'unknown'];
  return known.includes(status as AgentStatus)
    ? (status as AgentStatus)
    : 'unknown';
}

export interface PromptOptions {
  name: string;
  text: string;
  waitTimeoutMs: number;
  signal?: AbortSignal;
}

/**
 * Submits text plus Enter atomically, then waits for the first settled state —
 * `idle`, `done`, or `blocked` — which is where the loop decides whether the turn
 * finished or the agent is asking for something.
 */
export async function promptAgent(
  options: PromptOptions,
): Promise<AgentStatus> {
  const response = await run(
    [
      'agent',
      'prompt',
      options.name,
      options.text,
      '--wait',
      '--timeout',
      String(options.waitTimeoutMs),
    ],
    options.signal,
  );
  return statusOf(response);
}

export async function waitForAgent(
  name: string,
  timeoutMs: number,
  until?: AgentStatus[],
  signal?: AbortSignal,
): Promise<AgentStatus> {
  const args = ['agent', 'wait', name, '--timeout', String(timeoutMs)];
  for (const state of until ?? []) args.push('--until', state);
  return statusOf(await run(args, signal));
}
