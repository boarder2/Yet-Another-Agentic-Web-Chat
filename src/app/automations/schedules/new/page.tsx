'use client';

import { useSearchParams } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';
import ScheduleEditor from '@/components/workflows/ScheduleEditor';
import { useWorkflow } from '@/lib/hooks/api/useWorkflows';

export default function NewSchedulePage() {
  const workflowId = useSearchParams().get('workflow') ?? undefined;
  const { data: workflow, isLoading } = useWorkflow(workflowId);

  if (!workflowId)
    return <div className="p-8 text-fg/60">No workflow specified.</div>;
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <LoaderCircle size={32} className="animate-spin text-accent" />
      </div>
    );
  }
  if (!workflow)
    return <div className="p-8 text-fg/60">Workflow not found.</div>;

  return <ScheduleEditor workflow={workflow} />;
}
