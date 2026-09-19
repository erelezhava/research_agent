#!/usr/bin/env bash
# Launch the Deep Research prototype UI locally.
# Serves this folder on 127.0.0.1 (loopback only) and opens your browser once
# the server is confirmed up. Nothing is exposed to the network.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="127.0.0.1"
PORT="${1:-8765}"

# --- validate the port ---
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "Error: '$PORT' is not a valid port. Use a number between 1 and 65535." >&2
  echo "Example: bash launch.sh 9000" >&2
  exit 2
fi

# --- require Python 3 (its http.server can bind to loopback only) ---
PY=""
if command -v python3 >/dev/null 2>&1; then PY="python3"
elif command -v python >/dev/null 2>&1 && python -c 'import sys; sys.exit(0 if sys.version_info[0] >= 3 else 1)' >/dev/null 2>&1; then
  PY="python"
fi
if [ -z "$PY" ]; then
  echo "Python 3 was not found, so the local server can't start." >&2
  echo "No problem — you don't need it. Open the prototype directly in your browser:" >&2
  echo "  $DIR/research.html" >&2
  echo "(Double-click that file, or use your browser's File > Open. Saving still works.)" >&2
  exit 1
fi

PAGE="research.html"
URL="http://${HOST}:${PORT}/${PAGE}"

# --- check the port is free (loopback) before starting ---
port_in_use() {
  # Prefer a bash /dev/tcp probe; fall back to Python if that's unavailable.
  if (exec 3<>"/dev/tcp/${HOST}/${PORT}") 2>/dev/null; then exec 3>&- 3<&-; return 0; fi
  return 1
}
if port_in_use; then
  echo "Error: port ${PORT} on ${HOST} is already in use." >&2
  echo "Something is already running there (perhaps a previous launch)." >&2
  echo "Try another port, e.g.: bash launch.sh $((PORT + 1))" >&2
  exit 3
fi

echo "Deep Research prototype"
echo "Serving: $DIR"
echo "Address: $URL  (loopback only)"
echo

# --- start the server bound to loopback only (127.0.0.1) ---
LOG="$(mktemp 2>/dev/null || echo /tmp/dr-launch.$$.log)"
"$PY" -m http.server "$PORT" --bind "$HOST" --directory "$DIR" >"$LOG" 2>&1 &
SERVER_PID=$!

cleanup() { kill "$SERVER_PID" >/dev/null 2>&1 || true; }
trap 'echo; echo "Stopping…"; cleanup; exit 0' INT TERM

# --- wait until it's actually accepting connections (max ~5s) ---
UP=0
for _ in $(seq 1 50); do
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then break; fi  # server died
  if port_in_use; then UP=1; break; fi
  sleep 0.1
done

if [ "$UP" != "1" ]; then
  echo "The server did not start. Details:" >&2
  sed 's/^/  /' "$LOG" >&2 || true
  cleanup
  exit 4
fi

echo "Server is up. Opening your browser…"
echo "Press Ctrl+C to stop."

# --- open the browser only now that the server is confirmed up ---
if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 || true
elif command -v start >/dev/null 2>&1; then start "$URL" >/dev/null 2>&1 || true
else echo "Open this address manually: $URL"
fi

# --- stay in the foreground until the server exits or Ctrl+C ---
wait "$SERVER_PID"
