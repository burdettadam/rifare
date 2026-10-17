#!/usr/bin/env python3
"""Run actual native smoke tests and reject incomplete TAP runs."""
import argparse
from pathlib import Path
import re
import shutil
import subprocess
import sys


def run(budget_seconds: int = 240) -> int:
    # Keep the historical standalone bound; cumulative verification opts in.
    if type(budget_seconds) is not int or budget_seconds not in (240, 480):
        print('FAIL: runtime budget must be 240 or 480 seconds.', file=sys.stderr)
        return 2
    root = Path(__file__).resolve().parents[1]
    node = shutil.which('node')
    if not node:
        print('BLOCKED: Node is required for runtime smoke verification.', file=sys.stderr)
        return 2
    tests = sorted(str(p.relative_to(root)) for p in (root / 'tests/development').glob('*.test.mts'))
    if not tests:
        print('FAIL: no runtime smoke tests discovered.', file=sys.stderr)
        return 1
    command = [node, '--experimental-strip-types', '--test', '--test-concurrency=1', *tests]
    result = subprocess.run(command, cwd=root, text=True, capture_output=True, timeout=budget_seconds)
    print(result.stdout, end='')
    print(result.stderr, end='', file=sys.stderr)
    counts = {key: int(value) for key, value in re.findall(
        r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$', result.stdout, re.M)}
    ok = (result.returncode == 0 and set(counts) == {'tests','pass','fail','cancelled','skipped','todo'}
          and counts['tests'] > 0 and counts['pass'] == counts['tests']
          and all(counts[k] == 0 for k in ('fail','cancelled','skipped','todo')))
    print('PASS: smoke profile only; target stack remains unqualified.' if ok else 'FAIL: incomplete runtime evidence.')
    return 0 if ok else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--budget-seconds', type=int, choices=(240, 480), default=240,
                        help='native process budget; cumulative verification explicitly uses 480')
    raise SystemExit(run(parser.parse_args().budget_seconds))
