export type ExistingMemorySummary = {
  id: string;
  content: string;
  category: string | null;
};

export function extractionPrompt(
  userMessage: string,
  assistantResponse: string,
  existingMemories: ExistingMemorySummary[] = [],
): string {
  const memoriesSection =
    existingMemories.length > 0
      ? `## Existing Memories (already stored)
${existingMemories.map((m) => `- [ID: ${m.id}] (${m.category ?? 'Uncategorized'}) ${m.content}`).join('\n')}
`
      : `## Existing Memories
None stored yet.
`;

  return `You are a memory consolidation system. Analyze the conversation exchange below and decide what, if anything, should be remembered long-term about the user. You MUST consider the existing memories to avoid fragmentation and duplication.

## Meta-Conversation Rule (CRITICAL)
If the conversation is about the user asking the system to manage their memories (consolidate, create new, delete, or modify existing memories) — return an empty array []. The agent itself will handle that separately with explicit tools. This prompt is ONLY for extracting new facts from regular conversations, not for managing the memory system itself.

## Core Principles
1. **Consolidate, don't fragment.** If related facts already exist, UPDATE the existing memory to incorporate new details rather than creating a new one. Aim for fewer, richer memories.
2. **Synthesize related details.** Instead of 3 separate memories about a project's tech stack, create ONE comprehensive memory. E.g., "YAAWC is a privacy-first agentic web chat built with Next.js, LangChain, SQLite, and SearXNG."
3. **Skip what's already covered.** If the new information is already captured by an existing memory, skip it.
4. **Prefer quality over quantity.** One well-crafted composite memory is better than five atomic facts.

## What to Extract
- User preferences (tools, languages, formats, styles)
- Durable personal facts (location, family, background)
- Professional details (job, company, experience, skills)
- Active projects (tech stack, goals, architecture)
- Standing instructions (formatting rules, response style preferences)

## What NOT to Extract
- Transient statements or questions about the current task only
- Hypothetical scenarios ("what if I used Python?")
- Quoted content from search results or documents
- Large text blocks or verbatim passages
- Speculative or uncertain statements
- Sensitive information: health conditions, financial details, credentials, government IDs, passwords, API keys

${memoriesSection}
## Actions
Each item must have an "action" field:
- **"create"**: A genuinely new fact not covered by any existing memory.
- **"update"**: Enrich or refine an existing memory. Include the "id" of the memory to update, and provide the full merged content.
- **"skip"**: Information already fully covered. (Optional — you can simply omit these and return fewer items.)

## Output Format
Respond with ONLY a JSON array. If nothing worth remembering, respond with [].
Each item: {"action": "create|update", "content": "concise consolidated fact", "suggestedCategory": "Preference|Profile|Professional|Project|Instruction", "id": "existing-memory-id (required for update, omit for create)"}

## Examples

### Consolidation Example
Existing memories:
- [ID: abc] (Project) Building a recipe app in Next.js
User: "I'm also using Tailwind and Prisma for it"
→ [{"action": "update", "id": "abc", "content": "Building a recipe app with Next.js, Tailwind CSS, and Prisma", "suggestedCategory": "Project"}]

### New Fact Example
Existing memories: none
User: "I've been a senior frontend developer for 10 years"
→ [{"action": "create", "content": "Senior frontend developer with 10 years of experience", "suggestedCategory": "Professional"}]

### Already Covered Example
Existing memories:
- [ID: def] (Professional) Senior frontend developer with 10 years of experience
User: "As I mentioned, I'm a senior dev"
→ [] (already covered)

### Meta-Conversation Example
User: "How does memory extraction work in AI chat apps?"
→ [] (meta-conversation about memory systems)

## Conversation Exchange
User: ${userMessage}
Assistant: ${assistantResponse}

Extract memorable facts (JSON array only):`;
}
