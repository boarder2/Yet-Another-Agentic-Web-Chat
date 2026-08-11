import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import verdictTools, { recordResult } from './verdict-tool.ts';
import {
  BUILD_ROLE_ENV,
  parseResult,
  REPORT_TOOL_BY_ROLE,
  type ResultEnvelope,
} from './verdict.ts';
import { AGENT_ROLES } from './models.ts';

function registeredTools(role: string | undefined): string[] {
  const names: string[] = [];
  const pi = {
    registerTool(tool: { name: string }) {
      names.push(tool.name);
    },
  } as unknown as ExtensionAPI;

  verdictTools(pi, role === undefined ? {} : { [BUILD_ROLE_ENV]: role });
  return names;
}

describe('role-specific reporting tools', () => {
  it('registers exactly the tool owned by each role', () => {
    for (const role of AGENT_ROLES) {
      expect(registeredTools(role), role).toEqual([REPORT_TOOL_BY_ROLE[role]]);
    }
  });

  it('fails closed when the role is missing or invalid', () => {
    for (const role of [undefined, '', 'plan', 'codre']) {
      expect(() => registeredTools(role), String(role)).toThrow(BUILD_ROLE_ENV);
    }
  });
});

describe('recordResult', () => {
  it('accepts an identical retry without replacing the authoritative report', () => {
    const root = mkdtempSync(join(tmpdir(), 'yaawc-build-result-'));
    const path = join(root, 'result.json');
    const payload = { status: 'completed', summary: 'implemented the chunk' };

    try {
      recordResult(path, REPORT_TOOL_BY_ROLE.coder, payload);
      recordResult(path, REPORT_TOOL_BY_ROLE.coder, { ...payload });

      expect(parseResult(readFileSync(path, 'utf-8'))).toEqual({
        kind: REPORT_TOOL_BY_ROLE.coder,
        payload,
      } satisfies ResultEnvelope);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a conflicting second report and preserves the first', () => {
    const root = mkdtempSync(join(tmpdir(), 'yaawc-build-result-'));
    const path = join(root, 'result.json');
    const first = { status: 'completed', summary: 'first answer' };

    try {
      recordResult(path, REPORT_TOOL_BY_ROLE.coder, first);
      expect(() =>
        recordResult(path, REPORT_TOOL_BY_ROLE.coder, {
          status: 'blocked',
          summary: 'different answer',
        }),
      ).toThrow('conflicting build result');
      expect(parseResult(readFileSync(path, 'utf-8'))).toEqual({
        kind: REPORT_TOOL_BY_ROLE.coder,
        payload: first,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
