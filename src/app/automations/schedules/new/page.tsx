'use client';

import { useSearchParams } from 'next/navigation';
import { ListEmptyState, ListLoading } from '@/components/ui/List';
import ScheduleEditor from '@/components/workflows/ScheduleEditor';
import { useWorkflow } from '@/lib/hooks/api/useWorkflows';

export default function NewSchedulePage() {
  const workflowId = useSearchParams().get('workflow') ?? undefined;
  const { data: workflow, isLoading } = useWorkflow(workflowId);

  if (!workflowId)
    return (
      <ListEmptyState layout="page">No workflow specified.</ListEmptyState>
    );
  if (isLoading) {
    return <ListLoading layout="page" size={32} />;
  }
  if (!workflow)
    return <ListEmptyState layout="page">Workflow not found.</ListEmptyState>;

  return <ScheduleEditor workflow={workflow} />;
}
