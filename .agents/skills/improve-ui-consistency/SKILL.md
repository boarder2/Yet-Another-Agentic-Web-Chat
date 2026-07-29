---
name: improve-ui-consistency
description: Scan a UI for visual inconsistency, token drift, and duplication; present them as a visual HTML report, then fix whichever one you pick.
disable-model-invocation: true
---

# Improve UI Consistency

Find where the UI contradicts itself — raw values where a token exists, sibling screens that drifted apart, the same component built three ways — and present each as a card that _shows_ the problem and the fix.

Portable: nothing here assumes a framework, a styling approach, or this repo.

**Argument** (optional) scopes the run: a directory, a route, or a diff range (`since main`). Default is the whole UI. State the scope in the report header.

## Scope rule

Every finding is about the **UI layer**, justified by visual consistency or UI reuse.

Dead code, redundant wrappers, and narrating comments are reported **only when attached to another finding** — the wrapper divs deleted while extracting a shared card, the comments in the component being consolidated. Never hunt them standalone; that's `/simplify` and `/code-review`.

## Phase 0 — Baseline

Establish what "correct" means before judging anything.

1. **Find the declared system.** In order: a design-system skill or doc, `@theme` / Tailwind config, CSS custom properties, a theme module, Storybook, design tokens JSON.
2. **Resolve every token to its literal value.** The report renders replicas from these literals — `bg-surface` means nothing to a CDN stylesheet. Record light and dark (and any other theme) values separately.
3. **Measure adoption** via the census (Phase 1).

The declared system is the standard. Empirical majority fills gaps where nothing is declared. **Where they disagree — a token exists but 40 files ignore it — that gap is a top-tier finding**, not a footnote.

**No declared system at all?** Derive one: cluster the palette, spacing, radii, and type sizes actually in use by frequency, collapsing near-misses (`#1a1a1a` / `#1b1b1b` / `#191919` → one token). The report opens with this as **finding #0** — "no design system; here is the one your code already implies" — and every later card references those proposed names, so the report has an anchor instead of degrading into unanchored nitpicks.

## Phase 1 — Census

```
node <skill-dir>/census.mjs --root <repo> [--area src/components] [--json] [--top 25]
```

Zero-dep Node. Sniffs styling flavor (utility classes / CSS modules / CSS-in-JS / plain declarations); `--flavor` forces one. Emits token bypasses, color and size literals, arbitrary escape-hatch values, declared property values, repeated class strings, utility frequency, and near-duplicate markup candidates.

Runs **once, centrally** — it is the only vantage point that sees across areas, which is where the best findings live.

No Node (Rails, Django, Blazor)? Use the ripgrep recipes in [DETECTORS.md](DETECTORS.md) and say in the report which path was taken.

**The census measures; it does not conclude.** Its counts are what make the report credible, so never estimate a number it can produce. Its `duplicateCandidates` are explicitly unverified — a fuzzy hash match is a lead, not a finding.

## Phase 2 — Fan out

Parallel `Explore` agents, one per UI area (route group or component directory). Give each the baseline, the census output, and the taxonomy in [DETECTORS.md](DETECTORS.md).

Each agent does the judgment-heavy work in its slice and **verifies every duplicate candidate by reading the real files** before it may become a finding.

Then merge, de-dupe across areas, and score.

## Phase 3 — Rendered pass (optional)

Only when a launch path exists (a project run skill, a detected dev script) **and** a browser driver is available. Skip it silently otherwise — but say in the report that it was skipped.

Runs **after scoring**, so it visits only what it needs: map top findings back to routes, add the entry screen, cap at ~6–8. Skip screens needing auth or seed data you can't produce; those cards ship replica-only with a note.

Two jobs:

- **Evidence** — screenshot the screens behind top findings; sample computed styles to confirm the resolved literals are what actually paints.
- **Render-only defects** — misalignment between siblings, overflow and clipping, contrast failures, a font silently falling back. These do not exist in source and are the only findings this phase originates.

It corroborates the source pass; it does not re-derive it.

## Phase 4 — Report

Write a self-contained HTML file to the OS temp dir — `$TMPDIR`, falling back to `/tmp` (`%TEMP%` on Windows) — as `<tmpdir>/ui-consistency-<timestamp>.html`. Open it (`open` / `xdg-open` / `start`) and state the absolute path. Never write to the repo.

Score each finding by **reach** (files, call sites, screens touched; user visibility) × **effort** (mechanical vs. needs design judgment) → `Strong` / `Worth doing` / `Speculative`. Full cards for the top ~10–12 by reach; everything else collapses into a compact "also noted" table. End with a Top recommendation.

See [HTML-REPORT.md](HTML-REPORT.md) for the scaffold, card anatomy, and replica patterns.

**Honesty constraints — the report's replicas are the one place it could lie convincingly:**

- Replicas are **reconstructions**. Label them as such. Every value in one must be read from source or sampled from the running app — **never invented, never approximated**.
- Say which categories ran degraded. Without the rendered pass, visual inconsistency catches spacing, typography, and radius _variance between siblings_ but cannot catch true misalignment. State that.
- A count in the report either came from the census or is not a count.

## Phase 5 — After the report

Ask: **"Which of these would you like me to take on?"** Propose nothing further, and touch nothing, until the user picks.

Once picked:

- **Mechanical** (token swaps, deleting dead props, collapsing identical class strings) — apply directly.
- **Needs design judgment** (what shape should the shared component take? which of three variants wins?) — run the `/grilling` skill first, then implement.

If the project documents its design system, update that doc in the same change when a fix establishes a new token or pattern.
