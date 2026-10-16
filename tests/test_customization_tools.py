"""Maintain bounded native execution and strict results after the suite expands."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('rifare_runtime_checks', Path(__file__).resolve().parents[1] / 'tools/test_runtime.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class RuntimeSuiteBudgetTests(unittest.TestCase):
    def invoke(self, counts, code=0):
        result = subprocess.CompletedProcess(['node'], code, counts, '')
        with patch.object(MODULE.shutil, 'which', return_value='/fixture/node'), patch.object(MODULE.subprocess, 'run', return_value=result) as call, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            status = MODULE.run()
        return status, call

    def test_matches_existing_external_controller_bound(self):
        status, call = self.invoke('# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n')
        self.assertEqual(status, 0)
        self.assertEqual(call.call_args.kwargs['timeout'], 240)
        self.assertIn('--test-concurrency=1', call.call_args.args[0])

    def test_skips_still_rejected(self):
        status, _ = self.invoke('# tests 2\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n')
        self.assertEqual(status, 1)

    def test_zero_inventory_still_rejected(self):
        status, _ = self.invoke('# tests 0\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n')
        self.assertEqual(status, 1)

    def test_nonzero_exit_still_rejected(self):
        status, _ = self.invoke('# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n', 1)
        self.assertEqual(status, 1)
