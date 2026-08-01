'use client';

import { Plus, Trash2 } from 'lucide-react';
import Select from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Source } from '@/lib/types/widget';

interface SourceListEditorProps {
  sources: Source[];
  onChange: (sources: Source[]) => void;
}

// Shared, controlled source-list editor used by both the LLM and code widget
// editors.
const SourceListEditor = ({ sources, onChange }: SourceListEditorProps) => {
  const update = (index: number, field: keyof Source, value: string) =>
    onChange(
      sources.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    );

  const add = () => onChange([...sources, { url: '', type: 'Web Page' }]);
  const remove = (index: number) =>
    onChange(sources.filter((_, i) => i !== index));

  return (
    <div className="space-y-2">
      {sources.map((source, index) => (
        <div key={index} className="flex gap-2">
          <Input
            type="url"
            aria-label="Source URL"
            value={source.url}
            onChange={(e) => update(index, 'url', e.target.value)}
            placeholder="https://example.com"
          />
          <Select
            value={source.type}
            onChange={(e) =>
              update(index, 'type', e.target.value as Source['type'])
            }
          >
            <option value="Web Page">Web Page</option>
            <option value="HTTP Data">HTTP Data</option>
          </Select>
          <button
            type="button"
            onClick={() => remove(index)}
            className="p-2 text-danger hover:bg-danger-soft rounded-control"
            aria-label="Remove source"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-2 px-3 py-2 text-sm text-accent hover:bg-surface-2 rounded-control"
      >
        <Plus size={16} />
        Add Source
      </button>
    </div>
  );
};

export default SourceListEditor;
