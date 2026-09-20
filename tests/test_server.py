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
        terminal = {"completed", "completed-with-warnings", "completed-known-limitations", "failed", "interrupted", "needs-attention"}
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

    def test_long_title_keeps_a_descriptive_safe_folder_name(self):
        pid = storemod.new_project_id(
            "Transmission line insertion loss and propagation delay for an existing PCB stack-up"
        )
        self.assertTrue(pid.startswith("transmission-line-insertion-loss"), pid)
        self.assertLessEqual(len(pid), 63)
        self.assertTrue(storemod.is_safe_id(pid))


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
        self.assertIn("session limit", final["error"].lower())
        # resumable: switch scenario so the resumed attempt succeeds
        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        status, data = self.request("POST", f"/api/projects/{pid}/resume")
        self.assertEqual(status, 202, data)
        final2 = self.wait_terminal(pid)
        self.assertEqual(final2["status"], "completed")

    def test_temporary_network_failure_is_interrupted_and_resumable(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "network_error")
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        final = self.wait_terminal(pid)
        self.assertEqual(final["status"], "interrupted")
        self.assertIsNotNone(final.get("sessionId"))
        self.assertIn("eai_again", final["error"].lower())

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

    def test_inaccessible_evidence_is_needs_attention_and_resumable(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "inaccessible_evidence")
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        final = self.wait_terminal(pid)
        self.assertEqual(final["status"], "needs-attention")
        self.assertEqual(final["stopReason"], "inaccessible_evidence")
        self.assertIn("could not access", final["error"].lower())
        self.assertIn("Blocked report", final["reportMarkdown"])

        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        status, data = self.request("POST", f"/api/projects/{pid}/resume")
        self.assertEqual(status, 202, data)
        final2 = self.wait_terminal(pid)
        self.assertEqual(final2["status"], "completed")
        self.assertEqual(final2["stopReason"], "supported_within_scope")

    def test_resume_rejected_when_not_in_resumable_state(self):
        pid = self.create_project()  # never started; status is "ready"
        status, data = self.request("POST", f"/api/projects/{pid}/resume")
        self.assertEqual(status, 409, data)

    def test_budget_exhausted_can_continue_same_session_with_bounded_prompt(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "budget_exhausted")
        pid = self.create_project(approach="deep")
        self.request("POST", f"/api/projects/{pid}/start")
        first = self.wait_terminal(pid)
        self.assertEqual(first["status"], "completed-with-warnings")
        self.assertEqual(first["stopReason"], "budget_exhausted")
        original_session = first["sessionId"]

        dumpfile = Path(self.tmp.name) / "argv-continue-budget.json"
        self.set_env("FAKE_CLAUDE_ARGV_DUMP", str(dumpfile))
        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        status, data = self.request("POST", f"/api/projects/{pid}/continue-budget")
        self.assertEqual(status, 202, data)
        final = self.wait_terminal(pid)
        self.assertEqual(final["status"], "completed")

        argv = json.loads(dumpfile.read_text())
        self.assertIn("--resume", argv)
        self.assertEqual(argv[argv.index("--resume") + 1], original_session)
        prompt = argv[argv.index("-p") + 1]
        self.assertIn("explicitly chose Continue research", prompt)
        self.assertIn("at most 8 collection calls", prompt)
        self.assertIn("5 verification source checks", prompt)
        self.assertIn("Do not restart planning", prompt)

    def test_continue_budget_rejected_for_ordinary_project(self):
        pid = self.create_project()
        status, data = self.request("POST", f"/api/projects/{pid}/continue-budget")
        self.assertEqual(status, 409, data)

    def test_two_budget_continuations_end_with_known_limitations_and_cannot_loop(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "budget_exhausted")
        pid = self.create_project(approach="deep")
        self.request("POST", f"/api/projects/{pid}/start")
        self.assertEqual(self.wait_terminal(pid)["status"], "completed-with-warnings")

        self.request("POST", f"/api/projects/{pid}/continue-budget")
        first = self.wait_terminal(pid)
        self.assertEqual(first["status"], "completed-with-warnings")
        self.assertEqual(first["budgetContinuations"], 1)

        self.request("POST", f"/api/projects/{pid}/continue-budget")
        second = self.wait_terminal(pid)
        self.assertEqual(second["status"], "completed-known-limitations")
        self.assertEqual(second["budgetContinuations"], 2)

        status, data = self.request("POST", f"/api/projects/{pid}/continue-budget")
        self.assertEqual(status, 409, data)
        self.assertIn("two continuation passes", data["error"])

    def test_reconcile_old_run_infers_two_extensions_and_ends_loop(self):
        pid = self.create_project()
        pdir = self.root / "projects" / pid
        run_id = "old-run"
        (pdir / "runs" / run_id).mkdir(parents=True)
        (pdir / "runs" / run_id / "run.md").write_text(
            "# Run\n\n## Stop reason\n**supported_within_scope**\n\n"
            "## Budget extension (explicit)\n\n"
            "## Budget extension #2 (explicit)\n\n"
            "**Final stop reason: `budget_exhausted`**\n",
            encoding="utf-8")
        state = self.httpd.app.store.read_run_state(pid)
        state.update({
            "status": "completed-with-warnings", "runId": run_id,
            "stopReason": "budget_exhausted", "sessionId": "session-old",
            "citationCheck": {"ok": True, "detail": "OK"},
        })
        self.httpd.app.store.write_run_state(pid, state)

        status, data = self.request("GET", f"/api/projects/{pid}")
        self.assertEqual(status, 200, data)
        project = data["project"]
        self.assertEqual(project["status"], "completed-known-limitations")
        self.assertEqual(project["budgetContinuations"], 2)


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

    def test_old_false_completed_blocked_run_is_reconciled(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "inaccessible_evidence")
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        self.wait_terminal(pid)

        # Simulate the state written by the older backend seen in the real
        # blocked PCB run: run.md tells the truth, but run.json says completed.
        state_path = self.root / "projects" / pid / "state" / "run.json"
        state = json.loads(state_path.read_text())
        state.update(status="completed", stopReason=None, error=None)
        state_path.write_text(json.dumps(state))

        status, data = self.request("GET", f"/api/projects/{pid}")
        self.assertEqual(status, 200)
        self.assertEqual(data["project"]["status"], "needs-attention")
        self.assertEqual(data["project"]["stopReason"], "inaccessible_evidence")

    def test_old_recoverable_failures_are_reconciled_to_interrupted(self):
        messages = (
            "You've hit your session limit · resets 1:50pm (Asia/Tbilisi)",
            "API Error: Can't reach the API server — check your internet or DNS (EAI_AGAIN)",
        )
        for message in messages:
            with self.subTest(message=message):
                pid = self.create_project()
                state_path = self.root / "projects" / pid / "state" / "run.json"
                state = json.loads(state_path.read_text())
                state.update(status="failed", sessionId="saved-session-id", error=message,
                             stopReason="inaccessible_evidence")
                state_path.write_text(json.dumps(state))

                status, data = self.request("GET", f"/api/projects/{pid}")
                self.assertEqual(status, 200)
                self.assertEqual(data["project"]["status"], "interrupted")
                self.assertIsNone(data["project"]["stopReason"])


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


