'use client';

import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import {
  X,
  Play,
  Save,
  ChevronDown,
  ChevronRight,
  Copy,
  Undo2,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import WidgetContent from '@/components/dashboard/WidgetContent';
import SourceListEditor from '@/components/dashboard/SourceListEditor';
import WidgetChatPanel from '@/components/dashboard/WidgetChatPanel';
import { CodeWidgetConfig } from '@/lib/types/widget';
import { CodeWidgetProcessResponse } from '@/lib/types/api';
import { WidgetBuilderState } from '@/lib/tools/agents/widgetBuilderTools';
import { CODE_WIDGET_TEMPLATE } from '@/lib/widgets/codeWidgetTemplate';
import { resolveWidgetTheme } from '@/lib/widgets/widgetTheme';
import {
  hasAcceptedWarning,
  acceptWarning,
} from '@/components/CodeExecutionWarning';

const CodeEditor = dynamic(() => import('@/components/dashboard/CodeEditor'), {
  ssr: false,
  loading: () => (
    <div className="h-80 border border-surface-2 rounded-control bg-bg" />
  ),
});

interface CodeWidgetConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: CodeWidgetConfig) => void;
  editingWidget?: CodeWidgetConfig | null;
  /** Seed code for the convert-from-LLM flow. */
  seedCode?: string;
}

const defaultConfig = (): CodeWidgetConfig => ({
  widgetType: 'code',
  title: '',
  sources: [],
  code: CODE_WIDGET_TEMPLATE,
  refreshFrequency: 60,
  refreshUnit: 'minutes',
});

