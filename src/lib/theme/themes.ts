/**
 * The built-in theme catalogue — the single source of truth. Applying any of
 * these writes the same CSS variables as a custom theme (see `derive.ts`).
 *
 * Every palette is transcribed from its project's canonical spec, linked in
 * `source` and named per-value in the comments so a value can be re-verified
 * without guesswork. Licenses are listed in `docs/THEMES.md`.
 *
 * Mapping notes that apply throughout:
 * - `surface` is the palette's own raised/panel tone where it defines one.
 *   Where the upstream spec has no surface token (One Dark), it's derived and
 *   said so in the comment.
 * - `success`/`warning`/`danger` use each palette's documented git/diagnostic
 *   semantics (added / modified / deleted) rather than raw hue names, which is
 *   why e.g. Rosé Pine's `success` is foam — that palette has no green.
 * - `accent` is the palette's primary UI/link colour.
 */
import { luminance } from './derive';
import type { Theme, ThemeMode } from './types';

export const THEMES: Theme[] = [
  // ── Dark ──────────────────────────────────────────────────────────────────
  {
    id: 'dark',
    name: 'Dark',
    mode: 'dark',
    bg: '#1c1c1c',
    fg: '#f2f2f2',
    surface: '#2e2e2e',
    accent: '#2563eb',
    danger: '#ef4444',
    success: '#22c55e',
    warning: '#eab308',
  },
  {
    id: 'nord',
    name: 'Nord',
    mode: 'dark',
    source: 'https://www.nordtheme.com/docs/colors-and-palettes',
    syntax: 'nord',
    bg: '#2e3440', // nord0  — Polar Night
    fg: '#eceff4', // nord6  — Snow Storm
    surface: '#3b4252', // nord1
    accent: '#88c0d0', // nord8  — Frost, "primary accent"
    danger: '#bf616a', // nord11 — Aurora, error states
    success: '#a3be8c', // nord14 — Aurora, success states
    warning: '#ebcb8b', // nord13 — Aurora, warning states
  },
  {
    id: 'dracula',
    name: 'Dracula',
    mode: 'dark',
    source: 'https://github.com/dracula/dracula-theme#color-palette',
    syntax: 'dracula',
    bg: '#282a36', // Background
    fg: '#f8f8f2', // Foreground
    surface: '#44475a', // Current Line
    accent: '#bd93f9', // Purple
    danger: '#ff5555', // Red
    success: '#50fa7b', // Green
    warning: '#f1fa8c', // Yellow
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    mode: 'dark',
    source: 'https://github.com/morhetz/gruvbox/blob/master/colors/gruvbox.vim',
    syntax: 'gruvboxDark',
    bg: '#282828', // dark0
    fg: '#ebdbb2', // light1
    surface: '#3c3836', // dark1
    accent: '#83a598', // bright_blue
    danger: '#fb4934', // bright_red
    success: '#b8bb26', // bright_green
    warning: '#fabd2f', // bright_yellow
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    mode: 'dark',
    source: 'https://ethanschoonover.com/solarized/',
    syntax: 'solarizedDarkAtom',
    bg: '#002b36', // base03 — spec's dark background
    fg: '#839496', // base0  — spec's dark body text
    surface: '#073642', // base02 — spec's dark highlight
    accent: '#268bd2', // blue
    danger: '#dc322f', // red
    success: '#859900', // green
    warning: '#b58900', // yellow
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    mode: 'dark',
    source: 'https://github.com/catppuccin/palette/blob/main/palette.json',
    bg: '#1e1e2e', // base
    fg: '#cdd6f4', // text
    surface: '#313244', // surface0
    accent: '#cba6f7', // mauve — Catppuccin's primary accent
    danger: '#f38ba8', // red
    success: '#a6e3a1', // green
    warning: '#f9e2af', // yellow
  },
  {
    id: 'catppuccin-macchiato',
    name: 'Catppuccin Macchiato',
    mode: 'dark',
    source: 'https://github.com/catppuccin/palette/blob/main/palette.json',
    bg: '#24273a', // base
    fg: '#cad3f5', // text
    surface: '#363a4f', // surface0
    accent: '#c6a0f6', // mauve
    danger: '#ed8796', // red
    success: '#a6da95', // green
    warning: '#eed49f', // yellow
  },
  {
    id: 'catppuccin-frappe',
    name: 'Catppuccin Frappé',
    mode: 'dark',
    source: 'https://github.com/catppuccin/palette/blob/main/palette.json',
    bg: '#303446', // base
    fg: '#c6d0f5', // text
    surface: '#414559', // surface0
    accent: '#ca9ee6', // mauve
    danger: '#e78284', // red
    success: '#a6d189', // green
    warning: '#e5c890', // yellow
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    mode: 'dark',
    source:
      'https://github.com/enkia/tokyo-night-vscode-theme/blob/master/themes/tokyo-night-color-theme.json',
    bg: '#1a1b26', // editor.background
    fg: '#c0caf5', // editorCursor.foreground — the palette's bright fg
    surface: '#292e42', // diffEditor.diagonalFill (bg_highlight)
    accent: '#7aa2f7', // terminal.ansiBlue
    danger: '#f7768e', // terminal.ansiRed
    success: '#73daca', // terminal.ansiGreen
    warning: '#e0af68', // terminal.ansiYellow
  },
  {
    id: 'tokyo-night-storm',
    name: 'Tokyo Night Storm',
    mode: 'dark',
    source:
      'https://github.com/enkia/tokyo-night-vscode-theme/blob/master/themes/tokyo-night-storm-color-theme.json',
    bg: '#24283b', // editor.background
    fg: '#c0caf5', // editorCursor.foreground
    surface: '#2c324a', // diffEditor.diagonalFill
    accent: '#7aa2f7', // terminal.ansiBlue
    danger: '#f7768e', // terminal.ansiRed
    success: '#73daca', // terminal.ansiGreen
    warning: '#e0af68', // terminal.ansiYellow
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    mode: 'dark',
    source:
      'https://github.com/atom/one-dark-syntax/blob/master/styles/colors.less',
    syntax: 'oneDark',
    bg: '#282c34', // @syntax-bg  hsl(220,13%,18%)
    fg: '#abb2bf', // @mono-1     hsl(220,14%,71%)
    // one-dark-syntax defines no surface token; lightened from @syntax-bg to
    // sit between the background and @mono-3.
    surface: '#333842',
    accent: '#61afef', // @hue-2 blue
    danger: '#e06c75', // @hue-5 red
    success: '#98c379', // @hue-4 green
    warning: '#e5c07b', // @hue-6-2 orange
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    mode: 'dark',
    source: 'https://github.com/rose-pine/palette/blob/main/palette.json',
    bg: '#191724', // base
    fg: '#e0def4', // text
    surface: '#1f1d2e', // surface
    accent: '#c4a7e7', // iris
    danger: '#eb6f92', // love  — spec maps git deleted/error to love
    success: '#9ccfd8', // foam  — spec maps git added to foam (no green in palette)
    warning: '#f6c177', // gold
  },
  {
    id: 'rose-pine-moon',
    name: 'Rosé Pine Moon',
    mode: 'dark',
    source: 'https://github.com/rose-pine/palette/blob/main/palette.json',
    bg: '#232136', // base
    fg: '#e0def4', // text
    surface: '#2a273f', // surface
    accent: '#c4a7e7', // iris
    danger: '#eb6f92', // love
    success: '#9ccfd8', // foam
    warning: '#f6c177', // gold
  },
  {
    id: 'everforest-dark',
    name: 'Everforest Dark',
    mode: 'dark',
    source: 'https://github.com/sainnhe/everforest/blob/master/palette.md',
    bg: '#2d353b', // bg0, medium contrast
    fg: '#d3c6aa', // fg
    surface: '#343f44', // bg1, medium contrast
    accent: '#7fbbb3', // blue
    danger: '#e67e80', // red
    success: '#a7c080', // green
    warning: '#dbbc7f', // yellow
  },
  {
    id: 'github-dark-high-contrast',
    name: 'GitHub Dark High Contrast',
    mode: 'dark',
    source:
      'https://github.com/primer/primitives/blob/main/src/tokens/base/color/dark/dark.high-contrast.json5',
    bg: '#010409', // base.black
    fg: '#ffffff', // base.white
    // The high-contrast file overrides only the accent hues; its neutrals come
    // from the base dark palette, whose neutral.1 is GitHub Dark's canvas.
    surface: '#0d1117', // scale.neutral.1 (from dark.json5)
    accent: '#71b7ff', // scale.blue.3
    danger: '#ff9492', // scale.red.3
    success: '#28d751', // scale.green.3
    warning: '#f0b72f', // scale.yellow.3
  },
  {
    id: 'ayu-dark',
    name: 'Ayu Dark',
    mode: 'dark',
    source:
      'https://github.com/ayu-theme/ayu-colors/blob/master/themes/dark.yaml',
    bg: '#0d1017', // surface.base
    fg: '#bfbdb6', // editor.fg
    surface: '#141821', // ui.panel.bg
    // Ayu's signature amber. Its yellow sits close to it by design, so accent
    // and warning read as neighbours here rather than contrasting roles.
    accent: '#e6b450', // common.accent.tint
    danger: '#d95757', // common.error
    success: '#aad94c', // palette.green
    warning: '#ffb454', // palette.yellow
  },
  {
    id: 'night-owl',
    name: 'Night Owl',
    mode: 'dark',
    source:
      'https://github.com/sdras/night-owl-vscode-theme/blob/main/themes/Night%20Owl-color-theme.json',
    syntax: 'nightOwl',
    bg: '#011627', // editor.background
    fg: '#d6deeb', // editor.foreground
    // editorWidget.background is darker than the canvas; input.background is
    // the palette's raised opaque tone.
    surface: '#0b253a', // input.background
    accent: '#82aaff', // terminal.ansiBlue
    danger: '#ef5350', // editorError.foreground
    success: '#22da6e', // terminal.ansiGreen
    warning: '#b39554', // editorWarning.foreground
  },
  {
    id: 'kanagawa-dragon',
    name: 'Kanagawa Dragon',
    mode: 'dark',
    source:
      'https://github.com/rebelot/kanagawa.nvim/blob/master/lua/kanagawa/colors.lua',
    bg: '#181616', // dragonBlack3
    fg: '#c5c9c5', // dragonWhite
    surface: '#282727', // dragonBlack4
    accent: '#8ba4b0', // dragonBlue2
    danger: '#c4746e', // dragonRed
    success: '#87a987', // dragonGreen
    warning: '#c4b28a', // dragonYellow
  },
  // The three dark Material variants share one syntax palette upstream; they
  // differ only in their backgrounds. Material Lighter is deliberately absent:
  // its declared foreground (#90A4AE) reads at 2.48:1 on its own background,
  // below our floor, and the theme offers no darker text value to use instead.
  {
    id: 'material-ocean',
    name: 'Material Ocean',
    mode: 'dark',
    source:
      'https://github.com/Dramaga11/vsc-material-theme/blob/main/scripts/generator/settings/specific/ocean.ts',
    syntax: 'materialOceanic',
    bg: '#0f111a', // scheme.background
    fg: '#babed8', // scheme.foreground
    surface: '#1a1c25', // scheme.inputBackground
    accent: '#80cbc4', // scheme.defaultAccent
    danger: '#f07178', // base.red
    success: '#c3e88d', // base.green
    warning: '#ffcb6b', // base.yellow
  },
  {
    id: 'material-palenight',
    name: 'Material Palenight',
    mode: 'dark',
    source:
      'https://github.com/Dramaga11/vsc-material-theme/blob/main/scripts/generator/settings/specific/palenight.ts',
    syntax: 'materialOceanic',
    bg: '#292d3e', // scheme.background
    fg: '#babed8', // scheme.foreground
    surface: '#333747', // scheme.inputBackground
    accent: '#80cbc4', // scheme.defaultAccent
    danger: '#f07178', // base.red
    success: '#c3e88d', // base.green
    warning: '#ffcb6b', // base.yellow
  },
  {
    id: 'material-darker',
    name: 'Material Darker',
    mode: 'dark',
    source:
      'https://github.com/Dramaga11/vsc-material-theme/blob/main/scripts/generator/settings/specific/darker.ts',
    syntax: 'materialDark',
    bg: '#212121', // scheme.background
    fg: '#eeffff', // scheme.foreground
    surface: '#2b2b2b', // scheme.inputBackground
    accent: '#80cbc4', // scheme.defaultAccent
    danger: '#f07178', // base.red
    success: '#c3e88d', // base.green
    warning: '#ffcb6b', // base.yellow
  },
  {
    id: 'synthwave-84',
    name: "Synthwave '84",
    mode: 'dark',
    source:
      'https://github.com/robb0wen/synthwave-vscode/blob/master/themes/synthwave-color-theme.json',
    syntax: 'synthwave84',
    bg: '#262335', // editor.background
    // The theme sets no editor.foreground, deferring to the VS Code dark
    // default; white matches how it actually renders.
    fg: '#ffffff',
    surface: '#2a2139', // input.background
    accent: '#f97e72', // textLink.foreground / activityBarBadge.background
    danger: '#fe4450', // editorError.foreground
    success: '#72f1b8', // terminal.ansiGreen
    warning: '#fede5d',
  },
  {
    id: 'shades-of-purple',
    name: 'Shades of Purple',
    mode: 'dark',
    source:
      'https://github.com/ahmadawais/shades-of-purple-vscode/blob/master/themes/shades-of-purple-color-theme.json',
    syntax: 'shadesOfPurple',
    // This theme's chrome is darker than its editor, so the panel colour is the
    // canvas and the editor colour is the raised surface.
    bg: '#1e1e3f', // panel.background / titleBar.activeBackground
    fg: '#ffffff', // editor.foreground
    surface: '#2d2b55', // editor.background
    accent: '#fad000', // activityBarBadge.background — the signature yellow
    danger: '#ec3a37', // editorError.foreground
    success: '#3ad900', // terminal.ansiGreen
    // editorWarning is also #fad000; the palette's orange keeps warning
    // distinguishable from the accent.
    warning: '#ff9d00',
  },
  {
    id: 'tomorrow-night',
    name: 'Tomorrow Night',
    mode: 'dark',
    source:
      'https://github.com/chriskempson/tomorrow-theme/blob/master/textmate/Tomorrow-Night.tmTheme',
    syntax: 'tomorrow',
    bg: '#1d1f21', // global background
    fg: '#c5c8c6', // global foreground
    surface: '#282a2e', // lineHighlight
    accent: '#81a2be', // Function / GitGutter changed
    danger: '#cc6666', // GitGutter deleted
    success: '#b5bd68', // GitGutter inserted
    warning: '#f0c674', // Class, Support
  },
  {
    id: 'atom-dark',
    name: 'Atom Dark',
    mode: 'dark',
    source:
      'https://github.com/atom/atom-dark-syntax/blob/master/styles/syntax-variables.less',
    syntax: 'atomDark',
    // Derived from Tomorrow Night upstream, so it shares that palette's
    // background and text exactly; the accent and status colours differ.
    bg: '#1d1f21', // @syntax-background-color
    fg: '#c5c8c6', // @syntax-text-color
    surface: '#292c2f', // @syntax-gutter-background-color: lighten(bg, 5%)
    accent: '#62b1fe', // @syntax-color-class
    danger: '#cc6666', // @syntax-color-removed
    success: '#a8ff60', // @syntax-color-added
    warning: '#e9c062', // @syntax-color-modified
  },
  {
    id: 'yonce',
    name: 'Yoncé',
    mode: 'dark',
    source:
      'https://github.com/minamarkham/yonce-vscode/blob/master/themes/Yonc%C3%A9-color-theme.json',
    bg: '#1c1c1c', // editor.background
    fg: '#d4d4d4', // editor.foreground
    surface: '#272727', // editorWidget.background
    accent: '#fc4384', // button.background / textLink.foreground
    // ansiRed is the accent pink, so error state comes from editorError instead.
    danger: '#c42412', // editorError.foreground
    success: '#98e342', // terminal.ansiGreen
    warning: '#f39b35', // editorWarning.foreground
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    mode: 'dark',
    source:
      'https://github.com/primer/primitives/blob/main/src/tokens/base/color/dark/dark.json5',
    bg: '#0d1117', // scale.neutral.1
    fg: '#f0f6fc', // scale.neutral.12
    surface: '#151b23', // scale.neutral.2
    accent: '#58a6ff', // scale.blue.3
    danger: '#f85149', // scale.red.4
    success: '#3fb950', // scale.green.3
    warning: '#d29922', // scale.yellow.3
  },

  // ── Light ─────────────────────────────────────────────────────────────────
  {
    id: 'light',
    name: 'Light',
    mode: 'light',
    bg: '#fafafa',
    fg: '#2e2e2e',
    surface: '#ebebeb',
    accent: '#2563eb',
    danger: '#dc2626',
    success: '#16a34a',
    warning: '#ca8a04',
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    mode: 'light',
    source: 'https://ethanschoonover.com/solarized/',
    syntax: 'solarizedlight',
    bg: '#fdf6e3', // base3  — spec's light background
    // The spec's light body text is base00 (#657b83), which reads at 4.1:1 on
    // base3 — below our 4.5:1 floor. base01 is the spec's "emphasized content"
    // for light and clears it at 5.0:1. The only palette we deviate on.
    fg: '#586e75', // base01
    surface: '#eee8d5', // base2  — spec's light highlight
    accent: '#268bd2', // blue
    danger: '#dc322f', // red
    success: '#859900', // green
    warning: '#b58900', // yellow
  },
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    mode: 'light',
    source: 'https://github.com/catppuccin/palette/blob/main/palette.json',
    bg: '#eff1f5', // base
    fg: '#4c4f69', // text
    surface: '#ccd0da', // surface0
    accent: '#8839ef', // mauve
    danger: '#d20f39', // red
    success: '#40a02b', // green
    warning: '#df8e1d', // yellow
  },
  {
    id: 'gruvbox-light',
    name: 'Gruvbox Light',
    mode: 'light',
    source: 'https://github.com/morhetz/gruvbox/blob/master/colors/gruvbox.vim',
    syntax: 'gruvboxLight',
    bg: '#fbf1c7', // light0
    fg: '#3c3836', // dark1
    surface: '#ebdbb2', // light1
    accent: '#076678', // faded_blue
    danger: '#9d0006', // faded_red
    success: '#79740e', // faded_green
    warning: '#b57614', // faded_yellow
  },
  {
    id: 'rose-pine-dawn',
    name: 'Rosé Pine Dawn',
    mode: 'light',
    source: 'https://github.com/rose-pine/palette/blob/main/palette.json',
    bg: '#faf4ed', // base
    fg: '#575279', // text
    surface: '#fffaf3', // surface
    accent: '#907aa9', // iris
    danger: '#b4637a', // love
    success: '#56949f', // foam
    warning: '#ea9d34', // gold
  },
  {
    id: 'github-light',
    name: 'GitHub Light',
    mode: 'light',
    source:
      'https://github.com/primer/primitives/blob/main/src/tokens/base/color/light/light.json5',
    bg: '#ffffff', // base.white
    fg: '#1f2328', // base.black
    surface: '#f6f8fa', // scale.neutral.1
    accent: '#0969da', // scale.blue.5
    danger: '#cf222e', // scale.red.5
    success: '#1a7f37', // scale.green.5
    warning: '#9a6700', // scale.yellow.5
  },
  {
    id: 'tokyo-night-day',
    name: 'Tokyo Night Day',
    mode: 'light',
    source:
      'https://github.com/enkia/tokyo-night-vscode-theme/blob/master/themes/tokyo-night-light-color-theme.json',
    bg: '#e6e7ed', // editor.background
    fg: '#343b59', // editor.foreground
    surface: '#d6d8df', // editorWidget.background
    accent: '#2959aa', // terminal.ansiBlue
    danger: '#8c4351', // terminal.ansiRed
    success: '#33635c', // terminal.ansiGreen
    warning: '#8f5e15', // terminal.ansiYellow
  },
  {
    id: 'everforest-light',
    name: 'Everforest Light',
    mode: 'light',
    source: 'https://github.com/sainnhe/everforest/blob/master/palette.md',
    bg: '#fdf6e3', // bg0, medium contrast
    fg: '#5c6a72', // fg
    surface: '#f4f0d9', // bg1, medium contrast
    accent: '#3a94c5', // blue
    danger: '#f85552', // red
    success: '#8da101', // green
    warning: '#dfa000', // yellow
  },
];

export const DEFAULT_THEME_ID = 'dark';

/**
 * The themes of one mode in picker order: lightest background first, so each
 * group darkens as you scan down it, with name as the tiebreaker — several
 * palettes share a background exactly (Dark/Yoncé, Solarized/Everforest Light),
 * and without it their order would rest on `Array.sort` stability rather than
 * anything intentional.
 *
 * Ordering is derived rather than declared so it can't drift as the catalogue
 * grows — entries above can be added wherever they read best.
 */
export function themesByMode(mode: ThemeMode): Theme[] {
  return THEMES.filter((t) => t.mode === mode).sort(
    (a, b) => luminance(b.bg) - luminance(a.bg) || a.name.localeCompare(b.name),
  );
}

export function getTheme(id: string | null | undefined): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}

/** The theme to render for `id`, falling back to the default for unknown ids. */
export function resolveBuiltIn(id: string | null | undefined): Theme {
  return getTheme(id) ?? getTheme(DEFAULT_THEME_ID)!;
}
