"""Bound ADR-0068's optional runtime intake without widening the root profile."""
from __future__ import annotations

from contextlib import contextmanager
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

WORKSPACE = 'packages/adapters/delegated-receipts'
PACKAGE = f'{WORKSPACE}/package.json'
LOCK = f'{WORKSPACE}/package-lock.json'
MANIFESTS = {PACKAGE, LOCK}


class ReceiptDependencyIntakeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='rifare-receipt-intake-')
        self.root = Path(self.tmp.name)
        for relative in MANIFESTS:
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, target)

    def tearDown(self):
        self.tmp.cleanup()

    def validate(self):
        return distribution.validate_optional_receipt_runtime(self.root)

    @contextmanager
    def revised(self, relative, mutate):
        """A new pin alone must not turn an unsupported graph into an intake."""
        path = self.root / relative
        original = path.read_bytes()
        value = json.loads(original)
        mutate(value)
        path.write_text(json.dumps(value), encoding='utf-8')
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        try:
            with patch.dict(distribution.RECEIPT_RUNTIME_MANIFESTS, {relative: digest}):
                yield
        finally:
            path.write_bytes(original)

    def inventory_with(self, added_paths):
        inventory = distribution.read_json(ROOT / 'planning/component-inventory.json')
        component = next(c for c in inventory['components'] if c['id'] == 'rifare-project-material')
        retained = {p for c in inventory['components'] for p in c['files']}
        component['files'].extend(p for p in added_paths if p not in retained)
        paths = sorted(p for c in inventory['components'] for p in c['files'])
        policy = distribution.read_json(ROOT / 'planning/licensing-policy.json')
        obligations = distribution.read_json(ROOT / 'tests/fixtures/licensing/retained-obligations.v1.json')
        return inventory, paths, policy, obligations

    def test_assigned_runtime_inputs_are_allowed(self):
        inventory, paths, policy, obligations = self.inventory_with(sorted(MANIFESTS))
        members = distribution.validate_inventory(inventory, paths, ROOT, policy, obligations)
        self.assertTrue(MANIFESTS.issubset(members))

    def test_exact_pair_is_the_only_new_dependency_allowlist(self):
        self.assertEqual(self.validate(), MANIFESTS)

    def test_absent_optional_workspace_is_allowed(self):
        for relative in MANIFESTS:
            (self.root / relative).unlink()
        self.assertEqual(self.validate(), set())

    def test_partial_pair_is_rejected(self):
        (self.root / LOCK).unlink()
        with self.assertRaisesRegex(ValueError, 'both manifests are required'):
            self.validate()

    def test_byte_drift_requires_review(self):
        with (self.root / PACKAGE).open('a', encoding='utf-8') as stream:
            stream.write('\n')
        with self.assertRaisesRegex(ValueError, 'receipt runtime manifest changed'):
            self.validate()

    def test_version_range_is_rejected_even_with_a_new_pin(self):
        with self.revised(PACKAGE, lambda d: d['dependencies'].update(jose='^6.2.18')):
            with self.assertRaisesRegex(ValueError, 'unexpected workspace manifest'):
                self.validate()

    def test_additional_dependency_is_rejected_even_with_a_new_pin(self):
        with self.revised(PACKAGE, lambda d: d['dependencies'].update(unreviewed='1.0.0')):
            with self.assertRaisesRegex(ValueError, 'unexpected workspace manifest'):
                self.validate()

    def test_optional_dependencies_and_hooks_are_rejected_even_with_new_pins(self):
        for field, value in [
            ('optionalDependencies', {'unreviewed': '1.0.0'}),
            ('peerDependencies', {'unreviewed': '1.0.0'}),
            ('scripts', {'postinstall': 'unreviewed-command'}),
        ]:
            with self.subTest(field=field), self.revised(PACKAGE, lambda d: d.update({field: value})):
                with self.assertRaisesRegex(ValueError, 'unexpected workspace manifest'):
                    self.validate()

    def test_extra_locked_package_is_rejected_even_with_a_new_pin(self):
        def mutate(d):
            d['packages']['node_modules/unreviewed'] = {'version': '1.0.0', 'license': 'MIT'}
        with self.revised(LOCK, mutate):
            with self.assertRaisesRegex(ValueError, 'dependency graph or provenance changed'):
                self.validate()

    def test_lock_origin_integrity_license_and_hooks_cannot_be_replaced(self):
        changes = [
            ('resolved', 'https://example.invalid/jose.tgz'),
            ('integrity', 'sha512-' + 'A' * 88),
            ('license', 'NOASSERTION'),
            ('hasInstallScript', True),
            ('link', True),
        ]
        for field, value in changes:
            def mutate(d):
                d['packages']['node_modules/jose'][field] = value
            with self.subTest(field=field), self.revised(LOCK, mutate):
                with self.assertRaisesRegex(ValueError, 'dependency graph or provenance changed'):
                    self.validate()

    def test_inconsistent_root_lock_is_rejected_even_with_a_new_pin(self):
        def mutate(d):
            d['packages']['']['dependencies']['jose'] = '6.2.17'
        with self.revised(LOCK, mutate):
            with self.assertRaisesRegex(ValueError, 'dependency graph or provenance changed'):
                self.validate()

    def test_unknown_manifest_remains_outside_the_allowlist(self):
        unknown = 'unreviewed/package.json'
        inventory, paths, policy, obligations = self.inventory_with([unknown])
        with self.assertRaisesRegex(ValueError, 'dependency intake required: unreviewed/package.json'):
            distribution.validate_inventory(inventory, paths, ROOT, policy, obligations)

    def test_observation_reports_optional_runtime_dependency_presence(self):
        report = distribution.receipt_runtime_observation(self.root)
        self.assertTrue(report['application_dependencies_present'])
        self.assertEqual(report['optional_runtime_dependency_inputs'], sorted(MANIFESTS))
        self.assertEqual([p['name'] for p in report['optional_runtime_packages']], ['jose'])
        self.assertFalse(report['optional_runtime_packages'][0]['bundled_in_source'])

    def test_absent_runtime_observation_does_not_claim_installed_packages(self):
        for relative in MANIFESTS:
            (self.root / relative).unlink()
        report = distribution.receipt_runtime_observation(self.root)
        self.assertFalse(report['application_dependencies_present'])
        self.assertEqual(report['optional_runtime_dependency_inputs'], [])
        self.assertEqual(report['optional_runtime_packages'], [])


if __name__ == '__main__':
    unittest.main()
