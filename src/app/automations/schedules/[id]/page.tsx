'use client';

import { useParams } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';
import ScheduleEditor from '@/components/workflows/ScheduleEditor';
import { useSchedule } from '@/lib/hooks/api/useSchedules';
import { useWorkflow } from '@/lib/hooks/api/useWorkflows';

export default function EditSchedulePage() {
  const { id } = useParams<{ id: string }>();
  const { data: schedule, isLoading: loadingSchedule } = useSchedule(id);
  const { data: workflow, isLoading: loadingWorkflow } = useWorkflow(
    schedule?.workflowId,
  );

  if (loadingSchedule || loadingWorkflow) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <LoaderCircle size={32} className="animate-spin text-accent" />
      </div>
    );
  }
  if (!schedule || !workflow)
    return <div className="p-8 text-fg/60">Schedule not found.</div>;

  return <ScheduleEditor workflow={workflow} schedule={schedule} />;
}
