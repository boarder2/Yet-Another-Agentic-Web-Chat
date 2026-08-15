# Built-in themes

This is the maintainer and contributor reference for theme provenance. The
runtime catalogue lives in `src/lib/theme/themes.ts`; it is the single source
of truth for built-in palettes. The in-app user guide is
[Administration and settings](https://github.com/boarder2/Yet-Another-Agentic-Web-Chat/blob/main/docs/capabilities/administration-and-settings.md).
This page stays GitHub-only because it documents source and contribution
workflow rather than an application capability.

## Catalogue

A theme is seven seeds (`bg`, `fg`, `surface`, `accent`, `danger`, `success`,
and `warning`) plus a `mode`. The rest of the UI palette derives from those
seeds in `src/app/globals.css`. At the current catalogue size there are 87 built-ins:
66 dark and 21 light.

The catalogue has eight multi-member families:

- Catppuccin — 56 generated entries (four flavours × fourteen accents)
- GitHub — 3 variants
- Material — 3 variants
- Rosé Pine — 3 variants
- Tokyo Night — 3 variants
- Everforest, Gruvbox, and Solarized — 2 variants each

The remaining entries are standalone: Dark, Light, Nord, Dracula, One Dark,
Ayu Dark, Night Owl, Kanagawa Dragon, Synthwave '84, Shades of Purple,
Tomorrow Night, Atom Dark, and Yoncé. Generated Catppuccin variants are kept in
shared palette data; do not duplicate all 56 entries in documentation or add
hand-written variants when extending that family.

Third-party entries carry a canonical `source` URL. Hand-authored values in
`themes.ts` name the upstream token in comments. Catppuccin values are generated
from `src/lib/theme/catppuccinPalette.ts`, whose shared table is pinned by a
unit test; Rosé Pine's syntax palette has the same package-backed check. Dark
and Light are YAAWC's stock themes and intentionally have no upstream source.

## Fidelity and tests

Palettes are transcribed faithfully rather than adjusted to reach WCAG AA.
The catalogue tests assert valid hex seeds, declared modes, unique IDs and
names, readable text, status-colour floors, and distinct surfaces. The floors
mean “no worse than the palettes we chose to ship”, not “every theme is AA”.
Solarized Light is the deliberate exception to literal body-text transcription:
its `base00` is below the 4.5:1 text-on-background floor, so the catalogue uses
`base01` (`#586e75`) for `fg` and records that reason beside the value.

## Syntax styles

`Theme.syntax` is the shared key for Markdown fences and CodeMirror editors.
The registry currently contains 85 keys in both `PRISM_STYLES` and
`SYNTAX_STYLES`, grouped into `SYNTAX_FAMILIES`. Fifteen styles come from
`react-syntax-highlighter`; the remaining styles are authored under
`src/lib/theme/syntax/` because their projects do not ship a Prism port. The
two stock themes omit `syntax` and fall back to One Dark or One Light by mode.

The source ladder for an authored syntax style is:

1. The project's own syntax-highlighter port, when one exists.
2. Its own editor theme — VS Code or Neovim — when that is the published
   specification.
3. Its palette specification plus a documented inference when neither exists.

| Family      | Current source                                                                               | Rung |
| ----------- | -------------------------------------------------------------------------------------------- | ---: |
| Catppuccin  | [highlightjs role map](https://github.com/catppuccin/highlightjs) plus `@catppuccin/palette` |    1 |
| Rosé Pine   | [Neovim highlight groups](https://github.com/rose-pine/neovim) plus `@rose-pine/palette`     |    2 |
| GitHub      | [Primer syntax tokens](https://github.com/primer/primitives)                                 |    1 |
| Tokyo Night | [VS Code token colours](https://github.com/enkia/tokyo-night-vscode-theme)                   |    2 |
| Yoncé       | [VS Code token colours](https://github.com/minamarkham/yonce-vscode)                         |    2 |
| Everforest  | [Vim highlight groups](https://github.com/sainnhe/everforest)                                |    2 |
| Kanagawa    | [Neovim syntax groups](https://github.com/rebelot/kanagawa.nvim)                             |    2 |
| Ayu         | [Ayu's syntax-role palette](https://github.com/ayu-theme/ayu-colors)                         |    1 |

Catppuccin provides four flavours in all fourteen accents in both the theme and
syntax catalogues. The default mauve accent keeps the existing base key; other
accents are generated from the same table. Changing an accent moves the theme's
`accent` seed and replaces mauve in the syntax roles that the port assigns to
keywords, variables, tags, and at-rules; the remaining flavour values stay the
same.

Two implementation choices are deliberate:

- **Fill:** authored styles use the palette's raised tone for the fence fill,
  rather than the canvas fill used by some upstream ports, so a matching fence
  still reads as a slab.
- **Font:** authored styles omit `fontFamily`, and bundled font declarations
  are stripped. Selecting a syntax style therefore does not change the app's
  code font, and fences and editors stay on the same mono stack.

The syntax tests pin the Catppuccin and Rosé Pine package tables, check authored
foregrounds and fills, and keep the Prism and CodeMirror bindings complete.
They also assert that `PRISM_STYLES` and `SYNTAX_STYLES` have the same keys,
that every non-stock theme names a registered style, and that every registered
style is reachable through `SYNTAX_FAMILIES`. A missing colour is left at the
renderer default when the upstream project leaves that token uncoloured; an
inferred mapping is called out beside the mapping.

## Attribution

The table credits the upstream palette or editor project. All listed projects
are MIT except Gruvbox, whose upstream has no license file, and Material, whose
source fork is Apache-2.0. The entries use the upstream values as data; they do
not copy upstream implementation code.

| Theme(s)                                 | Upstream project                                                                            | License                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------ |
| Nord                                     | [nordtheme.com](https://www.nordtheme.com/docs/colors-and-palettes)                         | MIT                      |
| Dracula                                  | [dracula-theme](https://github.com/dracula/dracula-theme)                                   | MIT                      |
| Gruvbox Dark / Light                     | [morhetz/gruvbox](https://github.com/morhetz/gruvbox)                                       | No license file upstream |
| Solarized Dark / Light                   | [Solarized](https://ethanschoonover.com/solarized/)                                         | MIT                      |
| Catppuccin                               | [catppuccin/catppuccin](https://github.com/catppuccin/catppuccin)                           | MIT                      |
| Tokyo Night / Storm / Day                | [enkia/tokyo-night-vscode-theme](https://github.com/enkia/tokyo-night-vscode-theme)         | MIT                      |
| One Dark                                 | [atom/one-dark-syntax](https://github.com/atom/one-dark-syntax)                             | MIT                      |
| Rosé Pine / Moon / Dawn                  | [rose-pine/rose-pine-theme](https://github.com/rose-pine/rose-pine-theme)                   | MIT                      |
| Everforest Dark / Light                  | [sainnhe/everforest](https://github.com/sainnhe/everforest)                                 | MIT                      |
| GitHub Dark / Light / Dark High Contrast | [primer/primitives](https://github.com/primer/primitives)                                   | MIT                      |
| Ayu Dark                                 | [ayu-theme/ayu-colors](https://github.com/ayu-theme/ayu-colors)                             | MIT                      |
| Night Owl                                | [sdras/night-owl-vscode-theme](https://github.com/sdras/night-owl-vscode-theme)             | MIT                      |
| Kanagawa Dragon                          | [rebelot/kanagawa.nvim](https://github.com/rebelot/kanagawa.nvim)                           | MIT                      |
| Yoncé                                    | [minamarkham/yonce-vscode](https://github.com/minamarkham/yonce-vscode)                     | MIT                      |
| Synthwave '84                            | [robb0wen/synthwave-vscode](https://github.com/robb0wen/synthwave-vscode)                   | MIT                      |
| Shades of Purple                         | [ahmadawais/shades-of-purple-vscode](https://github.com/ahmadawais/shades-of-purple-vscode) | MIT                      |
| Tomorrow Night                           | [chriskempson/tomorrow-theme](https://github.com/chriskempson/tomorrow-theme)               | MIT                      |
| Atom Dark                                | [atom/atom-dark-syntax](https://github.com/atom/atom-dark-syntax)                           | MIT                      |
| Material Ocean / Palenight / Darker      | [Dramaga11/vsc-material-theme](https://github.com/Dramaga11/vsc-material-theme)             | Apache-2.0               |

Dark and Light are YAAWC's own stock themes.

## Adding a theme

1. Add a hand-authored entry to `src/lib/theme/themes.ts` from the project's
   canonical palette or editor specification, not a third-party gist or an
   unrelated port. Record its `source` URL and annotate upstream roles,
   deliberate mappings, and deviations so the values can be re-verified. For a
   generated family, extend the shared palette table instead of copying entries.
2. Map `success`, `warning`, and `danger` from documented added/modified/deleted
   or diagnostic roles rather than from raw hue names. If the palette has no
   direct role, document the closest intentional mapping.
3. Use the palette's raised or panel tone for `surface`; document the choice when
   the specification has no such token.
4. Use `family` and `variant` only for a real multi-member family. Add `group`
   when the family has a second axis, as Catppuccin does. The catalogue tests
   require family/variant pairing, unique variants within their group, and more
   than one member per declared family.
5. Give every non-stock theme a `syntax` key. Use a bundled style when
   `react-syntax-highlighter` provides the source; otherwise add a family file
   under `src/lib/theme/syntax/` with `buildPrismStyle`. Register the binding in
   `PRISM_STYLES` and its label/group in `SYNTAX_STYLES`; `SYNTAX_FAMILIES` is
   derived from that metadata. The CodeMirror binding is derived from the same
   Prism style, so it needs no separate palette copy.
6. Run `npm run test:unit`. The theme and syntax invariants catch invalid seeds,
   missing style registrations, broken family metadata, low-contrast regressions,
   duplicate IDs or names, and incomplete generated palette coverage.
