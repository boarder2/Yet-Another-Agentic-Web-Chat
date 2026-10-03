import { describe, expect, it } from 'vitest';
import { buildChatPrompt } from './chat';
import { buildFirefoxAIPrompt } from './firefoxAI';
import { buildLocalResearchPrompt } from './localResearch';
import { mathGuidance } from './mathGuidance';
import { buildWebSearchPrompt } from './webSearch';
import { getSubagentDefinition } from '@/lib/search/subagents/definitions';

const CLOCK = { now: '2026-08-26T00:00:00Z', timeZone: 'UTC' };
const PERSONA = 'PERSONA FORMATTING OVERRIDE';

const rootPrompts = (personaInstructions: string) => [
  buildChatPrompt(personaInstructions, '', CLOCK),
  buildWebSearchPrompt(
    personaInstructions,
    '',
    [],
    0,
    'formula question',
    CLOCK,
  ),
  buildLocalResearchPrompt(personaInstructions, '', CLOCK),
  buildFirefoxAIPrompt(personaInstructions, '', CLOCK),
];

describe('mathematical formatting prompt guidance', () => {
  it('states the supported delimiters and safe authoring rules', () => {
    expect(mathGuidance).toContain('## Mathematical Formatting');
    expect(mathGuidance).toContain('$...$');
    expect(mathGuidance).toContain('$$...$$');
    expect(mathGuidance).toContain(String.raw`\(...\)`);
    expect(mathGuidance).toContain(String.raw`\[...\]`);
    expect(mathGuidance).toContain('valid KaTeX');
    expect(mathGuidance).toContain('prefer `$...$` for inline formulas');
    expect(mathGuidance).toContain(
      'when dollar signs could be mistaken for currency',
    );
    expect(mathGuidance).toContain(
      'never put formulas in inline or fenced code blocks',
    );
    expect(mathGuidance).toContain('custom macros');
    expect(mathGuidance).toContain('raw HTML');
    expect(mathGuidance).toContain('trusted rendering');
  });

  it('is included in every root focus prompt with or without a persona', () => {
    for (const prompt of [...rootPrompts(''), ...rootPrompts(PERSONA)]) {
      expect(prompt).toContain(mathGuidance);
    }

    for (const prompt of rootPrompts(PERSONA)) {
      expect(prompt).toContain(PERSONA);
    }
  });

  it('is included in the deep-research custom prompt', () => {
    const definition = getSubagentDefinition('deep_research');

    expect(definition).toBeTruthy();
    expect(definition!.systemPrompt).toContain(mathGuidance);
    expect(definition!.systemPrompt).toContain('valid KaTeX');
  });
});
