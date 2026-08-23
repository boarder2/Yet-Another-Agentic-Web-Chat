---
name: yaawc-code-execution
description: 'User-approved Docker code execution: availability, sandbox limits, interrupts, output, cancellation, and chart correlation.'
---

# Agent Code Execution

This skill documents the interactive chat `code_execution` tool. Dashboard code widgets use the same low-level Docker executor but retain separate runner/output contracts under `yaawc-dashboard-widgets`.

## Availability and configuration

`buildCodeExecutionSkill()` and the dynamic tool getter fail closed unless `[TOOLS.CODE_EXECUTION]` is enabled and image/host validation succeeds. Defaults are an official Node Alpine image, local Docker Unix socket, 30 seconds, 128 MiB, and 50,000 stdout/stderr characters.

- `DOCKER_IMAGE` accepts only official `node[:tag][@sha256:digest]` forms.
- `DOCKER_HOST` accepts the default Unix socket or explicit HTTP(S).
- The tool pings Docker before asking for approval; configured-but-unreachable is unavailable.
- Execution requires a top-level interactive streamed session. Do not expose it to deep-research children, Panel executors, or headless scheduled runs.

The model supplies JavaScript for `node -e`, a description up to 100 characters, and code up to 50,000 characters. Submit JavaScript—not Python, TypeScript, or shell syntax—and use Node built-ins/`console.log`; there are no installed third-party dependencies or persistence. This is a language contract, not a capability restriction: JavaScript can still invoke `child_process`.

## Approval and resume

The sequence is strict:

1. Perform cheap config/session/Docker checks.
2. Interrupt with `kind: 'code_execution'`, exact code as `markupKey`, and code/description payload.
3. Wait for `{ approved, reason? }` resume input.
4. Prepare/pull the image and execute only after approval.

The UI displays the exact original code and description. Browser-local risk acknowledgment is separate from per-request Run/Deny. Denial feedback returns to the model; it should adapt rather than retry unchanged code. Cancellation and stale approvals follow the shared interrupt/reconnect lifecycle.

Never imply that code ran before acceptance. There is no approval surface in noninteractive children or scheduled runs.

## Sandbox boundary

`src/lib/sandbox/dockerExecutor.ts` runs an ephemeral container with:

- UID/GID 1000;
- no network;
- dropped capabilities and `no-new-privileges`;
- read-only root filesystem;
- configured memory with equal swap cap;
- 0.5 CPU, 32 PIDs, and 64 file descriptors;
- 64 MiB writable `/tmp` with `noexec,nosuid`;
- Node heap capped from the memory limit;
- no host volumes; forced container removal in `finally`.

This is risk reduction, not perfect isolation. JavaScript can use Node built-ins such as `child_process` and inspect the image filesystem. A local Docker socket or configured remote Docker API is a root-equivalent host trust boundary; plain HTTP also lacks transport encryption. Container escapes remain possible. Enable only on trusted self-hosted deployments.

## Output, cancellation, and failure

Successful executor returns capture bounded stdout/stderr with truncation notes, exit code, timeout, and OOM state. Timeout kills the container; OOM is read from container inspection. The tool then emits `code_execution_result` and persists the original code/result. Image-preparation errors are caught, but their text is not currently bounded; lower-level `executeCode()` throws can escape without a result event/persisted execution. Keep failure handling explicit when changing this path.

Approval cancellation/denial is resumable. Once execution starts, do not promise a user-driven process abort: the executor currently stops through hard timeout or process-shutdown cleanup, not the run's interactive cancellation signal.

## Chart correlation

Computed charts use a random private per-run stdout prefix. Injected `chart(spec)` writes versioned private records; the collector strips only matching records from visible stdout and bounds accepted record count/size. Its malformed/oversized-record error list is not currently count-bounded, so do not treat the private channel as a complete memory bound. Never introduce or document a public chart-output marker.

Register charts only after a zero-exit, non-timeout, non-OOM, error-free run. Decode and validate records independently, emit `chart_spec` with `source: 'code_execution'` and `toolCallId`, then return current-turn handles/titles/errors. Registration alone does not display a chart; `show_chart` places the handle.

Keep approval markup and callback correlation separate. `codeExecutionCorrelation` currently uses one process-global exact-code FIFO plus stale cleanup. It is best-effort for identical calls: out-of-order or cross-session callbacks can misassociate run IDs, so do not present it as a stable correlation token.

## Key files and verification

- Tool: `src/lib/tools/agents/codeExecutionTool.ts`
- Runtime guidance: `src/lib/skills/system/code-execution.ts`
- Executor: `src/lib/sandbox/dockerExecutor.ts`
- Charts/correlation: `codeExecutionCharts.ts`, `src/lib/sandbox/codeExecutionCorrelation.ts`
- Config: `src/lib/config.ts`
- UI/events: `CodeExecution.tsx`, `CodeExecutionWarning.tsx`, streaming approval/result types

Use focused tests for private chart channels, malformed/overflow records, failed-run discard, correlation cleanup, early availability exits, approval sequencing, result/persist shapes, resource options, timeout/OOM, truncation, and forced cleanup.

Update `docs/capabilities/agent-capabilities.md` or `configuration.md` when availability, limits, risks, or failures change.

Related skills: `yaawc-agent-runtime`, `yaawc-streaming-events`, `yaawc-dashboard-widgets`, and `yaawc-testing`.
