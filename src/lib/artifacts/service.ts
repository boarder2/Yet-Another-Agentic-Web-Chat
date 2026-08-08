import db from '@/lib/db';
import { artifacts, artifactVersions, chats } from '@/lib/db/schema';
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { applyExactEdit, type ExactEditResult } from './applyExactEdit';

/** The handle passed to a `db.transaction` callback. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ArtifactSummary {
  id: string;
  chatId: string | null;
  workspaceId: string | null;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  latestVersion: number;
  versionCount: number;
}

/** Every artifact, joined to its owning chat's title as provenance. */
export interface ArtifactListSummary extends ArtifactSummary {
  chatTitle: string | null;
}

export interface VersionMeta {
  version: number;
  messageId: string;
  createdAt: Date;
  bytes: number;
}

/**
 * Who is asking. A workspace chat reaches every artifact in its workspace; an
 * unscoped chat reaches only its own. `workspaceId` is the *chat's* workspace,
 * not the artifact's.
 */
export interface ArtifactScope {
  chatId: string;
  workspaceId: string | null;
}

/** Rows the scope may read and edit, as a reusable WHERE fragment. */
function reachable(scope: ArtifactScope) {
  const own = and(
    eq(artifacts.chatId, scope.chatId),
    isNull(artifacts.workspaceId),
  );
  return scope.workspaceId
    ? or(own, eq(artifacts.workspaceId, scope.workspaceId))
    : own;
}

/** Version rows for `artifactId`, oldest first, without the content column. */
function versionMeta(artifactId: string): VersionMeta[] {
  return db
    .select({
      version: artifactVersions.version,
      messageId: artifactVersions.messageId,
      createdAt: artifactVersions.createdAt,
      bytes: sql<number>`length(${artifactVersions.content})`,
    })
    .from(artifactVersions)
    .where(eq(artifactVersions.artifactId, artifactId))
    .orderBy(artifactVersions.version)
    .all();
}

/** The summary projection, shared by every list query. */
const summarySelect = {
  id: artifacts.id,
  chatId: artifacts.chatId,
  workspaceId: artifacts.workspaceId,
  title: artifacts.title,
  createdAt: artifacts.createdAt,
  updatedAt: artifacts.updatedAt,
  latestVersion: sql<number>`coalesce(max(${artifactVersions.version}), 0)`,
  versionCount: sql<number>`count(${artifactVersions.id})`,
};

/**
 * A new artifact. `workspaceId` comes from the creating chat: when set, the
 * workspace owns the artifact and `chatId` is only provenance.
 */
export function createArtifact(
  scope: ArtifactScope,
  messageId: string,
  title: string,
  content: string,
): { artifactId: string; version: number } {
  return db.transaction((tx) => {
    const [row] = tx
      .insert(artifacts)
      .values({
        chatId: scope.chatId,
        workspaceId: scope.workspaceId,
        title,
      })
      .returning()
      .all();
    tx.insert(artifactVersions)
      .values({ artifactId: row.id, messageId, version: 1, content })
      .run();
    return { artifactId: row.id, version: 1 };
  });
}

export type EditArtifactResult =
  | { ok: true; version: number; title: string }
  | { ok: false; reason: 'not_found'; message: string }
  | Extract<ExactEditResult, { ok: false }>;

/**
 * Apply an exact-match edit to the artifact's latest version, writing the
 * result as a new full snapshot. The read of the latest version and the write
 * of its successor share one transaction, so concurrent edits — including two
 * chats in the same workspace — can't collide on the same version number, and
 * the loser's `oldStr` is matched against the winner's content.
 */
export function editArtifact(
  artifactId: string,
  scope: ArtifactScope,
  messageId: string,
  oldStr: string,
  newStr: string,
): EditArtifactResult {
  return db.transaction((tx) => {
    const [artifact] = tx
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.id, artifactId), reachable(scope)))
      .all();
    if (!artifact) {
      return {
        ok: false as const,
        reason: 'not_found' as const,
        message: `No artifact with id "${artifactId}" is available here. Artifacts belong to a chat, or to its workspace; create one with create_artifact.`,
      };
    }

    const [latest] = tx
      .select()
      .from(artifactVersions)
      .where(eq(artifactVersions.artifactId, artifactId))
      .orderBy(desc(artifactVersions.version))
      .limit(1)
      .all();
    if (!latest) {
      return {
        ok: false as const,
        reason: 'not_found' as const,
        message: `Artifact "${artifactId}" has no content to edit.`,
      };
    }

    const edit = applyExactEdit(latest.content, oldStr, newStr);
    if (!edit.ok) return edit;

    const version = latest.version + 1;
    tx.insert(artifactVersions)
      .values({ artifactId, messageId, version, content: edit.content })
      .run();
    tx.update(artifacts)
      .set({ updatedAt: new Date() })
      .where(eq(artifacts.id, artifactId))
      .run();
    return { ok: true as const, version, title: artifact.title };
  });
}

