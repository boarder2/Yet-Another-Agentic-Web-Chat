/**
 * Orchestrator synthesis context.
 *
 * Builds a system-context block, injected as an extra SystemMessage ahead of the
 * user turn, that gives the orchestrator each executor's answer plus the merged,
 * numbered citation set and instructs it to synthesize one answer — comparing
 * the panel answers, resolving conflicts, attributing disagreements to specific
 * models, and citing [n] against the merged sources. This augments (does not
 * replace) the orchestrator's normal persona / methodology prompt.
 */

import { Document } from '@langchain/core/documents';
import type { PanelExecutorResult } from '@/lib/search/panel/coordinator';

function formatSources(sources: Document[]): string {
  if (sources.length === 0) return 'No sources were gathered by the panel.';
  return sources
    .map((doc, i) => {
      const meta = doc.metadata || {};
      const n = (meta.sourceId as number) ?? i + 1;
      const title =
        (meta.title as string) || (meta.url as string) || `Source ${n}`;
      const url = (meta.url as string) || (meta.source as string) || '';
      const snippet = doc.pageContent || '';
      return `[${n}] ${title}${url ? ` — ${url}` : ''}\n${snippet}`;
    })
    .join('\n\n');
}

function formatExecutorAnswers(results: PanelExecutorResult[]): string {
  return results
    .map((r) => {
      const header = `### Panel model: ${r.modelName}`;
      if (r.status === 'error') {
        return `${header}\n_(This model failed to produce an answer${
          r.error ? `: ${r.error}` : ''
        }. Do not invent its view.)_`;
      }
      return `${header}\n${r.text || '_(produced no text)_'}`;
    })
    .join('\n\n');
}

export function buildOrchestratorSynthesisContext(params: {
  userPrompt: string;
  executorResults: PanelExecutorResult[];
  mergedSources: Document[];
}): string {
  const { userPrompt, executorResults, mergedSources } = params;
  const failed = executorResults.filter((r) => r.status === 'error');

  return `# Agent Panel Synthesis Task

You are the orchestrator of an "agent panel": several independent models each researched and answered the SAME user request in parallel. Your job is to synthesize ONE authoritative final answer for the user.

## The user's request
${userPrompt}

## Panel answers
Each section below is one panel model's complete answer. They researched independently and may disagree.

${formatExecutorAnswers(executorResults)}

## Merged sources
These are the deduplicated sources gathered across the panel, numbered for citation. Cite claims with [n] using these numbers. You may run your own tools to gather additional sources if needed; new sources are numbered after these.

${formatSources(mergedSources)}

## Synthesis instructions
- ALWAYS begin your response with a "## Panel comparison" section before the synthesized answer. This section MUST contain a Markdown table that compares how the panel models agreed or disagreed on the key facts/claims relevant to the request.
  - One row per key fact or claim; one column per panel model (use the model names as headers), plus a leading "Fact / claim" column.
  - In each model cell, use ✅ if that model supported the claim, ❌ if it contradicted it, and ➖ if it did not address it (or — for models that failed and produced no answer).
  - Only include facts that are material to the answer; keep the table focused, not exhaustive.
  - After the table, add a one-line note summarizing where the panel reached consensus and where it diverged.
- After the comparison section, produce a single, coherent answer to the user's request — do not present the panel models' answers separately or as a list of opinions.
- Where the panel agrees, state the consensus confidently and cite the merged sources.
- Where the panel DISAGREES, surface the disagreement and attribute each position to the specific model(s) that held it (e.g. "X reported …, while Y found …").
- Prefer claims that are backed by the merged sources; treat unsupported claims with appropriate caution.
${
  failed.length > 0
    ? `- These panel models failed and produced no answer: ${failed
        .map((f) => f.modelName)
        .join(', ')}. Do not fabricate their views.`
    : ''
}
- Follow your normal formatting and citation rules for the final answer.`;
}
