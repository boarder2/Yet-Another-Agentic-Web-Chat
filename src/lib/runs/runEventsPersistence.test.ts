import { describe, expect, it } from 'vitest';
import { isMilestoneEvent } from './runEventsPersistence';

describe('run-event milestones', () => {
  it('persists cumulative stats snapshots for resume reconstruction', () => {
    expect(isMilestoneEvent('stats')).toBe(true);
  });

  it('persists chart registrations and both placement families for reconstruction', () => {
    expect(isMilestoneEvent('chart_spec')).toBe(true);
    expect(isMilestoneEvent('chart_placement')).toBe(true);
    expect(isMilestoneEvent('panel_executor_chart')).toBe(true);
  });

  it('does not persist response token deltas as chart milestones', () => {
    expect(isMilestoneEvent('response')).toBe(false);
    expect(isMilestoneEvent('panel_executor_data')).toBe(false);
    expect(isMilestoneEvent(undefined)).toBe(false);
  });
});
