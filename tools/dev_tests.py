#!/usr/bin/env python3
"""Small, explicit development feedback; never a full gate or acceptance result."""
from __future__ import annotations

import argparse
import ast
from collections import Counter, defaultdict, deque
from contextlib import redirect_stdout
from datetime import datetime, timezone
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import posixpath
import re
import shutil
import signal
import subprocess
import sys
import time
import unittest
import uuid
import xml.etree.ElementTree as ET


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], timeout=10).decode('utf-8', 'surrogateescape')


def changed_paths(root, since=None):
    paths = set(git(root, 'diff', 'HEAD', '--name-only', '--no-renames', '-z').split('\0'))
    paths.update(git(root, 'ls-files', '--others', '--exclude-standard', '-z').split('\0'))
    if since:
        base = git(root, 'merge-base', since, 'HEAD').strip()
        paths.update(git(root, 'diff', base, 'HEAD', '--name-only', '--no-renames', '-z').split('\0'))
    return sorted(paths - {''})


def source_paths(root):
    return sorted(set(git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0')) - {''})


def relative_path(root, value):
    path = Path(value)
    if path.is_absolute():
        path = path.resolve().relative_to(root.resolve())
    name = posixpath.normpath(path.as_posix())
    if name == '..' or name.startswith('../') or name.startswith('-'):
        raise ValueError(f'path must be inside the repository: {value}')
    return name


def dependencies(source, text, known):
    """Static local imports and literal fixture URLs, including deleted targets."""
    parent = posixpath.dirname(source)
    if source.endswith(('.mts', '.ts', '.mjs', '.js', '.tsx', '.jsx')):
        specs = re.findall(r'''(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\bnew\s+URL\s*\(\s*)["'](\.[^"']+)["']''', text)
        for spec in specs:
            target = posixpath.normpath(posixpath.join(parent, spec))
            variants = [target, target + '.mts', target + '.ts', target + '.mjs', target + '.js', target + '/index.mts']
            if target.endswith(('.js', '.mjs')):
                variants += [target.rsplit('.', 1)[0] + ext for ext in ('.mts', '.ts')]
            yield next((v for v in variants if v in known), target)
    elif source.endswith('.py'):
        try:
            tree = ast.parse(text)
        except SyntaxError:
            return  # The selected native runner still reports a broken test module.
        for node in ast.walk(tree):
            modules = []
            if isinstance(node, ast.Import):
                modules = [(alias.name, 0) for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    modules = [(node.module, node.level)]
                else:
                    modules = [(alias.name, node.level) for alias in node.names]
            for module, level in modules:
                bases = [parent, 'tools', 'tests', ''] if not level else [posixpath.normpath(posixpath.join(parent, *(['..'] * (level - 1))))]
                for base in bases:
                    stem = posixpath.join(base, module.replace('.', '/'))
                    for target in (stem + '.py', stem + '/__init__.py'):
                        if target in known:
                            yield target


def dependency_distances(root, changed, known):
    reverse = defaultdict(set)
    for source in sorted(known):
        path = root / source
        if path.is_file() and path.suffix in ('.mts', '.ts', '.js', '.mjs', '.tsx', '.jsx', '.py'):
            for dep in dependencies(source, path.read_text(encoding='utf-8'), known | set(changed)):
                reverse[dep].add(source)
    distances, origins = {}, defaultdict(set)
    for origin in changed:
        visited = {origin: 0}
        queue = deque([origin])
        while queue:
            dep = queue.popleft()
            distance = visited[dep]
            distances[dep] = min(distances.get(dep, distance), distance)
            origins[dep].add(origin)
            for source in sorted(reverse[dep]):
                if source not in visited:
                    visited[source] = distance + 1
                    queue.append(source)
    return distances, origins


def test_source(source):
    return source.endswith(('.test.mts', '.test.ts', '.test.mjs', '.test.js')) or (
        source.startswith('tests/') and Path(source).name.startswith('test_') and source.endswith('.py'))


def estimated_tests(root, source, rows):
    text = (root / source).read_text(encoding='utf-8')
    try:
        if source.endswith('.py'):
            literal = sum(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name.startswith('test_')
                          for n in ast.walk(ast.parse(text)))
        else:
            literal = len(re.findall(r'\b(?:test|it)\s*\(', text))
    except SyntaxError:
        literal = 1
    return max(len(rows), literal, 1)


def select_plan(root, config, registry, changed, *, profile='changed', files=None, max_tests=60, max_files=4):
    by_source = defaultdict(list)
    for row in registry:
        by_source[row['source']].append(row)
    known = set(source_paths(root)) | set(by_source)
    candidates = set(by_source) | {p for p in known if test_source(p)}
    changed = sorted({relative_path(root, p) for p in changed})
    for source in set(changed) & set(by_source):
        if not (root / source).is_file():
            raise ValueError(f'missing registered test: {source}; restore or inspect it explicitly')
    explicit = files is not None or profile == 'smoke'
    reasons, unmapped = {}, []
    if explicit:
        requested = config['smoke'] if profile == 'smoke' else files
        for i, value in enumerate(requested):
            source = relative_path(root, value)
            if source not in candidates:
                raise ValueError(f'not a native test file: {source}')
            reasons[source] = (i, 'explicit smoke' if profile == 'smoke' else 'explicit test file')
    else:
        distances, origins = dependency_distances(root, changed, known)
        graph_matches = set()
        for source in candidates:
            if source in distances:
                distance = distances[source]
                reasons[source] = (distance, 'changed test file' if distance == 0 else f'dependency distance {distance}')
                graph_matches.update(origins[source])
        for source in changed:
            matched = source in graph_matches
            for mapping in config.get('path_mappings', []):
                if any(fnmatch.fnmatchcase(source, glob) for glob in mapping['paths']):
                    matched = True
                    for target in mapping['tests']:
                        if target not in candidates:
                            raise ValueError(f'configured test file is not registered or discoverable: {target}')
                        reasons.setdefault(target, (100, f'path mapping: {source}'))
            stem = Path(source).stem.replace('_', '-').removesuffix('.test')
            if len(stem) > 2:
                for target in candidates:
                    target_stem = Path(target).stem.replace('_', '-').removeprefix('test-').removesuffix('.test')
                    if stem == target_stem:
                        matched = True
                        reasons.setdefault(target, (50, f'file name: {source}'))
            if not matched:
                unmapped.append(source)
    selected, deferred, total = [], [], 0
    for source in sorted(reasons, key=lambda p: (reasons[p][0], p)):
        if not (root / source).is_file():
            raise ValueError(f'missing registered test: {source}')
        if not explicit and any(fnmatch.fnmatchcase(source, pattern) for pattern in config['automatic_exclude_globs']):
            deferred.append({'source': source, 'reason': 'expensive browser or nested suite; select explicitly'})
            continue
        suites = {r['suite'] for r in by_source[source]}
        suite = next(iter(suites), 'python' if source.endswith('.py') else 'runtime')
        if len(suites) > 1 or suite not in ('python', 'runtime', 'unit', 'database'):
            if explicit:
                raise ValueError(f'{source} requires its existing explicit harness command')
            deferred.append({'source': source, 'reason': 'requires explicit harness command'})
            continue
        count = estimated_tests(root, source, by_source[source])
        if total + count > max_tests or len(selected) >= max_files:
            if explicit:
                raise ValueError(f'explicit selection exceeds budget ({max_tests} cases / {max_files} files); narrow it or set explicit limits')
            deferred.append({'source': source, 'reason': f'whole-file budget: {count} estimated cases'})
            continue
        selected.append({'source': source, 'suite': suite, 'estimated_tests': count,
                         'expected_ids': [r['runner_case_id'] for r in by_source[source]],
                         'reason': reasons[source][1]})
        total += count
    fallback = None
    if not selected and not explicit:
        fallback = 'clean checkout' if not changed else 'no eligible affected file fits the development budget'
        smoke = select_plan(root, config, registry, changed, profile='smoke', max_tests=max_tests, max_files=max_files)
        selected, total = smoke['selected'], smoke['planned_tests']
    if not selected:
        raise ValueError('empty selection; no passing result can be produced')
    return {'profile': profile, 'changed_paths': changed, 'selected': selected, 'planned_tests': total,
            'deferred': deferred, 'unmapped_paths': unmapped, 'fallback_reason': fallback,
            'max_tests': max_tests, 'max_files': max_files, 'full_regression': False, 'goal_accepted': False}


def read_native(path, suite, expected_ids, *, source=None):
    root = ET.parse(path, parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True))).getroot()
    for node in root.iter():
        if node.tag in ('testsuite', 'testsuites'):
            for field in ('failures', 'errors', 'skipped', 'cancelled', 'todo', 'disabled'):
                if field in node.attrib and int(node.attrib[field]) != 0:
                    raise ValueError(f'native suite reports {field}: {node.attrib[field]}')
            if 'tests' in node.attrib and int(node.attrib['tests']) != len(list(node.iter('testcase'))):
                raise ValueError('native suite declared count does not match its testcases')
    ids = []
    for case in root.iter('testcase'):
        name = case.get('name', '').strip()
        if suite != 'python' and source:
            reported = posixpath.normpath(name.replace('\\', '/'))
            selected = posixpath.normpath(str(source).replace('\\', '/'))
            if reported in (selected, posixpath.basename(selected)) or reported.endswith('/' + selected):
                raise ValueError(f'native Node report contains a file wrapper instead of test IDs: {name}')
        name = name.split()[0] if suite != 'python' and name else name
        if not name or len(case) or case.get('status', 'passed') not in ('passed', 'run'):
            raise ValueError(f'native result is failed, skipped, cancelled or incomplete: {name or "unnamed"}')
        ids.append(name)
    duplicates = [name for name, count in Counter(ids).items() if count != 1]
    missing = sorted(set(expected_ids) - set(ids))
    if not ids or duplicates or missing:
        raise ValueError(f'native IDs invalid: count={len(ids)}, missing={missing}, duplicates={duplicates}')
    for node in root.iter():
        if node.tag is ET.Comment:
            counter = re.fullmatch(r'\s*(tests|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*', node.text or '')
            if counter and int(counter[2]) != (len(ids) if counter[1] in ('tests', 'pass') else 0):
                raise ValueError(f'native summary does not match passing cases: {counter[0].strip()}')
    return {'ids': ids, 'count': len(ids), 'unregistered_ids': sorted(set(ids) - set(expected_ids))}


def run_process(command, root, log, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return {'returncode': 124, 'timed_out': True, 'elapsed_seconds': 0, 'started': False}
    started = time.monotonic()
    options = {'start_new_session': True} if os.name != 'nt' else {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP}
    with log.open('wb') as stream:
        process = subprocess.Popen(command, cwd=root, stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.STDOUT, **options)
        timed_out = False
        try:
            process.wait(timeout=max(0.001, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            timed_out = True
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], stdout=stream, stderr=subprocess.STDOUT, timeout=5)
            else:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            process.wait(timeout=5)
    return {'returncode': 124 if timed_out else process.returncode, 'timed_out': timed_out,
            'elapsed_seconds': round(time.monotonic() - started, 3), 'started': True}


def python_worker(root, source, xml_path, max_tests):
    sys.path[:0] = [str((root / source).parent), str(root / 'tools'), str(root / 'tests'), str(root)]
    from unittest_report import RecordingResult
    with redirect_stdout(sys.stderr):
        suite = unittest.TestLoader().loadTestsFromName(Path(source).stem)
        expected = suite.countTestCases()
        if expected < 1 or expected > max_tests:
            print(f'Python discovery exceeds budget or is empty: {expected} cases', file=sys.stderr)
            return 2
        result = unittest.TextTestRunner(verbosity=2, resultclass=RecordingResult, stream=sys.stderr).run(suite)
    xml = ET.Element('testsuite', {'tests': str(len(result.records))})
    for item in result.records:
        case = ET.SubElement(xml, 'testcase', {'name': item['id']})
        if item['status'] != 'passed':
            ET.SubElement(case, item['status'] if item['status'] in ('failure', 'error', 'skipped') else 'error')
    ET.ElementTree(xml).write(xml_path, encoding='utf-8', xml_declaration=True)
    return 0 if result.wasSuccessful() and result.testsRun == expected and all(r['status'] == 'passed' for r in result.records) else 1


def resolve_node(root, requested):
    if requested or os.environ.get('RIFARE_DEV_NODE'):
        return requested or os.environ['RIFARE_DEV_NODE']
    local = subprocess.run(['git', '-C', str(root), 'config', '--get', 'rifare.devNode'], capture_output=True, text=True, timeout=5)
    node = local.stdout.strip() or shutil.which('node')
    if not node:
        raise ValueError('Node is required; set RIFARE_DEV_NODE or --node to an installed supported Node executable')
    return node


def main():
    started = time.monotonic()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--profile', choices=['changed', 'smoke'], default='changed')
    parser.add_argument('--files', nargs='+', help='explicit whole test files, including ordinarily deferred suites')
    parser.add_argument('--since', help='include committed changes since merge-base with this ref')
    parser.add_argument('--max-tests', type=int)
    parser.add_argument('--max-files', type=int)
    parser.add_argument('--timeout', type=float, help='one total deadline in seconds, not per file')
    parser.add_argument('--node')
    parser.add_argument('--plan', action='store_true', help='show scope without running tests')
    parser.add_argument('--output', type=Path, help='new directory for reports; existing directories are rejected')
    parser.add_argument('--python-worker', nargs=3, metavar=('SOURCE', 'XML', 'MAX_TESTS'), help=argparse.SUPPRESS)
    args = parser.parse_args()
    root = args.root.resolve()
    if args.python_worker:
        source, xml_path, max_tests = args.python_worker
        return python_worker(root, source, Path(xml_path), int(max_tests))
    output = None
    output_created = False
    report = {'full_regression': False, 'goal_accepted': False, 'status': 'failed', 'results': []}
    try:
        config = json.loads((root / 'planning/development-test-profiles.json').read_text())
        registry = json.loads((root / 'planning/regression-registry.json').read_text())['tests']
        max_tests = args.max_tests if args.max_tests is not None else config['max_tests']
        max_files = args.max_files if args.max_files is not None else config['max_files']
        timeout = args.timeout if args.timeout is not None else config['timeout_seconds']
        if max_tests < 1 or max_files < 1 or not 0 < timeout <= 3600:
            raise ValueError('positive test/file budgets and a timeout of at most 3600 seconds are required')
        if args.files and args.profile != 'changed':
            raise ValueError('--files and --profile smoke are separate explicit selections')
        plan = select_plan(root, config, registry, changed_paths(root, args.since), profile=args.profile,
                           files=args.files, max_tests=max_tests, max_files=max_files)
        report.update(plan)
        report.update({'head': git(root, 'rev-parse', 'HEAD').strip(), 'timeout_seconds': timeout,
                       'since': args.since, 'dirty': bool(changed_paths(root))})
        if args.plan:
            report['status'] = 'plan_only'
            print(json.dumps(report, indent=2))
            return 0
        output = args.output.resolve() if args.output else root / 'evidence/development' / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ') + '-' + uuid.uuid4().hex[:6])
        output.mkdir(parents=True, exist_ok=False)
        output_created = True
        snapshot = {}
        for name in source_paths(root):
            path = root / name
            if path.is_file():
                snapshot[name] = hashlib.sha256(path.read_bytes()).hexdigest()
        report['source_sha256'] = snapshot
        print(f"Development {args.profile}: {len(plan['selected'])} files, {plan['planned_tests']} planned cases, {timeout:g}s total deadline.", flush=True)
        if plan['fallback_reason']:
            print(f"Smoke fallback: {plan['fallback_reason']}.", flush=True)
        if plan['deferred'] or plan['unmapped_paths']:
            print(f"Deferred files: {len(plan['deferred'])}; unmapped paths: {len(plan['unmapped_paths'])}. Full scope is in report.json.", flush=True)
        node = resolve_node(root, args.node) if any(s['suite'] != 'python' for s in plan['selected']) else None
        total, code = 0, 0
        for index, selection in enumerate(plan['selected']):
            source = selection['source']
            native, log = output / f'{index + 1:02d}-native.xml', output / f'{index + 1:02d}-output.log'
            if selection['suite'] == 'python':
                command = [sys.executable, '-I', str(root / 'tools/dev_tests.py'), '--root', str(root),
                           '--python-worker', source, str(native), str(max_tests - total)]
            else:
                hook = ['--import', str(root / 'tests/harness/network-deny.mts')] if selection['suite'] in ('unit', 'database') else []
                command = [node, '--experimental-strip-types', *hook,
                           '--test', '--test-concurrency=1', '--test-reporter=junit', f'--test-reporter-destination={native}',
                           '--test-reporter=tap', '--test-reporter-destination=stdout', source]
            result = {'source': source, 'command': command, 'native_report': str(native), 'log': str(log)}
            report['results'].append(result)
            result.update(run_process(command, root, log, started + timeout))
            if result['returncode'] != 0:
                code = result['returncode'] if result['returncode'] > 0 else 1
                print(f"FAIL {source}: exit {result['returncode']}; see {log}", flush=True)
                break
            try:
                result.update(read_native(native, selection['suite'], selection['expected_ids'], source=source))
                total += result['count']
                if total > max_tests:
                    raise ValueError('native dynamic cases exceeded the planned budget; narrow selection explicitly')
            except (ValueError, OSError, ET.ParseError) as exc:
                result['validation_error'] = str(exc)
                code = 1
                print(f'FAIL {source}: {exc}', flush=True)
                break
            print(f"PASS {source}: {result['count']} cases in {result['elapsed_seconds']:.3f}s", flush=True)
        report.update({'status': 'passed' if code == 0 else 'failed', 'actual_tests': total,
                       'not_run': [s['source'] for s in plan['selected'][len(report['results']):]],
                       'elapsed_seconds': round(time.monotonic() - started, 3)})
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        print(f"{report['status'].upper()}: {total} development cases in {report['elapsed_seconds']:.3f}s; {output / 'report.json'}", flush=True)
        return code
    except (ValueError, OSError, subprocess.SubprocessError, ET.ParseError) as exc:
        report.update({'error': str(exc), 'elapsed_seconds': round(time.monotonic() - started, 3)})
        if output_created:
            (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        print(f'Development checks failed: {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
