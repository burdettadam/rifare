#!/usr/bin/env python3
"""Validate a proposed benchmark and score frozen cohorts offline; never approve a release."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
import hashlib
from pathlib import Path
import re
import sys
from typing import Any

from check_support_envelope import load_document, load_verified_baseline, validate_envelope
import json

COST_KEYS = ('model', 'messaging', 'shipping', 'hosting', 'operator')
STRATUM_KEYS = ('platform', 'profile', 'skill', 'policy', 'runtime', 'model', 'mode')
GATES = {
    'mandatory_safety_pass_bps', 'correct_handling_bps_min',
    'unique_executed_product_variants_min', 'quality_stratum_cases_min',
    'pilot_merchants_min', 'pilot_in_scope_cases_min', 'pilot_consecutive_days_min',
    'followup_days', 'followup_coverage_bps_min', 'duplicate_effects_max',
    'unauthorized_actions_max', 'open_sev0_findings_max', 'open_sev1_findings_max',
    'commerce_platforms_min', 'independent_agent_runtimes_min',
    'cloud_provider_configurations_min', 'local_model_configurations_min',
}
METRIC_IDS = {
    'correct_handling', 'autonomous_resolution', 'required_handoff_compliance',
    'handoff_rate', 'human_resolution_rate', 'attempt_rate', 'repeat_contact_7d',
    'case_cost', 'operator_time', 'retained_contribution_margin',
    'financial_reconciliation', 'appeal_and_satisfaction',
}
CATEGORIES = {
    'M00': 'governance_and_development', 'M01': 'identity_and_read_only',
    'M02': 'policy_and_action_safety', 'M03': 'returns_and_baseline_exchanges',
    'M04': 'order_editing_and_fulfillment', 'M05': 'support_tracking_and_autonomy',
    'M06': 'advanced_returns', 'M07': 'portability_and_operations',
    'M08': 'shipping_and_warehouse', 'M09': 'conversion_and_marketing',
    'M10': 'warranty_disputes_and_partners', 'M11': 'inventory_and_procurement',
    'M12': 'ecosystem_and_multistore',
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def shape(value: Any, fields: dict[str, Any], label: str) -> dict[str, Any]:
    require(type(value) is dict, f'{label}: expected object')
    require(set(value) == set(fields), f'{label}: missing or unexpected fields')
    for key, expected in fields.items():
        types = expected if isinstance(expected, tuple) else (expected,)
        require(type(value[key]) in types, f'{label}.{key}: wrong type')
        if isinstance(value[key], str):
            require(bool(value[key].strip()), f'{label}.{key}: empty text')
    return value


def index(rows: Any, fields: dict[str, Any], label: str, key: str = 'id') -> dict[str, Any]:
    require(type(rows) is list and bool(rows), f'{label}: nonempty list required')
    result = {}
    for row in rows:
        shape(row, fields, label)
        identity = row[key]
        require(identity not in result, f'{label}: duplicate identity {identity}')
        result[identity] = row
    return result


def string_list(value: Any, label: str) -> None:
    require(type(value) is list and bool(value), f'{label}: nonempty list required')
    require(all(type(x) is str and bool(x.strip()) for x in value), f'{label}: nonempty strings required')
    require(len(set(value)) == len(value), f'{label}: duplicate entry')


def timestamp(value: Any, label: str) -> datetime:
    require(type(value) is str and bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', value)),
            f'{label}: exact UTC timestamp required')
    return datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ')


def content_digest(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    return hashlib.sha256(raw).hexdigest()


def compare_benchmarks(candidate: Any, baseline: Any) -> list[str]:
    """All semantic changes require a decision; changing revision is not approval."""
    require(type(candidate) is dict and type(baseline) is dict, 'benchmark comparison needs objects')
    errors = [f'review_required:changed_benchmark_field:{key}'
              for key in sorted((set(candidate) | set(baseline)) - {'revision'})
              if candidate.get(key) != baseline.get(key)]
    if (type(candidate.get('revision')) is not int or type(baseline.get('revision')) is not int
            or candidate['revision'] < baseline['revision']):
        errors.append('review_required:invalid_or_backwards_revision')
    return errors


def validate_benchmark(document: Any, root: Path) -> list[str]:
    """Bind the proposal to exact earlier scope and every unchanged scenario contract."""
    try:
        b = shape(document, {
            'schema_version': str, 'project': str, 'goal_id': str, 'benchmark_id': str,
            'revision': int, 'status': str, 'human_approval_ref': type(None), 'dependency': dict,
            'scenario_inventory': dict, 'release': dict, 'gates': dict,
            'severity_definitions': list, 'cohort_rules': dict, 'metrics': list,
            'load_recovery': dict, 'pilot': dict, 'roles': list,
        }, 'benchmark')
        for key, expected in {'schema_version':'1.0', 'project':'Rifare', 'goal_id':'M00-G02',
                              'benchmark_id':'rifare-v1-benchmark', 'status':'proposed'}.items():
            require(b[key] == expected, f'benchmark.{key}: must be {expected}')
        require(b['revision'] > 0, 'benchmark revision must be positive')
        dep = shape(b['dependency'], {'goal_id':str, 'status':str, 'envelope_id':str,
                                    'revision':int, 'path':str, 'sha256':str}, 'dependency')
        require(dep['goal_id'] == 'M00-G01' and dep['status'] == 'pending_acceptance',
                'dependency: acceptance is not established by this proposal')
        require(dep['path'] == 'planning/support-envelope.json', 'dependency: noncanonical path')
        envelope = load_verified_baseline(root / dep['path'], dep['sha256'])
        errors = validate_envelope(envelope, root)
        require(not errors, f'dependency envelope invalid: {errors}')
        require((dep['envelope_id'], dep['revision']) == (envelope['envelope_id'], envelope['revision']),
                'dependency: identity or revision mismatch')
        inventory_ref = shape(b['scenario_inventory'], {'path':str, 'sha256':str,
            'scenario_count':int, 'retained_seed_count':int, 'status':str}, 'scenario_inventory')
        require(inventory_ref['path'] == 'planning/benchmark-scenarios.json', 'inventory: noncanonical path')
        require(inventory_ref['status'] == 'specifications_not_qualification', 'inventory is not executed qualification')
        inv = load_verified_baseline(root / inventory_ref['path'], inventory_ref['sha256'])
        shape(inv, {'schema_version':str, 'project':str, 'goal_id':str, 'status':str,
                    'specifications_path':str, 'specifications_sha256':str, 'note':str,
                    'scenarios':list}, 'inventory')
        require(inv['schema_version'] == '1.0' and inv['project'] == 'Rifare' and inv['goal_id'] == 'M00-G02'
                and inv['status'] == 'proposed_specification_inventory', 'inventory identity/status invalid')
        require(inv['specifications_path'] == 'planning/test-specifications.json', 'inventory specification path invalid')
        specs = load_verified_baseline(root / inv['specifications_path'], inv['specifications_sha256'])['tests']
        source = {s['id']:s for s in specs}
        require(len(source) == len(specs), 'duplicate source specification')
        rows = index(inv['scenarios'], {k:str for k in ('id','goal_id','milestone','category','severity',
            'kind','layer','stage','specification_sha256','execution_status')}, 'scenarios')
        require(set(rows) == set(source), 'inventory: missing or invented scenario ID')
        seeds = {s['id'] for s in load_document(root / 'reference/original-acceptance-tests.json')['tests']}
        require(inventory_ref['scenario_count'] == len(rows), 'inventory scenario count mismatch')
        require(inventory_ref['retained_seed_count'] == len(seeds) and seeds <= set(rows), 'retained seeds mismatch')
        for identity, row in rows.items():
            s = source[identity]
            expected = {'id':identity, 'goal_id':s['goal_id'], 'milestone':s['milestone'],
                'category':CATEGORIES[s['milestone']], 'severity':s['severity'], 'kind':s['kind'],
                'layer':s.get('level','retained_source_scenario'),
                'stage':'v1_candidate' if s['milestone'] <= 'M07' else 'expansion',
                'specification_sha256':content_digest(s), 'execution_status':'not_run'}
            require(row == expected, f'inventory changed specification/classification: {identity}')
        release = shape(b['release'], {'milestone':str, 'qualified':bool, 'execution_authorized':bool,
            'pilot_authorized':bool, 'live_observations':int, 'decision':str}, 'release')
        require(release == {'milestone':'M07', 'qualified':False, 'execution_authorized':False,
            'pilot_authorized':False, 'live_observations':0, 'decision':'pending_owner_and_independent_review'},
            'release/pilot authority and live evidence must remain unclaimed')
        gates = shape(b['gates'], {key:int for key in GATES}, 'gates')
        for key, value in gates.items():
            require(value >= 0 if key.endswith('_max') else value > 0, f'gates.{key}: invalid target')
            if 'bps' in key:
                require(value <= 10000, f'gates.{key}: basis points above 100%')
        require(gates['mandatory_safety_pass_bps'] == 10000, 'mandatory safety cannot allow failures')
        require(all(gates[k] == 0 for k in GATES if k.endswith('_max')), 'critical/authority exceptions not permitted')
        severities = index(b['severity_definitions'], {'id':str,'name':str,'criteria':str,
            'response':str,'blocks_release':bool}, 'severities')
        require(set(severities) == {'SEV0','SEV1','SEV2','SEV3'}, 'severity set incomplete')
        require(severities['SEV0']['blocks_release'] and severities['SEV1']['blocks_release'],
                'critical/high severity cannot be nonblocking')
        rules = shape(b['cohort_rules'], {**{k:str for k in ('identity','enrollment','exclusions','pooling',
            'followup','critical','selection','baseline_trust')}, 'sources':list}, 'cohort_rules')
        require(rules['sources'] == ['synthetic','connected_test','live'], 'evidence sources must remain separate')
        metrics = index(b['metrics'], {k:str for k in ('id','numerator','denominator','unit','zero_denominator')}, 'metrics')
        require(set(metrics) == METRIC_IDS, 'metric definitions missing or invented')
        require(all(m['zero_denominator'] == 'not_evaluable' for m in metrics.values()), 'zero denominator is not a pass')
        roles = index(b['roles'], {'id':str,'responsibility':str,'assignee':type(None),
                                  'approval_ref':type(None)}, 'roles')
        require(set(roles) == {'product_owner','benchmark_custodian','pilot_lead','merchant_authorizer',
            'operations_owner','privacy_security_owner','independent_regression_reviewer',
            'independent_authority_reviewer'}, 'pilot/review role coverage incomplete')
        load = shape(b['load_recovery'], {'profile_id':str,'status':str,'application':dict,'database':dict,
            'dataset':dict,'traffic':dict,'targets':dict,'definitions':str,'owning_goals':list,'owner_role':str}, 'load_recovery')
        require(load['status'] == 'proposed_not_measured', 'load targets are not measurements')
        load_keys = {'application':('cpu_vcpu','ram_gib'), 'database':('cpu_vcpu','ram_gib','storage_gib'),
            'dataset':('stores','orders','events','concurrent_sessions'),
            'traffic':('sustained_http_requests_per_second','sustained_ingest_events_per_second','burst_multiplier',
                       'burst_seconds','warmup_seconds','measured_seconds'),
            'targets':('internal_read_p95_ms','internal_write_accept_p95_ms','reconciliation_normal_max_seconds',
                       'unknown_operation_alert_after_seconds','max_reconciliation_attempts_per_window',
                       'reconciliation_window_seconds','retry_backoff_cap_seconds','backup_interval_seconds',
                       'ordinary_state_rpo_seconds','restore_rto_seconds','unreconciled_live_writes_on_restore_max')}
        for group, keys in load_keys.items():
            shape(load[group], {key:int for key in keys}, f'load_recovery.{group}')
            for key, value in load[group].items():
                require(value == 0 if key == 'unreconciled_live_writes_on_restore_max' else value > 0,
                        f'load_recovery.{group}.{key}: invalid target')
        require(load['targets']['backup_interval_seconds'] <= load['targets']['ordinary_state_rpo_seconds'],
                'backup interval exceeds proposed RPO')
        require(load['owner_role'] in roles, 'load owner role missing')
        string_list(load['owning_goals'], 'load owning goals')
        goals = {g['id'] for g in load_document(root/'planning/goals.json')['goals']}
        require(set(load['owning_goals']) <= goals, 'load goal does not exist')
        p = shape(b['pilot'], {'status':str,'recruited_merchants':int,'observations':int,'consent_status':str,
            'recruitment':str,'plan_goal':str,'observation_goal':str,'phases':list,'start_requirements':list,
            'observation_plan':str,'stop_rules':list,'retention':str,'insufficient_evidence':str}, 'pilot')
        require((p['status'],p['recruited_merchants'],p['observations'],p['consent_status']) ==
                ('not_started',0,0,'not_obtained'), 'pilot cannot claim observations/consent')
        require(p['plan_goal'] == 'M07-G17' and p['observation_goal'] == 'M07-G18', 'pilot owner goals changed')
        for key in ('phases','start_requirements','stop_rules'):
            string_list(p[key], f'pilot.{key}')
        require(p['phases'] == ['synthetic_only','connected_test_store','read_only_shadow',
                                'human_approval_pilot','bounded_autonomy'], 'pilot stages changed')
        return []
    except (ValueError, KeyError, TypeError, OSError, UnicodeError) as exc:
        return [str(exc)]


def ratio(numerator: int | None, denominator: int) -> dict[str, Any]:
    value = None if numerator is None or denominator == 0 else str(
        (Decimal(numerator) / Decimal(denominator)).quantize(Decimal('0.000001'), rounding=ROUND_HALF_UP))
    return {'numerator':numerator, 'denominator':denominator, 'ratio':value}


def validate_cohort(benchmark: dict[str, Any], envelope: dict[str, Any], manifest: Any,
                    results: Any, manifest_sha256: str) -> tuple[dict, dict, dict, dict]:
    """Check the sealed membership and assertions before calculating any denominator."""
    m = shape(manifest, {'schema_version':str,'project':str,'benchmark_id':str,'benchmark_revision':int,
        'benchmark_sha256':str,'cohort_id':str,'purpose':str,'enrollment_frozen_at':str,
        'observation_cutoff':str,'sources':list,'strata':list,'cases':list}, 'cohort manifest')
    require(m['schema_version'] == '1.0' and m['project'] == 'Rifare', 'cohort identity invalid')
    require((m['benchmark_id'], m['benchmark_revision']) == (benchmark['benchmark_id'],benchmark['revision']),
            'cohort benchmark identity/revision mismatch')
    require(m['purpose'] in ('synthetic_example','declared_observations'), 'unknown cohort purpose')
    cutoff = timestamp(m['observation_cutoff'], 'cutoff')
    frozen = timestamp(m['enrollment_frozen_at'], 'enrollment_frozen_at')
    require(frozen <= cutoff, 'cohort enrollment freezes after observation cutoff')
    sources = index(m['sources'], {'id':str,'kind':str,'provenance_ref':str}, 'sources')
    for source in sources.values():
        require(source['kind'] in benchmark['cohort_rules']['sources'], 'unknown evidence source kind')
        require(m['purpose'] != 'synthetic_example' or source['kind'] == 'synthetic',
                'synthetic example cannot become live/connected evidence')
    strata = index(m['strata'], {k:str for k in ('id',*STRATUM_KEYS)}, 'strata')
    for s in strata.values():
        require(s['mode'] in ('manual','read_only','copilot','approval_gated','bounded_autonomy'),
                'unknown autonomy mode')
    signatures = [tuple(s[k] for k in STRATUM_KEYS) for s in strata.values()]
    require(len(signatures) == len(set(signatures)), 'duplicate configuration stratum')
    contexts = {c['id']:c for c in envelope['contexts']}
    scope = {c['id']:c for c in envelope['capabilities']}
    cases = index(m['cases'], {'id':str,'source_id':str,'stratum_id':str,'scope_id':str,'in_scope':bool,
        'scope_reason':str,'expected':str,'enrolled_at':str,'currency':str}, 'cases')
    for c in cases.values():
        require(c['source_id'] in sources and c['stratum_id'] in strata, 'case source/stratum not declared')
        require(c['scope_id'] in scope, 'case scope ID not declared')
        row = scope[c['scope_id']]
        context = contexts[row['context_id']]
        require(strata[c['stratum_id']]['platform'] == context['platform'], 'case platform contradicts scope')
        require(c['currency'] == context['currency'] == 'USD', 'cohort currency must match the initial USD scope')
        require(c['in_scope'] == (row['support'] != 'excluded'), 'case exclusion contradicts frozen scope')
        require(c['expected'] in ('resolve','handoff','reject'), 'case expectation invalid')
        require(c['in_scope'] or c['expected'] == 'reject', 'out-of-scope action requires rejection')
        require(timestamp(c['enrolled_at'], 'enrolled_at') <= frozen, 'case enrolled after cohort freeze')
    require({c['source_id'] for c in cases.values()} == set(sources), 'empty evidence source cannot pass')
    require({c['stratum_id'] for c in cases.values()} == set(strata), 'empty declared stratum cannot pass')
    r = shape(results, {'schema_version':str,'project':str,'cohort_id':str,'manifest_sha256':str,
        'candidate_ref':str,'results':list}, 'cohort results')
    require(r['schema_version'] == '1.0' and r['project'] == 'Rifare' and r['cohort_id'] == m['cohort_id'],
            'cohort result identity mismatch')
    require(r['manifest_sha256'] == manifest_sha256, 'results not bound to retained enrollment')
    observations = index(r['results'], {'case_id':str,'disposition':str,'oracle_verdict':str,
        'oracle_ref':(str,type(None)), 'actor':str,'agent_attempted':bool,'autonomous_resolution':bool,
        'observed_at':str,'completed_at':(str,type(None)),'followup_through':(str,type(None)),
        'repeat_contact':(bool,type(None)),'repeat_ref':(str,type(None)),'severity':str,
        'cost_minor':(dict,type(None)), 'operator_seconds':(int,type(None))}, 'results', key='case_id')
    require(set(cases) == set(observations), 'cohort membership mismatch: every enrolled case needs exactly one result')
    for identity, o in observations.items():
        c = cases[identity]
        require(o['disposition'] in ('resolved','handed_off','failed','pending','cancelled','rejected'),
                f'{identity}: invalid disposition')
        require(o['oracle_verdict'] in ('correct','incorrect','unassessed'), f'{identity}: invalid oracle verdict')
        require(o['actor'] in ('agent','human','none'), f'{identity}: invalid actor')
        require(o['severity'] in ('none','SEV0','SEV1','SEV2','SEV3'), f'{identity}: invalid severity')
        require(o['oracle_verdict'] == 'unassessed' or o['oracle_ref'] is not None,
                f'{identity}: assessed outcome needs independent oracle reference')
        observed = timestamp(o['observed_at'], 'observed_at')
        require(frozen <= observed <= cutoff, f'{identity}: observation outside cohort window')
        completed = timestamp(o['completed_at'],'completed_at') if o['completed_at'] is not None else None
        if completed:
            require(frozen <= completed <= observed,
                    f'{identity}: completion outside observed window')
        require((o['disposition'] == 'pending') == (completed is None),
                f'{identity}: pending must be incomplete; terminal results need completion time')
        if o['oracle_verdict'] == 'correct':
            expected_disposition = {'resolve':'resolved','handoff':'handed_off','reject':'rejected'}[c['expected']]
            require(o['disposition'] == expected_disposition, f'{identity}: correct verdict contradicts frozen expectation')
        if o['autonomous_resolution']:
            require(strata[c['stratum_id']]['mode'] in ('read_only','bounded_autonomy'),
                    f'{identity}: configured mode cannot claim autonomous resolution')
            require(c['in_scope'] and c['expected'] == 'resolve' and o['disposition'] == 'resolved'
                    and o['actor'] == 'agent' and o['agent_attempted'] and o['oracle_verdict'] == 'correct',
                    f'{identity}: handoff/failure/human completion cannot count as autonomous resolution')
        if o['oracle_verdict'] == 'correct' and o['disposition'] == 'resolved' and o['actor'] == 'agent':
            require(o['autonomous_resolution'], f'{identity}: correct agent resolution must be classified consistently')
        require(o['actor'] != 'agent' or o['agent_attempted'], f'{identity}: agent actor requires recorded attempt')
        if o['disposition'] in ('resolved','handed_off','rejected'):
            require(o['actor'] != 'none', f'{identity}: terminal action needs actual actor')
        if o['disposition'] != 'resolved':
            require(all(o[k] is None for k in ('followup_through','repeat_contact','repeat_ref')),
                    f'{identity}: only completed resolutions enter the repeat-contact cohort')
        else:
            if o['followup_through'] is not None:
                through = timestamp(o['followup_through'], 'followup_through')
                require(completed <= through <= observed, f'{identity}: follow-up outside observed window')
            require((o['repeat_contact'] is None) == (o['repeat_ref'] is None),
                    f'{identity}: repeat-contact assertion needs evidence reference')
        if o['cost_minor'] is not None:
            shape(o['cost_minor'], {k:int for k in COST_KEYS}, f'{identity}.cost_minor')
            require(all(0 <= v <= 9_000_000_000_000_000 for v in o['cost_minor'].values()), f'{identity}: cost outside supported nonnegative integer range')
        require(o['operator_seconds'] is None or 0 <= o['operator_seconds'] <= 9_000_000_000_000_000, f'{identity}: operator time cannot be negative')
    return sources, strata, cases, observations


def summarize(cases: list[dict], observations: dict, benchmark: dict, cutoff: datetime) -> dict:
    scoped = [c for c in cases if c['in_scope']]
    n = len(scoped)
    o = [observations[c['id']] for c in scoped]
    all_o = [observations[c['id']] for c in cases]
    correct = sum(x['oracle_verdict'] == 'correct' for x in o)
    resolved = [x for x in o if x['disposition'] == 'resolved']
    correct_resolved = sum(x['oracle_verdict'] == 'correct' for x in resolved)
    handoff_cases = [c for c in scoped if c['expected'] == 'handoff']
    resolution_eligible = sum(c['expected'] == 'resolve' for c in scoped)
    autonomous = sum(x['autonomous_resolution'] for x in o)
    window = timedelta(days=benchmark['gates']['followup_days'])
    mature = [x for x in resolved if timestamp(x['completed_at'],'completed_at') + window <= cutoff]
    complete_followup = [x for x in mature if x['followup_through'] is not None
                        and timestamp(x['followup_through'],'followup_through') >= timestamp(x['completed_at'],'completed_at') + window
                        and x['repeat_contact'] is not None and x['repeat_ref'] is not None]
    repeat = sum(x['repeat_contact'] is True for x in complete_followup)
    known_cost = [x for x in o if x['cost_minor'] is not None]
    costs = {k:sum(x['cost_minor'][k] for x in known_cost) for k in COST_KEYS}
    known_all_cost = [x for x in all_o if x['cost_minor'] is not None]
    all_costs = {k:sum(x['cost_minor'][k] for x in known_all_cost) for k in COST_KEYS}
    known_time = [x['operator_seconds'] for x in o if x['operator_seconds'] is not None]
    severity = {k:sum(x['severity'] == k for x in all_o) for k in ('none','SEV0','SEV1','SEV2','SEV3')}
    counts = {'enrolled':len(cases),'in_scope':n,'out_of_scope':len(cases)-n,
        'correct_handled':correct,'correct_resolved':correct_resolved,'autonomous_resolved':autonomous,
        'incorrect':sum(x['oracle_verdict']=='incorrect' for x in o),
        'unassessed':sum(x['oracle_verdict']=='unassessed' for x in o),
        'agent_attempted':sum(x['agent_attempted'] for x in o),
        'dispositions':{k:sum(x['disposition']==k for x in o) for k in
                        ('resolved','handed_off','failed','pending','cancelled','rejected')},
        'severity_all_enrolled':severity,
        'mature_resolutions':len(mature),'immature_resolutions':len(resolved)-len(mature),
        'missing_mature_followup':len(mature)-len(complete_followup),
        'observed_mature_repeat_contacts':repeat,'cost_known_cases':len(known_cost),
        'operator_time_known_cases':len(known_time)}
    metrics = {
        'correct_handling':ratio(correct,n), 'autonomous_resolution_all':ratio(autonomous,n),
        'autonomous_resolution_eligible':ratio(autonomous,resolution_eligible),
        'required_handoff_compliance':ratio(sum(observations[c['id']]['oracle_verdict']=='correct'
            and observations[c['id']]['disposition']=='handed_off' for c in handoff_cases),len(handoff_cases)),
        'handoff_rate':ratio(sum(x['disposition']=='handed_off' for x in o),n),
        'human_resolution_rate':ratio(sum(x['disposition']=='resolved' and x['actor']=='human'
            and x['oracle_verdict']=='correct' for x in o),n),
        'attempt_rate':ratio(counts['agent_attempted'],n),
        'repeat_contact_7d':ratio(repeat if len(complete_followup)==len(mature) else None,len(mature)),
        'followup_coverage':ratio(len(complete_followup),len(mature)),
        'cost_minor_per_correct_resolution':ratio(sum(costs.values()) if len(known_cost)==n else None,correct_resolved),
        'operator_seconds_per_case':ratio(sum(known_time) if len(known_time)==n else None,n),
    }
    return {'counts':counts, 'metrics':metrics,
        'costs':{'currency':'USD','in_scope_known_minor':costs,'all_enrolled_known_minor':all_costs,
                 'all_enrolled_known_cases':len(known_all_cost)},
        'quality_targets_observed':{
            'correct_handling_threshold':bool(n and correct*10000 >= benchmark['gates']['correct_handling_bps_min']*n),
            'minimum_stratum_count':n >= benchmark['gates']['quality_stratum_cases_min'],
            'no_sev0_or_sev1':severity['SEV0']==0 and severity['SEV1']==0,
            'mature_followup_complete':bool(mature) and len(complete_followup)==len(mature),
            'all_resolutions_followup_mature':bool(resolved) and len(mature)==len(resolved),
        }}


def score_cohort(benchmark: dict, envelope: dict, manifest: Any, results: Any,
                 manifest_sha256: str, benchmark_sha256: str) -> dict:
    """Arithmetic over checked frozen inputs; input authenticity still needs independent review."""
    require(type(manifest) is dict and manifest.get('benchmark_sha256') == benchmark_sha256,
            'cohort benchmark digest mismatch')
    sources, strata, cases, observations = validate_cohort(benchmark,envelope,manifest,results,manifest_sha256)
    cutoff = timestamp(manifest['observation_cutoff'],'cutoff')
    report = {'cohort_id':manifest['cohort_id'],'benchmark_id':benchmark['benchmark_id'],
        'purpose':manifest['purpose'],'manifest_sha256':manifest_sha256,
        'benchmark_sha256':benchmark_sha256,'candidate_ref':results['candidate_ref'],
        'execution_authorized':False,'release_qualified':False,
        'pilot_authorized':False,'verified_live_observations':0,
        'evidence_authenticity':'not_verified_by_this_offline_helper',
        'note':'Arithmetic and declared targets only. Sources are never pooled; stratum rates do not qualify other configurations. Independent provenance, accepted scope, live enrollment and release decisions remain required.',
        'by_source':[]}
    for source_id in sorted(sources):
        group = [c for c in cases.values() if c['source_id'] == source_id]
        by_stratum = []
        for stratum_id in sorted({c['stratum_id'] for c in group}):
            subset = [c for c in group if c['stratum_id'] == stratum_id]
            by_stratum.append({'stratum_id':stratum_id,
                'configuration':{k:strata[stratum_id][k] for k in STRATUM_KEYS},
                **summarize(subset,observations,benchmark,cutoff)})
        report['by_source'].append({'source_id':source_id,'source_kind':sources[source_id]['kind'],
            'aggregate':summarize(group,observations,benchmark,cutoff), 'strata':by_stratum})
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
    parser.add_argument('--benchmark',type=Path)
    parser.add_argument('--baseline',type=Path)
    parser.add_argument('--baseline-sha256')
    parser.add_argument('--manifest',type=Path)
    parser.add_argument('--manifest-sha256')
    parser.add_argument('--results',type=Path)
    args = parser.parse_args()
    if bool(args.baseline) != bool(args.baseline_sha256):
        parser.error('--baseline and --baseline-sha256 must be supplied together')
    if any((args.manifest,args.manifest_sha256,args.results)) and not all((args.manifest,args.manifest_sha256,args.results)):
        parser.error('--manifest, --manifest-sha256 and --results must be supplied together')
    report = {'document_valid':False,'baseline_compared':False,'goal_acceptance':'pending_external_review',
        'execution_authorized':False,'release_qualified':False,'errors':[]}
    try:
        path = args.benchmark or args.root/'planning/release-benchmark.json'
        raw = path.read_bytes()
        sha = hashlib.sha256(raw).hexdigest()
        # Reuse the parser that verifies and parses the same bytes once.
        from check_support_envelope import _parse_document
        benchmark = _parse_document(raw.decode('utf-8'))
        errors = validate_benchmark(benchmark,args.root)
        if not errors and args.baseline:
            baseline = load_verified_baseline(args.baseline,args.baseline_sha256)
            errors.extend(compare_benchmarks(benchmark,baseline))
            report['baseline_compared'] = True
        if not errors and args.manifest:
            manifest = load_verified_baseline(args.manifest,args.manifest_sha256)
            envelope = load_verified_baseline(args.root/benchmark['dependency']['path'],benchmark['dependency']['sha256'])
            report['cohort'] = score_cohort(benchmark,envelope,manifest,load_document(args.results),args.manifest_sha256,sha)
        report.update(document_valid=not errors,errors=errors)
    except (ValueError,TypeError,KeyError,OSError,UnicodeError,OverflowError) as exc:
        report['errors'].append(str(exc))
    print(json.dumps(report,indent=2))
    return 0 if report['document_valid'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
