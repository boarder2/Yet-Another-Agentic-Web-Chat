'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  ClipboardPaste,
  Copy,
  ArrowRight,
  ChevronDown,
  Pencil,
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
import { SYNTAX_FAMILIES, syntaxFamilyOf } from '@/lib/theme/syntax';
import {
  resolveBuiltIn,
  themeFamiliesByMode,
  type ThemeFamily,
} from '@/lib/theme/themes';
import { SEED_KEYS, SEED_LABELS, type Theme } from '@/lib/theme/types';

const SAMPLE_CODE = `import { greet } from './greet';

// Renders in the selected syntax style.
export function main(names: string[] = []) {
  const total = names.length;
  return total ? names.map(greet) : ['Hello, world!'];
}`;

/** Height of the swatch, shared with the chip overlay laid over it. */
const SWATCH_H = 'h-14';

/** Miniature of a theme: surface slab, accent chip and a text sample on bg. */
function Swatch({ theme }: { theme: Theme }) {
  return (
    <div
      // Marks sit on the top row so the variant chip owns the bottom one.
      className={cn(
        'flex items-start gap-1.5 rounded-control px-2 pt-1.5',
        SWATCH_H,
      )}
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
        className="pt-1 text-body font-medium leading-none"
        style={{ color: theme.fg }}
      >
        Aa
      </span>
    </div>
  );
}

/**
 * A theme tile. The variant chip holds a `<select>`, which can't be nested in
 * the tile's own button — so it rides in an overlay sized to the swatch rather
 * than inside it, and the select button's `after` stretches its hit area over
 * the whole tile.
 *
 * The caption is the family name; `chip` names the variant on the swatch, so
 * the accessible name stays the full theme name either way.
 */
function ThemeTile({
  theme,
  caption,
  active,
  onSelect,
  chip,
}: {
  theme: Theme;
  caption?: string;
  active: boolean;
  onSelect: () => void;
  chip?: React.ReactNode;
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
        className="flex flex-col gap-1.5 text-left after:absolute after:inset-0"
      >
        <Swatch theme={theme} />
        <span
          title={theme.name}
          className="truncate px-0.5 text-caption text-fg/70"
        >
          {caption ?? theme.name}
        </span>
      </button>
      <div
        className={cn(
          'pointer-events-none absolute inset-x-1.5 top-1.5',
          SWATCH_H,
        )}
      >
        {chip}
      </div>
    </div>
  );
}

/**
 * The variant a tile is showing, as a chip on its swatch. `children` is a
 * transparent native `<select>` laid over the very same chip, so what the tile
 * shows and what the dropdown holds can't drift apart. Families with a single
 * theme get no chip — the mode heading above already says "Dark" or "Light".
 */
function VariantChip({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <span className="pointer-events-auto absolute bottom-1 right-1 flex max-w-[calc(100%-0.5rem)]">
      {children}
      <span
        title={title}
        className="flex min-w-0 items-center gap-0.5 rounded-control bg-surface px-1.5 py-0.5 text-caption text-fg/70 peer-focus-visible:ring-1 peer-focus-visible:ring-accent"
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={11} className="shrink-0" />
      </span>
    </span>
  );
}

interface GroupedOption {
  value: string;
  label: string;
  group?: string;
}

/**
 * `<option>`s, wrapped in an `<optgroup>` wherever the list declares one. Both
 * pickers need it: Catppuccin is two axes deep — flavour, then accent — so its
 * variants list under their flavour instead of running to fifty-six flat rows.
 * Runs are consecutive, which a caller guarantees by ordering; a list with no
 * groups renders as bare options.
 */
function GroupedOptions({ options }: { options: GroupedOption[] }) {
  const runs = options.reduce<[string | undefined, GroupedOption[]][]>(
    (acc, option) => {
      const last = acc.at(-1);
      if (last && last[0] === option.group) last[1].push(option);
      else acc.push([option.group, [option]]);
      return acc;
    },
    [],
  );
  const render = (o: GroupedOption) => (
    <option key={o.value} value={o.value}>
      {o.label}
    </option>
  );
  return runs.map(([group, run]) =>
    group ? (
      <optgroup key={group} label={group}>
        {run.map(render)}
      </optgroup>
    ) : (
      run.map(render)
    ),
  );
}

