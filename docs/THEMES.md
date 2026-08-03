# Built-in themes

The catalogue lives in `src/lib/theme/themes.ts`, which is the single source of
truth. Each entry carries a `source` URL and per-value comments naming the
upstream token it came from, so any colour can be re-verified without guesswork.

A theme declares seven seeds (`bg`, `fg`, `surface`, `accent`, `danger`,
`success`, `warning`) plus a mode; everything else derives from those in
`globals.css`. `src/lib/theme/themes.test.ts` asserts every entry parses, is
distinct, and meets the contrast floors.

## Fidelity

Palettes are transcribed faithfully rather than adjusted to hit WCAG AA. Several
canonical palettes are lower-contrast by design, so the invariants assert "no
worse than the palettes we chose to ship", not "every theme is AA". Where a
value deviates from its spec, the reason is in a comment next to it — currently
only Solarized Light, whose spec body text (`base00`) falls below the 4.5:1
floor for text on background, so `base01` ("emphasized content") is used.

## Syntax styles

A theme's `syntax` key names a code style bound to both renderers at once. Some
come from `react-syntax-highlighter`; the rest are authored in
`src/lib/theme/syntax/`, one file per family, because those projects ship no
Prism port. Only the two stock themes (Dark, Light) have no style of their own —
they use the One Dark / One Light fallback, and a unit test asserts every other
theme names one.

Palette specs rarely say how to colour a token, so the source for a syntax style
is picked by this ladder:

1. The project's own syntax-highlighter port, if it has one.
2. Its own editor theme — VS Code or Neovim — where the project publishes one.
   This is where syntax styles depart from the palette rule above: for several
   families the editor theme _is_ the only spec there is.
3. Its palette spec plus our inference, commented as such at each value.

