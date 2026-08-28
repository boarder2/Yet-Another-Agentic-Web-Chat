import { describe, expect, it } from 'vitest';
import { buildWebSearchPrompt } from './webSearch';
import { buildMappingGuidance, mappingGuidance } from './mappingGuidance';

const DATE = new Date('2026-08-27T00:00:00Z');

describe('mapping guidance', () => {
  it('teaches grounded numbered place, business, route, map, and attribution behavior', () => {
    expect(mappingGuidance).toContain('search_places');
    expect(mappingGuidance).toContain('get_place_details');
    expect(mappingGuidance).toContain('get_route');
    expect(mappingGuidance).toContain('show_map');
    expect(mappingGuidance).toContain('placeHandle');
    expect(mappingGuidance).toContain('no more than 12 validated pins');
    expect(mappingGuidance).toContain('one route');
    expect(mappingGuidance).toContain('normal numbered source citations');
    expect(mappingGuidance).toContain('central-area estimates');
    expect(mappingGuidance).toContain('external place/navigation links');
    expect(mappingGuidance).toContain('never use IP geolocation');
    expect(mappingGuidance).toContain('never pass latitude/longitude');
    expect(mappingGuidance).toContain('Transit, live traffic');
  });

  it('is present only when mapping is enabled in the Web Search prompt', () => {
    const enabled = buildWebSearchPrompt(
      '',
      '',
      [],
      0,
      'find nearby cafes',
      DATE,
      '',
      false,
      false,
      true,
    );
    const disabled = buildWebSearchPrompt(
      '',
      '',
      [],
      0,
      'find nearby cafes',
      DATE,
      '',
      false,
      false,
      false,
    );

    expect(enabled).toContain('## Mapping and location-grounded answers');
    expect(enabled).toContain('Keep the returned numbered place list');
    expect(disabled).not.toContain('## Mapping and location-grounded answers');
  });

  it('returns no guidance for an excluded or unavailable mapping surface', () => {
    expect(buildMappingGuidance(false)).toBe('');
  });
});
