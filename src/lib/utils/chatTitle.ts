import { HumanMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { chatTitlePrompt } from '@/lib/prompts/title';
import { stripWidgets } from '@/lib/widgets/envelope';
import { normalizeUsageMetadata, type Recorder } from '@/lib/tokens/tracker';

/** Cap on the raw text fed into the title prompt, per input. */
const INPUT_CHAR_CAP = 2500;
/** Hard cap on the returned title (DB/UI safety). Target is ≤150. */
const TITLE_CHAR_CAP = 200;

/** Trim, strip wrapping quotes, collapse whitespace, and hard-cap length. */
function postProcess(raw: string): string {
  let title = raw.trim();
  // Strip a single pair of wrapping quotes the model sometimes adds.
  const quoted = /^(["'“”‘’])([\s\S]*)\1$/.exec(title);
  if (quoted) title = quoted[2].trim();
  title = title.replace(/\s+/g, ' ');
  if (title.length > TITLE_CHAR_CAP)
    title = title.slice(0, TITLE_CHAR_CAP).trim();
  return title;
}

/**
 * Summarize a conversation's first turn into a short title using the system
 * model. Records token usage on the turn's `systemRecorder`. Returns `null`
 * when the model yields nothing usable, so the caller can keep the raw title.
 */
export async function generateChatTitle(
  systemLlm: BaseChatModel,
  systemRecorder: Recorder,
  userMessage: string,
  assistantAnswer: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const cleanedAnswer = stripWidgets(assistantAnswer).slice(0, INPUT_CHAR_CAP);
  const prompt = chatTitlePrompt(
    userMessage.slice(0, INPUT_CHAR_CAP),
    cleanedAnswer,
  );

  const response = await systemLlm.invoke([new HumanMessage(prompt)], {
    signal,
  });

  if (response.usage_metadata) {
    systemRecorder.record(
      normalizeUsageMetadata(
        response.usage_metadata as unknown as Record<string, number>,
      ),
    );
  }

  const content =
    typeof response.content === 'string'
      ? response.content
      : Array.isArray(response.content)
        ? response.content
            .map((c) =>
              typeof c === 'string' ? c : ((c as { text?: string }).text ?? ''),
            )
            .join('')
        : '';

  const title = postProcess(content);
  return title.length > 0 ? title : null;
}
