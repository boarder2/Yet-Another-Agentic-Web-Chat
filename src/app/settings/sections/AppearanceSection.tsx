'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  ClipboardPaste,
  Copy,
  ArrowRight,
  CornerRightUp,
  TriangleAlert,
} from 'lucide-react';
import SettingsSection from '../components/SettingsSection';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import Modal from '@/components/ui/Modal';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import AppSwitch from '@/components/ui/AppSwitch';
import { CodeBlock } from '@/components/CodeBlock';
import { cn } from '@/lib/utils';
import {
  CUSTOM_THEME_ID,
  readActiveTheme,
  readCustomTheme,
  saveCustomTheme,
  selectTheme,
} from '@/lib/theme/apply';
import {
  contrastWarnings,
  parseTheme,
  serializeTheme,
} from '@/lib/theme/derive';
import { SYNTAX_OPTIONS } from '@/lib/theme/syntax';
import { resolveBuiltIn, themesByMode } from '@/lib/theme/themes';
import { SEED_KEYS, SEED_LABELS, type Theme } from '@/lib/theme/types';

const SAMPLE_CODE = `import { greet } from './greet';

// Renders in the selected syntax style.
export function main(names: string[] = []) {
  const total = names.length;
  return total ? names.map(greet) : ['Hello, world!'];
}`;

/** Miniature of a theme: surface slab, accent chip and a text sample on bg. */
function Swatch({ theme }: { theme: Theme }) {
  return (
    <div
      className="flex h-10 items-center gap-1.5 rounded-control px-2"
      style={{ backgroundColor: theme.bg }}
    >
      <span
        className="h-6 w-3 rounded-sm"
        style={{ backgroundColor: theme.surface }}
      />
      <span
        className="h-6 w-3 rounded-sm"
        style={{ backgroundColor: theme.accent }}
      />
      <span
        className="text-body font-medium leading-none"
        style={{ color: theme.fg }}
      >
        Aa
      </span>
    </div>
  );
}

/**
 * A theme tile. Selecting and copying-into-Custom are two sibling buttons
 * rather than one nested in the other, which isn't valid HTML. `onCopy` is
 * omitted for the custom tile — it is already the copy destination.
 */
function ThemeTile({
  theme,
  active,
  onSelect,
  onCopy,
}: {
  theme: Theme;
  active: boolean;
  onSelect: () => void;
  onCopy?: () => void;
}) {
  return (
    <div
      className={cn(
        'relative flex flex-col gap-1.5 rounded-surface border p-1.5 transition-colors duration-150',
        active
          ? 'border-accent'
          : 'border-surface-2 hover:border-border-strong',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        // The visible caption is joined with the swatch's "Aa" sample, which
        // would make the accessible name "Aa Nord".
        aria-label={theme.name}
        aria-pressed={active}
        className="flex flex-col gap-1.5 text-left"
      >
        <Swatch theme={theme} />
        <span
          title={theme.name}
          className="truncate px-0.5 text-caption text-fg/70"
        >
          {theme.name}
        </span>
      </button>
      {onCopy && (
        <button
          type="button"
          onClick={onCopy}
          aria-label={`Copy ${theme.name} into Custom`}
          title={`Copy ${theme.name} into Custom`}
          // Fill and icon both come from the app theme, not the previewed one,
          // so the chip stays legible over any swatch.
          className="absolute right-2 top-2 rounded-control bg-surface p-1 text-fg/70 opacity-80 transition-opacity duration-150 hover:opacity-100 focus-visible:opacity-100"
        >
          <CornerRightUp size={13} />
        </button>
      )}
    </div>
  );
}

function ThemeGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {children}
    </div>
  );
}

