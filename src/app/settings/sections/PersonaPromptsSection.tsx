'use client';

import { Edit3, Trash2, X, Save, PlusCircle } from 'lucide-react';
import SettingsSection from '../components/SettingsSection';
import InputComponent from '../components/InputComponent';
import TextareaComponent from '../components/TextareaComponent';
import CopyTemplatePicker from '../components/CopyTemplatePicker';
import { Prompt } from '@/lib/types/prompt';

export default function PersonaPromptsSection({
  userSystemPrompts,
  editingPrompt,
  newPromptName,
  newPromptContent,
  isAddingNewPrompt,
  setEditingPrompt,
  setNewPromptName,
  setNewPromptContent,
  setIsAddingNewPrompt,
  onAddOrUpdate,
  onDelete,
}: {
  userSystemPrompts: Prompt[];
  editingPrompt: Prompt | null;
  newPromptName: string;
  newPromptContent: string;
  isAddingNewPrompt: boolean;
  setEditingPrompt: (prompt: Prompt | null) => void;
  setNewPromptName: (name: string) => void;
  setNewPromptContent: (content: string) => void;
  setIsAddingNewPrompt: (val: boolean) => void;
  onAddOrUpdate: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <SettingsSection title="Persona Prompts">
      <p className="text-xs text-fg/60">
        Persona prompts control <strong>what </strong> the response looks like -
        tone, style, formatting, and citation rules. When active, they override
        the default formatting instructions. Persona prompts do not affect the
        research process itself; use a Research Methodology for that.
      </p>
      <div className="flex flex-col space-y-4">
        <div className="flex items-center justify-between p-3 bg-surface rounded-surface border border-surface-2 gap-3">
          <div className="text-sm">
            Copy a starter Formatting & Citations template
          </div>
          <CopyTemplatePicker />
        </div>
        {userSystemPrompts
          .filter((prompt) => prompt.type === 'persona')
          .map((prompt) => (
            <div
              key={prompt.id}
              className="p-3 border border-surface-2 rounded-control bg-surface-2"
            >
              {editingPrompt && editingPrompt.id === prompt.id ? (
                <div className="space-y-3">
                  <InputComponent
                    type="text"
                    value={editingPrompt.name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setEditingPrompt({
                        ...editingPrompt,
                        name: e.target.value,
                      })
                    }
                    placeholder="Prompt Name"
                    className=""
                  />
                  <TextareaComponent
                    value={editingPrompt.content}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setEditingPrompt({
                        ...editingPrompt,
                        content: e.target.value,
                      })
                    }
                    placeholder="Prompt Content"
                    className="min-h-[100px]"
                  />
                  <div className="flex space-x-2 justify-end">
                    <button
                      onClick={() => setEditingPrompt(null)}
                      className="px-3 py-2 text-sm rounded-control bg-surface hover:bg-surface-2 flex items-center gap-1.5"
                    >
                      <X size={16} />
                      Cancel
                    </button>
                    <button
                      onClick={onAddOrUpdate}
                      className="px-3 py-2 text-sm rounded-control bg-accent flex items-center gap-1.5"
                    >
                      <Save size={16} />
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-between items-start">
                  <div className="flex-grow">
                    <h4 className="font-semibold">{prompt.name}</h4>
                    <p
                      className="text-sm mt-1 whitespace-pre-wrap overflow-hidden text-ellipsis"
                      style={{
                        maxHeight: '3.6em',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {prompt.content}
                    </p>
                  </div>
                  <div className="flex space-x-1 flex-shrink-0 ml-2">
                    <button
                      onClick={() => setEditingPrompt({ ...prompt })}
                      title="Edit"
                      className="p-1.5 rounded-control hover:bg-surface-2"
                    >
                      <Edit3 size={18} />
                    </button>
                    <button
                      onClick={() => onDelete(prompt.id)}
                      title="Delete"
                      className="p-1.5 rounded-control hover:bg-surface-2 text-danger hover:text-danger"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        {isAddingNewPrompt && (
          <div className="p-3 border border-dashed border-surface-2 rounded-control space-y-3 bg-surface-2">
            <InputComponent
              type="text"
              value={newPromptName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setNewPromptName(e.target.value)
              }
              placeholder="Persona Prompt Name"
              className=""
            />
            <TextareaComponent
              value={newPromptContent}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setNewPromptContent(e.target.value)
              }
              placeholder="Persona prompt content (e.g., You are a helpful assistant that speaks like a pirate and uses nautical metaphors.)"
              className="min-h-[100px]"
            />
            <div className="flex space-x-2 justify-end">
              <button
                onClick={() => {
                  setIsAddingNewPrompt(false);
                  setNewPromptName('');
                  setNewPromptContent('');
                }}
                className="px-3 py-2 text-sm rounded-control bg-surface hover:bg-surface-2 flex items-center gap-1.5"
              >
                <X size={16} />
                Cancel
              </button>
              <button
                onClick={onAddOrUpdate}
                className="px-3 py-2 text-sm rounded-control bg-accent flex items-center gap-1.5"
              >
                <Save size={16} />
                Add Persona Prompt
              </button>
            </div>
          </div>
        )}
        {!isAddingNewPrompt && (
          <button
            onClick={() => setIsAddingNewPrompt(true)}
            className="self-start px-3 py-2 text-sm rounded-control border border-surface-2 hover:bg-surface-2 flex items-center gap-1.5"
          >
            <PlusCircle size={18} /> Add Persona Prompt
          </button>
        )}
      </div>
    </SettingsSection>
  );
}
