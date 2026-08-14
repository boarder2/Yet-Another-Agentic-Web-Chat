import { describe, expect, it } from 'vitest';
import {
  getCapabilityAvailability,
  type CapabilityRuntimeFacts,
} from './availability';

const facts: CapabilityRuntimeFacts = {
  focusMode: 'webSearch',
  isPrivate: false,
  hasFiles: true,
  hasWorkspace: true,
  memoryEnabled: true,
  interactiveSession: true,
  hasDurableChat: true,
  codeExecutionConfigured: true,
  codeExecutionEnabled: true,
  imageGenerationConfigured: false,
  imageGenerationEnabled: false,
  searchCapabilities: {
    web: true,
    images: false,
    videos: false,
    autocomplete: true,
  },
};

describe('capability availability', () => {
  it('returns only coarse statuses from known local facts', () => {
    expect(getCapabilityAvailability('web search', facts)).toEqual({
      capability: 'web search',
      status: 'available',
    });
    expect(getCapabilityAvailability('image search', facts)).toEqual({
      capability: 'image search',
      status: 'not configured',
    });
    expect(getCapabilityAvailability('image generation', facts)).toEqual({
      capability: 'image generation',
      status: 'not configured',
    });
    expect(getCapabilityAvailability('unknown service', facts)).toEqual({
      capability: 'unknown service',
      status: 'unknown on this device',
    });
  });

  it('reports current-run restrictions without probing services', () => {
    expect(
      getCapabilityAvailability('code execution', {
        ...facts,
        interactiveSession: false,
      }),
    ).toEqual({ capability: 'code execution', status: 'disabled' });
    expect(
      getCapabilityAvailability('memory', { ...facts, isPrivate: true }),
    ).toEqual({ capability: 'memory', status: 'disabled' });
    expect(
      getCapabilityAvailability('workspace files', {
        ...facts,
        hasWorkspace: false,
      }),
    ).toEqual({ capability: 'workspace files', status: 'not configured' });
  });

  it('falls back to unknown when a fact was not supplied', () => {
    expect(
      getCapabilityAvailability('web search', { focusMode: 'webSearch' }),
    ).toEqual({
      capability: 'web search',
      status: 'unknown on this device',
    });
  });

  it('supports multiple safe status requests and redacts fact values', () => {
    const statuses = getCapabilityAvailability(
      ['web search', 'code execution'],
      facts,
    );
    expect(statuses).toEqual([
      { capability: 'web search', status: 'available' },
      { capability: 'code execution', status: 'available' },
    ]);
    expect(JSON.stringify(statuses)).not.toContain('docker');
    expect(JSON.stringify(statuses)).not.toContain('workspace');
    expect(JSON.stringify(statuses)).not.toContain('true');
  });

  it('maps focus, privacy, and durable-run restrictions without probing readiness', () => {
    expect(
      getCapabilityAvailability('web search', {
        ...facts,
        focusMode: 'chat',
      }),
    ).toEqual({ capability: 'web search', status: 'disabled' });
    expect(
      getCapabilityAvailability('local research', {
        ...facts,
        focusMode: 'chat',
      }),
    ).toEqual({ capability: 'local research', status: 'disabled' });
    expect(
      getCapabilityAvailability('image generation', {
        ...facts,
        hasDurableChat: false,
        imageGenerationConfigured: true,
        imageGenerationEnabled: true,
      }),
    ).toEqual({ capability: 'image generation', status: 'disabled' });
    expect(
      getCapabilityAvailability('artifacts', {
        ...facts,
        focusMode: 'chat',
      }),
    ).toEqual({ capability: 'artifacts', status: 'disabled' });
    expect(
      getCapabilityAvailability('deep research', {
        ...facts,
        focusMode: 'localResearch',
      }),
    ).toEqual({ capability: 'deep research', status: 'disabled' });
    expect(getCapabilityAvailability('private sessions', {})).toEqual({
      capability: 'private sessions',
      status: 'available',
    });
  });

  it('rejects path-like and oversized capability labels without echoing them', () => {
    const statuses = getCapabilityAvailability(
      ['../../etc/passwd', 'https://internal.example/secret', 'x'.repeat(101)],
      facts,
    );

    expect(statuses).toEqual([
      { capability: 'unknown capability', status: 'unknown on this device' },
      { capability: 'unknown capability', status: 'unknown on this device' },
      { capability: 'unknown capability', status: 'unknown on this device' },
    ]);
    expect(JSON.stringify(statuses)).not.toMatch(
      /(?:passwd|internal\.example|secret)/i,
    );
  });
});
