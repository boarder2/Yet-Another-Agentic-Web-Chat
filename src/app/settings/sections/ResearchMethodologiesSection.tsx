'use client';

import { useState } from 'react';
import {
  Edit3,
  Trash2,
  X,
  Save,
  PlusCircle,
  ChevronDown,
  ChevronRight,
  Clipboard,
} from 'lucide-react';
import SettingsSection from '../components/SettingsSection';
import InputComponent from '../components/InputComponent';
import TextareaComponent from '../components/TextareaComponent';
import Select from '../components/Select';
import { Prompt } from '@/lib/types/prompt';
import { builtinMethodologyTemplates } from '@/lib/prompts/methodologyTemplates';

const AVAILABLE_TOOLS = [
  { name: 'web_search', description: 'Search the web for information' },
  {
    name: 'url_summarization',
    description: 'Fetch and summarize content from URLs',
  },
  { name: 'image_search', description: 'Search for images on the web' },
  {
    name: 'image_analysis',
    description: 'Analyze and describe image content',
  },
  {
    name: 'youtube_transcript',
    description: 'Extract transcripts from YouTube videos',
  },
  {
    name: 'pdf_loader',
    description: 'Load and extract content from PDF files',
  },
  {
    name: 'deep_research',
    description:
      'Launch a subagent for comprehensive multi-source research gathering',
  },
  {
    name: 'todo_list',
    description: 'Manage a task list for multi-step research plans',
  },
  {
    name: 'file_search',
    description: 'Search through uploaded files using semantic search',
  },
];

const BUILTIN_TEMPLATES = builtinMethodologyTemplates.map((t) => ({
  value: t.id,
  label: t.name,
}));

function getTemplateContent(templateId: string): string {
  return (
    builtinMethodologyTemplates.find((t) => t.id === templateId)?.content ?? ''
  );
}

