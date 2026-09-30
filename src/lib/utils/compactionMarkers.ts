/**
 * Interleave compaction markers into id-ordered visible rows. Each marker goes
 * after the last row whose id is <= its position, so markers anchored to a row
 * the UI never loads (e.g. a tool-output system row) still render. Markers
 * positioned before the first row are dropped.
 */
export function placeCompactionMarkers<T extends { id?: number }, M>(
  rows: T[],
  markers: { pos: number; marker: M }[],
): (T | M)[] {
  const sorted = [...markers].sort((a, b) => a.pos - b.pos);
  const out: (T | M)[] = [];
  let j = 0;
  rows.forEach((row, i) => {
    out.push(row);
    const nextId = rows[i + 1]?.id ?? Infinity;
    for (; j < sorted.length && sorted[j].pos < nextId; j++) {
      if (sorted[j].pos >= (row.id ?? -Infinity)) out.push(sorted[j].marker);
    }
  });
  return out;
}