| Family      | Source                                                                                                 | Rung |
| ----------- | ------------------------------------------------------------------------------------------------------ | ---- |
| Catppuccin  | [catppuccin/highlightjs](https://github.com/catppuccin/highlightjs) role map + `@catppuccin/palette`   | 1    |
| Rosé Pine   | [rose-pine/neovim](https://github.com/rose-pine/neovim) highlight groups + `@rose-pine/palette`        | 2    |
| GitHub      | [primer/primitives](https://github.com/primer/primitives) `prettylights.syntax.*` tokens               | 1    |
| Tokyo Night | [enkia/tokyo-night-vscode-theme](https://github.com/enkia/tokyo-night-vscode-theme) `tokenColors`      | 2    |
| Yoncé       | [minamarkham/yonce-vscode](https://github.com/minamarkham/yonce-vscode) `tokenColors`                  | 2    |
| Everforest  | [sainnhe/everforest](https://github.com/sainnhe/everforest) `colors/everforest.vim` groups             | 2    |
| Kanagawa    | [rebelot/kanagawa.nvim](https://github.com/rebelot/kanagawa.nvim) `syn` table                          | 2    |
| Ayu         | [ayu-theme/ayu-colors](https://github.com/ayu-theme/ayu-colors) — its spec names syntax roles directly | 1    |

The Catppuccin and Rosé Pine palette tables are pinned to their npm packages by
a unit test; both are devDependencies only, so neither reaches the bundle.

Catppuccin ships each of its four flavours in all fourteen palette accents, as
its ports do — in the theme catalogue and the syntax styles alike, generated
from one shared table in `catppuccinPalette.ts`. The accent moves the theme's
`accent` seed and, in the syntax style, replaces mauve — the port's colour for
keywords, variables and tag names. Nothing else changes. That gives Catppuccin
two axes, so both pickers group its accents under their flavour.

Two deliberate deviations:

- **Fill.** Upstream ports paint a fence with the palette's canvas. These use its
  raised tone instead — the same one `themes.ts` picks for `surface` — so a fence
  still reads as a slab when the theme and the style match.
- **Font.** Authored styles name no font, and the bundled ones have theirs
  stripped, so picking a style no longer changes the code font as a side effect
  and fences match the editors, which never saw it.

Where a Prism token has no upstream analogue (`atrule`, `entity`), the nearest
one is used and the comment says it is our inference. Tokens a project leaves at
the default foreground stay uncoloured — GitHub's punctuation and properties, for
instance — rather than being given an invented colour.

## Attribution

Colour values are facts and aren't themselves copyrightable, but the projects
they come from deserve credit. All of the below are MIT except where noted; the
permissive licences here are all compatible with this project's MIT licence.

Material's original upstream (`equinusocio` / `material-theme`) was rebranded and
no longer publishes a palette, so its entry points at the maintained Apache-2.0
fork the values were actually read from.

| Theme(s)                                      | Project                                                                                     | License                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------ |
| Nord                                          | [arcticicestudio/nord](https://github.com/arcticicestudio/nord)                             | MIT                      |
| Dracula                                       | [dracula/dracula-theme](https://github.com/dracula/dracula-theme)                           | MIT                      |
| Gruvbox Dark / Light                          | [morhetz/gruvbox](https://github.com/morhetz/gruvbox)                                       | No license file upstream |
| Solarized Dark / Light                        | [altercation/solarized](https://github.com/altercation/solarized)                           | MIT                      |
| Catppuccin Mocha / Macchiato / Frappé / Latte | [catppuccin/catppuccin](https://github.com/catppuccin/catppuccin)                           | MIT                      |
| Tokyo Night / Storm / Day                     | [enkia/tokyo-night-vscode-theme](https://github.com/enkia/tokyo-night-vscode-theme)         | MIT                      |
| One Dark                                      | [atom/one-dark-syntax](https://github.com/atom/one-dark-syntax)                             | MIT                      |
| Rosé Pine / Moon / Dawn                       | [rose-pine/rose-pine-theme](https://github.com/rose-pine/rose-pine-theme)                   | MIT                      |
| Everforest Dark / Light                       | [sainnhe/everforest](https://github.com/sainnhe/everforest)                                 | MIT                      |
| GitHub Dark / Light / Dark High Contrast      | [primer/primitives](https://github.com/primer/primitives)                                   | MIT                      |
| Ayu Dark                                      | [ayu-theme/ayu-colors](https://github.com/ayu-theme/ayu-colors)                             | MIT                      |
| Night Owl                                     | [sdras/night-owl-vscode-theme](https://github.com/sdras/night-owl-vscode-theme)             | MIT                      |
| Kanagawa Dragon                               | [rebelot/kanagawa.nvim](https://github.com/rebelot/kanagawa.nvim)                           | MIT                      |
| Yoncé                                         | [minamarkham/yonce-vscode](https://github.com/minamarkham/yonce-vscode)                     | MIT                      |
| Synthwave '84                                 | [robb0wen/synthwave-vscode](https://github.com/robb0wen/synthwave-vscode)                   | MIT                      |
| Shades of Purple                              | [ahmadawais/shades-of-purple-vscode](https://github.com/ahmadawais/shades-of-purple-vscode) | MIT                      |
| Tomorrow Night                                | [chriskempson/tomorrow-theme](https://github.com/chriskempson/tomorrow-theme)               | MIT                      |
| Atom Dark                                     | [atom/atom-dark-syntax](https://github.com/atom/atom-dark-syntax)                           | MIT                      |
| Material Ocean / Palenight / Darker           | [Dramaga11/vsc-material-theme](https://github.com/Dramaga11/vsc-material-theme)             | Apache-2.0               |

Dark and Light (the two stock themes) are this project's own.

## Adding a theme

1. Transcribe from the project's own palette spec — not a VS Code port or a
   third-party gist. Record the URL in `source` and name each value in a comment.
2. Map `success`/`warning`/`danger` using the palette's documented git or
   diagnostic semantics (added / modified / deleted) rather than raw hue names.
   Some palettes have no green: Rosé Pine maps "added" to foam.
3. Use the palette's own raised/panel tone for `surface`. If the spec has no
   such token, say so in a comment.
4. If it is one of several themes from the same palette, set `family` and
   `variant` — the picker groups tiles by family, and a family needs at least two
   members.
5. Every theme needs a `syntax` style. If `react-syntax-highlighter` bundles the
   palette's own, import it in `syntax/index.ts`. Otherwise author one: add a
   family file under `syntax/` using `buildPrismStyle`, sourced by the ladder
   above. Either way, register it in `PRISM_STYLES` and `SYNTAX_STYLES` (the unit
   tests assert the two agree), then set `syntax`. The CodeMirror binding is
   derived from the Prism style, so editors follow for free.
6. Run `npm run test:unit` — the invariants catch a mistyped hex, a missing
   syntax style, and a broken family.
