'use client';

import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { Sparkles, Code2, Plus } from 'lucide-react';
import { Widget } from '@/lib/types/widget';

interface WidgetKindChooserProps {
  isOpen: boolean;
  onClose: () => void;
  onChoose: (kind: 'llm' | 'code') => void;
  /** Whether code widgets can be created (code execution enabled). */
  ceEnabled?: boolean;
  /** Existing widgets not yet on this surface, offered for one-click adding. */
  existingWidgets?: Widget[];
  onAddExisting?: (widget: Widget) => void;
}

const WidgetKindChooser = ({
  isOpen,
  onClose,
  onChoose,
  ceEnabled = true,
  existingWidgets = [],
  onAddExisting,
}: WidgetKindChooserProps) => (
  <Dialog open={isOpen} onClose={onClose} className="relative z-50">
    <div className="fixed inset-0 bg-overlay" />
    <div className="fixed inset-0 flex items-center justify-center p-4">
      <DialogPanel className="w-full max-w-2xl rounded-floating bg-surface p-6 shadow-floating max-h-[85vh] overflow-y-auto">
        <DialogTitle className="text-lg font-medium text-fg mb-4">
          Add a Widget
        </DialogTitle>

        <p className="text-xs font-medium uppercase tracking-wide text-fg/50 mb-2">
          Create new
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => onChoose('llm')}
            className="text-left p-4 rounded-surface border-2 border-accent bg-surface hover:bg-surface-2 transition"
          >
            <div className="flex items-center gap-2 text-fg font-medium mb-2">
              <Sparkles size={18} className="text-accent" />
              AI Widget
            </div>
            <p className="text-sm text-fg/70">
              Describe what you want in plain English. Costs tokens each
              refresh.
            </p>
          </button>
          {ceEnabled && (
            <button
              type="button"
              onClick={() => onChoose('code')}
              className="text-left p-4 rounded-surface border border-surface-2 bg-surface hover:bg-surface-2 transition"
            >
              <div className="flex items-center gap-2 text-fg font-medium mb-2">
                <Code2 size={18} />
                Code Widget
              </div>
              <p className="text-sm text-fg/70">
                Write JavaScript for exact, free, fast output. For developers.
              </p>
            </button>
          )}
        </div>

        {existingWidgets.length > 0 && onAddExisting && (
          <>
            <p className="text-xs font-medium uppercase tracking-wide text-fg/50 mt-6 mb-2">
              Add existing
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {existingWidgets.map((widget) => (
                <button
                  key={widget.id}
                  type="button"
                  onClick={() => onAddExisting(widget)}
                  className="flex items-center justify-between gap-2 text-left px-3 py-2 rounded-surface border border-surface-2 bg-surface hover:bg-surface-2 transition"
                  title={`Add "${widget.title}" to this page`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {widget.widgetType === 'code' ? (
                      <Code2 size={15} className="shrink-0 text-fg/60" />
                    ) : (
                      <Sparkles size={15} className="shrink-0 text-accent" />
                    )}
                    <span className="truncate text-sm text-fg">
                      {widget.title}
                    </span>
                  </span>
                  <Plus size={15} className="shrink-0 text-fg/50" />
                </button>
              ))}
            </div>
          </>
        )}
      </DialogPanel>
    </div>
  </Dialog>
);

export default WidgetKindChooser;
