export function chatTitlePrompt(
  userMessage: string,
  assistantAnswer: string,
): string {
  return `Write a short, concise title for this conversation, capturing its main topic as a plain noun phrase. Respond with only the title, nothing else.

Rules:
- Keep it under 150 characters — a few words, not a sentence.
- Use the same language the user wrote in.
- Plain text only: no quotation marks, no markdown, no trailing punctuation.

User's first message:
${userMessage}

Assistant's answer:
${assistantAnswer}

Title:`;
}
