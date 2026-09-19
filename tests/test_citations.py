"""Synthetic structural cases; no live model requests or project artifacts modified."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('checker', Path(__file__).resolve().parents[1] / 'scripts/check_citations.py')
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class CitationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'reports').mkdir()
        self.folder = self.root / 'findings/r1'
        self.folder.mkdir(parents=True)
        self.record = {key: 'unavailable' for key in checker.FIELDS}
        self.record.update(evidence_id='task-one-e1', stance='supports', title='Synthetic',
                           source='https://example.invalid/source', access_date='2026-09-10',
                           excerpt_type='extraction', excerpt='Synthetic passage', claim='Synthetic claim', coverage='partial')
        self.bundle = dict(schema_version=2, run_id='r1', task_id='task-one', scope_key='v1', status='complete', evidence=[self.record])
        self.report = 'Synthetic claim [1].\n\n## Sources\n[1] task-one-e1 — Synthetic — https://example.invalid/source — accessed 2026-09-10\n'

    def run_check(self, status='complete'):
        (self.folder / 'task-one.json').write_text(json.dumps(self.bundle))
        (self.folder / 'task-one.md').write_text('## Answer\nSynthetic\nstatus: ' + status + '\n')
        (self.root / 'reports/r1.md').write_text(self.report)
        return checker.check(self.root, 'r1')

    def test_valid_hyphenated_id(self):
        self.assertEqual(self.run_check(), ([], []))

    def test_orphan(self):
        self.report = self.report.replace('claim [1]', 'claim [2]')
        self.assertTrue(self.run_check()[0])

    def test_duplicate_number_same_id(self):
        self.report += self.report.splitlines()[-1] + '\n'
        self.assertTrue(self.run_check()[0])

    def test_prose_id_is_not_evidence(self):
        self.bundle['evidence'] = []
        self.assertTrue(self.run_check()[0])

    def test_missing_excerpt(self):
        del self.record['excerpt']
        self.assertTrue(self.run_check()[0])

    def test_partial_task(self):
        self.bundle['status'] = 'partial'
        self.assertTrue(self.run_check('partial')[0])

    def test_inconsistent_completion(self):
        self.assertTrue(self.run_check('partial')[0])

    def test_wrong_run(self):
        self.bundle['run_id'] = 'another'
        self.assertTrue(self.run_check()[0])

    def test_duplicate_evidence(self):
        self.bundle['evidence'].append(dict(self.record))
        self.assertTrue(self.run_check()[0])

    def test_wrong_source(self):
        self.record['source'] = 'https://example.invalid/other'
        self.assertTrue(self.run_check()[0])

    def test_prose_after_sources(self):
        self.report += '\n## Conclusion\nUnvalidated [2]\n'
        self.assertTrue(self.run_check()[0])

    def test_unused_is_warning(self):
        self.report = self.report.replace('claim [1]', 'claim')
        errors, warnings = self.run_check()
        self.assertFalse(errors)
        self.assertTrue(warnings)

    def test_malformed_source(self):
        self.report = self.report.replace('[1] task-one', '- [1] task-one')
        self.assertTrue(self.run_check()[0])

    def test_duplicate_json_keys(self):
        with self.assertRaises(ValueError):
            json.loads('{"status":"partial","status":"complete"}', object_pairs_hook=checker.unique_object)


if __name__ == '__main__':
    unittest.main()
