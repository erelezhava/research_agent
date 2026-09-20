"""Regression checks for the internal-record/public-report boundary."""
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]


class ReportContractTests(unittest.TestCase):
    def test_shared_contract_separates_internal_records_from_report(self):
        text = (REPO_ROOT / "CLAUDE.md").read_text(encoding="utf-8")
        self.assertIn("## Internal records versus the public report", text)
        self.assertIn("The files under runs/ and findings/ are internal research records", text)
        self.assertIn("The file under reports/ is a finished publication for the reader", text)
        self.assertIn("no agent narration", text)

    def test_workflow_delegates_reader_facing_draft(self):
        text = (REPO_ROOT / ".claude/commands/research.md").read_text(encoding="utf-8")
        self.assertIn("delegate the initial report draft to `report-writer`", text)
        self.assertIn("not a trace of the work that produced it", text)
        self.assertIn("not in the report", text)

    def test_report_writer_has_no_retrieval_tools_and_bans_process_logs(self):
        text = (REPO_ROOT / ".claude/agents/report-writer.md").read_text(encoding="utf-8")
        self.assertIn("tools: Read, Write, Grep, Glob", text)
        frontmatter = text.split("---", 2)[1]
        self.assertNotIn("WebSearch", frontmatter)
        self.assertNotIn("WebFetch", frontmatter)
        self.assertIn("Exclude all workflow residue", text)
        self.assertIn("Write no prose after Sources", text)

    def test_verifier_checks_publication_quality(self):
        text = (REPO_ROOT / ".claude/agents/verifier.md").read_text(encoding="utf-8")
        self.assertIn("reader-facing publication", text)
        self.assertIn("process narration", text)
        self.assertIn("agent/tool/search logs", text)


if __name__ == "__main__":
    unittest.main()
