#!/usr/bin/env python3
"""Run starter self-tests locally and reject empty or skipped test runs."""
from pathlib import Path
import sys
import unittest


def run() -> int:
    root = Path(__file__).resolve().parents[1]
    suite = unittest.defaultTestLoader.discover(str(root / 'tests'))
    expected = suite.countTestCases()
    if expected == 0:
        print('FAIL: no starter self-tests discovered', file=sys.stderr)
        return 1
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() and not result.skipped and result.testsRun == expected else 1


if __name__ == '__main__':
    raise SystemExit(run())
