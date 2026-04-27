import {
  getScheduledRunRetentionPolicy,
  type RetentionPolicy,
} from '@/lib/config';

/**
 * Resolve effective retention policy for a scheduled task.
 * Task-level override wins over global (even when global is "disabled").
 */
export function resolveTaskRetentionPolicy(task: {
  retentionMode: 'days' | 'count' | 'disabled' | null;
  retentionValue: number | null;
}): RetentionPolicy {
  if (task.retentionMode === 'disabled') {
    return { mode: 'disabled', value: 0 };
  }
  if (task.retentionMode !== null && task.retentionValue !== null) {
    return {
      mode: task.retentionMode,
      value: task.retentionValue,
    };
  }
  return getScheduledRunRetentionPolicy();
}
