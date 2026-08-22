# Updating YAAWC

Update a deployment from a reviewed release, not from an unexamined image or working-tree state. YAAWC applies database migrations during the Docker entrypoint and during the manual `npm run build` command, so take a backup before changing the image or source and keep the exact encryption passphrase with the backup.

## Before an update

1. Review the release notes for the target release. Look for database migrations, required configuration changes, image requirements, and known rollback limits.
2. Finish or cancel every chat run that is `running` or `awaiting_user` before replacing the deployment. These turns depend on their active LangGraph checkpoint and are not an update-safe handoff; use `/api/chat/runs/active` to confirm the active-run list is empty before proceeding.
3. Choose a stable semver image tag or commit/tag. The Compose file uses `boarder2/yaawc:latest`, which is a mutable channel; it is convenient for tracking the default published channel but is not reproducible. Prefer a pinned semver tag or image digest for production, and record the previous value for rollback.
4. Stop writes while taking the backup. Preserve the SQLite database, uploads, workspace-file blobs, the SearXNG configuration directory, and the exact `config.toml` or environment source that contains the passphrase.
5. Store the passphrase separately from the database backup. It is required to decrypt credentials after the update; changing it is not an update procedure.

For a Compose deployment, do not use `docker compose down -v`: that removes named volumes. Stop the app without removing its volumes, then archive the mounted `app-data` volume using your deployment's actual Compose volume name, or use an equivalent volume-backup tool:

```bash
docker compose down
```

For a manual deployment, archive the directory selected by `DATA_DIR`:

```bash
umask 077
mkdir -p backups
export DATA_DIR="$PWD/data"
tar -C "$DATA_DIR" -czf "backups/yaawc-data-$(date +%F).tgz" .
cp config.toml "backups/config-$(date +%F).toml"
```

If `CONFIG_PATH` or an environment secret supplies configuration, back up that source and record the value of `CONFIG_PATH` without putting the passphrase in shell history or logs.

## Docker update

### Pull and recreate

From the directory containing `docker-compose.yaml` and the deployment's `config.toml`:

```bash
# Edit docker-compose.yaml first if moving from latest to a pinned tag.
docker compose pull app
docker compose up -d
```

`docker compose up -d` recreates the app when the image or configuration changed. The container's entrypoint runs the database migrator before starting the server. If the Compose file's SearXNG image or configuration also needs an update, review that change separately and pull/recreate the intended service explicitly.

For a pinned release, set the app image to a semver tag or digest before pulling, for example:

```yaml
services:
  app:
    image: boarder2/yaawc:<stable-version>
```

Do not copy a placeholder tag literally; use the reviewed release tag or digest and keep the old value in the rollback record.

### Verify the deployment

Check the container state and startup log before treating the update as complete:

```bash
docker compose ps
docker compose logs --no-color --tail=200 app
curl -f http://localhost:5005/api/config
```

Then open the application and verify that existing chats, uploads, workspace files, credentials, model discovery, search, and any enabled Docker-backed tools behave as expected. A successful HTTP response alone does not prove that the correct data volume or configuration was mounted. Confirm that `DATA_DIR`, `CONFIG_PATH`, and the passphrase source are unchanged.

## Manual update

### Select the reviewed source

Keep local changes and configuration outside the release checkout. Fetch tags, inspect the target release notes, and check out the reviewed stable tag (or fast-forward the deployment branch to the reviewed commit):

```bash
git fetch --tags origin
git checkout <stable-tag>
```

Use a semver tag or commit recorded in the update log. Do not update by blindly pulling an arbitrary branch when reproducibility matters.

### Install and migrate

Use one explicit `DATA_DIR` for every database, build, and runtime command. This is required because the application defaults to `<working directory>/data`, while `drizzle-kit` defaults to the working directory itself when `DATA_DIR` is unset.

```bash
export DATA_DIR="$PWD/data"
npm ci
npm run build
```

`npm run build` runs `npm run db:push` before the Next.js build. If the schema must be applied separately, run `DATA_DIR="$DATA_DIR" npm run db:push`; keep the same value for the build and the later server process. Do not create a second database by omitting `DATA_DIR` from a Drizzle command.

Start the reviewed build on the configured listener:

```bash
npm start
```

The repository start script uses port `5005`; place the deployment behind the appropriate reverse proxy or invoke Next directly with a matching port when using a different listener.

## Verify and recover

After a manual start, inspect the server output for migration or startup errors and check the configured URL. Verify the same data and feature set as the Docker procedure: chats, uploads, workspace files, credentials, provider/model discovery, search, and enabled optional services.

If a migration or start fails:

1. Stop the deployment and save the logs. Do not repeatedly start an image against an unknown database state.
2. Check the release notes, `DATA_DIR`, `CONFIG_PATH`, file permissions, available disk space, and the passphrase before changing anything else.
3. Keep the failed database and logs until the failure is understood. Do not delete the data volume or overwrite the backup.
4. If the failure happened after a database migration, restore the pre-update database and associated uploads/workspace files from the backup before attempting the previous release. A previous application may not understand a newer schema.
5. Restore the previous pinned Docker image or check out the previous source tag, reinstall its lockfile dependencies, and use the same explicit `DATA_DIR` and passphrase.
6. Start the previous release and verify the restored data. Once it is healthy, decide whether to retry the target release from a fresh backup or keep the rollback.

A rollback is not complete until the old release, database backup, configuration, and passphrase are a consistent set. Never restore the database without restoring the corresponding content-addressed workspace files and uploads.
