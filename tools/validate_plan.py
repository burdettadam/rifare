#!/usr/bin/env python3
"""Validate planning structure, NOT commerce behavior or reviewer authorization."""
from __future__ import annotations
import argparse
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

# Prior authority: ADR-0042 / 97b888a. This is a closed, byte-pinned addition,
# not a candidate-controlled namespace for replacing original requirements.
ADOPTED_SHA256 = '0d4218fabd39eeb1328de5a3d1f79cc620967ef761a6dc4a405ec403a280d7b2'


def validate_documents(docs: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    goals = docs['goals']['goals']
    tests = docs['tests']['tests']
    reqs = docs['coverage']['requirements']
    milestones = docs['milestones']['milestones']
    original_reqs = docs['original_requirements']['items']
    original_tests = docs['original_tests']['tests']
    adopted_document = docs['adopted_requirements']
    adopted_bytes = (json.dumps(adopted_document, indent=2) + '\n').encode('utf-8')
    if hashlib.sha256(adopted_bytes).hexdigest() != ADOPTED_SHA256:
        errors.append('ADR-0042 frozen addition changed')
    adopted_reqs = adopted_document['requirements']
    indexes: dict[str, dict[str, Any]] = {}
    for name, items in [('goals', goals), ('tests', tests), ('requirements', reqs), ('milestones', milestones)]:
        counts = Counter(x.get('id') for x in items)
        for key, count in counts.items():
            if not key or count != 1:
                errors.append(f'{name}: missing/duplicate ID {key!r}')
        indexes[name] = {x.get('id'): x for x in items}
    gi, ti, ri, mi = (indexes[k] for k in ('goals', 'tests', 'requirements', 'milestones'))
    for g in goals:
        gid = g['id']
        if g.get('milestone') not in mi:
            errors.append(f'{gid}: unknown milestone')
        for dep in g.get('depends_on', []):
            if dep not in gi or dep == gid:
                errors.append(f'{gid}: invalid dependency {dep}')
        for rid in g.get('requirement_ids', []):
            if rid not in ri:
                errors.append(f'{gid}: unknown requirement {rid}')
        own = [ti[x] for x in g.get('new_test_ids', []) if x in ti]
        if not {'positive', 'negative', 'regression'} <= {t.get('kind') for t in own}:
            errors.append(f'{gid}: missing positive/negative/regression specification')
        for tid in g.get('required_test_ids', []):
            if tid not in ti:
                errors.append(f'{gid}: unknown required test {tid}')
        if not g.get('required_evidence') or not g.get('regression_contract', {}).get('deliberate_break_to_detect'):
            errors.append(f'{gid}: missing evidence or deliberate regression fault')
        if g.get('type') == 'milestone_acceptance':
            workers = {x['id'] for x in goals if x['milestone'] == g['milestone'] and x.get('type') == 'worker_goal'}
            if not workers <= set(g.get('depends_on', [])):
                errors.append(f'{gid}: gate omits component dependency')
        if g.get('status') != 'not_started' or g.get('all_product_test_results') != 'not_run':
            errors.append(f'{gid}: this planning baseline cannot claim implementation/acceptance')
    active: set[str] = set()
    finished: set[str] = set()
    def visit(gid: str) -> None:
        if gid in active:
            errors.append(f'cycle: {gid}')
            return
        if gid in finished or gid not in gi:
            return
        active.add(gid)
        for dep in gi[gid].get('depends_on', []):
            visit(dep)
        active.remove(gid)
        finished.add(gid)
    for gid in gi:
        visit(gid)
    for t in tests:
        if t.get('goal_id') not in gi:
            errors.append(f'{t["id"]}: missing owner')
        if t.get('executed') is not False or t.get('result') != 'not_run':
            errors.append(f'{t["id"]}: unexecuted specifications cannot claim a test result')
        if t.get('kind') != 'retained_source_scenario' and not all(t.get(k) for k in ('given_when','then','fixture_id','oracle')):
            errors.append(f'{t["id"]}: incomplete behavioral oracle/fixture')
        if t.get('kind') == 'regression' and not t.get('mutation_to_detect'):
            errors.append(f'{t["id"]}: missing fault to detect')
    originals = {x['id']: x for x in original_reqs}
    additions = {x['id']: x for x in adopted_reqs}
    if len(additions) != len(adopted_reqs) or set(additions) & set(originals):
        errors.append('Adopted requirements collide with protected IDs')
    if set(ri) != set(originals) | set(additions):
        errors.append('Requirement coverage differs from the exact approved union')
    for rid, r in ri.items():
        if not r.get('worker_goal_ids'):
            errors.append(f'{rid}: orphan requirement')
        for owner in r.get('worker_goal_ids', []):
            if owner not in gi or rid not in gi[owner].get('requirement_ids', []):
                errors.append(f'{rid}: inconsistent owner {owner}')
        if r.get('acceptance_gate') not in gi:
            errors.append(f'{rid}: missing acceptance gate')
        if rid in originals and r.get('acceptance_criteria') != originals[rid].get('acceptance_criteria'):
            errors.append(f'{rid}: original acceptance criterion changed')
        if rid in additions and r.get('acceptance_criteria') != additions[rid].get('acceptance_criteria'):
            errors.append(f'{rid}: adopted acceptance criterion changed')
    for t in original_tests:
        tid = t['id']
        if tid not in ti:
            errors.append(f'{tid}: original scenario removed')
        elif any(ti[tid].get(k) != t.get(k) for k in ('scenario','expected_result','milestone')):
            errors.append(f'{tid}: original scenario expectation changed')
    for m in milestones:
        gate = m.get('acceptance_goal_id')
        if gate not in gi:
            errors.append(f'{m["id"]}: missing integration gate')
        for predecessor in m.get('depends_on', []):
            if predecessor not in mi:
                errors.append(f'{m["id"]}: missing predecessor milestone')
        for gid in m.get('worker_goal_ids', []):
            if gid not in gi or gi[gid]['milestone'] != m['id']:
                errors.append(f'{m["id"]}: inconsistent goal {gid}')
    return errors


def load_documents(root: Path) -> dict[str, Any]:
    paths = {
        'goals':'planning/goals.json', 'tests':'planning/test-specifications.json',
        'coverage':'planning/requirement-coverage.json', 'milestones':'planning/milestones.json',
        'original_requirements':'reference/original-backlog.json',
        'original_tests':'reference/original-acceptance-tests.json',
        'adopted_requirements':'reference/additions/m13-m22-requirements.json'}
    if hashlib.sha256((root / paths['adopted_requirements']).read_bytes()).hexdigest() != ADOPTED_SHA256:
        raise ValueError('ADR-0042 frozen addition changed')
    return {k: json.loads((root / rel).read_text(encoding="utf-8")) for k, rel in paths.items()}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    ap.add_argument('--output', type=Path)
    args = ap.parse_args()
    try:
        docs = load_documents(args.root)
        errors = validate_documents(docs)
        goals = docs['goals']['goals']
        report = {'validation_type':'planning_structure_only', 'result':'fail' if errors else 'pass',
                  'worker_goals':sum(g['type']=='worker_goal' for g in goals),
                  'milestone_gates':sum(g['type']=='milestone_acceptance' for g in goals),
                  'goal_total':len(goals),'test_specifications':len(docs['tests']['tests']),
                  'source_requirements_preserved':len(docs['original_requirements']['items']),
                  'adopted_requirements_preserved':len(docs['adopted_requirements']['requirements']),
                  'total_requirements_mapped':len(docs['coverage']['requirements']),
                  'source_scenarios_preserved':len(docs['original_tests']['tests']),
                  'product_tests_executed':0, 'product_readiness':'not_assessed', 'errors':errors}
    except (OSError, ValueError, KeyError, TypeError) as exc:
        report = {'validation_type':'planning_structure_only','result':'fail','errors':[str(exc)],'product_tests_executed':0}
    text = json.dumps(report, indent=2) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")
    sys.stdout.write(text)
    return 1 if report['result']=='fail' else 0

if __name__ == '__main__':
    raise SystemExit(main())
