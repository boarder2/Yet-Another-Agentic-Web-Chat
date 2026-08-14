import { describe, expect, it } from 'vitest';
import {
  buildCapabilityDocsGuidance,
  capabilityDocsGuidance,
} from './capabilityDocsGuidance';

describe('capability documentation prompt guidance', () => {
  it('requires grounded YAAWC claims and closed failure behavior', () => {
    const guidance = buildCapabilityDocsGuidance();

    expect(guidance).toContain('MUST call `search_yaawc_docs`');
    expect(guidance).toContain('returned section citation');
    expect(guidance).toContain('cannot be verified');
    expect(guidance).toContain(
      'Do not turn a documentation failure into a web-search answer',
    );
  });

  it('restricts availability and separates external comparison evidence', () => {
    expect(capabilityDocsGuidance).toContain(
      '`available`, `disabled`, `not configured`, or `unknown on this device`',
    );
    expect(capabilityDocsGuidance).toContain(
      'Web or other external sources may support only claims about the compared products or services.',
    );
  });
});
