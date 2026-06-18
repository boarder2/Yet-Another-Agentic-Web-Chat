'use client';

import WidgetConfigModal from '@/components/dashboard/WidgetConfigModal';
import CodeWidgetConfigModal from '@/components/dashboard/CodeWidgetConfigModal';
import WidgetKindChooser from '@/components/dashboard/WidgetKindChooser';
import type { WidgetBoard } from '@/lib/hooks/useWidgetBoard';

/**
 * The widget kind chooser + LLM/code editor dialogs, driven by a `useWidgetBoard`
 * instance. Shared so the dashboard and home surfaces mount identical editors.
 */
const WidgetModals = ({ board }: { board: WidgetBoard }) => {
  const { activeModal, editingWidget, seedCode } = board;

  return (
    <>
      <WidgetKindChooser
        isOpen={activeModal === 'chooser'}
        onClose={board.closeModal}
        onChoose={board.handleChooseKind}
        ceEnabled={board.ceEnabled}
        existingWidgets={board.addableWidgets}
        onAddExisting={board.handleAddExisting}
      />

      <WidgetConfigModal
        isOpen={activeModal === 'llm'}
        onClose={board.closeModal}
        onSave={board.handleSaveWidget}
        editingWidget={
          editingWidget?.widgetType === 'llm' ? editingWidget : null
        }
      />

      <CodeWidgetConfigModal
        isOpen={activeModal === 'code'}
        onClose={board.closeModal}
        onSave={board.handleSaveCodeWidget}
        editingWidget={
          editingWidget?.widgetType === 'code' ? editingWidget : null
        }
        seedCode={seedCode}
      />
    </>
  );
};

export default WidgetModals;
