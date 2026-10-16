"""Tests of repository packaging and generated-plan integrity, not commerce behavior."""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from check_generated import check as check_generated
from check_repository import check, validate_local_link


class RepositoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temporary = tempfile.TemporaryDirectory(prefix='rifare-repository-test-')
        cls.copy = Path(cls.temporary.name) / 'Rifare'
        shutil.copytree(ROOT, cls.copy, ignore=shutil.ignore_patterns(
            '.git', '__pycache__', 'evidence', 'artifacts', '.venv', 'node_modules', 'runtime'))

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temporary.cleanup()

    def assert_mutation_rejected(self, relative: str, value: str, needle: str) -> None:
        path = self.copy / relative
        original = path.read_bytes()
        try:
            path.write_text(value, encoding='utf-8')
            self.assertTrue(any(needle in error for error in check(self.copy)), needle)
        finally:
            path.write_bytes(original)

    def test_actual_repository_layout_passes(self):
        self.assertEqual(check(ROOT), [])

    def test_missing_instruction_entrypoint_fails(self):
        path = self.copy / 'AGENTS.md'
        original = path.read_bytes()
        try:
            path.unlink()
            self.assertTrue(any('Missing required source: AGENTS.md' in e for e in check(self.copy)))
        finally:
            path.write_bytes(original)

    def test_malformed_json_fails(self):
        self.assert_mutation_rejected('project.json', '{not valid', 'invalid JSON')

    def test_different_project_identity_fails(self):
        data = json.loads((self.copy / 'project.json').read_text(encoding='utf-8'))
        data['name'] = 'Different Project'
        self.assert_mutation_rejected('project.json', json.dumps(data), 'Project identity')

    def test_false_implementation_claim_fails(self):
        data = json.loads((self.copy / 'project.json').read_text(encoding='utf-8'))
        data['product_implemented'] = True
        self.assert_mutation_rejected('project.json', json.dumps(data), 'cannot claim product implementation')

    def test_false_product_test_claim_fails(self):
        data = json.loads((self.copy / 'project.json').read_text(encoding='utf-8'))
        data['product_tests_executed'] = 676
        self.assert_mutation_rejected('project.json', json.dumps(data), 'cannot claim product tests')

    def test_initial_assignment_cannot_be_fabricated(self):
        data = json.loads((self.copy / 'planning/goal-state.json').read_text(encoding='utf-8'))
        data['goals']['M00-G01']['owner'] = 'imaginary-worker'
        self.assert_mutation_rejected('planning/goal-state.json', json.dumps(data), 'cannot claim assignment')

    def test_missing_capability_target_fails(self):
        data = json.loads((self.copy / 'planning/capability-targets.json').read_text(encoding='utf-8'))
        data['capabilities'].pop()
        self.assert_mutation_rejected('planning/capability-targets.json', json.dumps(data), '44 unique')

    def test_broken_document_link_fails(self):
        original = (self.copy / 'README.md').read_text(encoding='utf-8')
        self.assert_mutation_rejected('README.md', original + '\n[Missing](absent-file.md)\n', 'missing local link')

    def test_machine_specific_reference_fails(self):
        original = (self.copy / 'README.md').read_text(encoding='utf-8')
        fixture = '/' + 'mnt' + '/data/' + 'unavailable-input.md'
        self.assert_mutation_rejected('README.md', original + '\n' + fixture, 'machine-specific')

    def test_escaping_link_fails(self):
        self.assertIn('escapes', validate_local_link(self.copy, self.copy / 'README.md', '../outside.md'))

    def test_external_and_internal_links_are_distinct(self):
        self.assertIsNone(validate_local_link(self.copy, self.copy / 'README.md', 'https://example.com/elsewhere'))
        self.assertIsNone(validate_local_link(self.copy, self.copy / 'README.md', 'AGENTS.md'))

    def test_generated_views_are_current(self):
        self.assertEqual(check_generated(ROOT), [])

    def test_generated_packet_edit_is_detected(self):
        path = self.copy / 'goals/M00/M00-G01.md'
        original = path.read_bytes()
        try:
            path.write_text('Changed only a generated packet.\n', encoding='utf-8')
            self.assertTrue(any('Stale generated view' in e for e in check_generated(self.copy)))
        finally:
            path.write_bytes(original)

    def test_orphan_goal_packet_is_detected(self):
        path = self.copy / 'goals/M00/M00-G98.md'
        try:
            path.write_text('Orphan rendered packet.\n', encoding='utf-8')
            self.assertTrue(any('Orphan generated view' in e for e in check_generated(self.copy)))
        finally:
            path.unlink()
