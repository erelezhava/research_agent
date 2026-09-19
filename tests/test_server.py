"""Server integration tests. Uses a fake `claude` executable
(tests/fixtures/fake_claude.py) exclusively — no real Claude Code CLI is
invoked and no real Claude allowance is ever consumed by this suite.
"""
import http.client
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from server import app as appmod          # noqa: E402
from server import store as storemod      # noqa: E402
from server import runner as runnermod    # noqa: E402

FAKE_CLAUDE = REPO_ROOT / "tests" / "fixtures" / "fake_claude.py"


def make_repo(tmpdir):
    """Build a minimal repo root: just what runner.py's prompt references
    (CLAUDE.md, .claude/commands/research.md, scripts/check_citations.py)
    plus an empty ui/ so the static-file allowlist has something to serve."""
    root = Path(tmpdir)
    (root / "ui").mkdir()
    (root / "ui" / "research.html").write_text("<!doctype html><title>t</title>", encoding="utf-8")
    (root / "ui" / "styles.css").write_text("body{}", encoding="utf-8")
    (root / "ui" / "app.js").write_text("//app", encoding="utf-8")
    (root / "ui" / "data.js").write_text("window.DR_DATA={};", encoding="utf-8")
    (root / ".claude" / "commands").mkdir(parents=True)
    (root / ".claude" / "commands" / "research.md").write_text("fake research.md", encoding="utf-8")
    (root / "CLAUDE.md").write_text("fake CLAUDE.md", encoding="utf-8")
    (root / "scripts").mkdir()
    shutil.copy(REPO_ROOT / "scripts" / "check_citations.py", root / "scripts" / "check_citations.py")
    return root


