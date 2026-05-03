# Update YAAWC to the latest version

To update YAAWC to the latest version, follow these steps:

## Release-specific migration steps

### Consolidated data volume (`app-data`)

This release merges the old `backend-dbstore`, `uploads`, and `workspace-files` paths into a single `app-data` volume. **Run these steps once before starting the new image**, or your existing chats and uploads will not be visible.

1. Copy your existing database into the new volume:

   ```bash
   docker volume create perplexica_app-data
   docker run --rm \
     -v perplexica_backend-dbstore:/from \
     -v perplexica_app-data:/to \
     alpine sh -c 'cp -a /from/. /to/'
   ```

2. Proceed with the normal update steps below. On first start the container will automatically drain the old `uploads` volume into the new location — no manual step needed for uploads.

3. After confirming everything works, you can remove the old volumes:

   ```bash
   docker volume rm perplexica_backend-dbstore perplexica_deep_research
   # Remove perplexica_uploads only after the next release drops the legacy mount
   ```

---

## For Docker users

1. Clone the latest version of YAAWC from GitHub:

   ```bash
   git clone https://github.com/boarder2/Yet-Another-Agentic-Web-Chat.git
   ```

2. Navigate to the project directory.

3. Review the release notes for any new configuration fields. If new fields have been added, update your `config.toml` accordingly. You can also use the Settings page in the web UI to manage configuration.

4. Pull the latest images from the registry.

   ```bash
   docker compose pull
   ```

5. Update and recreate the containers.

   ```bash
   docker compose up -d
   ```

6. Once the command completes, go to http://localhost:3000 and verify the latest changes.

## For non-Docker users

1. Clone the latest version of YAAWC from GitHub:

   ```bash
   git clone https://github.com/boarder2/Yet-Another-Agentic-Web-Chat.git
   ```

2. Navigate to the project directory.

3. Review the release notes for any new configuration fields. If new fields have been added, update your `config.toml` accordingly. You can also use the Settings page in the web UI to manage configuration.
4. After populating the configuration run `npm i`.
5. Install the dependencies and then execute `npm run build`.
6. Finally, start the app by running `npm run start`

---
