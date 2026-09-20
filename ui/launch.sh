#!/usr/bin/env bash
# Launch the Deep Research local application (bash/Linux/macOS path).
# Starts the Python backend (server/app.py) bound to 127.0.0.1 only, waits
# until it is confirmed up, then opens your browser. The backend serves the
# UI and a narrow local API that can run real research through your own
# local Claude Code CLI — see ui/README.md for exactly what that means and
# what stays simulated.
#
# A cross-platform alternative that needs no bash — usable the same way on
# Windows and macOS — is the root-level start.py: `python3 start.py`. Both
# scripts launch the exact same backend the exact same way; use whichever
# is more convenient on your system.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$DIR")"
HOST="127.0.0.1"
PORT="${1:-8765}"

# --- validate the port ---
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "Error: '$PORT' is not a valid port. Use a number between 1 and 65535." >&2
  echo "Example: bash launch.sh 9000" >&2
  exit 2
fi

# --- require Python 3 (the backend and its loopback-only bind need it) ---
PY=""
if command -v python3 >/dev/null 2>&1; then PY="python3"
elif command -v python >/dev/null 2>&1 && python -c 'import sys; sys.exit(0 if sys.version_info[0] >= 3 else 1)' >/dev/null 2>&1; then
  PY="python"
fi
if [ -z "$PY" ]; then
  echo "Python 3 was not found, so the local backend can't start." >&2
  echo "You can still browse the design preview: open this file directly in your browser:" >&2
  echo "  $DIR/research.html" >&2
  echo "(Double-click it, or use File > Open. Starting real research needs the backend, so it" >&2
  echo "won't be available that way — only the interface preview will.)" >&2
  exit 1
fi

# --- friendly, non-blocking note if Claude Code isn't on PATH ---
if ! command -v claude >/dev/null 2>&1; then
  echo "NOTE: The 'claude' command was not found on PATH." >&2
  echo "The app will still start so you can browse it, but 'Start research' will show a" >&2
  echo "Needs attention message until Claude Code is installed and you're signed in." >&2
  echo >&2
fi

URL="http://${HOST}:${PORT}/"

# --- check the port is free (loopback) before starting ---
port_in_use() {
  # Prefer a bash /dev/tcp probe; fall back gracefully if that's unavailable.
  if (exec 3<>"/dev/tcp/${HOST}/${PORT}") 2>/dev/null; then exec 3>&- 3<&-; return 0; fi
  return 1
}
if port_in_use; then
  echo "Error: port ${PORT} on ${HOST} is already in use." >&2
  echo "Something is already running there (perhaps a previous launch)." >&2
  echo "Try another port, e.g.: bash launch.sh $((PORT + 1))" >&2
  exit 3
fi

echo "Deep Research"
echo "Backend: $REPO_ROOT/server/app.py"
echo "Address: $URL  (loopback only)"
echo

# --- start the backend bound to loopback only (127.0.0.1) ---
# `-m server.app` needs the repo root as the working directory to resolve
# the server package; run in a subshell so the launcher's own cwd is unaffected.
LOG="$(mktemp 2>/dev/null || echo /tmp/dr-launch.$$.log)"
( cd "$REPO_ROOT" && exec "$PY" -m server.app --host "$HOST" --port "$PORT" ) >"$LOG" 2>&1 &
SERVER_PID=$!

cleanup() { kill "$SERVER_PID" >/dev/null 2>&1 || true; }
trap 'echo; echo "Stopping…"; cleanup; exit 0' INT TERM

# --- wait until it's actually accepting connections (max ~8s: Claude Code's ---
# --- own --version/auth status health check can take a moment on first run) ---
UP=0
for _ in $(seq 1 80); do
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then break; fi  # server died
  if port_in_use; then UP=1; break; fi
  sleep 0.1
done

if [ "$UP" != "1" ]; then
  echo "The backend did not start. Details:" >&2
  sed 's/^/  /' "$LOG" >&2 || true
  cleanup
  exit 4
fi

echo "Backend is up. Opening your browser…"
grep -q '^NOTE:' "$LOG" && sed -n 's/^NOTE:/Note:/p' "$LOG" >&2
echo "Press Ctrl+C to stop."

# --- open the browser only now that the backend is confirmed up ---
if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 || true
elif command -v start >/dev/null 2>&1; then start "$URL" >/dev/null 2>&1 || true
else echo "Open this address manually: $URL"
fi

# --- stay in the foreground until the backend exits or Ctrl+C ---
wait "$SERVER_PID"