class ToolPolicyTests(ServerTestCase):
    """Verifies the exact argv the backend sends Claude — the actual
    boundary enforced, not just what the code comments claim."""

    def _argv_for(self, scenario="success"):
        dumpfile = Path(self.tmp.name) / "argv-policy.json"
        self.set_env("FAKE_CLAUDE_ARGV_DUMP", str(dumpfile))
        self.set_env("FAKE_CLAUDE_SCENARIO", scenario)
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        self.wait_terminal(pid)
        return json.loads(dumpfile.read_text()), pid

    def test_bash_never_in_tools_argv(self):
        argv, _ = self._argv_for()
        tools_value = argv[argv.index("--tools") + 1]
        tools = tools_value.split(",")
        self.assertNotIn("Bash", tools, f"--tools was {tools_value!r}")

    def test_no_bash_anywhere_in_argv(self):
        argv, _ = self._argv_for()
        self.assertNotIn("Bash", argv)
        self.assertFalse(any("Bash(" in a for a in argv), "no Bash(...) pattern should remain")

    def test_no_dangerous_permission_or_unrelated_mcp_flags(self):
        argv, _ = self._argv_for()
        joined = " ".join(argv)
        self.assertNotIn("--dangerously-skip-permissions", argv)
        self.assertNotIn("--allow-dangerously-skip-permissions", argv)
        self.assertNotIn("bypassPermissions", joined)
        self.assertNotIn("--mcp-config", argv)
        self.assertIn("--strict-mcp-config", argv)

    def test_expected_tools_present(self):
        argv, _ = self._argv_for()
        tools = argv[argv.index("--tools") + 1].split(",")
        for expected in ("Read", "Write", "Edit", "Grep", "Glob", "WebSearch", "WebFetch", "Task"):
            self.assertIn(expected, tools)

    def test_restricted_tools_are_also_preapproved_for_unattended_run(self):
        argv, _ = self._argv_for()
        restricted = argv[argv.index("--tools") + 1].split(",")
        preapproved = argv[argv.index("--allowedTools") + 1].split(",")
        self.assertEqual(set(preapproved), set(restricted))
        self.assertIn("WebSearch", preapproved)
        self.assertIn("WebFetch", preapproved)
        self.assertNotIn("Bash", preapproved)