class ServerTestCase(unittest.TestCase):
    """Boots a real server (ephemeral loopback port) backed by a temp repo
    root and the fake claude executable, for one test."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = make_repo(self.tmp.name)
        self.httpd = appmod.make_server(self.root, host="127.0.0.1", port=0,
                                         claude_bin=str(FAKE_CLAUDE))
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self._shutdown)
        self._env_cleanup = []
        self.addCleanup(self._restore_env)

    def _shutdown(self):
        self.httpd.shutdown()
        self.thread.join(timeout=5)
        self.httpd.server_close()  # release the listening socket fd (shutdown() alone doesn't)

    def set_env(self, key, value):
        self._env_cleanup.append((key, os.environ.get(key)))
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value

    def _restore_env(self):
        # Reverse (LIFO) order: a key set twice in one test (e.g. once per
        # subTest iteration) must unwind back to the value before the FIRST
        # set_env call, not get clobbered by an intermediate one.
        for key, prev in reversed(self._env_cleanup):
            if prev is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = prev

    # -- tiny HTTP client helpers --
    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            data = json.dumps(body).encode("utf-8") if body is not None else None
            hdrs = {"Content-Type": "application/json"} if data is not None else {}
            hdrs.update(headers or {})
            conn.request(method, path, body=data, headers=hdrs)
            resp = conn.getresponse()
            raw = resp.read()
            parsed = json.loads(raw) if raw else None
            return resp.status, parsed
        finally:
            conn.close()

    def create_project(self, approach="quick", question="Compare A and B", prompt="Compare A and B please."):
        status, data = self.request("POST", "/api/projects", {
            "title": "Test project", "question": question, "approach": approach,
            "selectedPrompt": prompt, "timeframe": "Latest available", "depth": "Balanced",
            "inScope": "in", "outScope": "out", "tasks": ["step one"],
            "context": {"answers": [{"q": "q1", "a": "a1"}], "files": ["notes.pdf"]},
        })
        self.assertEqual(status, 201, data)
        return data["project"]["id"]

    def wait_terminal(self, pid, timeout=10):
        terminal = {"completed", "failed", "interrupted", "needs-attention"}
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            status, data = self.request("GET", f"/api/projects/{pid}")
            self.assertEqual(status, 200)
            last = data["project"]
            if last["status"] in terminal:
                return last
            time.sleep(0.05)
        self.fail(f"run did not reach a terminal state in time; last={last}")


class ModeAndPromptTests(ServerTestCase):
    def test_quick_and_deep_passed_correctly(self):
        for approach in ("quick", "deep"):
            with self.subTest(approach=approach):
                dumpfile = Path(self.tmp.name) / f"argv-{approach}.json"
                self.set_env("FAKE_CLAUDE_ARGV_DUMP", str(dumpfile))
                self.set_env("FAKE_CLAUDE_SCENARIO", "success")
                pid = self.create_project(approach=approach)
                status, _ = self.request("POST", f"/api/projects/{pid}/start")
                self.assertEqual(status, 202)
                self.wait_terminal(pid)
                argv = json.loads(dumpfile.read_text())
                prompt = argv[argv.index("-p") + 1]
                self.assertIn(f"mode: {approach} | Compare A and B please.", prompt)

    def test_prompt_preserved_exactly_including_special_characters(self):
        tricky = 'Weird "quotes", a backtick ` and a newline\nand unicode é⚡ — verbatim please.'
        dumpfile = Path(self.tmp.name) / "argv-tricky.json"
        self.set_env("FAKE_CLAUDE_ARGV_DUMP", str(dumpfile))
        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        pid = self.create_project(prompt=tricky)
        self.request("POST", f"/api/projects/{pid}/start")
        self.wait_terminal(pid)
        argv = json.loads(dumpfile.read_text())
        prompt = argv[argv.index("-p") + 1]
        self.assertIn(tricky, prompt)

    def test_shell_metacharacters_cannot_execute_commands(self):
        marker = Path(self.tmp.name) / "should-not-exist.marker"
        malicious = f'"; touch {marker} #`touch {marker}`$(touch {marker})'
        dumpfile = Path(self.tmp.name) / "argv-injection.json"
        self.set_env("FAKE_CLAUDE_ARGV_DUMP", str(dumpfile))
        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        pid = self.create_project(prompt=malicious)
        self.request("POST", f"/api/projects/{pid}/start")
        self.wait_terminal(pid)
        argv = json.loads(dumpfile.read_text())
        prompt = argv[argv.index("-p") + 1]
        self.assertIn(malicious, prompt, "prompt must still arrive as literal data")
        self.assertFalse(marker.exists(), "shell metacharacters in the prompt must never execute")

    def test_no_dangerous_permission_flags_ever_sent(self):
        dumpfile = Path(self.tmp.name) / "argv-safety.json"
        self.set_env("FAKE_CLAUDE_ARGV_DUMP", str(dumpfile))
        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        self.wait_terminal(pid)
        argv = json.loads(dumpfile.read_text())
        joined = " ".join(argv)
        self.assertNotIn("--dangerously-skip-permissions", argv)
        self.assertNotIn("--allow-dangerously-skip-permissions", argv)
        self.assertNotIn("bypassPermissions", joined)
        self.assertIn("--strict-mcp-config", argv)
        self.assertIn("acceptEdits", argv)


class UnsafeIdTests(ServerTestCase):
    def test_path_traversal_project_id_rejected(self):
        for bad in ("../../etc", "..%2f..%2fetc", "a/b", "", "UPPER", "-leading-hyphen"):
            with self.subTest(bad=bad):
                status, data = self.request("GET", f"/api/projects/{bad}")
                self.assertIn(status, (400, 404), data)

    def test_store_rejects_traversal_directly(self):
        store = storemod.Store(self.root)
        with self.assertRaises(storemod.ValidationError):
            store.project_dir("../../../etc")

    def test_create_requires_valid_approach(self):
        status, data = self.request("POST", "/api/projects", {
            "title": "x", "question": "q", "approach": "medium", "selectedPrompt": "p",
        })
        self.assertEqual(status, 400, data)


class SingleRunTests(ServerTestCase):
    def test_only_one_active_run(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        self.set_env("FAKE_CLAUDE_HOLD", "1.2")
        pid_a = self.create_project(question="A")
        pid_b = self.create_project(question="B")
        status_a, _ = self.request("POST", f"/api/projects/{pid_a}/start")
        self.assertEqual(status_a, 202)
        time.sleep(0.2)  # let A actually claim the lock
        status_b, data_b = self.request("POST", f"/api/projects/{pid_b}/start")
        self.assertEqual(status_b, 409, data_b)
        self.wait_terminal(pid_a, timeout=10)
        # once A finishes, B should be startable
        status_b2, data_b2 = self.request("POST", f"/api/projects/{pid_b}/start")
        self.assertEqual(status_b2, 202, data_b2)
        self.wait_terminal(pid_b, timeout=10)


class OutcomeTests(ServerTestCase):
    def test_successful_completion_exposes_report(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        final = self.wait_terminal(pid)
        self.assertEqual(final["status"], "completed")
        self.assertIn("Fake report", final["reportMarkdown"] or "")
        self.assertIsNotNone(final.get("citationCheck"))
        self.assertTrue(final["citationCheck"]["ok"], final["citationCheck"])

    def test_cli_failure_produces_failed_state(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "failure")
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        final = self.wait_terminal(pid)
        self.assertEqual(final["status"], "failed")
        self.assertIn("Simulated failure", final["error"] or "")

    def test_usage_limit_produces_interrupted_resumable_state(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "usage_limit")
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        final = self.wait_terminal(pid)
        self.assertEqual(final["status"], "interrupted")
        self.assertIsNotNone(final.get("sessionId"))
        # resumable: switch scenario so the resumed attempt succeeds
        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        status, data = self.request("POST", f"/api/projects/{pid}/resume")
        self.assertEqual(status, 202, data)
        final2 = self.wait_terminal(pid)
        self.assertEqual(final2["status"], "completed")

    def test_needs_attention_when_no_report_produced(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "needs_attention")
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        final = self.wait_terminal(pid)
        self.assertEqual(final["status"], "needs-attention")
        self.assertIsNone(final.get("reportMarkdown"))
        self.assertIn("clarification", final.get("runMarkdown") or "")

    def test_resume_rejected_when_not_in_resumable_state(self):
        pid = self.create_project()  # never started; status is "ready"
        status, data = self.request("POST", f"/api/projects/{pid}/resume")
        self.assertEqual(status, 409, data)


class RestartRecoveryTests(ServerTestCase):
    def test_state_survives_server_restart(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        self.wait_terminal(pid)

        # Simulate a full server restart: throw away the App/Runner objects
        # and rebuild fresh ones from the same repo_root, exactly as a real
        # process restart would.
        self._shutdown()
        httpd2 = appmod.make_server(self.root, host="127.0.0.1", port=0, claude_bin=str(FAKE_CLAUDE))
        port2 = httpd2.server_address[1]
        t2 = threading.Thread(target=httpd2.serve_forever, daemon=True)
        t2.start()
        try:
            conn = http.client.HTTPConnection("127.0.0.1", port2, timeout=5)
            conn.request("GET", f"/api/projects/{pid}")
            resp = conn.getresponse()
            data = json.loads(resp.read())
            conn.close()
            self.assertEqual(resp.status, 200)
            self.assertEqual(data["project"]["status"], "completed")
            self.assertIn("Fake report", data["project"]["reportMarkdown"])
        finally:
            httpd2.shutdown()
            t2.join(timeout=5)
            httpd2.server_close()

    def test_stale_researching_status_reconciled_to_interrupted(self):
        """Simulates the app/computer closing mid-run: the project's own
        saved status still says 'researching' but the process that was
        running it is confirmed gone. A fresh server instance (a restart)
        must correct this on read rather than showing a live status forever,
        and the corrected state must be genuinely resumable."""
        pid = self.create_project()
        # A pid that is guaranteed to be dead by the time we check it.
        dead_proc = subprocess.Popen([sys.executable, "-c", "pass"])
        dead_proc.wait()
        dead_pid = dead_proc.pid
        state_path = self.root / "projects" / pid / "state" / "run.json"
        state = json.loads(state_path.read_text())
        state.update(status="researching", pid=dead_pid, sessionId="stale-session-id")
        state_path.write_text(json.dumps(state))

        status, data = self.request("GET", f"/api/projects/{pid}")
        self.assertEqual(status, 200)
        self.assertEqual(data["project"]["status"], "interrupted")
        self.assertIn("closed", data["project"]["error"].lower())

        # And it's genuinely resumable from here (Resume is only offered for
        # interrupted/failed projects with a recorded session id).
        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        status, data = self.request("POST", f"/api/projects/{pid}/resume")
        self.assertEqual(status, 202, data)
        final = self.wait_terminal(pid)
        self.assertEqual(final["status"], "completed")

    def test_list_projects_also_reconciles(self):
        pid = self.create_project()
        dead_proc = subprocess.Popen([sys.executable, "-c", "pass"])
        dead_proc.wait()
        state_path = self.root / "projects" / pid / "state" / "run.json"
        state = json.loads(state_path.read_text())
        state.update(status="starting", pid=dead_proc.pid)
        state_path.write_text(json.dumps(state))

        status, data = self.request("GET", "/api/projects")
        self.assertEqual(status, 200)
        found = [p for p in data["projects"] if p["id"] == pid][0]
        self.assertEqual(found["status"], "interrupted")


class NetworkSecurityTests(ServerTestCase):
    def test_listens_only_on_loopback(self):
        self.assertEqual(self.httpd.server_address[0], "127.0.0.1")

    def test_bad_host_header_rejected(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            conn.putrequest("GET", "/api/health", skip_host=True)
            conn.putheader("Host", "evil.example.com")
            conn.endheaders()
            resp = conn.getresponse()
            resp.read()
            self.assertEqual(resp.status, 400)
        finally:
            conn.close()

    def test_cross_origin_post_rejected(self):
        status, data = self.request("POST", "/api/projects",
                                     {"title": "x", "question": "q", "approach": "quick", "selectedPrompt": "p"},
                                     headers={"Origin": "http://evil.example"})
        self.assertEqual(status, 403, data)

    def test_same_origin_post_allowed(self):
        status, data = self.request("POST", "/api/projects",
                                     {"title": "x", "question": "q", "approach": "quick", "selectedPrompt": "p"},
                                     headers={"Origin": f"http://127.0.0.1:{self.port}"})
        self.assertEqual(status, 201, data)

    def test_oversized_body_rejected(self):
        big = "x" * (appmod.MAX_BODY + 1000)
        status, data = self.request("POST", "/api/projects",
                                     {"title": "x", "question": big, "approach": "quick", "selectedPrompt": "p"})
        self.assertEqual(status, 413, data)


class HealthTests(ServerTestCase):
    def test_health_reports_fake_claude_as_available_and_authenticated(self):
        status, data = self.request("GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertTrue(data["claude"]["claudeFound"])
        self.assertTrue(data["claude"]["authenticated"])

    def test_health_reports_missing_claude(self):
        httpd = appmod.make_server(self.root, host="127.0.0.1", port=0, claude_bin="/no/such/claude-binary")
        port = httpd.server_address[1]
        t = threading.Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        try:
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            conn.request("GET", "/api/health")
            resp = conn.getresponse()
            data = json.loads(resp.read())
            conn.close()
            self.assertFalse(data["claude"]["claudeFound"])
        finally:
            httpd.shutdown()
            t.join(timeout=5)
            httpd.server_close()


class LegacyCheckerStillWorksTests(unittest.TestCase):
    """Sanity check that scripts/check_citations.py's new --root flag is
    additive and the module still imports/behaves as tests/test_citations.py
    (run separately by the same `unittest discover`) expects."""

    def test_root_flag_present_and_default_preserves_cwd_behavior(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "checker_from_test_server", REPO_ROOT / "scripts" / "check_citations.py")
        checker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(checker)
        errors, _ = checker.check(Path("/nonexistent-root-for-test"), "whatever")
        self.assertTrue(errors)  # unreadable report -> a clear error, not a crash


if __name__ == "__main__":
    unittest.main()
