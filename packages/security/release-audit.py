#!/usr/bin/env python3
"""Bounded offline source/SBOM/security observation; never a release authorization."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import time
from typing import Any

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
CHECKER = ROOT / 'tools/check_distribution.py'
CONTRACT = ROOT / 'packages/security/contracts/release-audit.v1.json'
spec = importlib.util.spec_from_file_location('rifare_retained_distribution', CHECKER)
distribution = importlib.util.module_from_spec(spec)
spec.loader.exec_module(distribution)
POLICY = distribution.read_json(CONTRACT)
HEX64 = re.compile(r'[0-9a-f]{64}\Z')
HEX40 = re.compile(r'[0-9a-f]{40}\Z')
DEPENDENCY_FIELDS = ('dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies')


def require(condition: bool, code: str) -> None:
    if not condition:
        raise ValueError(code)


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode('utf-8')


def sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def digest(value: Any) -> str:
    return sha(canonical(value))


def exact(value: Any, required: set[str], optional: set[str] | None = None) -> None:
    require(type(value) is dict and required <= set(value) and set(value) <= required | (optional or set()), 'AUDIT_INPUT_INVALID')


def pin(value: Any, size: int = 64) -> bool:
    return type(value) is str and bool((HEX64 if size == 64 else HEX40).fullmatch(value))


def real_path(value: Any, directory: bool) -> Path:
    require(type(value) is str and os.path.isabs(value) and os.path.normpath(value) == value, 'AUDIT_PATH_UNSAFE')
    path = Path(value)
    for part in [path, *path.parents]:
        require(not part.is_symlink(), 'AUDIT_PATH_UNSAFE')
    require(path.is_dir() if directory else path.is_file(), 'AUDIT_PATH_UNSAFE')
    return path


def snapshot(root: Path, paths: list[str] | None = None) -> tuple[list[dict], dict[str, bytes]]:
    if paths is None:
        paths = []
        for current, directories, names in os.walk(root, followlinks=False):
            for name in sorted(directories + names):
                file = Path(current) / name
                relative = file.relative_to(root).as_posix()
                try:
                    distribution.safe_path(relative)
                except ValueError:
                    raise ValueError('UNSAFE_ARTIFACT_ENTRY') from None
                info = file.lstat()
                require(not stat.S_ISLNK(info.st_mode), 'UNSAFE_ARTIFACT_ENTRY')
                if stat.S_ISDIR(info.st_mode):
                    continue
                require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'UNSAFE_ARTIFACT_ENTRY')
                paths.append(relative)
                require(len(paths) <= POLICY['maximum_files'], 'ARTIFACT_SIZE_LIMIT')
    require(bool(paths) and len(paths) <= POLICY['maximum_files'], 'ARTIFACT_SIZE_LIMIT')
    require(len({p.casefold() for p in paths}) == len(paths), 'ARTIFACT_PATH_COLLISION')
    content, rows, total = {}, [], 0
    for relative in sorted(paths):
        file = root / relative
        info = file.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'UNSAFE_ARTIFACT_ENTRY')
        total += info.st_size
        require(info.st_size <= POLICY['maximum_file_bytes'] and total <= POLICY['maximum_total_bytes'], 'ARTIFACT_SIZE_LIMIT')
        data = distribution.read_regular(root, relative)
        require(len(data) == info.st_size, 'ARTIFACT_CHANGED_DURING_AUDIT')
        content[relative] = data
        rows.append({'path': relative, 'size': len(data), 'sha256': sha(data),
                     'mode': '100755' if info.st_mode & 0o111 else '100644'})
    return rows, content


class Findings:
    def __init__(self):
        self.rows: list[dict] = []

    def add(self, code: str, subject: str, detail: str, *, severity: str = 'high', local: bool = True) -> None:
        self.rows.append({'id': f'RIFARE-RELEASE-{len(self.rows) + 1:04d}', 'code': code, 'subject': subject,
                          'severity': severity, 'detail': detail, 'local_check_failure': local})


def observe_packages(content: dict[str, bytes], findings: Findings) -> tuple[list[dict], list[dict], list[dict]]:
    inputs, packages, declarations = [], {}, []
    locks: dict[str, dict[str, dict]] = {}
    manifests: dict[str, dict] = {}

    def add(name: str, version: str, location: str, kind: str, path: str, license_value: Any,
            *, integrity: Any = None, direct: bool = False) -> dict:
        identity = f'npm:{name}@{version}:{location or "."}'
        row = packages.setdefault(identity, {'id': identity, 'name': name, 'version': version,
                                             'location': location or '.', 'direct': direct, 'observations': []})
        row['direct'] = row['direct'] or direct
        row['observations'].append({'kind': kind, 'path': path, 'sha256': sha(content[path]),
                                    'license_declared': license_value if type(license_value) is str else 'NOASSERTION',
                                    'integrity_declared': integrity if type(integrity) is str else None})
        return row

    for path, data in sorted(content.items()):
        if not distribution.dependency_path(path):
            continue
        inputs.append({'path': path, 'sha256': sha(data)})
        base = PurePosixPath(path).name
        if base not in {'package.json', 'package-lock.json'}:
            findings.add('UNSUPPORTED_DEPENDENCY_INPUT', path, 'This dependency or build input needs its own reviewed inventory.')
            continue
        try:
            document = distribution.decode_json(data)
        except (ValueError, UnicodeError):
            findings.add('DEPENDENCY_MANIFEST_INVALID', path, 'Dependency JSON is invalid or contains duplicate keys.')
            continue
        directory = PurePosixPath(path).parent.as_posix()
        directory = '' if directory == '.' else directory
        if base == 'package.json':
            manifests[directory] = {'path': path, 'document': document}
        else:
            if document.get('lockfileVersion') != 3 or type(document.get('packages')) is not dict or '' not in document['packages']:
                findings.add('DEPENDENCY_MANIFEST_INVALID', path, 'Only an explicit npm v3 packages map is observed.')
                continue
            locks[directory] = {}
            for location, metadata in document['packages'].items():
                if location == '':
                    continue
                try:
                    distribution.safe_path(location)
                except (ValueError, TypeError):
                    findings.add('DEPENDENCY_MANIFEST_INVALID', path, 'The lock contains a nonportable package location.')
                    continue
                if type(metadata) is not dict or metadata.get('link') is True or 'node_modules/' not in location:
                    findings.add('DEPENDENCY_MANIFEST_INVALID', path, 'Linked or unsupported lock entries require separate intake.')
                    continue
                version = metadata.get('version')
                name = metadata.get('name') or location.rsplit('node_modules/', 1)[1]
                if type(name) is not str or not name or type(version) is not str or not version:
                    findings.add('DEPENDENCY_MANIFEST_INVALID', path, 'Every observed lock package needs a name and exact version.')
                    continue
                full_location = '/'.join(x for x in [directory, location] if x)
                row = add(name, version, full_location, 'lockfile', path, metadata.get('license'), integrity=metadata.get('integrity'))
                locks[directory][location] = {'id': row['id'], 'name': name, 'version': version}
                findings.add('DEPENDENCY_INTAKE_REQUIRED', row['id'], 'Nonempty package graphs have no accepted distribution intake.')

    for directory, item in sorted(manifests.items()):
        path, document = item['path'], item['document']
        name, version = document.get('name'), document.get('version')
        if type(name) is not str or not name or type(version) is not str or not version:
            findings.add('DEPENDENCY_MANIFEST_INVALID', path, 'Every package manifest needs a name and exact version.')
            continue
        row = add(name, version, directory, 'artifact_manifest', path, document.get('license'))
        if directory:
            locked = any(x['id'] == row['id'] for locations in locks.values() for x in locations.values())
            if not locked:
                findings.add('ARTIFACT_PACKAGE_NOT_LOCKED', row['id'], 'An installed or nested package is absent from its observed lock graph.')
            findings.add('DEPENDENCY_INTAKE_REQUIRED', row['id'], 'Installed and nested packages require explicit source, integrity and license intake.')
            findings.add('DEPENDENCY_LICENSE_UNREVIEWED', row['id'], 'A declared license string alone does not establish redistribution rights.')
        for field in DEPENDENCY_FIELDS:
            values = document.get(field, {})
            if type(values) is not dict:
                findings.add('DEPENDENCY_MANIFEST_INVALID', path, 'Dependency declarations must be name-to-requirement objects.')
                continue
            for dependency, requirement in sorted(values.items()):
                if type(dependency) is not str or not dependency or type(requirement) is not str or not requirement:
                    findings.add('DEPENDENCY_MANIFEST_INVALID', path, 'Dependency declarations require nonempty names and requirements.')
                    continue
                installed = f'node_modules/{dependency}'
                locked = locks.get(directory, {}).get(installed)
                declarations.append({'manifest': path, 'field': field, 'name': dependency, 'requested': requirement,
                                     'locked_package_id': locked['id'] if locked else None})
                if locked:
                    packages[locked['id']]['direct'] = directory == ''
                    if locked['name'] != dependency:
                        findings.add('DEPENDENCY_MANIFEST_INVALID', path, 'Dependency alias or identity mismatch needs explicit intake.')
                else:
                    location = '/'.join(x for x in [directory, installed] if x)
                    add(dependency, 'NOASSERTION', location, 'declaration_without_lock', path, None, direct=directory == '')
                    findings.add('DECLARED_DEPENDENCY_NOT_LOCKED', path, f'{field} declaration has no exact locked package: {dependency}')
    for row in packages.values():
        row['observations'].sort(key=lambda x: (x['path'], x['kind']))
    return sorted(packages.values(), key=lambda x: x['id']), inputs, sorted(declarations, key=lambda x: (x['manifest'], x['field'], x['name']))


def pinned_document(value: Any, findings: Findings, label: str) -> dict | None:
    try:
        exact(value, {'path', 'sha256'})
        require(pin(value['sha256']), 'AUDIT_INPUT_INVALID')
        path = real_path(value['path'], False)
        info = path.lstat()
        require(info.st_nlink == 1 and info.st_size <= POLICY['maximum_evidence_bytes'], 'AUDIT_INPUT_INVALID')
        data = path.read_bytes()
        if sha(data) != value['sha256']:
            findings.add('EVIDENCE_PIN_MISMATCH', label, 'Evidence bytes differ from the separately retained SHA-256.')
            return None
        return distribution.decode_json(data)
    except (ValueError, OSError, UnicodeError):
        findings.add('EVIDENCE_INVALID', label, 'Evidence must be a bounded pinned regular JSON object without duplicate keys.')
        return None


def scan_evidence(inputs: list, sbom: dict, provenance: dict, artifact_sha: str, findings: Findings, now: int) -> list[dict]:
    observations, kinds, current_kinds = [], set(), set()
    package_ids = sorted(x['id'] for x in sbom['packages'])
    file_paths = [x['path'] for x in sbom['files']]
    for index, input_pin in enumerate(inputs):
        label = f'scan_evidence[{index}]'
        evidence = pinned_document(input_pin, findings, label)
        if evidence is None:
            continue
        count_before = len(findings.rows)
        try:
            exact(evidence, {'version', 'kind', 'scanner', 'scanned_at', 'source_commit', 'source_tree', 'artifact_sha256',
                             'sbom_sha256', 'artifact_paths', 'package_ids', 'advisory_database', 'findings'})
            require(evidence['version'] == 1 and evidence['kind'] in POLICY['required_scan_types'], 'SCAN_SCHEMA_INVALID')
            exact(evidence['scanner'], {'name', 'version', 'rules_sha256'})
            require(all(type(evidence['scanner'][k]) is str and evidence['scanner'][k].strip() for k in ('name', 'version'))
                    and pin(evidence['scanner']['rules_sha256']), 'SCAN_SCHEMA_INVALID')
            require(type(evidence['scanned_at']) is int and type(evidence['artifact_paths']) is list
                    and type(evidence['package_ids']) is list and type(evidence['findings']) is list, 'SCAN_SCHEMA_INVALID')
            if evidence['kind'] in kinds:
                findings.add('DUPLICATE_SCAN_KIND', label, 'Conflicting scans are not resolved by taking the last object.')
            kinds.add(evidence['kind'])
            if not 0 <= now - evidence['scanned_at'] <= POLICY['scan_max_age_ms']:
                findings.add('SCAN_STALE_OR_FUTURE', label, 'Scan time must be within the fixed current 24-hour window.')
            if (evidence['source_commit'], evidence['source_tree'], evidence['artifact_sha256'], evidence['sbom_sha256']) != (
                    provenance['source_commit'], provenance['source_tree'], artifact_sha, digest(sbom)):
                findings.add('SCAN_SUBJECT_MISMATCH', label, 'Scan source, artifact and complete SBOM pins must all match.')
            if evidence['artifact_paths'] != file_paths:
                findings.add('SCAN_FILE_COVERAGE_MISMATCH', label, 'A scan must enumerate every exact artifact path once, in order.')
            if evidence['package_ids'] != package_ids:
                findings.add('SCAN_PACKAGE_COVERAGE_MISMATCH', label, 'A scan must enumerate every observed package identity once, in order.')
            if evidence['kind'] == 'dependency_vulnerabilities':
                database = evidence['advisory_database']
                exact(database, {'sha256', 'updated_at'})
                require(pin(database['sha256']) and type(database['updated_at']) is int, 'SCAN_SCHEMA_INVALID')
                if not 0 <= now - database['updated_at'] <= POLICY['advisory_database_max_age_ms'] or database['updated_at'] > evidence['scanned_at']:
                    findings.add('ADVISORY_DATABASE_STALE_OR_FUTURE', label, 'Advisory data must be current and no newer than the actual scan.')
            else:
                require(evidence['advisory_database'] is None, 'SCAN_SCHEMA_INVALID')
            seen = set()
            for finding in evidence['findings']:
                exact(finding, {'id', 'severity', 'package_id', 'path', 'state', 'closure_ref'})
                require(type(finding['id']) is str and finding['id'].strip() and finding['id'] not in seen
                        and finding['severity'] in {'critical', 'high', 'medium', 'low'}
                        and finding['state'] in {'open', 'resolved', 'mitigated'}
                        and (finding['closure_ref'] is None or type(finding['closure_ref']) is str), 'SCAN_SCHEMA_INVALID')
                seen.add(finding['id'])
                require(finding['package_id'] in package_ids or finding['path'] in file_paths, 'SCAN_FINDING_SUBJECT_INVALID')
                require(finding['package_id'] is None or finding['package_id'] in package_ids, 'SCAN_FINDING_SUBJECT_INVALID')
                require(finding['path'] is None or finding['path'] in file_paths, 'SCAN_FINDING_SUBJECT_INVALID')
                if finding['severity'] in {'critical', 'high'}:
                    code = 'HIGH_SECURITY_FINDING' if finding['state'] == 'open' else 'HIGH_FINDING_CLOSURE_UNVERIFIED'
                    findings.add(code, finding['id'], 'A critical/high finding or its claimed closure requires independent resolution.', severity=finding['severity'])
            consistent = not any(x['code'] not in {'HIGH_SECURITY_FINDING', 'HIGH_FINDING_CLOSURE_UNVERIFIED'}
                                 for x in findings.rows[count_before:])
            if consistent:
                current_kinds.add(evidence['kind'])
            observations.append({'kind': evidence['kind'], 'sha256': input_pin['sha256'], 'scanner': evidence['scanner'],
                                 'scanned_at': evidence['scanned_at'], 'findings': evidence['findings'],
                                 'internally_consistent': consistent, 'authenticated': False})
        except (ValueError, TypeError, KeyError):
            findings.add('SCAN_SCHEMA_INVALID', label, 'Scan coverage, subject identity or finding schema is invalid.')
    for kind in POLICY['required_scan_types']:
        if kind not in current_kinds:
            findings.add('REQUIRED_SCAN_MISSING', kind, 'No current, exact-candidate external scan has been supplied.', local=False)
    findings.add('EXTERNAL_ATTESTATION_UNAUTHENTICATED', 'external_evidence',
                 'Byte-pinned JSON does not authenticate a scanner, advisory source, reviewer or approval identity.', local=False)
    return observations


def audit(request: dict) -> dict:
    exact(request, {'version', 'source_root', 'artifact_root', 'expected_source', 'expected_artifact_sha256'}, {'reviewed_sbom', 'scan_evidence'})
    exact(request['expected_source'], {'commit', 'tree'})
    require(request['version'] == 1 and pin(request['expected_artifact_sha256'])
            and pin(request['expected_source']['commit'], 40) and pin(request['expected_source']['tree'], 40), 'AUDIT_INPUT_INVALID')
    scans = request.get('scan_evidence', [])
    require(type(scans) is list and len(scans) <= 8, 'AUDIT_INPUT_INVALID')
    source, artifact = real_path(request['source_root'], True), real_path(request['artifact_root'], True)
    require(source != artifact and source not in artifact.parents and artifact not in source.parents, 'SEPARATE_ARTIFACT_DIRECTORY_REQUIRED')
    observed_at, findings = int(time.time() * 1000), Findings()
    source_commit = distribution.git(source, 'rev-parse', 'HEAD').strip()
    source_tree = distribution.git(source, 'rev-parse', 'HEAD^{tree}').strip()
    initial_status = distribution.git(source, 'status', '--porcelain', '--untracked-files=all')
    if initial_status.strip():
        findings.add('SOURCE_NOT_CLEAN', 'source', 'A clean committed source candidate is required.')
    if source_commit != request['expected_source']['commit'] or source_tree != request['expected_source']['tree']:
        findings.add('SOURCE_PIN_MISMATCH', 'source', 'Native Git candidate identity differs from the retained request.')
    source_paths = distribution.checkout_paths(source)
    source_files, source_content = snapshot(source, source_paths)
    artifact_files, content = snapshot(artifact)
    artifact_sha = digest(artifact_files)
    if artifact_sha != request['expected_artifact_sha256']:
        findings.add('ARTIFACT_PIN_MISMATCH', 'artifact', 'Staged membership or bytes changed after the retained artifact pin.')
    if artifact_files != source_files:
        findings.add('ARTIFACT_SOURCE_MISMATCH', 'artifact', 'Every staged path and byte must match the clean committed source snapshot.')
    try:
        manifest = distribution.build_manifest(source)
        distribution_review = {'result': 'pass', 'manifest_sha256': digest(manifest), 'files_reviewed': len(manifest['files'])}
    except (ValueError, OSError, TypeError, KeyError, UnicodeError):
        findings.add('DISTRIBUTION_REVIEW_BLOCKED', 'source', 'The unchanged source inventory, package-input, attribution or licensing gate rejected this checkout.')
        distribution_review = {'result': 'blocked', 'manifest_sha256': None, 'files_reviewed': 0}
    inventory = distribution.decode_json(source_content[distribution.INVENTORY_PATH])
    licensing_policy = distribution.decode_json(source_content[distribution.POLICY_PATH])
    require(type(inventory.get('components')) is list, 'AUDIT_INVENTORY_INVALID')
    members, components = {}, []
    for component in inventory['components']:
        require(type(component) is dict and type(component.get('files')) is list, 'AUDIT_INVENTORY_INVALID')
        components.append({key: component.get(key) for key in ('id', 'origin', 'license_declared', 'license_status', 'disposition', 'classification', 'notices')})
        for path in component['files']:
            require(type(path) is str, 'AUDIT_INVENTORY_INVALID')
            if path in members:
                findings.add('SOURCE_INVENTORY_DUPLICATE', path, 'Source inventory declares the same path more than once.')
            members[path] = component
        if component.get('license_declared') == 'NOASSERTION' or component.get('license_status') != 'approved':
            findings.add('SOURCE_LICENSE_UNRESOLVED', str(component.get('id')), 'Declared licenses and modification rights remain subject to retained owner and attribution decisions.', local=False)
    packages, dependency_inputs, declarations = observe_packages(content, findings)
    for file in artifact_files:
        if distribution.private_path(file['path']):
            findings.add('PRIVATE_ARTIFACT_PATH', file['path'], 'The retained distribution rules exclude this private, runtime or credential path.')
        if file['path'] not in members:
            findings.add('UNREVIEWED_ARTIFACT_FILE', file['path'], 'No reviewed inventory component owns this artifact path.')
    for path, data in content.items():
        try:
            text = data.decode('utf-8')
        except UnicodeError:
            findings.add('BINARY_ASSET_UNREVIEWED', path, 'A binary asset needs an explicit format, provenance and security review.')
            continue
        for rule in POLICY['secret_rules']:
            match = re.search(rule['pattern'], text)
            if match:
                findings.add('LOCAL_SECRET_PATTERN', path, f'Rule {rule["id"]} matched on line {text.count(chr(10), 0, match.start()) + 1}; matched bytes are withheld.')
    sbom = {'version': 1, 'kind': 'rifare-source-sbom', 'artifact_kind': POLICY['artifact_kind'],
            'files': [{**file, 'component_id': members.get(file['path'], {}).get('id', 'UNREVIEWED'),
                       'classification': members.get(file['path'], {}).get('classification', 'UNREVIEWED')} for file in artifact_files],
            'components': sorted(components, key=lambda x: x['id']), 'packages': packages,
            'dependency_inputs': dependency_inputs, 'dependency_declarations': declarations,
            'external_requirements': inventory.get('external_requirements'), 'third_party_package_intake_supported': False}
    provenance = {'version': 1, 'kind': 'rifare-offline-source-provenance', 'source_commit': source_commit, 'source_tree': source_tree,
                  'source_files_sha256': digest(source_files), 'artifact_sha256': artifact_sha,
                  'inventory_sha256': sha(source_content[distribution.INVENTORY_PATH]),
                  'licensing_policy_sha256': sha(source_content[distribution.POLICY_PATH]), 'sbom_sha256': digest(sbom),
                  'materials': dependency_inputs, 'materials_scope': 'artifact_dependency_inputs_no_build_executed',
                  'source_materials': [{'path': x['path'], 'sha256': sha(source_content[x['path']])}
                                       for x in dependency_inputs if x['path'] in source_content],
                  'builder': {'kind': 'source_directory_inspection_no_build', 'python': sys.version.split()[0],
                              'audit_driver_sha256': sha(Path(__file__).read_bytes()), 'distribution_checker_sha256': sha(CHECKER.read_bytes()),
                              'audit_contract_sha256': sha(CONTRACT.read_bytes()),
                              'node_api_sha256': sha((ROOT / 'packages/security/release-audit.mts').read_bytes()),
                              'node_cli_sha256': sha((ROOT / 'tools/audit-release.mts').read_bytes())},
                  'build_executed': False, 'independent_builder_authenticated': False}
    reviewed_sbom = None
    if 'reviewed_sbom' in request:
        reviewed_sbom = pinned_document(request['reviewed_sbom'], findings, 'reviewed_sbom')
        if reviewed_sbom is not None and reviewed_sbom != sbom:
            findings.add('REVIEWED_SBOM_MISMATCH', 'reviewed_sbom', 'The independently retained SBOM omits, alters or invents artifact files, package observations or source obligations.')
    else:
        findings.add('REVIEWED_SBOM_MISSING', 'reviewed_sbom', 'Retain this complete SBOM independently and review its exact artifact before release consideration.', local=False)
    external = scan_evidence(scans, sbom, provenance, artifact_sha, findings, observed_at)
    for requirement in licensing_policy.get('release_requirements', []):
        findings.add('RETAINED_RELEASE_PREREQUISITE', str(requirement), 'The existing release requirement has no authenticated completion in this offline audit.', local=False)
    findings.add('OWNER_RELEASE_DECISION_REQUIRED', 'release', 'A specifically scoped owner release decision and independently authenticated reviews are absent.', local=False)
    findings.add('CURRENT_VULNERABILITY_CLEARANCE_UNAVAILABLE', 'dependencies', 'No trusted current vulnerability database or authenticated scan result is available to this checker.', local=False)
    # Owned snapshots must remain stable through report construction. This is not a filesystem isolation primitive.
    final_artifact, _ = snapshot(artifact)
    final_source, _ = snapshot(source, distribution.checkout_paths(source))
    if (final_artifact != artifact_files or final_source != source_files
            or distribution.git(source, 'rev-parse', 'HEAD').strip() != source_commit
            or distribution.git(source, 'status', '--porcelain', '--untracked-files=all') != initial_status):
        findings.add('SNAPSHOT_CHANGED_DURING_AUDIT', 'source_or_artifact', 'Source or artifact changed during this observation.')
    return {'version': 1, 'result': 'blocked', 'local_checks': 'fail' if any(x['local_check_failure'] for x in findings.rows) else 'pass',
            'observed_at': observed_at, 'artifact': {'kind': POLICY['artifact_kind'], 'sha256': artifact_sha, 'file_count': len(artifact_files)},
            'distribution': distribution_review, 'sbom': sbom, 'sbom_sha256': digest(sbom), 'provenance': provenance,
            'provenance_sha256': digest(provenance), 'scans': {'local': {'contract_sha256': sha(CONTRACT.read_bytes()),
               'rule_ids': [x['id'] for x in POLICY['secret_rules']], 'files_inspected': len(content)}, 'external': external},
            'findings': findings.rows, 'release_authorized': False, 'publication_authorized': False, 'legal_clearance': False,
            'vulnerability_clearance': False, 'production_qualified': False, 'reviewer_authentication': False,
            'full_history_scanned': False, 'limits': POLICY['limits']}


def main() -> int:
    try:
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        require(len(raw) <= 1024 * 1024, 'AUDIT_INPUT_SIZE_LIMIT')
        request = distribution.decode_json(raw)
        if len(sys.argv) == 2 and sys.argv[1] == 'inventory':
            exact(request, {'artifact_root'})
            rows, _ = snapshot(real_path(request['artifact_root'], True))
            report = {'version': 1, 'kind': POLICY['artifact_kind'], 'files': rows, 'artifact_sha256': digest(rows),
                      'release_authorized': False, 'reviewed': False}
            code = 0
        else:
            require(len(sys.argv) == 2 and sys.argv[1] == 'audit', 'AUDIT_MODE_INVALID')
            report, code = audit(request), 1
        print(json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False))
        return code
    except (ValueError, OSError, KeyError, TypeError, UnicodeError) as error:
        # Do not echo potentially secret input or arbitrary decoder exception text.
        safe = str(error) if re.fullmatch(r'[A-Z][A-Z0-9_]{1,100}', str(error)) else 'RELEASE_AUDIT_INPUT_OR_SOURCE_INVALID'
        print(json.dumps({'version': 1, 'result': 'blocked', 'local_checks': 'fail', 'error': safe,
                          'release_authorized': False, 'publication_authorized': False,
                          'vulnerability_clearance': False, 'production_qualified': False}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
