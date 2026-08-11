import { describe, it, expect } from 'vitest';
import {
  agentEnvironment,
  agentName,
  agentToolAllowlist,
  anchorFor,
  type Crew,
} from './panes.ts';
import {
  BUILD_ROLE_ENV,
  COMPLETION_TOOL,
  RESULT_FILE_ENV,
  VERDICT_TOOL,
} from './verdict.ts';

const pane = (paneId: string, agent: string) => ({ paneId, agent });
const DRIVER = 'w1:p1';

describe('agent reporting contract', () => {
  it('puts the explicit role and result channel in a new agent pane', () => {
    expect(agentEnvironment('tester', '/tmp/tester-result.json')).toEqual({
      [BUILD_ROLE_ENV]: 'tester',
      [RESULT_FILE_ENV]: '/tmp/tester-result.json',
    });
  });

  it('adds only the role’s reporting tool to a configured allowlist', () => {
    expect(agentToolAllowlist('coder', ['read', 'edit', COMPLETION_TOOL])).toEqual(
      ['read', 'edit', COMPLETION_TOOL],
    );
    expect(agentToolAllowlist('reviewer', ['read', 'bash'])).toEqual([
      'read',
      'bash',
      VERDICT_TOOL,
    ]);
  });

  it('leaves the default tool set unrestricted when no allowlist is configured', () => {
    expect(agentToolAllowlist('coder', undefined)).toBeUndefined();
  });
});

describe('anchorFor', () => {
  it('opens the right column off the driver, leaving it the left third', () => {
    expect(anchorFor('coder', {}, DRIVER)).toEqual({
      paneId: DRIVER,
      direction: 'right',
      ratio: 1 / 3,
    });
  });

  it('cuts the column into thirds as the crew is built in order', () => {
    const withCoder: Crew = { coder: pane('w1:p2', 'coder-x') };
    expect(anchorFor('tester', withCoder, DRIVER)).toEqual({
      paneId: 'w1:p2',
      direction: 'down',
      ratio: 1 / 3,
    });

    const withTester: Crew = { ...withCoder, tester: pane('w1:p3', 'tester-x') };
    expect(anchorFor('reviewer', withTester, DRIVER)).toEqual({
      paneId: 'w1:p3',
      direction: 'down',
      ratio: 0.5,
    });
  });

  // Splitting the driver a second time is what shrank the user's own pane to a
  // quarter of the screen when a half-built crew was retried.
  it('never splits the driver again while a crew pane survives', () => {
    const crews: Crew[] = [
      { tester: pane('w1:p3', 'tester-x') },
      { reviewer: pane('w1:p4', 'reviewer-x') },
      { coder: pane('w1:p2', 'coder-x'), reviewer: pane('w1:p4', 'reviewer-x') },
    ];

    for (const crew of crews) {
      for (const role of ['coder', 'tester', 'reviewer'] as const) {
        const anchor = anchorFor(role, crew, DRIVER);
        expect(anchor?.paneId, `${role} of ${JSON.stringify(crew)}`).not.toBe(
          DRIVER,
        );
        expect(anchor?.direction).toBe('down');
      }
    }
  });

  it('rebuilds a lost pane by halving the last surviving crew pane', () => {
    const crew: Crew = {
      coder: pane('w1:p2', 'coder-x'),
      tester: pane('w1:p3', 'tester-x'),
      reviewer: pane('w1:p4', 'reviewer-x'),
    };
    expect(anchorFor('reviewer', { ...crew, reviewer: undefined }, DRIVER)).toEqual(
      { paneId: 'w1:p3', direction: 'down', ratio: 0.5 },
    );
  });

  it('has nowhere to split when the crew is gone and there is no driver pane', () => {
    expect(anchorFor('coder', {}, null)).toBeNull();
  });
});

// herdr rejects names outside [a-z][a-z0-9_-]{0,31}, so a long or odd slug must be
// coerced rather than passed through and failing at agent start.
describe('agentName', () => {
  it('names the role first, so the sidebar reads as the crew', () => {
    expect(agentName('add-widget-cache', 'coder')).toBe(
      'coder-add-widget-cache',
    );
  });

  it('stays within herdr’s 32-character limit', () => {
    const name = agentName(
      'a-very-long-slug-that-keeps-going-and-going',
      'reviewer',
    );
    expect(name.length).toBeLessThanOrEqual(32);
    expect(name.startsWith('reviewer-')).toBe(true);
  });

  it('matches herdr’s name grammar for every role', () => {
    for (const role of ['coder', 'tester', 'reviewer'] as const) {
      expect(agentName('Fix HTTP/2 Bug!', role)).toMatch(
        /^[a-z][a-z0-9_-]{0,31}$/,
      );
    }
  });
});
