'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, LoaderCircle } from 'lucide-react';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import ModelPicker from '@/components/models/ModelPicker';
import WidgetProposalCard, {
  WidgetProposal,
} from '@/components/dashboard/WidgetProposalCard';
import { WidgetBuilderState } from '@/lib/tools/agents/widgetBuilderTools';
import { captureCurrentSelection, ModelSelection } from '@/lib/models/presets';
import { resolveWidgetTheme } from '@/lib/widgets/widgetTheme';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Max consecutive automatic repair attempts under auto-apply before we stop and
// hand control back to the user.
const MAX_AUTO_REPAIRS = 4;

interface WidgetChatPanelProps {
  getState: () => WidgetBuilderState;
  revision: number;
  lastError: string | null;
  autoAccept: boolean;
  onToggleAutoAccept: (v: boolean) => void;
  /** Apply proposed state to the working copy + run preview; resolves with any preview error. */
  onAccept: (proposed: WidgetBuilderState) => Promise<{ error?: string }>;
}

const WidgetChatPanel = ({
  getState,
  revision,
  lastError,
  autoAccept,
  onToggleAutoAccept,
  onAccept,
}: WidgetChatPanelProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [proposal, setProposal] = useState<WidgetProposal | null>(null);
  // Session-scoped model selection for the assistant, seeded from the app's
  // current chat/system selection (set on mount to avoid SSR hydration drift).
  const [selection, setSelection] = useState<ModelSelection | null>(null);
  const [showModel, setShowModel] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Bounds the unattended auto-apply repair loop (accept → preview fails →
  // feed the error back → re-propose → …). Reset on a successful preview and on
  // any user-initiated message; without it a persistently-failing widget would
  // spin forever under auto-apply, burning tokens and sandbox runs.
  const autoRepairCount = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Stick to the bottom while streaming, but don't yank the user down if they've
  // scrolled up to read earlier messages.
  const stickToBottom = useRef(true);

  useEffect(() => {
    setSelection(captureCurrentSelection());
  }, []);

  // Follow new content (streamed tokens, proposals) when pinned to the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  });

  const send = useCallback(
    async (text: string, history: ChatMessage[], lastErr: string | null) => {
      setStreaming(true);
      const abort = new AbortController();
      abortRef.current = abort;
      // Placeholder assistant message we stream into.
      setMessages((m) => [...m, { role: 'assistant', content: '' }]);

      try {
        const res = await fetch('/api/dashboard/widget-builder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abort.signal,
          body: JSON.stringify({
            message: text,
            history,
            widget: getState(),
            revision,
            lastError: lastErr ?? undefined,
            autoAccept,
            // Preview with the user's live theme so the agent sees true colors.
            theme: resolveWidgetTheme(),
            chatModel:
              selection?.chatProvider && selection?.chatModel
                ? {
                    provider: selection.chatProvider,
                    name: selection.chatModel,
                  }
                : undefined,
            systemModel:
              selection?.systemProvider && selection?.systemModel
                ? {
                    provider: selection.systemProvider,
                    name: selection.systemModel,
                  }
                : undefined,
          }),
        });
        if (!res.body) throw new Error('No response stream');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let assistantText = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() ?? '';
          for (const chunk of chunks) {
            const line = chunk.replace(/^data: /, '').trim();
            if (!line) continue;
            let evt: { type?: string; data?: unknown };
            try {
              evt = JSON.parse(line);
            } catch {
              continue;
            }
            if (evt.type === 'response' && typeof evt.data === 'string') {
              assistantText += evt.data;
              setMessages((m) => {
                const next = [...m];
                next[next.length - 1] = {
                  role: 'assistant',
                  content: assistantText,
                };
                return next;
              });
            } else if (evt.type === 'widget_proposal') {
              setProposal(evt.data as WidgetProposal);
            }
            // Ignore the rest of SimplifiedAgent's event vocabulary.
          }
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setMessages((m) => {
            const next = [...m];
            next[next.length - 1] = {
              role: 'assistant',
              content: `⚠ ${e instanceof Error ? e.message : 'Request failed'}`,
            };
            return next;
          });
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [getState, revision, selection, autoAccept],
  );

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || streaming) return;
    // A fresh user message starts a new repair budget.
    autoRepairCount.current = 0;
    setInput('');
    const history = messages;
    setMessages((m) => [...m, { role: 'user', content: text }]);
    send(text, history, lastError);
  };

  const acceptProposal = useCallback(
    async (p: WidgetProposal) => {
      setProposal(null);
      const { error } = await onAccept(p.proposed);
      if (!error) {
        autoRepairCount.current = 0;
        return;
      }
      // The preview failed after applying. Under auto-apply nobody is in the
      // loop, so cap the automatic retries before they spin forever; manual
      // accepts are user-driven and already bounded by the click.
      if (autoAccept) {
        if (autoRepairCount.current >= MAX_AUTO_REPAIRS) {
          autoRepairCount.current = 0;
          onToggleAutoAccept(false);
          setMessages((m) => [
            ...m,
            {
              role: 'assistant',
              content: `⚠ Stopped auto-applying after ${MAX_AUTO_REPAIRS} failed repair attempts. Review the error and tell me how you'd like to proceed.`,
            },
          ]);
          return;
        }
        autoRepairCount.current += 1;
      }
      // Auto-feed the failure back to the agent as the next turn.
      const feedback = `The preview failed after applying that change:\n${error}\nPlease fix it.`;
      setMessages((m) => [...m, { role: 'user', content: feedback }]);
      send(feedback, messages, error);
    },
    [onAccept, send, messages, autoAccept, onToggleAutoAccept],
  );

  // Auto-accept: apply immediately if the proposal isn't stale.
  useEffect(() => {
    if (proposal && autoAccept && proposal.revision === revision) {
      const p = proposal;
      setProposal(null);
      acceptProposal(p);
    }
  }, [proposal, autoAccept, revision, acceptProposal]);

  const stale = !!proposal && proposal.revision !== revision;

  return (
    <div className="flex flex-col h-full">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex-1 overflow-y-auto space-y-3 pr-1"
      >
        {messages.length === 0 && (
          <p className="text-sm text-fg/50 italic">
            Ask the assistant to build or fix this widget — e.g. “show the top 5
            items as a table” or “this stopped working, fix it.”
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-fg' : 'text-fg/90'}>
            <div className="text-[10px] uppercase tracking-wide text-fg/40 mb-0.5">
              {m.role}
            </div>
            {m.role === 'assistant' ? (
              <div className="prose prose-sm max-w-none">
                <MarkdownRenderer content={m.content} showThinking={false} />
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-sm">{m.content}</p>
            )}
          </div>
        ))}
        {proposal && !autoAccept && (
          <WidgetProposalCard
            proposal={proposal}
            current={getState()}
            stale={stale}
            onAccept={() => acceptProposal(proposal)}
            onReject={() => {
              const rejected = proposal;
              setProposal(null);
              setMessages((m) => [
                ...m,
                { role: 'user', content: 'Rejected that proposal.' },
              ]);
              send('I rejected that proposal.', messages, lastError);
              void rejected;
            }}
          />
        )}
        {streaming && (
          <div className="flex items-center gap-2 text-fg/50 text-xs">
            <LoaderCircle size={14} className="animate-spin" /> Thinking…
          </div>
        )}
      </div>

      <div className="pt-2 border-t border-surface-2 mt-2 space-y-2">
        {selection && (
          <div className="text-xs">
            <button
              type="button"
              onClick={() => setShowModel((v) => !v)}
              className="text-fg/60 hover:text-fg"
              title="Choose the model the assistant uses"
            >
              Model: {selection.chatModel || 'default'}
              {selection.systemModel &&
              selection.systemModel !== selection.chatModel
                ? ` · sys: ${selection.systemModel}`
                : ''}{' '}
              {showModel ? '▲' : '▼'}
            </button>
            {showModel && (
              <div className="mt-2">
                <ModelPicker
                  value={selection}
                  onChange={setSelection}
                  fields={{ system: true }}
                  presets="apply-save"
                  layout="dialog"
                />
              </div>
            )}
          </div>
        )}
        <label className="flex items-center gap-2 text-xs text-fg/60">
          <input
            type="checkbox"
            aria-label="Auto-apply proposals"
            checked={autoAccept}
            onChange={(e) => onToggleAutoAccept(e.target.checked)}
          />
          Auto-apply proposals to the editor (you still Preview &amp; Save)
        </label>
        <div className="flex gap-2 px-0.5 pb-0.5">
          <textarea
            value={input}
            aria-label="Message to assistant"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            rows={2}
            placeholder="Describe a change…"
            className="flex-1 px-3 py-2 border border-surface-2 rounded-control bg-bg text-fg text-sm focus:outline-none focus:ring-2 focus:ring-accent resize-none"
          />
          <button
            type="button"
            onClick={handleSubmit}
            aria-label="Send message"
            disabled={streaming || !input.trim()}
            className="px-3 self-end py-2 bg-accent text-accent-fg rounded-control hover:bg-accent-700 disabled:opacity-50"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default WidgetChatPanel;
