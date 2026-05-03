'use client';

import { useState, useEffect } from 'react';
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { Fragment } from 'react';
import { cn } from '@/lib/utils';
import { formatTokens } from '@/lib/utils/tokens';
import { LoaderCircle } from 'lucide-react';

interface ContextIndicatorProps {
  chatModelContextWindow: number;
  estimatedUsage: number;
  messageCount: number;
  onCompact: (instructions?: string) => void;
  onChatContextSizeChange: (size: number) => void;
  compacting?: boolean;
}

const PRESET_SIZES = [32768, 65536, 131072, 262144];
const MIN_MESSAGES_FOR_COMPACTION = 9; // server requires > KEEP_LAST_N (8)

export default function ContextIndicator({
  chatModelContextWindow,
  estimatedUsage,
  messageCount,
  onCompact,
  onChatContextSizeChange,
  compacting,
}: ContextIndicatorProps) {
  const [chatCustomOpen, setChatCustomOpen] = useState(false);
  const [chatCustomValue, setChatCustomValue] = useState('');
  const [localContextWindow, setLocalContextWindow] = useState(
    chatModelContextWindow,
  );
  const [compactInstructions, setCompactInstructions] = useState('');

  // Sync from prop when it changes externally (e.g. settings page update)
  useEffect(() => {
    setLocalContextWindow(chatModelContextWindow);
  }, [chatModelContextWindow]);

  const pct =
    localContextWindow > 0
      ? Math.min(100, Math.round((estimatedUsage / localContextWindow) * 100))
      : 0;

  // Color coding
  const ringColor =
    pct > 75 ? 'text-danger' : pct >= 60 ? 'text-warning' : 'text-fg/40';

  // SVG arc parameters
  const size = 28;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * (pct / 100);
  const center = size / 2;

  return (
    <Popover className="relative">
      <PopoverButton
        className="p-1.5 rounded-control hover:bg-surface-2 transition duration-150"
        title={`Context usage: ${pct}%`}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Background circle */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-surface-2"
          />
          {/* Filled arc */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference - filled}`}
            strokeDashoffset={circumference / 4}
            transform={`rotate(-90 ${center} ${center})`}
            className={ringColor}
          />
          {/* Percentage label */}
          <text
            x={center}
            y={center}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-current text-fg"
            style={{ fontSize: '8px', fontWeight: 600 }}
          >
            {pct}%
          </text>
        </svg>
      </PopoverButton>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-150"
        enterFrom="opacity-0 scale-95"
        enterTo="opacity-100 scale-100"
        leave="transition ease-in duration-100"
        leaveFrom="opacity-100 scale-100"
        leaveTo="opacity-0 scale-95"
      >
        <PopoverPanel className="absolute bottom-full right-0 mb-2 w-80 z-50 bg-surface border border-surface-2 rounded-floating shadow-floating p-4">
          <div className="flex flex-col space-y-3">
            {/* Usage breakdown */}
            <div>
              <p className="text-xs font-semibold mb-2">Context Usage</p>
              <div className="flex items-center gap-2 mb-1.5">
                <div className="flex-1 h-2 bg-surface-2 rounded-pill overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-pill transition-all duration-200',
                      pct > 75
                        ? 'bg-danger'
                        : pct >= 60
                          ? 'bg-warning'
                          : 'bg-accent',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span
                  className={cn(
                    'text-xs font-semibold tabular-nums',
                    pct > 75
                      ? 'text-danger'
                      : pct >= 60
                        ? 'text-warning'
                        : 'text-fg',
                  )}
                >
                  {pct}%
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-fg/60">Used</span>
                <span className="text-fg/60">Free</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-fg font-semibold tabular-nums">
                  {formatTokens(estimatedUsage)}
                </span>
                <span className="text-fg font-semibold tabular-nums">
                  {formatTokens(
                    Math.max(0, localContextWindow - estimatedUsage),
                  )}
                </span>
              </div>
            </div>

            <hr className="border-surface-2" />

            {/* Chat context size */}
            <div>
              <p className="text-xs font-semibold mb-1.5">Context Size</p>
              <div className="flex flex-wrap gap-1">
                {PRESET_SIZES.map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={cn(
                      'px-2 py-0.5 text-xs rounded-control border transition-colors duration-150',
                      localContextWindow === size && !chatCustomOpen
                        ? 'border-accent bg-accent/20 text-accent'
                        : 'border-surface-2 hover:bg-surface-2',
                    )}
                    onClick={() => {
                      setChatCustomOpen(false);
                      setChatCustomValue('');
                      setLocalContextWindow(size);
                      onChatContextSizeChange(size);
                    }}
                  >
                    {formatTokens(size)}
                  </button>
                ))}
                <button
                  type="button"
                  className={cn(
                    'px-2 py-0.5 text-xs rounded-control border transition-colors duration-150',
                    chatCustomOpen
                      ? 'border-accent bg-accent/20 text-accent'
                      : 'border-surface-2 hover:bg-surface-2',
                  )}
                  onClick={() => {
                    setChatCustomOpen(true);
                    setChatCustomValue(String(localContextWindow));
                  }}
                >
                  Custom
                </button>
              </div>
              {chatCustomOpen && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <input
                    type="number"
                    min={512}
                    value={chatCustomValue}
                    placeholder={String(localContextWindow)}
                    onChange={(e) => setChatCustomValue(e.target.value)}
                    className="w-24 px-2 py-0.5 text-xs rounded-control border border-surface-2 bg-bg"
                  />
                  <button
                    type="button"
                    className="px-2 py-0.5 text-xs rounded-control bg-accent text-accent-fg hover:bg-accent-700 transition-colors duration-150"
                    onClick={() => {
                      const v = Math.max(
                        512,
                        parseInt(chatCustomValue) || localContextWindow,
                      );
                      setLocalContextWindow(v);
                      onChatContextSizeChange(v);
                      setChatCustomOpen(false);
                      setChatCustomValue('');
                    }}
                  >
                    Set
                  </button>
                </div>
              )}
            </div>

            <hr className="border-surface-2" />

            {/* Compact instructions */}
            <div>
              <p className="text-xs font-semibold mb-1.5">
                Compaction Instructions
              </p>
              <textarea
                value={compactInstructions}
                onChange={(e) => setCompactInstructions(e.target.value)}
                placeholder="Optional: specify what the summary should capture (key decisions, preferences, code patterns, etc.)"
                rows={2}
                className="w-full px-2 py-1 text-xs rounded-control border border-surface-2 bg-bg resize-none"
              />
            </div>

            {/* Compact button */}
            <button
              type="button"
              disabled={
                messageCount < MIN_MESSAGES_FOR_COMPACTION || compacting
              }
              className={cn(
                'w-full py-1.5 text-xs font-semibold rounded-control transition-colors duration-150 flex items-center justify-center gap-1.5',
                messageCount >= MIN_MESSAGES_FOR_COMPACTION && !compacting
                  ? 'bg-accent text-accent-fg hover:bg-accent-700'
                  : 'bg-surface-2 text-fg/30 cursor-not-allowed',
              )}
              onClick={() => {
                onCompact(compactInstructions.trim() || undefined);
                setCompactInstructions('');
              }}
            >
              {compacting ? (
                <>
                  <LoaderCircle className="animate-spin size-3" />
                  Compacting…
                </>
              ) : (
                'Compact conversation'
              )}
            </button>
            <p className="text-xs text-fg/40">
              {messageCount < MIN_MESSAGES_FOR_COMPACTION
                ? `At least ${MIN_MESSAGES_FOR_COMPACTION} messages are needed before compaction is available.`
                : 'Summarizes old messages to free up context space. The most recent messages are kept verbatim.'}
            </p>
          </div>
        </PopoverPanel>
      </Transition>
    </Popover>
  );
}
