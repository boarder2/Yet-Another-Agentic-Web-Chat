import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import buildWorkflow from './index.ts';
import { findBuild, saveBuild } from './store.ts';
import { createState, type BuildState } from './state.ts';

const BASE_TOOLS = ['read', 'edit', 'write'];
const WORKFLOW_TOOLS = [
  'workflow_triage',
  'workflow_end_grilling',
  'workflow_write_plan',
  'workflow_run_chunk',
  'workflow_run_review',
  'workflow_close',
];
const NOW = new Date('2026-08-09T12:00:00.000Z');
const roots: string[] = [];
const previousHerdrEnv = process.env.HERDR_ENV;

interface RegisteredTool {
  name: string;
  execute: (
    id: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: ExtensionContext,
  ) => Promise<unknown>;
}

interface RegisteredCommand {
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

class FakePi {
  private activeTools = [...BASE_TOOLS];
  readonly handlers = new Map<string, Array<(...args: never[]) => unknown>>();
  readonly tools = new Map<string, RegisteredTool>();
  readonly commands = new Map<string, RegisteredCommand>();

  on(event: string, handler: (...args: never[]) => unknown): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
  }

  registerTool(tool: RegisteredTool): void {
    this.tools.set(tool.name, tool);
    this.activeTools = [...this.activeTools, tool.name];
  }

  registerCommand(name: string, command: RegisteredCommand): void {
    this.commands.set(name, command);
  }

  getActiveTools(): string[] {
    return [...this.activeTools];
  }

  setActiveTools(names: string[]): void {
    this.activeTools = [...names];
  }

  appendEntry(): void {}

  async setModel(): Promise<boolean> {
    return true;
  }

  setThinkingLevel(): void {}

  async exec() {
    return { code: 0, stdout: '', stderr: '', killed: false };
  }

  get api(): ExtensionAPI {
    return this as unknown as ExtensionAPI;
  }

