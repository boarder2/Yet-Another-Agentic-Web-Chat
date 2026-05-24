import type { Skill } from '../types';
import { getCodeExecutionConfig } from '@/lib/config';

const DESCRIPTION =
  'How to use the code_execution tool — what language and runtime, sandbox limits, what works and what does not, and when to prefer it over reasoning.';

function buildContent(
  timeoutSeconds: number,
  memoryMb: number,
  maxOutputChars: number,
): string {
  return `# Using the \`code_execution\` tool

\`code_execution\` runs **Node.js JavaScript** inside a locked-down Docker sandbox and returns stdout/stderr/exit code. It is the right tool whenever a computation needs to be **exact** — math, dates, sorting, counting, regex, encoding, unit conversion, parsing — rather than reasoned about.

Prefer running code over reasoning out a result whenever the answer must be precise. Models silently mis-add numbers and miscount items; the sandbox does not.

## When to use it

Use \`code_execution\` for:
- Arithmetic beyond a couple of digits, percentages, growth rates, compound interest.
- Date math: differences, day-of-week, timezone-aware conversions.
- Counting, deduping, grouping, sorting, intersecting lists.
- Regex testing, string encoding/decoding (base64, URL, hex, JSON).
- Unit conversion, statistics (mean/median/percentile/stdev).
- Generating chart data (see the \`chart-creation\` skill — code is the preferred path for charts).

Do not use it for:
- Anything requiring network access — the sandbox has **no network**.
- Reading or writing user files — the filesystem is **read-only** except a small \`/tmp\`.
- Long-running jobs — there is a hard timeout (${timeoutSeconds} s on this server).
- Tasks the model can answer instantly with reasoning and no precision risk.

## Language and runtime

- The container runs \`node\` (Node.js 22 by default). Your code is executed via \`node -e "<your code>"\`.
- **JavaScript only.** Not Python, not TypeScript, not shell. No \`import\` of TS files; CommonJS \`require\` of built-in Node modules is fine.
- All Node built-ins are available: \`crypto\`, \`util\`, \`url\`, \`buffer\`, \`path\`, \`os\`, \`assert\`, \`zlib\`, etc.
- **No \`npm install\`.** No third-party packages — only Node's standard library.
- Use \`console.log\` for output. Anything not printed is invisible to you.

## Sandbox limits (this server's configured values)

| Limit | Value |
|---|---|
| CPU | 0.5 cores |
| Memory | ${memoryMb} MB |
| Wall clock | ${timeoutSeconds} s |
| Network | **disabled** (\`NetworkMode: none\`) |
| Filesystem | **read-only root**, with a 64 MB writable \`/tmp\` |
| File descriptors | 64 soft/hard |
| Processes | 32 PIDs max |
| stdout/stderr | truncated at ${maxOutputChars.toLocaleString('en-US')} chars each |
| User | unprivileged \`1000:1000\`, all capabilities dropped |

Practical consequences:

- \`fetch\`, \`http\`, \`https\`, \`dns\` — all fail. Don't try to call APIs.
- Writing to anywhere outside \`/tmp\` throws \`EROFS\`.
- Spawning many subprocesses or recursing wildly will hit the PID/memory caps.
- If output exceeds ${maxOutputChars.toLocaleString('en-US')} chars it is truncated — summarize or sample large data before printing.

## Approval and timing

Every call shows the code to the user for approval **before** it runs. They can approve or deny (with a reason). Treat denial as feedback: the user has told you why, adapt rather than retry the same code.

Because there's an approval step, batching is friendlier than firing many tiny calls. Prefer one cohesive script over five round-trips when the steps are related.

## Schema and shape

\`\`\`ts
{
  description: string; // <= 100 chars, ~15 words; shown to user at approval
  code: string;        // Node.js JS; <= 50,000 chars
}
\`\`\`

- \`description\` should be specific: "Compute 5-year CAGR for the revenue series" beats "Run some math".
- Wrap your code in an async IIFE if you need \`await\` at top level:
  \`\`\`js
  (async () => {
    // ... await something ...
    console.log(result);
  })();
  \`\`\`
- Print structured output as JSON when you'll need to read it back precisely:
  \`\`\`js
  console.log(JSON.stringify({ total, mean, p95 }, null, 2));
  \`\`\`

## Reading results

The tool returns:
- \`Exit code: <n>\` — non-zero means your script threw or was killed.
- \`Stdout:\` — everything you \`console.log\`-ed, truncated if huge.
- \`Stderr:\` — uncaught exceptions and \`console.error\`.

Special end states:
- **Timed out** — exceeded the wall-clock limit (${timeoutSeconds} s); rewrite to do less work.
- **Out of memory** — exceeded the memory cap (${memoryMb} MB); stream or chunk instead of building large arrays.

## Patterns

Exact arithmetic:
\`\`\`js
const months = 18, monthlyRate = 0.045 / 12, principal = 250_000;
const payment = principal * monthlyRate / (1 - (1 + monthlyRate) ** -months);
console.log(payment.toFixed(2));
\`\`\`

Date difference in days, timezone-aware:
\`\`\`js
const a = new Date('2026-01-15T00:00:00Z');
const b = new Date('2026-05-23T00:00:00Z');
console.log(Math.round((b - a) / 86_400_000));
\`\`\`

Counting / grouping:
\`\`\`js
const items = ['a','b','a','c','b','a'];
const counts = items.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
console.log(JSON.stringify(counts));
\`\`\`

Regex check:
\`\`\`js
const re = /^\\+?[1-9]\\d{6,14}$/; // E.164
console.log(re.test('+15551234567'));
\`\`\`

## Availability

The tool also refuses to run in subagents and non-interactive contexts — if you're in one of those, do the math by reasoning carefully and say so if precision could be off.`;
}

export function buildCodeExecutionSkill(): Skill | null {
  const ce = getCodeExecutionConfig();
  const enabled =
    ce.enabled && !('validationError' in ce && ce.validationError);
  if (!enabled) return null;

  return {
    source: 'system',
    name: 'code-execution',
    description: DESCRIPTION,
    content: buildContent(ce.timeoutSeconds, ce.memoryMb, ce.maxOutputChars),
    disableModelInvocation: false,
  };
}
