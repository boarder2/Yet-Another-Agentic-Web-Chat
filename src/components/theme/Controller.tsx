'use client';
import { useEffect } from 'react';
import { applyTheme, readActiveTheme } from '@/lib/theme/apply';

/**
 * Keeps `:root` in sync with the stored theme.
 *
 * The render-blocking boot script in `layout.tsx` has already applied the
 * cached theme before first paint, so this only has to re-apply after
 * hydration (covering a first-ever load, a cleared cache, or a change made in
 * another tab) — it never withholds rendering.
 */
export default function ThemeController({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    applyTheme(readActiveTheme());

    const onStorage = () => applyTheme(readActiveTheme());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return <>{children}</>;
}
