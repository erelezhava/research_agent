"""Tests for the root-level cross-platform launcher (start.py). Uses the
fake `claude` executable exclusively and never opens a real external
browser — webbrowser.open is monkeypatched to a recorder in every test.
"""
import json
import socket
import sys
import threading
import time
import urllib.request
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

import start  # noqa: E402

FAKE_CLAUDE = REPO_ROOT / "tests" / "fixtures" / "fake_claude.py"


class StartLauncherTests(unittest.TestCase):
    def setUp(self):
        self._orig_open = start.webbrowser.open
        self.opened_urls = []
        start.webbrowser.open = self._record_open
        start._TEST_LAST_PROC = None
        self.addCleanup(self._restore)

    def _record_open(self, url):
        self.opened_urls.append(url)
        return True

    def _restore(self):
        start.webbrowser.open = self._orig_open

    def _run_in_thread(self, argv):
        result = {}

        def run():
            result["rc"] = start.main(argv)
        t = threading.Thread(target=run, daemon=True)
        t.start()
        return t, result

    def _free_port(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            return sock.getsockname()[1]

    def _wait_opened(self, timeout=5):
        deadline = time.time() + timeout
        while not self.opened_urls and time.time() < deadline:
            time.sleep(0.05)
        self.assertTrue(self.opened_urls, "launcher never attempted to open the browser")

    def _wait_health(self, port, timeout=10):
        deadline = time.time() + timeout
        last_exc = None
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1) as r:
                    return json.loads(r.read())
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                time.sleep(0.1)
        raise AssertionError(f"backend never became healthy: {last_exc}")

    def test_starts_waits_and_opens_browser_exactly_once(self):
        port = self._free_port()
        t, result = self._run_in_thread([str(port), "--claude-bin", str(FAKE_CLAUDE)])
        data = self._wait_health(port)
        self.assertTrue(data["claude"]["claudeFound"])
        self.assertTrue(data["claude"]["authenticated"])
        self._wait_opened()
        self.assertEqual(self.opened_urls, [f"http://127.0.0.1:{port}/"])

        # loopback only, never any other interface
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=2) as r:
            self.assertEqual(r.status, 200)

        self._stop(t, result)

    def test_invalid_port_rejected_without_starting_anything(self):
        with self.assertRaises(SystemExit) as ctx:
            start.main(["99999", "--claude-bin", str(FAKE_CLAUDE)])
        self.assertEqual(ctx.exception.code, 2)
        self.assertEqual(self.opened_urls, [])

    def test_model_and_claude_bin_reach_the_backend(self):
        port = self._free_port()
        t, result = self._run_in_thread([str(port), "--claude-bin", str(FAKE_CLAUDE), "--model", "opus"])
        data = self._wait_health(port)
        self.assertEqual(data["model"], "opus")
        self._wait_opened()
        self._stop(t, result)

    def test_occupied_port_is_rejected_before_starting_backend(self):
        port = self._free_port()
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", port))
            listener.listen()
            rc = start.main([str(port), "--claude-bin", str(FAKE_CLAUDE)])
        self.assertEqual(rc, 3)
        self.assertEqual(self.opened_urls, [])
        self.assertIsNone(start._TEST_LAST_PROC)

    def test_health_identity_rejects_unrelated_json(self):
        class Response:
            def read(self):
                return b'{"ok": true}'

        self.assertFalse(start._is_our_health_response(Response()))

    def _stop(self, thread, result):
        proc = getattr(start, "_TEST_LAST_PROC", None)
        self.assertIsNotNone(proc)
        start._stop_child(proc, timeout=5)
        thread.join(timeout=5)
        self.assertFalse(thread.is_alive(), "launcher thread did not exit after backend stopped")
        self.assertEqual(result.get("rc"), 0)


if __name__ == "__main__":
    unittest.main()
