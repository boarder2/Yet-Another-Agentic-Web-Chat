import { describe, it, expect } from 'vitest';
import { applyExactEdit } from './applyExactEdit';

const doc = `<!doctype html>
<html>
  <head><title>Report</title></head>
  <body>
    <h1>Quarterly Report</h1>
    <p>Revenue was flat.</p>
  </body>
</html>`;

describe('applyExactEdit', () => {
  it('replaces the single occurrence and leaves the rest byte-identical', () => {
    const result = applyExactEdit(doc, 'Revenue was flat.', 'Revenue grew 4%.');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toBe(
      doc.replace('Revenue was flat.', 'Revenue grew 4%.'),
    );
    expect(result.content).toContain('<h1>Quarterly Report</h1>');
  });

  it('reports no_match when oldStr is absent, telling the agent to re-read', () => {
    const result = applyExactEdit(doc, 'Revenue was up.', 'Revenue grew 4%.');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_match');
    expect(result.message).toContain('read_artifact');
  });

  it('reports ambiguous with the occurrence count when oldStr repeats', () => {
    const repeated = '<li>Item</li>\n<li>Item</li>\n<li>Item</li>';
    const result = applyExactEdit(repeated, '<li>Item</li>', '<li>Thing</li>');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('ambiguous');
    expect(result.count).toBe(3);
    expect(result.message).toContain('3');
  });

  it('matches multi-line strings exactly, including indentation', () => {
    const result = applyExactEdit(
      doc,
      '    <h1>Quarterly Report</h1>\n    <p>Revenue was flat.</p>',
      '    <h1>Annual Report</h1>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain('    <h1>Annual Report</h1>\n  </body>');
    expect(result.content).not.toContain('Revenue was flat.');
  });

  it('treats regex metacharacters in oldStr as literal text', () => {
    const src = 'const re = /a.+b/g; // $1 [x] (y)';
    const result = applyExactEdit(src, '/a.+b/g', '/c+d/g');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toBe('const re = /c+d/g; // $1 [x] (y)');
  });

  it('keeps `$&`-style sequences in newStr literal rather than expanding them', () => {
    const result = applyExactEdit('a TOKEN b', 'TOKEN', '$& $1 $`');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toBe('a $& $1 $` b');
  });

  it('rejects an empty oldStr rather than matching everywhere', () => {
    const result = applyExactEdit(doc, '', 'x');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_match');
  });

  it('supports deletion via an empty newStr', () => {
    const result = applyExactEdit(doc, '    <p>Revenue was flat.</p>\n', '');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).not.toContain('Revenue was flat.');
    expect(result.content).toContain('<h1>Quarterly Report</h1>');
  });

  it('reports no_change when newStr equals oldStr', () => {
    const result = applyExactEdit(
      doc,
      'Revenue was flat.',
      'Revenue was flat.',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_change');
  });
});
