---
name: yaawc-runtime-skills
description: 'In-app chat skills—not .agents skills: scope/shadowing, model visibility, invocation, edit approvals, and persistence.'
---

# YAAWC Runtime Skills

This skill documents **in-app chat skills** resolved into YAAWC model runs. It does not document repository-agent skills under `.agents/skills/`. The two systems have separate discovery, persistence, invocation, and editing paths.

A runtime skill has `source`, `name`, `description`, `content`, optional DB `id`/`workspaceId`, and `disableModelInvocation` (`src/lib/skills/types.ts`). It is an instruction body, not a tool, persona, or methodology.

## Sources and resolution

`src/lib/skills/systemRegistry.ts` loads built-ins from `src/lib/skills/system/*.md` and programmatic builders. Built-ins require frontmatter name/description; code-backed builders override same-named files. Some built-ins are conditional—for example code-execution guidance is omitted when server configuration is unavailable.

`resolveSkillsForChat(workspaceId)` merges:

1. system skills;
2. enabled workspace user skills;
3. enabled global user skills.

System names are reserved. Workspace user skills shadow same-named global skills. Without a workspace, only global user rows apply. Keep exact-scope service lookup distinct from shadow resolution: CRUD/moves must not silently fall through from workspace to global.

`/api/skills` exposes user rows only; it does not list system skills or `.agents` skills.

## Visibility and invocation

`disableModelInvocation` means **slash-only**, not disabled:

- Enabled, model-visible skills appear by name/description in `buildSkillsPromptSection()` and may be loaded through `read_skill`.
- Enabled slash-only skills remain available through explicit `/skill-name` invocation but are hidden from the model's advertised list. This is prompt-level discoverability, not a secrecy boundary: the current `read_skill` lookup can resolve a valid guessed name.
- Disabled user skills neither resolve nor autocomplete.

Composer autocomplete is enabled-user-skill-only and follows the selected workspace. The client sends recognized slash names, while `src/app/api/chat/route.ts` resolves both message tokens and `body.invokedSkills` against the server set and persists only names that resolve. Unknown names have no effect; a direct API caller can explicitly invoke any enabled skill that resolves in scope.

`buildInvokedSkillsContext()` injects explicitly invoked bodies as mandatory instructions and must preserve CDATA escaping. `read_skill` accepts only names present in the run context, fails closed for unknown names, returns the full body, and persists a `skill_invocation` context row.

## Editing and approvals

Settings CRUD uses `/api/skills` directly. Model-proposed changes use `edit_skill` and an interactive approval:

- Supports create/update/delete, global/workspace scope, scope moves, and invocation visibility.
- Requires an interactive session/emitter; panels, subagents, and headless scheduled runs have no approval surface.
- Uses exact-scope lookup, destination-collision checks, and active-workspace validation.
- Approval payloads show old/new description, content, scope, and invocation state.
- A content hash plus existence bit is the current stale snapshot. It does not cover description, invocation flag, scope, or destination collisions; preserve or strengthen those checks rather than claiming full-record CAS.
- The normal UI sends explicit accept/reject responses. Resume input must be strictly validated: `edit_skill` currently treats only `decision === 'reject'` as rejection, so unknown response shapes must not be allowed to fall through to CRUD.

`SkillEditApproval.tsx` renders queued changes and diffs. Reconnect must preserve pending approval state through the streaming approval contract.

## Invariants

- Reserve system names at create/rename and retain resolver defense-in-depth.
- Enforce exact `(name, scope)` uniqueness.
- Keep `enabled` separate from `disableModelInvocation`.
- Preserve the lowercase name grammar and token scanner.
- API/settings validation caps name, description, and content. Do not claim those caps are universal unless `edit_skill` also calls the same validator.
- Unknown `read_skill` names fail closed; known slash-only names are hidden, not access-controlled.
- Persisted invocation context is still subject to overall model-context limits.

## Key files

- Core: `src/lib/skills/{types,validation,systemRegistry,resolve,service,runStore,promptSection}.ts`
- Built-ins: `src/lib/skills/system/`
- Tools: `src/lib/tools/agents/{readSkillTool,editSkillTool}.ts`
- Chat wiring: `src/app/api/chat/route.ts`
- API/UI: `src/app/api/skills/`, `src/lib/hooks/api/useSkills.ts`, settings skill components, composer autocomplete, and `SkillEditApproval.tsx`

## Verification

Use fast tests for prompt injection/CDATA, resolver precedence, enabled/model-visible filtering, exact-scope collisions/moves, `read_skill` persistence/errors, and stale/reject/cancel approvals. Use integration/UI coverage only for API-to-autocomplete or reconnect boundaries.

Update `docs/capabilities/agent-capabilities.md` when runtime-skill behavior, limits, privacy, availability, or failures change.

Related skills: `yaawc-prompt-system` for prompt placement; `yaawc-streaming-events` for edit approvals; `yaawc-api-endpoints` for route conventions; `yaawc-database` for schema/query changes.
