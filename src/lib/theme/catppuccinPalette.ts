/**
 * The Catppuccin palette, shared by the theme catalogue and the syntax styles —
 * both offer all four flavours in all fourteen accents, and neither should hold
 * its own copy of the hexes.
 *
 * Kept apart from `syntax/catppuccin.ts` so `themes.ts` can read the palette
 * without dragging seventy Prism style objects along with it.
 *
 * Values are pinned to `@catppuccin/palette` by a unit test, so a mistyped hex
 * fails the suite rather than shipping.
 * https://github.com/catppuccin/palette/blob/main/palette.json
 */

/** The palette's own accent list, in its documented order. */
export const ACCENTS = [
  'rosewater',
  'flamingo',
  'pink',
  'mauve',
  'red',
  'maroon',
  'peach',
  'yellow',
  'green',
  'teal',
  'sky',
  'sapphire',
  'blue',
  'lavender',
] as const;

export type Accent = (typeof ACCENTS)[number];

/** Catppuccin's default accent, and so the base variant of every flavour. */
export const DEFAULT_ACCENT: Accent = 'mauve';

export type Flavor = Record<Accent, string> & {
  text: string;
  subtext1: string;
  overlay2: string;
  surface0: string;
  base: string;
};

/** Flavours darkest first, which is the order both pickers list them in. */
export const FLAVOR_NAMES: Record<string, string> = {
  mocha: 'Mocha',
  macchiato: 'Macchiato',
  frappe: 'Frappé',
  latte: 'Latte',
};

export const FLAVORS: Record<string, Flavor> = {
  mocha: {
    rosewater: '#f5e0dc',
    flamingo: '#f2cdcd',
    pink: '#f5c2e7',
    mauve: '#cba6f7',
    red: '#f38ba8',
    maroon: '#eba0ac',
    peach: '#fab387',
    yellow: '#f9e2af',
    green: '#a6e3a1',
    teal: '#94e2d5',
    sky: '#89dceb',
    sapphire: '#74c7ec',
    blue: '#89b4fa',
    lavender: '#b4befe',
    text: '#cdd6f4',
    subtext1: '#bac2de',
    overlay2: '#9399b2',
    surface0: '#313244',
    base: '#1e1e2e',
  },
  macchiato: {
    rosewater: '#f4dbd6',
    flamingo: '#f0c6c6',
    pink: '#f5bde6',
    mauve: '#c6a0f6',
    red: '#ed8796',
    maroon: '#ee99a0',
    peach: '#f5a97f',
    yellow: '#eed49f',
    green: '#a6da95',
    teal: '#8bd5ca',
    sky: '#91d7e3',
    sapphire: '#7dc4e4',
    blue: '#8aadf4',
    lavender: '#b7bdf8',
    text: '#cad3f5',
    subtext1: '#b8c0e0',
    overlay2: '#939ab7',
    surface0: '#363a4f',
    base: '#24273a',
  },
  frappe: {
    rosewater: '#f2d5cf',
    flamingo: '#eebebe',
    pink: '#f4b8e4',
    mauve: '#ca9ee6',
    red: '#e78284',
    maroon: '#ea999c',
    peach: '#ef9f76',
    yellow: '#e5c890',
    green: '#a6d189',
    teal: '#81c8be',
    sky: '#99d1db',
    sapphire: '#85c1dc',
    blue: '#8caaee',
    lavender: '#babbf1',
    text: '#c6d0f5',
    subtext1: '#b5bfe2',
    overlay2: '#949cbb',
    surface0: '#414559',
    base: '#303446',
  },
  latte: {
    rosewater: '#dc8a78',
    flamingo: '#dd7878',
    pink: '#ea76cb',
    mauve: '#8839ef',
    red: '#d20f39',
    maroon: '#e64553',
    peach: '#fe640b',
    yellow: '#df8e1d',
    green: '#40a02b',
    teal: '#179299',
    sky: '#04a5e5',
    sapphire: '#209fb5',
    blue: '#1e66f5',
    lavender: '#7287fd',
    text: '#4c4f69',
    subtext1: '#5c5f77',
    overlay2: '#7c7f93',
    surface0: '#ccd0da',
    base: '#eff1f5',
  },
};

/** "rosewater" → "Rosewater". The label both pickers show for an accent. */
export const accentName = (accent: Accent): string =>
  accent[0].toUpperCase() + accent.slice(1);