export type ReadArtifactResult =
  | { ok: true; id: string; title: string; version: number; content: string }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'no_such_version'; latestVersion: number };

/**
 * One version of an artifact, content included — the latest unless `version`
 * says otherwise. Scoped: an artifact the caller can't reach is indistinguishable
 * from a missing one, so nothing leaks about other chats or workspaces. An
 * out-of-range version is distinguished so the caller can say which it is.
 */
export function readArtifact(
  artifactId: string,
  scope: ArtifactScope,
  version?: number,
): ReadArtifactResult {
  const [artifact] = db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.id, artifactId), reachable(scope)))
    .all();
  if (!artifact) return { ok: false, reason: 'not_found' };

  const row = getVersion(artifactId, version);
  if (!row) {
    const latest = getVersion(artifactId);
    // An artifact with no versions at all is unreachable: a rewind deletes any
    // artifact it leaves empty, so this only fires for a bad version number.
    if (!latest) return { ok: false, reason: 'not_found' };
    return {
      ok: false,
      reason: 'no_such_version',
      latestVersion: latest.version,
    };
  }

  return {
    ok: true,
    id: artifact.id,
    title: artifact.title,
    version: row.version,
    content: row.content,
  };
}

/** The artifact row alone, without touching its versions. */
export function getArtifact(artifactId: string) {
  const [row] = db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, artifactId))
    .all();
  return row ?? null;
}

/** Artifacts created by this chat, most recently updated first. */
export function listArtifacts(chatId: string): ArtifactSummary[] {
  return db
    .select(summarySelect)
    .from(artifacts)
    .leftJoin(artifactVersions, eq(artifactVersions.artifactId, artifacts.id))
    .where(eq(artifacts.chatId, chatId))
    .groupBy(artifacts.id)
    .orderBy(desc(artifacts.updatedAt))
    .all();
}

/** Every artifact the workspace owns — the sidebar's list. */
export function listWorkspaceArtifacts(workspaceId: string): ArtifactSummary[] {
  return db
    .select(summarySelect)
    .from(artifacts)
    .leftJoin(artifactVersions, eq(artifactVersions.artifactId, artifacts.id))
    .where(eq(artifacts.workspaceId, workspaceId))
    .groupBy(artifacts.id)
    .orderBy(desc(artifacts.updatedAt))
    .all();
}

/**
 * Every artifact across all chats and workspaces, most recently updated
 * first, joined to its owning chat's title when the chat still exists.
 * `workspaceIds` mirrors `buildWorkspaceCondition`: ids select those
 * workspaces' artifacts, the literal `none` selects chat-scoped artifacts
 * (`workspaceId IS NULL`), both are the OR, and absent means all.
 */
export function listAllArtifacts(filter: {
  workspaceIds?: string[];
}): ArtifactListSummary[] {
  const realIds = (filter.workspaceIds ?? []).filter((id) => id !== 'none');
  const includeNone = (filter.workspaceIds ?? []).includes('none');
  let where: SQL | undefined;
  if (realIds.length > 0 && includeNone) {
    where = or(
      inArray(artifacts.workspaceId, realIds),
      isNull(artifacts.workspaceId),
    );
  } else if (realIds.length > 0) {
    where = inArray(artifacts.workspaceId, realIds);
  } else if (includeNone) {
    where = isNull(artifacts.workspaceId);
  }
  return db
    .select({ ...summarySelect, chatTitle: chats.title })
    .from(artifacts)
    .leftJoin(artifactVersions, eq(artifactVersions.artifactId, artifacts.id))
    .leftJoin(chats, eq(chats.id, artifacts.chatId))
    .where(where)
    .groupBy(artifacts.id)
    .orderBy(desc(artifacts.updatedAt))
    .all();
}

/**
 * What the agent is told exists: artifacts this chat created, plus those the
 * user mentioned in it. A mentioned id the scope can't reach simply doesn't
 * come back, so an id arriving from anywhere else drops out silently.
 */
export function listRosterArtifacts(
  scope: ArtifactScope,
  mentionedIds: string[],
): ArtifactSummary[] {
  const created = eq(artifacts.chatId, scope.chatId);
  const where =
    mentionedIds.length > 0
      ? or(created, and(inArray(artifacts.id, mentionedIds), reachable(scope)))
      : created;
  return db
    .select(summarySelect)
    .from(artifacts)
    .leftJoin(artifactVersions, eq(artifactVersions.artifactId, artifacts.id))
    .where(where)
    .groupBy(artifacts.id)
    .orderBy(desc(artifacts.updatedAt))
    .all();
}

