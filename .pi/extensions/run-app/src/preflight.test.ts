import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { preflightProject } from './preflight.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it('preflights only existing project prerequisites', () => {
  const root = mkdtempSync(join(tmpdir(), 'yaawc-run-app-preflight-'));
  roots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ scripts: { dev: 'next dev' } }),
  );
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, 'config.toml'), 'passphrase = "test"\n');
  expect(preflightProject(root)).toEqual({ ok: true, problems: [] });
});

it('reports missing prerequisites without creating them', () => {
  const root = mkdtempSync(join(tmpdir(), 'yaawc-run-app-preflight-'));
  roots.push(root);
  const result = preflightProject(root);
  expect(result.ok).toBe(false);
  expect(result.problems.join('\n')).toContain('package.json');
  expect(result.problems.join('\n')).toContain('node_modules');
  expect(result.problems.join('\n')).toContain('config.toml');
});
