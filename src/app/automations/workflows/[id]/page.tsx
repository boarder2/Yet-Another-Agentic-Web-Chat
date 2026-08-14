'use client';

import { useParams } from 'next/navigation';
import { ListEmptyState, ListLoading } from '@/components/ui/List';
import WorkflowBuilder from '@/components/workflows/WorkflowBuilder';
import { useWorkflow } from '@/lib/hooks/api/useWorkflows';

export default function EditWorkflowPage() {
  const { id } = useParams<{ id: string }>();
  const { data: workflow, isLoading } = useWorkflow(id);

  if (isLoading) {
    return <ListLoading layout="page" size={32} />;
  }
  if (!workflow)
    return <ListEmptyState layout="page">Workflow not found.</ListEmptyState>;

  return <WorkflowBuilder workflow={workflow} />;
}
