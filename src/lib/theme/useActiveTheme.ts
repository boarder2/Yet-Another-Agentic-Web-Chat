'use client';

import { useSyncExternalStore } from 'react';
import { CUSTOM_THEME_ID, THEME_CHANGE_EVENT, readActiveTheme } from './apply';
import { DEFAULT_THEME_ID, resolveBuiltIn } from './themes';
import type { Theme } from './types';

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

// The snapshot has to be a primitive — `readActiveTheme()` builds a fresh object
// each call, which would make useSyncExternalStore loop forever.
function getSnapshot(): string {
  const root = document.documentElement;
  return `${root.getAttribute('data-theme-id') ?? ''}|${root.getAttribute('data-theme') ?? ''}`;
}

function getServerSnapshot(): string {
  return `${DEFAULT_THEME_ID}|dark`;
}

/**
 * The active theme, re-read whenever it changes. Use this rather than poking at
 * `document.documentElement` during render — that never updates on a switch.
 */
export function useActiveTheme(): Theme {
  const key = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const id = key.split('|')[0];
  return id === CUSTOM_THEME_ID ? readActiveTheme() : resolveBuiltIn(id);
}
