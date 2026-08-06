export interface Section {
  level: number;
  heading: string;
  line: number;
  body: string[];
}

const HEADING = /^(#{1,6})\s+(.*?)\s*$/;

// Sections run until the next heading of the same or higher level, so a `###`
// nested under a `##` stays part of its parent's body.
export function splitSections(lines: string[], level = 2): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;

  lines.forEach((text, index) => {
    const match = HEADING.exec(text);
    if (!match) {
      current?.body.push(text);
      return;
    }

    const depth = match[1].length;
    if (depth <= level) {
      current = null;
    }
    if (depth === level) {
      current = { level: depth, heading: match[2], line: index, body: [] };
      sections.push(current);
      return;
    }
    current?.body.push(text);
  });

  return sections;
}

export function isBlank(lines: string[]): boolean {
  return lines.every((line) => line.trim() === '');
}
