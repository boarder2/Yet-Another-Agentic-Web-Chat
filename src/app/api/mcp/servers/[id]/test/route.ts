import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { mcpServers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { testMcpServerConnection } from '@/lib/mcp/manager';

export async function POST(
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

    const result = await testMcpServerConnection(server);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Test failed' }, { status: 500 });
  }
}
