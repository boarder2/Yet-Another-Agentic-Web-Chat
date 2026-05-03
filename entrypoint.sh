#!/bin/sh
set -e

# One-time migration: legacy /home/yaawc/uploads-legacy → ${DATA_DIR}/uploads
if [ -d /home/yaawc/uploads-legacy ] && [ "$(ls -A /home/yaawc/uploads-legacy 2>/dev/null)" ]; then
  mkdir -p "${DATA_DIR}/uploads"
  cp -an /home/yaawc/uploads-legacy/. "${DATA_DIR}/uploads/" || true
fi

node migrate.js

exec node server.js
