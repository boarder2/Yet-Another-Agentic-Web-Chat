import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { mcpServers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { getToolDescriptorsForEnabledServers } from '@/lib/mcp/manager';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const server = await db.query.mcpServers.findFirst({
      where: eq(mcpServers.id, id),
    });
    if (!server)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Return descriptors from the manager cache (or trigger a fresh fetch)
    const all = await getToolDescriptorsForEnabledServers();
    const tools = all.filter((d) => d.serverId === id);
    return NextResponse.json({ tools });
  } catch {
    return NextResponse.json({ error: 'Failed to get tools' }, { status: 500 });
  }
}
