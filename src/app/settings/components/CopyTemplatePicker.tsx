'use client';

import { useState } from 'react';
import { PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import {
  formattingAndCitationsLocal,
  formattingAndCitationsScholarly,
  formattingAndCitationsWeb,
  formattingChat,
} from '@/lib/prompts/templates';

export default function CopyTemplatePicker() {
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<string>('web');

  const getTemplateText = () => {
    switch (selected) {
      case 'local':
        return formattingAndCitationsLocal.content;
      case 'chat':
        return formattingChat.content;
      case 'scholarly':
        return formattingAndCitationsScholarly.content;
      case 'web':
      default:
        return formattingAndCitationsWeb.content;
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getTemplateText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error('Failed to copy template:', e);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        options={[
          { value: 'web', label: 'Web (default web rules)' },
          { value: 'local', label: 'Local (files research)' },
          { value: 'chat', label: 'Chat (light formatting)' },
          { value: 'scholarly', label: 'Scholarly (academic)' },
        ]}
      />
      <Button
        size="sm"
        icon={copied ? undefined : PlusCircle}
        onClick={handleCopy}
        className={copied ? 'bg-success-soft text-success border-success' : ''}
        title="Copy selected template"
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
