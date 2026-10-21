"""M00-G02 document and arithmetic contracts; no commerce or live-pilot qualification."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'tools'))
from check_release_benchmark import compare_benchmarks, ratio, score_cohort, validate_benchmark
from check_support_envelope import load_document, load_verified_baseline

FIX = ROOT/'tests/fixtures/release-benchmark'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ReleaseBenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.b = load_document(ROOT/'planning/release-benchmark.json')
        self.e = load_document(ROOT/'planning/support-envelope.json')
        self.m = load_document(FIX/'cohort.manifest.SYNTHETIC.json')
        self.r = load_document(FIX/'cohort.results.SYNTHETIC.json')
        self.bsha = sha(ROOT/'planning/release-benchmark.json')
        self.msha = sha(FIX/'cohort.manifest.SYNTHETIC.json')
        self.expected = load_document(FIX/'expected-cohort.v1.json')

    def score(self):
        return score_cohort(self.b,self.e,self.m,self.r,self.msha,self.bsha)

    def bad_score(self, needle):
        with self.assertRaisesRegex(ValueError,needle):
            self.score()

    def cli(self, *args):
        return subprocess.run([sys.executable,str(ROOT/'tools/check_release_benchmark.py'),
            '--root',str(ROOT),*map(str,args)],capture_output=True,text=True,timeout=20)

    def test_CASE_M00_G02_01_hand_calculated_cohort_matches_every_aggregate_value(self):
        """CASE-M00-G02-01: independent counts include repeat, handoff and exclusions."""
        self.assertEqual(validate_benchmark(self.b,ROOT),[])
        report = self.score()
        self.assertEqual(len(report['by_source']),1)
        self.assertEqual(report['by_source'][0]['aggregate'],self.expected['aggregate'])
        for actual in report['by_source'][0]['strata']:
            expected = self.expected['strata'][actual['stratum_id']]
            for group, values in expected.items():
                for key, value in values.items():
                    with self.subTest(stratum=actual['stratum_id'],group=group,key=key):
                        self.assertEqual(actual[group][key],value)

    def test_CASE_M00_G02_02_missing_in_scope_failure_invalidates_cohort(self):
        """CASE-M00-G02-02: a submitted success rate cannot omit the hard case."""
        self.r['results'] = [r for r in self.r['results'] if r['case_id'] != 'CASE-004']
        self.bad_score('membership mismatch')

    def test_CASE_M00_G02_03_frozen_gate_change_or_false_live_label_requires_review(self):
        """CASE-M00-G02-03: version bumps and source relabeling cannot invent approval."""
        baseline = load_document(FIX/'expected-benchmark.v1.json')
        self.b['gates']['correct_handling_bps_min'] = 9000
        self.b['revision'] += 1
        self.assertIn('review_required:changed_benchmark_field:gates',compare_benchmarks(self.b,baseline))
        self.b = baseline
        self.m['sources'][0]['kind'] = 'live'
        self.bad_score('synthetic example cannot become live')

    def test_required_handoff_cannot_be_counted_as_autonomous(self):
        self.r['results'][2]['autonomous_resolution'] = True
        self.bad_score('handoff/failure/human completion')

    def test_required_handoff_cannot_be_rewritten_as_correct_resolution(self):
        self.r['results'][2]['disposition'] = 'resolved'
        self.r['results'][2]['autonomous_resolution'] = True
        self.bad_score('contradicts frozen expectation')

    def test_denominator_retains_failure_pending_and_cancelled(self):
        a = self.score()['by_source'][0]['aggregate']
        self.assertEqual(a['metrics']['correct_handling'],{'numerator':6,'denominator':10,'ratio':'0.600000'})
        self.assertEqual(a['counts']['dispositions']['pending'],1)
        self.assertEqual(a['counts']['dispositions']['cancelled'],1)
        self.assertEqual(a['counts']['incorrect'],2)

    def test_pending_case_cannot_claim_correctness(self):
        self.r['results'][4]['oracle_verdict'] = 'correct'
        self.r['results'][4]['oracle_ref'] = 'fabricated-oracle'
        self.bad_score('contradicts frozen expectation')

    def test_human_completion_is_not_autonomous(self):
        self.r['results'][6]['autonomous_resolution'] = True
        self.bad_score('handoff/failure/human completion')

    def test_copilot_cannot_claim_autonomous_resolution(self):
        self.m['strata'][0]['mode'] = 'copilot'
        self.bad_score('configured mode')

    def test_unknown_autonomy_mode_fails(self):
        self.m['strata'][0]['mode'] = 'anything-goes'
        self.bad_score('unknown autonomy mode')

    def test_failed_oracle_reference_cannot_be_omitted(self):
        self.r['results'][3]['oracle_ref'] = None
        self.bad_score('independent oracle reference')

    def test_duplicate_result_rejected(self):
        self.r['results'].append(copy.deepcopy(self.r['results'][0]))
        self.bad_score('duplicate identity')

    def test_extra_result_is_not_a_new_success(self):
        extra = copy.deepcopy(self.r['results'][0]); extra['case_id'] = 'EXTRA'
        self.r['results'].append(extra)
        self.bad_score('membership mismatch')

    def test_removed_out_of_scope_case_also_invalidates_cohort(self):
        self.r['results'].pop(10)
        self.bad_score('membership mismatch')

    def test_result_cannot_relabel_its_source_or_scope(self):
        for key, value in [('in_scope',False),('source_kind','live'),('denominator',1)]:
            with self.subTest(field=key):
                original = copy.deepcopy(self.r)
                self.r['results'][3][key] = value
                self.bad_score('missing or unexpected fields')
                self.r = original

    def test_case_scope_cannot_disagree_with_envelope(self):
        self.m['cases'][3]['in_scope'] = False
        self.bad_score('exclusion contradicts frozen scope')

    def test_case_platform_cannot_disagree_with_envelope(self):
        self.m['strata'][0]['platform'] = 'woocommerce'
        self.bad_score('platform contradicts scope')

    def test_currency_is_not_silently_pooled(self):
        self.m['cases'][0]['currency'] = 'EUR'
        self.bad_score('currency must match')

    def test_unlisted_case_scope_rejected(self):
        self.m['cases'][0]['scope_id'] = 'SCOPE-999'
        self.bad_score('scope ID not declared')

    def test_unknown_source_rejected(self):
        self.m['cases'][0]['source_id'] = 'UNKNOWN'
        self.bad_score('source/stratum not declared')

    def test_duplicate_enrollment_rejected(self):
        self.m['cases'].append(copy.deepcopy(self.m['cases'][0]))
        self.bad_score('duplicate identity')

    def test_duplicate_configuration_under_new_label_rejected(self):
        self.m['strata'][1] = dict(self.m['strata'][0],id='STRATUM-B')
        self.bad_score('duplicate configuration stratum')

    def test_empty_sources_and_strata_are_not_qualified(self):
        self.m['sources'].append({'id':'EMPTY','kind':'synthetic','provenance_ref':'unused'})
        self.bad_score('empty evidence source')
        self.m['sources'].pop()
        self.m['strata'].append(dict(self.m['strata'][0],id='EMPTY',model='different'))
        self.bad_score('empty declared stratum')

    def test_empty_cohort_and_zero_denominators_do_not_pass(self):
        self.assertEqual(ratio(0,0),{'numerator':0,'denominator':0,'ratio':None})
        self.m['cases'] = []
        self.bad_score('nonempty list')

    def test_all_out_of_scope_cohort_has_no_quality_score(self):
        self.m['cases'] = [c for c in self.m['cases'] if not c['in_scope']]
        ids = {c['id'] for c in self.m['cases']}
        self.r['results'] = [r for r in self.r['results'] if r['case_id'] in ids]
        a = self.score()['by_source'][0]['aggregate']
        self.assertIsNone(a['metrics']['correct_handling']['ratio'])
        self.assertFalse(a['quality_targets_observed']['correct_handling_threshold'])
        self.assertFalse(a['quality_targets_observed']['no_sev0_or_sev1'])

    def test_reordering_results_does_not_change_scores(self):
        before = self.score()
        self.r['results'].reverse()
        self.assertEqual(self.score(),before)

    def test_configuration_strata_remain_separate(self):
        groups = self.score()['by_source'][0]['strata']
        self.assertEqual({g['stratum_id'] for g in groups},{'STRATUM-A','STRATUM-B'})
        self.assertEqual([g['metrics']['autonomous_resolution_all']['numerator'] for g in groups],[2,1])
        self.assertTrue(all(g['metrics']['correct_handling']['denominator']==5 for g in groups))

    def test_evidence_sources_are_not_pooled_or_attested(self):
        # In-memory protocol fixture, not an actual connected or live observation.
        self.m['purpose'] = 'declared_observations'
        self.m['sources'].append({'id':'SOURCE-TEST','kind':'connected_test','provenance_ref':'synthetic-protocol-fixture'})
        for c in self.m['cases'][6:]: c['source_id'] = 'SOURCE-TEST'
        report = self.score()
        self.assertEqual(len(report['by_source']),2)
        self.assertEqual([s['aggregate']['counts']['in_scope'] for s in report['by_source']],[5,5])
        self.assertEqual(report['verified_live_observations'],0)
        self.assertNotIn('aggregate',report)
        self.assertFalse(report['release_qualified'])

    def test_excluded_safety_failure_blocks_source(self):
        a = self.score()['by_source'][0]['aggregate']
        self.assertEqual(a['counts']['severity_all_enrolled']['SEV0'],1)
        self.assertFalse(a['quality_targets_observed']['no_sev0_or_sev1'])

    def test_missing_mature_followup_does_not_shrink_denominator(self):
        self.r['results'][1].update(followup_through=None,repeat_contact=None,repeat_ref=None)
        a = self.score()['by_source'][0]['aggregate']
        self.assertEqual(a['metrics']['repeat_contact_7d'],{'numerator':None,'denominator':4,'ratio':None})
        self.assertEqual(a['counts']['missing_mature_followup'],1)
        self.assertFalse(a['quality_targets_observed']['mature_followup_complete'])

    def test_short_followup_is_not_mature_coverage(self):
        self.r['results'][1]['followup_through'] = '2026-10-02T00:00:00Z'
        a = self.score()['by_source'][0]['aggregate']
        self.assertEqual(a['metrics']['followup_coverage']['numerator'],3)
        self.assertIsNone(a['metrics']['repeat_contact_7d']['ratio'])

    def test_future_followup_cannot_invent_elapsed_time(self):
        self.r['results'][9]['followup_through'] = '2026-10-25T00:00:00Z'
        self.bad_score('follow-up outside observed window')

    def test_repeat_assertion_requires_evidence_reference(self):
        self.r['results'][1]['repeat_ref'] = None
        self.bad_score('repeat-contact assertion needs')

    def test_handoff_is_not_in_repeat_resolution_cohort(self):
        self.r['results'][2]['followup_through'] = '2026-10-15T00:00:00Z'
        self.bad_score('only completed resolutions')

    def test_immature_resolution_is_visible_not_negative_repeat(self):
        a = self.score()['by_source'][0]['aggregate']
        self.assertEqual(a['counts']['immature_resolutions'],1)
        self.assertFalse(a['quality_targets_observed']['all_resolutions_followup_mature'])
        self.assertEqual(a['metrics']['repeat_contact_7d']['denominator'],4)

    def test_missing_cost_is_unknown_not_zero(self):
        self.r['results'][3]['cost_minor'] = None
        a = self.score()['by_source'][0]['aggregate']
        self.assertEqual(a['counts']['cost_known_cases'],9)
        self.assertIsNone(a['metrics']['cost_minor_per_correct_resolution']['ratio'])

    def test_missing_operator_time_is_not_zero(self):
        self.r['results'][3]['operator_seconds'] = None
        a = self.score()['by_source'][0]['aggregate']
        self.assertEqual(a['counts']['operator_time_known_cases'],9)
        self.assertIsNone(a['metrics']['operator_seconds_per_case']['ratio'])

    def test_negative_fractional_and_boolean_costs_rejected(self):
        for value in (-1,True,1.5,10**40):
            with self.subTest(value=value):
                self.r['results'][0]['cost_minor']['model'] = value
                self.bad_score('cost_minor|cost outside')

    def test_handling_handoffs_are_not_economics_resolutions(self):
        metric = self.score()['by_source'][0]['aggregate']['metrics']['cost_minor_per_correct_resolution']
        self.assertEqual(metric,{'numerator':1000,'denominator':4,'ratio':'250.000000'})

    def test_invalid_result_shapes_fail_closed(self):
        for value in (None,[],{},True,'invalid'):
            with self.subTest(value=value):
                self.r['results'][0] = value
                self.bad_score('expected object|missing or unexpected')

    def test_result_verdict_actor_and_disposition_enums_validated(self):
        for field in ('oracle_verdict','actor','disposition','severity'):
            with self.subTest(field=field):
                original = copy.deepcopy(self.r)
                self.r['results'][0][field] = 'arbitrary'
                self.bad_score('invalid')
                self.r = original

    def test_bad_timestamps_are_not_silent_defaults(self):
        self.r['results'][0]['observed_at'] = '2026-10-16T00:00:00Z'
        self.bad_score('outside cohort window')
        self.r['results'][0]['observed_at'] = 'October 15'
        self.bad_score('exact UTC timestamp')

    def test_post_freeze_enrollment_rejected(self):
        self.m['cases'][0]['enrolled_at'] = '2026-10-02T00:00:00Z'
        self.bad_score('enrolled after cohort freeze')

    def test_observation_cannot_precede_enrollment_freeze(self):
        self.r['results'][0]['observed_at'] = '2026-09-30T18:00:00Z'
        self.bad_score('outside cohort window')

    def test_completion_cannot_predate_predeclared_benchmark(self):
        self.r['results'][0]['completed_at'] = '2026-09-30T18:00:00Z'
        self.bad_score('completion outside observed window')

    def test_good_aggregate_does_not_qualify_bad_stratum(self):
        # Arithmetic fixture: 20 distinct A successes and one B failure, not product evidence.
        a = copy.deepcopy(self.m['cases'][0]); ar = copy.deepcopy(self.r['results'][0])
        b = copy.deepcopy(self.m['cases'][8]); br = copy.deepcopy(self.r['results'][8])
        self.m['cases'] = [b]; self.r['results'] = [br]
        for i in range(20):
            identity = f'SYNTHETIC-SUCCESS-{i:03d}'
            self.m['cases'].append(dict(a,id=identity))
            self.r['results'].append(dict(ar,case_id=identity))
        report = self.score(); source = report['by_source'][0]
        self.assertTrue(source['aggregate']['quality_targets_observed']['correct_handling_threshold'])
        failing = next(s for s in source['strata'] if s['stratum_id']=='STRATUM-B')
        self.assertFalse(failing['quality_targets_observed']['correct_handling_threshold'])
        self.assertFalse(failing['quality_targets_observed']['minimum_stratum_count'])
        self.assertFalse(report['release_qualified'])

    def test_pending_completion_contradiction_rejected(self):
        self.r['results'][4]['completed_at'] = '2026-10-02T00:00:00Z'
        self.bad_score('pending must be incomplete')

    def test_exact_ratio_and_threshold_not_rounded_up(self):
        self.assertEqual(ratio(19,20)['ratio'],'0.950000')
        self.assertEqual(ratio(2,3)['ratio'],'0.666667')
        self.b['gates']['correct_handling_bps_min'] = 6001
        a = self.score()['by_source'][0]['aggregate']
        self.assertFalse(a['quality_targets_observed']['correct_handling_threshold'])
        self.b['gates']['correct_handling_bps_min'] = 6000
        self.assertTrue(self.score()['by_source'][0]['aggregate']['quality_targets_observed']['correct_handling_threshold'])
        self.assertFalse(self.score()['release_qualified'])

    def test_entire_proposed_benchmark_remains_frozen(self):
        baseline = load_document(FIX/'expected-benchmark.v1.json')
        self.assertEqual(compare_benchmarks(self.b,baseline),[])
        self.assertEqual(self.b['revision'],baseline['revision'])

    def test_all_gates_changes_require_review(self):
        for key in self.b['gates']:
            with self.subTest(gate=key):
                candidate = copy.deepcopy(self.b)
                candidate['gates'][key] += 1
                self.assertTrue(compare_benchmarks(candidate,self.b))

    def test_changed_metric_formula_and_denominator_require_review(self):
        for field in ('numerator','denominator'):
            candidate = copy.deepcopy(self.b)
            candidate['metrics'][0][field] = 'Only successful attempted cases.'
            self.assertIn('review_required:changed_benchmark_field:metrics',compare_benchmarks(candidate,self.b))

    def test_backwards_or_boolean_revision_rejected(self):
        for value in (0,True):
            candidate = copy.deepcopy(self.b); candidate['revision'] = value
            self.assertTrue(validate_benchmark(candidate,ROOT))
            self.assertTrue(compare_benchmarks(candidate,self.b))

    def test_extra_authority_field_rejected(self):
        self.b['approved'] = True
        self.assertTrue(validate_benchmark(self.b,ROOT))

    def test_live_pilot_counts_and_self_approval_rejected(self):
        for group,field,value in [('pilot','observations',100),('pilot','recruited_merchants',3),
                                  ('release','qualified',True),('release','pilot_authorized',True),
                                  ('release','live_observations',100)]:
            with self.subTest(group=group,field=field):
                candidate = copy.deepcopy(self.b); candidate[group][field] = value
                self.assertTrue(validate_benchmark(candidate,ROOT))
        self.b['human_approval_ref'] = 'author says approved'
        self.assertTrue(validate_benchmark(self.b,ROOT))

    def test_dependencies_cannot_be_self_accepted(self):
        self.b['dependency']['status'] = 'accepted'
        self.assertTrue(validate_benchmark(self.b,ROOT))

    def test_all_roles_remain_unassigned(self):
        self.assertTrue(all(r['assignee'] is None for r in self.b['roles']))
        self.b['roles'][0]['assignee'] = 'invented reviewer'
        self.assertTrue(validate_benchmark(self.b,ROOT))

    def test_missing_pilot_guard_or_metric_requires_change_control(self):
        for key in ('metrics','roles'):
            candidate = copy.deepcopy(self.b); candidate[key].pop()
            self.assertTrue(validate_benchmark(candidate,ROOT))
        candidate = copy.deepcopy(self.b); candidate['pilot']['start_requirements'].pop()
        self.assertTrue(compare_benchmarks(candidate,self.b))

    def test_invalid_gate_types_and_range_fail(self):
        for value in (True,-1,0,10001,'95%'):
            candidate = copy.deepcopy(self.b); candidate['gates']['correct_handling_bps_min'] = value
            self.assertTrue(validate_benchmark(candidate,ROOT))

    def test_safety_threshold_cannot_allow_failure(self):
        self.b['gates']['mandatory_safety_pass_bps'] = 9999
        self.assertTrue(validate_benchmark(self.b,ROOT))

    def test_inventory_covers_every_existing_case_and_original_seed(self):
        inv = load_document(ROOT/'planning/benchmark-scenarios.json')['scenarios']
        originals = load_document(ROOT/'planning/reference/original-acceptance-tests.json')['tests']
        self.assertEqual(len(inv),676)
        self.assertEqual(len({x['id'] for x in inv}),676)
        self.assertEqual(len(originals),67)
        self.assertTrue({x['id'] for x in originals} <= {x['id'] for x in inv})
        self.assertTrue(all(x['execution_status']=='not_run' for x in inv))
        self.assertEqual(sum(x['stage']=='v1_candidate' for x in inv),481)
        self.assertEqual(validate_benchmark(self.b,ROOT),[])

    def test_missing_or_changed_inventory_case_fails_even_with_updated_inventory_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(ROOT/'planning',root/'planning')
            shutil.copytree(ROOT/'reference',root/'reference')
            p = root/'planning/benchmark-scenarios.json'
            original = load_document(p)
            for mutation in ('remove','change_severity','claim_execution','change_digest'):
                with self.subTest(mutation=mutation):
                    inv = copy.deepcopy(original)
                    if mutation=='remove': inv['scenarios'].pop()
                    if mutation=='change_severity': inv['scenarios'][0]['severity']='minor'
                    if mutation=='claim_execution': inv['scenarios'][0]['execution_status']='passed'
                    if mutation=='change_digest': inv['scenarios'][0]['specification_sha256']='0'*64
                    p.write_text(json.dumps(inv),encoding='utf-8')
                    candidate = copy.deepcopy(self.b); candidate['scenario_inventory']['sha256']=sha(p)
                    self.assertTrue(validate_benchmark(candidate,root))

    def test_support_and_scenario_bytes_are_pinned(self):
        self.b['dependency']['sha256'] = '0'*64
        self.assertTrue(validate_benchmark(self.b,ROOT))

    def test_load_targets_not_measurements_or_permission_to_replay(self):
        for group,field,value in [('load_recovery','status','passed')]:
            candidate = copy.deepcopy(self.b); candidate[group][field]=value
            self.assertTrue(validate_benchmark(candidate,ROOT))
        self.b['load_recovery']['targets']['unreconciled_live_writes_on_restore_max']=1
        self.assertTrue(validate_benchmark(self.b,ROOT))

    def test_invalid_nested_schema_returns_diagnostics_not_tracebacks(self):
        for key in self.b:
            with self.subTest(key=key):
                candidate = copy.deepcopy(self.b); candidate[key]=[None]
                self.assertTrue(validate_benchmark(candidate,ROOT))

    def test_duplicate_json_keys_and_nonfinite_numbers_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'bad.json'
            for raw in ('{"correct":true,"correct":false}','{"count":NaN}','{"count":Infinity}'):
                p.write_text(raw,encoding='utf-8')
                with self.assertRaises(ValueError): load_document(p)

    def test_cli_document_only_has_no_acceptance_or_qualification(self):
        result=self.cli()
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        report=json.loads(result.stdout)
        self.assertFalse(report['release_qualified'])
        self.assertEqual(report['goal_acceptance'],'pending_external_review')
        self.assertFalse(report['baseline_compared'])

    def test_cli_scores_frozen_fixture_and_compares_retained_benchmark(self):
        path=FIX/'expected-benchmark.v1.json'
        result=self.cli('--baseline',path,'--baseline-sha256',sha(path),
            '--manifest',FIX/'cohort.manifest.SYNTHETIC.json','--manifest-sha256',self.msha,
            '--results',FIX/'cohort.results.SYNTHETIC.json')
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        report=json.loads(result.stdout)
        self.assertTrue(report['baseline_compared'])
        self.assertEqual(report['cohort']['by_source'][0]['aggregate'],self.expected['aggregate'])
        self.assertEqual(report['cohort']['verified_live_observations'],0)

    def test_cli_requires_frozen_manifest_digest_and_all_cohort_inputs(self):
        result=self.cli('--manifest',FIX/'cohort.manifest.SYNTHETIC.json')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('must be supplied together',result.stderr)

    def test_cli_requires_independently_supplied_baseline_digest(self):
        result=self.cli('--baseline',FIX/'expected-benchmark.v1.json')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('must be supplied together',result.stderr)

    def test_cli_forged_manifest_changes_membership_and_purpose_are_detected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'manifest.json'
            self.m['purpose']='declared_observations'
            self.m['sources'][0]['kind']='live'
            self.m['cases'].pop(3)
            p.write_text(json.dumps(self.m),encoding='utf-8')
            result=self.cli('--manifest',p,'--manifest-sha256',self.msha,
                            '--results',FIX/'cohort.results.SYNTHETIC.json')
            self.assertNotEqual(result.returncode,0)
            self.assertIn('digest mismatch',result.stdout)
            self.assertNotIn('Traceback',result.stderr)

    def test_results_and_manifest_identity_mismatch_rejected(self):
        self.r['manifest_sha256']='0'*64
        self.bad_score('not bound to retained enrollment')
        self.r['manifest_sha256']=self.msha
        self.m['benchmark_sha256']='0'*64
        self.bad_score('benchmark digest mismatch')

    def test_verified_manifest_is_parsed_from_same_hashed_bytes(self):
        path=FIX/'cohort.manifest.SYNTHETIC.json'
        with patch.object(Path,'read_text',side_effect=AssertionError('no second read')):
            self.assertEqual(load_verified_baseline(path,self.msha),self.m)

    def test_cli_missing_file_and_invalid_json_have_no_tracebacks(self):
        result=self.cli('--benchmark',ROOT/'no-file.json')
        self.assertNotEqual(result.returncode,0)
        self.assertNotIn('Traceback',result.stderr)
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'bad.json'; p.write_text('{bad',encoding='utf-8')
            result=self.cli('--benchmark',p)
            self.assertNotEqual(result.returncode,0)
            self.assertNotIn('Traceback',result.stderr)


if __name__=='__main__':
    unittest.main()
