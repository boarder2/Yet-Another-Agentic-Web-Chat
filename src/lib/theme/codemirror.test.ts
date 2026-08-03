import { describe, expect, it } from 'vitest';
import { syntaxColorsFor } from './codemirror';
import { PRISM_STYLES } from './syntax';

describe('syntaxColorsFor', () => {
  it('reads a style with a full token set', () => {
    const c = syntaxColorsFor(PRISM_STYLES.dracula);
    expect(c.background).toBe('#282a36');
    expect(c.foreground).toBe('#f8f8f2');
    expect(c.dark).toBe(true);
    expect(c.tokens.comment).toEqual({ color: '#6272a4' });
    expect(c.tokens.keyword).toEqual({ color: '#8be9fd' });
    expect(c.tokens['class-name']).toEqual({ color: '#f1fa8c' });
  });

  it('omits a token the style leaves undefined rather than substituting', () => {
    const c = syntaxColorsFor(PRISM_STYLES.gruvboxDark);
    // Gruvbox deliberately leaves class names at base colour.
    expect(c.tokens['class-name']).toBeUndefined();
    expect(c.tokens.keyword).toBeDefined();
  });

  it('falls back to the app surface when the style declares no fill', () => {
    const c = syntaxColorsFor(PRISM_STYLES.synthwave84);
    expect(c.background).toBe('var(--color-surface)');
    // Nothing measurable, so the caller supplies `dark` from the app mode.
    expect(c.dark).toBeUndefined();
    expect(c.selection).toBe(
      `color-mix(in srgb, ${c.foreground} 25%, var(--color-surface))`,
    );
  });

  it('carries font style so a style keeps its signature look', () => {
    expect(syntaxColorsFor(PRISM_STYLES.oneDark).tokens.comment).toEqual({
      color: 'hsl(220, 10%, 40%)',
      fontStyle: 'italic',
    });
  });

  it('reads the hsl-stated One Dark / One Light pair by lightness', () => {
    expect(syntaxColorsFor(PRISM_STYLES.oneLight).dark).toBe(false);
    expect(syntaxColorsFor(PRISM_STYLES.oneDark).dark).toBe(true);
  });

  it('mixes chrome toward the foreground, off the style background', () => {
    const c = syntaxColorsFor(PRISM_STYLES.dracula);
    expect(c.caret).toBe('#f8f8f2');
    expect(c.activeLine).toBe('color-mix(in srgb, #f8f8f2 6%, #282a36)');
    expect(c.gutterForeground).toBe('color-mix(in srgb, #f8f8f2 45%, #282a36)');
  });
});
