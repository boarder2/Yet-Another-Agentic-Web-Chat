'use client';

import { useParams } from 'next/navigation';
import { ListEmptyState, ListLoading } from '@/components/ui/List';
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
    return <ListLoading layout="page" size={32} />;
  }
  if (!schedule || !workflow)
    return <ListEmptyState layout="page">Schedule not found.</ListEmptyState>;

  return <ScheduleEditor workflow={workflow} schedule={schedule} />;
}
