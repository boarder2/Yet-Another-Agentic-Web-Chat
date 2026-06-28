#!/usr/bin/env bash
# Smoke harness for YAAWC: launch the dev server (if not already up),
# drive it with playwright-cli, and capture a DOM/accessibility snapshot
# of the home + settings surfaces.
# Run from the repo root:  bash .claude/skills/run-yaawc/smoke.sh
#
# Observation is the text `snapshot` (diffable, greppable) — that's what
# this repo's playwright-cli skill prefers. Set SHOT=1 to also save PNG
# screenshots (only worth it for visual/layout bugs).
#
# Proves the app boots and renders. Does NOT exercise LLM responses
# (those need a configured model + provider key — see SKILL.md).
set -u

# next dev binds 3000, but auto-bumps to 3001 (then 3002…) when the port
# is taken — common in the Linux devcontainer. Never hardcode the port:
# probe both when reusing, and parse the actual one from the dev log when
# we start it. Override the candidate list with PORTS="3000 3001 8080".
PORTS="${PORTS:-3000 3001}"
SHOT="${SHOT:-0}"
SESSION=yaawc-smoke
ART=/tmp/yaawc-smoke
LOG=/tmp/yaawc-dev.log
mkdir -p "$ART"

# True if the port serves YAAWC (not just any 200 — /api/config returns
# JSON with chatModelProviders; a dummy/other app on the port won't).
is_yaawc() {
  curl -sf -m 3 "http://localhost:${1}/api/config" 2>/dev/null | grep -q chatModelProviders
}

# Echo the first port in $PORTS actually serving YAAWC, else nothing.
detect_port() {
  for p in $PORTS; do
    is_yaawc "$p" && { echo "$p"; return; }
  done
}

started_dev=0
PORT="$(detect_port)"
if [ -n "$PORT" ]; then
  echo "[smoke] dev server already running on ${PORT}, reusing it"
else
  echo "[smoke] starting dev server -> ${LOG}"
  npm run dev > "$LOG" 2>&1 &
  started_dev=$!
  echo "[smoke] waiting for a 'Local: http://localhost:PORT' line ..."
  for i in $(seq 1 90); do
    # next prints e.g. "- Local:  http://localhost:3001" once it's listening
    PORT=$(grep -oE 'localhost:[0-9]+' "$LOG" 2>/dev/null | grep -oE '[0-9]+$' | head -1)
    [ -n "$PORT" ] && is_yaawc "$PORT" && break
    PORT=""
    sleep 1
  done
  if [ -z "$PORT" ]; then
    echo "[smoke] FAILED: server never came up. Last log lines:"; tail -20 "$LOG"; exit 1
  fi
fi
BASE="http://localhost:${PORT}"
echo "[smoke] server is up on ${BASE}"

run() { playwright-cli -s="$SESSION" "$@"; }

# Capture the text snapshot for a surface, and a screenshot only if SHOT=1.
capture() {
  local name="$1"
  run snapshot --filename="${ART}/${name}.yaml" >/dev/null
  echo "[smoke] ${name} snapshot -> ${ART}/${name}.yaml"
  if [ "$SHOT" = 1 ]; then
    run screenshot --filename="${ART}/${name}.png" >/dev/null
    echo "[smoke] ${name} screenshot -> ${ART}/${name}.png"
  fi
}

# Home surface
run open "$BASE" >/dev/null
sleep 1
capture home

# Type into the (React-controlled) chat input and verify the value stuck
REF=$(run snapshot 2>/dev/null | grep -iE "textbox|textarea" | grep -oE "ref=e[0-9]+" | head -1 | cut -d= -f2)
if [ -n "${REF:-}" ]; then
  run fill "$REF" "What is the YAAWC project?" >/dev/null
  VAL=$(run eval "document.querySelector('textarea')?.value" 2>/dev/null | awk '/### Result/{getline; print; exit}')
  echo "[smoke] chat input value after fill: ${VAL}"
else
  echo "[smoke] WARN: could not find chat input ref"
fi

# Second route: settings (stable, deterministic — confirms client-side nav)
run goto "${BASE}/settings" >/dev/null
sleep 2
capture settings

# Report console errors (1 benign ReactQueryDevtools error is expected in dev)
echo "[smoke] console errors:"; run console error 2>/dev/null | head -3

run close >/dev/null 2>&1
echo "[smoke] done. Artifacts in ${ART}/"
if [ "$started_dev" != 0 ]; then
  echo "[smoke] dev server still running as pid ${started_dev} (kill it with: kill ${started_dev})"
fi
