import { describe, it, expect } from 'vitest';
import { AgentConfigError, parseAgent, parseFrontmatter } from './agents.ts';

const agent = `---
name: reviewer
description: Reviews code for correctness
tools: read, grep, bash
---

You are a senior reviewer.

Report with submit_verdict.
`;

describe('parseFrontmatter', () => {
  it('splits fields from body', () => {
    const { fields, body } = parseFrontmatter(agent);
    expect(fields.name).toBe('reviewer');
    expect(fields.tools).toBe('read, grep, bash');
    expect(body.startsWith('You are a senior reviewer.')).toBe(true);
  });

  it('treats a file with no frontmatter as all body', () => {
    expect(parseFrontmatter('# Just prose')).toEqual({
      fields: {},
      body: '# Just prose',
    });
  });

  it('keeps colons inside a value', () => {
    const { fields } = parseFrontmatter(
      '---\ndescription: Does x: and y\n---\nbody',
    );
    expect(fields.description).toBe('Does x: and y');
  });
});

describe('parseAgent', () => {
  it('reads name, description and tools', () => {
    expect(parseAgent(agent)).toMatchObject({
      name: 'reviewer',
      description: 'Reviews code for correctness',
      tools: ['read', 'grep', 'bash'],
    });
  });

  it('leaves tools undefined when unset, so the session default applies', () => {
    const parsed = parseAgent(
      '---\nname: coder\ndescription: Implements\n---\nbody',
    );
    expect(parsed?.tools).toBeUndefined();
  });

  // Models moved to .pi/build.json. Ignoring a leftover `model:` would let someone
  // change it and change nothing, so the field is rejected outright.
  it('rejects a leftover model field instead of ignoring it', () => {
    expect(() =>
      parseAgent(
        '---\nname: coder\ndescription: Implements\nmodel: ~anthropic/claude-sonnet-latest\n---\nbody',
      ),
    ).toThrow(AgentConfigError);
  });

  it('rejects a definition missing name or description', () => {
    expect(parseAgent('---\nname: coder\n---\nbody')).toBeNull();
    expect(parseAgent('no frontmatter at all')).toBeNull();
  });
});
