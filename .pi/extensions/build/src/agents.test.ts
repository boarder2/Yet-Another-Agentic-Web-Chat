import { describe, it, expect } from 'vitest';
import { parseAgent, parseFrontmatter } from './agents.ts';

const agent = `---
name: reviewer
description: Reviews code for correctness
model: ~anthropic/claude-sonnet-latest
tools: read, grep, bash
---

You are a senior reviewer.

Report with submit_verdict.
`;

describe('parseFrontmatter', () => {
  it('splits fields from body', () => {
    const { fields, body } = parseFrontmatter(agent);
    expect(fields.name).toBe('reviewer');
    expect(fields.model).toBe('~anthropic/claude-sonnet-latest');
    expect(body.startsWith('You are a senior reviewer.')).toBe(true);
  });

  it('treats a file with no frontmatter as all body', () => {
    expect(parseFrontmatter('# Just prose')).toEqual({
      fields: {},
      body: '# Just prose',
    });
  });

  it('keeps colons inside a value', () => {
    const { fields } = parseFrontmatter('---\ndescription: Does x: and y\n---\nbody');
    expect(fields.description).toBe('Does x: and y');
  });
});

describe('parseAgent', () => {
  it('reads name, description, model and tools', () => {
    expect(parseAgent(agent)).toMatchObject({
      name: 'reviewer',
      description: 'Reviews code for correctness',
      model: '~anthropic/claude-sonnet-latest',
      tools: ['read', 'grep', 'bash'],
    });
  });

  it('leaves model and tools undefined when unset, so the session default applies', () => {
    const parsed = parseAgent('---\nname: coder\ndescription: Implements\n---\nbody');
    expect(parsed?.model).toBeUndefined();
    expect(parsed?.tools).toBeUndefined();
  });

  it('rejects a definition missing name or description', () => {
    expect(parseAgent('---\nname: coder\n---\nbody')).toBeNull();
    expect(parseAgent('no frontmatter at all')).toBeNull();
  });
});
