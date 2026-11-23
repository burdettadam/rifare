"""Exact command intake must survive a manifest pin refresh without widening."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import check_distribution as distribution


class CommerceRuntimeIntakeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ['package.json', 'package-lock.json', '.npmrc']:
            relative = Path('apps/commerce-backend') / name
            (self.root / relative).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, self.root / relative)

    def test_reviewed_manifest_and_unchanged_lock_pass(self):
        self.assertEqual(len(distribution.validate_commerce_runtime(self.root)), 2)

    def test_changed_manifest_requires_review(self):
        path = self.root / 'apps/commerce-backend/package.json'
        path.write_bytes(path.read_bytes() + b'\n')
        with self.assertRaisesRegex(ValueError, 'review_required'):
            distribution.validate_commerce_runtime(self.root)

    def test_rehashing_cannot_approve_same_prefix_command_or_install_hook(self):
        relative = 'apps/commerce-backend/package.json'
        path = self.root / relative
        original = json.loads(path.read_text())
        for key, command in [('start', 'node run.mjs exec ./unreviewed.js'),
                             ('postinstall', 'node run.mjs start')]:
            candidate = json.loads(json.dumps(original))
            candidate['scripts'][key] = command
            path.write_text(json.dumps(candidate))
            with patch.dict(distribution.COMMERCE_RUNTIME_MANIFESTS,
                            {relative: hashlib.sha256(path.read_bytes()).hexdigest()}):
                with self.assertRaisesRegex(ValueError, 'unreviewed command or lifecycle hook'):
                    distribution.validate_commerce_runtime(self.root)

    def test_installation_hooks_remain_disabled(self):
        (self.root / 'apps/commerce-backend/.npmrc').write_text('ignore-scripts=false\n')
        with self.assertRaisesRegex(ValueError, 'installation scripts must stay disabled'):
            distribution.validate_commerce_runtime(self.root)
