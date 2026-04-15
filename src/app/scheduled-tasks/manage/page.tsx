'use client';

import { formatTimeDifference } from '@/lib/utils';
import { describeCron } from '@/lib/scheduledTasks/presets';
import {
  CalendarClock,
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
          router.push(`/scheduled-tasks/runs/${data.chatId}`);
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-sm transition duration-200 hover:opacity-90"
        >
          <Plus size={14} />
          New task
        </Link>
      </div>

      {loading && (
        <div className="flex flex-row items-center justify-center min-h-[50vh]">
          <svg
            aria-hidden="true"
            className="w-8 h-8 text-surface-2 fill-accent animate-spin"
            viewBox="0 0 100 101"
            fill="none"
          >
            <path
              d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
              fill="currentColor"
            />
            <path
              d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
              fill="currentFill"
            />
          </svg>
        </div>
      )}

      {!loading && tasks.length === 0 && (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-fg/60">
          <CalendarClock size={48} className="mb-4 opacity-50" />
          <p className="text-lg mb-2">No scheduled tasks</p>
          <p className="text-sm mb-4">Create a task to get started.</p>
          <Link
            href="/scheduled-tasks/new"
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-sm transition duration-200 hover:opacity-90"
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
                        <CheckCircle size={12} className="text-green-500" />
                      ) : task.lastRunStatus === 'error' ? (
                        <XCircle size={12} className="text-red-500" />
                      ) : null}
                      Last run{' '}
                      {formatTimeDifference(
                        new Date(),
                        new Date(task.lastRunAt),
                      )}{' '}
                      ago
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => toggleEnabled(task)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                    task.enabled
                      ? 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20'
                      : 'bg-surface-2 text-fg/50 border border-surface-2'
                  }`}
                >
                  {task.enabled ? 'Enabled' : 'Disabled'}
                </button>
                <button
                  onClick={() => runNow(task)}
                  disabled={runningTaskId === task.id}
                  className="p-1.5 rounded-lg hover:bg-surface-2 transition text-fg/60 hover:text-fg disabled:opacity-50"
                  title="Run now"
                >
                  <Play size={16} />
                </button>
                <Link
                  href={`/scheduled-tasks/manage/${task.id}/edit`}
                  className="p-1.5 rounded-lg hover:bg-surface-2 transition text-fg/60 hover:text-fg"
                  title="Edit"
                >
                  <Pencil size={16} />
                </Link>
                <button
                  onClick={() => deleteTask(task)}
                  className="p-1.5 rounded-lg hover:bg-surface-2 transition text-fg/60 hover:text-red-500"
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
