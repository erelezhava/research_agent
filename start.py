#!/usr/bin/env python3
"""Deep Research — cross-platform local launcher (standard library only).

Starts the local backend (server/app.py) bound to 127.0.0.1 only, waits
until it is actually accepting connections, then opens your default
browser. Works the same way on Linux, macOS, and Windows wherever Python 3
itself runs — it launches the backend as a Python subprocess directly
(`sys.executable -m server.app`), so it needs no shell, no bash, and no
platform-specific script.

Usage:
    python3 start.py            # default port 8765
    python3 start.py 9000       # a different port
    python3 start.py --model opus

Existing Linux users can keep using `bash ui/launch.sh`, which this script
does not replace — both start the exact same backend the exact same way.

Verified: starting, readiness-waiting, and clean shutdown were tested on
Linux in this repository's own test/dev environment. macOS and Windows are
expected to work because they run the same stdlib-only Python code path
(no OS-specific branch beyond which webbrowser opener Python itself picks),
but neither has actually been run and observed on this task — that is
explicitly unverified, not merely "should be fine".
"""
import json
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

_TEST_LAST_PROC = None  # test-support only, see main(); not used by normal operation

DEFAULT_PORT = 8765
HOST = "127.0.0.1"          # never anything else — see the loopback-only note below
READY_TIMEOUT_SECONDS = 15.0


def _parse_args(argv):
    port = DEFAULT_PORT
    extra = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-h", "--help"):
            print(__doc__)
            raise SystemExit(0)
        if a.isdigit():
            port = int(a)
        else:
            extra.append(a)
        i += 1
    if not (1 <= port <= 65535):
        print(f"Error: '{port}' is not a valid port. Use a number between 1 and 65535.", file=sys.stderr)
        raise SystemExit(2)
    return port, extra


def _port_is_in_use(host, port):
    """Fast friendly preflight; the health identity check below remains the
    authoritative guard because another process can still win the port after
    this socket closes."""
    try:
        with socket.create_connection((host, port), timeout=0.25):
            return True
    except OSError:
        return False


def _is_our_health_response(response):
    try:
        data = json.loads(response.read().decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
        return False
    return (
        isinstance(data, dict)
        and data.get("ok") is True
        and isinstance(data.get("claude"), dict)
        and isinstance(data.get("model"), str)
    )


def _wait_until_ready(health_url, deadline, proc):
    while time.time() < deadline:
        if proc.poll() is not None:
            return False  # the backend process exited before becoming ready
        try:
            with urllib.request.urlopen(health_url, timeout=1.0) as response:
                if _is_our_health_response(response) and proc.poll() is None:
                    return True
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            pass
        time.sleep(0.15)
    return False


def _stop_child(proc, timeout=10):
    """Stop and reap the backend; never leave a timed-out launcher child or
    zombie behind."""
    if proc.poll() is not None:
        proc.wait()
        return
    proc.terminate()
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


def main(argv):
    port, extra_args = _parse_args(argv)
    repo_root = Path(__file__).resolve().parent
    server_pkg = repo_root / "server" / "app.py"
    if not server_pkg.is_file():
        print(f"Error: {server_pkg} not found — run this from inside the project folder.", file=sys.stderr)
        return 1

    url = f"http://{HOST}:{port}/"
    health_url = f"http://{HOST}:{port}/api/health"
    print("Deep Research")
    print(f"Backend: {server_pkg}")
    print(f"Address: {url}  (loopback only)")
    print()

    if _port_is_in_use(HOST, port):
        print(f"Port {port} is already in use. Choose another one, for example: "
              f"{Path(sys.executable).name} {Path(__file__).name} 9000", file=sys.stderr)
        return 3

    argv_cmd = [sys.executable, "-m", "server.app", "--host", HOST, "--port", str(port)] + extra_args
    try:
        proc = subprocess.Popen(argv_cmd, cwd=str(repo_root))
    except OSError as exc:
        print(f"Could not start the backend: {exc}", file=sys.stderr)
        return 1
    global _TEST_LAST_PROC  # test-support only: lets the test suite stop the
    _TEST_LAST_PROC = proc  # child cleanly, without sending this process a signal

    ready = _wait_until_ready(health_url, time.time() + READY_TIMEOUT_SECONDS, proc)
    if not ready:
        # Never hide a startup failure: report plainly rather than opening a
        # browser tab that will just show "can't connect".
        rc = proc.poll()
        if rc is not None:
            print(f"The backend exited before it was ready (exit code {rc}). "
                  "Check the output above for the actual error.", file=sys.stderr)
        else:
            print(f"The backend did not become ready within {READY_TIMEOUT_SECONDS:.0f} seconds. "
                  "It may still be starting — check the output above, or try again.", file=sys.stderr)
            _stop_child(proc)
        return 1

    print("Backend is up. Opening your browser…")
    print("Press Ctrl+C to stop.")
    try:
        opened = webbrowser.open(url)
        if opened is False:
            print(f"(No browser opened automatically. Open {url} manually.)", file=sys.stderr)
    except Exception as exc:  # noqa: BLE001 - opening a browser is best-effort, never fatal
        print(f"(Could not open a browser automatically: {exc}. Open {url} manually.)", file=sys.stderr)

    try:
        proc.wait()
    except KeyboardInterrupt:
        print("\nStopping…")
        _stop_child(proc)
    return proc.returncode or 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
