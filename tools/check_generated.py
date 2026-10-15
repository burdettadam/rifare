#!/usr/bin/env python3
"""Render into a temporary directory and detect stale planning views without editing source."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

INPUTS = ('goals.json', 'test-specifications.json', 'milestones.json',
          'requirement-coverage.json', 'invariants.json')


def check(root: Path) -> list[str]:
    root = root.resolve()
    with tempfile.TemporaryDirectory(prefix='rifare-views-') as temporary:
        target = Path(temporary)
        (target / 'planning').mkdir()
        (target / 'tools').mkdir()
        for name in INPUTS:
            shutil.copyfile(root / 'planning' / name, target / 'planning' / name)
        shutil.copyfile(root / 'tools/render_plan.py', target / 'tools/render_plan.py')
        run = subprocess.run([sys.executable, str(target / 'tools/render_plan.py'), '--root', str(target)],
                             capture_output=True, text=True, encoding='utf-8', timeout=60)
        if run.returncode:
            return ['Render failed: ' + run.stderr.strip()]
        relative = [p.relative_to(target) for p in target.rglob('*') if p.is_file()
                    and p.relative_to(target).as_posix() not in
                    {f'planning/{name}' for name in INPUTS} | {'tools/render_plan.py'}]
        errors = []
        for rel in sorted(relative):
            actual = root / rel
            if not actual.is_file():
                errors.append(f'Missing generated view: {rel.as_posix()}')
            elif actual.read_bytes() != (target / rel).read_bytes():
                errors.append(f'Stale generated view: {rel.as_posix()}')
        for directory in ('goals', 'milestones'):
            expected = {p for p in relative if p.parts[0] == directory}
            observed = {p.relative_to(root) for p in (root / directory).rglob('*.md')}
            errors.extend(f'Orphan generated view: {p.as_posix()}' for p in sorted(observed - expected))
        return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    try:
        errors = check(args.root)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        errors = [str(exc)]
    print(json.dumps({'check': 'generated_views_only', 'result': 'fail' if errors else 'pass', 'errors': errors}, indent=2))
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
