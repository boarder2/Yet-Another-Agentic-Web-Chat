import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage } from '@langchain/core/messages';
import { classificationPrompt } from '@/lib/prompts/memory/classification';

export type MemoryCategory =
  | 'Preference'
  | 'Profile'
  | 'Professional'
  | 'Project'
  | 'Instruction';

export const MEMORY_CATEGORIES: MemoryCategory[] = [
  'Preference',
  'Profile',
  'Professional',
  'Project',
  'Instruction',
];

export async function classifyMemory(
  content: string,
  systemModel: BaseChatModel,
): Promise<MemoryCategory> {
  try {
    const prompt = classificationPrompt(content);
    const response = await systemModel.invoke([new HumanMessage(prompt)]);
    const responseText =
      typeof response.content === 'string'
        ? response.content.trim()
        : String(response.content).trim();

    const matched = MEMORY_CATEGORIES.find(
      (cat) => cat.toLowerCase() === responseText.toLowerCase(),
    );
    return matched ?? 'Preference';
  } catch (error) {
    console.warn(
      'classifyMemory: LLM classification failed, defaulting to Preference',
      error,
    );
    return 'Preference';
  }
}
