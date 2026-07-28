-- Custom SQL migration file, put your code below! --

-- Carry the old per-schedule viewed flag into the shared run-state columns
-- before it goes away: pre-existing scheduled runs have last_run_status NULL,
-- which every unread query rejects, so without this they'd silently become
-- read forever. Only fills rows no run has stamped yet.
UPDATE chats
SET last_run_viewed = 0, last_run_status = 'completed'
WHERE schedule_id IS NOT NULL
  AND scheduled_run_viewed = 0
  AND last_run_status IS NULL;
--> statement-breakpoint
-- SQLite refuses to DROP COLUMN while an index references it, and the next
-- migration drops chats.scheduled_run_viewed. This index (created in 0004,
-- recreated in 0005) is invisible to drizzle-kit — the schema never declared
-- it, so no generated migration removes it. Push-maintained databases have
-- already had it pruned, hence IF EXISTS.
DROP INDEX IF EXISTS `chats_scheduled_run_viewed_idx`;