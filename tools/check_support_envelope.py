#!/usr/bin/env python3
"""Validate Rifare's proposed support contract; never authorize commerce or acceptance."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
from typing import Any

DIMENSIONS = ('platform', 'payment', 'fulfillment', 'market', 'currency', 'order_kind')
TOP = {
    'schema_version': str, 'project': str, 'goal_id': str, 'envelope_id': str,
    'revision': int, 'review_status': str, 'approval_ref': type(None),
    'target_customer': dict, 'release': dict, 'owners': list, 'conditions': list,
    'contexts': list, 'capabilities': list, 'release_claims': list,
    'invariant_ids': list, 'capability_disposition': list, 'boundaries': list,
}
CUSTOMER = {key: str for key in ('id', 'name', 'recruitment_status', 'profile',
                               'first_platform', 'second_platform', 'initial_market',
                               'initial_currency', 'accountable_owner')}
RELEASE = {'id': str, 'milestone': str, 'meaning': str, 'current_product_qualified': bool,
           'public_claims_enabled': bool, 'unknown_combination': str}
ROW = {key: str for key in ('id', 'action', 'context_id', 'support', 'reason',
                          'accountable_owner', 'delivery', 'implementation_goal', 'qualification')}
ROW.update(conditions=list, target_refs=list)
DISPOSITION = {'target_id': str, 'disposition': str,
               'owning_milestone': (str, type(None)), 'reason': str}


def _parse_document(text: str) -> Any:
    """Reject duplicate keys and non-JSON numeric values rather than last-key-wins."""
    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                raise ValueError(f'duplicate JSON key: {key}')
            result[key] = value
        return result

    def constant(value: str) -> None:
        raise ValueError(f'invalid JSON numeric constant: {value}')

    return json.loads(text, object_pairs_hook=pairs, parse_constant=constant)


def load_document(path: Path) -> Any:
    return _parse_document(path.read_text(encoding='utf-8'))


def load_verified_baseline(path: Path, expected_sha256: str) -> Any:
    raw = path.read_bytes()
    if (not re.fullmatch(r'[0-9a-f]{64}', expected_sha256)
            or hashlib.sha256(raw).hexdigest() != expected_sha256):
        raise ValueError('baseline digest mismatch; supply independently retained content identity')
    # Parse the same bytes that were hashed, not a second mutable file read.
    return _parse_document(raw.decode('utf-8'))


def validate_envelope(document: Any, root: Path | None = None) -> list[str]:
    """Executable schema plus references; the root adds retained-plan coverage checks."""
    errors: list[str] = []

    def shape(value: Any, fields: dict[str, Any], path: str) -> dict[str, Any]:
        if not isinstance(value, dict):
            errors.append(f'{path}: expected object')
            return {}
        missing = set(fields) - set(value)
        extra = set(value) - set(fields)
        if missing:
            errors.append(f'{path}: missing fields {sorted(missing)}')
        if extra:
            errors.append(f'{path}: unexpected fields {sorted(extra)}')
        for key, expected in fields.items():
            if key not in value:
                continue
            types = expected if isinstance(expected, tuple) else (expected,)
            if type(value[key]) not in types:
                errors.append(f'{path}.{key}: unexpected type')
            elif isinstance(value[key], str) and not value[key].strip():
                errors.append(f'{path}.{key}: nonempty text required')
        return value

    def objects(key: str, fields: dict[str, Any]) -> list[dict[str, Any]]:
        values = doc.get(key)
        if not isinstance(values, list):
            return []
        if not values:
            errors.append(f'{key}: nonempty list required')
        return [shape(value, fields, f'{key}[{index}]') for index, value in enumerate(values)]

    def strings(value: Any, path: str, *, nonempty: bool = False) -> list[str]:
        if not isinstance(value, list):
            errors.append(f'{path}: expected string list')
            return []
        result = []
        for item in value:
            if not isinstance(item, str) or not item.strip():
                errors.append(f'{path}: nonempty strings required')
            else:
                result.append(item)
        if len(set(result)) != len(result):
            errors.append(f'{path}: duplicate values')
        if nonempty and not result:
            errors.append(f'{path}: nonempty list required')
        return result

    def index(items: list[dict[str, Any]], key: str, path: str) -> dict[str, dict[str, Any]]:
        result = {}
        for item in items:
            identity = item.get(key)
            if not isinstance(identity, str):
                continue
            if identity in result:
                errors.append(f'{path}: duplicate id {identity}')
            result[identity] = item
        return result

    def constant(obj: dict[str, Any], key: str, expected: Any, path: str) -> None:
        if type(obj.get(key)) is not type(expected) or obj.get(key) != expected:
            errors.append(f'{path}.{key}: must be {expected!r}')

    doc = shape(document, TOP, 'envelope')
    if not isinstance(document, dict):
        return errors
    for key, value in {'schema_version':'1.0', 'project':'Rifare', 'goal_id':'M00-G01',
                       'envelope_id':'rifare-post-purchase-v1', 'review_status':'proposed',
                       'approval_ref':None}.items():
        constant(doc, key, value, 'envelope')
    if type(doc.get('revision')) is not int or doc['revision'] < 1:
        errors.append('envelope.revision: positive integer required')
    customer = shape(doc.get('target_customer'), CUSTOMER, 'target_customer')
    for key, value in {'first_platform':'shopify','second_platform':'woocommerce',
                       'initial_market':'US','initial_currency':'USD',
                       'recruitment_status':'not_recruited'}.items():
        constant(customer, key, value, 'target_customer')
    release = shape(doc.get('release'), RELEASE, 'release')
    for key, value in {'id':'rifare-v1','milestone':'M07',
                       'meaning':'planned_support_not_runtime_authority',
                       'current_product_qualified':False,'public_claims_enabled':False,
                       'unknown_combination':'scope_decision_required'}.items():
        constant(release, key, value, 'release')
    owners = objects('owners', {k:str for k in ('id','role','assignment','responsibility')})
    owner_index = index(owners, 'id', 'owners')
    if 'project-owner' not in owner_index:
        errors.append('owners: project-owner must be accountable for scope decisions')
    if not isinstance(customer.get('accountable_owner'),str) or customer['accountable_owner'] not in owner_index:
        errors.append('target_customer: unknown owner')
    conditions = objects('conditions', {'id':str,'description':str})
    condition_index = index(conditions, 'id', 'conditions')
    contexts = objects('contexts', {k:str for k in ('id', *DIMENSIONS)})
    context_index = index(contexts, 'id', 'contexts')
    context_keys: set[tuple[str, ...]] = set()
    for context in contexts:
        key = tuple(context.get(k) for k in DIMENSIONS)
        if not all(isinstance(x, str) for x in key):
            continue
        if key in context_keys:
            errors.append(f'contexts: duplicate context tuple {key}')
        context_keys.add(key)
        for dimension, value in zip(DIMENSIONS, key):
            if any(c in value for c in '*?[]'):
                errors.append(f'contexts.{context.get("id")}.{dimension}: wildcard forbidden')
            if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', value):
                errors.append(f'contexts.{context.get("id")}.{dimension}: invalid exact identifier')
        if context.get('platform') not in ('shopify','woocommerce'):
            errors.append('contexts: unknown platform')
        if not re.fullmatch(r'[A-Z]{3}', context.get('currency', '')):
            errors.append('contexts: currency must be a three-letter uppercase identifier')
    capabilities = objects('capabilities', ROW)
    capability_index = index(capabilities, 'id', 'capabilities')
    action_keys: set[tuple[str, str]] = set()
    for row in capabilities:
        label = f'capabilities.{row.get("id", "?")}'
        if row.get('support') not in ('supported','conditional','excluded'):
            errors.append(f'{label}.support: unsupported label')
        if row.get('delivery') not in ('native','composed','manual','unsupported'):
            errors.append(f'{label}.delivery: unknown mapping')
        if row.get('support') == 'excluded' and row.get('delivery') != 'unsupported':
            errors.append(f'{label}: excluded capability must be unsupported')
        if row.get('support') != 'excluded' and row.get('delivery') == 'unsupported':
            errors.append(f'{label}: in-scope capability needs a delivery mapping')
        constant(row, 'qualification', 'not_qualified', label)
        context_id, owner = row.get('context_id'), row.get('accountable_owner')
        if not isinstance(context_id, str) or context_id not in context_index:
            errors.append(f'{label}: unknown context')
        if not isinstance(owner, str) or owner not in owner_index:
            errors.append(f'{label}: unknown owner')
        action = row.get('action')
        if not isinstance(action,str) or not re.fullmatch(r'[a-z][a-z0-9_.]*', action):
            errors.append(f'{label}: invalid action')
        elif isinstance(context_id, str):
            key = (action, context_id)
            if key in action_keys:
                errors.append(f'{label}: duplicate action/context')
            action_keys.add(key)
        required_conditions = strings(row.get('conditions'), label+'.conditions')
        if row.get('support') == 'conditional' and not required_conditions:
            errors.append(f'{label}: conditional capability needs conditions')
        for value in required_conditions:
            if value not in condition_index:
                errors.append(f'{label}: unknown condition {value}')
        strings(row.get('target_refs'), label+'.target_refs', nonempty=True)
        goal = row.get('implementation_goal')
        if not isinstance(goal,str) or not re.fullmatch(r'M\d{2}-G\d{2}', goal):
            errors.append(f'{label}: invalid implementation goal')
    claims = objects('release_claims', {'id':str,'text':str,'capability_ids':list})
    index(claims, 'id', 'release_claims')
    for claim in claims:
        for key in strings(claim.get('capability_ids'), 'claim.capability_ids', nonempty=True):
            if key not in capability_index:
                errors.append(f'claim.{claim.get("id")}: missing claimed capability {key}')
            elif capability_index[key].get('support') == 'excluded':
                errors.append(f'claim.{claim.get("id")}: claim includes excluded capability {key}')
    invariant_ids = strings(doc.get('invariant_ids'), 'invariant_ids', nonempty=True)
    disposition_rows = objects('capability_disposition', DISPOSITION)
    disposition_index = index(disposition_rows, 'target_id', 'capability_disposition')
    for row in disposition_rows:
        if row.get('disposition') not in ('v1_target','conditional_v1','post_v1','not_required'):
            errors.append('capability_disposition: unknown disposition')
    boundaries = objects('boundaries', {'id':str,'rule':str,'owner':str,'goals':list})
    index(boundaries, 'id', 'boundaries')
    boundary_goals = []
    for boundary in boundaries:
        if not isinstance(boundary.get('owner'),str) or boundary['owner'] not in owner_index:
            errors.append('boundaries: unknown owner')
        boundary_goals.extend(strings(boundary.get('goals'), 'boundaries.goals', nonempty=True))
    if root is not None:
        try:
            goals = {g['id'] for g in load_document(root/'planning/goals.json')['goals']}
            targets = {c['id']:c for c in load_document(root/'planning/capability-targets.json')['capabilities']}
            invariants = {i['id'] for i in load_document(root/'planning/invariants.json')['invariants']}
            if set(disposition_index) != set(targets):
                errors.append('capability_disposition: target coverage must retain every original target')
            if set(invariant_ids) != invariants:
                errors.append('invariant coverage must retain every original invariant')
            for row in capabilities:
                if row.get('implementation_goal') not in goals:
                    errors.append(f'{row.get("id")}: unknown goal {row.get("implementation_goal")}')
                for target in strings(row.get('target_refs'), 'target_refs'):
                    if target not in targets:
                        errors.append(f'{row.get("id")}: unknown target {target}')
            for goal in boundary_goals:
                if goal not in goals:
                    errors.append(f'boundaries: unknown goal {goal}')
            for key, row in disposition_index.items():
                target = targets.get(key)
                if not target:
                    continue
                milestone = target['target_milestone']
                if row.get('owning_milestone') != milestone:
                    errors.append(f'{key}: target milestone differs from retained plan')
                expected = ('not_required' if milestone is None else
                            'post_v1' if int(milestone[1:]) > 7 else
                            'conditional_v1' if target['delivery_mode'] in ('conditional','partner')
                            else 'v1_target')
                if row.get('disposition') != expected:
                    errors.append(f'{key}: disposition differs from retained plan')
        except (OSError, ValueError, TypeError, KeyError) as exc:
            errors.append(f'cannot verify retained plan references: {exc}')
    return errors


def resolve_scenario(document: dict[str, Any], action: str,
                     context: dict[str, Any]) -> dict[str, Any]:
    """Exact proposal lookup, not a policy/permission or qualification decision."""
    errors = validate_envelope(document)
    if errors:
        raise ValueError('invalid envelope: ' + '; '.join(errors))
    result = {'support':'scope_decision_required','capability_id':None,
              'reason':'No exact declared action/context combination; obtain a reviewed scope decision.',
              'accountable_owner':'project-owner','conditions':[],
              'qualification':'not_qualified','execution_authorized':False}
    if not isinstance(context,dict) or set(context) != set(DIMENSIONS):
        return result
    if not all(isinstance(context[k],str) and context[k] for k in DIMENSIONS):
        return result
    matching = [c for c in document['contexts'] if all(c[k] == context[k] for k in DIMENSIONS)]
    if not matching:
        return result
    rows = [r for r in document['capabilities']
            if r['action'] == action and r['context_id'] == matching[0]['id']]
    if rows:
        row = rows[0]
        result.update(support=row['support'], capability_id=row['id'], reason=row['reason'],
                      accountable_owner=row['accountable_owner'], conditions=list(row['conditions']))
    return result


def evaluate_cases(document: dict[str, Any], cases: Any) -> list[str]:
    if not isinstance(cases,list) or not cases:
        return ['scenario set must be nonempty; zero cases cannot pass']
    errors = []
    ids = set()
    for case in cases:
        if not isinstance(case,dict) or not isinstance(case.get('id'),str):
            errors.append('invalid scenario fixture'); continue
        identity = case['id']
        if identity in ids:
            errors.append(f'duplicate scenario id: {identity}')
        ids.add(identity)
        try:
            result = resolve_scenario(document,case['action'],case['context'])
            if result['support'] != case['expected_support']:
                errors.append(f'{identity}: expected {case["expected_support"]}, got {result["support"]}')
            if result['capability_id'] != case['expected_capability_id']:
                errors.append(f'{identity}: capability does not match independent fixture')
            if result['execution_authorized'] or not result['reason'] or not result['accountable_owner']:
                errors.append(f'{identity}: outcome must be non-authorizing with reason and owner')
        except (KeyError, TypeError, ValueError) as exc:
            errors.append(f'{identity}: {exc}')
    return errors


def compare_envelopes(candidate: dict[str, Any], baseline: dict[str, Any]) -> list[str]:
    """Report every retained-contract change; a version bump cannot approve its own diff."""
    for value in (candidate, baseline):
        if not isinstance(value,dict):
            raise ValueError('envelope comparison requires objects')
    errors = []
    indexed = {'capabilities':('id','capability'), 'release_claims':('id','claim'),
               'contexts':('id','context'), 'conditions':('id','condition'),
               'owners':('id','owner'), 'boundaries':('id','boundary'),
               'capability_disposition':('target_id','target_disposition')}
    for field, (key, label) in indexed.items():
        def items(doc: dict[str, Any]) -> dict[str, Any]:
            rows = doc.get(field)
            if not isinstance(rows,list) or any(not isinstance(r,dict) or not isinstance(r.get(key),str) for r in rows):
                raise ValueError(f'invalid comparison field: {field}')
            result = {r[key]:r for r in rows}
            if len(result) != len(rows):
                raise ValueError(f'duplicate comparison identity: {field}')
            return result
        old, new = items(baseline), items(candidate)
        for identity in sorted(old.keys()-new.keys()):
            errors.append(f'review_required:removed_{label}:{identity}')
        for identity in sorted(new.keys()-old.keys()):
            errors.append(f'review_required:added_{label}:{identity}')
        for identity in sorted(old.keys() & new.keys()):
            if old[identity] != new[identity]:
                errors.append(f'review_required:changed_{label}:{identity}')
    for key in sorted((set(candidate) | set(baseline)) - set(indexed) - {'revision'}):
        if candidate.get(key) != baseline.get(key):
            errors.append(f'review_required:changed_envelope_field:{key}')
    if (type(candidate.get('revision')) is not int or type(baseline.get('revision')) is not int
            or candidate['revision'] < baseline['revision']):
        errors.append('review_required:invalid_or_backwards_revision')
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
    parser.add_argument('--envelope',type=Path,help='Explicit candidate JSON; default is planning/support-envelope.json')
    parser.add_argument('--scenarios',type=Path,help='Predeclared expected scenario fixtures')
    parser.add_argument('--query',type=Path,help='One JSON object with action and all exact context dimensions')
    parser.add_argument('--baseline',type=Path,help='Previously retained contract, supplied by trusted review workflow')
    parser.add_argument('--baseline-sha256',help='Independent expected SHA-256; candidate-provided digests are not trust')
    args = parser.parse_args()
    if bool(args.baseline) != bool(args.baseline_sha256):
        parser.error('--baseline and --baseline-sha256 must be supplied together')
    report: dict[str, Any] = {'document_valid':False,'goal_acceptance':'pending_external_review',
                             'execution_authorized':False,'scenarios_checked':0,'errors':[]}
    try:
        document = load_document(args.envelope or args.root/'planning/support-envelope.json')
        errors = validate_envelope(document,args.root)
        if not errors and args.scenarios:
            fixture = load_document(args.scenarios)
            cases = fixture.get('cases') if isinstance(fixture,dict) else None
            errors.extend(evaluate_cases(document,cases))
            report['scenarios_checked'] = len(cases) if isinstance(cases,list) else 0
        if not errors and args.baseline:
            baseline = load_verified_baseline(args.baseline, args.baseline_sha256)
            baseline_errors = validate_envelope(baseline,args.root)
            if baseline_errors:
                raise ValueError('invalid baseline: '+'; '.join(baseline_errors))
            errors.extend(compare_envelopes(document,baseline))
        if not errors and args.query:
            query = load_document(args.query)
            if not isinstance(query,dict) or set(query) != {'action','context'}:
                raise ValueError('query requires exactly action and context')
            report['resolution'] = resolve_scenario(document,query['action'],query['context'])
        report['errors'] = errors
        report['document_valid'] = not errors
        print(json.dumps(report,indent=2))
        if errors:
            return 1
        if report.get('resolution',{}).get('support') in ('excluded','scope_decision_required'):
            return 3
        return 0
    except (OSError, ValueError, TypeError, KeyError) as exc:
        report['errors'] = [str(exc)]
        print(json.dumps(report,indent=2))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