class StopTests(ServerTestCase):
    def test_stop_terminates_held_run_and_is_interrupted_resumable(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "hang")
        pid = self.create_project()
        status, _ = self.request("POST", f"/api/projects/{pid}/start")
        self.assertEqual(status, 202)
        # wait for it to actually be researching (past the init event)
        deadline = time.time() + 5
        while time.time() < deadline:
            _, data = self.request("GET", f"/api/projects/{pid}")
            if data["project"]["status"] in ("starting", "researching"):
                break
            time.sleep(0.05)

        status, data = self.request("POST", f"/api/projects/{pid}/stop")
        self.assertEqual(status, 202, data)

        final = self.wait_terminal(pid, timeout=10)
        self.assertEqual(final["status"], "interrupted")
        self.assertIsNotNone(final.get("sessionId"))
        self.assertIn("stopped", (final.get("error") or "").lower())

    def test_resume_after_stop_works(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "hang")
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        deadline = time.time() + 5
        while time.time() < deadline:
            _, data = self.request("GET", f"/api/projects/{pid}")
            if data["project"]["status"] in ("starting", "researching"):
                break
            time.sleep(0.05)
        self.request("POST", f"/api/projects/{pid}/stop")
        self.wait_terminal(pid, timeout=10)

        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        status, data = self.request("POST", f"/api/projects/{pid}/resume")
        self.assertEqual(status, 202, data)
        final = self.wait_terminal(pid, timeout=10)
        self.assertEqual(final["status"], "completed")

    def test_stop_rejected_when_project_not_active(self):
        pid = self.create_project()  # never started
        status, data = self.request("POST", f"/api/projects/{pid}/stop")
        self.assertEqual(status, 409, data)

    def test_different_project_cannot_stop_the_active_run(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "hang")
        pid_a = self.create_project(question="A")
        pid_b = self.create_project(question="B")
        self.request("POST", f"/api/projects/{pid_a}/start")
        time.sleep(0.3)

        status, data = self.request("POST", f"/api/projects/{pid_b}/stop")
        self.assertEqual(status, 409, data)

        # A is still running/stoppable — proves B's failed attempt didn't
        # touch A's process.
        status, data = self.request("POST", f"/api/projects/{pid_a}/stop")
        self.assertEqual(status, 202, data)
        final = self.wait_terminal(pid_a, timeout=10)
        self.assertEqual(final["status"], "interrupted")

    def test_stale_pid_cannot_be_accidentally_killed(self):
        """A project whose saved pid belongs to some unrelated (possibly
        reused) process number, but which this Runner instance is not
        actively tracking, must never be touched by stop()."""
        pid = self.create_project()
        # A real, currently-running process on this machine, guaranteed
        # unrelated to any Claude run this Runner started.
        marker = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        try:
            state_path = self.root / "projects" / pid / "state" / "run.json"
            state = json.loads(state_path.read_text())
            state.update(status="researching", pid=marker.pid, sessionId="stale")
            state_path.write_text(json.dumps(state))

            status, data = self.request("POST", f"/api/projects/{pid}/stop")
            self.assertEqual(status, 409, data)  # not in this Runner's _active registry
            self.assertIsNone(marker.poll(), "the unrelated process must still be running")
        finally:
            marker.terminate()
            marker.wait(timeout=5)


