import fs from 'fs';
import path from 'path';
import type { Skill } from './types';

const NAME_REGEX = /^[a-z0-9][a-z0-9_:-]*$/;

let cache: Skill[] | null = null;

function parseSkillFile(filePath: string): Skill | null {
  const raw = fs.readFileSync(filePath, 'utf8');
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) {
    console.error(`[skills] ${filePath}: missing YAML frontmatter, skipping`);
    return null;
  }
  const [, fm, body] = fmMatch;
  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  const descMatch = fm.match(/^description:\s*(.+)$/m);
  if (!nameMatch || !descMatch) {
    console.error(
      `[skills] ${filePath}: frontmatter missing name or description, skipping`,
    );
    return null;
  }
  const name = nameMatch[1].trim();
  if (!NAME_REGEX.test(name)) {
    console.error(
      `[skills] ${filePath}: name "${name}" does not match ${NAME_REGEX}, skipping`,
    );
    return null;
  }
  return {
    source: 'system',
    name,
    description: descMatch[1].trim(),
    content: body.trim(),
  };
}

export function getSystemSkills(): Skill[] {
  if (cache) return cache;
  const dir = path.join(process.cwd(), 'src/lib/skills/system');
  if (!fs.existsSync(dir)) {
    cache = [];
    return cache;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  const result: Skill[] = [];
  for (const file of files) {
    const skill = parseSkillFile(path.join(dir, file));
    if (skill) result.push(skill);
  }
  cache = result;
  return cache;
}

export function clearSystemSkillsCache() {
  cache = null;
}
