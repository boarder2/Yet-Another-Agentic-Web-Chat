import { describe, expect, it } from 'vitest';
import { initialChatStreamState, reduceStreamEvent } from './reducer';

const pendingEvent = {
  type: 'location_pending' as const,
  messageId: 'assistant-1',
  data: {
    approvalId: 'approval-1',
    toolCallId: 'request-location-1',
    reason: 'Find nearby places',
    authorizedPurposes: ['nearby', 'routing', 'tiles'],
    authorizedHosts: ['maps.example.test', 'tiles.example.test'],
    providerHosts: ['maps.example.test'],
    tileHosts: ['tiles.example.test'],
    configHash: 'config-hash',
    clientSessionId: 'page-1',
    aiMessageId: 'assistant-1',
    allowSave: true,
    createdAt: 1_000,
    expiresAt: 601_000,
    coordinates: { lat: 40.1234, lon: -75.5678 },
    locationToken: 'secret-token',
  },
};

function started() {
  return reduceStreamEvent(initialChatStreamState(), {
    type: 'stream_started',
    mode: 'live',
    chatId: 'chat-1',
    aiMessageId: 'assistant-1',
  }).state;
}

describe('stream reducer location approvals', () => {
  it('adds one coordinate-free pending approval and deduplicates replayed pending events', () => {
    const first = reduceStreamEvent(started(), pendingEvent);
    const second = reduceStreamEvent(first.state, pendingEvent);

    expect(first.state.pendingLocationApprovals['assistant-1']).toEqual([
      expect.objectContaining({
        approvalId: 'approval-1',
        status: 'pending',
        authorizedHosts: ['maps.example.test', 'tiles.example.test'],
      }),
    ]);
    expect(JSON.stringify(first.state.pendingLocationApprovals)).not.toContain(
      '40.1234',
    );
    expect(first.effects).toContainEqual({ kind: 'bumpScroll' });
    expect(second.state.pendingLocationApprovals['assistant-1']).toHaveLength(
      1,
    );
    expect(second.effects).toEqual([]);
  });

  it('records approved and denied choices without accepting precise payload fields', () => {
    let state = reduceStreamEvent(started(), pendingEvent).state;
    state = reduceStreamEvent(state, {
      type: 'location_answered',
      data: {
        approvalId: 'approval-1',
        response: {
          approved: true,
          retention: 'save',
        },
      },
    }).state;
    expect(state.pendingLocationApprovals['assistant-1'][0]).toMatchObject({
      status: 'approved',
      retention: 'save',
    });
    expect(JSON.stringify(state)).not.toContain('40');

    state = reduceStreamEvent(state, {
      type: 'location_answered',
      data: {
        approvalId: 'approval-1',
        response: {
          approved: false,
          retention: 'once',
          reason: 'permission_denied',
          locationToken: 'secret-token',
        },
      },
    }).state;
    // The strict response schema rejects the forged second answer, so the
    // approved state remains unchanged.
    expect(state.pendingLocationApprovals['assistant-1'][0].status).toBe(
      'approved',
    );
  });

  it('marks location approvals expired or cancelled through lifecycle events', () => {
    let state = reduceStreamEvent(started(), pendingEvent).state;
    state = reduceStreamEvent(state, {
      type: 'location_stale',
      data: { approvalId: 'approval-1', reason: 'Location approval expired.' },
    }).state;
    expect(state.pendingLocationApprovals['assistant-1'][0].status).toBe(
      'expired',
    );

    state = reduceStreamEvent(state, {
      type: 'location_cancelled',
      data: { approvalId: 'approval-1' },
    }).state;
    expect(state.pendingLocationApprovals['assistant-1'][0].status).toBe(
      'cancelled',
    );
  });
});
