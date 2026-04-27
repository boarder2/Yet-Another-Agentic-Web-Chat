import { NextRequest } from 'next/server';
import { runScheduledTask } from '@/lib/scheduledTasks/runner';

export const runtime = 'nodejs';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await runScheduledTask(id);
  return Response.json(result);
}
