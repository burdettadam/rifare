#!/usr/bin/env python3
"""Capture and verify source-bound evidence using separately pinned local controls.

External hashes and review records must come from a protected caller. This is not
an identity provider, sandbox, signature authority, merge command or release tool.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import subprocess
import sys
from typing import Any

import regression_gate as G
import test_harness as H
import check_workflow as W

CONTROL_FILES = G.CONTROL_FILES + ('evidence_gate.py', 'check_workflow.py', 'check_distribution.py')
POLICY = 'planning/workflow-policy.json'
PIN_CATEGORIES = ('skills', 'profiles', 'policies', 'adapters', 'models', 'runtimes')
REQUIRED_NOTES = ('red-green.md', 'demo.md', 'handoff.md')
MAX_FILES = 512
MAX_TOTAL = 128 * 1024 * 1024
REQUEST_KEYS = ('schema_version', 'kind', 'goal_id', 'candidate_sha', 'base_sha',
                'writer_id', 'writer_session_id', 'issued_at', 'expires_at',
                'baseline_commit', 'baseline_sha256', 'regression_controller_sha256',
                'pins', 'supporting_files', 'retention')
MANIFEST_KEYS = ('schema_version', 'kind', 'status', 'qualification', 'goal_id',
                 'candidate_sha', 'base_sha', 'source_tree_sha256', 'git_tree',
                 'build', 'configuration_digest', 'pins', 'environment',
                 'started_at', 'finished_at', 'request_sha256', 'test_run',
                 'artifacts', 'supporting_files', 'retention', 'independent_review_references')
RECEIPT_KEYS = ('schema_version', 'kind', 'request_sha256', 'manifest_sha256',
                'run_report_sha256', 'verifier_sha256', 'goal_id', 'candidate_sha',
                'base_sha', 'configuration_digest', 'finished_at')


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def fields(value: Any, keys, label: str) -> dict:
    require(type(value) is dict and set(value) == set(keys), label + ': missing or unexpected fields')
    return value


def text(value: Any, label: str) -> str:
    require(type(value) is str and bool(value.strip()) and len(value) <= 4096
            and not any(ord(c) < 32 for c in value), label + ': invalid text')
    return value


def hash_value(value: Any, label: str = 'digest') -> str:
    require(type(value) is str and re.fullmatch('[0-9a-f]{64}', value) is not None,
            label + ': SHA-256 required')
    return value


def timestamp(value: Any) -> datetime:
    text(value, 'timestamp')
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError('invalid timestamp') from exc
    require(result.tzinfo is not None and result.utcoffset() is not None,
            'timezone required for evidence timestamps')
    return result.astimezone(timezone.utc)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def read_file(path: Path) -> bytes:
    require(not path.is_symlink() and not any(p.is_symlink() for p in path.absolute().parents),
            'symlink evidence/control path')
    info = path.stat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'regular single-link evidence file required')
    require(info.st_size <= G.MAX_BYTES, 'oversized evidence file')
    data = path.read_bytes()
    require(len(data) <= G.MAX_BYTES, 'oversized evidence file')
    return data


def read_json(path: Path) -> Any:
    return G.decode(read_file(path))


def save_json(path: Path, value: Any) -> None:
    with path.open('xb') as stream:
        stream.write(G.canonical(value) + b'\n')


def no_sensitive_bytes(data: bytes) -> None:
    """Conservative tripwires, not universal secret/PII detection or redaction."""
    patterns = (rb'-----BEGIN [A-Z ]*PRIVATE KEY-----',
                rb'(?i)authorization\s*:\s*bearer\s+[a-z0-9._~+/-]{8,}',
                rb'''(?i)\b(?:api[_-]?key|password|access_token)\s*[:=]\s*["']?[a-z0-9._~+/=-]{16,}''')
    require(H.CANARY.encode() not in data and not any(re.search(p, data) for p in patterns),
            'sensitive artifact rejected; redact at source and recapture')


def inventory(directory: Path) -> dict[str, dict]:
    require(directory.is_dir() and not directory.is_symlink()
            and not any(p.is_symlink() for p in directory.absolute().parents), 'unsafe evidence directory')
    result, names, total = {}, set(), 0
    for path in sorted(directory.rglob('*')):
        require(not path.is_symlink(), 'symlink inside evidence directory')
        if path.is_dir():
            continue
        relative = G.relative(path.relative_to(directory).as_posix())
        require(relative.casefold() not in names, 'case-colliding artifact path')
        names.add(relative.casefold())
        data = read_file(path)
        no_sensitive_bytes(data)
        total += len(data)
        require(total <= MAX_TOTAL and len(result) < MAX_FILES, 'evidence inventory exceeds bounds')
        result[relative] = {'sha256': G.sha(data), 'bytes': len(data)}
    return result


def digest_control(directory: Path) -> str:
    return G.sha(G.canonical({p: G.sha(read_file(directory / p)) for p in CONTROL_FILES}))


def validate_control(directory: Path, expected: str, root: Path) -> None:
    G.outside(directory, root)
    require(digest_control(directory) == hash_value(expected), 'pinned evidence verifier mismatch')


def export_control(root: Path, source: str, output: Path) -> dict:
    G.commit_id(source)
    G.outside(output, root)
    data = {name: G.read_blob(root, source, 'tools/' + name) for name in CONTROL_FILES}
    output.mkdir(parents=True, exist_ok=False)
    for name, body in data.items():
        (output / name).write_bytes(body)
    pins = {'source_commit': source, 'verifier_sha256': digest_control(output),
            'regression_controller_sha256': G.controller_digest(output),
            'qualification': 'export_not_identity_authentication_or_acceptance'}
    save_json(output / 'evidence-pins.json', pins)
    return pins


def load_external(path: Path, expected: str, root: Path, bundle: Path | None = None) -> dict:
    G.outside(path, root)
    if bundle is not None:
        G.outside(path, bundle)
    data = read_file(path)
    require(G.sha(data) == hash_value(expected), 'independently pinned input digest mismatch')
    return G.decode(data)


def validate_retention(value: dict, finished: datetime | None = None) -> None:
    fields(value, ('owner', 'retain_until', 'cleanup'), 'retention')
    text(value['owner'], 'retention owner')
    deadline = timestamp(value['retain_until'])
    require(value['cleanup'] == 'manual_after_decision_and_retained_references', 'unsafe retention cleanup policy')
    if finished is not None:
        require(deadline >= finished, 'retention ends before evidence capture')


def validate_request(request: dict, root: Path, now: datetime) -> dict:
    fields(request, REQUEST_KEYS, 'request')
    require(type(request['schema_version']) is int and request['schema_version'] == 1
            and request['kind'] == 'rifare-evidence-request-v1', 'invalid request version/kind')
    require(type(request['goal_id']) is str and re.fullmatch('M[0-9]{2}-G[0-9]{2}', request['goal_id']) is not None,
            'invalid evidence goal')
    for key in ('candidate_sha', 'base_sha', 'baseline_commit'):
        G.commit_id(request[key])
    for key in ('baseline_sha256', 'regression_controller_sha256'):
        hash_value(request[key])
    for key in ('writer_id', 'writer_session_id'):
        text(request[key], key)
    require(timestamp(request['issued_at']) <= now <= timestamp(request['expires_at']), 'request expired or not yet valid')
    for base in ('base_sha', 'baseline_commit'):
        G.git(root, 'merge-base', '--is-ancestor', request[base], request['candidate_sha'])
    goals = G.decode(G.read_blob(root, request['base_sha'], 'planning/goals.json'))
    matches = [goal for goal in goals['goals'] if goal['id'] == request['goal_id']]
    require(len(matches) == 1, 'goal absent from trusted base')
    G.inspect_checkout(root, request['candidate_sha'])
    policy = G.read_blob(root, request['base_sha'], POLICY)
    require(policy == G.read_blob(root, request['candidate_sha'], POLICY), 'candidate changed governing policy')
    W.validate_policy(G.decode(policy))
    fields(request['pins'], PIN_CATEGORIES, 'configuration pins')
    for category, item in request['pins'].items():
        fields(item, ('files', 'settings', 'not_applicable_reason'), 'pin category')
        require(type(item['files']) is dict and type(item['settings']) is dict, 'invalid configuration pins')
        if item['not_applicable_reason'] is not None:
            text(item['not_applicable_reason'], 'inapplicability reason')
            require(not item['files'] and not item['settings'], 'inapplicable pin has settings/files')
        else:
            require(bool(item['files'] or item['settings']), 'applicable configuration pin is empty')
        for path, expected in item['files'].items():
            G.relative(path)
            require(G.sha(G.read_blob(root, request['candidate_sha'], path)) == hash_value(expected),
                    'configuration source pin mismatch')
        for key, value in item['settings'].items():
            text(key, 'setting key'); text(value, 'setting value')
    require(request['pins']['policies']['files'].get(POLICY) == G.sha(policy), 'governing policy pin required')
    require(request['pins']['runtimes']['not_applicable_reason'] is None, 'runner configuration cannot be inapplicable')
    source_paths = G.git_files(root, request['candidate_sha'])
    for dependency_file in ('package.json', 'package-lock.json', '.nvmrc', 'pyproject.toml', 'uv.lock'):
        if dependency_file in source_paths:
            require(dependency_file in request['pins']['runtimes']['files'], 'dependency input must be pinned')
    notes = request['supporting_files']
    require(type(notes) is dict and set(REQUIRED_NOTES) <= set(notes), 'required evidence notes missing')
    for path, expected in notes.items():
        G.relative(path); hash_value(expected)
    validate_retention(request['retention'])
    return matches[0]


def read_run(root: Path, request: dict, run: Path, baseline: dict) -> tuple[dict, dict, list[str]]:
    report = read_json(run / 'results.json')
    identity = G.inspect_checkout(root, request['candidate_sha'])
    require(report['source'] == identity, 'run candidate/source identity mismatch')
    require(report.get('goal') == 'M00-G07' and report.get('status') == 'passed'
            and report.get('qualification') == 'local_development_only_not_product_acceptance'
            and report.get('errors') == [] and report.get('goal_accepted') is False
            and report.get('release_authorized') is False, 'native run not a passing diagnostic observation')
    require(report.get('baseline_commit') == request['baseline_commit']
            and report.get('baseline_sha256') == request['baseline_sha256']
            and report.get('controller_sha256') == request['regression_controller_sha256'], 'run control pins mismatch')
    current = G.snapshot(root, request['candidate_sha'])
    G.validate_membership(root, current)
    delta = G.compare(baseline, current)
    require(not delta['errors'] and not delta['review_required_paths'] and report.get('changes') == delta,
            'protected regression baseline not satisfied')
    config = G.sha(G.canonical({'registry': current['registry'], 'controller': request['regression_controller_sha256'],
                               'baseline': request['baseline_sha256']}))
    require(report.get('configuration_digest') == config, 'native run configuration mismatch')
    expected = G.expected_by_suite(current['registry'])
    require(type(report.get('layers')) is dict and set(report['layers']) == set(expected), 'missing or extra native suite')
    test_ids = []
    for suite, ids in expected.items():
        layer = report['layers'][suite]
        require(layer.get('status') == 'passed' and layer.get('error') is None
                and type(layer.get('exit_code')) is int and layer['exit_code'] == 0, 'native suite failed')
        require(type(layer.get('command')) is list and bool(layer['command']), 'missing actual native command')
        for word in layer['command']:
            text(word, 'command argument')
        xml = read_file(run / suite / 'native.xml')
        stdout = read_file(run / suite / 'native.stdout.txt')
        stderr = read_file(run / suite / 'native.stderr.txt')
        require(G.sha(xml) == layer['native_sha256'] and G.sha(stdout + b'\n' + stderr) == layer['diagnostics_sha256'],
                'native report or diagnostics digest mismatch')
        counts = H.inspect_output(xml.decode(), (stdout + b'\n' + stderr).decode(), ids, layer['exit_code'], [H.CANARY])
        require(counts == layer.get('counts'), 'normalized native counts disagree with native report')
        test_ids.extend(suite + ':' + ident for ident in counts['case_ids'])
    require(type(report.get('executed_test_count')) is int and report['executed_test_count'] == len(test_ids)
            and len(test_ids) == len(set(test_ids)), 'executed test inventory mismatch')
    require(timestamp(request['issued_at']) <= timestamp(report['started_at']) <= timestamp(report['finished_at'])
            <= timestamp(request['expires_at']), 'run outside requested time window')
    return report, identity, sorted(test_ids)


def check_artifacts(bundle: Path, manifest: dict) -> dict:
    actual = inventory(bundle)
    actual.pop('manifest.json', None)
    require(type(manifest.get('artifacts')) is dict, 'invalid artifact inventory')
    for path, entry in manifest['artifacts'].items():
        G.relative(path); fields(entry, ('sha256', 'bytes'), 'artifact pin'); hash_value(entry['sha256'])
        require(type(entry['bytes']) is int and entry['bytes'] >= 0, 'artifact byte count must be an integer')
    require(type(manifest.get('artifacts')) is dict and actual == manifest['artifacts'], 'artifact inventory/hash mismatch')
    return actual


def check_receipt(receipt: dict, request: dict, manifest: dict, request_sha: str,
                  manifest_sha: str, verifier_sha: str, report_sha: str) -> None:
    fields(receipt, RECEIPT_KEYS, 'receipt')
    expected = {'schema_version': 1, 'kind': 'rifare-local-capture-receipt-v1',
                'request_sha256': request_sha, 'manifest_sha256': manifest_sha,
                'run_report_sha256': report_sha, 'verifier_sha256': verifier_sha,
                'goal_id': request['goal_id'], 'candidate_sha': request['candidate_sha'],
                'base_sha': request['base_sha'], 'configuration_digest': manifest['configuration_digest'],
                'finished_at': manifest['finished_at']}
    require(receipt == expected and type(receipt['schema_version']) is int, 'capture receipt binding mismatch')


def capture(root: Path, request_path: Path, request_sha: str, baseline_path: Path,
            controller: Path, verifier_sha: str, notes: Path, bundle: Path, receipt_path: Path) -> dict:
    validate_control(controller, verifier_sha, root)
    G.outside(bundle, root); G.outside(receipt_path, root); G.outside(receipt_path, bundle)
    G.outside(bundle, controller); G.outside(receipt_path, controller)
    for trust in (request_path, baseline_path):
        G.outside(trust, bundle)
    require(not bundle.exists() and not receipt_path.exists(), 'fresh evidence and receipt destinations required')
    require(not notes.resolve().is_relative_to(bundle.resolve()) and not bundle.resolve().is_relative_to(notes.resolve()),
            'notes and bundle cannot overlap')
    request = load_external(request_path, request_sha, root, bundle)
    validate_request(request, root, now_utc())
    require(G.controller_digest(controller) == request['regression_controller_sha256'], 'native controller pin mismatch')
    baseline = G.load_baseline(baseline_path, request['baseline_sha256'], root)
    require(baseline['commit'] == request['baseline_commit'], 'baseline commit mismatch')
    note_inventory = inventory(notes)
    require({path: entry['sha256'] for path, entry in note_inventory.items()} == request['supporting_files'],
            'supporting evidence differs from predeclared files')
    require(all(note_inventory[path]['bytes'] > 0 for path in REQUIRED_NOTES), 'empty required evidence note')
    bundle.mkdir(parents=True, exist_ok=False)
    for path in note_inventory:
        target = bundle / 'supporting' / path; target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(read_file(notes / path))
    run = bundle / 'run'
    G.run_gate(root, request['candidate_sha'], baseline_path, request['baseline_sha256'], controller,
               request['regression_controller_sha256'], run, shutil.which('chromium'))
    report, identity, ids = read_run(root, request, run, baseline)
    require(timestamp(report['finished_at']) <= now_utc() <= timestamp(request['expires_at']), 'request expired during capture')
    artifacts = inventory(bundle)
    require({p.removeprefix('supporting/'): item['sha256'] for p, item in artifacts.items()
             if p.startswith('supporting/')} == request['supporting_files'], 'supporting files changed during capture')
    config = G.sha(G.canonical({'pins': request['pins'], 'native_configuration_digest': report['configuration_digest']}))
    manifest = {'schema_version': 1, 'kind': 'rifare-evidence-bundle-v1', 'status': 'captured_not_accepted',
                'qualification': 'local_diagnostic_evidence_not_target_stack_or_product',
                'goal_id': request['goal_id'], 'candidate_sha': request['candidate_sha'], 'base_sha': request['base_sha'],
                'source_tree_sha256': identity['tracked_source_sha256'],
                'git_tree': G.git(root, 'rev-parse', request['candidate_sha'] + '^{tree}').decode().strip(),
                'build': {'kind': 'interpreted_source_not_compiled_artifact', 'sha256': identity['tracked_source_sha256']},
                'configuration_digest': config, 'pins': request['pins'],
                'environment': {'class': 'local_diagnostic', 'python': platform.python_version(),
                                'system': platform.system(), 'machine': platform.machine(),
                                'captured_worktree': str(root.resolve())},
                'started_at': report['started_at'], 'finished_at': report['finished_at'],
                'request_sha256': request_sha,
                'test_run': {'path': 'run/results.json', 'sha256': artifacts['run/results.json']['sha256'],
                             'runner_scope': 'M00-G07', 'discovered_test_ids': ids, 'executed_test_ids': ids,
                             'commands': {suite: layer['command'] for suite, layer in report['layers'].items()},
                             'exit_codes': {suite: layer['exit_code'] for suite, layer in report['layers'].items()}},
                'artifacts': artifacts, 'supporting_files': request['supporting_files'],
                'retention': request['retention'], 'independent_review_references': []}
    validate_retention(manifest['retention'], timestamp(manifest['finished_at']))
    require(G.sha(read_file(request_path)) == request_sha and digest_control(controller) == verifier_sha,
            'request or verifier changed during capture')
    save_json(bundle / 'manifest.json', manifest)
    manifest_sha = G.sha(read_file(bundle / 'manifest.json'))
    receipt = {'schema_version': 1, 'kind': 'rifare-local-capture-receipt-v1', 'request_sha256': request_sha,
               'manifest_sha256': manifest_sha, 'run_report_sha256': manifest['test_run']['sha256'],
               'verifier_sha256': verifier_sha, 'goal_id': request['goal_id'], 'candidate_sha': request['candidate_sha'],
               'base_sha': request['base_sha'], 'configuration_digest': config, 'finished_at': manifest['finished_at']}
    # Receipt is written last. A failed/interrupted capture never creates a valid receipt.
    save_json(receipt_path, receipt)
    return {'status': 'captured', 'manifest_sha256': manifest_sha, 'receipt_sha256': G.sha(read_file(receipt_path)),
            'request_sha256': request_sha, 'executed_test_count': len(ids),
            'goal_accepted': False, 'release_authorized': False}


def verify_bundle(root: Path, request_path: Path, request_sha: str, baseline_path: Path,
                  controller: Path, verifier_sha: str, bundle: Path, receipt_path: Path,
                  receipt_sha: str, now: datetime | None = None) -> dict:
    now = now or now_utc()
    validate_control(controller, verifier_sha, root)
    G.outside(bundle, root); G.outside(bundle, controller)
    request = load_external(request_path, request_sha, root, bundle)
    validate_request(request, root, now)
    baseline = G.load_baseline(baseline_path, request['baseline_sha256'], root)
    G.outside(baseline_path, bundle)
    require(baseline['commit'] == request['baseline_commit'], 'baseline commit mismatch')
    receipt = load_external(receipt_path, receipt_sha, root, bundle)
    raw = read_file(bundle / 'manifest.json'); manifest_sha = G.sha(raw)
    fields(receipt, RECEIPT_KEYS, 'receipt')
    require(receipt['manifest_sha256'] == manifest_sha, 'manifest differs from independent capture receipt')
    manifest = fields(G.decode(raw), MANIFEST_KEYS, 'manifest')
    require(type(manifest['schema_version']) is int and manifest['schema_version'] == 1
            and manifest['kind'] == 'rifare-evidence-bundle-v1'
            and manifest['status'] == 'captured_not_accepted'
            and manifest['qualification'] == 'local_diagnostic_evidence_not_target_stack_or_product',
            'invalid manifest scope; no approval or product qualification')
    for key in ('goal_id', 'candidate_sha', 'base_sha', 'pins', 'supporting_files', 'retention'):
        require(manifest[key] == request[key], 'manifest/request binding mismatch: ' + key)
    require(manifest['request_sha256'] == request_sha, 'request identity mismatch')
    require(manifest['independent_review_references'] == [], 'candidate evidence cannot supply trusted reviewers')
    artifacts = check_artifacts(bundle, manifest)
    report, identity, ids = read_run(root, request, bundle / 'run', baseline)
    require(manifest['source_tree_sha256'] == identity['tracked_source_sha256']
            and manifest['git_tree'] == G.git(root, 'rev-parse', request['candidate_sha'] + '^{tree}').decode().strip(),
            'source tree mismatch')
    require(manifest['build'] == {'kind': 'interpreted_source_not_compiled_artifact', 'sha256': identity['tracked_source_sha256']},
            'build identity mismatch or compiled build not qualified')
    config = G.sha(G.canonical({'pins': request['pins'], 'native_configuration_digest': report['configuration_digest']}))
    require(manifest['configuration_digest'] == config, 'configuration digest mismatch')
    expected_run = {'path': 'run/results.json', 'sha256': artifacts['run/results.json']['sha256'], 'runner_scope': 'M00-G07',
                    'discovered_test_ids': ids, 'executed_test_ids': ids,
                    'commands': {s: r['command'] for s, r in report['layers'].items()},
                    'exit_codes': {s: r['exit_code'] for s, r in report['layers'].items()}}
    require(manifest['test_run'] == expected_run, 'manifest/native test-run mismatch')
    env = fields(manifest['environment'], ('class', 'python', 'system', 'machine', 'captured_worktree'), 'environment')
    require(env['class'] == 'local_diagnostic', 'invalid captured environment class')
    for value in env.values(): text(value, 'captured environment')
    for key in ('started_at', 'finished_at'):
        require(manifest[key] == report[key], 'capture timestamps mismatch')
    require(timestamp(manifest['finished_at']) <= now, 'evidence comes from the future')
    validate_retention(manifest['retention'], timestamp(manifest['finished_at']))
    require(now <= timestamp(manifest['retention']['retain_until']), 'evidence retention window expired')
    require(all(artifacts.get('supporting/' + path, {}).get('bytes', 0) > 0 for path in REQUIRED_NOTES),
            'empty required evidence note')
    for path, expected in request['supporting_files'].items():
        require(artifacts.get('supporting/' + path, {}).get('sha256') == expected, 'supporting evidence identity mismatch')
    require({p.removeprefix('supporting/') for p in artifacts if p.startswith('supporting/')} == set(request['supporting_files']),
            'unexpected supporting artifact')
    check_receipt(receipt, request, manifest, request_sha, manifest_sha, verifier_sha, expected_run['sha256'])
    # Recheck supplied trust and evidence after parsing; do not silently repin altered inputs.
    require(G.sha(read_file(request_path)) == request_sha and G.sha(read_file(receipt_path)) == receipt_sha
            and G.sha(read_file(baseline_path)) == request['baseline_sha256']
            and digest_control(controller) == verifier_sha, 'trusted input changed during verification')
    require(G.inspect_checkout(root, request['candidate_sha']) == identity, 'source changed during verification')
    require(check_artifacts(bundle, manifest) == artifacts and G.sha(read_file(bundle / 'manifest.json')) == manifest_sha,
            'evidence changed during verification')
    return {'status': 'verified', 'goal_id': request['goal_id'], 'candidate_sha': request['candidate_sha'],
            'base_sha': request['base_sha'], 'source_tree_sha256': identity['tracked_source_sha256'],
            'configuration_digest': config, 'manifest_sha256': manifest_sha, 'request_sha256': request_sha,
            'receipt_sha256': receipt_sha, 'executed_test_count': len(ids), 'artifact_count': len(artifacts),
            'evidence_verified': True, 'goal_accepted': False, 'release_authorized': False,
            'review_identity_authenticated': False}


def assess_acceptance(root: Path, request: dict, evidence: dict, manifest: dict,
                      attestations: dict, now: datetime) -> dict:
    """Pure checks on externally supplied attestations; performs no acceptance write."""
    require(evidence.get('evidence_verified') is True and evidence.get('status') == 'verified', 'verified evidence required')
    fields(attestations, ('schema_version', 'kind', 'evidence_manifest_sha256', 'request_sha256', 'receipt_sha256',
                         'review_round', 'review_refs', 'reviews', 'assignments', 'blockers', 'release_approval',
                         'intent', 'tag'), 'trusted attestation index')
    require(type(attestations['schema_version']) is int and attestations['schema_version'] == 1
            and attestations['kind'] == 'rifare-external-review-index-v1', 'invalid attestation index kind')
    for key, evidence_key in (('evidence_manifest_sha256', 'manifest_sha256'), ('request_sha256', 'request_sha256'),
                              ('receipt_sha256', 'receipt_sha256')):
        require(attestations[key] == evidence[evidence_key], 'review index/evidence mismatch')
    refs = attestations['review_refs']; reviews = attestations['reviews']
    require(type(refs) is list and type(reviews) is dict and len(refs) == len(set(refs))
            and set(refs) == set(reviews), 'review index cannot omit or duplicate a review')
    if attestations['intent'] == 'local_merge':
        require(attestations['release_approval'] is None, 'release approval outside requested intent')
    bound_decisions = list(reviews.values())
    if attestations['release_approval'] is not None:
        require(type(attestations['release_approval']) is dict, 'invalid release approval')
        bound_decisions.append(attestations['release_approval'])
    for review in bound_decisions:
        require(review.get('evidence_manifest_sha256') == evidence['manifest_sha256']
                and review.get('receipt_sha256') == evidence['receipt_sha256'], 'review evidence binding mismatch')
        require(timestamp(manifest['finished_at']) <= timestamp(review.get('created_at')) <= now
                <= timestamp(review.get('expires_at')), 'stale or pre-capture review')
    goals = G.decode(G.read_blob(root, request['base_sha'], 'planning/goals.json'))
    goal = next(g for g in goals['goals'] if g['id'] == request['goal_id'])
    ledger = G.decode(G.read_blob(root, request['base_sha'], 'work/accepted-goals.json'))
    accepted = {item['goal_id'] for item in ledger['acceptances'] if item['state'] == 'accepted'}
    policy = G.decode(G.read_blob(root, request['base_sha'], POLICY))
    branch = G.git(root, 'branch', '--show-current').decode().strip()
    binding = {'candidate_sha': request['candidate_sha'], 'base_sha': request['base_sha'],
               'configuration_sha256': evidence['configuration_digest'], 'clean': True,
               'goal_id': request['goal_id'], 'branch': branch, 'worktree': str(root.resolve()),
               'dependencies_accepted': set(goal['depends_on']) <= accepted,
               'change_class': 'bootstrap_development' if goal['milestone'] == 'M00' else 'product'}
    count = evidence['executed_test_count']
    record = {'schema_version': 1, 'goal_id': request['goal_id'], **{k: binding[k] for k in W.BINDING},
              'writer_id': request['writer_id'], 'writer_session_id': request['writer_session_id'],
              'branch': branch, 'blockers': attestations['blockers'], 'review_round': attestations['review_round'],
              'intent': attestations['intent'], 'tag': attestations['tag'], 'external_effects': [], 'exception_id': None,
              'review_refs': refs, 'checks': {**{k: binding[k] for k in W.BINDING}, 'discovered': count, 'executed': count,
                  'failures': 0, 'skipped': 0, 'status': 'pass', 'commands': [' '.join(cmd) for cmd in manifest['test_run']['commands'].values()],
                  'report_sha256': manifest['test_run']['sha256']}}
    facts = {'assignments': attestations['assignments'], 'reviews': reviews,
             'release_approval': attestations['release_approval'], 'verified_report_sha256': manifest['test_run']['sha256']}
    checked = W.assess_checkpoint(record, policy, binding, facts)
    return {'status': 'checks_satisfied_not_accepted', 'goal_accepted': False, 'release_authorized': False,
            'review_identity_authenticated': False, 'workflow_checks': checked}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    export = sub.add_parser('export'); export.add_argument('--root', type=Path, required=True)
    export.add_argument('--source-commit', required=True); export.add_argument('--output', type=Path, required=True)
    for action in ('capture', 'verify', 'assess'):
        command = sub.add_parser(action)
        for name in ('root', 'request', 'baseline', 'bundle', 'receipt'):
            command.add_argument('--' + name, type=Path, required=True)
        command.add_argument('--request-sha256', required=True); command.add_argument('--verifier-sha256', required=True)
        if action == 'capture': command.add_argument('--supporting', type=Path, required=True)
        else: command.add_argument('--receipt-sha256', required=True)
        if action == 'assess':
            command.add_argument('--attestations', type=Path, required=True)
            command.add_argument('--attestations-sha256', required=True)
    args = parser.parse_args()
    try:
        root = args.root.absolute()
        if args.action == 'export':
            result = export_control(root, args.source_commit, args.output.absolute())
        else:
            controller = Path(__file__).resolve().parent
            if args.action == 'capture':
                result = capture(root, args.request.absolute(), args.request_sha256, args.baseline.absolute(), controller,
                                 args.verifier_sha256, args.supporting.absolute(), args.bundle.absolute(), args.receipt.absolute())
            else:
                result = verify_bundle(root, args.request.absolute(), args.request_sha256, args.baseline.absolute(), controller,
                                       args.verifier_sha256, args.bundle.absolute(), args.receipt.absolute(), args.receipt_sha256)
                if args.action == 'assess':
                    att = load_external(args.attestations.absolute(), args.attestations_sha256, root, args.bundle.absolute())
                    result = assess_acceptance(root, read_json(args.request), result, read_json(args.bundle/'manifest.json'), att, now_utc())
                    require(G.sha(read_file(args.attestations)) == args.attestations_sha256, 'attestations changed during assessment')
        print(json.dumps(result, indent=2))
        return 0
    except (ValueError, KeyError, TypeError, OSError, StopIteration, subprocess.SubprocessError) as exc:
        print(json.dumps({'status': 'blocked', 'goal_accepted': False, 'release_authorized': False,
                                      'error': str(exc)}, indent=2))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
