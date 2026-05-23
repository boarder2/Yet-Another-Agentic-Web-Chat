import fs from 'fs';
import path from 'path';
import type { Skill } from './types';
import { buildChartCreationSkill } from './system/chart-creation';
import { buildCodeExecutionSkill } from './system/code-execution';

const NAME_REGEX = /^[a-z0-9][a-z0-9_:-]*$/;

// File-based skills are stable per process; programmatic skills are computed
// per call so they can react to runtime config (e.g. whether code_execution
// is enabled).
let fileCache: Skill[] | null = null;

// Programmatic skills override file-based skills with the same name.
// Builders may return null to omit the skill entirely (e.g. when the
// underlying tool is disabled by server config).
const PROGRAMMATIC_SKILL_BUILDERS: Array<() => Skill | null> = [
  buildChartCreationSkill,
  buildCodeExecutionSkill,
];

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

function getFileSkills(): Skill[] {
  if (fileCache) return fileCache;
  const dir = path.join(process.cwd(), 'src/lib/skills/system');
  if (!fs.existsSync(dir)) {
    fileCache = [];
    return fileCache;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  const result: Skill[] = [];
  for (const file of files) {
    const skill = parseSkillFile(path.join(dir, file));
    if (skill) result.push(skill);
  }
  fileCache = result;
  return fileCache;
}

export function getSystemSkills(): Skill[] {
  const merged = new Map<string, Skill>();
  for (const s of getFileSkills()) merged.set(s.name, s);
  for (const build of PROGRAMMATIC_SKILL_BUILDERS) {
    const s = build();
    if (s) merged.set(s.name, s);
  }
  return Array.from(merged.values());
}

export function clearSystemSkillsCache() {
  fileCache = null;
}
