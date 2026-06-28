import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { mcpServers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { startOAuthAuthorization } from '@/lib/mcp/oauth';

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
    if (server.authType !== 'oauth') {
      return NextResponse.json(
        { error: 'Server does not use interactive OAuth' },
        { status: 400 },
      );
    }

    const result = await startOAuthAuthorization(server);

    if (!result.authorizationUrl) {
      // Already authorized
      return NextResponse.json({ alreadyAuthorized: true });
    }

    return NextResponse.json({ authorizationUrl: result.authorizationUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
