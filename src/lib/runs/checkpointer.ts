import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { sqlite } from '@/lib/db';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';

declare global {
  var __langgraphCheckpointer: SqliteSaver | undefined;
}

function getCheckpointer(): SqliteSaver {
  if (!globalThis.__langgraphCheckpointer) {
    globalThis.__langgraphCheckpointer = new SqliteSaver(sqlite);
  }
  return globalThis.__langgraphCheckpointer;
}

export function getLanggraphCheckpointer(): BaseCheckpointSaver {
  return getCheckpointer();
}

export function initLanggraphCheckpointer(): void {
  const cp = getCheckpointer();
  // setup() is synchronous in this package version
  (cp as unknown as { setup(): void }).setup();
}

export async function deleteCheckpoint(threadId: string): Promise<void> {
  const cp = getCheckpointer();
  await cp.deleteThread(threadId);
}

export async function checkpointExists(threadId: string): Promise<boolean> {
  const cp = getCheckpointer();
  const tuple = await cp.getTuple({
    configurable: { thread_id: threadId },
  });
  return tuple !== undefined;
}
