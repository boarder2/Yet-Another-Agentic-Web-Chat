import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage } from '@langchain/core/messages';

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};

const DISTILL_CHAR_THRESHOLD = 500;
const MAX_FALLBACK_CHARS = 2000;

const ZERO_USAGE: TokenUsage = {
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
};

function extractText(
  content: string | Array<{ type?: string; text?: string }> | null | undefined,
): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === 'text' || b.type == null)
      .map((b) => b.text ?? '')
      .join('')
      .trim();
  }
  return '';
}

function normalizeUsage(raw: Record<string, number>): TokenUsage {
  const input = raw.input_tokens || raw.prompt_tokens || raw.promptTokens || 0;
  const output =
    raw.output_tokens || raw.completion_tokens || raw.completionTokens || 0;
  const total = raw.total_tokens || raw.totalTokens || input + output;
  return { input_tokens: input, output_tokens: output, total_tokens: total };
}

function tailTruncate(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

/**
 * Distills a long query into a compact retrieval query via the system model.
 * Used before embedding for memory retrieval to avoid exceeding embedding model limits.
 *
 * For short queries (≤ DISTILL_CHAR_THRESHOLD), returns the original unchanged.
 * On LLM failure, falls back to tail-truncation of the original.
 */
export async function distillQueryForEmbedding(
  queryText: string,
  systemLlm: BaseChatModel,
  signal?: AbortSignal,
): Promise<{ query: string; usage: TokenUsage }> {
  if (!queryText.trim()) {
    return { query: queryText, usage: ZERO_USAGE };
  }

  if (queryText.length <= DISTILL_CHAR_THRESHOLD) {
    return { query: queryText, usage: ZERO_USAGE };
  }

  try {
    const prompt = `Rewrite the following user message as a short retrieval query that captures the user's intent, key entities, and topic. Output at most 60 words. Output only the query text, nothing else.

\`\`\`
${queryText}
\`\`\``;

    const result = await systemLlm.invoke([new HumanMessage(prompt)], {
      signal,
    });

    let distilled = extractText(
      result.content as Parameters<typeof extractText>[0],
    );

    // If distillation produced nothing useful, fall back
    if (!distilled) {
      distilled = tailTruncate(queryText, MAX_FALLBACK_CHARS);
    } else {
      // Defensive cap in case the model is verbose
      distilled = tailTruncate(distilled, MAX_FALLBACK_CHARS);
    }

    // usage_metadata is LangChain's UsageMetadata type (has input_tokens, output_tokens, total_tokens)
    // response_metadata.usage is OpenAI-compat format with prompt_tokens/completion_tokens
    let usage = ZERO_USAGE;
    if (result.usage_metadata) {
      usage = {
        input_tokens: result.usage_metadata.input_tokens ?? 0,
        output_tokens: result.usage_metadata.output_tokens ?? 0,
        total_tokens: result.usage_metadata.total_tokens ?? 0,
      };
    } else if (result.response_metadata?.usage) {
      usage = normalizeUsage(
        result.response_metadata.usage as Record<string, number>,
      );
    }

    return { query: distilled, usage };
  } catch (err) {
    console.warn(
      '[queryDistillation] Distillation failed, falling back to tail-truncated original:',
      err,
    );
    return {
      query: tailTruncate(queryText, MAX_FALLBACK_CHARS),
      usage: ZERO_USAGE,
    };
  }
}
