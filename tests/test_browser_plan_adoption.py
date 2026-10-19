"""Planning integrity checks only; no browser, model or commerce execution."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import check_repository
from validate_plan import load_documents, validate_documents

BROWSER_SOURCE = 'reference/additions/m23-m25-requirements.json'
DOCUMENT_PATHS = (
    'planning/goals.json', 'planning/test-specifications.json',
    'planning/requirement-coverage.json', 'planning/milestones.json',
    'reference/original-backlog.json', 'reference/original-acceptance-tests.json',
    'reference/additions/m13-m22-requirements.json', BROWSER_SOURCE,
)


class BrowserPlanStructureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = load_documents(ROOT)
        cls.browser = json.loads((ROOT / BROWSER_SOURCE).read_text())

    def setUp(self):
        self.docs = copy.deepcopy(self.original)
        self.docs['browser_requirements'] = copy.deepcopy(self.browser)

    def browser_requirement(self):
        return next(r for r in self.docs['coverage']['requirements']
                    if r['id'] == 'ADD-M23-G01')

    def test_browser_source_is_loaded_and_exact_union_is_valid(self):
        loaded = load_documents(ROOT)
        self.assertIn('browser_requirements', loaded)
        self.assertEqual(len(loaded['browser_requirements']['requirements']), 15)
        self.assertEqual(len(loaded['coverage']['requirements']), 216)
        self.assertEqual(validate_documents(loaded), [])

    def test_browser_coverage_criterion_cannot_be_weakened(self):
        self.browser_requirement()['acceptance_criteria'] = 'A model name is enough.'
        self.assertTrue(any('adopted acceptance criterion changed' in error
                            for error in validate_documents(self.docs)))

    def test_missing_browser_requirement_breaks_exact_union(self):
        self.docs['coverage']['requirements'].remove(self.browser_requirement())
        self.assertTrue(any('exact approved union' in error
                            for error in validate_documents(self.docs)))

    def test_browser_frozen_source_cannot_reuse_an_original_id(self):
        self.docs['browser_requirements']['requirements'][0]['id'] = (
            self.docs['original_requirements']['items'][0]['id'])
        errors = validate_documents(self.docs)
        self.assertTrue(any('frozen browser addition changed' in error for error in errors))
        self.assertTrue(any('collide' in error for error in errors))

    def test_browser_frozen_source_cannot_reuse_a_prior_adopted_id(self):
        self.docs['browser_requirements']['requirements'][0]['id'] = (
            self.docs['adopted_requirements']['requirements'][0]['id'])
        errors = validate_documents(self.docs)
        self.assertTrue(any('frozen browser addition changed' in error for error in errors))
        self.assertTrue(any('collide' in error for error in errors))

    def test_candidate_cannot_expand_the_browser_frozen_namespace(self):
        invented = copy.deepcopy(self.docs['browser_requirements']['requirements'][0])
        invented['id'] = 'ADD-UNAPPROVED-BROWSER'
        self.docs['browser_requirements']['requirements'].append(invented)
        coverage = copy.deepcopy(self.browser_requirement())
        coverage['id'] = invented['id']
        self.docs['coverage']['requirements'].append(coverage)
        self.assertTrue(any('frozen browser addition changed' in error
                            for error in validate_documents(self.docs)))

    def test_worker_criteria_cannot_diverge_from_frozen_browser_requirement(self):
        goal = next(g for g in self.docs['goals']['goals'] if g['id'] == 'M23-G01')
        goal['acceptance_criteria'] = ['Accept a generic chat model without its decision head.']
        self.assertTrue(any('browser goal acceptance criterion changed' in error
                            for error in validate_documents(self.docs)))

    def copied_documents(self, directory):
        target = Path(directory)
        for relative in DOCUMENT_PATHS:
            path = target / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, path)
        return target

    def test_browser_frozen_file_checks_exact_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            target = self.copied_documents(directory)
            path = target / BROWSER_SOURCE
            path.write_bytes(path.read_bytes() + b' ')
            with self.assertRaisesRegex(ValueError, 'frozen browser addition changed'):
                load_documents(target)

    def test_missing_browser_frozen_file_fails_loading(self):
        with tempfile.TemporaryDirectory() as directory:
            target = self.copied_documents(directory)
            (target / BROWSER_SOURCE).unlink()
            with self.assertRaises(OSError):
                load_documents(target)


class CapabilityTargetStructureTests(unittest.TestCase):
    def setUp(self):
        self.targets = json.loads((ROOT / 'planning/capability-targets.json').read_text())['capabilities']

    def test_current_closed_target_set_is_valid(self):
        self.assertEqual(len(self.targets), 57)
        self.assertEqual(check_repository.validate_capability_targets(self.targets), [])

    def test_same_count_unapproved_target_is_rejected(self):
        self.targets[-1]['id'] = 'CAP-UNAPPROVED'
        self.assertTrue(check_repository.validate_capability_targets(self.targets))

    def test_same_count_duplicate_cannot_hide_missing_target(self):
        self.targets[-1]['id'] = self.targets[-2]['id']
        self.assertTrue(check_repository.validate_capability_targets(self.targets))

    def test_planning_target_cannot_claim_implementation(self):
        self.targets[-1]['status'] = 'implemented'
        self.assertTrue(check_repository.validate_capability_targets(self.targets))


if __name__ == '__main__':
    unittest.main()
