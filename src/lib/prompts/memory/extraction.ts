export function extractionPrompt(
  userMessage: string,
  assistantResponse: string,
): string {
  return `You are a memory extraction system. Analyze the following conversation exchange and extract any persistent, durable facts about the user that would be useful to remember across future conversations.

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

## Examples of Good Extractions
User: "I'm building a recipe app in Next.js with TypeScript"
→ [{"content": "Building a recipe app in Next.js with TypeScript", "suggestedCategory": "Project"}]

User: "Always use bullet points in your responses"
→ [{"content": "Prefers responses formatted with bullet points", "suggestedCategory": "Instruction"}]

User: "I've been a senior frontend developer for 10 years"
→ [{"content": "Senior frontend developer with 10 years of experience", "suggestedCategory": "Professional"}]

## Examples of What NOT to Extract
User: "What's the weather like today?" → [] (transient question)
User: "Maybe I should try Rust sometime" → [] (speculative)
User: "The article says React is popular" → [] (quoted content)

## Output Format
Respond with ONLY a JSON array. If nothing worth remembering, respond with an empty array [].
Each item: {"content": "concise fact", "suggestedCategory": "Preference|Profile|Professional|Project|Instruction"}

## Conversation Exchange
User: ${userMessage}
Assistant: ${assistantResponse}

Extract memorable facts (JSON array only):`;
}
