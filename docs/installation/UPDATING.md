# Update YAAWC to the latest version

To update YAAWC to the latest version, follow these steps:

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
