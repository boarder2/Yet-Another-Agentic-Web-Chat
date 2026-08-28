import { NextResponse } from 'next/server';
import { clearMapCache } from '@/lib/maps/cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Clear durable map cache rows and the process-local sensitive cache. */
export async function DELETE() {
  try {
    const deleted = clearMapCache();
    return NextResponse.json({ deleted });
  } catch {
    return NextResponse.json(
      { error: 'Failed to clear map cache' },
      { status: 500 },
    );
  }
}