const CodeWidgetConfigModal = ({
  isOpen,
  onClose,
  onSave,
  editingWidget,
  seedCode,
}: CodeWidgetConfigModalProps) => {
  const [config, setConfig] = useState<CodeWidgetConfig>(defaultConfig);
  const [initialJson, setInitialJson] = useState('');
  const [errors, setErrors] = useState<{ title?: string; code?: string }>({});
  const [preview, setPreview] = useState<CodeWidgetProcessResponse | null>(
    null,
  );
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [warningAccepted, setWarningAccepted] = useState(true);
  const [leftTab, setLeftTab] = useState<'editor' | 'chat'>('editor');
  // Working-state revision stamp — proposals computed against an older revision
  // are stale once the user manually edits. Multi-level undo for auto-accept.
  const [revision, setRevision] = useState(0);
  const [autoAccept, setAutoAccept] = useState(false);
  const [undoStack, setUndoStack] = useState<CodeWidgetConfig[]>([]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setPreview(null);
    setLeftTab('editor');
    setRevision(0);
    setAutoAccept(false);
    setUndoStack([]);
    setWarningAccepted(hasAcceptedWarning());
    const next: CodeWidgetConfig = editingWidget
      ? { ...editingWidget, widgetType: 'code' }
      : { ...defaultConfig(), code: seedCode ?? CODE_WIDGET_TEMPLATE };
    setConfig(next);
    setInitialJson(JSON.stringify(next));
  }, [isOpen, editingWidget, seedCode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const isDirty = useMemo(
    () => JSON.stringify(config) !== initialJson,
    [config, initialJson],
  );

  const handleClose = useCallback(() => {
    if (isDirty && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }, [isDirty, onClose]);

  const handleSave = () => {
    const nextErrors: { title?: string; code?: string } = {};
    if (!config.title.trim()) nextErrors.title = 'Title is required.';
    if (!config.code.trim()) nextErrors.code = 'Code is required.';
    if (nextErrors.title || nextErrors.code) {
      setErrors(nextErrors);
      // Errors render inline in the editor tab — surface them if the user is on
      // the assistant tab, where they'd otherwise see Save silently no-op.
      setLeftTab('editor');
      toast.error('Fix the highlighted fields before saving.');
      return;
    }
    onSave({
      ...config,
      sources: config.sources.filter((s) => s.url.trim()),
    });
  };

  const runPreviewWith = useCallback(
    async (cfg: CodeWidgetConfig): Promise<CodeWidgetProcessResponse> => {
      setIsPreviewLoading(true);
      try {
        const res = await fetch('/api/dashboard/process-code-widget', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: cfg.code,
            sources: cfg.sources.filter((s) => s.url.trim()),
            theme: resolveWidgetTheme(),
          }),
        });
        const data: CodeWidgetProcessResponse = await res.json();
        setPreview(data);
        return data;
      } catch (e) {
        const data: CodeWidgetProcessResponse = {
          success: false,
          content: '',
          charts: {},
          logs: {
            stdout: '',
            stderr: '',
            exitCode: 0,
            timedOut: false,
            oomKilled: false,
          },
          error: e instanceof Error ? e.message : 'Network error',
          sourcesFetched: 0,
          totalSources: 0,
        };
        setPreview(data);
        return data;
      } finally {
        setIsPreviewLoading(false);
      }
    },
    [],
  );

  const runPreview = () => runPreviewWith(config);

  // Bump the revision stamp on manual edits so in-flight proposals go stale,
  // and disable auto-accept the moment the user hand-edits the code.
  const onCodeEdit = (code: string) => {
    setConfig((p) => ({ ...p, code }));
    if (code.trim()) setErrors((p) => ({ ...p, code: undefined }));
    setRevision((r) => r + 1);
    setAutoAccept(false);
  };
  const markRevision = () => setRevision((r) => r + 1);

  // Apply an accepted proposal to the working copy, then auto-Preview. Returns
  // the preview error (if any) so the chat panel can feed it back to the agent.
  const handleAcceptProposal = useCallback(
    async (proposed: WidgetBuilderState): Promise<{ error?: string }> => {
      const next: CodeWidgetConfig = {
        ...config,
        title: proposed.title,
        sources: proposed.sources,
        code: proposed.code,
      };
      setUndoStack((s) => [...s, config]);
      setConfig(next);
      setErrors((p) => ({
        title: next.title.trim() ? undefined : p.title,
        code: next.code.trim() ? undefined : p.code,
      }));
      // NOTE: do NOT bump the revision here. The revision stamp exists to catch
      // USER manual edits mid-proposal (the clobber race); the agent's own
      // sequential proposals within a turn all share one base revision, so
      // bumping on apply would make every proposal after the first go stale and
      // be dropped. Proposals carry the full resulting state, so applying them
      // in order is always safe.
      const result = await runPreviewWith(next);
      return { error: result.success ? undefined : result.error };
    },
    [config, runPreviewWith],
  );

  const undo = () => {
    setUndoStack((s) => {
      if (s.length === 0) return s;
      const prev = s[s.length - 1];
      setConfig(prev);
      setRevision((r) => r + 1);
      return s.slice(0, -1);
    });
  };

  const widgetState: WidgetBuilderState = {
    title: config.title,
    sources: config.sources,
    code: config.code,
  };
  const lastError =
    preview && !preview.success
      ? `${preview.error ?? ''}\n${preview.logs.stderr ?? ''}`.trim()
      : null;

  if (isOpen && !warningAccepted) {
    return (
      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={onClose}>
          <div className="fixed inset-0 bg-overlay" />
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <DialogPanel className="max-w-lg rounded-floating bg-surface p-6 space-y-4 shadow-floating">
              <DialogTitle className="text-lg font-medium text-fg">
                Run your own JavaScript?
              </DialogTitle>
              <p className="text-sm text-fg/80">
                A code widget runs the JavaScript you write inside the sandboxed
                Docker runtime on <strong>every refresh</strong>. Source data is
                fetched server-side and passed to your code. The sandbox has no
                network access and is destroyed after each run, but you are
                responsible for the code you author.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm rounded-control bg-surface hover:bg-surface-2 text-fg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    acceptWarning();
                    setWarningAccepted(true);
                  }}
                  className="px-4 py-2 text-sm rounded-control bg-accent text-accent-fg hover:bg-accent-700"
                >
                  I understand — continue
                </button>
              </div>
            </DialogPanel>
          </div>
        </Dialog>
      </Transition>
    );
  }

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={handleClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-overlay" />
        </TransitionChild>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <DialogPanel className="flex flex-col w-[95vw] max-w-[95vw] h-[92vh] transform overflow-hidden rounded-floating bg-surface p-6 text-left align-middle shadow-floating">
              <DialogTitle
                as="h3"
                className="shrink-0 text-lg font-medium text-fg flex items-center justify-between"
              >
                <span className="flex items-center gap-2">
                  {editingWidget ? 'Edit Code Widget' : 'Create Code Widget'}
                  {isDirty && (
                    <span className="text-xs font-normal text-warning">
                      • Unsaved changes
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={handleClose}
                  className="p-1 hover:bg-surface-2 rounded-control"
                >
                  <X size={20} />
                </button>
              </DialogTitle>

              <div className="mt-4 flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-6 overflow-hidden">
                {/* Left — Editor / Chat tabs */}
                <div className="flex flex-col min-h-0">
                  <div className="shrink-0 flex items-center justify-between border-b border-surface-2 mb-3">
                    <div className="flex gap-1">
                      {(['editor', 'chat'] as const).map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setLeftTab(tab)}
                          className={`flex items-center gap-1.5 px-3 py-2 text-sm capitalize border-b-2 -mb-px ${
                            leftTab === tab
                              ? 'border-accent text-fg'
                              : 'border-transparent text-fg/60 hover:text-fg'
                          }`}
                        >
                          {tab === 'chat' ? 'Assistant' : 'Editor'}
                          {tab === 'editor' &&
                            (errors.title || errors.code) && (
                              <span
                                className="h-1.5 w-1.5 rounded-pill bg-danger"
                                aria-label="Has validation errors"
                              />
                            )}
                        </button>
                      ))}
                    </div>
                    {undoStack.length > 0 && (
                      <button
                        type="button"
                        onClick={undo}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-fg/60 hover:bg-surface-2 rounded-control"
                        title="Undo last applied proposal"
                      >
                        <Undo2 size={13} /> Undo
                      </button>
                    )}
                  </div>

                  <div
                    className={leftTab === 'chat' ? 'flex-1 min-h-0' : 'hidden'}
                  >
                    <WidgetChatPanel
                      getState={() => widgetState}
                      revision={revision}
                      lastError={lastError}
                      autoAccept={autoAccept}
                      onToggleAutoAccept={setAutoAccept}
                      onAccept={handleAcceptProposal}
                    />
                  </div>

                  <div
                    className={
                      leftTab === 'editor'
                        ? 'flex-1 min-h-0 overflow-y-auto space-y-4 pr-2'
                        : 'hidden'
                    }
                  >
                    <div>
                      <label className="block text-sm font-medium text-fg mb-1">
                        Widget Title
                      </label>
                      <input
                        type="text"
                        aria-label="Widget title"
                        value={config.title}
                        onChange={(e) => {
                          setConfig((p) => ({ ...p, title: e.target.value }));
                          if (e.target.value.trim())
                            setErrors((p) => ({ ...p, title: undefined }));
                          markRevision();
                        }}
                        className="w-full px-3 py-2 border border-surface-2 rounded-control bg-bg text-fg focus:outline-none focus:ring-2 focus:ring-accent"
                        placeholder="Enter widget title..."
                      />
                      {errors.title && (
                        <p className="text-xs text-danger mt-1">
                          {errors.title}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-fg mb-1">
                        Sources{' '}
                        <span className="text-fg/50 font-normal">
                          (optional)
                        </span>
                      </label>
                      <SourceListEditor
                        sources={config.sources}
                        onChange={(sources) => {
                          setConfig((p) => ({ ...p, sources }));
                          markRevision();
                        }}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-fg mb-1">
                        Refresh Frequency
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          aria-label="Refresh frequency"
                          min="1"
                          value={config.refreshFrequency}
                          onChange={(e) =>
                            setConfig((p) => ({
                              ...p,
                              refreshFrequency: parseInt(e.target.value) || 1,
                            }))
                          }
                          className="flex-1 px-3 py-2 border border-surface-2 rounded-control bg-bg text-fg focus:outline-none focus:ring-2 focus:ring-accent"
                        />
                        <select
                          value={config.refreshUnit}
                          onChange={(e) =>
                            setConfig((p) => ({
                              ...p,
                              refreshUnit: e.target.value as
                                | 'minutes'
                                | 'hours',
                            }))
                          }
                          className="px-3 py-2 border border-surface-2 rounded-control bg-bg text-fg focus:outline-none focus:ring-2 focus:ring-accent"
                        >
                          <option value="minutes">Minutes</option>
                          <option value="hours">Hours</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-fg mb-1">
                        Code
                      </label>
                      <CodeEditor
                        value={config.code}
                        onChange={onCodeEdit}
                        height="48vh"
                      />
                      {errors.code && (
                        <p className="text-xs text-danger mt-1">
                          {errors.code}
                        </p>
                      )}
                    </div>

                    <RuntimeHelp
                      open={showHelp}
                      onToggle={() => setShowHelp((v) => !v)}
                    />
                  </div>
                </div>

                {/* Right — preview (always visible) */}
                <div className="flex flex-col min-h-0 space-y-3">
                  <div className="shrink-0 flex items-center justify-between">
                    <h4 className="text-sm font-medium text-fg">
                      Preview{' '}
                      <span className="text-fg/50 font-normal">
                        — not saved
                      </span>
                    </h4>
                    <button
                      type="button"
                      onClick={runPreview}
                      disabled={isPreviewLoading}
                      className="flex items-center gap-2 px-3 py-2 bg-accent text-accent-fg rounded-control hover:bg-accent-700 disabled:opacity-50"
                    >
                      <Play size={16} />
                      {isPreviewLoading ? 'Running…' : 'Run Preview'}
                    </button>
                  </div>

                  <div className="flex-1 min-h-0 p-4 border border-surface-2 rounded-control bg-surface overflow-y-auto">
                    {preview?.success ? (
                      <WidgetContent
                        content={preview.content}
                        charts={preview.charts}
                        className="max-w-full"
                      />
                    ) : (
                      <div className="text-sm text-fg/50 italic">
                        Click &quot;Run Preview&quot; to test your code.
                      </div>
                    )}
                  </div>

                  <div className="shrink-0 max-h-44 overflow-y-auto space-y-2">
                    {preview && !preview.success && (
                      <PreviewError preview={preview} />
                    )}
                    {preview?.warnings?.map((w, i) => (
                      <p key={i} className="text-xs text-warning">
                        ⚠ {w}
                      </p>
                    ))}
                    {preview &&
                      (preview.logs.stdout || preview.logs.stderr) && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-fg/60">
                            Logs
                          </summary>
                          <pre className="mt-1 p-2 bg-bg rounded-control overflow-x-auto whitespace-pre-wrap text-fg/80">
                            {preview.logs.stderr || preview.logs.stdout}
                          </pre>
                        </details>
                      )}
                  </div>
                </div>
              </div>

              <div className="shrink-0 mt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 text-sm font-medium text-fg bg-surface hover:bg-surface-2 rounded-control"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-accent-fg bg-accent hover:bg-accent-700 rounded-control"
                >
                  <Save size={16} />
                  {editingWidget ? 'Save to apply' : 'Create Widget'}
                </button>
              </div>
            </DialogPanel>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};

