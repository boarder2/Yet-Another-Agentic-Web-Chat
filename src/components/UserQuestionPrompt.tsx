'use client';

import { useState, useEffect, useCallback } from 'react';
import { HelpCircle, X, Send, SkipForward } from 'lucide-react';

export type PendingQuestion = {
  questionId: string;
  question: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
  allowFreeformInput?: boolean;
  context?: string;
  toolCallId?: string;
  createdAt?: number;
  status: 'pending' | 'answered' | 'skipped' | 'timed_out';
  response?: {
    selectedOptions?: string[];
    freeformText?: string;
  };
};

export function UserQuestionPrompt({
  questionId,
  question,
  options,
  multiSelect = false,
  allowFreeformInput = true,
  context,
  createdAt,
  onSubmit,
  onSkip,
  onDismiss,
  queuePosition,
  queueTotal,
}: {
  questionId: string;
  question: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
  allowFreeformInput?: boolean;
  context?: string;
  createdAt?: number;
  onSubmit: (
    questionId: string,
    response: { selectedOptions?: string[]; freeformText?: string },
  ) => void;
  onSkip: (questionId: string) => void;
  onDismiss?: () => void;
  queuePosition?: number;
  queueTotal?: number;
}) {
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(
    new Set(),
  );
  const [freeformText, setFreeformText] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // Countdown timer (15 minutes from backend createdAt)
  const TIMEOUT_MS = 15 * 60 * 1000;
  const [remainingSeconds, setRemainingSeconds] = useState(() => {
    if (createdAt) {
      const elapsed = Date.now() - createdAt;
      return Math.max(0, Math.floor((TIMEOUT_MS - elapsed) / 1000));
    }
    return 15 * 60;
  });

  useEffect(() => {
    if (submitted) return;
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onSkip(questionId);
          onDismiss?.();
          setSubmitted(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [submitted, onSkip, questionId, onDismiss]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleOptionToggle = useCallback(
    (label: string) => {
      setSelectedOptions((prev) => {
        const next = new Set(prev);
        if (multiSelect) {
          if (next.has(label)) {
            next.delete(label);
          } else {
            next.add(label);
          }
        } else {
          // Single-select: clear others
          if (next.has(label)) {
            next.clear();
          } else {
            next.clear();
            next.add(label);
          }
        }
        return next;
      });
    },
    [multiSelect],
  );

  const handleSubmit = useCallback(() => {
    if (submitted) return;
    setSubmitted(true);
    const response: { selectedOptions?: string[]; freeformText?: string } = {};
    if (selectedOptions.size > 0) {
      response.selectedOptions = Array.from(selectedOptions);
    }
    if (freeformText.trim()) {
      response.freeformText = freeformText.trim();
    }
    onSubmit(questionId, response);
    onDismiss?.();
  }, [
    submitted,
    selectedOptions,
    freeformText,
    questionId,
    onSubmit,
    onDismiss,
  ]);

  const handleSkip = useCallback(() => {
    if (submitted) return;
    setSubmitted(true);
    onSkip(questionId);
    onDismiss?.();
  }, [submitted, questionId, onSkip, onDismiss]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  if (submitted) return null;

  const hasSelection = selectedOptions.size > 0 || freeformText.trim() !== '';

  return (
    <div className="mb-2 border border-surface-2 rounded-floating overflow-hidden bg-surface shadow-raised flex flex-col max-h-[calc(100svh-16rem)] lg:max-h-[calc(100svh-16rem)]">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-5 py-3 bg-surface-2/70">
        <div className="flex items-center gap-2">
          <HelpCircle size={16} className="text-accent" />
          <span className="text-sm font-semibold text-fg">
            Agent has a question
          </span>
          {queueTotal && queueTotal > 1 && (
            <span className="text-xs font-medium text-fg/60 bg-surface-2 px-2 py-0.5 rounded-pill">
              {queuePosition} of {queueTotal}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg/40 font-mono tabular-nums">
            {formatTime(remainingSeconds)}
          </span>
          <button
            onClick={handleSkip}
            className="p-1 rounded-control hover:bg-surface-2 transition-colors text-fg/50 hover:text-fg"
            aria-label="Skip"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="overflow-y-auto flex-1 min-h-0">
        {/* Question */}
        <div className="px-5 py-3 border-b border-surface-2">
          <p className="text-sm text-fg font-medium">{question}</p>
          {context && <p className="text-xs text-fg/50 mt-1">{context}</p>}
        </div>

        {/* Options */}
        {options && options.length > 0 && (
          <div className="px-5 py-3 border-b border-surface-2 space-y-2">
            {options.map((opt) => {
              const isSelected = selectedOptions.has(opt.label);
              return (
                <button
                  key={opt.label}
                  onClick={() => handleOptionToggle(opt.label)}
                  className={`w-full text-left px-4 py-2.5 rounded-surface border transition-colors text-sm ${
                    isSelected
                      ? 'border-accent bg-accent/10 text-fg'
                      : 'border-surface-2 hover:border-fg/20 text-fg/80 hover:text-fg'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Radio/Checkbox indicator */}
                    <div
                      className={`flex-shrink-0 w-4 h-4 rounded-${multiSelect ? 'sm' : 'pill'} border-2 flex items-center justify-center ${
                        isSelected ? 'border-accent bg-accent' : 'border-fg/30'
                      }`}
                    >
                      {isSelected && (
                        <div
                          className={`w-1.5 h-1.5 rounded-${multiSelect ? 'sm' : 'pill'} bg-accent-fg`}
                        />
                      )}
                    </div>
                    <div>
                      <span className="font-medium">{opt.label}</span>
                      {opt.description && (
                        <p className="text-xs text-fg/50 mt-0.5">
                          {opt.description}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Freeform text input */}
        {allowFreeformInput !== false && (
          <div className="px-5 py-3 border-b border-surface-2">
            <textarea
              autoFocus
              value={freeformText}
              onChange={(e) => setFreeformText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                options && options.length > 0
                  ? 'Type additional context or an alternative response...'
                  : 'Type your response...'
              }
              className="w-full bg-surface-2/50 border border-surface-2 rounded-surface px-3 py-2 text-sm text-fg placeholder:text-fg/30 focus:outline-none focus:border-accent resize-none"
              rows={2}
            />
          </div>
        )}
      </div>
      {/* end scrollable content */}

      {/* Actions */}
      <div className="flex-shrink-0 flex gap-2 justify-end px-5 py-3 bg-surface border-t border-surface-2">
        <button
          onClick={handleSkip}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-surface bg-surface-2 text-fg/70 hover:text-fg hover:bg-surface-2/80 transition-colors"
        >
          <SkipForward size={14} />
          Skip
        </button>
        <button
          onClick={handleSubmit}
          disabled={!hasSelection}
          className={`flex items-center gap-1.5 px-5 py-2 text-sm font-medium rounded-surface transition-colors ${
            hasSelection
              ? 'bg-accent text-accent-fg hover:bg-accent/90'
              : 'bg-surface-2 text-fg/30 cursor-not-allowed'
          }`}
        >
          <Send size={14} />
          Submit
        </button>
      </div>
    </div>
  );
}
