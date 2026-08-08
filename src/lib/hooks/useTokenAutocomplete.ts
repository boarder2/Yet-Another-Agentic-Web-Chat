'use client';

import { useCallback, useState, type RefObject } from 'react';

export interface TokenChoice {
  key: string;
  primary: string;
  secondary?: string;
}

interface Options<T> {
  /** The character that opens the popover, at a word boundary. */
  trigger: string;
  items: T[];
  enabled: boolean;
  /** Whether the typed query may contain spaces — titles need it, slugs don't. */
  allowSpaces?: boolean;
  match: (item: T, query: string) => boolean;
  describe: (item: T) => TokenChoice;
  /** Text replacing `trigger` + query. A trailing space is the caller's job. */
  insertion: (item: T) => string;
  message: string;
  setMessage: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

/**
 * Trigger-character autocomplete over a plain textarea, shared by the `/skill`
 * and `@artifact` popovers. Owns only the popover — the text is the caller's
 * state, and a completion is an ordinary edit to it, so nothing here has to be
 * kept in sync with what the user types afterwards.
 */
export function useTokenAutocomplete<T>({
  trigger,
  items,
  enabled,
  allowSpaces = false,
  match,
  describe,
  insertion,
  message,
  setMessage,
  inputRef,
}: Options<T>) {
  const [suggestions, setSuggestions] = useState<T[]>([]);
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);

  /** Where the open token starts, or -1 when the caret isn't in one. */
  const tokenStart = useCallback(
    (text: string, caret: number): number => {
      const before = text.slice(0, caret);
      const at = before.lastIndexOf(trigger);
      if (at === -1) return -1;
      const prev = at > 0 ? before[at - 1] : null;
      if (prev !== null && prev !== ' ' && prev !== '\n') return -1;
      const query = before.slice(at + trigger.length);
      if (allowSpaces ? /\n/.test(query) : /\s/.test(query)) return -1;
      return at;
    },
    [trigger, allowSpaces],
  );

  const onTextChange = useCallback(
    (text: string, caret: number) => {
      if (!enabled || items.length === 0) return setActive(false);
      const at = tokenStart(text, caret);
      if (at === -1) return setActive(false);
      const query = text.slice(at + trigger.length, caret).toLowerCase();
      const matches = items.filter((i) => match(i, query));
      if (matches.length === 0) return setActive(false);
      setSuggestions(matches);
      setActive(true);
      setIndex(0);
    },
    [enabled, items, tokenStart, trigger, match],
  );

  const apply = useCallback(
    (item: T) => {
      const caret = inputRef.current?.selectionStart ?? message.length;
      const at = tokenStart(message, caret);
      if (at === -1) return setActive(false);
      const text = insertion(item);
      const next = message.slice(0, at) + text + message.slice(caret);
      setMessage(next);
      setActive(false);
      // After React has written the new value, or the caret snaps back.
      setTimeout(() => {
        const pos = at + text.length;
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(pos, pos);
      }, 0);
    },
    [inputRef, message, tokenStart, insertion, setMessage],
  );

  /** True when the popover consumed the key and the form should not act on it. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!active || suggestions.length === 0) return false;
      switch (e.key) {
        case 'ArrowDown':
          setIndex((i) => (i + 1) % suggestions.length);
          return true;
        case 'ArrowUp':
          setIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
          return true;
        case 'Tab':
        case 'Enter':
          apply(suggestions[index]);
          return true;
        case 'Escape':
          setActive(false);
          return true;
        default:
          return false;
      }
    },
    [active, suggestions, index, apply],
  );

  return {
    close: useCallback(() => setActive(false), []),
    open: active && suggestions.length > 0,
    choices: suggestions.slice(0, 6).map((item) => ({
      ...describe(item),
      onSelect: () => apply(item),
    })),
    index,
    onTextChange,
    onKeyDown,
  };
}
