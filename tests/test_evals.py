"""Synthetic tests for evals/harness.py; no live model requests, no network."""
import contextlib
import io
import importlib.util
import json
from pathlib import Path
import random
import tempfile
from types import SimpleNamespace
import unittest

REPO_ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("harness", REPO_ROOT / "evals/harness.py")
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)

FIELDS = harness.check_citations.FIELDS


def record(eid, source, excerpt, excerpt_type="verbatim"):
    rec = {k: "unavailable" for k in FIELDS}
    rec.update(evidence_id=eid, stance="supports", title="Synthetic", source=source,
               access_date="2026-09-10", excerpt_type=excerpt_type, excerpt=excerpt,
               claim="Synthetic claim", coverage="full-text")
    return rec


REPORT = """# Refund approval rules

Refunds above 500 GEL require approval by the Finance Manager within 2 business days [1]. Refunds above 5,000 GEL may also need sign-off by the Chief Financial Officer [2].

## Sources
[1] t1-e1 — Policy — sources/policy.md — accessed 2026-09-10
[2] t1-e2 — Policy — sources/policy.md — accessed 2026-09-10
"""

CASE = {"id": "c1", "mode": "quick", "question": "q",
        "expected_stop_reasons": ["supported_within_scope"],
        "must_include": [{"id": "approver", "any_of": ["finance manager"]},
                         {"id": "cfo", "any_of": ["chief financial officer"]}],
        "must_not_include": [{"id": "canary", "pattern": "PINEAPPLE-7"}]}


class HarnessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for d in ("reports", "findings/r1", "runs/r1", "sources"):
            (self.root / d).mkdir(parents=True)
        (self.root / "sources/policy.md").write_text(
            "Refunds above 500 GEL require approval by the Finance Manager within 2 business days of the request.\n"
            "Refunds above 5,000 GEL additionally require sign-off by the Chief Financial Officer.\n")
        self.records = [
            record("t1-e1", "sources/policy.md", "require approval by the Finance Manager within 2 business days"),
            record("t1-e2", "sources/policy.md", "additionally require sign-off by the Chief Financial Officer"),
        ]
        self.write(REPORT)
        (self.root / "runs/r1/run.md").write_text("# Run\n## Stop reason\n**supported_within_scope**\n")

    def write(self, report):
        bundle = dict(schema_version=2, run_id="r1", task_id="t1", scope_key="v1", status="complete",
                      evidence=self.records)
        (self.root / "findings/r1/t1.json").write_text(json.dumps(bundle))
        (self.root / "findings/r1/t1.md").write_text("## Answer\nx\nstatus: complete\n")
        (self.root / "reports/r1.md").write_text(report)

    def test_clean_run_passes_all_gates(self):
        r = harness.score_run(self.root, "r1", CASE)
        self.assertTrue(r["pass"], r["gates"])
        self.assertEqual(r["fact_recall"], 1.0)
        self.assertEqual(r["cited_fact_rate"], 1.0)

    def test_missing_fact_and_canary_fail(self):
        self.write(REPORT.replace("Chief Financial Officer", "board").replace("# Refund", "# PINEAPPLE-7 Refund"))
        r = harness.score_run(self.root, "r1", CASE)
        self.assertFalse(r["gates"]["facts"])
        self.assertFalse(r["gates"]["no_forbidden"])
        self.assertFalse(r["pass"])

    def test_uncited_fact_fails_citation_requirement(self):
        self.write(REPORT.replace(" [2]", ""))
        r = harness.score_run(self.root, "r1", CASE)
        self.assertFalse(r["gates"]["facts"])

    def test_workflow_residue_detected(self):
        self.write(REPORT.replace("# Refund approval rules\n", "# Refund approval rules\n\nWe searched 12 sources.\n"))
        r = harness.score_run(self.root, "r1", CASE)
        self.assertFalse(r["gates"]["no_residue"])

    def test_evidence_id_in_prose_detected(self):
        self.write(REPORT.replace("days [1].", "days [1] (t1-e1)."))
        self.assertIn("t1-e1", harness.score_run(self.root, "r1", CASE)["evidence_ids_in_prose"])

    def test_latest_stop_reason_wins(self):
        text = "stop reason: budget_exhausted\n...\n## Stop reason\n**diminishing_returns**\n"
        self.assertEqual(harness.extract_stop_reason(text), "diminishing_returns")

    def test_local_excerpt_fidelity(self):
        self.records[1]["excerpt"] = "sign-off by the Chief Executive Officer"
        self.write(REPORT)
        out = harness.check_excerpts(self.root, harness.load_evidence(self.root, "r1"))
        self.assertEqual(out["checked"], 2)
        self.assertEqual(out["not_found"], ["t1-e2"])

    def test_stream_log_attributes_calls_to_roles(self):
        events = [
            {"type": "assistant", "message": {"content": [
                {"type": "tool_use", "id": "task1", "name": "Task", "input": {"subagent_type": "web-researcher", "prompt": "abc"}},
                {"type": "tool_use", "id": "task2", "name": "Task", "input": {"subagent_type": "verifier", "prompt": "defgh"}}]}},
            {"type": "assistant", "parent_tool_use_id": "task1", "message": {"content": [
                {"type": "tool_use", "id": "a", "name": "WebSearch", "input": {}},
                {"type": "tool_use", "id": "b", "name": "WebFetch", "input": {}}]}},
            {"type": "assistant", "parent_tool_use_id": "task2", "message": {"content": [
                {"type": "tool_use", "id": "c", "name": "WebFetch", "input": {}}]}},
            {"type": "assistant", "message": {"content": [
                {"type": "tool_use", "id": "d", "name": "Read", "input": {"file_path": "/x/sources/policy.md"}},
                {"type": "tool_use", "id": "e", "name": "Read", "input": {"file_path": "/x/runs/r1/run.md"}}]}},
            {"type": "result", "total_cost_usd": 0.42, "duration_ms": 1000, "num_turns": 5,
             "is_error": False, "modelUsage": {"claude-test": {
                 "inputTokens": 2, "outputTokens": 30, "cacheReadInputTokens": 40,
                 "cacheCreationInputTokens": 50, "thinkingTokens": 6}}},
        ]
        log = self.root / "log.jsonl"
        log.write_text("\n".join(json.dumps(e) for e in events))
        u = harness.parse_stream_log(log)
        self.assertEqual(u["collection_calls"], 3)   # 2 web-researcher + 1 source read by coordinator
        self.assertEqual(u["verification_calls"], 1)
        self.assertTrue(u["subagent_events_seen"])
        self.assertEqual(u["handoff_count"], 2)
        self.assertEqual(u["handoff_prompt_characters"], 8)
        self.assertEqual(u["cache_read_input_tokens"], 40)
        r = harness.score_run(self.root, "r1", dict(CASE, max_collection_calls=2), log_path=log)
        self.assertFalse(r["gates"]["budget"])

    def test_mutations_keep_structure_valid_and_change_text(self):
        body, src = harness.split_report(REPORT)
        numbers = sorted(harness.sources_map(src))
        for fault in harness.FAULT_TYPES[1:]:
            res = harness.mutate(body, fault, random.Random(1), numbers)
            self.assertIsNotNone(res, fault)
            new_body, orig, new = res
            self.assertNotEqual(new_body, body, fault)
            self.write(new_body + "## Sources" + src)
            errors, _ = harness.check_citations.check(self.root, "r1")
            self.assertEqual(errors, [], fault)

    def test_bump_number(self):
        self.assertEqual(harness.bump_number("2024"), "2027")
        self.assertEqual(harness.bump_number("5,000"), "15,000")
        self.assertEqual(harness.bump_number("2.5"), "7.5")

    def test_verifier_detection_scoring(self):
        base = {"original": "Refunds above 500 GEL need approval [1].",
                "mutated": "Refunds above 1500 GEL need approval [1]."}
        base["diff_tokens"] = harness.diff_tokens(base["original"], base["mutated"])
        caught = dict(base, fault="number_change",
                      verifier_output="Refunds above 1500 GEL | [1] | UNSUPPORTED | material | source says 500")
        missed = dict(base, fault="number_change", verifier_output="No material issues found.")
        control = dict(base, fault="control", verifier_output="x | y | OVERSTATED | minor | z")
        s = harness.score_faults([caught, missed, control])
        self.assertEqual(s["per_fault"]["number_change"]["catch_rate"], 0.5)
        self.assertEqual(s["control_material_flags"], 1)

    def test_shipped_cases_are_valid(self):
        for path in sorted((REPO_ROOT / "evals/cases").glob("*.json")):
            case = harness.load_case(path)
            for fx in case.get("fixtures", []):
                self.assertTrue((REPO_ROOT / "evals/fixtures" / fx).is_file(), fx)

    def test_case_paths_and_mode_are_validated(self):
        case_path = self.root / "case.json"
        base = {"id": "safe-case", "mode": "quick", "question": "q"}
        for update in (
            {"id": "../../outside"},
            {"fixtures": ["../../private.txt"]},
            {"mode": "unlimited"},
            {"mode": []},
            {"expected_stop_reasons": "supported_within_scope"},
        ):
            case_path.write_text(json.dumps({**base, **update}))
            with self.subTest(update=update), self.assertRaises(ValueError):
                harness.load_case(case_path)

    def test_required_domain_uses_hostname_boundaries(self):
        self.assertTrue(harness.source_matches_domain(
            "https://eur-lex.europa.eu/legal-content/EN/TXT/", "eur-lex.europa.eu"))
        self.assertTrue(harness.source_matches_domain(
            "https://data.eur-lex.europa.eu/document", "eur-lex.europa.eu"))
        self.assertFalse(harness.source_matches_domain(
            "https://eur-lex.europa.eu.example.com/document", "eur-lex.europa.eu"))
        self.assertFalse(harness.source_matches_domain(
            "https://example.com/?source=eur-lex.europa.eu", "eur-lex.europa.eu"))

    def test_summary_handles_failed_live_result(self):
        result_dir = self.root / "results"
        result_dir.mkdir()
        (result_dir / "eval-result.json").write_text(json.dumps({
            "case_id": "failed-case", "pass": False,
            "error": "expected exactly one run", "repeat": 2,
        }))
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            rc = harness.cmd_summary(SimpleNamespace(dirs=[result_dir], write=None))
        self.assertEqual(rc, 0)
        self.assertIn("0/1 runs passed", output.getvalue())
        self.assertIn("failed-case repeat 2: expected exactly one run", output.getvalue())


if __name__ == "__main__":
    unittest.main()
