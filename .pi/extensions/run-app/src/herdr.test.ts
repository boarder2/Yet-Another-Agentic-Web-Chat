import { describe, expect, it } from 'vitest';
import { createHerdrClient, tailCommand } from './herdr.ts';

it('constructs a right, no-focus shell split and exact tail command', async () => {
  const calls: string[][] = [];
  const client = createHerdrClient({
    run: async (args) => {
      calls.push([...args]);
      if (args[1] === 'split')
        return { result: { pane: { pane_id: 'w1:p2' } } };
      if (args[1] === 'get') return { result: { pane: { pane_id: 'w1:p1' } } };
      return {};
    },
  });
  const pane = await client.splitTailPane('w1:p1', '/tmp/project');
  await client.renamePane(pane, 'YAAWC logs');
  await client.runTail(pane);
  expect(pane).toBe('w1:p2');
  expect(calls.slice(0, 4)).toEqual([
    ['pane', 'get', 'w1:p1'],
    [
      'pane',
      'split',
      '--pane',
      'w1:p1',
      '--direction',
      'right',
      '--ratio',
      '0.4',
      '--cwd',
      '/tmp/project',
      '--no-focus',
    ],
    ['pane', 'rename', 'w1:p2', 'YAAWC logs'],
    ['pane', 'run', 'w1:p2', tailCommand()],
  ]);
});

describe('tail pane validation', () => {
  it('proves title, cwd, existence, and the running tail before accepting a pane', async () => {
    const client = createHerdrClient({
      run: async (args) => {
        if (args[1] === 'get') {
          return {
            result: {
              pane: {
                pane_id: 'w1:p2',
                label: 'YAAWC logs',
                foreground_cwd: '/tmp/project',
              },
            },
          };
        }
        return {
          result: {
            process_info: { argv: tailCommand().split(' ') },
          },
        };
      },
    });
    await expect(
      client.validateTailPane({ paneId: 'w1:p2', cwd: '/tmp/project' }),
    ).resolves.toMatchObject({ valid: true });
  });

  it('rejects a pane whose command or title changed', async () => {
    const client = createHerdrClient({
      run: async (args) => {
        if (args[1] === 'get') {
          return {
            result: {
              pane: {
                pane_id: 'w1:p2',
                label: 'shell',
                foreground_cwd: '/tmp/project',
              },
            },
          };
        }
        return { result: { output: 'bash' } };
      },
    });
    await expect(
      client.validateTailPane({ paneId: 'w1:p2', cwd: '/tmp/project' }),
    ).resolves.toMatchObject({ valid: false });
  });

  it('focuses only when the validated pane is an actual neighbor', async () => {
    const calls: string[][] = [];
    const client = createHerdrClient({
      run: async (args) => {
        calls.push([...args]);
        if (args[1] === 'neighbor') {
          return {
            result: {
              neighbor: {
                pane_id: args[args.length - 1] === 'right' ? 'w1:p2' : 'w1:p1',
              },
            },
          };
        }
        return {};
      },
    });

    await client.focusPane('w1:p2', 'w1:p1');
    expect(calls).toEqual([
      ['pane', 'neighbor', '--pane', 'w1:p1', '--direction', 'right'],
      ['pane', 'focus', '--direction', 'right', '--pane', 'w1:p1'],
    ]);
  });
});
