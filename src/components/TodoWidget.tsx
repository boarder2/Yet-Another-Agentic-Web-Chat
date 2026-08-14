'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  Circle,
  LoaderCircle,
  ChevronRight,
  ListTodo,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';

export interface TodoItemData {
  content: string;
  status: string; // 'pending' | 'in_progress' | 'completed'
}

interface TodoWidgetProps {
  items: TodoItemData[];
}

const TodoWidget = ({ items }: TodoWidgetProps) => {
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) return null;

  const completed = items.filter((t) => t.status === 'completed').length;
  const inProgressItem = items.find((t) => t.status === 'in_progress');
  const summary = inProgressItem
    ? inProgressItem.content
    : items.find((t) => t.status === 'pending')?.content || '';

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 size={14} className="text-success shrink-0" />;
      case 'in_progress':
        return (
          <LoaderCircle
            size={14}
            className="animate-spin text-accent shrink-0"
          />
        );
      case 'pending':
      default:
        return <Circle size={14} className="text-fg-subtle shrink-0" />;
    }
  };

  return (
    <Card className="mb-2 overflow-hidden">
      {/* Collapsed header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full border border-transparent px-3 py-2 flex items-center gap-2 hover:bg-surface-2/50 transition-colors duration-150 text-sm focus-border-neutral"
      >
        <ListTodo size={14} className="text-accent shrink-0" />
        <span className="font-medium text-fg-muted">Tasks</span>
        <span className="text-fg-subtle">
          {completed}/{items.length}
        </span>
        {summary && (
          <>
            <span className="text-fg-subtle">-</span>
            <span className="text-fg-muted truncate text-left flex-1">
              {summary}
            </span>
          </>
        )}
        <ChevronRight
          size={14}
          className={`text-fg-subtle shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {/* Expanded list */}
      {expanded && (
        <div className="px-3 pb-2 pt-1 border-t border-surface-2 space-y-1">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-start gap-2 py-0.5">
              <div className="mt-0.5">{getStatusIcon(item.status)}</div>
              <span
                className={`text-sm ${
                  item.status === 'completed'
                    ? 'text-fg-subtle line-through'
                    : 'text-fg'
                }`}
              >
                {item.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

export default TodoWidget;