export default function ResearchMethodologiesSection({
  userMethodologies,
  editingMethodology,
  newMethodologyName,
  newMethodologyContent,
  isAddingNewMethodology,
  setEditingMethodology,
  setNewMethodologyName,
  setNewMethodologyContent,
  setIsAddingNewMethodology,
  onAddOrUpdate,
  onDelete,
}: {
  userMethodologies: Prompt[];
  editingMethodology: Prompt | null;
  newMethodologyName: string;
  newMethodologyContent: string;
  isAddingNewMethodology: boolean;
  setEditingMethodology: (prompt: Prompt | null) => void;
  setNewMethodologyName: (name: string) => void;
  setNewMethodologyContent: (content: string) => void;
  setIsAddingNewMethodology: (val: boolean) => void;
  onAddOrUpdate: () => void;
  onDelete: (id: string) => void;
}) {
  const [toolRefOpen, setToolRefOpen] = useState(false);
  const [copiedTemplate, setCopiedTemplate] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(
    BUILTIN_TEMPLATES[0]?.value ?? '',
  );

  const handleCopyTemplate = async () => {
    const content = getTemplateContent(selectedTemplate);
    try {
      await navigator.clipboard.writeText(content);
      setCopiedTemplate(true);
      setTimeout(() => setCopiedTemplate(false), 1500);
    } catch (e) {
      console.error('Failed to copy template:', e);
    }
  };

  return (
    <SettingsSection title="Research Methodologies">
      <p className="text-xs text-fg/60">
        Methodologies control <strong>how </strong> the AI researches - the
        steps it follows, what to prioritize, and how to structure its
        investigation. When active, a methodology replaces the default research
        strategy while tool constraints (e.g., search limits) still apply. Only
        one can be active at a time. Applies to Web Search and Local Research
        modes. To change response tone or formatting, use a Persona Prompt
        instead.
      </p>
      <div className="flex flex-col space-y-4">
        <div className="flex items-center justify-between p-3 bg-surface rounded-lg border border-surface-2 gap-3">
          <div className="text-sm">Copy a built-in methodology template</div>
          <div className="flex items-center gap-2">
            <Select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              options={BUILTIN_TEMPLATES}
            />
            <button
              onClick={handleCopyTemplate}
              className={`px-3 py-2 text-sm rounded-md border border-surface-2 hover:bg-surface-2 flex items-center gap-1.5 ${copiedTemplate ? 'bg-green-100 text-green-800 border-green-200' : ''}`}
              title="Copy selected template"
            >
              {copiedTemplate ? (
                <span>Copied</span>
              ) : (
                <>
                  <Clipboard size={16} /> Copy
                </>
              )}
            </button>
          </div>
        </div>

        {/* Tool Reference Panel */}
        <div className="border border-surface-2 rounded-lg bg-surface">
          <button
            onClick={() => setToolRefOpen(!toolRefOpen)}
            className="flex items-center gap-2 w-full p-3 text-sm text-fg/70 hover:text-fg/90"
          >
            {toolRefOpen ? (
              <ChevronDown size={16} />
            ) : (
              <ChevronRight size={16} />
            )}
            <span>Available Tools Reference</span>
          </button>
          {toolRefOpen && (
            <div className="px-3 pb-3 space-y-1">
              <p className="text-xs text-fg/50 mb-2">
                Reference these tool names in your methodology instructions to
                guide the AI&apos;s tool usage.
              </p>
              {AVAILABLE_TOOLS.map((tool) => (
                <div key={tool.name} className="flex gap-2 text-xs py-0.5">
                  <code className="font-mono text-accent bg-surface-2 px-1 rounded whitespace-nowrap">
                    {tool.name}
                  </code>
                  <span className="text-fg/60">{tool.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {userMethodologies
          .filter((m) => m.type === 'methodology')
          .map((methodology) => (
            <div
              key={methodology.id}
              className="p-3 border border-surface-2 rounded-md bg-surface-2"
            >
              {editingMethodology &&
              editingMethodology.id === methodology.id ? (
                <div className="space-y-3">
                  <InputComponent
                    type="text"
                    value={editingMethodology.name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setEditingMethodology({
                        ...editingMethodology,
                        name: e.target.value,
                      })
                    }
                    placeholder="Methodology Name"
                    className=""
                  />
                  <TextareaComponent
                    value={editingMethodology.content}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setEditingMethodology({
                        ...editingMethodology,
                        content: e.target.value,
                      })
                    }
                    placeholder="Methodology Content"
                    className="min-h-[100px]"
                  />
                  <div className="flex space-x-2 justify-end">
                    <button
                      onClick={() => setEditingMethodology(null)}
                      className="px-3 py-2 text-sm rounded-md bg-surface hover:bg-surface-2 flex items-center gap-1.5"
                    >
                      <X size={16} />
                      Cancel
                    </button>
                    <button
                      onClick={onAddOrUpdate}
                      className="px-3 py-2 text-sm rounded-md bg-accent flex items-center gap-1.5"
                    >
                      <Save size={16} />
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-between items-start">
                  <div className="flex-grow">
                    <h4 className="font-semibold">{methodology.name}</h4>
                    <p
                      className="text-sm mt-1 whitespace-pre-wrap overflow-hidden text-ellipsis"
                      style={{
                        maxHeight: '3.6em',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {methodology.content}
                    </p>
                  </div>
                  <div className="flex space-x-1 flex-shrink-0 ml-2">
                    <button
                      onClick={() => setEditingMethodology({ ...methodology })}
                      title="Edit"
                      className="p-1.5 rounded-md hover:bg-surface-2"
                    >
                      <Edit3 size={18} />
                    </button>
                    <button
                      onClick={() => onDelete(methodology.id)}
                      title="Delete"
                      className="p-1.5 rounded-md hover:bg-surface-2 text-red-500 hover:text-red-600"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        {isAddingNewMethodology && (
          <div className="p-3 border border-dashed border-surface-2 rounded-md space-y-3 bg-surface-2">
            <InputComponent
              type="text"
              value={newMethodologyName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setNewMethodologyName(e.target.value)
              }
              placeholder="Methodology Name"
              className=""
            />
            <TextareaComponent
              value={newMethodologyContent}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setNewMethodologyContent(e.target.value)
              }
              placeholder="Methodology content (e.g., process instructions for how the AI should research). Tip: copy a built-in template above to start."
              className="min-h-[100px]"
            />
            <div className="flex space-x-2 justify-end">
              <button
                onClick={() => {
                  setIsAddingNewMethodology(false);
                  setNewMethodologyName('');
                  setNewMethodologyContent('');
                }}
                className="px-3 py-2 text-sm rounded-md bg-surface hover:bg-surface-2 flex items-center gap-1.5"
              >
                <X size={16} />
                Cancel
              </button>
              <button
                onClick={onAddOrUpdate}
                className="px-3 py-2 text-sm rounded-md bg-accent flex items-center gap-1.5"
              >
                <Save size={16} />
                Add Methodology
              </button>
            </div>
          </div>
        )}
        {!isAddingNewMethodology && (
          <button
            onClick={() => setIsAddingNewMethodology(true)}
            className="self-start px-3 py-2 text-sm rounded-md border border-surface-2 hover:bg-surface-2 flex items-center gap-1.5"
          >
            <PlusCircle size={18} /> Add Methodology
          </button>
        )}
      </div>
    </SettingsSection>
  );
}
