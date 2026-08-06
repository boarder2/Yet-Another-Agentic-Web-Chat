import { describe, it, expect } from 'vitest';
import {
  buildArtifactMention,
  parseArtifactHref,
  scanArtifactMentions,
} from './mention';

const ID = 'a3f8c1d2-0000-4000-8000-000000000001';
const OTHER = 'b4e9d2e3-1111-4111-9111-111111111112';

describe('buildArtifactMention', () => {
  it('produces a markdown link the renderer and the scanner both accept', () => {
    const token = buildArtifactMention(ID, 'Q3 Roadmap');
    expect(token).toBe(`@[Q3 Roadmap](artifact:${ID})`);
    expect(scanArtifactMentions(token)).toEqual([ID]);
  });

  it('escapes brackets so a title cannot terminate its own label', () => {
    const token = buildArtifactMention(ID, 'Notes [draft]');
    expect(token).toBe(`@[Notes \\[draft\\]](artifact:${ID})`);
    expect(scanArtifactMentions(token)).toEqual([ID]);
  });
});

describe('parseArtifactHref', () => {
  it('returns the id for a well-formed href', () => {
    expect(parseArtifactHref(`artifact:${ID}`)).toBe(ID);
  });

  it('rejects anything that is not a bare uuid', () => {
    expect(parseArtifactHref('https://example.com')).toBeNull();
    expect(parseArtifactHref('artifact:../../etc/passwd')).toBeNull();
    expect(parseArtifactHref(`artifact:${ID}?x=1`)).toBeNull();
    expect(parseArtifactHref(`artifact:${ID} `)).toBeNull();
  });
});

describe('scanArtifactMentions', () => {
  it('finds every distinct id in first-appearance order', () => {
    const text = `Compare ${buildArtifactMention(OTHER, 'B')} with ${buildArtifactMention(ID, 'A')}.`;
    expect(scanArtifactMentions(text)).toEqual([OTHER, ID]);
  });

  it('deduplicates repeated mentions of the same document', () => {
    const token = buildArtifactMention(ID, 'A');
    expect(scanArtifactMentions(`${token} and again ${token}`)).toEqual([ID]);
  });

  it('returns nothing for text without mentions', () => {
    expect(scanArtifactMentions('no documents here')).toEqual([]);
    expect(scanArtifactMentions('](artifact:not-a-uuid)')).toEqual([]);
  });
});
