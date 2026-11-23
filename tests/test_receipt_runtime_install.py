"""Exercise the optional install boundary without downloading package fixtures."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import check_distribution as distribution
import install_receipt_runtime as installer

WORKSPACE = 'packages/adapters/delegated-receipts'
FIXTURE_PACKAGE = b'{"name":"jose","version":"6.2.18","type":"module","license":"MIT"}\n'
FIXTURE_LICENSE = b'Original synthetic test notice; no upstream package content.\n'
FIXTURE_FILES = {
    'package.json': FIXTURE_PACKAGE,
    'LICENSE.md': FIXTURE_LICENSE,
    'dist/webapi/index.js': b'export const syntheticFixture = true;\n',
}


class ReceiptRuntimeInstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='rifare-receipt-installer-test-')
        self.root = Path(self.tmp.name)
        self.source_paths = set(distribution.RECEIPT_RUNTIME_MANIFESTS) | {
            'package.json', 'package-lock.json', '.node-version', '.npmrc',
            'tests/fixtures/development/command-manifests.v1.json',
        }
        for relative in self.source_paths:
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, target)
        self.original = {p: (self.root / p).read_bytes() for p in self.source_paths}
        self.pins = patch.dict(installer.INSTALLED_FILE_PINS, {
            name: hashlib.sha256(FIXTURE_FILES[name]).hexdigest()
            for name in ('package.json', 'LICENSE.md')
        })
        self.pins.start()
        self.addCleanup(self.pins.stop)
        self.addCleanup(self.tmp.cleanup)

    def npm(self, command, **kwargs):
        self.assertEqual(command[:2], [shutil.which('npm') or 'npm', 'ci'])
        self.assertIn('--ignore-scripts', command)
        self.assertIn('--no-audit', command)
        self.assertIn('--no-fund', command)
        self.assertIn('--install-strategy=hoisted', command)
        prefix = Path(command[command.index('--prefix') + 1])
        self.assertEqual(prefix.parent, self.root / 'node_modules')
        self.assertTrue(prefix.name.startswith('.rifare-receipt-'))
        self.assertEqual(kwargs['cwd'], prefix)
        self.assertEqual(kwargs['stdin'], subprocess.DEVNULL)
        self.assertTrue(kwargs['check'])
        self.assertLessEqual(kwargs['timeout'], 60)
        for relative in distribution.RECEIPT_RUNTIME_MANIFESTS:
            self.assertEqual((prefix / Path(relative).name).read_bytes(), self.original[relative])
        self.write_package(prefix / 'node_modules/jose')
        hidden = {
            'name': 'rifare-delegated-receipts', 'version': '0.0.0',
            'lockfileVersion': 3, 'requires': True,
            'packages': {'node_modules/jose': distribution.RECEIPT_JOSE_LOCK},
        }
        (prefix / 'node_modules/.package-lock.json').write_text(json.dumps(hidden))
        return subprocess.CompletedProcess(command, 0, '', '')

    def write_package(self, destination):
        for relative, contents in FIXTURE_FILES.items():
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(contents)

    def install(self, mutate=None, *, offline=True):
        def run(command, **kwargs):
            result = self.npm(command, **kwargs)
            if mutate:
                mutate(Path(command[command.index('--prefix') + 1]))
            return result
        with patch.object(installer.subprocess, 'run', side_effect=run) as npm:
            report = installer.install(self.root, offline=offline)
        return report, npm

    def assert_clean(self):
        self.assertFalse(list((self.root / 'node_modules').glob('.rifare-receipt-*')))

    def test_locked_install_promotes_only_jose_and_preserves_root_files(self):
        unrelated = self.root / 'node_modules/unrelated/keep.txt'
        unrelated.parent.mkdir(parents=True)
        unrelated.write_bytes(b'keep this package')
        report, npm = self.install()
        self.assertEqual(report['status'], 'installed')
        self.assertEqual(report['version'], '6.2.18')
        self.assertEqual(report['destination'], 'node_modules/jose')
        self.assertIn('--offline', npm.call_args.args[0])
        self.assertEqual(unrelated.read_bytes(), b'keep this package')
        self.assertEqual((self.root / 'node_modules/jose/LICENSE.md').read_bytes(), FIXTURE_LICENSE)
        self.assertEqual({p: (self.root / p).read_bytes() for p in self.source_paths}, self.original)
        self.assertFalse((self.root / WORKSPACE / 'node_modules').exists())
        self.assertFalse((self.root / 'node_modules/.package-lock.json').exists())
        self.assert_clean()

    def test_identical_repeat_install_is_idempotent(self):
        first, _ = self.install()
        package = self.root / 'node_modules/jose/package.json'
        inode = package.stat().st_ino
        second, npm = self.install(offline=False)
        self.assertEqual(second['status'], 'already_present')
        self.assertEqual(second['tree_sha256'], first['tree_sha256'])
        self.assertEqual(package.stat().st_ino, inode)
        self.assertNotIn('--offline', npm.call_args.args[0])
        self.assert_clean()

    def test_differing_or_empty_destination_is_never_replaced(self):
        destination = self.root / 'node_modules/jose'
        for populated in (False, True):
            with self.subTest(populated=populated):
                destination.mkdir(parents=True, exist_ok=True)
                if populated:
                    (destination / 'keep.txt').write_bytes(b'existing different package')
                with self.assertRaisesRegex(ValueError, 'existing JOSE differs'):
                    self.install()
                if populated:
                    self.assertEqual((destination / 'keep.txt').read_bytes(), b'existing different package')
                else:
                    self.assertEqual(list(destination.iterdir()), [])
                self.assert_clean()

    def test_nested_install_or_shadowing_is_rejected_before_npm(self):
        for relative in installer.NESTED_MODULES:
            for linked in (False, True):
                with self.subTest(path=relative, linked=linked):
                    destination = self.root / relative
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    if linked:
                        destination.symlink_to(self.root / 'absent', target_is_directory=True)
                    else:
                        destination.mkdir()
                    try:
                        with patch.object(installer.subprocess, 'run') as npm:
                            with self.assertRaisesRegex(ValueError, 'nested node_modules'):
                                installer.install(self.root)
                            npm.assert_not_called()
                    finally:
                        destination.unlink() if linked else destination.rmdir()

    def test_symlinked_modules_or_destination_and_non_directory_are_rejected(self):
        modules = self.root / 'node_modules'
        modules.symlink_to(self.root / 'absent', target_is_directory=True)
        with patch.object(installer.subprocess, 'run') as npm:
            with self.assertRaisesRegex(ValueError, 'real directory'):
                installer.install(self.root)
            modules.unlink()
            modules.mkdir()
            destination = modules / 'jose'
            destination.symlink_to(self.root / 'absent', target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'real directory'):
                installer.install(self.root)
            destination.unlink()
            destination.write_bytes(b'foreign file')
            with self.assertRaisesRegex(ValueError, 'real directory'):
                installer.install(self.root)
            self.assertEqual(destination.read_bytes(), b'foreign file')
            npm.assert_not_called()

    def test_reviewed_root_or_optional_manifest_drift_denies_before_npm(self):
        for relative in ('package.json', f'{WORKSPACE}/package-lock.json'):
            with self.subTest(path=relative), patch.object(installer.subprocess, 'run') as npm:
                (self.root / relative).write_bytes(self.original[relative] + b'\n')
                try:
                    with self.assertRaisesRegex(ValueError, 'manifest changed|changed command manifest'):
                        installer.install(self.root)
                    npm.assert_not_called()
                finally:
                    (self.root / relative).write_bytes(self.original[relative])

    def test_absent_optional_manifests_do_not_install_anything(self):
        for relative in distribution.RECEIPT_RUNTIME_MANIFESTS:
            (self.root / relative).unlink()
        with patch.object(installer.subprocess, 'run') as npm:
            with self.assertRaisesRegex(ValueError, 'receipt manifests are required'):
                installer.install(self.root)
            npm.assert_not_called()

    def test_unexpected_staged_graph_or_hidden_lock_denies_promotion(self):
        def extra(prefix):
            (prefix / 'node_modules/unreviewed').mkdir()
        def changed_lock(prefix):
            (prefix / 'node_modules/.package-lock.json').write_text('{"packages":{}}')
        for mutate in (extra, changed_lock):
            with self.subTest(mutation=mutate.__name__):
                with self.assertRaisesRegex(ValueError, 'staged dependency graph'):
                    self.install(mutate)
                self.assertFalse((self.root / 'node_modules/jose').exists())
                self.assert_clean()

    def test_changed_installed_manifest_or_notice_denies_promotion(self):
        for relative in ('package.json', 'LICENSE.md'):
            def mutate(prefix):
                (prefix / 'node_modules/jose' / relative).write_bytes(b'changed')
            with self.subTest(path=relative):
                with self.assertRaisesRegex(ValueError, 'installed package or notice changed'):
                    self.install(mutate)
                self.assertFalse((self.root / 'node_modules/jose').exists())
                self.assert_clean()

    def test_staged_symlink_hardlink_or_special_file_is_rejected(self):
        def symlink(prefix):
            (prefix / 'node_modules/jose/unsafe').symlink_to(self.root / 'absent')
        def hardlink(prefix):
            os.link(prefix / 'node_modules/jose/LICENSE.md', prefix / 'node_modules/jose/unsafe')
        def fifo(prefix):
            os.mkfifo(prefix / 'node_modules/jose/unsafe')
        for mutate in (symlink, hardlink, fifo):
            with self.subTest(mutation=mutate.__name__):
                with self.assertRaisesRegex(ValueError, 'unsafe installed entry'):
                    self.install(mutate)
                self.assertFalse((self.root / 'node_modules/jose').exists())
                self.assert_clean()

    def test_npm_failure_or_timeout_leaves_existing_packages_untouched(self):
        self.write_package(self.root / 'node_modules/jose')
        for failure in (subprocess.CalledProcessError(1, ['npm', 'ci']),
                        subprocess.TimeoutExpired(['npm', 'ci'], 60)):
            with self.subTest(failure=type(failure).__name__):
                with patch.object(installer.subprocess, 'run', side_effect=failure):
                    with self.assertRaisesRegex(ValueError, 'npm ci did not complete'):
                        installer.install(self.root)
                self.assertEqual((self.root / 'node_modules/jose/LICENSE.md').read_bytes(), FIXTURE_LICENSE)
                self.assert_clean()

    def test_npm_cannot_change_staged_manifest_bytes(self):
        def mutate(prefix):
            (prefix / 'package-lock.json').write_bytes(b'{}')
        with self.assertRaisesRegex(ValueError, 'staged manifest changed'):
            self.install(mutate)
        self.assertFalse((self.root / 'node_modules/jose').exists())
        self.assert_clean()

    def test_source_change_during_install_is_rechecked_before_promotion(self):
        def mutate(prefix):
            (self.root / WORKSPACE / 'package.json').write_bytes(b'{}')
        with self.assertRaisesRegex(ValueError, 'receipt runtime manifest changed'):
            self.install(mutate)
        self.assertFalse((self.root / 'node_modules/jose').exists())
        self.assert_clean()


if __name__ == '__main__':
    unittest.main()
