import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { evictByChatId, startRun } from './runHub';
import {
  closeSteers,
  drainSteers,
  enqueueSteer,
  removeSteer,
  takeSteers,
} from './steering';

const CLOCK = { now: '2026-10-03T12:00:00Z', timeZone: 'UTC' };
const chats: string[] = [];

function makeRun(steerable = true) {
  const chatId = randomUUID();
  chats.push(chatId);
  return startRun({
    chatId,
    messageId: randomUUID(),
    aiMessageId: randomUUID(),
    threadId: 't',
    emitter: new EventEmitter(),
    abortController: new AbortController(),
    retrievalController: new AbortController(),
    followup: steerable ? async () => 'unused' : undefined,
  }).run;
}

afterEach(() => {
  for (const id of chats.splice(0)) evictByChatId(id);
});

describe('steering queue', () => {
  it('delivers queued steers once, in order, and announces them', () => {
    const run = makeRun();
    const a = enqueueSteer(run, 'first', CLOCK)!;
    enqueueSteer(run, 'second', CLOCK);
    expect(removeSteer(run, a.id)).toBe(true);
    expect(drainSteers(run.messageId).map((s) => s.content)).toEqual([
      'second',
    ]);
    expect(drainSteers(run.messageId)).toEqual([]);
    expect(removeSteer(run, a.id)).toBe(false);
    expect(run.eventLog.map((e) => e.ev.type)).toEqual([
      'steer_queued',
      'steer_queued',
      'steer_removed',
    ]);
  });

  it('rejects steers on panel runs and once closed', () => {
    expect(enqueueSteer(makeRun(false), 'x', CLOCK)).toBeNull();
    const run = makeRun();
    enqueueSteer(run, 'late', CLOCK);
    closeSteers(run);
    expect(enqueueSteer(run, 'later', CLOCK)).toBeNull();
    expect(drainSteers(run.messageId)).toEqual([]);
  });

  it('keeps closed steers removable until the follow-up takes them', () => {
    const run = makeRun();
    const withdrawn = enqueueSteer(run, 'withdrawn', CLOCK)!;
    const kept = enqueueSteer(run, 'kept', CLOCK)!;
    closeSteers(run);
    expect(removeSteer(run, withdrawn.id)).toBe(true);
    expect(takeSteers(run).map((s) => s.content)).toEqual(['kept']);
    expect(removeSteer(run, kept.id)).toBe(false);
  });

  it('rejects steers once the follow-up has taken the queue', () => {
    const run = makeRun();
    enqueueSteer(run, 'joins the follow-up', CLOCK);
    expect(takeSteers(run)).toHaveLength(1);
    expect(enqueueSteer(run, 'too late', CLOCK)).toBeNull();
  });
});
