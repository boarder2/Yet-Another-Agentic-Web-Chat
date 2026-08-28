import { describe, it, expect } from 'vitest';
import {
  parseStreamEvent,
  normalizeStreamEvent,
  isAgentControlEvent,
  type StreamEvent,
} from './events';

describe('parseStreamEvent', () => {
  it('parses a well-formed wire line into a typed event', () => {
    const ev = parseStreamEvent(
      JSON.stringify({ type: 'response', data: 'hi', messageId: 'm1' }),
    );
    expect(ev).toEqual({ type: 'response', data: 'hi', messageId: 'm1' });
  });

  it('round-trips an event through stringify → parse unchanged', () => {
    const original: StreamEvent = {
      type: 'tool_call_success',
      data: { toolCallId: 't1', status: 'success', extra: { videoId: 'v' } },
      messageId: 'm1',
    };
    expect(parseStreamEvent(JSON.stringify(original))).toEqual(original);
  });

  it('returns unknown for malformed JSON', () => {
    expect(parseStreamEvent('{not json')).toEqual({
      type: 'unknown',
      raw: '{not json',
    });
  });

  it('returns unknown for an object with no type', () => {
    expect(parseStreamEvent(JSON.stringify({ foo: 1 }))).toMatchObject({
      type: 'unknown',
    });
  });
});

describe('normalizeStreamEvent', () => {
  it.each([
    ['user_question_pending', 'ask_user_pending'],
    ['user_question_answered', 'ask_user_answered'],
    ['workspace_edit_approval_pending', 'workspace_edit_pending'],
    ['workspace_edit_approval_answered', 'workspace_edit_answered'],
    ['skill_edit_approval_pending', 'skill_edit_pending'],
    ['skill_edit_approval_answered', 'skill_edit_answered'],
  ])('maps legacy %s → %s', (legacy, canonical) => {
    const out = normalizeStreamEvent({
      type: legacy,
      data: { approvalId: 'a' },
    });
    expect(out.type).toBe(canonical);
    expect((out as { data: unknown }).data).toEqual({ approvalId: 'a' });
  });

  it('passes canonical types through untouched', () => {
    const input = { type: 'ask_user_pending', data: { approvalId: 'a' } };
    expect(normalizeStreamEvent(input)).toEqual(input);
  });

  it('returns unknown for a non-object', () => {
    expect(normalizeStreamEvent(null)).toEqual({ type: 'unknown', raw: null });
  });
});

describe('isAgentControlEvent', () => {
  it('flags control events', () => {
    for (const type of [
      'model_stats',
      'interrupt',
      'agent_end',
      'agent_error',
    ]) {
      expect(isAgentControlEvent({ type })).toBe(true);
    }
  });

  it('does not flag wire-bound events', () => {
    for (const type of [
      'response',
      'sources',
      'tool_call_started',
      'chart_spec',
      'chart_placement',
      'panel_executor_chart',
      'map_spec',
      'map_placement',
      'map_session_overlay',
    ]) {
      expect(isAgentControlEvent({ type })).toBe(false);
    }
  });
});

describe('structured map events', () => {
  const spec = {
    places: [
      {
        id: 'node/1',
        name: 'Central Cafe',
        coordinate: { lat: 40, lon: -75 },
        sourceUrl: 'https://www.openstreetmap.org/node/1',
        provider: 'openstreetmap',
        attribution: '© OpenStreetMap contributors',
      },
    ],
    attribution: '© OpenStreetMap contributors',
    retrievedAt: '2026-08-27T12:00:00.000Z',
    title: 'Nearby places',
  };

  it('round-trips map registration, placement, and live-only overlay events', () => {
    const events: StreamEvent[] = [
      {
        type: 'map_spec',
        messageId: 'm1',
        data: {
          mapId: 'private-map-1',
          handle: 'map_1',
          spec,
          source: 'mapping-tool',
        },
      },
      {
        type: 'map_placement',
        messageId: 'm1',
        data: {
          placementId: 'map_placement_1',
          mapId: 'private-map-1',
          handle: 'map_1',
          placementNumber: 1,
        },
      },
      {
        type: 'map_session_overlay',
        messageId: 'm1',
        data: {
          mapId: 'private-map-1',
          origin: { lat: 40.1, lon: -75.1 },
          clientSessionId: 'page-session-1',
          expiresAt: '2026-08-27T12:10:00.000Z',
        },
      },
    ];

    for (const event of events) {
      expect(parseStreamEvent(JSON.stringify(event))).toEqual(event);
    }
  });

  it('keeps map event payloads structured instead of accepting markup', () => {
    const event = normalizeStreamEvent({
      type: 'map_placement',
      data: {
        placementId: 'map_placement_1',
        mapId: 'private-map-1',
        handle: 'map_1',
      },
    });

    expect(event).toEqual({
      type: 'map_placement',
      data: {
        placementId: 'map_placement_1',
        mapId: 'private-map-1',
        handle: 'map_1',
      },
    });
    expect(JSON.stringify(event)).not.toContain('```yaawc:');
  });
});

describe('structured chart events', () => {
  const spec = {
    type: 'line',
    title: 'Trend',
    data: [{ label: 'A', series_1: 1 }],
    series: [{ key: 'series_1', label: 'Value' }],
    xKey: 'label',
  } as never;

  it('round-trips registration and placement events through the wire codec', () => {
    const events: StreamEvent[] = [
      {
        type: 'chart_spec',
        messageId: 'm1',
        data: {
          chartId: 'private-1',
          handle: 'chart_1',
          spec,
          source: 'tool',
        },
      },
      {
        type: 'chart_placement',
        messageId: 'm1',
        data: {
          placementId: 'placement_1',
          chartId: 'private-1',
          handle: 'chart_1',
          placementNumber: 1,
        },
      },
      {
        type: 'panel_executor_chart',
        messageId: 'm1',
        executorIdx: 2,
        data: {
          placementId: 'panel_2_placement_1',
          chartId: 'panel_2_private-1',
          handle: 'chart_1',
        },
      },
    ];

    for (const event of events) {
      expect(parseStreamEvent(JSON.stringify(event))).toEqual(event);
    }
  });

  it('keeps panel chart forwarding structured and separate from top-level placement', () => {
    const event = normalizeStreamEvent({
      type: 'panel_executor_chart',
      executorIdx: 1,
      data: {
        placementId: 'panel_1_placement_1',
        chartId: 'panel_1_private-1',
      },
    });

    expect(event).toEqual({
      type: 'panel_executor_chart',
      executorIdx: 1,
      data: {
        placementId: 'panel_1_placement_1',
        chartId: 'panel_1_private-1',
      },
    });
    expect(event.type).not.toBe('chart_placement');
  });
});
