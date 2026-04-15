import db from '@/lib/db';
import { systemPrompts as systemPromptsTable } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import {
  formattingAndCitationsLocal,
  formattingAndCitationsScholarly,
  formattingAndCitationsWeb,
  formattingChat,
} from '@/lib/prompts/templates';
import { builtinMethodologyTemplates } from '@/lib/prompts/methodologyTemplates';

/**
 * Retrieves only persona instructions from the database
 * @param selectedPersonaPromptIds Array of persona prompt IDs to retrieve
 * @returns Combined persona instructions as a string
 */
export async function getPersonaInstructionsOnly(
  selectedPersonaPromptIds: string[],
): Promise<string> {
  if (
    !selectedPersonaPromptIds ||
    !Array.isArray(selectedPersonaPromptIds) ||
    selectedPersonaPromptIds.length === 0
  ) {
    return '';
  }

  try {
    let promptsString = '';

    const basePrompts = [
      formattingAndCitationsLocal,
      formattingAndCitationsScholarly,
      formattingAndCitationsWeb,
      formattingChat,
    ];

    // Include base prompts if their IDs are in the selectedPersonaPromptIds
    basePrompts.forEach((bp) => {
      if (selectedPersonaPromptIds.includes(bp.id)) {
        promptsString += bp.content + '\n';
      }
    });

    const promptsFromDb = await db
      .select({
        content: systemPromptsTable.content,
        type: systemPromptsTable.type,
      })
      .from(systemPromptsTable)
      .where(inArray(systemPromptsTable.id, selectedPersonaPromptIds));

    const personaPrompts = promptsFromDb.filter((p) => p.type === 'persona');

    return promptsString + personaPrompts.map((p) => p.content).join('\n');
  } catch (dbError) {
    console.error('Error fetching persona prompts from DB:', dbError);
    return '';
  }
}

/**
 * Retrieves methodology instructions by ID
 * @param methodologyId The ID of the methodology to retrieve
 * @returns The methodology content string, or empty string if not found
 */
export async function getMethodologyInstructions(
  methodologyId: string | null,
): Promise<string> {
  if (!methodologyId) return '';

  // Check built-in templates first
  const builtin = builtinMethodologyTemplates.find(
    (t) => t.id === methodologyId,
  );
  if (builtin) return builtin.content;

  // Fall back to DB
  try {
    const rows = await db
      .select({ content: systemPromptsTable.content })
      .from(systemPromptsTable)
      .where(
        and(
          eq(systemPromptsTable.id, methodologyId),
          eq(systemPromptsTable.type, 'methodology'),
        ),
      );
    return rows[0]?.content ?? '';
  } catch (dbError) {
    console.error('Error fetching methodology from DB:', dbError);
    return '';
  }
}
