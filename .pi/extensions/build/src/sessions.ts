/**
 * Interactive agents own their terminals, so token usage can no longer be read
 * off a JSON event stream. It comes from the session file pi writes instead —
 * the same numbers `/session` shows.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** `~/.pi/agent/sessions/--<cwd with slashes replaced>--/` */
export function sessionsDir(cwd: string, home = homedir()): string {
  return join(home, '.pi', 'agent', 'sessions', `-${cwd.replace(/\//g, '-')}-`);
}

function sessionFile(cwd: string, sessionId: string): string | null {
  const dir = sessionsDir(cwd);
  if (!existsSync(dir)) return null;

  // Files are `<timestamp>_<id>.jsonl`; the newest wins if an id ever repeats.
  const matches = readdirSync(dir)
    .filter((name) => name.endsWith(`_${sessionId}.jsonl`))
    .sort();
  const newest = matches.at(-1);
  return newest ? join(dir, newest) : null;
}

/**
 * The high-water mark of `totalTokens` across assistant messages. Context grows
 * monotonically within a session, so the largest observed total is the closest
 * thing to "how full is this agent's window right now".
 */
export function maxTotalTokens(jsonl: string): number {
  let max = 0;
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let entry: {
      message?: { usage?: { totalTokens?: unknown } };
    };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const total = entry.message?.usage?.totalTokens;
    if (typeof total === 'number' && total > max) max = total;
  }
  return max;
}

/** 0 when the session has no readable usage yet — never a reason to reseed. */
export function sessionTokens(cwd: string, sessionId: string): number {
  const path = sessionFile(cwd, sessionId);
  if (!path) return 0;
  try {
    return maxTotalTokens(readFileSync(path, 'utf-8'));
  } catch {
    return 0;
  }
}
