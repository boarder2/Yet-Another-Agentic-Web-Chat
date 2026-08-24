import { describe, expect, it } from 'vitest';
import {
  appUrl,
  isYAAWCConfig,
  nextHealthState,
  parseSelectedPort,
  probeYAAWC,
  scanYAAWCPorts,
  type Fetcher,
} from './health.ts';

const response = (payload: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => payload,
});

describe('YAAWC health identification', () => {
  it('requires the config JSON marker', async () => {
    const fetcher: Fetcher = async () => response({ chatModelProviders: [] });
    await expect(
      probeYAAWC('http://localhost:5005', { fetcher }),
    ).resolves.toMatchObject({
      healthy: true,
      identified: true,
    });
    expect(isYAAWCConfig({})).toBe(false);
    expect(isYAAWCConfig({ chatModelProviders: null })).toBe(true);
  });

  it('does not identify a non-YAAWC HTTP service', async () => {
    const fetcher: Fetcher = async () => response({ ok: true });
    await expect(
      probeYAAWC('http://localhost:5005', { fetcher }),
    ).resolves.toMatchObject({
      healthy: false,
      identified: false,
    });
  });
});

describe('port range scanning', () => {
  it('probes localhost 5005 through 5015 and returns the first healthy YAAWC', async () => {
    const ports: number[] = [];
    const found = await scanYAAWCPorts({
      probe: async (url) => {
        const port = Number(url.split(':').pop());
        ports.push(port);
        return {
          url,
          healthy: port === 5007,
          identified: port === 5007,
          status: 200,
        };
      },
    });

    expect(ports).toEqual([5005, 5006, 5007]);
    expect(found).toMatchObject({ port: 5007, url: appUrl(5007) });
  });
});

describe('health transition thresholds', () => {
  it('needs two failures to become unhealthy and one success to recover', () => {
    const failed = {
      url: 'http://localhost:5005',
      healthy: false,
      identified: false,
      status: null,
    };
    expect(nextHealthState('healthy', 0, failed)).toEqual({
      health: 'healthy',
      consecutiveFailures: 1,
    });
    expect(nextHealthState('healthy', 1, failed)).toEqual({
      health: 'unhealthy',
      consecutiveFailures: 2,
    });
    expect(
      nextHealthState('unhealthy', 2, {
        ...failed,
        healthy: true,
        identified: true,
        status: 200,
      }),
    ).toEqual({
      health: 'healthy',
      consecutiveFailures: 0,
    });
  });
});

describe('Next port parsing', () => {
  it('parses the selected local port, including an auto-bumped port', () => {
    expect(parseSelectedPort('- Local: http://localhost:5012')).toBe(5012);
    expect(parseSelectedPort('ready - started server on 5016')).toBe(5016);
    expect(parseSelectedPort('no port here')).toBeNull();
  });
});
