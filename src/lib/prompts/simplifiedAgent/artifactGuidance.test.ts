import { describe, it, expect } from 'vitest';
import { buildArtifactRoster } from './artifactGuidance';
import type { ArtifactSummary } from '@/lib/artifacts/service';

const NOW = new Date('2026-08-05T12:00:00Z');

const artifact = (over: Partial<ArtifactSummary> = {}): ArtifactSummary => ({
  id: 'a3f8c1d2-0000-4000-8000-000000000001',
  chatId: 'chat-1',
  workspaceId: null,
  title: 'Q3 Revenue Dashboard',
  createdAt: new Date('2026-08-01T12:00:00Z'),
  updatedAt: new Date('2026-08-05T10:00:00Z'),
  latestVersion: 7,
  versionCount: 7,
  ...over,
});

describe('buildArtifactRoster', () => {
  it('renders nothing when the chat has no artifacts', () => {
    expect(buildArtifactRoster([], NOW)).toBe('');
  });

  it('lists the id, title, current version and relative update time', () => {
    const out = buildArtifactRoster([artifact()], NOW);
    expect(out).toContain('a3f8c1d2-0000-4000-8000-000000000001');
    expect(out).toContain('"Q3 Revenue Dashboard"');
    expect(out).toContain('v7, updated 2 hours ago');
  });

  it('instructs the agent to edit rather than duplicate', () => {
    const out = buildArtifactRoster([artifact()], NOW);
    expect(out).toContain('edit_artifact');
    expect(out).toContain('do not call `create_artifact`');
  });

  it('emits one entry per artifact, preserving the query order', () => {
    const out = buildArtifactRoster(
      [
        artifact({ id: 'id-newer', title: 'Newer' }),
        artifact({
          id: 'id-older',
          title: 'Older',
          latestVersion: 1,
          updatedAt: new Date('2026-08-02T12:00:00Z'),
        }),
      ],
      NOW,
    );
    expect(out.match(/^- `/gm)).toHaveLength(2);
    expect(out.indexOf('id-newer')).toBeLessThan(out.indexOf('id-older'));
    expect(out).toContain('v1, updated 3 days ago');
  });

  it('never reports a version count, which always equals the latest version', () => {
    expect(buildArtifactRoster([artifact()], NOW)).not.toContain('of 7');
  });
});
