import db from '@/lib/db';
import { appSettings } from '@/lib/db/schema';
import { NextResponse } from 'next/server';
import { inArray } from 'drizzle-orm';
import { isMigratedSettingKey } from '@/lib/settings/keys';
import { getAllSettings } from '@/lib/settings/server';

// Uses better-sqlite3 and Buffer — Node runtime only (not edge).
export const runtime = 'nodejs';

// Cap a single setting value to reject abuse. Generous enough for the rendered
// dashboard widget cache (LLM content across many widgets); hot-path reads use
// getSettings([...]) so a large cache value never loads on the chat path.
const MAX_SETTING_VALUE_BYTES = 5_000_000;

// Returns the full instance settings map as { key: value } of serialized
// strings — the same shape the client localStorage cache holds.
export async function GET() {
  try {
    return NextResponse.json(getAllSettings());
  } catch (error) {
    console.error('Failed to load settings:', error);
    return NextResponse.json(
      { error: 'Failed to load settings' },
      { status: 500 },
    );
  }
}

// Partial update: body is { key: string | null }. A string value upserts the
// key; null deletes it. Unknown keys (not in the migration allowlist) are
// ignored so the table can never accumulate arbitrary client-supplied keys.
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json(
        { error: 'Body must be an object of { key: string | null }' },
        { status: 400 },
      );
    }

    const now = new Date();
    const toDelete: string[] = [];
    const toUpsert: { key: string; value: string; updatedAt: Date }[] = [];

    for (const [key, value] of Object.entries(body)) {
      if (!isMigratedSettingKey(key)) continue;
      if (value === null) {
        toDelete.push(key);
      } else if (typeof value === 'string') {
        if (Buffer.byteLength(value, 'utf8') > MAX_SETTING_VALUE_BYTES) {
          return NextResponse.json(
            { error: `Value for "${key}" exceeds the maximum size` },
            { status: 413 },
          );
        }
        toUpsert.push({ key, value, updatedAt: now });
      } else {
        return NextResponse.json(
          { error: `Value for "${key}" must be a string or null` },
          { status: 400 },
        );
      }
    }

    db.transaction((tx) => {
      if (toDelete.length > 0) {
        tx.delete(appSettings).where(inArray(appSettings.key, toDelete)).run();
      }
      for (const row of toUpsert) {
        tx.insert(appSettings)
          .values(row)
          .onConflictDoUpdate({
            target: appSettings.key,
            set: { value: row.value, updatedAt: row.updatedAt },
          })
          .run();
      }
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Failed to save settings:', error);
    return NextResponse.json(
      { error: 'Failed to save settings' },
      { status: 500 },
    );
  }
}