class GracefulShutdownTests(ServerTestCase):
    def test_stop_all_terminates_active_child_process(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "hang")
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        deadline = time.time() + 5
        proc = None
        while time.time() < deadline:
            with self.httpd.app.runner._lock:
                handle = self.httpd.app.runner._active.get(pid)
            if handle is not None:
                proc = handle.proc
                break
            time.sleep(0.05)
        self.assertIsNotNone(proc, "run never registered as active")

        self.httpd.app.runner.stop_all()
        # stop_all terminates synchronously (waits up to the grace period),
        # so the process must already be gone.
        self.assertIsNotNone(proc.poll(), "child process must not survive stop_all()")

        final = self.wait_terminal(pid, timeout=10)
        self.assertEqual(final["status"], "interrupted")


class ClarificationTests(ServerTestCase):
    def _needs_attention_project(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "needs_attention")
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        final = self.wait_terminal(pid)
        self.assertEqual(final["status"], "needs-attention")
        return pid

    def test_clarify_success_resumes_and_completes(self):
        pid = self._needs_attention_project()
        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        status, data = self.request("POST", f"/api/projects/{pid}/clarify", {"text": "It's a VSC7552-V/5CC."})
        self.assertEqual(status, 202, data)
        final = self.wait_terminal(pid, timeout=10)
        self.assertEqual(final["status"], "completed")

    def test_clarify_uses_same_session_id(self):
        pid = self._needs_attention_project()
        before = self.request("GET", f"/api/projects/{pid}")[1]["project"]["sessionId"]
        dumpfile = Path(self.tmp.name) / "argv-clarify.json"
        self.set_env("FAKE_CLAUDE_ARGV_DUMP", str(dumpfile))
        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        self.request("POST", f"/api/projects/{pid}/clarify", {"text": "Extra detail."})
        self.wait_terminal(pid, timeout=10)
        argv = json.loads(dumpfile.read_text())
        self.assertIn("--resume", argv)
        self.assertEqual(argv[argv.index("--resume") + 1], before)

    def test_clarification_reaches_prompt_as_data(self):
        pid = self._needs_attention_project()
        dumpfile = Path(self.tmp.name) / "argv-clarify2.json"
        self.set_env("FAKE_CLAUDE_ARGV_DUMP", str(dumpfile))
        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        clarification = "The budget is 40 EUR and I already have a datasheet."
        self.request("POST", f"/api/projects/{pid}/clarify", {"text": clarification})
        self.wait_terminal(pid, timeout=10)
        argv = json.loads(dumpfile.read_text())
        prompt = argv[argv.index("-p") + 1]
        self.assertIn(clarification, prompt)
        self.assertIn("USER_CLARIFICATION_BEGIN", prompt)

    def test_clarify_rejected_when_not_needs_attention(self):
        pid = self.create_project()  # status: ready
        status, data = self.request("POST", f"/api/projects/{pid}/clarify", {"text": "hello"})
        self.assertEqual(status, 409, data)

    def test_clarify_rejected_empty_text(self):
        pid = self._needs_attention_project()
        status, data = self.request("POST", f"/api/projects/{pid}/clarify", {"text": "   "})
        self.assertEqual(status, 400, data)

    def test_clarify_rejected_oversized_text(self):
        pid = self._needs_attention_project()
        big = "x" * (storemod.MAX_CLARIFICATION_LEN + 1)
        status, data = self.request("POST", f"/api/projects/{pid}/clarify", {"text": big})
        self.assertEqual(status, 400, data)

    def test_clarify_rejected_unsafe_project_id(self):
        status, data = self.request("POST", "/api/projects/../../etc/clarify", {"text": "hi"})
        self.assertIn(status, (400, 404), data)


