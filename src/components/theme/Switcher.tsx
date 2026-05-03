'use client';
import { useLocalStorageString } from '@/lib/hooks/useLocalStorage';

type Theme = 'dark' | 'light' | 'custom';

const ThemeSwitcher = ({ className }: { className?: string }) => {
  const [theme, setTheme] = useLocalStorageString('appTheme', 'dark');
  const [bg, setBg] = useLocalStorageString('userBg', '#0f0f0f');
  const [accent, setAccent] = useLocalStorageString('userAccent', '#2563eb');

  return (
    <div className={className}>
      <div className="flex gap-2">
        <select
          aria-label="App theme"
          className="bg-surface text-fg px-3 py-2 rounded-surface border border-surface-2 text-sm"
          value={theme}
          onChange={(e) => setTheme(e.target.value as Theme)}
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="custom">Custom</option>
        </select>
        {theme === 'custom' && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-foreground/70 flex items-center gap-1">
              Background
              <input
                type="color"
                aria-label="Custom background color"
                value={bg}
                onChange={(e) => setBg(e.target.value)}
              />
            </label>
            <label className="text-xs text-foreground/70 flex items-center gap-1">
              Accent
              <input
                type="color"
                aria-label="Custom accent color"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
};

export default ThemeSwitcher;
