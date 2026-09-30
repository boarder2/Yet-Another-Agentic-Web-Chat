import { describe, expect, it } from 'vitest';
import { placeCompactionMarkers } from './compactionMarkers';

const row = (id: number) => ({ id, name: `r${id}` });
const marker = (pos: number, name: string) => ({ pos, marker: { name } });

describe('placeCompactionMarkers', () => {
  it('places a marker after the row it is anchored to', () => {
    const out = placeCompactionMarkers(
      [row(1), row(2), row(3)],
      [marker(2, 'm')],
    );
    expect(out.map((r) => r.name)).toEqual(['r1', 'r2', 'm', 'r3']);
  });

  it('falls back to the nearest earlier row when the anchor is not loaded', () => {
    // 4866–4869 are tool-output system rows the UI never loads.
    const out = placeCompactionMarkers(
      [row(4864), row(4865), row(4871)],
      [marker(4869, 'm')],
    );
    expect(out.map((r) => r.name)).toEqual(['r4864', 'r4865', 'm', 'r4871']);
  });

  it('keeps markers in position order, including after the last row', () => {
    const out = placeCompactionMarkers(
      [row(1), row(5)],
      [marker(9, 'b'), marker(3, 'a')],
    );
    expect(out.map((r) => r.name)).toEqual(['r1', 'a', 'r5', 'b']);
  });

  it('drops markers positioned before the first row', () => {
    const out = placeCompactionMarkers([row(3)], [marker(-1, 'm')]);
    expect(out.map((r) => r.name)).toEqual(['r3']);
  });
});
