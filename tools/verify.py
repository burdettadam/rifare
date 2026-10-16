#!/usr/bin/env python3
"""Execute offline starter checks, never commerce qualification or agent work."""
from pathlib import Path
import subprocess
import sys


def main() -> int:
    if sys.version_info < (3, 10):
        print('Python 3.10 or newer is required.', file=sys.stderr)
        return 2
    root = Path(__file__).resolve().parents[1]
    commands = [
        [sys.executable, 'tools/validate_plan.py', '--root', '.'],
        [sys.executable, 'tools/check_repository.py', '--root', '.'],
        [sys.executable, 'tools/check_generated.py', '--root', '.'],
        [sys.executable, 'tools/check_support_envelope.py', '--root', '.',
         '--scenarios', 'tests/fixtures/support-envelope/scenarios.json'],
        [sys.executable, 'tools/check_release_benchmark.py', '--root', '.'],
        [sys.executable, 'tools/run_tests.py'],
    ]
    for command in commands:
        print('\nRUN ' + ' '.join(command), flush=True)
        try:
            result = subprocess.run(command, cwd=root, timeout=120)
        except (OSError, subprocess.SubprocessError) as exc:
            print(f'FAIL: {exc}', file=sys.stderr)
            return 1
        if result.returncode:
            return result.returncode
    print('\nPASS: planning structure, document contracts, rendered views and helper self-tests. Commerce runtime qualification: not executed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
