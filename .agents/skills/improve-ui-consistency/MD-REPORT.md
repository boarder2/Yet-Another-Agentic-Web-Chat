# Markdown Report Format

The acting half of the pair. Same findings, same numbers, no replicas — written so a reader can paste a section into an issue, `rg` a site list, or hand a numbered item to another agent as a self-contained task.

Written to `<tmpdir>/ui-consistency-<ts>.md`, sharing its timestamp with the HTML. Never to the repo.

**It is not a transcript of the HTML.** The HTML argues visually; this argues in file paths and counts. Where the HTML shows a replica of three drifted paddings, this lists the three `path:line` sites and the class string at each. If a claim only works as a picture, cite the card instead of describing the picture.

## Shape

````markdown
# UI consistency — {{repo}}

{{date}} · {{scope}} · {{files}} files · {{flavor}}
Full report with replicas and screenshots: `{{absolute path to the .html}}`

## Coverage

| Category | Depth    | Note                                        |
| -------- | -------- | ------------------------------------------- |
| …        | full     | census + rendered sampling                  |
| …        | degraded | source only — no rendered pass on X screens |

## Baseline

Resolved tokens as a table (name, light, dark). Adoption per group: declared vs. measured vs. gap.
When no system was declared, recommendation 0 is the proposed one.

## Recommendations

| #   | Recommendation | Category | Badge  | Reach               | Effort     |
| --- | -------------- | -------- | ------ | ------------------- | ---------- |
| 1   | …              | …        | Strong | 14 files · 43 sites | mechanical |

### 1. {{title}}

`Strong` · token-drift · 14 files · 43 sites · mechanical

**Problem.** One sentence.
**Fix.** One sentence naming the primitive, token or pattern that absorbs it.

**Sites**

```
path/to/file.tsx:41   bg-fg/5 px-2 py-0.5
path/to/other.tsx:88  bg-surface-2 px-1.5 py-0.5
```

**Before / after** — real source in `before`, `after` marked proposed. Only when the diff is the clearest statement of the fix; skip it when the site list already says everything.

**Wins** — ≤6 words each, bulleted.

## Also noted

The same table columns as the HTML, numbered continuously.

## Top recommendation

One paragraph. Which number to do first and why.
````

## Rules

- **Numbers are shared with the HTML and are the addressing scheme.** `### 7.` here is `id="f7"` there. Never renumber one file without the other.
- **Every site is `path:line`**, one per line in a fenced block — greppable, clickable, diffable. A site list is not a sample: if a finding claims 43 sites, list 43 (fold a long tail into `+ 12 more in <dir>` only past ~25).
- **Every count came from the census or a printed grep**, and says which. No estimates.
- **Fenced blocks are labelled** `before` / `after (proposed)` so generated code is never mistaken for real source.
- Same banned vocabulary as the HTML: no "cleaner", "more maintainable", "best practice", "improved DX". A claim is a count, a file, or a rendered difference.
- Keep it terse. This file gets skimmed for the one section the reader is about to act on.
