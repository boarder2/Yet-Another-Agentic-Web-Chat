// Shared theme plumbing for dashboard widgets. Both widget kinds receive the
// user's current theme colors so their output matches the dashboard:
//   - LLM widgets: colors are described in the prompt (see themePromptBlock).
//   - Code widgets: the resolved theme is passed to render() as `theme`.
//
// `resolveWidgetTheme()` reads the live theme tokens in the browser; everything
// else (defaults, prompt/contract text) is isomorphic and safe on the server.
import type { WidgetTheme } from '@/lib/types/widget';

// Fallback theme used server-side (e.g. the builder's preview) or when the
// client can't resolve the live tokens. Approximates the default dark theme so
// `theme.colors.*` is always populated and widget code never needs null guards.
export const DEFAULT_WIDGET_THEME: WidgetTheme = {
  mode: 'dark',
  colors: {
    background: 'rgb(28, 28, 28)',
    foreground: 'rgb(242, 242, 242)',
    surface: 'rgb(38, 38, 38)',
    surface2: 'rgb(48, 48, 48)',
    border: 'rgb(48, 48, 48)',
    accent: 'rgb(37, 99, 235)',
    accentForeground: 'rgb(252, 252, 252)',
    danger: 'rgb(239, 68, 68)',
    success: 'rgb(34, 197, 94)',
    warning: 'rgb(234, 179, 8)',
    info: 'rgb(59, 130, 246)',
  },
};

// CSS token backing each WidgetTheme color, in declaration order.
const TOKEN_MAP: Array<[keyof WidgetTheme['colors'], string]> = [
  ['background', '--color-bg'],
  ['foreground', '--color-fg'],
  ['surface', '--color-surface'],
  ['surface2', '--color-surface-2'],
  ['border', '--color-border'],
  ['accent', '--color-accent'],
  ['accentForeground', '--color-accent-fg'],
  ['danger', '--color-danger'],
  ['success', '--color-success'],
  ['warning', '--color-warning'],
  ['info', '--color-info'],
];

// Resolve the live theme to concrete color strings. A throwaway probe element
// lets the browser compute color-mix()/oklch() tokens down to rgb(), which is
// what we want to hand to widgets (usable in inline styles, canvas, SVG, etc.).
export function resolveWidgetTheme(): WidgetTheme {
  if (typeof document === 'undefined' || !document.body) {
    return DEFAULT_WIDGET_THEME;
  }
  const root = document.documentElement;
  const attr = root.getAttribute('data-theme');
  const mode: WidgetTheme['mode'] =
    attr === 'light' || attr === 'custom' ? attr : 'dark';

  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.opacity = '0';
  probe.style.pointerEvents = 'none';
  document.body.appendChild(probe);

  const colors = {} as WidgetTheme['colors'];
  try {
    for (const [key, token] of TOKEN_MAP) {
      probe.style.color = `var(${token})`;
      const c = getComputedStyle(probe).color;
      colors[key] = c || DEFAULT_WIDGET_THEME.colors[key];
    }
  } finally {
    probe.remove();
  }
  return { mode, colors };
}

// ── Canonical render-signature documentation ────────────────────────────────
// Single source of truth for the `theme` argument, reused by the code-widget
// template, the in-editor runtime help, and the builder assistant's system
// prompt so they never drift. When the shape changes, update it here only.
export const WIDGET_THEME_CONTRACT = `theme: {
//     mode: 'light'|'dark'|'custom',
//     colors: { background, foreground, surface, surface2, border, accent,
//               accentForeground, danger, success, warning, info }
//   }
//     Resolved CSS color strings for the user's CURRENT dashboard theme. Style
//     your output (inline styles, chart series colors) with these so the widget
//     matches the theme. Don't hardcode unrelated colors.`;

// Human-readable theme block injected into LLM-widget prompts.
export function themePromptBlock(theme: WidgetTheme): string {
  const c = theme.colors;
  return [
    '## Theme',
    `The dashboard's current theme is "${theme.mode}". When you emit HTML or inline styles, use these resolved colors so the widget matches the user's theme — do not hardcode unrelated colors. Plain markdown is already themed automatically.`,
    `- background: ${c.background}`,
    `- foreground (text): ${c.foreground}`,
    `- surface: ${c.surface}`,
    `- surface2: ${c.surface2}`,
    `- border: ${c.border}`,
    `- accent: ${c.accent} (text on accent: ${c.accentForeground})`,
    `- danger: ${c.danger} · success: ${c.success} · warning: ${c.warning} · info: ${c.info}`,
  ].join('\n');
}
