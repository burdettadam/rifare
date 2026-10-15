#!/usr/bin/env python3
"""Check starter layout and links; no provider calls or product-readiness claims."""
from __future__ import annotations

import argparse
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

EXCLUDED_PARTS = {'.git', '__pycache__', '.venv', 'node_modules', 'evidence', 'artifacts', 'validation', '.worktrees'}
REQUIRED_PATHS = (
    'README.md', 'AGENTS.md', 'GOVERNANCE.md', 'DEVELOPMENT.md', 'ARCHITECTURE.md', 'PLANS.md',
    'ROADMAP.md', 'project.json', 'LICENSE-STATUS.md', 'THIRD-PARTY-NOTICES.md',
    'WORKER-GOALS.html', 'WORKER-GOALS.md', 'goals/M00/M00-G01.md',
    'docs/FIRST-DISPATCH.md', 'docs/WORKFLOW-ADOPTION.md', 'docs/REGRESSION-STRATEGY.md',
    '.agents/skills/work-goal/SKILL.md', '.agents/skills/worktree-flow/SKILL.md',
    'planning/goals.json', 'planning/test-specifications.json', 'planning/capability-targets.json',
    'templates/GOAL-WORK-RECORD.md', 'work/README.md', '.gitignore', '.gitattributes',
)


def source_files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob('*') if p.is_file()
                  and not any(part in EXCLUDED_PARTS for part in p.relative_to(root).parts))


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []
        self.ids: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if values.get('id'):
            self.ids.add(values['id'])
        if tag == 'a' and values.get('href'):
            self.links.append(values['href'])


def validate_local_link(root: Path, source: Path, link: str) -> str | None:
    """Ignore external/example links; reject missing or escaping local targets."""
    parsed = urlsplit(link)
    if parsed.scheme or parsed.netloc or not parsed.path or '<' in link or '{' in link:
        return None
    target = (source.parent / unquote(parsed.path)).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError:
        return f'{source.relative_to(root)}: local link escapes repository: {link}'
    if not target.exists():
        return f'{source.relative_to(root)}: missing local link: {link}'
    return None


def check(root: Path) -> list[str]:
    root = root.resolve()
    errors: list[str] = []
    for rel in REQUIRED_PATHS:
        if not (root / rel).is_file():
            errors.append(f'Missing required source: {rel}')
    for path in source_files(root):
        rel = path.relative_to(root)
        if path.is_symlink():
            errors.append(f'Unexpected source symlink: {rel}')
        if path.suffix not in {'.json', '.md', '.html', '.py', '.toml', '.yml', '.yaml'}:
            continue
        try:
            text = path.read_text(encoding='utf-8')
        except (OSError, UnicodeError) as exc:
            errors.append(f'{rel}: unreadable UTF-8: {exc}')
            continue
        if '/' + 'mnt' + '/data/' in text:
            errors.append(f'{rel}: machine-specific mounted path')
        if path.suffix == '.json':
            try:
                json.loads(text)
            except ValueError as exc:
                errors.append(f'{rel}: invalid JSON: {exc}')
        links: list[str] = []
        if path.suffix == '.md':
            prose = re.sub(r'```.*?```', '', text, flags=re.S)
            links = re.findall(r'\[[^\]\n]+\]\(([^\s)]+)(?:\s+"[^"]*")?\)', prose)
        elif path.suffix == '.html':
            parser = LinkParser()
            parser.feed(text)
            links = parser.links
            for link in links:
                if link.startswith('#') and unquote(link[1:]) not in parser.ids:
                    errors.append(f'{rel}: missing in-page anchor {link}')
        for link in links:
            error = validate_local_link(root, path, link)
            if error:
                errors.append(error)
    try:
        metadata = json.loads((root / 'project.json').read_text(encoding='utf-8'))
        if metadata.get('name') != 'Rifare' or metadata.get('slug') != 'rifare':
            errors.append('Project identity must be Rifare / rifare')
        if metadata.get('stage') != 'planning_starter' or metadata.get('product_implemented') is not False:
            errors.append('This starter cannot claim product implementation')
        if metadata.get('product_tests_executed') != 0:
            errors.append('This starter cannot claim product tests executed')
        goals = json.loads((root / 'planning/goals.json').read_text(encoding='utf-8'))['goals']
        state = json.loads((root / 'planning/goal-state.json').read_text(encoding='utf-8'))['goals']
        if set(state) != {g['id'] for g in goals}:
            errors.append('Initial state snapshot must cover all goal IDs')
        if any(x.get('state') != 'not_started' or x.get('owner') is not None for x in state.values()):
            errors.append('Initial state snapshot cannot claim assignment or acceptance; use work records')
        queue = json.loads((root / 'planning/initial-ready-queue.json').read_text(encoding='utf-8'))
        if queue.get('can_begin_drafting') != ['M00-G01']:
            errors.append('Initial draft queue must start at M00-G01')
        caps = json.loads((root / 'planning/capability-targets.json').read_text(encoding='utf-8'))['capabilities']
        if len(caps) != 44 or len({c['id'] for c in caps}) != 44:
            errors.append('Expected 44 unique capability targets')
        if any(c.get('status') != 'proposed_not_implemented' for c in caps):
            errors.append('Capability targets cannot claim implementation')
    except (OSError, ValueError, KeyError, TypeError) as exc:
        errors.append(f'Starter metadata/state error: {exc}')
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    errors = check(args.root)
    print(json.dumps({'check': 'repository_starter_only', 'result': 'fail' if errors else 'pass',
                      'errors': errors, 'product_tests_executed': 0}, indent=2))
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
