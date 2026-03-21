export function classificationPrompt(memoryText: string): string {
  return `Classify the following memory into exactly one category. Respond with only the category name, nothing else.

Categories:
- Preference: User likes, dislikes, preferred tools, styles, formats
- Profile: Personal details like location, family, language, background
- Professional: Job title, company, experience, skills, industry
- Project: Current projects, tech stack, goals, deadlines
- Instruction: Standing instructions for how to respond, format rules, behavior directives

Memory: "${memoryText}"

Category:`;
}
