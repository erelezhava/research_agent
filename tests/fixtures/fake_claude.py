#!/usr/bin/env python3
"""A fake `claude` CLI used only by the test suite. Never calls any real API
or costs any real Claude allowance. Understands just enough of the real
CLI's argv shape (as verified against the real installed CLI — see
server/runner.py's module docstring) to exercise server/runner.py and
server/app.py end to end.

Controlled entirely by environment variables set by the test:
- FAKE_CLAUDE_SCENARIO: success | needs_attention | failure | usage_limit
- FAKE_CLAUDE_ARGV_DUMP: if set, the full argv is JSON-dumped there (one
  element per line) so a test can assert exactly what was passed — e.g. that
  a prompt containing shell metacharacters arrived verbatim as data, that no
  --dangerously-skip-permissions / bypassPermissions flag is ever present,
  that the disallowed-patterns and tools list are exactly what runner.py
  claims to send.
- FAKE_CLAUDE_MARKER_DIR: if a prompt asks the fake to "run" a destructive
  command, a real shell would create a marker file here — the fake never
  does this (it doesn't execute anything), so the marker's absence is what
  the test checks to prove shell metacharacters had no effect.
"""
import json
import os
import re
import sys
import time
from pathlib import Path


def find_flag_value(argv, name):
    for i, a in enumerate(argv):
        if a == name and i + 1 < len(argv):
            return argv[i + 1]
    return None


def main():
    argv = sys.argv[1:]

    dump_path = os.environ.get("FAKE_CLAUDE_ARGV_DUMP")
    if dump_path:
        Path(dump_path).write_text(json.dumps(argv, indent=2), encoding="utf-8")

    if argv[:1] == ["--version"]:
        print("2.1.278 (Fake Claude Code for tests)")
        return 0
    if argv[:2] == ["auth", "status"]:
        print(json.dumps({"loggedIn": True, "authMethod": "claude.ai", "apiProvider": "firstParty"}))
        return 0

    prompt = find_flag_value(argv, "-p") or ""
    session_id = find_flag_value(argv, "--session-id") or find_flag_value(argv, "--resume") or "test-session"
    resumed = "--resume" in argv
    scenario = os.environ.get("FAKE_CLAUDE_SCENARIO", "success")
    cwd = Path.cwd()

    def emit(obj):
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()

    emit({"type": "system", "subtype": "init", "session_id": session_id,
          "tools": ["Task", "Bash", "Edit", "Glob", "Grep", "Read", "WebFetch", "WebSearch", "Write"],
          "mcp_servers": [], "permissionMode": "acceptEdits"})

    hold = float(os.environ.get("FAKE_CLAUDE_HOLD", "0") or 0)
    if hold:
        time.sleep(hold)

    m = re.search(r"projects/([a-z0-9][a-z0-9-]*)/runs", prompt)
    project_id = m.group(1) if m else None
    run_id = "run-fake-1"

    def write(rel, text):
        p = cwd / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")

    if scenario == "failure":
        emit({"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": "Read", "input": {"file_path": "CLAUDE.md"}}]}})
        time.sleep(0.05)
        emit({"type": "result", "subtype": "error", "is_error": True,
              "result": "Simulated failure: something went wrong.", "session_id": session_id})
        return 1

    if scenario == "usage_limit":
        emit({"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": "WebSearch", "input": {"query": "test query"}}]}})
        time.sleep(0.05)
        emit({"type": "result", "subtype": "error_usage_limit", "is_error": True,
              "result": "Claude AI usage limit reached for this session. Try again later.",
              "session_id": session_id})
        return 1

    if scenario == "needs_attention":
        if project_id:
            write(f"projects/{project_id}/runs/{run_id}/run.md",
                  "# Run: run-fake-1\n\n## Question\nTest question.\n\n"
                  "## Next action\nWaiting on clarification from the user.\n")
        emit({"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": "Write", "input": {"file_path": f"projects/{project_id}/runs/{run_id}/run.md"}}]}})
        time.sleep(0.05)
        emit({"type": "result", "subtype": "success", "is_error": False,
              "result": "Stopped for clarification before writing a report.", "session_id": session_id})
        return 0

    # default: success, with a real report + findings + valid citations so the
    # server's own citation-checker confirmation (defense in depth) also passes
    if project_id:
        if resumed:
            write(f"projects/{project_id}/runs/{run_id}/run.md",
                  "# Run: run-fake-1\n\n## Phase\nsynthesis -> complete (resumed)\n")
        else:
            write(f"projects/{project_id}/runs/{run_id}/run.md",
                  "# Run: run-fake-1\n\n## Question\nTest question.\n\n"
                  "## Phase\nsynthesis -> complete\n\n## Stop reason\n**supported_within_scope**\n")
        write(f"projects/{project_id}/findings/{run_id}/t1.md", "## Answer\nFake finding.\nstatus: complete\n")
        bundle = {
            "schema_version": 2, "run_id": run_id, "task_id": "t1", "scope_key": "v1",
            "status": "complete",
            "evidence": [{
                "evidence_id": "t1-e1", "stance": "supports", "title": "Fake source",
                "source": "https://example.invalid/fake", "locator": "p.1",
                "pub_date": "2026-01-01", "access_date": "2026-01-01", "period_or_version": "v1",
                "excerpt_type": "extraction", "excerpt": "Fake excerpt.", "claim": "Fake claim.",
                "qualifications": "none", "coverage": "partial", "provenance": "test fixture",
            }],
        }
        write(f"projects/{project_id}/findings/{run_id}/t1.json", json.dumps(bundle))
        write(f"projects/{project_id}/reports/{run_id}.md",
              "# Fake report\n\nA fake finding [1].\n\n"
              "## Sources\n[1] t1-e1 — Fake source — https://example.invalid/fake — accessed 2026-01-01\n")

    emit({"type": "assistant", "message": {"content": [
        {"type": "tool_use", "name": "Task", "input": {"subagent_type": "web-researcher"}}]}})
    emit({"type": "assistant", "message": {"content": [
        {"type": "tool_use", "name": "Write", "input": {"file_path": f"projects/{project_id}/reports/{run_id}.md"}}]}})
    emit({"type": "assistant", "message": {"content": [
        {"type": "tool_use", "name": "Bash", "input": {"command": "python3 scripts/check_citations.py " + run_id}}]}})
    time.sleep(0.05)
    emit({"type": "result", "subtype": "success", "is_error": False,
          "result": "Report complete.", "session_id": session_id})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