/** An artifact plus its full version list — metadata only, no content. */
export function getArtifactDetail(
  artifactId: string,
): (ArtifactSummary & { versions: VersionMeta[] }) | null {
  const [artifact] = db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, artifactId))
    .all();
  if (!artifact) return null;

  const versions = versionMeta(artifactId);
  return {
    ...artifact,
    latestVersion: versions.length ? versions[versions.length - 1].version : 0,
    versionCount: versions.length,
    versions,
  };
}

/** A specific version row (latest when `version` is omitted), content included. */
export function getVersion(artifactId: string, version?: number) {
  const [row] = db
    .select()
    .from(artifactVersions)
    .where(
      version === undefined
        ? eq(artifactVersions.artifactId, artifactId)
        : and(
            eq(artifactVersions.artifactId, artifactId),
            eq(artifactVersions.version, version),
          ),
    )
    .orderBy(desc(artifactVersions.version))
    .limit(1)
    .all();
  return row ?? null;
}

/** Rows the given ids resolve to that the workspace owns. */
function workspaceOwned(tx: Tx, ids: string[]): string[] {
  if (ids.length === 0) return [];
  return tx
    .select({ id: artifacts.id })
    .from(artifacts)
    .where(and(inArray(artifacts.id, ids), isNotNull(artifacts.workspaceId)))
    .all()
    .map((r) => r.id);
}

function dropArtifacts(tx: Tx, ids: string[]): void {
  if (ids.length === 0) return;
  tx.delete(artifactVersions)
    .where(inArray(artifactVersions.artifactId, ids))
    .run();
  tx.delete(artifacts).where(inArray(artifacts.id, ids)).run();
}

/**
 * Chat deletion. Chat-scoped artifacts die with the chat; workspace-scoped ones
 * belong to the workspace and survive, keeping their versions and losing only
 * the provenance pointer to the chat that is going away.
 */
export function deleteForChat(chatId: string): void {
  db.transaction((tx) => {
    const owned = tx
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(and(eq(artifacts.chatId, chatId), isNull(artifacts.workspaceId)))
      .all()
      .map((r) => r.id);
    dropArtifacts(tx, owned);
    tx.update(artifacts)
      .set({ chatId: null })
      .where(eq(artifacts.chatId, chatId))
      .run();
  });
}

/** Workspace deletion takes its artifacts with it. */
export function deleteForWorkspace(workspaceId: string): void {
  db.transaction((tx) => {
    const ids = tx
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(eq(artifacts.workspaceId, workspaceId))
      .all()
      .map((r) => r.id);
    dropArtifacts(tx, ids);
  });
}

/**
 * The only standalone delete, and only for workspace-scoped artifacts: a
 * chat-scoped artifact is part of its transcript and dies with it. Returns
 * false when the id is missing or not the workspace's to delete.
 */
export function deleteWorkspaceArtifact(
  artifactId: string,
  workspaceId: string,
): boolean {
  return db.transaction((tx) => {
    const [row] = tx
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(
        and(
          eq(artifacts.id, artifactId),
          eq(artifacts.workspaceId, workspaceId),
        ),
      )
      .all();
    if (!row) return false;
    dropArtifacts(tx, [row.id]);
    return true;
  });
}

/**
 * Rewind cleanup: drop the versions those messages produced, then drop any
 * artifact left with no versions at all. Workspace-scoped artifacts are exempt —
 * once an artifact belongs to the workspace its history is shared, and rewinding
 * one chat's turn must not roll back work another chat built on top of.
 */
export function deleteVersionsForMessages(messageIds: string[]): void {
  if (messageIds.length === 0) return;
  db.transaction((tx) => {
    const affected = tx
      .selectDistinct({ artifactId: artifactVersions.artifactId })
      .from(artifactVersions)
      .where(inArray(artifactVersions.messageId, messageIds))
      .all()
      .map((r) => r.artifactId);
    if (affected.length === 0) return;

    const exempt = new Set(workspaceOwned(tx, affected));
    const targets = affected.filter((id) => !exempt.has(id));
    if (targets.length === 0) return;

    tx.delete(artifactVersions)
      .where(
        and(
          inArray(artifactVersions.messageId, messageIds),
          inArray(artifactVersions.artifactId, targets),
        ),
      )
      .run();

    const surviving = tx
      .selectDistinct({ artifactId: artifactVersions.artifactId })
      .from(artifactVersions)
      .where(inArray(artifactVersions.artifactId, targets))
      .all()
      .map((r) => r.artifactId);
    dropArtifacts(
      tx,
      targets.filter((id) => !surviving.includes(id)),
    );
  });
}
