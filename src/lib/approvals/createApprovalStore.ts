/**
 * Generic pending-approval store. Backs the sandbox (code-execution),
 * skill-edit, and workspace-edit approval flows, which all share the same
 * lifecycle: a request parks a Promise in a process-global Map keyed by an id,
 * an out-of-band HTTP call later resolves it, and disconnect/cleanup paths
 * settle any orphans with a default "denied/timed-out" value.
 *
 * The only things that differ between the three are the resolution payload
 * shape, the default timeout, the global key, and the warning label — all
 * passed in here so there is a single implementation to maintain.
 */

type PendingEntry<T> = {
  resolve: (result: T) => void;
  timeout: NodeJS.Timeout;
  messageId?: string;
  createdAt: number;
};

export interface ApprovalStore<T> {
  /** Park a promise until resolved, cancelled, or timed out. */
  waitFor(id: string, timeoutMs?: number, messageId?: string): Promise<T>;
  /** Resolve a parked promise; returns false if the id is unknown. */
  resolve(id: string, result: T): boolean;
  /** Settle every entry tied to a messageId with the timed-out value. */
  cancelForMessage(messageId: string): void;
  /** Settle every entry with the timed-out value (e.g. on shutdown). */
  cleanupAll(): void;
}

export function createApprovalStore<T>(opts: {
  /** globalThis key under which the Map is stashed (survives HMR). */
  globalKey: string;
  defaultTimeoutMs: number;
  /** Value used to resolve on timeout / cancellation / cleanup. */
  timedOutValue: T;
  /** Human label used in the orphan-warning message. */
  label: string;
}): ApprovalStore<T> {
  const store = globalThis as typeof globalThis &
    Record<string, Map<string, PendingEntry<T>> | undefined>;

  const pending: Map<string, PendingEntry<T>> = (store[opts.globalKey] as
    | Map<string, PendingEntry<T>>
    | undefined) ??
  (store[opts.globalKey] = new Map<string, PendingEntry<T>>());

  return {
    waitFor(id, timeoutMs = opts.defaultTimeoutMs, messageId) {
      return new Promise<T>((resolve) => {
        if (pending.size > 100) {
          console.warn(
            `${opts.label} approval map has ${pending.size} live entries; check for orphaned approvals.`,
          );
        }

        const timeout = setTimeout(() => {
          pending.delete(id);
          resolve(opts.timedOutValue);
        }, timeoutMs);

        pending.set(id, {
          resolve,
          timeout,
          messageId,
          createdAt: Date.now(),
        });
      });
    },

    resolve(id, result) {
      const entry = pending.get(id);
      if (!entry) return false;
      clearTimeout(entry.timeout);
      pending.delete(id);
      entry.resolve(result);
      return true;
    },

    cancelForMessage(messageId) {
      for (const [id, entry] of pending) {
        if (entry.messageId === messageId) {
          clearTimeout(entry.timeout);
          pending.delete(id);
          entry.resolve(opts.timedOutValue);
        }
      }
    },

    cleanupAll() {
      for (const [id, entry] of pending) {
        clearTimeout(entry.timeout);
        entry.resolve(opts.timedOutValue);
        pending.delete(id);
      }
    },
  };
}
