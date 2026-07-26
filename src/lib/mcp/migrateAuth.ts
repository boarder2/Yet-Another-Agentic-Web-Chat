import 'server-only';

import db from '@/lib/db';
import { mcpServers, mcpOauth } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { encrypt, isEncrypted } from '@/lib/encryption';

/**
 * One-time, idempotent boot migration: encrypt any plaintext MCP auth secrets
 * still stored from before encryption-at-rest. Safe to run on every boot —
 * `isEncrypted()` skips rows already migrated.
 */
export function migrateMcpAuth(): void {
  let migratedServers = 0;
  const servers = db.select().from(mcpServers).all();
  for (const server of servers) {
    // `extraHeaders` needs no pass here: its values are encrypted individually
    // on write and the column postdates encryption-at-rest, so no plaintext
    // rows exist to migrate.
    const update: { secretToken?: string; oauthClientSecret?: string } = {};
    if (server.secretToken && !isEncrypted(server.secretToken)) {
      update.secretToken = encrypt(server.secretToken);
    }
    if (server.oauthClientSecret && !isEncrypted(server.oauthClientSecret)) {
      update.oauthClientSecret = encrypt(server.oauthClientSecret);
    }
    if (Object.keys(update).length > 0) {
      db.update(mcpServers)
        .set(update)
        .where(eq(mcpServers.id, server.id))
        .run();
      migratedServers++;
    }
  }

  let migratedOauth = 0;
  const oauthRows = db.select().from(mcpOauth).all();
  for (const row of oauthRows) {
    const update: {
      tokens?: string;
      clientInformation?: string;
      discoveryState?: string;
    } = {};
    if (row.tokens && !isEncrypted(row.tokens)) {
      update.tokens = encrypt(row.tokens);
    }
    if (row.clientInformation && !isEncrypted(row.clientInformation)) {
      update.clientInformation = encrypt(row.clientInformation);
    }
    if (row.discoveryState && !isEncrypted(row.discoveryState)) {
      update.discoveryState = encrypt(row.discoveryState);
    }
    if (Object.keys(update).length > 0) {
      db.update(mcpOauth)
        .set(update)
        .where(eq(mcpOauth.serverId, row.serverId))
        .run();
      migratedOauth++;
    }
  }

  if (migratedServers > 0 || migratedOauth > 0) {
    console.log(
      `[mcp] Encrypted plaintext auth for ${migratedServers} server(s) and ${migratedOauth} OAuth row(s).`,
    );
  }
}
