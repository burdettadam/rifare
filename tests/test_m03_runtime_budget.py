"""Explicit cumulative budgets preserve the standalone execution contract."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('rifare_cumulative_budget', ROOT / 'tools/test_runtime.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
GREEN = '# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'


class CumulativeBudgetTests(unittest.TestCase):
    def invoke(self, budget=480, text=GREEN, code=0):
        outcome = subprocess.CompletedProcess(['node'], code, text, '')
        with patch.object(MODULE.shutil, 'which', return_value='/fixture/node'), patch.object(MODULE.subprocess, 'run', return_value=outcome) as call, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            status = MODULE.run(budget)
        return status, call

    def test_explicit_extension_runs_the_entire_discovered_inventory(self):
        status, call = self.invoke()
        self.assertEqual(status, 0)
        self.assertEqual(call.call_args.kwargs['timeout'], 480)
        command = call.call_args.args[0]
        self.assertIn('--test-concurrency=1', command)
        expected = sorted(str(p.relative_to(ROOT)) for p in (ROOT / 'tests/development').glob('*.test.mts'))
        self.assertGreater(len(expected), 0)
        self.assertEqual(command[4:], expected)

    def test_original_standalone_default_remains_240(self):
        status, call = self.invoke(240)
        self.assertEqual(status, 0)
        self.assertEqual(call.call_args.kwargs['timeout'], 240)

    def test_arbitrary_or_unbounded_budget_is_rejected_before_spawn(self):
        for invalid in (0, -1, 481, 999999, True, 480.0, '480', None):
            with self.subTest(budget=invalid):
                status, call = self.invoke(invalid)
                self.assertEqual(status, 2)
                call.assert_not_called()

    def test_extended_budget_does_not_allow_skips(self):
        status, _ = self.invoke(text=GREEN.replace('# pass 2', '# pass 1').replace('# skipped 0', '# skipped 1'))
        self.assertEqual(status, 1)

    def test_extended_budget_does_not_allow_empty_or_failing_runs(self):
        for text, code in ((GREEN.replace('# tests 2', '# tests 0').replace('# pass 2', '# pass 0'), 0), (GREEN, 1)):
            status, _ = self.invoke(text=text, code=code)
            self.assertEqual(status, 1)

    def test_timeout_is_not_retried_or_reported_green(self):
        with patch.object(MODULE.shutil, 'which', return_value='/fixture/node'), patch.object(MODULE.subprocess, 'run', side_effect=subprocess.TimeoutExpired(['node'], 480)) as call:
            with self.assertRaises(subprocess.TimeoutExpired):
                MODULE.run(480)
        self.assertEqual(call.call_count, 1)