export default function AppearanceSection() {
  const [activeId, setActiveId] = useState('');
  const [custom, setCustom] = useState<Theme | null>(null);
  /** Theme waiting on the overwrite confirmation, if any. */
  const [pending, setPending] = useState<Theme | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [copied, setCopied] = useState(false);

  // Read the stored theme once the client has mounted; on the server there's no
  // localStorage, and the boot script has already applied it to the document.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveId(readActiveTheme().id);
    setCustom(readCustomTheme());
  }, []);

  const adopt = useCallback((theme: Theme) => {
    setCustom(saveCustomTheme(theme));
    setActiveId(CUSTOM_THEME_ID);
    setPending(null);
  }, []);

  /** Copying into the one custom slot is destructive, so confirm first. */
  const requestAdopt = useCallback(
    (theme: Theme) => (custom ? setPending(theme) : adopt(theme)),
    [custom, adopt],
  );

  const handleSelect = useCallback((id: string) => {
    selectTheme(id);
    setActiveId(id);
  }, []);

  const handleEdit = useCallback(
    (patch: Partial<Theme>) => custom && adopt({ ...custom, ...patch }),
    [custom, adopt],
  );

  const handleCopy = useCallback((theme: Theme) => {
    navigator.clipboard.writeText(serializeTheme(theme));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const handleImport = useCallback(() => {
    const result = parseTheme(importText);
    if (!result.ok) {
      setImportError(result.error);
      return;
    }
    requestAdopt({ ...result.theme, id: CUSTOM_THEME_ID });
    setImportOpen(false);
    setImportText('');
    setImportError('');
  }, [importText, requestAdopt]);

  if (!activeId) return null;

  const isCustom = activeId === CUSTOM_THEME_ID;
  const active = isCustom && custom ? custom : resolveBuiltIn(activeId);
  const warnings = contrastWarnings(active);

  return (
    <div id="appearance" className="flex flex-col space-y-4">
      <SettingsSection title="Appearance">
        <p className="text-xs text-fg/60">
          Applies instantly and is saved to this device only. Built-in themes
          are read-only — use{' '}
          <CornerRightUp size={12} className="inline align-text-top" /> to copy
          one into your custom theme, or Copy to move a theme to another device.
        </p>
        {custom && (
          <div className="flex flex-col space-y-2">
            <p className="text-caption font-medium uppercase text-fg/50">
              Your theme
            </p>
            <ThemeGrid>
              <ThemeTile
                theme={custom}
                active={isCustom}
                onSelect={() => handleSelect(CUSTOM_THEME_ID)}
              />
            </ThemeGrid>
          </div>
        )}
        {(['dark', 'light'] as const).map((mode) => (
          <div key={mode} className="flex flex-col space-y-2">
            <p className="text-caption font-medium uppercase text-fg/50">
              {mode}
            </p>
            <ThemeGrid>
              {themesByMode(mode).map((theme) => (
                <ThemeTile
                  key={theme.id}
                  theme={theme}
                  active={activeId === theme.id}
                  onSelect={() => handleSelect(theme.id)}
                  onCopy={() => requestAdopt(theme)}
                />
              ))}
            </ThemeGrid>
          </div>
        ))}
      </SettingsSection>

      <SettingsSection
        title="Customize"
        headerAction={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              icon={copied ? Check : Copy}
              onClick={() => handleCopy(active)}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={ClipboardPaste}
              onClick={() => setImportOpen((v) => !v)}
            >
              Paste
            </Button>
          </div>
        }
      >
        <p className="text-xs text-fg/60">
          {isCustom
            ? 'Editing your custom theme.'
            : `Showing ${active.name}. Copy it into your custom theme to edit these.`}
        </p>

        {importOpen && (
          <div className="flex flex-col space-y-2">
            <Field
              label="Paste a theme"
              error={importError || undefined}
              hint="JSON copied from another device or shared by someone else."
            >
              <Textarea
                value={importText}
                rows={8}
                className="font-mono text-xs"
                placeholder={serializeTheme(active)}
                onChange={(e) => {
                  setImportText(e.target.value);
                  setImportError('');
                }}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setImportOpen(false);
                  setImportError('');
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleImport}
                disabled={!importText.trim()}
              >
                Apply theme
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Dark mode</p>
          <AppSwitch
            aria-label="Dark mode"
            checked={active.mode === 'dark'}
            disabled={!isCustom}
            onChange={(on) => handleEdit({ mode: on ? 'dark' : 'light' })}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {SEED_KEYS.map((key) => {
            const warning = warnings.find((w) => w.seed === key);
            return (
              <div key={key} className="flex flex-col gap-1">
                <label className="flex items-center gap-2 text-sm font-medium text-fg">
                  <input
                    type="color"
                    aria-label={SEED_LABELS[key]}
                    value={active[key]}
                    disabled={!isCustom}
                    onChange={(e) => handleEdit({ [key]: e.target.value })}
                    // `p-0` matters: without it Chromium's own padding frames
                    // the swatch in white and swallows the colour.
                    className="h-7 w-10 cursor-pointer rounded-control border border-surface-2 bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  {SEED_LABELS[key]}
                  <span className="font-mono text-xs text-fg/50">
                    {active[key]}
                  </span>
                </label>
                {warning && (
                  <p className="flex items-start gap-1.5 text-xs text-warning">
                    <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                    <span>
                      {warning.label} is {warning.ratio.toFixed(1)}:1 (needs{' '}
                      {warning.min}:1).
                    </span>
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <Field
          label="Syntax style"
          hint="Used for code blocks in chat and workspace files."
        >
          <Select
            value={active.syntax ?? ''}
            disabled={!isCustom}
            onChange={(e) =>
              handleEdit({ syntax: e.target.value || undefined })
            }
            options={[
              {
                value: '',
                label: `Automatic (One ${active.mode === 'dark' ? 'Dark' : 'Light'})`,
              },
              ...SYNTAX_OPTIONS,
            ]}
          />
        </Field>
        <div className="overflow-hidden rounded-control border border-surface-2">
          <CodeBlock className="language-typescript" hideChrome>
            {SAMPLE_CODE}
          </CodeBlock>
        </div>
      </SettingsSection>

      <Modal
        open={!!pending}
        onClose={() => setPending(null)}
        size="sm"
        title="Replace your custom theme?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => pending && adopt(pending)}>
              Replace
            </Button>
          </>
        }
      >
        {custom && pending && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <Swatch theme={custom} />
              </div>
              <ArrowRight size={16} className="shrink-0 text-fg/50" />
              <div className="flex-1">
                <Swatch theme={pending} />
              </div>
            </div>
            <p className="text-sm text-fg/70">
              Your custom theme&apos;s colors will be overwritten with{' '}
              {pending.name}&apos;s. This can&apos;t be undone.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
