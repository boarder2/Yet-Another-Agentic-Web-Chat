# Detectors

Six categories. Closed set — if a finding fits none of them, it isn't this skill's business.

Each finding needs: the files, what's inconsistent, what the unified version is, and evidence (census counts, or read files). No finding ships on suspicion alone.

---

## 1. Token drift

A raw value sits where a token exists.

**Signals** — census `tokenBypasses` (a token's literal value appearing outside its definition), `colors`, `sizes`, `arbitraryValues`. Hardcoded hex/rgb/oklch, raw px/rem, escape-hatch syntax (`text-[10px]`, `w-[347px]`), raw palette classes (`bg-red-500`) where semantic tokens exist, `#fff`/`white`/`black` in a themed app.

**Strongest form:** the value breaks under a theme flip. A hardcoded light-mode color surviving into dark mode is the most persuasive card in the report — lead with these.

**Verify:** the token genuinely covers the case. A one-off brand color in a logo is not drift.

## 2. Visual inconsistency

Sibling UI that should match, doesn't.

**Signals** — census `properties` and `utilityFrequency` showing near-miss clusters: `p-3` vs `p-4` on peer cards, `text-sm` vs `text-[13px]`, three radii on the same kind of surface, four shadow values, transition durations that don't agree, font weights drifting across equivalent headings.

**Method:** group elements by _role_ (page heading, card, form row, empty state), then compare within the group. Variance across roles is fine; variance within one is the finding.

**Degraded without the rendered pass.** Source catches spacing, typography, and radius variance. True misalignment, overflow, and contrast failures require Phase 3 — say so rather than guessing.

## 3. Duplication

The same markup or logic, written repeatedly.

**Signals** — census `repeatedClassStrings` (high count across many files) and `duplicateCandidates`.

**Verify every candidate by reading the files.** A shingle hash match is a lead. Confirm the blocks do the same _job_ — coincidentally similar structure is not duplication, and reporting it as such is a fabricated finding.

**Threshold:** 3+ occurrences, or 2 that are load-bearing. Two similar blocks are a coincidence; three are a pattern.

**Fix shape:** name the extraction — shared component, hook, or a variant prop on an existing component. Say which existing component should absorb it before proposing a new one.

## 4. Pattern divergence

One UI concept built two or more ways.

**Signals** — multiple modal/dialog implementations, competing form-field wrappers, several toast or empty-state approaches, two icon libraries, both a `<Button>` component and raw `<button>` styling, mixed data-fetching patterns in components.

**Method:** census won't hand you these. Inventory by concept — grep for the concept's vocabulary across the UI (`Dialog`, `Modal`, `Popover`) and count distinct implementations.

**Fix shape:** pick the winner explicitly and justify it (most adopted, most capable, most accessible), then list what migrates.

## 5. Interaction-state gaps

States that exist in some places and not others.

**Signals** — hover/focus-visible/active/disabled present on some interactive elements and missing on peers; loading states that are a spinner here and a skeleton there and nothing there; inconsistent or absent empty states; error display that varies by form; missing `cursor-pointer`; focus rings removed without replacement.

**Method:** enumerate the interactive elements of one kind, then check each state across all of them. A missing focus-visible ring is both a consistency and an accessibility finding — report it under this category, not as a general a11y audit.

## 6. Superfluous code

**Attached findings only** — never a standalone hunt.

Report only what gets deleted _as part of_ a fix from categories 1–5: wrapper divs the extraction removes, props no longer passed, class strings the shared component absorbs, comments narrating code that's about to disappear, commented-out markup in the touched file.

If it isn't deleted by a fix you're already proposing, leave it — `/simplify` and `/code-review` own that.

---

## Ripgrep fallback

For non-Node projects, or to spot-check the census. Adjust globs to the project's file types.

```bash
# Color literals
rg -no --no-heading '#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch|oklab)\([^)]*\)' -g '!node_modules'

# Raw sizes in stylesheets
rg -no --no-heading '(?<![\w.-])\d+(\.\d+)?(px|rem|em)\b' -g '*.{css,scss,less}'

# Escape-hatch / arbitrary utility values
rg -no --no-heading '\b[\w-]+-\[[^\]\s]+\]' -g '*.{tsx,jsx,html,vue,svelte}'

# Token definitions, then adoption
rg -no --no-heading '(--[\w-]+)\s*:' -g '*.{css,scss}'
rg -c 'var\(--token-name' -g '!node_modules'

# Repeated class strings — sort | uniq -c is the whole trick
rg -o '(?:className|class)="([^"]+)"' -r '$1' -g '*.{tsx,jsx,html,vue,svelte}' | sort | uniq -c | sort -rn | head -40

# Competing implementations of one concept
rg -l 'Dialog|Modal|Popover' -g '*.{tsx,jsx,vue,svelte}'

# Interactive elements missing focus states
rg -l '<button' -g '*.{tsx,jsx}' | xargs rg -L 'focus-visible|focus:'
```

## Scoring

**Reach** — files touched, call sites, screens affected, user visibility. Census counts feed this directly.
**Effort** — mechanical (find/replace, no decisions) through design judgment (someone must choose the canonical form).

| Badge         | Shape                                                     |
| ------------- | --------------------------------------------------------- |
| `Strong`      | High reach, and either mechanical or an obvious winner    |
| `Worth doing` | Real but narrower reach, or needs a design call           |
| `Speculative` | Low reach, or the "correct" version is genuinely arguable |

Theme-breaking token drift outranks its raw reach — a hardcoded color that breaks dark mode is `Strong` even in one file.
