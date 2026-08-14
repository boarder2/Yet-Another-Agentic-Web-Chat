---
name: implement
description: 'Implement a piece of work based on a spec or set of tickets.'
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

For any user-visible change, review the relevant `docs/capabilities/` page and update it in the same change when the behavior, prerequisites, limits, privacy, availability, or failure states change. The authoritative capability pages describe current behavior only: do not add history or roadmap prose there.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use /code-review to review the work and fix high impact issues.

Iterate until the build, linting, and full test suite pass without issues and code review is clean. Do not skip linting, even pre-existing issues must be fixed.
