'use client';

import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { Sparkles, Code2 } from 'lucide-react';

interface WidgetKindChooserProps {
  isOpen: boolean;
  onClose: () => void;
  onChoose: (kind: 'llm' | 'code') => void;
}

const WidgetKindChooser = ({
  isOpen,
  onClose,
  onChoose,
}: WidgetKindChooserProps) => (
  <Dialog open={isOpen} onClose={onClose} className="relative z-50">
    <div className="fixed inset-0 bg-overlay" />
    <div className="fixed inset-0 flex items-center justify-center p-4">
      <DialogPanel className="w-full max-w-2xl rounded-floating bg-surface p-6 shadow-floating">
        <DialogTitle className="text-lg font-medium text-fg mb-4">
          Add a Widget
        </DialogTitle>
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
        </div>
      </DialogPanel>
    </div>
  </Dialog>
);

export default WidgetKindChooser;
