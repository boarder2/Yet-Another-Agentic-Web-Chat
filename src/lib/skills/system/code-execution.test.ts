import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ autoRun: false }));

vi.mock('@/lib/config', () => ({
  getCodeExecutionConfig: vi.fn(() => ({
    enabled: true,
    timeoutSeconds: 30,
    memoryMb: 128,
    maxOutputChars: 50_000,
  })),
}));
vi.mock('@/lib/settings/server', () => ({
  getCodeExecutionAutoRun: vi.fn(() => state.autoRun),
}));

import { buildCodeExecutionSkill } from './code-execution';

describe('code-execution system skill approval guidance', () => {
  beforeEach(() => {
    state.autoRun = false;
  });

  it('describes approval and denial feedback in manual mode', () => {
    const content = buildCodeExecutionSkill()!.content;
    expect(content).toContain('approval **before** it runs');
    expect(content).toContain('Treat denial as feedback');
    expect(content).not.toContain('Automatic execution is enabled');
  });

  it('describes immediate visible execution without encouraging extra calls in auto mode', () => {
    state.autoRun = true;
    const content = buildCodeExecutionSkill()!.content;
    expect(content).toContain('Automatic execution is enabled');
    expect(content).toContain('without a per-call approval prompt');
    expect(content).toContain('code and result remain visible');
    expect(content).not.toContain('firing many tiny calls');
  });
});
