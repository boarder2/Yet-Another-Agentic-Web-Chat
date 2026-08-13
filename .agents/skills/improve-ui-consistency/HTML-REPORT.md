# HTML Report Format

A single self-contained file in the OS temp dir. Tailwind CDN for the report's own layout; screenshots base64-inlined and downscaled so the file survives being moved or shared. Nothing else external.

**The replica is the point.** A card that only describes an inconsistency has failed — the reader must _see_ the drift, then see it resolved.

This is the reading half of the pair; [MD-REPORT.md](MD-REPORT.md) is the acting half. Both carry the same numbering (Phase 4): cards take `1..k`, the also-noted rows continue to `n`. Every card's anchor is its number — `id="f7"` for recommendation 7 — so the Markdown can link straight into it.

## Scaffold

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>UI consistency — {{repo name}}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      /* Resolved project tokens, inlined as literals so replicas paint truthfully. */
      .rep {
        --surface: #ffffff;
        --fg: #0f172a;
        --accent: #6366f1;
      }
      .rep-dark {
        --surface: #0f172a;
        --fg: #f8fafc;
        --accent: #818cf8;
      }
      .rep * {
        font-family: 'ProjectFont', system-ui;
      }
      .drift {
        outline: 1px dashed #dc2626;
        outline-offset: 2px;
      }
    </style>
  </head>
  <body class="bg-stone-950 font-sans text-stone-100">
    <main class="mx-auto max-w-6xl space-y-12 px-6 py-12">
      <header>...</header>
      <section id="baseline">...</section>
      <section id="findings" class="space-y-10">...</section>
      <section id="also-noted">...</section>
      <section id="top-recommendation">...</section>
    </main>
  </body>
</html>
```

## Header

Repo name, date, scope of the run, styling flavor, files scanned. Then a **coverage strip** — one line per category showing `full` or `degraded`, and whether the rendered pass ran. No introduction paragraph.

## Baseline section

Compact. The resolved token set as swatches and values, adoption percentage per token group, and — when no design system was declared — **finding #0**: the proposed token set, with each near-miss cluster shown as the drifted values collapsing into one swatch.

## Finding card

One `<article id="f<number>">` per finding:

- **Number** — the recommendation's number, set large and muted beside the title so it reads as an address, not a bullet. It is what the user says back to you.
- **Title** — names the fix, not the flaw. "Collapse three modal shells into one" beats "Modal inconsistency".
- **Badge row** — `Strong` (emerald) / `Worth doing` (amber) / `Speculative` (slate), plus the category, plus reach (`14 files · 43 sites`) straight from the census.
- **Replica** — the centrepiece. See below.
- **Problem** — one sentence.
- **Fix** — one sentence naming the shared component, token, or pattern.
- **Code before/after** — the duplicated markup collapsing. Real source in `before`; the `after` clearly marked as proposed.
- **Wins** — bullets, ≤6 words: "43 sites → 1 component", "survives theme flip", "−180 lines".

If the replica needs a paragraph to be understood, rebuild the replica.

## Replica patterns

Built with inlined literal values from the baseline — **never invented**. Mark every replica `reconstruction from source` in small caps. Where the rendered pass captured the real screen, put the screenshot beside the replica.

**Side-by-side variants** — the default. Each drifted version rendered at real values, labelled with its file, the differing property called out beneath (`p-3` vs `p-4` vs `p-3.5`). Then the unified version, visually separated.

**Theme pair** — every replica renders in both light and dark when the project has them, using `.rep` / `.rep-dark`. Hardcoded values that break under the flip are the report's most persuasive evidence; give them the full pair even when it doubles the card's width.

**Overlay diff** — for spacing and alignment. Stack the variants with dashed guide lines showing where edges should agree and don't. Good for the render-only findings.

**Swatch grid** — for palette drift. The near-miss colors as adjacent chips with their hex values and use counts, then the single token replacing them. The eye does the argument.

**Occurrence map** — for duplication reach. A dense grid, one cell per file, cells lit where the duplicate appears. Makes "43 sites" concrete without a wall of paths.

## Also-noted table

Everything below the card cut, continuing the same number run. Five columns: number, file, category, one-line description, badge. Sorted by category. Nothing is lost; it just doesn't get a replica.

## Top recommendation

One larger card. Which finding to do first **by number**, one sentence on why, anchor link. That's it.

## Style

- Editorial, not corporate-dashboard. Generous whitespace. `font-serif` headings work well with stone/slate.
- The report's own chrome is dark (`bg-stone-950`/`text-stone-100`) and must stay visually distinct from the replicas — the reader should never confuse report UI with project UI. Cards and tables sit on a lighter stone-900 panel (`bg-stone-900 border border-stone-800`) so they read as chrome, not content; let replicas be the only saturated colour on the page, and give each replica its own light card (`bg-white`/`bg-stone-50`) so a light-mode replica never blends into the dark page.
- Colour sparingly outside replicas: one accent, red for drift, amber for warnings — bump to `-400` shades (e.g. `text-emerald-400`, `text-amber-400`, `text-red-400`) so badges stay legible on the dark chrome.
- `text-xs uppercase tracking-wider` for labels inside replicas — schematic, not UI.
- Tailwind CDN is the only script. No interactivity beyond the theme pairs rendering side by side.

## Tone

Plain, concrete, countable. Say "43 sites across 14 files", not "widely duplicated". Say "`#1a1a1a`, `#1b1b1b`, `#191919` → `--surface`", not "inconsistent colors".

Never write "cleaner", "more maintainable", "best practice", or "improved DX" — they assert nothing. Every claim is a count, a file, or a rendered difference.
