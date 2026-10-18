"""Bounded development feedback; these checks do not accept a product goal."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import dev_tests as dev


class DevelopmentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Rifare test')
        self.git('config', 'user.email', 'test@rifare.invalid')
        self.put('README.md', 'base\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'base')

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], text=True).strip()

    def put(self, name, text=''):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def row(self, source, name='one'):
        return {'source': source, 'suite': 'runtime', 'runner_case_id': name}

    def config(self):
        return {'smoke': ['tests/smoke.test.mts'], 'automatic_exclude_globs': ['*browser*', '*catalog*'],
                'path_mappings': []}

    def test_changed_paths_include_index_worktree_untracked_and_since(self):
        base = self.git('rev-parse', 'HEAD')
        self.put('committed.mts')
        self.git('add', '.')
        self.git('commit', '-qm', 'second')
        self.put('staged.mts')
        self.git('add', 'staged.mts')
        self.put('README.md', 'modified\n')
        self.put('untracked.mts')
        self.assertEqual(dev.changed_paths(self.root), ['README.md', 'staged.mts', 'untracked.mts'])
        self.assertEqual(dev.changed_paths(self.root, base),
                         ['README.md', 'committed.mts', 'staged.mts', 'untracked.mts'])

    def test_reverse_imports_follow_helpers_and_deleted_dependencies(self):
        self.put('tests/helper.mts', "import { value } from '../packages/deleted.mts';")
        self.put('tests/feature.test.mts', "import './helper.mts'; test('one',()=>{});")
        rows = [self.row('tests/feature.test.mts')]
        plan = dev.select_plan(self.root, self.config(), rows, ['packages/deleted.mts'])
        self.assertEqual([r['source'] for r in plan['selected']], ['tests/feature.test.mts'])
        self.assertIn('dependency distance 2', plan['selected'][0]['reason'])
        (self.root / 'tests/feature.test.mts').unlink()
        with self.assertRaisesRegex(ValueError, 'missing registered test'):
            dev.select_plan(self.root, self.config(), rows, ['tests/feature.test.mts'])

    def test_budget_selects_whole_files_and_reports_deferred_scope(self):
        rows = []
        for name, count in [('a', 26), ('b', 40), ('c', 20)]:
            source = f'tests/{name}.test.mts'
            self.put(source, "import '../packages/money.mts';")
            rows.extend(self.row(source, f'{name}-{n}') for n in range(count))
        plan = dev.select_plan(self.root, self.config(), rows, ['packages/money.mts'])
        self.assertEqual([r['source'] for r in plan['selected']], ['tests/a.test.mts', 'tests/c.test.mts'])
        self.assertEqual(plan['planned_tests'], 46)
        self.assertEqual(plan['deferred'][0]['source'], 'tests/b.test.mts')
        self.assertIn('budget', plan['deferred'][0]['reason'])
        one = dev.select_plan(self.root, self.config(), rows, ['packages/money.mts'], max_files=1)
        self.assertEqual(len(one['selected']), 1)

    def test_fallback_is_explicit_and_expensive_tests_require_selection(self):
        for source in ['tests/smoke.test.mts', 'tests/catalog.test.mts']:
            self.put(source, "test('one',()=>{});")
        rows = [self.row('tests/smoke.test.mts'), self.row('tests/catalog.test.mts')]
        for paths in [[], ['docs/readme.md'], ['tests/catalog.test.mts']]:
            plan = dev.select_plan(self.root, self.config(), rows, paths)
            self.assertEqual([r['source'] for r in plan['selected']], ['tests/smoke.test.mts'])
            self.assertTrue(plan['fallback_reason'])
        explicit = dev.select_plan(self.root, self.config(), rows, [], files=['tests/catalog.test.mts'])
        self.assertEqual(explicit['selected'][0]['source'], 'tests/catalog.test.mts')
        with self.assertRaisesRegex(ValueError, 'budget'):
            dev.select_plan(self.root, self.config(), rows, [], files=['tests/catalog.test.mts'], max_tests=0)
        real = json.loads((ROOT / 'planning/development-test-profiles.json').read_text())
        registry = json.loads((ROOT / 'planning/regression-registry.json').read_text())['tests']
        smoke = dev.select_plan(ROOT, real, registry, [], profile='smoke')
        self.assertEqual(smoke['planned_tests'], 54)
        self.assertEqual([r['source'] for r in smoke['selected']], real['smoke'])

    def test_native_results_require_expected_unique_complete_passing_ids(self):
        native = self.root / 'native.xml'
        native.write_text('<testsuite><testcase name="CASE-1 description"/></testsuite>')
        result = dev.read_native(native, 'runtime', ['CASE-1'])
        self.assertEqual(result['ids'], ['CASE-1'])
        for xml in ['<testsuite/>',
                    '<testsuite><testcase name="other"/></testsuite>',
                    '<testsuite><testcase name="CASE-1"/><testcase name="CASE-1"/></testsuite>',
                    '<testsuite><testcase name="CASE-1"><skipped/></testcase></testsuite>',
                    '<testsuite><testcase name="CASE-1"><failure/></testcase></testsuite>',
                    '<testsuite><testcase name="CASE-1" status="cancelled"/></testsuite>',
                    '<testsuite tests="2"><testcase name="CASE-1"/></testsuite>',
                    '<testsuite failures="1"><testcase name="CASE-1"/></testsuite>',
                    '<testsuites><testcase name="CASE-1"/><!-- tests 2 --></testsuites>']:
            native.write_text(xml)
            with self.assertRaises(ValueError):
                dev.read_native(native, 'runtime', ['CASE-1'])

    def test_native_failure_and_total_deadline_propagate_without_retry(self):
        result = dev.run_process([sys.executable, '-c', 'raise SystemExit(7)'], self.root,
                                 self.root / 'failure.log', time.monotonic() + 2)
        self.assertEqual(result['returncode'], 7)
        self.assertFalse(result['timed_out'])
        marker = self.root / 'child-completed'
        child = 'import pathlib,time;time.sleep(0.6);pathlib.Path(' + repr(str(marker)) + ').touch()'
        parent = 'import subprocess,sys,time;subprocess.Popen([sys.executable,"-c",' + repr(child) + ']);time.sleep(5)'
        started = time.monotonic()
        result = dev.run_process([sys.executable, '-c', parent], self.root,
                                 self.root / 'timeout.log', started + 0.15)
        self.assertTrue(result['timed_out'])
        self.assertNotEqual(result['returncode'], 0)
        self.assertLess(time.monotonic() - started, 2)
        time.sleep(0.7)
        self.assertFalse(marker.exists(), 'timed out descendant must not keep running')
        existing = self.root / 'existing-evidence'
        existing.mkdir()
        (existing / 'report.json').write_text('retained report')
        refusal = subprocess.run([sys.executable, str(ROOT / 'tools/dev_tests.py'), '--root', str(ROOT),
                                  '--profile', 'smoke', '--output', str(existing)], capture_output=True, timeout=5)
        self.assertNotEqual(refusal.returncode, 0)
        self.assertEqual((existing / 'report.json').read_text(), 'retained report')


if __name__ == '__main__':
    unittest.main()
