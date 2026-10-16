#!/usr/bin/env python3
"""Offline component and source-artifact review. Never grant a license or publish."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
from typing import Any

POLICY_PATH = 'planning/licensing-policy.json'
INVENTORY_PATH = 'planning/component-inventory.json'
FIXED_POLICY = 'tests/fixtures/licensing/expected-policy.v1.json'
FIXED_OBLIGATIONS = 'tests/fixtures/licensing/retained-obligations.v1.json'
HEX64 = re.compile(r'[0-9a-f]{64}\Z')
HEX40 = re.compile(r'[0-9a-f]{40}\Z')
DEPENDENCY_NAMES = {
    'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock',
    'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'bun.lock', 'bun.lockb',
    'pyproject.toml', 'poetry.lock', 'uv.lock', 'pipfile', 'pipfile.lock',
    'setup.py', 'setup.cfg', 'cargo.toml', 'cargo.lock', 'go.mod', 'go.sum',
    'composer.json', 'composer.lock', 'gemfile', 'gemfile.lock', 'pom.xml',
    'build.gradle', 'build.gradle.kts', 'gradle.lockfile', 'packages.lock.json',
    'dockerfile', 'containerfile', 'compose.yml', 'compose.yaml',
    'docker-compose.yml', 'docker-compose.yaml', '.gitmodules',
}
PRIVATE_PARTS = {
    '.git', '.hg', '.svn', 'private', 'merchant-data', 'merchant-config',
    'merchant-profiles', 'customer-data', 'secrets', 'evidence', 'artifacts',
    'node_modules', '.venv', '__pycache__', '.worktrees', 'runtime', 'backups',
}
SECRET_SUFFIXES = {'.pem', '.key', '.p12', '.pfx', '.sqlite', '.sqlite3', '.db', '.dump'}
RESERVED = {'con', 'prn', 'aux', 'nul'} | {f'{n}{i}' for n in ('com', 'lpt') for i in range(1, 10)}
COMPONENT_KEYS = {
    'id': str, 'origin': str, 'license_declared': str, 'license_status': str,
    'disposition': str, 'copyright': str, 'provenance': str,
    'classification': str, 'files': list, 'notices': list,
}
FILE_KEYS = {'path': str, 'sha256': str, 'component_id': str, 'classification': str}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def shape(value: Any, fields: dict[str, type], label: str) -> dict[str, Any]:
    require(type(value) is dict and set(value) == set(fields), f'{label}: missing or unexpected fields')
    for key, kind in fields.items():
        require(type(value[key]) is kind, f'{label}.{key}: wrong type')
        if kind is str:
            require(bool(value[key].strip()), f'{label}.{key}: empty value')
    return value


def unique_strings(values: Any, label: str, *, allow_empty: bool = False) -> None:
    require(type(values) is list, f'{label}: expected list')
    require(allow_empty or bool(values), f'{label}: cannot be empty')
    require(all(type(v) is str and v.strip() for v in values), f'{label}: strings required')
    require(len(set(values)) == len(values), f'{label}: duplicate value')


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def decode_json(data: bytes) -> dict[str, Any]:
    def pairs(items):
        value = {}
        for key, item in items:
            require(key not in value, f'duplicate JSON key: {key}')
            value[key] = item
        return value

    def invalid_number(value):
        raise ValueError(f'non-finite JSON number: {value}')

    value = json.loads(data.decode('utf-8'), object_pairs_hook=pairs,
                       parse_constant=invalid_number)
    require(type(value) is dict, 'JSON document must be an object')
    return value


def read_json(path: Path) -> dict[str, Any]:
    return decode_json(path.read_bytes())


def safe_path(value: str) -> str:
    require(type(value) is str and bool(value), 'path: nonempty string required')
    require(not any(ord(c) < 32 or ord(c) == 127 for c in value), 'path: control character')
    require('\\' not in value and ':' not in value, 'path: nonportable separator or drive')
    path = PurePosixPath(value)
    require(not path.is_absolute() and value == path.as_posix(), 'path: must be normalized and relative')
    require(all(p not in {'.', '..', ''} for p in value.split('/')), 'path: traversal')
    require(all(not p.endswith((' ', '.')) and p.split('.')[0].casefold() not in RESERVED
                for p in path.parts), 'path: nonportable name')
    return value


def private_path(path: str) -> bool:
    parts = PurePosixPath(path).parts
    lowered = [p.casefold() for p in parts]
    base = lowered[-1]
    return (any(p in PRIVATE_PARTS for p in lowered)
            or (base.startswith('.env') and path != '.env.example')
            or base.endswith('.local.json') or base.endswith('.local.toml')
            or PurePosixPath(base).suffix in SECRET_SUFFIXES)


def dependency_path(path: str) -> bool:
    base = PurePosixPath(path).name.casefold()
    return (base in DEPENDENCY_NAMES or base.startswith(('dockerfile.', 'containerfile.'))
            or (base.startswith('requirements') and base.endswith(('.txt', '.in')))
            or base.endswith(('.csproj', '.fsproj', '.vbproj')))


def read_regular(root: Path, relative: str) -> bytes:
    """Reject links before reading. Use a stable owned snapshot, not a hostile live tree."""
    safe_path(relative)
    current = root
    require(root.is_dir() and not root.is_symlink(), 'root must be a real directory')
    for part in PurePosixPath(relative).parts:
        current = current / part
        info = current.lstat()
        require(not stat.S_ISLNK(info.st_mode), f'symlink is not reviewed: {relative}')
    require(stat.S_ISREG(info.st_mode), f'not a regular source file: {relative}')
    require(info.st_nlink == 1, f'hardlinked source file is not reviewed: {relative}')
    return current.read_bytes()


def git(root: Path, *args: str) -> str:
    result = subprocess.run(['git', '-c', 'core.fsmonitor=false', '-C', str(root), *args],
                            capture_output=True, text=True, timeout=30, check=False)
    require(result.returncode == 0, 'Git inspection failed; no partial inventory accepted')
    return result.stdout


def checkout_paths(root: Path) -> list[str]:
    top = Path(git(root, 'rev-parse', '--show-toplevel').strip()).resolve()
    require(top == root.resolve(), 'root must be the exact Git worktree root')
    raw = git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard')
    paths = sorted(set(p for p in raw.split('\0') if p))
    require(bool(paths), 'empty source inventory')
    for path in paths:
        safe_path(path)
        read_regular(root, path)
    require(len({p.casefold() for p in paths}) == len(paths), 'case-colliding source paths')
    return paths


def stage_paths(root: Path) -> list[str]:
    require(root.is_dir() and not root.is_symlink(), 'stage must be a real directory')
    paths = []
    for current, directories, filenames in os.walk(root, followlinks=False):
        for name in directories + filenames:
            path = Path(current) / name
            rel = safe_path(path.relative_to(root).as_posix())
            info = path.lstat()
            require(not stat.S_ISLNK(info.st_mode), f'stage symlink rejected: {rel}')
            require(not private_path(rel), f'private or runtime path rejected: {rel}')
            if stat.S_ISDIR(info.st_mode):
                continue
            read_regular(root, rel)
            paths.append(rel)
    require(bool(paths), 'empty artifact')
    require(len({p.casefold() for p in paths}) == len(paths), 'case-colliding artifact paths')
    return sorted(paths)


def compare_inventory(candidate: dict, baseline: dict) -> list[str]:
    """A diff is a review requirement, not a way to approve the candidate's own changes."""
    def components(document):
        require(type(document) is dict and type(document.get('components')) is list,
                'inventory diff requires component objects')
        indexed = {}
        for component in document['components']:
            shape(component, COMPONENT_KEYS, 'inventory diff component')
            require(component['id'] not in indexed, 'inventory diff has duplicate component identity')
            unique_strings(component['files'], 'inventory diff files')
            unique_strings(component['notices'], 'inventory diff notices', allow_empty=True)
            indexed[component['id']] = component
        return indexed

    changes = []
    old = components(baseline)
    new = components(candidate)
    for key in sorted(old.keys() | new.keys()):
        if key not in new:
            changes.append(f'review_required:removed_component:{key}')
        elif key not in old:
            changes.append(f'review_required:added_component:{key}')
        elif new[key] != old[key]:
            changes.append(f'review_required:changed_component:{key}')
    for key in sorted((candidate.keys() | baseline.keys()) - {'components'}):
        if candidate.get(key) != baseline.get(key):
            changes.append(f'review_required:changed_inventory_field:{key}')
    return changes