class CitationCheckStateTests(ServerTestCase):
    def test_citation_failure_produces_completed_with_warnings(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "citation_fail")
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        final = self.wait_terminal(pid)
        self.assertEqual(final["status"], "completed-with-warnings")
        self.assertIsNotNone(final["reportMarkdown"])  # report still readable
        self.assertIn("broken citation", final["reportMarkdown"])
        self.assertFalse(final["citationCheck"]["ok"])
        # a safe, local structural summary only — never a stack trace or path
        self.assertNotIn("Traceback", final["citationCheck"]["detail"])

    def test_citation_pass_produces_ordinary_completed(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        final = self.wait_terminal(pid)
        self.assertEqual(final["status"], "completed")
        self.assertTrue(final["citationCheck"]["ok"])

    def test_citation_check_unavailable_is_visible_warning(self):
        """A missing checker is inconclusive, but must not look verified."""
        (self.root / "scripts" / "check_citations.py").unlink()
        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        final = self.wait_terminal(pid)
        self.assertEqual(final["status"], "completed-with-warnings")
        self.assertIsNone(final["citationCheck"]["ok"])

        # An unavailable check found no repairable structural issue, so the
        # repair endpoint must not spend another model turn.
        status, data = self.request("POST", f"/api/projects/{pid}/repair-citations")
        self.assertEqual(status, 409, data)

    def test_citation_check_timeout_is_visible_warning(self):
        self.httpd.app.runner._run_citation_check = lambda project_id, run_id: {
            "ok": None, "detail": "citation checker timed out"
        }
        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        final = self.wait_terminal(pid)
        self.assertEqual(final["status"], "completed-with-warnings")
        self.assertIsNone(final["citationCheck"]["ok"])
        self.assertIn("timed out", final["citationCheck"]["detail"])

    def test_citation_check_execution_failure_is_visible_warning(self):
        self.httpd.app.runner._run_citation_check = lambda project_id, run_id: {
            "ok": None, "detail": "could not run citation checker"
        }
        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        final = self.wait_terminal(pid)
        self.assertEqual(final["status"], "completed-with-warnings")
        self.assertIsNone(final["citationCheck"]["ok"])
        self.assertIn("could not run", final["citationCheck"]["detail"])

    def test_repair_citations_endpoint(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "citation_fail")
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        final = self.wait_terminal(pid)
        self.assertEqual(final["status"], "completed-with-warnings")

        self.set_env("FAKE_CLAUDE_SCENARIO", "success")  # the "repair" resolves it
        status, data = self.request("POST", f"/api/projects/{pid}/repair-citations")
        self.assertEqual(status, 202, data)
        final2 = self.wait_terminal(pid, timeout=10)
        self.assertEqual(final2["status"], "completed")

    def test_repair_rejected_when_no_warnings(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        self.wait_terminal(pid)
        status, data = self.request("POST", f"/api/projects/{pid}/repair-citations")
        self.assertEqual(status, 409, data)


class ModelTests(ServerTestCase):
    def test_default_model_is_sonnet(self):
        status, data = self.request("GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(data["model"], "sonnet")

    def test_model_appears_in_start_argv(self):
        dumpfile = Path(self.tmp.name) / "argv-model.json"
        self.set_env("FAKE_CLAUDE_ARGV_DUMP", str(dumpfile))
        self.set_env("FAKE_CLAUDE_SCENARIO", "success")
        pid = self.create_project()
        self.request("POST", f"/api/projects/{pid}/start")
        self.wait_terminal(pid)
        argv = json.loads(dumpfile.read_text())
        self.assertEqual(argv[argv.index("--model") + 1], "sonnet")

    def test_custom_model_is_exposed_in_health(self):
        httpd = appmod.make_server(self.root, host="127.0.0.1", port=0,
                                    claude_bin=str(FAKE_CLAUDE), model="opus")
        port = httpd.server_address[1]
        t = threading.Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        try:
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            conn.request("GET", "/api/health")
            resp = conn.getresponse()
            data = json.loads(resp.read())
            conn.close()
            self.assertEqual(data["model"], "opus")
        finally:
            httpd.shutdown()
            t.join(timeout=5)
            httpd.server_close()

    def test_invalid_model_value_rejected(self):
        with self.assertRaises(ValueError):
            appmod.make_server(self.root, host="127.0.0.1", port=0,
                                claude_bin=str(FAKE_CLAUDE), model="not a valid model; rm -rf /")


class RemovalTests(ServerTestCase):
    def test_remove_requires_confirmation_matching_title(self):
        pid = self.create_project()
        title = self.request("GET", f"/api/projects/{pid}")[1]["project"]["title"]
        status, data = self.request("POST", f"/api/projects/{pid}/remove", {"confirmTitle": "wrong"})
        self.assertEqual(status, 400, data)
        self.assertTrue((self.root / "projects" / pid).is_dir())

        status, data = self.request("POST", f"/api/projects/{pid}/remove", {"confirmTitle": title})
        self.assertEqual(status, 200, data)
        self.assertFalse((self.root / "projects" / pid).is_dir())

    def test_remove_moves_to_trash_not_deletes_outright(self):
        pid = self.create_project()
        title = self.request("GET", f"/api/projects/{pid}")[1]["project"]["title"]
        self.request("POST", f"/api/projects/{pid}/remove", {"confirmTitle": title})
        trash = list((self.root / "projects" / ".trash").glob(f"{pid}-*"))
        self.assertEqual(len(trash), 1)
        self.assertTrue((trash[0] / "project.json").is_file())

    def test_remove_rejected_while_active(self):
        self.set_env("FAKE_CLAUDE_SCENARIO", "hang")
        pid = self.create_project()
        title = self.request("GET", f"/api/projects/{pid}")[1]["project"]["title"]
        self.request("POST", f"/api/projects/{pid}/start")
        time.sleep(0.3)
        status, data = self.request("POST", f"/api/projects/{pid}/remove", {"confirmTitle": title})
        self.assertEqual(status, 409, data)
        self.request("POST", f"/api/projects/{pid}/stop")
        self.wait_terminal(pid, timeout=10)

    def test_remove_rejected_path_traversal_id(self):
        status, data = self.request("POST", "/api/projects/..%2f..%2fetc/remove", {"confirmTitle": "x"})
        self.assertIn(status, (400, 404), data)

    def test_remove_rejected_nonexistent_project(self):
        status, data = self.request("POST", "/api/projects/does-not-exist-20260101-000000-abcdef/remove",
                                     {"confirmTitle": "x"})
        self.assertEqual(status, 404, data)

    def test_remove_and_start_are_atomic(self):
        """Once removal owns Runner's lock, Start cannot enter between the
        active check and the directory rename."""
        pid = self.create_project()
        title = self.request("GET", f"/api/projects/{pid}")[1]["project"]["title"]
        runner = self.httpd.app.runner
        store = self.httpd.app.store
        original_remove = store.remove
        remove_entered = threading.Event()
        allow_remove = threading.Event()
        outcomes = {}

        def blocking_remove(project_id, confirm_title):
            remove_entered.set()
            if not allow_remove.wait(5):
                raise AssertionError("test did not release blocked removal")
            return original_remove(project_id, confirm_title)

        store.remove = blocking_remove
        self.addCleanup(setattr, store, "remove", original_remove)

        def do_remove():
            try:
                outcomes["remove"] = runner.remove_project(pid, title)
            except Exception as exc:  # noqa: BLE001 - captured for assertion
                outcomes["remove_error"] = exc

        def do_start():
            try:
                outcomes["start"] = runner.start(pid)
            except Exception as exc:  # noqa: BLE001 - expected after removal wins
                outcomes["start_error"] = exc

        remove_thread = threading.Thread(target=do_remove)
        start_thread = threading.Thread(target=do_start)
        remove_thread.start()
        self.assertTrue(remove_entered.wait(5), "removal never reached the protected rename")
        start_thread.start()
        time.sleep(0.1)
        self.assertTrue(start_thread.is_alive(), "Start entered while removal held Runner's lock")
        allow_remove.set()
        remove_thread.join(timeout=5)
        start_thread.join(timeout=5)

        self.assertNotIn("remove_error", outcomes)
        self.assertIn("start_error", outcomes)
        self.assertIsInstance(outcomes["start_error"], runnermod.RunnerError)
        self.assertFalse((self.root / "projects" / pid).exists())
        self.assertEqual(len(list((self.root / "projects" / ".trash").glob(f"{pid}-*"))), 1)


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
