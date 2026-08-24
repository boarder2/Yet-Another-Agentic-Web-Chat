import { expect, it } from 'vitest';
import {
  waitForReady,
  StartupCancelledError,
  StartupTimeoutError,
} from './startup.ts';

it('waits for the parsed Next port and a YAAWC health response', async () => {
  let reads = 0;
  const result = await waitForReady({
    signal: new AbortController().signal,
    timeoutMs: 100,
    pollMs: 1,
    isExited: () => false,
    readLog: () => {
      reads++;
      return reads < 2 ? '' : '- Local: http://localhost:5008';
    },
    urlForPort: (port) => `http://localhost:${port}`,
    probe: async (url) => ({
      url,
      healthy: true,
      identified: true,
      status: 200,
    }),
    sleep: async () => undefined,
  });
  expect(result).toMatchObject({ port: 5008, url: 'http://localhost:5008' });
});

it('distinguishes cancellation and timeout', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    waitForReady({
      signal: controller.signal,
      timeoutMs: 100,
      isExited: () => false,
      readLog: () => '',
      urlForPort: (port) => `http://localhost:${port}`,
      probe: async (url) => ({
        url,
        healthy: false,
        identified: false,
        status: null,
      }),
      sleep: async () => undefined,
    }),
  ).rejects.toBeInstanceOf(StartupCancelledError);

  await expect(
    waitForReady({
      signal: new AbortController().signal,
      timeoutMs: 0,
      isExited: () => false,
      readLog: () => '',
      urlForPort: (port) => `http://localhost:${port}`,
      probe: async (url) => ({
        url,
        healthy: false,
        identified: false,
        status: null,
      }),
      sleep: async () => undefined,
    }),
  ).rejects.toBeInstanceOf(StartupTimeoutError);
});
