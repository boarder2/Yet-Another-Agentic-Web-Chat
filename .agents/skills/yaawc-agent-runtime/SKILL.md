---
name: yaawc-agent-runtime
description: 'SimplifiedAgent toolsets and run lifecycle: checkpoints, resume/interrupts, cancellation, run hosting, and token tracking.'
---

# Agent Runtime

This skill owns a top-level turn from chat-route wiring through terminal persistence: `SimplifiedAgent`, `AgentStreamDriver`, checkpoint/resume, run hub/host, cancellation, and token tracking. Prompt content, individual tools, stream vocabulary, Panel, and deep-research internals belong to their specialized skills.

The durable boundary is the strict versioned `AgentRunConfig`. Its v2 snapshot carries resolver-effective Chat/System and panel executor model references, including optional native reasoning effort; v1 snapshots decode as Provider default. Never persist live models, signals, embeddings, retrieved memory text, invoked skill bodies, or secrets. Agent producers emit typed events; `runHost`, not the agent, owns wire translation and durable assistant projection.

## New-turn lifecycle

1. `/api/chat` checks message idempotency. An existing `running` or `awaiting_user` run is re-subscribed, not duplicated.
2. Create one emitter, `TokenTracker`, root recorders, chart registry, hard-abort controller, and separate retrieval controller per turn.
3. Build a stable thread ID and strict run snapshot. Construct `SimplifiedAgent`, then call `startRun()` and `attachRunHost()` before launching work.
4. Launch `searchAndAnswer()` without awaiting it and subscribe the HTTP response to the hub. Client disconnect removes a subscriber; it does not cancel the background run.
5. The host folds events into content/widgets/sources/stats. On `agent_end`, emit `messageEnd`, finalize DB state, delete the completed checkpoint, and clear active markers.

## Toolset and context

Dynamic top-level getters in `src/lib/tools/agents/index.ts` add interactive/system tools; do not build runtime lists from static subagent arrays. Preserve the invariant that capability docs appear exactly once in top-level getters.

Focus gating lives in `SimplifiedAgent`: Chat uses core tools; Web Search selects web/all plus file search when applicable; Local Research uses local/file tools; unknown focus falls back to Web Search. Append enabled memory/extra tools at the documented boundary. Focus-selected private runs remove artifact tools, but custom/extra tool assembly occurs separately; apply private exclusions to the final list when changing this path. Firefox page-selection and explicit custom tool lists are special restricted paths.

`AgentStreamDriver.buildConfig()` creates one Zod-validated `ToolContext` carrying models, IDs, signals, tracker/recorders, emitter, chart registry, and capability facts. LangGraph-specific values remain under `configurable`.

## Checkpoints, interrupts, and resume

Use the singleton SQLite `SqliteSaver`. Only interactive runs with a thread ID are resumable; subagent/noninteractive runs must not create checkpoints. Delete threads on clean completion or cancellation.

After streaming, inspect checkpoint tasks. A valid pending interrupt emits `interrupt`; malformed state or checkpoint I/O is an integrity error, never success. The host persists approvals idempotently, publishes pending events, pauses the run, force-flushes milestones, and marks the chat `awaiting_user`.

Resume must:

- lock and validate unresolved approval IDs;
- strictly decode the recorded config and verify approval, run, chat, message, and checkpoint-thread identity; current code checks active-thread presence/chat/message but does not fully bind every recorded thread ID, so do not treat presence as proof;
- re-resolve recorded model refs (preserving the snapshotted effective effort) and rebuild workspace/MCP tools;
- reject stale external snapshots as synthetic tool responses rather than applying them; missing expected hashes currently skip parts of freshness checking, so snapshot shape must fail closed;
- seed a fresh tracker from persisted cumulative stats;
- use keyed resume maps when several approvals remain;
- suppress replayed tool chrome with stable interrupted tool-call IDs.

After process restart/eviction, reconstruct controllers, assistant content, milestone log/sequence, chart registry, and paused hub state before resuming.

## Hub, host, and persistence

`runHub.ts` is the in-memory status/fan-out registry: sequence, buffered events, subscribers, controllers, replay content, pause/terminal TTLs, and idempotent lookup. Replay sends authoritative accumulated content, `replay_complete`, then live NDJSON.

`runHost.ts` is the DB/wire adapter: partial/final assistant rows, active markers, widget accumulation, control-event translation, approval rows, checkpoint cleanup, milestone flushing, terminal status, and effective model-configuration audit metadata for historical Model Info.

`runEventsPersistence.ts` stores reconstruction milestones—not response-token deltas—and force-flushes at pause and termination. Its current flush clears the buffer before a swallowed insert failure, so awaiting the flush is not a durability guarantee; preserve/requeue or propagate failures when changing this boundary.

## Tokens and cancellation

One `TokenTracker` spans the root turn, tools, Panel executors, and deep-research children. It aggregates by `(provider, model)` across scopes/roles, emits cumulative `model_stats`, preserves root input tokens, and supports resume seeding. Keep callback attribution/deduplication so child usage is not counted as parent usage.

Hard cancellation and retrieval soft-stop are separate signals. Hard abort stops stream consumption and triggers checkpoint/approval/run cleanup. Retrieval abort may permit early synthesis from partial documents. Reconstructed runs must register both controllers so Stop still works.

Ordinary stream execution errors are currently wrapped by the driver but can still be emitted as `agent_end` and finalized completed; preserve the integrity-error distinction, and do not extend this failure-as-success path. Interrupt decoding/handling must terminate fail-closed rather than leave a returned agent marked running.

## Verification

Prefer focused unit tests for `agentRunConfig`, `agentStreamDriver`, `TokenTracker`, milestone filtering, and tool registration. Add boundary tests for changed hub replay/TTL, host reconstruction, approval races, cancellation/resume races, or idempotency.

Related skills: `yaawc-api-endpoints`, `yaawc-streaming-events`, `yaawc-prompt-system`, `yaawc-agent-panel`, `yaawc-deep-research-subagents`, `yaawc-runtime-skills`, `yaawc-code-execution`, and `yaawc-testing`.
