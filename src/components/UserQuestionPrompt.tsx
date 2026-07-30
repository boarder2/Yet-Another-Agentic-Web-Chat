'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { HelpCircle, Send, SkipForward } from 'lucide-react';
import ApprovalPanel from '@/components/ui/ApprovalPanel';

export type { PendingQuestion } from '@/lib/streaming/chatState';

export function UserQuestionPrompt({
  questionId,
  question,
  options,
  multiSelect = false,
  allowFreeformInput = true,
  context,
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

  // No countdown timer — with interrupt-based flow, runs persist indefinitely until user responds.

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
    <ApprovalPanel
      icon={HelpCircle}
      title="Agent has a question"
      queuePosition={queuePosition}
      queueTotal={queueTotal}
      onDismiss={handleSkip}
      dismissLabel="Skip"
      footer={
        <>
          <Button size="lg" icon={SkipForward} onClick={handleSkip}>
            Skip
          </Button>
          <Button
            variant="primary"
            size="lg"
            icon={Send}
            onClick={handleSubmit}
            disabled={!hasSelection}
          >
            Submit
          </Button>
        </>
      }
    >
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
                type="button"
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
            aria-label="Your response"
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
    </ApprovalPanel>
  );
}
