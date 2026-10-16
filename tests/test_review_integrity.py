"""Regression cases from the delegated integration review; real Git objects."""
from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import test_harness as H
import regression_gate as G
from test_regression_gate import GateFixture


class SourceIdentityReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='rifare-review-identity-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'source'
        self.root.mkdir()
        self.make_repo(self.root, 'Original source')
        self.base = self.git(self.root, 'rev-parse', 'HEAD')

    @staticmethod
    def git(root, *args):
        env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
        env.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM='1')
        return subprocess.check_output(
            ['git', '-c', 'user.name=Rifare Review Fixture', '-c',
             'user.email=fixture@example.invalid', '-c', 'core.hooksPath=' + os.devnull,
             '-C', str(root), *args], env=env, stderr=subprocess.PIPE,
            timeout=10).decode().strip()

    def make_repo(self, root, message):
        self.git(root, 'init', '-q', '-b', 'main')
        (root / 'app.txt').write_text('original behavior\n')
        self.git(root, 'add', '.')
        self.git(root, 'commit', '-qm', message)

    def replace_commit(self):
        (self.root / 'app.txt').write_text('uncommitted different behavior\n')
        self.git(self.root, 'add', '.')
        tree = self.git(self.root, 'write-tree')
        alternate = self.git(self.root, 'commit-tree', tree, '-p', self.base,
                             '-m', 'Synthetic replacement')
        self.git(self.root, 'replace', self.base, alternate)

    def test_clean_checkout_still_has_original_identity(self):
        result = H.source_identity(self.root)
        self.assertTrue(result['clean'])
        self.assertEqual(result['commit'], self.base)

    def test_commit_replacement_cannot_disguise_changed_source(self):
        self.replace_commit()
        self.assertEqual(self.git(self.root, 'status', '--porcelain'), '')
        result = H.source_identity(self.root)
        self.assertEqual(result['commit'], self.base)
        self.assertFalse(result['clean'])

    def test_controller_rejects_replaced_commit_before_execution(self):
        self.replace_commit()
        with self.assertRaisesRegex(ValueError, 'dirty'):
            G.inspect_checkout(self.root, self.base)

    def test_ambient_git_directory_does_not_redirect_source_identity(self):
        other = Path(self.temp.name) / 'other'
        other.mkdir()
        self.make_repo(other, 'Different repository identity')
        expected = H.source_identity(self.root)
        with patch.dict(os.environ, {'GIT_DIR': str(other / '.git'),
                                     'GIT_WORK_TREE': str(other)}):
            self.assertEqual(H.source_identity(self.root), expected)

    def test_ambient_index_does_not_change_tracked_membership(self):
        alternate = Path(self.temp.name) / 'empty-index'
        expected = H.source_identity(self.root)
        with patch.dict(os.environ, {'GIT_INDEX_FILE': str(alternate)}):
            self.assertEqual(H.source_identity(self.root), expected)

    def test_replacement_opt_in_cannot_override_inspection(self):
        self.replace_commit()
        with patch.dict(os.environ, {'GIT_NO_REPLACE_OBJECTS': '',
                                     'GIT_REPLACE_REF_BASE': 'refs/replace/'}):
            self.assertFalse(H.source_identity(self.root)['clean'])

    def test_real_modified_source_is_not_hidden_by_environment_sanitization(self):
        (self.root / 'app.txt').write_text('modified bytes\n')
        self.assertFalse(H.source_identity(self.root)['clean'])


class ControllerIdentityReviewTests(GateFixture):
    def test_replaced_green_test_cannot_run_under_original_commit(self):
        path = self.repo / 'tests/test_feature.py'
        path.write_text(path.read_text().replace('self.assertEqual(1+1,2)',
                                                'self.assertTrue(True)'))
        self.git('add', '.')
        tree = self.git('write-tree')
        alternate = self.git('commit-tree', tree, '-p', self.base,
                             '-m', 'Synthetic changed assertion')
        self.git('replace', self.base, alternate)
        self.assertEqual(self.git('status', '--porcelain'), '')
        with self.assertRaisesRegex(ValueError, 'dirty'):
            self.gate(self.base)
        self.assertFalse((self.home / 'run-1').exists())

    def test_controller_ancestry_ignores_foreign_git_environment(self):
        other = self.home / 'unrelated'
        other.mkdir()
        SourceIdentityReviewTests.git(other, 'init', '-q', '-b', 'main')
        (other / 'other.txt').write_text('unrelated fixture\n')
        SourceIdentityReviewTests.git(other, 'add', '.')
        SourceIdentityReviewTests.git(other, 'commit', '-qm', 'Unrelated')
        with patch.dict(os.environ, {'GIT_DIR': str(other / '.git'),
                                     'GIT_WORK_TREE': str(other)}):
            report = self.gate(self.base)
        self.assertEqual(report['status'], 'passed', report)
        self.assertEqual(report['executed_test_count'], 1)
        self.assertEqual(report['source']['commit'], self.base)