def validate_policy(policy: dict, frozen: dict) -> None:
    shape(policy, {'schema_version': str, 'id': str, 'revision': int, 'status': str,
                  'authority': dict, 'proposed_licenses': dict, 'release_requirements': list,
                  'contribution_proposal': dict, 'data_boundary': dict,
                  'public_examples': list, 'sources': list}, 'policy')
    require(policy == frozen, 'review_required:licensing_policy_changed')
    require(policy['status'] == 'proposed' and policy['revision'] == 1, 'unaccepted policy state')
    require(policy['authority'] == {
        'owner_decision': None, 'rights_holder': None, 'independent_reviews': [],
        'publication_authorized': False, 'contribution_intake_enabled': False,
    }, 'a candidate cannot grant license or publication authority')



def validate_smoke_command_manifests(root: Path) -> set[str]:
    """Permit only the explicitly pinned dependency-free diagnostic command surface."""
    retained = read_json(root / 'tests/fixtures/development/command-manifests.v1.json')
    shape(retained, {'schema_version': int, 'kind': str, 'profile': str,
                     'third_party_packages': list, 'sha256': dict}, 'smoke command intake')
    require(retained['schema_version'] == 1 and retained['kind'] == 'rifare-zero-dependency-smoke-commands'
            and retained['profile'] == 'smoke-sqlite' and retained['third_party_packages'] == [],
            'dependency intake required: unknown command profile')
    expected = {'package.json', 'package-lock.json', '.npmrc', '.node-version'}
    require(set(retained['sha256']) == expected, 'dependency intake required: unknown command manifest')
    for path, digest in retained['sha256'].items():
        require(type(digest) is str and bool(HEX64.fullmatch(digest))
                and sha256(read_regular(root, path)) == digest,
                f'dependency intake required: changed command manifest: {path}')
    package = read_json(root / 'package.json')
    require(set(package) == {'name','version','private','type','description','engines','scripts'}
            and package['name'] == 'rifare' and package['version'] == '0.0.0'
            and package['private'] is True and package['type'] == 'module',
            'dependency graph intake not implemented: new package scope')
    lock = read_json(root / 'package-lock.json')
    require(lock == {'name': 'rifare', 'version': '0.0.0', 'lockfileVersion': 3, 'requires': True,
                     'packages': {'': {'name': 'rifare', 'version': '0.0.0', 'engines': package['engines']}}},
            'dependency graph intake not implemented: nonempty or inconsistent lock')
    return {'package.json', 'package-lock.json'}

