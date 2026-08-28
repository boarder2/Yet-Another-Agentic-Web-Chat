import { describe, expect, it } from 'vitest';
import {
  isMilestoneEvent,
  locationEventForPersistence,
} from './runEventsPersistence';
import type { StreamEvent } from '@/lib/streaming/events';

const locationPayload = {
  authorizedPurposes: ['nearby', 'routing', 'tiles'],
  authorizedHosts: ['maps.example.test', 'tiles.example.test'],
  providerHosts: ['maps.example.test'],
  tileHosts: ['tiles.example.test'],
  configHash: 'config-hash',
  clientSessionId: 'page-1',
  aiMessageId: 'assistant-1',
  allowSave: true,
  createdAt: 1_000,
  expiresAt: 1_000 + 10 * 60 * 1000,
};

describe('location approval event persistence', () => {
  it('persists coordinate-free pending metadata and strips unexpected precise fields', () => {
    const event = {
      type: 'location_pending',
      messageId: 'assistant-1',
      data: {
        approvalId: 'approval-1',
        toolCallId: 'tool-1',
        ...locationPayload,
        coordinates: { lat: 40.1234, lon: -75.5678 },
        locationToken: 'secret-token',
      },
    } as unknown as StreamEvent;

    const persisted = locationEventForPersistence(event);

    expect(persisted).toMatchObject({
      type: 'location_pending',
      data: {
        approvalId: 'approval-1',
        toolCallId: 'tool-1',
        clientSessionId: 'page-1',
      },
    });
    expect(JSON.stringify(persisted)).not.toContain('40.1234');
    expect(JSON.stringify(persisted)).not.toContain('secret-token');
    expect(isMilestoneEvent('location_pending')).toBe(true);
  });

  it('stores only opaque approval choices, never tokens or coordinates', () => {
    expect(
      locationEventForPersistence({
        type: 'location_answered',
        messageId: 'assistant-1',
        data: {
          approvalId: 'approval-1',
          response: {
            approved: true,
            retention: 'save',
            locationToken: 'secret-token',
          },
        },
      } as unknown as StreamEvent),
    ).toBeNull();

    const denied = locationEventForPersistence({
      type: 'location_answered',
      messageId: 'assistant-1',
      data: {
        approvalId: 'approval-1',
        response: {
          approved: false,
          retention: 'once',
          reason: 'permission_denied',
          clientSessionId: 'page-1',
        },
      },
    } as unknown as StreamEvent);

    expect(denied).toEqual({
      type: 'location_answered',
      messageId: 'assistant-1',
      data: {
        approvalId: 'approval-1',
        response: {
          approved: false,
          retention: 'once',
          reason: 'permission_denied',
        },
      },
    });
    expect(JSON.stringify(denied)).not.toContain('page-1');
  });

  it('keeps stale and cancelled lifecycle events bounded and coordinate-free', () => {
    expect(
      locationEventForPersistence({
        type: 'location_stale',
        data: {
          approvalId: 'approval-1',
          reason: 'Location approval expired.',
        },
      } as unknown as StreamEvent),
    ).toEqual({
      type: 'location_stale',
      data: { approvalId: 'approval-1', reason: 'Location approval expired.' },
    });
    expect(
      locationEventForPersistence({
        type: 'location_cancelled',
        data: {
          approvalId: 'approval-1',
          coordinates: { lat: 40, lon: -75 },
        },
      } as unknown as StreamEvent),
    ).toEqual({
      type: 'location_cancelled',
      data: { approvalId: 'approval-1' },
    });
    expect(
      locationEventForPersistence({
        type: 'location_stale',
        data: { approvalId: 'approval-1', reason: 'x'.repeat(241) },
      } as unknown as StreamEvent),
    ).toBeNull();
  });
});
