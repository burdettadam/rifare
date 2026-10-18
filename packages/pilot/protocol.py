#!/usr/bin/env python3
"""Bounded caller-owned pilot artifacts. Reuse the frozen scorer; never authorize a pilot."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / 'packages/pilot/contracts/protocol.v1.json'
MAX_INPUT = 1024 * 1024
MAX_BLOCK = 512 * 1024
MAX_STORE = 16 * 1024 * 1024
MAX_CASES = 1000
MAX_BATCHES = 256
MAX_EVENTS = 10000
MATERIALS = ('profile', 'skill', 'policy', 'runtime', 'model', 'adapter')
COSTS = ('model', 'messaging', 'shipping', 'hosting', 'operator')
SEVERITY = ('none', 'SEV3', 'SEV2', 'SEV1', 'SEV0')
REF_FIELDS = ('version', 'directory', 'registration_sha256', 'head')
BOUNDARY = {'pilot_authorized': False, 'verified_live_observations': 0, 'release_authorized': False,
            'qualified': False, 'authorization_refs_authenticated': False, 'source_pins_authenticated': False}


class Invalid(ValueError):
    pass


def need(value, code='PILOT_INPUT_INVALID'):
    if not value:
        raise Invalid(code)


def shape(value, names):
    need(type(value) is dict and set(value) == set(names), 'PILOT_SHAPE')
    return value


def ref(value, optional=False):
    if optional and value is None:
        return
    need(type(value) is str and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/#@+\-]{0,255}', value), 'PILOT_REFERENCE_INVALID')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def pin(value, length=64):
    need(type(value) is str and re.fullmatch('[0-9a-f]{' + str(length) + '}', value), 'PILOT_PIN_INVALID')


def timestamp(value):
    need(type(value) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', value), 'PILOT_TIMESTAMP_INVALID')
    try:
        return datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    except ValueError:
        raise Invalid('PILOT_TIMESTAMP_INVALID') from None


def now():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def pairs(items):
    result = {}
    for key, value in items:
        need(key not in result, 'PILOT_JSON_INVALID')
        result[key] = value
    return result


def parse(raw):
    try:
        return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(Invalid('PILOT_JSON_INVALID')))
    except (UnicodeError, json.JSONDecodeError, RecursionError):
        raise Invalid('PILOT_JSON_INVALID') from None


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False) + '\n').encode('utf-8')


def path_parts(value):
    need(type(value) is str and len(value) <= 4096 and value.startswith('/') and '\x00' not in value, 'PILOT_PATH_UNSAFE')
    parts = value.split('/')[1:]
    need(parts and all(p not in ('', '.', '..') for p in parts), 'PILOT_PATH_UNSAFE')
    return parts


def open_dir(path):
    parts = path_parts(path)
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for name in parts:
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except OSError:
        os.close(fd)
        raise Invalid('PILOT_PATH_UNSAFE') from None


def parent_dir(path):
    parts = path_parts(path)
    return (open_dir('/' + '/'.join(parts[:-1])) if len(parts) > 1 else os.open('/', os.O_RDONLY | os.O_DIRECTORY)), parts[-1]


def read_at(fd, name, limit=MAX_INPUT, private=False):
    try:
        file_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    except OSError:
        raise Invalid('PILOT_PATH_UNSAFE') from None
    try:
        info = os.fstat(file_fd)
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'PILOT_PATH_UNSAFE')
        if private:
            need(info.st_uid == os.getuid() and info.st_mode & 0o777 == 0o600, 'PILOT_PATH_UNSAFE')
        need(0 <= info.st_size <= limit, 'PILOT_INPUT_LIMIT')
        chunks, total = [], 0
        while True:
            chunk = os.read(file_fd, min(65536, limit + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            need(total <= limit, 'PILOT_INPUT_LIMIT')
        need(os.fstat(file_fd).st_size == info.st_size == total, 'PILOT_FILE_CHANGED')
        return b''.join(chunks)
    finally:
        os.close(file_fd)


def read_path(path, expected=None):
    fd, name = parent_dir(path)
    try:
        raw = read_at(fd, name)
    finally:
        os.close(fd)
    if expected is not None:
        pin(expected)
        need(digest(raw) == expected, 'PILOT_FILE_PIN')
    return raw


def read_pinned(value):
    shape(value, ('path', 'sha256'))
    return read_path(value['path'], value['sha256'])


def write_new(fd, name, raw):
    try:
        out = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
    except FileExistsError:
        raise Invalid('PILOT_NO_OVERWRITE') from None
    try:
        view = memoryview(raw)
        while view:
            count = os.write(out, view)
            need(count > 0, 'PILOT_WRITE_FAILED')
            view = view[count:]
        os.fsync(out)
    finally:
        os.close(out)
    os.fsync(fd)


def names_at(fd, limit):
    result = []
    with os.scandir(fd) as entries:
        for e in entries:
            result.append(e.name)
            need(len(result) <= limit, 'PILOT_STORE_MEMBERSHIP')
    return sorted(result)


@contextmanager
def locked(path):
    fd = open_dir(path)
    acquired = False
    try:
        info = os.fstat(fd)
        need(info.st_uid == os.getuid() and info.st_mode & 0o777 == 0o700, 'PILOT_PATH_UNSAFE')
        try:
            lock = os.open('.writer.lock', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
        except FileExistsError:
            raise Invalid('PILOT_STORE_BUSY') from None
        acquired = True
        os.close(lock)
        yield fd
    finally:
        if acquired:
            os.unlink('.writer.lock', dir_fd=fd)
            os.fsync(fd)
        os.close(fd)


def controls():
    contract = parse(CONTRACT.read_bytes())
    for p in contract['controls']:
        need(digest((ROOT / p['path']).read_bytes()) == p['sha256'], 'PILOT_CONTROL_DRIFT')
    sys.path.insert(0, str(ROOT / 'tools'))
    import check_release_benchmark as scorer
    benchmark = parse((ROOT / 'planning/release-benchmark.json').read_bytes())
    envelope = parse((ROOT / 'planning/support-envelope.json').read_bytes())
    baseline = parse((ROOT / 'tests/fixtures/release-benchmark/expected-benchmark.v1.json').read_bytes())
    need(not scorer.validate_benchmark(benchmark, ROOT) and not scorer.compare_benchmarks(benchmark, baseline), 'PILOT_CONTROL_DRIFT')
    implementation = [{'path': name, 'sha256': digest((ROOT / name).read_bytes())} for name in (
        'packages/pilot/protocol.py', 'packages/pilot/protocol.mts', 'packages/pilot/contracts/protocol.v1.json',
        'tools/pilot-protocol.mts', 'packages/development/config.mts')]
    return contract, scorer, benchmark, envelope, implementation


def source_shape(value):
    shape(value, ('commit', 'tree', 'artifact_sha256'))
    pin(value['commit'], 40)
    pin(value['tree'], 40)
    pin(value['artifact_sha256'])


def registration(request, context):
    contract, _, _, _, implementation = context
    shape(request, ('version', 'directory', 'manifest', 'benchmark_sha256', 'source', 'configurations', 'authority_refs'))
    need(type(request['version']) is int and request['version'] == 1, 'PILOT_VERSION')
    need(request['benchmark_sha256'] == contract['benchmark_sha256'], 'PILOT_BENCHMARK_PIN')
    source_shape(request['source'])
    shape(request['authority_refs'], ('owner_ref', 'consent_ref', 'privacy_review_ref', 'retention_ref'))
    for value in request['authority_refs'].values():
        ref(value)
    raw = read_pinned(request['manifest'])
    manifest = parse(raw)
    need(type(manifest) is dict and type(manifest.get('cases')) is list and 0 < len(manifest['cases']) <= MAX_CASES, 'PILOT_COHORT_LIMIT')
    configurations = request['configurations']
    need(type(configurations) is list and len(configurations) == len(manifest.get('strata', [])), 'PILOT_CONFIGURATION_MEMBERSHIP')
    seen = set()
    for c in configurations:
        shape(c, ('stratum_id', 'materials'))
        ref(c['stratum_id'])
        need(c['stratum_id'] not in seen, 'PILOT_CONFIGURATION_MEMBERSHIP')
        seen.add(c['stratum_id'])
        shape(c['materials'], MATERIALS)
        for value in c['materials'].values():
            pin(value)
    need(seen == {s['id'] for s in manifest['strata']}, 'PILOT_CONFIGURATION_MEMBERSHIP')
    header = {'version': 1, 'manifest_sha256': digest(raw), 'benchmark_sha256': request['benchmark_sha256'],
              'source': request['source'], 'configurations': configurations, 'authority_refs': request['authority_refs'],
              'controls': contract['controls'], 'implementation': implementation, 'stored_at': now()}
    # All membership, scope, mode and frozen-window checks belong to the unchanged scorer.
    project(header, manifest, [], context, {'sequence': 0, 'sha256': digest(encoded(header))})
    parent, name = parent_dir(request['directory'])
    fd = None
    try:
        try:
            os.mkdir(name, 0o700, dir_fd=parent)
        except FileExistsError:
            raise Invalid('PILOT_NO_OVERWRITE') from None
        fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        write_new(fd, 'manifest.json', raw)
        write_new(fd, 'registration.json', encoded(header))
        os.mkdir('events', 0o700, dir_fd=fd)
        os.fsync(fd)
        os.fsync(parent)
    finally:
        if fd is not None:
            os.close(fd)
        os.close(parent)
    return {'registration_sha256': digest(encoded(header)), 'head': {'sequence': 0, 'sha256': digest(encoded(header))},
            'enrolled_cases': len(manifest['cases']), 'frozen_at_claimed': manifest['enrollment_frozen_at'],
            'enrollment_predated_outcomes_verified': False}


def reference_shape(request, extra=()):
    shape(request, (*REF_FIELDS, *extra))
    need(type(request['version']) is int and request['version'] == 1, 'PILOT_VERSION')
    pin(request['registration_sha256'])
    shape(request['head'], ('sequence', 'sha256'))
    need(type(request['head']['sequence']) is int and 0 <= request['head']['sequence'] <= MAX_BATCHES, 'PILOT_HEAD_PIN')
    pin(request['head']['sha256'])


def load_store(fd, request, context):
    need(set(names_at(fd, 4)) == {'registration.json', 'manifest.json', 'events', '.writer.lock'}, 'PILOT_STORE_MEMBERSHIP')
    raw = read_at(fd, 'registration.json', private=True)
    need(digest(raw) == request['registration_sha256'], 'PILOT_REGISTRATION_PIN')
    header = parse(raw)
    shape(header, ('version', 'manifest_sha256', 'benchmark_sha256', 'source', 'configurations', 'authority_refs', 'controls', 'implementation', 'stored_at'))
    contract, _, _, _, implementation = context
    need(header['controls'] == contract['controls'] and header['benchmark_sha256'] == contract['benchmark_sha256']
         and header['implementation'] == implementation, 'PILOT_CONTROL_DRIFT')
    manifest_raw = read_at(fd, 'manifest.json', private=True)
    need(digest(manifest_raw) == header['manifest_sha256'], 'PILOT_FILE_PIN')
    try:
        events_fd = os.open('events', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
    except OSError:
        raise Invalid('PILOT_PATH_UNSAFE') from None
    blocks, size = [], len(raw) + len(manifest_raw)
    head = {'sequence': 0, 'sha256': digest(raw)}
    try:
        info = os.fstat(events_fd)
        need(info.st_uid == os.getuid() and info.st_mode & 0o777 == 0o700, 'PILOT_PATH_UNSAFE')
        names = names_at(events_fd, MAX_BATCHES)
        need(len(names) <= MAX_BATCHES and names == [f'{i:08}.json' for i in range(1, len(names) + 1)], 'PILOT_STORE_MEMBERSHIP')
        for i, name in enumerate(names, 1):
            raw = read_at(events_fd, name, MAX_BLOCK, private=True)
            size += len(raw)
            need(size <= MAX_STORE, 'PILOT_STORE_LIMIT')
            block = parse(raw)
            shape(block, ('version', 'sequence', 'previous_sha256', 'registration_sha256', 'recorded_at', 'events'))
            need(block['version'] == 1 and type(block['sequence']) is int and block['sequence'] == i
                 and block['registration_sha256'] == request['registration_sha256'] and block['previous_sha256'] == head['sha256'], 'PILOT_CHAIN_INVALID')
            timestamp(block['recorded_at'])
            blocks.append(block)
            head = {'sequence': i, 'sha256': digest(raw)}
        need(head == request['head'], 'PILOT_HEAD_PIN')
    finally:
        os.close(events_fd)
    return header, parse(manifest_raw), blocks, size


def pending(case_id, cutoff):
    return {'case_id': case_id, 'disposition': 'pending', 'oracle_verdict': 'unassessed', 'oracle_ref': None,
            'actor': 'none', 'agent_attempted': False, 'autonomous_resolution': False, 'observed_at': cutoff,
            'completed_at': None, 'followup_through': None, 'repeat_contact': None, 'repeat_ref': None,
            'severity': 'none', 'cost_minor': None, 'operator_seconds': None}


def project(header, manifest, blocks, context, head):
    contract, scorer, benchmark, envelope, _ = context
    try:
        cutoff = timestamp(manifest['observation_cutoff'])
        frozen = timestamp(manifest['enrollment_frozen_at'])
        cases = {c['id']: c for c in manifest['cases']}
        rows = {key: pending(key, manifest['observation_cutoff']) for key in cases}
        states = {key: {'case_id': key, 'observation_recorded': False, 'observation_ref': None, 'observation_sha256': None,
                       'adjudication_event_id': None, 'adjudication_sha256': None, 'cost_event_id': None, 'censored': False,
                       'withdrawn': False, 'unavailable': False, 'reopened_in_window': False} for key in cases}
        seen, exceptions = set(), []
        late = 0
        for block in blocks:
            need(type(block['events']) is list and 0 < len(block['events']) <= 100, 'PILOT_EVENT_LIMIT')
            recorded = timestamp(block['recorded_at'])
            for e in block['events']:
                shape(e, ('id', 'kind', 'case_id', 'evidence_ref', 'evidence_sha256', 'happened_at', 'payload'))
                for key in ('id', 'case_id', 'evidence_ref'):
                    ref(e[key])
                pin(e['evidence_sha256'])
                need(e['id'] not in seen, 'PILOT_EVENT_DUPLICATE')
                seen.add(e['id'])
                need(len(seen) <= MAX_EVENTS, 'PILOT_EVENT_LIMIT')
                need(e['case_id'] in cases, 'PILOT_UNKNOWN_CASE')
                happened = timestamp(e['happened_at'])
                need(frozen <= happened <= recorded, 'PILOT_EVENT_WINDOW')
                kind, data = e['kind'], e['payload']
                row, state = rows[e['case_id']], states[e['case_id']]
                if kind == 'observation':
                    shape(data, ('disposition', 'actor', 'agent_attempted', 'completed_at'))
                    need(not state['observation_recorded'] or row['disposition'] == 'pending', 'PILOT_TERMINAL_IMMUTABLE')
                    need(happened <= cutoff, 'PILOT_EVENT_WINDOW')
                    need(not row['agent_attempted'] or data['agent_attempted'] is True, 'PILOT_ATTEMPT_RETREAT')
                    if data['completed_at'] is not None:
                        need(timestamp(data['completed_at']) <= happened, 'PILOT_EVENT_WINDOW')
                    row.update(data)
                    state.update(observation_recorded=True, observation_ref=e['evidence_ref'], observation_sha256=e['evidence_sha256'])
                elif kind == 'adjudication':
                    shape(data, ('oracle_verdict', 'oracle_ref', 'autonomous_resolution', 'supersedes'))
                    need(state['observation_recorded'], 'PILOT_OBSERVATION_REQUIRED')
                    need(data['supersedes'] == state['adjudication_event_id'], 'PILOT_ADJUDICATION_LINEAGE')
                    ref(data['oracle_ref'], optional=True)
                    row.update({k: data[k] for k in ('oracle_verdict', 'oracle_ref', 'autonomous_resolution')})
                    state['adjudication_event_id'] = e['id']
                    state['adjudication_sha256'] = e['evidence_sha256']
                elif kind == 'followup':
                    shape(data, ('through', 'repeat_contact', 'repeat_ref'))
                    through = timestamp(data['through'])
                    ref(data['repeat_ref'])
                    need(type(data['repeat_contact']) is bool and row['disposition'] == 'resolved', 'PILOT_FOLLOWUP_INVALID')
                    need(through <= min(happened, cutoff), 'PILOT_EVENT_WINDOW')
                    need(row['followup_through'] is None or through >= timestamp(row['followup_through']), 'PILOT_FOLLOWUP_RETREAT')
                    need(not row['repeat_contact'] or data['repeat_contact'], 'PILOT_FOLLOWUP_RETREAT')
                    row.update(followup_through=data['through'], repeat_contact=data['repeat_contact'], repeat_ref=data['repeat_ref'])
                elif kind == 'reopen':
                    shape(data, ('related', 'occurred_at'))
                    occurred = timestamp(data['occurred_at'])
                    need(type(data['related']) is bool and row['disposition'] == 'resolved', 'PILOT_REOPEN_INVALID')
                    completed = timestamp(row['completed_at'])
                    need(completed <= occurred <= min(happened, cutoff), 'PILOT_EVENT_WINDOW')
                    if data['related'] and occurred <= completed + timedelta(days=benchmark['gates']['followup_days']):
                        state['reopened_in_window'] = True
                        row.update(repeat_contact=True, repeat_ref=e['evidence_ref'])
                    exceptions.append({'event_id': e['id'], 'case_id': e['case_id'], 'code': 'reopen', 'evidence_ref': e['evidence_ref'], 'within_window': occurred <= completed + timedelta(days=benchmark['gates']['followup_days'])})
                elif kind == 'cost':
                    shape(data, ('minor', 'operator_seconds'))
                    need(state['cost_event_id'] is None, 'PILOT_COST_BASE')
                    row.update(cost_minor=data['minor'], operator_seconds=data['operator_seconds'])
                    state['cost_event_id'] = e['id']
                elif kind == 'cost_adjustment':
                    shape(data, ('category', 'delta_minor', 'incurred_at', 'base_cost_event_id'))
                    need(row['cost_minor'] is not None and data['base_cost_event_id'] == state['cost_event_id'], 'PILOT_COST_BASE')
                    need(data['category'] in COSTS and type(data['delta_minor']) is int and abs(data['delta_minor']) <= 9_000_000_000_000_000, 'PILOT_COST_RANGE')
                    need(frozen <= timestamp(data['incurred_at']) <= min(happened, cutoff), 'PILOT_EVENT_WINDOW')
                    # Copy so projecting an append never mutates an earlier event's payload.
                    row['cost_minor'] = dict(row['cost_minor'])
                    row['cost_minor'][data['category']] += data['delta_minor']
                    need(0 <= row['cost_minor'][data['category']] <= 9_000_000_000_000_000, 'PILOT_COST_RANGE')
                    late += happened > cutoff
                elif kind == 'exception':
                    shape(data, ('code', 'severity'))
                    need(data['code'] in ('censored', 'withdrawn', 'unavailable', 'outcome_incorrect', 'duplicate_effect', 'unauthorized_action', 'source_unavailable', 'appeal'), 'PILOT_EXCEPTION_INVALID')
                    need(data['severity'] in SEVERITY, 'PILOT_EXCEPTION_INVALID')
                    need(data['code'] not in ('duplicate_effect', 'unauthorized_action') or data['severity'] in ('SEV0', 'SEV1'), 'PILOT_EXCEPTION_INVALID')
                    row['severity'] = max((row['severity'], data['severity']), key=SEVERITY.index)
                    if data['code'] in ('censored', 'withdrawn', 'unavailable'):
                        state[data['code']] = True
                    if data['code'] == 'source_unavailable':
                        state['unavailable'] = True
                    exceptions.append({'event_id': e['id'], 'case_id': e['case_id'], **data, 'evidence_ref': e['evidence_ref']})
                else:
                    raise Invalid('PILOT_EVENT_KIND')
        results = {'schema_version': '1.0', 'project': 'Rifare', 'cohort_id': manifest['cohort_id'],
                   'manifest_sha256': header['manifest_sha256'], 'candidate_ref': header['source']['commit'],
                   'results': [rows[c['id']] for c in manifest['cases']]}
        try:
            score = scorer.score_cohort(benchmark, envelope, manifest, results, header['manifest_sha256'], header['benchmark_sha256'])
        except (ValueError, KeyError, TypeError, OverflowError):
            raise Invalid('PILOT_SCORER_REJECTED') from None
        source_kinds = {s['id']: s['kind'] for s in manifest['sources']}
        for key, state in states.items():
            state.update(source_kind=source_kinds[cases[key]['source_id']], in_scope=cases[key]['in_scope'])
        return {'kind': 'pilot_protocol_projection', 'registration_sha256': digest(encoded(header)), 'head': head,
                'controls': contract['controls'], 'source': header['source'], 'configurations': header['configurations'],
                'artifact_registered_at': header['stored_at'], 'enrollment_frozen_at_claimed': manifest['enrollment_frozen_at'],
                'authority_refs': header['authority_refs'], 'events_count': len(seen), 'late_adjustments': late,
                'case_status': list(states.values()), 'exception_history': exceptions, 'score': score,
                'results': results, 'enrollment_predated_outcomes_verified': False}
    except Invalid:
        raise
    except (ValueError, TypeError, KeyError, IndexError):
        raise Invalid('PILOT_SCORER_REJECTED') from None


def read_or_append(request, context, append=False):
    reference_shape(request, ('events',) if append else ())
    with locked(request['directory']) as fd:
        header, manifest, blocks, size = load_store(fd, request, context)
        head = request['head']
        if append:
            need(head['sequence'] < MAX_BATCHES, 'PILOT_STORE_LIMIT')
            block = {'version': 1, 'sequence': head['sequence'] + 1, 'previous_sha256': head['sha256'],
                     'registration_sha256': request['registration_sha256'], 'recorded_at': now(), 'events': request['events']}
            raw = encoded(block)
            need(len(raw) <= MAX_BLOCK and len(raw) + size <= MAX_STORE, 'PILOT_STORE_LIMIT')
            head = {'sequence': block['sequence'], 'sha256': digest(raw)}
            # Validate the whole hypothetical history before its first byte is persisted.
            projection = project(header, manifest, [*blocks, block], context, head)
            events_fd = os.open('events', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            try:
                write_new(events_fd, f'{block["sequence"]:08}.json', raw)
            finally:
                os.close(events_fd)
            return {'head': head, 'registration_sha256': request['registration_sha256'], 'events_count': projection['events_count']}
        return project(header, manifest, blocks, context, head)


def readiness(request, context):
    shape(request, ('version', 'register', 'protocols', 'assessed_at'))
    need(type(request['version']) is int and request['version'] == 1, 'PILOT_VERSION')
    assessed = timestamp(request['assessed_at'])
    need(assessed <= datetime.now(timezone.utc), 'PILOT_ASSESSMENT_NOT_ELAPSED')
    register_raw = read_pinned(request['register'])
    register = parse(register_raw)
    shape(register, ('version', 'project', 'record_kind', 'qualification', 'merchant_profiles', 'observations', 'exposure_days', 'approvals', 'reviews'))
    need(register['version'] == 1 and register['project'] == 'Rifare'
         and register['record_kind'] == 'real_pilot_observation_register' and register['qualification'] == 'unperformed', 'PILOT_READINESS_CLAIM')
    for field in ('merchant_profiles', 'observations', 'exposure_days', 'approvals', 'reviews'):
        need(type(register[field]) is list and len(register[field]) <= 1000, 'PILOT_REGISTER_LIMIT')
    need(type(request['protocols']) is list and len(request['protocols']) <= 10, 'PILOT_REGISTER_LIMIT')
    protocols = {}
    for r in request['protocols']:
        p = read_or_append(r, context)
        cohort_id = p['score']['cohort_id']
        need(cohort_id not in protocols, 'PILOT_COHORT_DUPLICATE')
        protocols[cohort_id] = p
    blockers = {'REAL_QUALIFICATION_UNPERFORMED', 'FORMAL_PREREQUISITES_UNACCEPTED', 'INDEPENDENT_AUTHENTICATION_REQUIRED', 'ENROLLMENT_TIMING_UNVERIFIED'}
    merchants = {}
    for m in register['merchant_profiles']:
        shape(m, ('id', 'independence_ref', 'consent_ref'))
        for v in m.values():
            ref(v)
        need(m['id'] not in merchants, 'PILOT_REGISTER_DUPLICATE')
        merchants[m['id']] = m
    if len({m['independence_ref'] for m in merchants.values()}) != len(merchants):
        blockers.add('MERCHANT_INDEPENDENCE_EVIDENCE_REUSED')
    valid_approvals = set()
    for a in register['approvals']:
        shape(a, ('merchant_id', 'kind', 'scope_ref', 'source_ref', 'sha256', 'issued_at', 'expires_at'))
        for k in ('merchant_id', 'scope_ref', 'source_ref'):
            ref(a[k])
        pin(a['sha256'])
        need(a['kind'] in ('merchant', 'maintainer'), 'PILOT_APPROVAL_KIND')
        if a['merchant_id'] not in merchants or a['scope_ref'] not in protocols or not timestamp(a['issued_at']) <= assessed <= timestamp(a['expires_at']):
            blockers.add('APPROVAL_SCOPE_OR_TIME_INVALID')
        else:
            valid_approvals.add((a['merchant_id'], a['kind'], a['scope_ref']))
    required_scopes = {(o.get('merchant_id'), o.get('cohort_id')) for o in register['observations'] if type(o) is dict}
    if not merchants or not required_scopes or any((key, kind, cohort) not in valid_approvals for key, cohort in required_scopes for kind in ('merchant', 'maintainer')):
        blockers.add('MERCHANT_APPROVALS_MISSING')
    review_roles = set()
    for review in register['reviews']:
        shape(review, ('role', 'source_ref', 'sha256', 'candidate_commit'))
        need(review['role'] in ('authority', 'regression'), 'PILOT_REVIEW_ROLE')
        ref(review['source_ref'])
        pin(review['sha256'])
        pin(review['candidate_commit'], 40)
        if any(p['source']['commit'] == review['candidate_commit'] for p in protocols.values()):
            review_roles.add((review['role'], review['candidate_commit']))
    if not protocols or any((role, p['source']['commit']) not in review_roles for p in protocols.values() for role in ('authority', 'regression')):
        blockers.add('INDEPENDENT_REVIEW_REQUIRED')
    seen, membership, declared, completed, resolved = set(), set(), 0, 0, 0
    for o in register['observations']:
        shape(o, ('id', 'merchant_id', 'cohort_id', 'case_id', 'source_kind', 'source_ref', 'source_sha256', 'adjudication_ref', 'adjudication_sha256', 'completed_at', 'followup_through'))
        for k in ('id', 'merchant_id', 'cohort_id', 'case_id'):
            ref(o[k])
        need(o['id'] not in seen and (o['cohort_id'], o['case_id']) not in membership, 'PILOT_REGISTER_DUPLICATE')
        seen.add(o['id'])
        membership.add((o['cohort_id'], o['case_id']))
        if o['source_kind'] != 'live':
            blockers.add('SIMULATED_OBSERVATION_SUBSTITUTION')
        else:
            declared += 1
        if o['merchant_id'] not in merchants:
            blockers.add('MERCHANT_EVIDENCE_MISSING')
        for k in ('source_ref', 'adjudication_ref'):
            ref(o[k], optional=True)
        if not o['source_ref'] or not o['adjudication_ref'] or not o['source_sha256'] or not o['adjudication_sha256']:
            blockers.add('SOURCE_EVIDENCE_MISSING')
        else:
            pin(o['source_sha256'])
            pin(o['adjudication_sha256'])
        p = protocols.get(o['cohort_id'])
        states = {r['case_id']: r for r in p['case_status']} if p else {}
        rows = {r['case_id']: r for r in p['results']['results']} if p else {}
        state, row = states.get(o['case_id']), rows.get(o['case_id'])
        if state is None or state['source_kind'] != 'live' or o['source_kind'] != 'live':
            blockers.add('OBSERVATION_SOURCE_MISMATCH')
        elif state['observation_ref'] != o['source_ref'] or state['observation_sha256'] != o['source_sha256'] or row['oracle_ref'] != o['adjudication_ref'] or state['adjudication_sha256'] != o['adjudication_sha256'] or row['completed_at'] != o['completed_at']:
            blockers.add('OBSERVATION_RECEIPT_MISMATCH')
        elif not state['in_scope'] or not state['observation_recorded'] or state['censored'] or state['withdrawn'] or state['unavailable'] or row['disposition'] not in ('resolved', 'handed_off', 'failed', 'rejected') or row['oracle_verdict'] == 'unassessed':
            blockers.add('OBSERVATION_INCOMPLETE')
        else:
            completed += 1
            resolved += row['disposition'] == 'resolved'
        if o['completed_at'] is not None:
            completed_at = timestamp(o['completed_at'])
            if completed_at > assessed:
                blockers.add('OBSERVATION_NOT_ELAPSED')
            for a in register['approvals']:
                if a['merchant_id'] == o['merchant_id'] and a['scope_ref'] == o['cohort_id'] and timestamp(a['issued_at']) > completed_at:
                    blockers.add('APPROVAL_POSTDATES_OBSERVATION')
        if row is not None and row['disposition'] == 'resolved':
            if o['completed_at'] is None or o['followup_through'] is None:
                blockers.add('FOLLOWUP_INCOMPLETE')
            else:
                end = timestamp(o['completed_at']) + timedelta(days=context[2]['gates']['followup_days'])
                if not end <= timestamp(o['followup_through']) <= assessed or row['followup_through'] != o['followup_through'] or row['repeat_contact'] is None:
                    blockers.add('FOLLOWUP_INCOMPLETE')
        elif o['followup_through'] is not None:
            blockers.add('FOLLOWUP_SOURCE_MISMATCH')
    exposed = {}
    exposure_keys = set()
    for e in register['exposure_days']:
        shape(e, ('merchant_id', 'date', 'source_ref', 'sha256'))
        ref(e['merchant_id'])
        ref(e['source_ref'])
        pin(e['sha256'])
        need(type(e['date']) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}', e['date']), 'PILOT_TIMESTAMP_INVALID')
        date = timestamp(e['date'] + 'T00:00:00Z').date()
        need((e['merchant_id'], date) not in exposure_keys, 'PILOT_REGISTER_DUPLICATE')
        exposure_keys.add((e['merchant_id'], date))
        if date >= assessed.date():
            blockers.add('EXPOSURE_NOT_ELAPSED')
        elif e['merchant_id'] not in merchants:
            blockers.add('MERCHANT_EVIDENCE_MISSING')
        else:
            exposed.setdefault(e['merchant_id'], set()).add(date)
    all_days = sorted(set().union(*exposed.values())) if exposed else []
    longest, streak, previous = 0, 0, None
    for date in all_days:
        streak = streak + 1 if previous and date == previous + timedelta(days=1) else 1
        longest, previous = max(longest, streak), date
    gates = context[2]['gates']
    if len(merchants) < gates['pilot_merchants_min']:
        blockers.add('MERCHANT_COUNT_INSUFFICIENT')
    if completed < gates['pilot_in_scope_cases_min']:
        blockers.add('LIVE_OBSERVATIONS_MISSING')
    if longest < gates['pilot_consecutive_days_min'] or any(key not in exposed for key in merchants):
        blockers.add('ELAPSED_EXPOSURE_MISSING')
    for p in protocols.values():
        if any(e['code'] in ('duplicate_effect', 'unauthorized_action') for e in p['exception_history']):
            blockers.add('DUPLICATE_OR_UNAUTHORIZED_EFFECT_DECLARED')
        for source in p['score']['by_source']:
            if source['source_kind'] == 'live':
                for s in source['strata']:
                    targets = s['quality_targets_observed']
                    if not targets['correct_handling_threshold'] or not targets['minimum_stratum_count']:
                        blockers.add('COHORT_QUALITY_TARGETS_UNMET')
                    if not targets['no_sev0_or_sev1']:
                        blockers.add('SAFETY_FINDINGS_PRESENT')
                    if not targets['mature_followup_complete'] or not targets['all_resolutions_followup_mature']:
                        blockers.add('FOLLOWUP_INCOMPLETE')
    return {'kind': 'pilot_readiness_preparation', 'status': 'blocked', 'assessed_at': request['assessed_at'],
            'register_sha256': digest(register_raw), 'declared_live_observations': declared,
            'structurally_matched_declared_outcomes': completed, 'structurally_matched_declared_resolutions': resolved,
            'declared_merchants': len(merchants),
            'declared_consecutive_exposure_days': longest, 'merchant_exposure_days': {k: len(v) for k, v in sorted(exposed.items())},
            'targets': {k: gates[k] for k in ('pilot_merchants_min', 'pilot_in_scope_cases_min', 'pilot_consecutive_days_min', 'followup_days')},
            'protocol_heads': [{'cohort_id': key, 'registration_sha256': p['registration_sha256'], 'head': p['head']} for key, p in sorted(protocols.items())],
            'blockers': sorted(blockers), 'live_pilot_started': False}


def main():
    try:
        need(len(sys.argv) == 2 and sys.argv[1] in ('register', 'append', 'project', 'readiness'), 'PILOT_COMMAND')
        raw = sys.stdin.buffer.read(MAX_INPUT + 1)
        need(len(raw) <= MAX_INPUT, 'PILOT_INPUT_LIMIT')
        request, context = parse(raw), controls()
        mode = sys.argv[1]
        if mode == 'register':
            result = registration(request, context)
        elif mode == 'readiness':
            result = readiness(request, context)
        else:
            result = read_or_append(request, context, append=mode == 'append')
        print(json.dumps({'ok': True, 'version': 1, **result, **BOUNDARY}, sort_keys=True, allow_nan=False))
        return 0
    except Invalid as exc:
        error = str(exc)
    except (OSError, ValueError, TypeError, KeyError, OverflowError, RecursionError):
        error = 'PILOT_INPUT_INVALID'
    print(json.dumps({'ok': False, 'error': error, **BOUNDARY}))
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