def validate_inventory(inventory: dict, paths: list[str], root: Path, policy: dict,
                       obligations: dict) -> dict[str, dict]:
    shape(inventory, {'schema_version': str, 'id': str, 'revision': int, 'status': str,
                      'components': list, 'planned_surfaces': list,
                      'external_requirements': list, 'dependency_inputs': list}, 'inventory')
    require(inventory['schema_version'] == '1.0' and inventory['id'] == 'rifare-source-inventory',
            'unknown inventory schema or identity')
    require(type(inventory['revision']) is int and inventory['revision'] >= 1, 'invalid inventory revision')
    require(inventory['status'] == 'proposed', 'inventory is not an acceptance decision')
    require(inventory['dependency_inputs'] == [], 'dependency graph intake not implemented at this checkpoint')
    reviewed_commands = validate_smoke_command_manifests(root)
    require(inventory['planned_surfaces'] == obligations['planned_surfaces'], 'planned surface coverage changed')
    require(inventory['external_requirements'] == obligations['external_requirements'],
            'review_required:external_requirements_changed')
    require(type(inventory['components']) is list and bool(inventory['components']), 'components cannot be empty')
    members: dict[str, dict] = {}
    components: dict[str, dict] = {}
    for comp in inventory['components']:
        shape(comp, COMPONENT_KEYS, 'component')
        require(comp['id'] not in components, f'duplicate component: {comp["id"]}')
        components[comp['id']] = comp
        unique_strings(comp['files'], f'{comp["id"]}.files')
        unique_strings(comp['notices'], f'{comp["id"]}.notices', allow_empty=True)
        require(comp['classification'] in {'project_source', 'synthetic_example'},
                f'private or unresolved classification: {comp["id"]}')
        if comp['origin'] == 'first_party_pending':
            require(comp['license_declared'] == 'NOASSERTION'
                    and comp['license_status'] == 'pending_owner_decision'
                    and comp['disposition'] == 'internal_review_only',
                    f'first-party grant not approved: {comp["id"]}')
            require(comp['copyright'] == 'NOASSERTION', 'unconfirmed rights holder')
        elif comp['origin'] == 'adapted_third_party':
            require(comp['license_declared'] == 'MIT'
                    and comp['license_status'] == 'upstream_identified_local_changes_pending'
                    and comp['disposition'] == 'retain_notice_internal_review_only',
                    f'unknown or unreviewed third-party license: {comp["id"]}')
            require(bool(comp['notices']), f'missing required notice declaration: {comp["id"]}')
        else:
            raise ValueError(f'unknown component origin: {comp["id"]}')
        for path in comp['files']:
            safe_path(path)
            require(path not in members, f'duplicate file ownership: {path}')
            require(not private_path(path), f'private or runtime path rejected: {path}')
            require(not dependency_path(path) or path in reviewed_commands, f'dependency intake required: {path}')
            members[path] = comp
        for notice in comp['notices']:
            safe_path(notice)
    require(set(members) == set(paths),
            f'file inventory mismatch; unreviewed={sorted(set(paths)-set(members))}; '
            f'missing={sorted(set(members)-set(paths))}')
    require(len({p.casefold() for p in members}) == len(members), 'case-colliding inventory paths')
    require(set(components) == set(obligations['components']), 'review_required:component set changed')
    for identity, retained in obligations['components'].items():
        current = {k: v for k, v in components[identity].items() if k != 'files'}
        require(current == retained, f'review_required:component obligations changed:{identity}')
    for path, digest in obligations['required_notice_sha256'].items():
        require(path in members, f'missing required notice: {path}')
        require(sha256(read_regular(root, path)) == digest, f'required notice changed: {path}')
    for comp in components.values():
        for notice in comp['notices']:
            require(notice in members and notice in obligations['required_notice_sha256'],
                    f'unretained required notice: {notice}')
    require(components['git-agent-adaptations']['files'] == obligations['upstream_files'],
            'review_required:upstream attribution remapped')
    examples = {x['path']: x['sha256'] for x in policy['public_examples']}
    require(len(examples) == len(policy['public_examples']), 'duplicate public example')
    for path, comp in members.items():
        if comp['classification'] == 'synthetic_example':
            require(path in examples, f'new merchant fixture needs synthetic-data review: {path}')
    require(set(examples) == {p for p, c in members.items() if c['classification'] == 'synthetic_example'},
            'synthetic-example scope cannot be relabeled as ordinary source')
    for path, digest in examples.items():
        require(sha256(read_regular(root, path)) == digest,
                f'synthetic example changed; privacy review required: {path}')
    for path in paths:
        require(not (PurePosixPath(path).parent == PurePosixPath('.')
                     and PurePosixPath(path).name.casefold() in {'license', 'license.txt', 'license.md', 'copying', 'copying.txt', 'copying.md'}),
                'owner decision pending: no root license grant may be installed')
    # The current workflow surface is deliberately small. Unknown forms need review.
    actual_actions = []
    for path in paths:
        if path.startswith('.github/workflows/') and path.endswith(('.yml', '.yaml')):
            text = read_regular(root, path).decode('utf-8')
            for match in re.finditer(r'^\s*(?:-\s*)?uses:\s*(.*?)\s*$', text, flags=re.M):
                value = match.group(1).split(' #', 1)[0].strip().strip('\"\'')
                actual_actions.append({'path': path, 'reference': value})
    require(sorted(actual_actions, key=lambda x: (x['path'], x['reference'])) == obligations['workflow_references'],
            'review_required:workflow dependency references changed')
    return members