const PreviewError = ({ preview }: { preview: CodeWidgetProcessResponse }) => {
  const copy = () =>
    navigator.clipboard
      .writeText(`${preview.error}\n\n${preview.logs.stderr}`)
      .then(() => toast.success('Error copied'));
  return (
    <div className="p-3 bg-danger-soft rounded-control border border-danger space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-danger">{preview.error}</p>
        <button
          type="button"
          onClick={copy}
          className="text-danger/80 hover:text-danger"
          title="Copy error"
        >
          <Copy size={14} />
        </button>
      </div>
      {preview.logs.stderr && (
        <pre className="text-xs text-danger/90 overflow-x-auto whitespace-pre-wrap">
          {preview.logs.stderr}
        </pre>
      )}
    </div>
  );
};

const RuntimeHelp = ({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) => (
  <div className="border border-surface-2 rounded-control">
    <button
      type="button"
      onClick={onToggle}
      className="w-full px-3 py-2 flex items-center gap-2 text-sm text-fg/70 hover:bg-surface-2"
    >
      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      Runtime &amp; API
    </button>
    {open && (
      <div className="px-3 pb-3 text-xs text-fg/70 space-y-2">
        <p>
          Define{' '}
          <code>
            async function render(&#123; sources, now, location, theme &#125;)
          </code>{' '}
          and return a markdown string.
        </p>
        <ul className="list-disc pl-4 space-y-1">
          <li>
            <code>sources[i]</code>:{' '}
            <code>&#123; url, type, content, error, ok, truncated &#125;</code>.{' '}
            <code>content</code> is a raw string.
          </li>
          <li>
            JSON API: <code>JSON.parse(sources[0].content)</code>.
          </li>
          <li>
            Web Page: <code>sources[0].content</code> is extracted page text.
          </li>
          <li>
            <code>chart(spec)</code> registers a chart and returns a{' '}
            <code>&lt;Chart/&gt;</code> string — embed it in your output.
          </li>
          <li>
            <code>now</code>: <code>&#123; iso, utcIso, localIso &#125;</code>;{' '}
            <code>location</code>: string | null.
          </li>
          <li>
            <code>theme.colors</code>: resolved theme colors (
            <code>background</code>, <code>foreground</code>,{' '}
            <code>surface</code>, <code>accent</code>, …) — use them in inline
            styles or chart <code>color</code> fields so the widget matches the
            theme.
          </li>
          <li>
            Unavailable: <code>require</code>, <code>import</code>,{' '}
            <code>fetch</code>, <code>fs</code>, <code>process</code>, network,
            timers. ~30s / 128MB limits.
          </li>
        </ul>
      </div>
    )}
  </div>
);

export default CodeWidgetConfigModal;
