/**
 * Reading, applying and persisting the active theme in the browser.
 *
 * Theme state is deliberately device-local (see `settings/keys.ts`): lighting
 * differs per device, and the settings sync layer is last-write-wins, so two
 * devices with different preferences would clobber each other. Portability is
 * covered by copy/paste in the Appearance section instead.
 */
import { themeVars } from './derive';
import { resolveBuiltIn } from './themes';
import type { Theme } from './types';

export const THEME_ID_KEY = 'appTheme';
export const CUSTOM_THEME_KEY = 'customTheme';
/**
 * Resolved vars for the active theme, written on every apply. Lets the boot
 * script restore the theme before first paint without inlining the whole
 * registry into a render-blocking <script>.
 */
const THEME_CACHE_KEY = 'appThemeCache';

export const CUSTOM_THEME_ID = 'custom';

/** Fired after a theme is applied, so theme-dependent views can re-read. */
export const THEME_CHANGE_EVENT = 'yaawc:themechange';

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** The custom theme, if the user has one. */
export function readCustomTheme(): Theme | null {
  const stored = readJson<Partial<Theme>>(CUSTOM_THEME_KEY);
  if (!stored?.bg || !stored.mode) return null;
  return { ...stored, id: CUSTOM_THEME_ID } as Theme;
}

/** The active theme — the custom one when selected, else a built-in. */
export function readActiveTheme(): Theme {
  let id: string | null = null;
  try {
    id = localStorage.getItem(THEME_ID_KEY);
  } catch {
    /* storage unavailable — fall through to the default */
  }
  if (id === CUSTOM_THEME_ID) {
    const custom = readCustomTheme();
    if (custom) return custom;
  }
  return resolveBuiltIn(id);
}

/** Write the theme's variables onto `:root` and sync the mode-dependent bits. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const vars = themeVars(theme);
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
  root.setAttribute('data-theme', theme.mode);
  root.setAttribute('data-theme-id', theme.id);
  // The syntax style is the one part of a theme that isn't a CSS var — its
  // consumers read it through React, so it needs a home on the root for
  // `useActiveTheme` to see it change.
  if (theme.syntax) root.setAttribute('data-theme-syntax', theme.syntax);
  else root.removeAttribute('data-theme-syntax');
  root.classList.toggle('dark', theme.mode === 'dark');

  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme.bg);

  try {
    localStorage.setItem(
      THEME_CACHE_KEY,
      JSON.stringify({
        id: theme.id,
        mode: theme.mode,
        syntax: theme.syntax,
        vars,
      }),
    );
  } catch {
    /* a missing cache only costs a one-frame flash on the next load */
  }

  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

/** Select a built-in theme. */
export function selectTheme(id: string): void {
  localStorage.setItem(THEME_ID_KEY, id);
  applyTheme(id === CUSTOM_THEME_ID ? readActiveTheme() : resolveBuiltIn(id));
}

/**
 * Save (and activate) the custom theme. There is one slot, so every caller is
 * a deliberate, confirmed overwrite — see `AppearanceSection`.
 */
export function saveCustomTheme(theme: Theme): Theme {
  const custom: Theme = { ...theme, id: CUSTOM_THEME_ID, name: 'Custom' };
  localStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(custom));
  localStorage.setItem(THEME_ID_KEY, CUSTOM_THEME_ID);
  applyTheme(custom);
  return custom;
}

/**
 * Render-blocking boot script. Restores the cached theme before first paint so
 * there's no flash and the app doesn't have to withhold rendering until React
 * hydrates. Unknown/absent cache falls through to the stylesheet defaults.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{
var c=JSON.parse(localStorage.getItem(${JSON.stringify(THEME_CACHE_KEY)})||'null');
if(!c||!c.vars)return;
var r=document.documentElement;
for(var k in c.vars)r.style.setProperty(k,c.vars[k]);
r.setAttribute('data-theme',c.mode);
if(c.id)r.setAttribute('data-theme-id',c.id);
if(c.syntax)r.setAttribute('data-theme-syntax',c.syntax);
r.classList.toggle('dark',c.mode==='dark');
var m=document.querySelector('meta[name="theme-color"]');
if(m&&c.vars['--color-bg'])m.setAttribute('content',c.vars['--color-bg']);
}catch(e){}})();`;
