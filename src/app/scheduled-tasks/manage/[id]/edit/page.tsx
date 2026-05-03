'use client';

import TaskForm from '@/components/ScheduledTaskForm';
import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';

export default function EditTaskPage() {
  const params = useParams<{ id: string }>();
  const [task, setTask] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/scheduled-tasks/${params.id}`)
      .then((r) => r.json())
      .then((data) => {
        setTask(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <LoaderCircle size={32} className="animate-spin text-accent" />
      </div>
    );
  }

  if (!task) {
    return <div className="p-8 text-fg/60">Task not found.</div>;
  }

  const chatModel = task.chatModel as { provider: string; name: string } | null;
  const systemModel = task.systemModel as {
    provider: string;
    name: string;
  } | null;
  const embeddingModel = task.embeddingModel as {
    provider: string;
    name: string;
  } | null;

  return (
    <TaskForm
      taskId={params.id}
      initialData={{
        name: (task.name as string) || '',
        prompt: (task.prompt as string) || '',
        focusMode: (task.focusMode as string) || 'webSearch',
        sourceUrls: (task.sourceUrls as string[]) || [],
        chatModel: chatModel
          ? { provider: chatModel.provider, name: chatModel.name }
          : null,
        systemModel: systemModel
          ? { provider: systemModel.provider, name: systemModel.name }
          : null,
        embeddingModel: embeddingModel
          ? { provider: embeddingModel.provider, name: embeddingModel.name }
          : null,
        selectedSystemPromptIds:
          (task.selectedSystemPromptIds as string[]) || [],
        selectedMethodologyId: (task.selectedMethodologyId as string) || null,
        cronExpression: (task.cronExpression as string) || '0 8 * * *',
        timezone: (task.timezone as string) || '',
        enabled: !!task.enabled,
        retentionMode: (task.retentionMode as string) || null,
        retentionValue: (task.retentionValue as number) ?? null,
      }}
    />
  );
}
