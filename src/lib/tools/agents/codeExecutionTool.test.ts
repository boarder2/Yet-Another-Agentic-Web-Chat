import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  autoRun: false,
  dockerAvailable: true,
  config: {
    enabled: true,
    dockerImage: 'node:22-alpine',
    timeoutSeconds: 30,
    memoryMb: 128,
  },
  order: [] as string[],
  interruptResponse: { approved: true } as unknown,
}));

vi.mock('@/lib/tools/defineTool', () => ({
  defineTool: (handler: unknown) => handler,
}));
vi.mock('@/lib/config', () => ({
  getCodeExecutionConfig: vi.fn(() => {
    mocks.order.push('config');
    return mocks.config;
  }),
}));
vi.mock('@/lib/settings/server', () => ({
  getCodeExecutionAutoRun: vi.fn(() => {
    mocks.order.push('setting');
    return mocks.autoRun;
  }),
}));
vi.mock('@langchain/langgraph', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@langchain/langgraph')>();
  return {
    ...actual,
    interrupt: vi.fn(() => {
      mocks.order.push('interrupt');
      return mocks.interruptResponse;
    }),
  };
});
vi.mock('@/lib/sandbox/dockerExecutor', () => ({
  checkDockerAvailable: vi.fn(async () => {
    mocks.order.push('docker');
    return mocks.dockerAvailable;
  }),
  ensureImage: vi.fn(async () => {
    mocks.order.push('image');
  }),
  executeCode: vi.fn(async () => {
    mocks.order.push('execute');
    return {
      stdout: '42\n',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      oomKilled: false,
      privateRecords: [],
      privateRecordErrors: [],
    };
  }),
}));
vi.mock('@/lib/streaming/events', () => ({ emitStreamEvent: vi.fn() }));
vi.mock('./codeExecutionCharts', () => ({
  createCodeChartChannel: () => ({ prefix: 'private' }),
  injectChartHelper: (code: string) => code,
  registerCodeExecutionCharts: () => ({ handles: [], titles: [], errors: [] }),
  describeCodeChartOutcome: () => '',
}));

import { interrupt } from '@langchain/langgraph';
import { emitStreamEvent } from '@/lib/streaming/events';
import { codeExecutionTool } from './codeExecutionTool';

const input = { code: 'console.log(6 * 7)', description: 'Compute answer' };
const emitter = vi.fn();
const persist = vi.fn(async () => undefined);

async function invoke(overrides: Record<string, unknown> = {}) {
  const handler = codeExecutionTool as unknown as (
    toolInput: typeof input,
    runtime: Record<string, unknown>,
  ) => Promise<unknown>;
  return handler(input, {
    context: { interactiveSession: true, emitter },
    toolCallId: 'call-1',
    persist,
    ...overrides,
  });
}

describe('codeExecutionTool approval modes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.autoRun = false;
    mocks.dockerAvailable = true;
    mocks.config.enabled = true;
    mocks.interruptResponse = { approved: true };
    mocks.order = [];
  });

  it('keeps config and Docker preflight before reading the mode or approving', async () => {
    await invoke();
    expect(mocks.order).toEqual([
      'config',
      'docker',
      'setting',
      'interrupt',
      'image',
      'execute',
    ]);
  });

  it('does not read the setting or interrupt when Docker is unavailable', async () => {
    mocks.dockerAvailable = false;
    await invoke();
    expect(mocks.order).toEqual(['config', 'docker']);
    expect(persist).not.toHaveBeenCalled();
  });

  it('preserves manual denial and never prepares or executes code', async () => {
    mocks.interruptResponse = { approved: false, reason: 'Not needed' };
    const result = await invoke();
    expect(mocks.order).toEqual(['config', 'docker', 'setting', 'interrupt']);
    expect(emitStreamEvent).toHaveBeenCalledWith(emitter, {
      type: 'code_execution_result',
      data: { denied: true, denyReason: 'Not needed', toolCallId: 'call-1' },
    });
    expect(JSON.stringify(result)).toContain('Not needed');
    expect(persist).not.toHaveBeenCalled();
  });

  it('bypasses interrupt in auto mode while executing, emitting, and persisting the result', async () => {
    mocks.autoRun = true;
    await invoke();
    expect(interrupt).not.toHaveBeenCalled();
    expect(mocks.order).toEqual([
      'config',
      'docker',
      'setting',
      'image',
      'execute',
    ]);
    expect(emitStreamEvent).toHaveBeenCalledWith(
      emitter,
      expect.objectContaining({
        type: 'code_execution_result',
        data: expect.objectContaining({ stdout: '42\n', toolCallId: 'call-1' }),
      }),
    );
    expect(persist).toHaveBeenCalledWith({
      kind: 'code_execution',
      body: expect.stringContaining(
        'Code:\nconsole.log(6 * 7)\n\nResult:\nExit code: 0\n\nStdout:\n42',
      ),
      metadataExtras: { language: 'javascript' },
    });
  });
});
