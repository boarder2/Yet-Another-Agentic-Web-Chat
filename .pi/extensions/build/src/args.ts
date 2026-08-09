import { mintSlug } from './state.ts';

export interface StartArgs {
  ask: string;
  requestedSlug: string | null;
}

/**
 * `/build <ask>` keeps the generated slug. `/build <slug> -- <ask>` pins it.
 * The separator is deliberately required so a prompt can contain arbitrary
 * words without its first word being mistaken for a slug.
 */
export function parseStartArgs(raw: string): StartArgs | null {
  const input = raw.trim();
  if (!input) return null;

  const explicit = /^(\S+)\s+--\s*(.*)$/s.exec(input);
  if (!explicit) return { ask: input, requestedSlug: null };

  const ask = explicit[2].trim();
  if (!ask) return null;

  return {
    ask,
    requestedSlug: mintSlug(explicit[1]),
  };
}
