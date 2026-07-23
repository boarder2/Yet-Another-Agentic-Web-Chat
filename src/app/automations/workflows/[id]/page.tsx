'use client';

import { useParams } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';
import WorkflowBuilder from '@/components/workflows/WorkflowBuilder';
import { useWorkflow } from '@/lib/hooks/api/useWorkflows';

export default function EditWorkflowPage() {
  const { id } = useParams<{ id: string }>();
  const { data: workflow, isLoading } = useWorkflow(id);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <LoaderCircle size={32} className="animate-spin text-accent" />
      </div>
    );
  }
  if (!workflow)
    return <div className="p-8 text-fg/60">Workflow not found.</div>;

  return <WorkflowBuilder workflow={workflow} />;
}
