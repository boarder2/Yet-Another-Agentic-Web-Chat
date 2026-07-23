import { NextRequest } from 'next/server';
import { runSchedule } from '@/lib/scheduledTasks/runner';

export const runtime = 'nodejs';

// Run-now: fire a schedule immediately (same headless path as its cron trigger).
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await runSchedule(id);
  if (result.status === 'error' && !result.chatId) {
    return Response.json({ error: result.error }, { status: 404 });
  }
  return Response.json(result);
}