def review_checkout(root: Path) -> dict[str, Any]:
    policy = read_json(root / POLICY_PATH)
    validate_policy(policy, read_json(root / FIXED_POLICY))
    inventory = read_json(root / INVENTORY_PATH)
    obligations = read_json(root / FIXED_OBLIGATIONS)
    paths = checkout_paths(root)
    members = validate_inventory(inventory, paths, root, policy, obligations)
    return {
        'check': 'licensing_inventory_only', 'result': 'pass',
        'files_reviewed': len(members), 'components_reviewed': len(inventory['components']),
        'observed_dependency_inputs': [], 'application_dependencies_present': False,
        'reviewed_zero_dependency_command_manifests': ['package.json', 'package-lock.json'],
        'target_stack_qualified': False,
        'license_dispositions': dict(Counter(c['disposition'] for c in inventory['components'])),
        'inventory_sha256': sha256(read_regular(root, INVENTORY_PATH)),
        'policy_sha256': sha256(read_regular(root, POLICY_PATH)),
        'publication_authorized': False, 'legal_clearance': False,
        'public_release_blockers': list(policy['release_requirements']),
    }


def build_manifest(root: Path) -> dict[str, Any]:
    review = review_checkout(root)
    require(not git(root, 'status', '--porcelain', '--untracked-files=all').strip(),
            'manifest requires a clean candidate; working-tree checks are exploratory')
    candidate = git(root, 'rev-parse', 'HEAD').strip()
    tree = git(root, 'rev-parse', 'HEAD^{tree}').strip()
    require(bool(HEX40.fullmatch(candidate)) and bool(HEX40.fullmatch(tree)), 'unsupported Git identity')
    inventory = read_json(root / INVENTORY_PATH)
    committed = {}
    for record in git(root, 'ls-tree', '-rz', '--full-tree', candidate).split('\0'):
        if not record:
            continue
        metadata, path = record.split('\t', 1)
        mode, kind, blob = metadata.split()
        require(mode in {'100644', '100755'} and kind == 'blob', 'unreviewed Git object type')
        require(path not in committed, 'duplicate Git tree path')
        committed[path] = blob
    require(set(committed) == {p for c in inventory['components'] for p in c['files']},
            'source inventory differs from committed tree')
    entries = []
    for component in inventory['components']:
        for path in component['files']:
            data = read_regular(root, path)
            blob = hashlib.sha1(b'blob ' + str(len(data)).encode('ascii') + b'\0' + data).hexdigest()
            require(blob == committed[path], f'working bytes differ from committed blob: {path}')
            entries.append({'path': path, 'sha256': sha256(data), 'component_id': component['id'],
                            'classification': component['classification']})
    require(not git(root, 'status', '--porcelain', '--untracked-files=all').strip()
            and git(root, 'rev-parse', 'HEAD').strip() == candidate, 'candidate changed during manifest creation')
    return {'schema_version': '1.0', 'kind': 'rifare-source-review-manifest',
            'candidate_commit': candidate, 'candidate_tree': tree,
            'inventory_sha256': review['inventory_sha256'], 'policy_sha256': review['policy_sha256'],
            'publication_authorized': False, 'files': sorted(entries, key=lambda x: x['path'])}


