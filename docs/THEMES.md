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
4. Run `npm run test:unit` — the invariants catch a mistyped hex.
5. If the palette ships an official syntax style bundled with
   `react-syntax-highlighter`, add it to `PRISM_STYLES` and `SYNTAX_LABELS` in
   `syntax.ts` (the unit tests assert the two agree), then set `syntax`. The
   CodeMirror binding is derived from the Prism style, so editors follow for
   free.
