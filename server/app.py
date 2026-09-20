"""Local-only HTTP application: serves the ui/ frontend and a narrow JSON API
for browser-started research projects. Binds to 127.0.0.1 only.

Security posture (see the security-review checklist in ui/README.md for the
full list this implements):
- loopback bind only; Host and Origin headers checked on every request
- static files served from an allowlist resolved under ui/, path traversal
  blocked by resolve()-and-verify
- project ids validated server-side (server.store.is_safe_id) before ever
  touching the filesystem; never accepted verbatim into a path otherwise
- request bodies size-capped
- Claude Code is launched as an argv list (server/runner.py), never a shell
  string, and the browser can never supply or influence that argv beyond the
  already-approved, already-stored prompt text
- no endpoint executes arbitrary shell commands
- responses never include environment variables, raw stack traces, or
  absolute filesystem paths — errors are logged locally and given generic,
  actionable messages to the client
"""
import json
import mimetypes
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from . import runner as runnermod
from . import store as storemod

MAX_BODY = 300_000  # generous ceiling for a brief's text fields; blocks abuse


class Handler(BaseHTTPRequestHandler):
    server_version = "DeepResearchLocal/1"
    # Deliberately HTTP/1.0 (the BaseHTTPRequestHandler default): one request
    # per connection. HTTP/1.1 keep-alive requires draining every request
    # body before responding on every code path (including early
    # Host/Origin rejections) or leftover bytes get misparsed as the start
    # of the next request on the same socket — not worth the complexity for
    # a small local prototype server with no meaningful throughput need.

    # -- helpers ------------------------------------------------------
    def _app(self):
        return self.server.app  # type: ignore[attr-defined]

    def _send_json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _send_text(self, status, text, content_type="text/plain; charset=utf-8"):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _error(self, status, message):
        self._send_json(status, {"error": message})

    def _allowed_hosts(self):
        port = self.server.server_address[1]
        return {f"127.0.0.1:{port}", f"localhost:{port}"}

    def _check_host_and_origin(self, state_changing):
        host = self.headers.get("Host", "")
        if host not in self._allowed_hosts():
            self._error(400, "Bad request: unexpected Host header.")
            return False
        if state_changing:
            origin = self.headers.get("Origin")
            if origin is not None:
                allowed_origins = {f"http://{h}" for h in self._allowed_hosts()}
                if origin not in allowed_origins:
                    self._error(403, "Cross-origin requests are not allowed.")
                    return False
        return True

    def _read_json_body(self):
        length = self.headers.get("Content-Length")
        if length is None:
            return {}
        try:
            n = int(length)
        except ValueError:
            self._error(400, "Bad Content-Length.")
            return None
        if n > MAX_BODY:
            self._error(413, "Request body too large.")
            return None
        raw = self.rfile.read(n) if n > 0 else b""
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._error(400, "Request body must be valid JSON.")
            return None
        if not isinstance(data, dict):
            self._error(400, "Request body must be a JSON object.")
            return None
        return data

    def log_message(self, fmt, *args):  # keep console output minimal/quiet
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # -- routing --------------------------------------------------------
    def do_GET(self):
        if not self._check_host_and_origin(state_changing=False):
            return
        path = urlsplit(self.path).path
        try:
            if path == "/api/health":
                return self._handle_health()
            if path == "/api/projects":
                return self._handle_list_projects()
            if path.startswith("/api/projects/"):
                pid = path[len("/api/projects/"):].split("/")[0]
                if path == f"/api/projects/{pid}":
                    return self._handle_get_project(pid)
            if path.startswith("/api/"):
                return self._error(404, "Unknown API endpoint.")
            return self._serve_static(path)
        except storemod.ValidationError as exc:
            return self._error(400, str(exc))
        except Exception:  # noqa: BLE001 - never leak a traceback to the client
            self._log_exception()
            return self._error(500, "Internal error.")

    def do_POST(self):
        if not self._check_host_and_origin(state_changing=True):
            return
        path = urlsplit(self.path).path
        try:
            if path == "/api/projects":
                return self._handle_create_project()
            if path.startswith("/api/projects/"):
                rest = path[len("/api/projects/"):]
                parts = rest.split("/")
                if len(parts) == 2 and parts[1] == "start":
                    return self._handle_start(parts[0])
                if len(parts) == 2 and parts[1] == "resume":
                    return self._handle_resume(parts[0])
                if len(parts) == 2 and parts[1] == "stop":
                    return self._handle_stop(parts[0])
                if len(parts) == 2 and parts[1] == "clarify":
                    return self._handle_clarify(parts[0])
                if len(parts) == 2 and parts[1] == "repair-citations":
                    return self._handle_repair_citations(parts[0])
                if len(parts) == 2 and parts[1] == "remove":
                    return self._handle_remove(parts[0])
            return self._error(404, "Unknown API endpoint.")
        except storemod.ValidationError as exc:
            return self._error(400, str(exc))
        except runnermod.RunnerError as exc:
            return self._error(409, str(exc))
        except Exception:  # noqa: BLE001
            self._log_exception()
            return self._error(500, "Internal error.")

    def _log_exception(self):
        import traceback
        traceback.print_exc(file=sys.stderr)  # local console only, never the response

    # -- API handlers -----------------------------------------------------
    def _handle_health(self):
        app = self._app()
        app.refresh_health()
        self._send_json(200, {
            "ok": True,
            "activeRun": app.runner.active_run(),
            "claude": app.health,
            "model": app.runner.model,
        })

    def _handle_list_projects(self):
        app = self._app()
        for p in app.store.list_projects():
            app.runner.reconcile(p["id"])
        self._send_json(200, {"projects": app.store.list_projects()})  # re-read: reconcile may have changed statuses

    def _handle_get_project(self, pid):
        app = self._app()
        if not storemod.is_safe_id(pid):
            return self._error(400, "Invalid project id.")
        app.runner.reconcile(pid)
        detail = app.store.project_detail(pid)
        if detail is None:
            return self._error(404, "Project not found.")
        self._send_json(200, {"project": detail})

    def _handle_create_project(self):
        app = self._app()
        data = self._read_json_body()
        if data is None:
            return
        try:
            meta = app.store.create(data)
        except storemod.ValidationError as exc:
            return self._error(400, str(exc))
        self._send_json(201, {"project": meta})

    def _handle_start(self, pid):
        app = self._app()
        if not storemod.is_safe_id(pid):
            return self._error(400, "Invalid project id.")
        if not app.store.exists(pid):
            return self._error(404, "Project not found.")
        app.refresh_health()
        # Block only on a *confirmed* bad signal (False), not an inconclusive
        # one (None, e.g. a health-check subprocess that timed out under
        # load) — an inconclusive check shouldn't itself stop the user; the
        # real launch attempt below will surface its own concrete error.
        if app.health.get("claudeFound") is False:
            return self._error(503, "Claude Code CLI is not available on this machine.")
        if app.health.get("authenticated") is False:
            return self._error(503, "Claude Code is not signed in. Run 'claude auth login' first.")
        info = app.runner.start(pid)
        self._send_json(202, {"started": True, "sessionId": info["sessionId"]})

    def _handle_resume(self, pid):
        app = self._app()
        if not storemod.is_safe_id(pid):
            return self._error(400, "Invalid project id.")
        if not app.store.exists(pid):
            return self._error(404, "Project not found.")
        state = app.store.read_run_state(pid)
        if state.get("status") not in ("interrupted", "failed"):
            return self._error(409, "This project is not in a resumable state.")
        if not state.get("sessionId"):
            return self._error(409, "No previous session recorded to resume.")
        info = app.runner.resume(pid)
        self._send_json(202, {"resumed": True, "sessionId": info["sessionId"]})

    def _handle_stop(self, pid):
        app = self._app()
        if not storemod.is_safe_id(pid):
            return self._error(400, "Invalid project id.")
        if not app.store.exists(pid):
            return self._error(404, "Project not found.")
        app.runner.stop(pid)  # RunnerError -> 409 via the shared do_POST handler
        self._send_json(202, {"stopping": True})

    def _handle_clarify(self, pid):
        app = self._app()
        if not storemod.is_safe_id(pid):
            return self._error(400, "Invalid project id.")
        if not app.store.exists(pid):
            return self._error(404, "Project not found.")
        data = self._read_json_body()
        if data is None:
            return
        state = app.store.read_run_state(pid)
        if state.get("status") != "needs-attention":
            return self._error(409, "This project is not waiting on a clarification.")
        if not state.get("sessionId"):
            return self._error(409, "No previous session recorded — start a new project instead.")
        try:
            text = storemod.validate_clarification(data.get("text"))
        except storemod.ValidationError as exc:
            return self._error(400, str(exc))
        info = app.runner.clarify(pid, text)
        self._send_json(202, {"resumed": True, "sessionId": info["sessionId"]})

    def _handle_repair_citations(self, pid):
        app = self._app()
        if not storemod.is_safe_id(pid):
            return self._error(400, "Invalid project id.")
        if not app.store.exists(pid):
            return self._error(404, "Project not found.")
        state = app.store.read_run_state(pid)
        if state.get("status") != "completed-with-warnings":
            return self._error(409, "This project has no citation warnings to repair.")
        if (state.get("citationCheck") or {}).get("ok") is not False:
            return self._error(409, "The citation check did not find a repairable structural problem.")
        if not state.get("sessionId"):
            return self._error(409, "No previous session recorded to resume.")
        info = app.runner.repair_citations(pid)
        self._send_json(202, {"resumed": True, "sessionId": info["sessionId"]})

    def _handle_remove(self, pid):
        app = self._app()
        if not storemod.is_safe_id(pid):
            return self._error(400, "Invalid project id.")
        data = self._read_json_body()
        if data is None:
            return
        try:
            app.runner.remove_project(pid, data.get("confirmTitle"))
        except storemod.ValidationError as exc:
            return self._error(400, str(exc))
        except runnermod.RunnerError as exc:
            if str(exc) == "project not found":
                return self._error(404, "Project not found.")
            raise
        self._send_json(200, {"removed": True})

    # -- static file serving (allowlisted, traversal-safe) -----------------
    def _serve_static(self, path):
        app = self._app()
        if path == "/":
            path = "/research.html"
        rel = path.lstrip("/")
        candidate = (app.ui_dir / rel).resolve()
        try:
            candidate.relative_to(app.ui_dir.resolve())
        except ValueError:
            return self._error(404, "Not found.")
        if not candidate.is_file() or candidate.name not in app.static_allowlist:
            return self._error(404, "Not found.")
        ctype, _ = mimetypes.guess_type(str(candidate))
        ctype = ctype or "application/octet-stream"
        if ctype.startswith("text/") or candidate.suffix in (".js", ".json"):
            ctype += "; charset=utf-8"
        data = candidate.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass


