import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentDefinition } from './agents.ts';
import {
  TEST_RESULT_TOOL,
  VERDICT_TOOL,
  type ToolCallRecord,
} from './verdict.ts';

const VERDICT_EXTENSION = fileURLToPath(
  new URL('./verdict-tool.ts', import.meta.url),
);

export interface RunRequest {
  agent: AgentDefinition;
  task: string;
  cwd: string;
  /** Omitted for the reviewer, which starts fresh every chunk. */
  sessionId?: string;
  model?: string;
  signal?: AbortSignal;
  onActivity?: (line: string) => void;
}

export interface RunResult {
  toolCalls: ToolCallRecord[];
  text: string;
  tokensUsed: number;
  exitCode: number | null;
  stderr: string;
}

function describeCall(toolName: string, args: unknown): string {
  const input = (args ?? {}) as Record<string, unknown>;
  if (toolName === 'bash')
    return `$ ${String(input.command ?? '').slice(0, 70)}`;
  const path = input.file_path ?? input.path;
  return path ? `${toolName} ${String(path)}` : toolName;
}

function buildArgs(request: RunRequest, promptFile: string): string[] {
  const args = [
    '--mode',
    'json',
    '--approve',
    '--append-system-prompt',
    promptFile,
    '-e',
    VERDICT_EXTENSION,
  ];

  if (request.sessionId) args.push('--session-id', request.sessionId);
  else args.push('--no-session');

  const model = request.model ?? request.agent.model;
  if (model) args.push('--model', model);

  // An agent's tool allowlist must never exclude the channel it reports through.
  if (request.agent.tools?.length) {
    args.push(
      '--tools',
      [
        ...new Set([...request.agent.tools, VERDICT_TOOL, TEST_RESULT_TOOL]),
      ].join(','),
    );
  }

  args.push(request.task);
  return args;
}

export async function runAgent(request: RunRequest): Promise<RunResult> {
  const dir = mkdtempSync(join(tmpdir(), 'yaawc-build-'));
  const promptFile = join(dir, 'system.md');
  writeFileSync(promptFile, request.agent.systemPrompt, 'utf-8');

  const child = spawn('pi', buildArgs(request, promptFile), {
    cwd: request.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const result: RunResult = {
    toolCalls: [],
    text: '',
    tokensUsed: 0,
    exitCode: null,
    stderr: '',
  };

  const abort = () => child.kill('SIGTERM');
  request.signal?.addEventListener('abort', abort, { once: true });

  let buffer = '';
  const consume = (line: string) => {
    if (!line.trim()) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }

    if (event.type === 'tool_execution_start') {
      const toolName = String(event.toolName);
      result.toolCalls.push({ toolName, args: event.args });
      request.onActivity?.(describeCall(toolName, event.args));
      return;
    }

    if (event.type === 'message_end') {
      const message = event.message as
        | { role?: string; content?: unknown; usage?: { totalTokens?: number } }
        | undefined;
      if (message?.role !== 'assistant') return;

      if (message.usage?.totalTokens) {
        result.tokensUsed = Math.max(
          result.tokensUsed,
          message.usage.totalTokens,
        );
      }
      if (Array.isArray(message.content)) {
        for (const part of message.content as Array<Record<string, unknown>>) {
          if (part.type === 'text' && typeof part.text === 'string') {
            result.text = part.text;
          }
        }
      }
    }
  };

  child.stdout.on('data', (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(consume);
  });
  child.stderr.on('data', (data: Buffer) => {
    result.stderr += data.toString();
  });

  result.exitCode = await new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
    child.on('error', (error) => {
      result.stderr += String(error);
      resolve(null);
    });
  });

  request.signal?.removeEventListener('abort', abort);
  if (buffer) consume(buffer);
  return result;
}
