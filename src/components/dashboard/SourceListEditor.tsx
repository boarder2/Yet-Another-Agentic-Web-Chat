'use client';

import { Plus, Trash2 } from 'lucide-react';
import Select from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
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
    <div className="space-y-2" role="group" aria-label="Widget sources">
      {sources.map((source, index) => (
        <div key={index} className="flex gap-2">
          <Input
            type="url"
            aria-label={`Source URL ${index + 1}`}
            value={source.url}
            onChange={(e) => update(index, 'url', e.target.value)}
            placeholder="https://example.com"
          />
          <Select
            aria-label={`Source type ${index + 1}`}
            value={source.type}
            onChange={(e) =>
              update(index, 'type', e.target.value as Source['type'])
            }
          >
            <option value="Web Page">Web Page</option>
            <option value="HTTP Data">HTTP Data</option>
          </Select>
          <IconButton
            icon={Trash2}
            label="Remove source"
            tone="danger"
            onClick={() => remove(index)}
          />
        </div>
      ))}
      <Button variant="ghost" size="sm" icon={Plus} onClick={add}>
        Add Source
      </Button>
    </div>
  );
};

export default SourceListEditor;