class App:
    def __init__(self, repo_root: Path, claude_bin=None, model=None):
        self.repo_root = repo_root
        self.ui_dir = repo_root / "ui"
        self.static_allowlist = {"research.html", "styles.css", "app.js", "data.js"}
        self.store = storemod.Store(repo_root)
        self.runner = runnermod.Runner(repo_root, self.store, claude_bin=claude_bin, model=model)
        self.health = runnermod.check_health(claude_bin)
        self._health_lock = threading.Lock()
        self._health_checked_at = time.time()

    def refresh_health(self, min_interval=5.0):
        with self._health_lock:
            if time.time() - self._health_checked_at < min_interval:
                return
            self.health = runnermod.check_health(self.runner.claude_bin_configured)
            self._health_checked_at = time.time()


def make_server(repo_root: Path, host="127.0.0.1", port=8765, claude_bin=None, model=None):
    app = App(repo_root, claude_bin=claude_bin, model=model)
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    httpd.app = app  # type: ignore[attr-defined]
    return httpd


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Deep Research local backend (loopback only)")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default="127.0.0.1", help="must be a loopback address")
    parser.add_argument("--claude-bin", default=None)
    parser.add_argument("--model", default=None,
                         help="coordinator model Claude Code runs as (default: sonnet)")
    args = parser.parse_args()

    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print(f"Refusing to bind to '{args.host}': this server must stay loopback-only.", file=sys.stderr)
        return 2

    repo_root = Path(__file__).resolve().parents[1]
    try:
        httpd = make_server(repo_root, host=args.host, port=args.port,
                             claude_bin=args.claude_bin, model=args.model)
    except OSError as exc:
        print(f"Could not bind {args.host}:{args.port} — {exc}", file=sys.stderr)
        return 1
    except ValueError as exc:
        print(f"Bad --model value: {exc}", file=sys.stderr)
        return 2

    print(f"READY http://{args.host}:{args.port}/", flush=True)
    print(f"Coordinator model: {httpd.app.runner.model}", flush=True)
    if not httpd.app.health.get("claudeFound"):
        print("NOTE: Claude Code CLI was not found on PATH — Start research will show "
              "a Needs attention state until it is installed.", file=sys.stderr)
    elif not httpd.app.health.get("authenticated"):
        print("NOTE: Claude Code is installed but not signed in — run 'claude auth login'.",
              file=sys.stderr)

    # A graceful shutdown (Ctrl+C, or SIGTERM from whatever stopped the
    # launcher/backend) must stop any Claude process it started before this
    # process exits — otherwise it would keep running and consuming Claude
    # allowance with nothing left tracking it. This only covers a normal
    # signal-based shutdown; an unavoidable hard kill (SIGKILL, a power
    # loss, or an OS crash) gives no process any chance to run cleanup code,
    # so it cannot be guaranteed here or anywhere else.
    def _handle_term_signal(signum, frame):  # noqa: ARG001 - signal handler signature
        raise KeyboardInterrupt()
    if hasattr(signal, "SIGTERM"):
        try:
            signal.signal(signal.SIGTERM, _handle_term_signal)
        except (ValueError, OSError):
            pass  # e.g. not the main thread — best-effort only

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        print("Stopping any active research process…", file=sys.stderr)
        httpd.app.runner.stop_all()
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