  async emit(
    name: string,
    event: unknown,
    ctx: ExtensionContext,
  ): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const handler of this.handlers.get(name) ?? []) {
      results.push(await handler(event as never, ctx as never));
    }
    return results;
  }

  async command(
    name: string,
    args: string,
    ctx: ExtensionCommandContext,
  ): Promise<void> {
    const command = this.commands.get(name);
    if (!command) throw new Error(`Missing command: ${name}`);
    await command.handler(args, ctx);
  }

  async tool(
    name: string,
    params: unknown,
    ctx: ExtensionContext,
  ): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Missing tool: ${name}`);
    return tool.execute('test-call', params, undefined, undefined, ctx);
  }
}

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'yaawc-build-index-'));
  roots.push(root);
  return root;
}

function writeConfig(cwd: string): void {
  const configPath = join(cwd, '.pi', 'build.json');
  mkdirSync(join(configPath, '..'), { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify({
      models: {
        plan: 'test/model',
        coder: 'test/model',
        tester: 'test/model',
        reviewer: 'test/model',
      },
    }),
  );
}

function context(
  cwd: string,
  entries: unknown[] = [],
): ExtensionCommandContext {
  const model = { provider: 'test', id: 'model', name: 'model' };
  return {
    cwd,
    hasUI: false,
    mode: 'print',
    ui: {
      notify: () => {},
      setStatus: () => {},
      theme: { fg: (_color: string, text: string) => text },
    },
    sessionManager: { getEntries: () => entries },
    modelRegistry: {
      find: () => model,
      getAvailable: () => [model],
    },
    model,
    thinkingLevel: 'high',
    isIdle: () => true,
    abort: () => {},
  } as unknown as ExtensionCommandContext;
}

function attach(state: BuildState): unknown {
  return {
    type: 'custom',
    customType: 'build-workflow',
    data: { slug: state.slug, date: state.date },
  };
}

function expectWorkflowEnabled(pi: FakePi): void {
  expect(pi.getActiveTools()).toEqual(expect.arrayContaining(WORKFLOW_TOOLS));
}

function expectNormalTools(pi: FakePi): void {
  expect(
    pi.getActiveTools().filter((name) => name.startsWith('workflow_')),
  ).toEqual([]);
  expect(pi.getActiveTools()).toEqual(expect.arrayContaining(BASE_TOOLS));
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
  if (previousHerdrEnv === undefined) delete process.env.HERDR_ENV;
  else process.env.HERDR_ENV = previousHerdrEnv;
});

describe('grilling guidance', () => {
  it('makes a complex triage handoff load the grilling skill', async () => {
    const cwd = tempProject();
    writeConfig(cwd);
    process.env.HERDR_ENV = '1';
    const pi = new FakePi();
    buildWorkflow(pi.api);
    const ctx = context(cwd);

    await pi.command('build', 'add a retry guard', ctx);
    const result = await pi.tool(
      'workflow_triage',
      { verdict: 'complex', reasoning: 'The behavior is ambiguous.' },
      ctx,
    );

    expect(result).toMatchObject({
      content: [
        {
          type: 'text',
          text: expect.stringContaining(
            'use `read` to load the complete `grilling` SKILL.md',
          ),
        },
      ],
    });
  });
});

describe('workflow tool activation', () => {
  it('leaves an ordinary session normal despite an active project workflow', async () => {
    const cwd = tempProject();
    const state = createState(
      'add a retry guard',
      'retry-guard',
      '2026-08-09',
      NOW,
    );
    saveBuild(cwd, state);

    const pi = new FakePi();
    buildWorkflow(pi.api);
    await pi.emit(
      'session_start',
      { type: 'session_start', reason: 'startup' },
      context(cwd),
    );

    expectNormalTools(pi);

    pi.setActiveTools([...BASE_TOOLS, ...WORKFLOW_TOOLS]);
    await pi.emit(
      'resources_discover',
      { type: 'resources_discover', cwd, reason: 'startup' },
      context(cwd),
    );
    expectNormalTools(pi);
    expect(
      existsSync(join(cwd, '.ai', 'builds', '2026-08-09-retry-guard.json')),
    ).toBe(true);
  });

  it('enables tools only while the current session starts or resumes a workflow', async () => {
    const cwd = tempProject();
    writeConfig(cwd);
    process.env.HERDR_ENV = '1';
    const pi = new FakePi();
    buildWorkflow(pi.api);
    const ctx = context(cwd);

    await pi.command('build', 'add a retry guard', ctx);
    expectWorkflowEnabled(pi);

    await pi.command('build:pause', '', ctx);
    expectNormalTools(pi);

    await pi.command('build:resume', 'retry-guard', ctx);
    expectWorkflowEnabled(pi);

    pi.setActiveTools(BASE_TOOLS);
    await pi.emit(
      'resources_discover',
      { type: 'resources_discover', cwd, reason: 'startup' },
      ctx,
    );
    expectWorkflowEnabled(pi);

    await pi.command('build:abort', '', ctx);
    expectNormalTools(pi);
  });

  it('deactivates workflow tools when an attached workflow closes', async () => {
    const cwd = tempProject();
    const state = {
      ...createState('add a retry guard', 'retry-guard', '2026-08-09', NOW),
      phase: 'close' as const,
    };
    saveBuild(cwd, state);

    const pi = new FakePi();
    buildWorkflow(pi.api);
    const ctx = context(cwd, [attach(state)]);
    await pi.emit(
      'session_start',
      { type: 'session_start', reason: 'resume' },
      ctx,
    );
    expectWorkflowEnabled(pi);

    await pi.tool('workflow_close', {}, ctx);

    expectNormalTools(pi);
    expect(
      await pi.emit(
        'before_agent_start',
        { type: 'before_agent_start', systemPrompt: 'normal' },
        ctx,
      ),
    ).toEqual([undefined]);
    expect(findBuild(cwd, state.slug, state.date)?.state.status).toBe('done');
  });
});
