'use client';

import { formatTimeDifference } from '@/lib/utils';
import { describeCron } from '@/lib/scheduledTasks/presets';
import {
  CalendarClock,
  LoaderCircle,
  Plus,
  Play,
  Pencil,
  Trash2,
  ArrowLeft,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Task {
  id: string;
  name: string;
  prompt: string;
  focusMode: string;
  cronExpression: string;
  timezone: string | null;
  enabled: number;
  lastRunAt: number | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  lastRunChatId: string | null;
  createdAt: number;
}

const Page = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const router = useRouter();

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/scheduled-tasks');
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const toggleEnabled = async (task: Task) => {
    const newEnabled = task.enabled ? 0 : 1;
    await fetch(`/api/scheduled-tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: newEnabled }),
    });
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, enabled: newEnabled } : t)),
    );
  };

  const runNow = async (task: Task) => {
    setRunningTaskId(task.id);
    try {
      const res = await fetch(`/api/scheduled-tasks/${task.id}/run`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        if (data.chatId) {
          router.push(`/c/${data.chatId}`);
        }
      }
    } catch {
      // Ignore
    } finally {
      setRunningTaskId(null);
    }
  };

  const deleteTask = async (task: Task) => {
    if (!confirm(`Delete task "${task.name}"?`)) return;
    await fetch(`/api/scheduled-tasks/${task.id}`, { method: 'DELETE' });
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
  };

  return (
    <div className="flex flex-col pt-4">
      <div className="flex items-center justify-between px-1 mb-6">
        <div className="flex items-center gap-3">
          <Link
            href="/scheduled-tasks"
            className="text-fg/60 hover:text-fg transition"
          >
            <ArrowLeft size={20} />
          </Link>
          <CalendarClock />
          <h2 className="text-3xl font-medium">Manage Tasks</h2>
        </div>
        <Link
          href="/scheduled-tasks/new"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-surface bg-accent text-accent-fg text-sm transition duration-200 hover:opacity-90"
        >
          <Plus size={14} />
          New task
        </Link>
      </div>

      {loading && (
        <div className="flex flex-row items-center justify-center min-h-[50vh]">
          <LoaderCircle size={32} className="animate-spin text-accent" />
        </div>
      )}

      {!loading && tasks.length === 0 && (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-fg/60">
          <CalendarClock size={48} className="mb-4 opacity-50" />
          <p className="text-lg mb-2">No scheduled tasks</p>
          <p className="text-sm mb-4">Create a task to get started.</p>
          <Link
            href="/scheduled-tasks/new"
            className="flex items-center gap-1.5 px-4 py-2 rounded-surface bg-accent text-accent-fg text-sm transition duration-200 hover:opacity-90"
          >
            <Plus size={14} />
            Create task
          </Link>
        </div>
      )}

      {!loading && tasks.length > 0 && (
        <div className="flex flex-col pb-20 lg:pb-2">
          {tasks.map((task, i) => (
            <div
              className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 py-5 ${i !== tasks.length - 1 ? 'border-b border-surface-2' : ''}`}
              key={task.id}
            >
              <div className="flex flex-col gap-1 min-w-0 flex-1">
                <span className="font-medium text-lg truncate">
                  {task.name}
                </span>
                <div className="flex items-center gap-3 text-xs text-fg/60">
                  <span>{describeCron(task.cronExpression)}</span>
                  {task.lastRunAt && (
                    <span className="flex items-center gap-1">
                      {task.lastRunStatus === 'success' ? (
                        <CheckCircle size={12} className="text-success" />
                      ) : task.lastRunStatus === 'error' ? (
                        <XCircle size={12} className="text-danger" />
                      ) : null}
                      Last run{' '}
                      {formatTimeDifference(
                        new Date(),
                        new Date(task.lastRunAt),
                      )}{' '}
                      ago
                    </span>
                  )}
                  {task.lastRunChatId ? (
                    <Link
                      href={`/c/${task.lastRunChatId}`}
                      className="text-xs text-accent hover:underline"
                    >
                      Open last run
                    </Link>
                  ) : task.lastRunAt ? (
                    <span className="text-xs text-fg/40 italic">
                      Chat no longer available
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => toggleEnabled(task)}
                  className={`px-3 py-1 rounded-pill text-xs font-medium transition ${
                    task.enabled
                      ? 'bg-success-soft text-success dark:text-success border border-success'
                      : 'bg-surface-2 text-fg/50 border border-surface-2'
                  }`}
                >
                  {task.enabled ? 'Enabled' : 'Disabled'}
                </button>
                <button
                  onClick={() => runNow(task)}
                  disabled={runningTaskId === task.id}
                  className="p-1.5 rounded-surface hover:bg-surface-2 transition text-fg/60 hover:text-fg disabled:opacity-50"
                  title="Run now"
                >
                  <Play size={16} />
                </button>
                <Link
                  href={`/scheduled-tasks/manage/${task.id}/edit`}
                  className="p-1.5 rounded-surface hover:bg-surface-2 transition text-fg/60 hover:text-fg"
                  title="Edit"
                >
                  <Pencil size={16} />
                </Link>
                <button
                  onClick={() => deleteTask(task)}
                  className="p-1.5 rounded-surface hover:bg-surface-2 transition text-fg/60 hover:text-danger"
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Page;
