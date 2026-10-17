#!/usr/bin/env python3
"""Execute offline starter checks, never commerce qualification or agent work."""
import argparse
from pathlib import Path
import subprocess
import sys


def main() -> int:
    if sys.version_info < (3, 10):
        print('Python 3.10 or newer is required.', file=sys.stderr)
        return 2
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', action='store_true', help='also run native synthetic runtime cases; not target-stack qualification')
    parser.add_argument('--harness', action='store_true', help='also run diagnostic unit/SQLite/browser-component tests; requires host browser tooling')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    commands = [
        [sys.executable, 'tools/validate_plan.py', '--root', '.'],
        [sys.executable, 'tools/check_repository.py', '--root', '.'],
        [sys.executable, 'tools/check_generated.py', '--root', '.'],
        [sys.executable, 'tools/check_support_envelope.py', '--root', '.',
         '--scenarios', 'tests/fixtures/support-envelope/scenarios.json'],
        [sys.executable, 'tools/check_release_benchmark.py', '--root', '.'],
        [sys.executable, 'tools/check_distribution.py', '--root', '.'],
        [sys.executable, 'tools/check_workflow.py', '--root', '.'],
        [sys.executable, 'tools/run_tests.py'],
    ]
    if args.runtime:
        commands.append([sys.executable, 'tools/test_runtime.py'])
    if args.harness:
        commands.append([sys.executable, 'tools/test_harness.py', '--layer', 'all'])
    for command in commands:
        print('\nRUN ' + ' '.join(command), flush=True)
        try:
            result = subprocess.run(command, cwd=root, timeout=600)
        except (OSError, subprocess.SubprocessError) as exc:
            print(f'FAIL: {exc}', file=sys.stderr)
            return 1
        if result.returncode:
            return result.returncode
    print('\nPASS: planning structure, document contracts, rendered views and helper self-tests. Target-stack/commerce qualification: not executed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
