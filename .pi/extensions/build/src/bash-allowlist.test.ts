import { describe, it, expect } from 'vitest';
import { isSafeCommand } from './bash-allowlist.ts';

describe('isSafeCommand', () => {
  it('allows read-only inspection', () => {
    for (const command of [
      'ls -la src',
      'git log --oneline -20',
      'git diff HEAD~1',
      'rg "phasePrompt" src',
      'cat package.json',
      'npm ls vitest',
      'sed -n 1,40p src/index.ts',
    ]) {
      expect(isSafeCommand(command), command).toBe(true);
    }
  });

  it('blocks mutation, installs, and git writes', () => {
    for (const command of [
      'rm -rf src',
      'mv a b',
      'echo hi > file.txt',
      'cat x >> y',
      'git commit -m "wip"',
      'git checkout main',
      'npm install left-pad',
      'sudo reboot',
      'vim src/index.ts',
    ]) {
      expect(isSafeCommand(command), command).toBe(false);
    }
  });

  it('judges the real command behind a `cd <dir> &&` prefix', () => {
    expect(isSafeCommand('rg -il retry src/')).toBe(true);
    expect(isSafeCommand('cd /workspaces/YAAWC && git log --oneline -10')).toBe(
      true,
    );
    expect(isSafeCommand('cd /tmp && rm -rf x')).toBe(false);
    expect(isSafeCommand('cd /tmp && mycustomscript')).toBe(false);
  });

  it('blocks an unrecognised command rather than defaulting to allow', () => {
    expect(isSafeCommand('mycustomscript --force')).toBe(false);
    expect(isSafeCommand('')).toBe(false);
  });

  // Documented weakness, asserted so it cannot regress silently into a false
  // sense of safety: this filter is a speed bump, not a sandbox.
  it('is bypassable by an interpreter or a writing flag, as designed', () => {
    for (const command of [
      "cat /dev/null; python3 -c \"open('f','w').write(1)\"",
      "jq -n \"1\" && node -e \"require('fs').writeFileSync('f','x')\"",
      'find . -name x -delete',
    ]) {
      expect(isSafeCommand(command), command).toBe(true);
    }
  });
});
