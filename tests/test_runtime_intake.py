"""Preserve the exact dependency-free intake; do not grant a dependency exemption."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from check_distribution import validate_smoke_command_manifests

class RuntimeIntakeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        for path in ['package.json', 'package-lock.json', '.npmrc', '.node-version',
                     'tests/fixtures/development/command-manifests.v1.json']:
            (self.root / path).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / path, self.root / path)

    def tearDown(self):
        self.tmp.cleanup()

    def change(self, path, value, update_fingerprint=False):
        (self.root / path).write_text(json.dumps(value))
        if update_fingerprint:
            pin = self.root / 'tests/fixtures/development/command-manifests.v1.json'
            data = json.loads(pin.read_text())
            data['sha256'][path] = hashlib.sha256((self.root / path).read_bytes()).hexdigest()
            pin.write_text(json.dumps(data))

    def test_exact_zero_dependency_inputs_are_allowed(self):
        self.assertEqual(validate_smoke_command_manifests(self.root), {'package.json', 'package-lock.json'})

    def test_changed_script_is_not_silently_allowed(self):
        data = json.loads((self.root / 'package.json').read_text())
        data['scripts']['dev:smoke'] = 'unreviewed-command'
        self.change('package.json', data)
        with self.assertRaisesRegex(ValueError, 'changed command manifest'):
            validate_smoke_command_manifests(self.root)

    def test_dependency_cannot_be_added_even_by_rehashing_manifest(self):
        data = json.loads((self.root / 'package.json').read_text())
        data['dependencies'] = {'unknown-package': '1.0.0'}
        self.change('package.json', data, True)
        with self.assertRaisesRegex(ValueError, 'dependency graph intake not implemented'):
            validate_smoke_command_manifests(self.root)

    def test_optional_dependencies_cannot_bypass_intake(self):
        data = json.loads((self.root / 'package.json').read_text())
        data['optionalDependencies'] = {'unknown-package': '1.0.0'}
        self.change('package.json', data, True)
        with self.assertRaisesRegex(ValueError, 'dependency graph intake not implemented'):
            validate_smoke_command_manifests(self.root)

    def test_unknown_locked_package_requires_real_dependency_intake(self):
        data = json.loads((self.root / 'package-lock.json').read_text())
        data['packages']['node_modules/unknown'] = {'version': '1.0.0'}
        self.change('package-lock.json', data, True)
        with self.assertRaisesRegex(ValueError, 'nonempty or inconsistent lock'):
            validate_smoke_command_manifests(self.root)

    def test_private_source_flag_cannot_be_disabled(self):
        data = json.loads((self.root / 'package.json').read_text())
        data['private'] = False
        self.change('package.json', data, True)
        with self.assertRaisesRegex(ValueError, 'new package scope'):
            validate_smoke_command_manifests(self.root)

    def test_changed_node_pin_requires_review(self):
        (self.root / '.node-version').write_text('latest\n')
        with self.assertRaisesRegex(ValueError, 'changed command manifest'):
            validate_smoke_command_manifests(self.root)

    def test_another_manifest_cannot_be_self_listed(self):
        data = json.loads((self.root / 'tests/fixtures/development/command-manifests.v1.json').read_text())
        data['sha256']['nested/package.json'] = '0' * 64
        self.change('tests/fixtures/development/command-manifests.v1.json', data)
        with self.assertRaisesRegex(ValueError, 'unknown command manifest'):
            validate_smoke_command_manifests(self.root)
