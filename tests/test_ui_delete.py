"""Static UI contract for discoverable, recoverable research deletion."""
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]


class DeleteResearchUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = (REPO_ROOT / "ui/app.js").read_text(encoding="utf-8")
        cls.styles = (REPO_ROOT / "ui/styles.css").read_text(encoding="utf-8")

    def test_real_project_cards_expose_delete_button(self):
        self.assertIn("server-delete-btn", self.app)
        self.assertIn(">Delete</button>", self.app)
        self.assertIn("deleteServerProjectFromCard", self.app)

    def test_delete_uses_existing_recoverable_backend_endpoint(self):
        self.assertIn('"/remove"', self.app)
        self.assertIn("confirmTitle: typed", self.app)
        self.assertIn("recoverable trash folder", self.app)

    def test_active_research_cannot_be_deleted(self):
        self.assertIn("serverProjectIsActive", self.app)
        self.assertIn("Stop this research before deleting it", self.app)

    def test_delete_action_has_danger_styling(self):
        self.assertIn(".btn.danger", self.styles)


if __name__ == "__main__":
    unittest.main()