def load_pinned(path: Path, digest: str) -> dict[str, Any]:
    require(bool(HEX64.fullmatch(digest)), 'expected SHA-256 must be 64 lowercase hex characters')
    require(path.is_file() and not path.is_symlink(), 'pinned input must be a regular file')
    data = path.read_bytes()
    require(sha256(data) == digest, 'retained input hash mismatch')
    return decode_json(data)


def review_stage(root: Path, stage: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    review = review_checkout(root)
    shape(manifest, {'schema_version': str, 'kind': str, 'candidate_commit': str,
                     'candidate_tree': str, 'inventory_sha256': str, 'policy_sha256': str,
                     'publication_authorized': bool, 'files': list}, 'manifest')
    require(manifest['schema_version'] == '1.0' and manifest['kind'] == 'rifare-source-review-manifest',
            'unsupported artifact kind')
    require(manifest['publication_authorized'] is False, 'manifest cannot grant publication authority')
    require(bool(HEX40.fullmatch(manifest['candidate_commit']))
            and bool(HEX40.fullmatch(manifest['candidate_tree'])), 'invalid candidate identity')
    # Rebuild from the independent source checkout: a coherent forged manifest cannot
    # omit a notice, relabel a private profile or substitute different candidate bytes.
    require(manifest == build_manifest(root), 'artifact manifest differs from the source candidate')
    paths = stage_paths(stage)
    expected = {}
    for item in manifest['files']:
        shape(item, FILE_KEYS, 'manifest file')
        p = safe_path(item['path'])
        require(p not in expected and bool(HEX64.fullmatch(item['sha256'])), 'invalid or duplicate manifest file')
        expected[p] = item
    require(set(paths) == set(expected),
            f'artifact membership mismatch; extra={sorted(set(paths)-set(expected))}; '
            f'missing={sorted(set(expected)-set(paths))}')
    for path in paths:
        require(sha256(read_regular(stage, path)) == expected[path]['sha256'], f'artifact content mismatch: {path}')
    return {**review, 'check': 'source_artifact_review_only', 'candidate_commit': manifest['candidate_commit'],
            'candidate_tree': manifest['candidate_tree'], 'artifact_files_verified': len(paths),
            'scope': 'regular source files only; excludes Git history, binaries, containers and review evidence'}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--emit-manifest', action='store_true', help='Print a clean source-candidate manifest; does not package')
    parser.add_argument('--stage', type=Path)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--manifest-sha256')
    parser.add_argument('--baseline', type=Path, help='Independently retained prior component inventory')
    parser.add_argument('--baseline-sha256')
    parser.add_argument('--public-release', action='store_true', help='Evaluate release blockers; currently always blocks')
    args = parser.parse_args()
    try:
        require(not args.root.is_symlink(), 'root symlink rejected')
        root = args.root.resolve()
        require(bool(args.baseline) == bool(args.baseline_sha256), 'baseline and expected hash must be supplied together')
        require(not any((args.stage, args.manifest, args.manifest_sha256))
                or all((args.stage, args.manifest, args.manifest_sha256)), 'stage, manifest and expected hash must be supplied together')
        require(not (args.emit_manifest and (args.stage or args.public_release or args.baseline)), 'incompatible manifest flags')
        report = review_checkout(root)
        if args.baseline:
            previous = load_pinned(args.baseline, args.baseline_sha256)
            changes = compare_inventory(read_json(root / INVENTORY_PATH), previous)
            require(not changes, '; '.join(changes))
        if args.emit_manifest:
            report = build_manifest(root)
        elif args.stage:
            report = review_stage(root, args.stage, load_pinned(args.manifest, args.manifest_sha256))
        if args.public_release:
            report['result'] = 'blocked'
            report['check'] = 'public_release_preflight'
            print(json.dumps(report, indent=2, sort_keys=True))
            return 1
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0
    except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError, UnicodeError) as exc:
        print(json.dumps({'check': 'distribution_review', 'result': 'fail', 'error': str(exc),
                          'publication_authorized': False, 'legal_clearance': False}, indent=2))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