/**
 * One family's tile for a mode. It shows the active variant when the family is
 * the active one, the last one picked here otherwise, and its first as a
 * fallback; picking from the dropdown applies immediately, like clicking any
 * other tile. Resolving `shownId` against this family's own themes is what
 * keeps a dark pick out of the same-named light tile.
 */
function FamilyTile({
  family,
  activeId,
  shownId,
  onSelect,
}: {
  family: ThemeFamily;
  activeId: string;
  shownId?: string;
  onSelect: (id: string) => void;
}) {
  const shown =
    family.themes.find((t) => t.id === activeId) ??
    family.themes.find((t) => t.id === shownId) ??
    family.themes[0];
  const variant =
    family.themes.length > 1 ? (shown.variant ?? shown.name) : undefined;
  return (
    <ThemeTile
      theme={shown}
      caption={family.name}
      active={shown.id === activeId}
      onSelect={() => onSelect(shown.id)}
      chip={
        variant && (
          <VariantChip
            label={shown.group ? `${shown.group} · ${variant}` : variant}
            title={shown.name}
          >
            <Select
              aria-label={`${family.name} variant`}
              value={shown.id}
              onChange={(e) => onSelect(e.target.value)}
              className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none border-0 bg-transparent p-0 opacity-0"
            >
              <GroupedOptions
                options={family.themes.map((t) => ({
                  value: t.id,
                  label: t.variant ?? t.name,
                  group: t.group,
                }))}
              />
            </Select>
          </VariantChip>
        )
      }
    />
  );
}

function ThemeGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</div>
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
  /** Last variant picked per family, so browsing away doesn't reset its tile. */
  const [variantByFamily, setVariantByFamily] = useState<
    Record<string, string>
  >({});

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

  const handleFamilySelect = useCallback(
    (name: string, id: string) => {
      setVariantByFamily((v) => ({ ...v, [name]: id }));
      handleSelect(id);
    },
    [handleSelect],
  );

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

  const syntaxFamily = syntaxFamilyOf(active.syntax);
  const syntaxVariants = SYNTAX_FAMILIES.find(
    (f) => f.family === syntaxFamily,
  )?.variants;

  return (
    <div id="appearance" className="flex flex-col space-y-4">
      <SettingsSection title="Appearance">
        <p className="text-xs text-fg/60">
          Applies instantly and is saved to this device only. Built-in themes
          are read-only — Edit in Customize copies the selected theme into your
          custom theme, or Copy to move a theme to another device.
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
              {themeFamiliesByMode(mode).map((family) => (
                <FamilyTile
                  key={family.name}
                  family={family}
                  activeId={activeId}
                  shownId={variantByFamily[family.name]}
                  onSelect={(id) => handleFamilySelect(family.name, id)}
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
            {!isCustom && (
              <Button
                size="sm"
                variant="secondary"
                icon={Pencil}
                // The visible label is one word; the full semantic — which
                // theme, and that it lands in the custom slot — rides here.
                aria-label={`Edit ${active.name} as your custom theme`}
                title={`Edit ${active.name} as your custom theme`}
                onClick={() => requestAdopt(active)}
              >
                Edit
              </Button>
            )}
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
            : `Showing ${active.name}. Edit to copy it into your custom theme and unlock these controls.`}
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

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Syntax style"
            hint="Used for code blocks in chat and workspace files, and for the code editors."
          >
            <Select
              value={syntaxFamily ?? ''}
              disabled={!isCustom}
              // Switching family lands on its first variant; there is no
              // meaningful way to carry "Blue" across to a family without one.
              onChange={(e) =>
                handleEdit({
                  syntax: SYNTAX_FAMILIES.find(
                    (f) => f.family === e.target.value,
                  )?.variants[0].value,
                })
              }
              options={[
                {
                  value: '',
                  label: `Automatic (One ${active.mode === 'dark' ? 'Dark' : 'Light'})`,
                },
                ...SYNTAX_FAMILIES.map((f) => ({
                  value: f.family,
                  label: f.family,
                })),
              ]}
            />
          </Field>
          <Field label="Variant">
            <Select
              aria-label="Syntax variant"
              value={active.syntax ?? ''}
              // Nothing to choose without a family, or with a family of one.
              disabled={!isCustom || (syntaxVariants?.length ?? 0) < 2}
              onChange={(e) => handleEdit({ syntax: e.target.value })}
            >
              {syntaxVariants?.length ? (
                <GroupedOptions options={syntaxVariants} />
              ) : (
                <option value="">—</option>
              )}
            </Select>
          </Field>
        </div>
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
