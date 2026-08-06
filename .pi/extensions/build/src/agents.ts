import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type AgentRole = 'coder' | 'tester' | 'reviewer';

export interface AgentDefinition {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  systemPrompt: string;
}

const AGENTS_DIR = '.pi/agents';

interface Frontmatter {
  fields: Record<string, string>;
  body: string;
}

// Deliberately minimal: agent files are ours, and a full YAML parser would be a
// dependency for `key: value` lines.
export function parseFrontmatter(text: string): Frontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { fields: {}, body: text };

  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (key) fields[key] = line.slice(separator + 1).trim();
  }

  return { fields, body: text.slice(match[0].length).trim() };
}

export function parseAgent(text: string): AgentDefinition | null {
  const { fields, body } = parseFrontmatter(text);
  if (!fields.name || !fields.description) return null;

  const tools = fields.tools
    ?.split(',')
    .map((tool) => tool.trim())
    .filter(Boolean);

  return {
    name: fields.name,
    description: fields.description,
    model: fields.model || undefined,
    tools: tools?.length ? tools : undefined,
    systemPrompt: body,
  };
}

export function loadAgent(cwd: string, role: AgentRole): AgentDefinition {
  const path = join(cwd, AGENTS_DIR, `${role}.md`);
  if (!existsSync(path)) {
    throw new Error(`Missing agent definition: ${AGENTS_DIR}/${role}.md`);
  }

  const agent = parseAgent(readFileSync(path, 'utf-8'));
  if (!agent) {
    throw new Error(
      `${AGENTS_DIR}/${role}.md needs \`name\` and \`description\` frontmatter.`,
    );
  }
  return agent;
}
