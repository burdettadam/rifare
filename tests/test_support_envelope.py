"""Executable M00-G01 document contracts, not commerce runtime qualification."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from check_support_envelope import (compare_envelopes, evaluate_cases, load_document,
                                    resolve_scenario, validate_envelope, load_verified_baseline)

FIXTURES = ROOT / 'tests/fixtures/support-envelope'


class SupportEnvelopeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.document = load_document(ROOT / 'planning/support-envelope.json')
        self.baseline = load_document(FIXTURES / 'baseline.SYNTHETIC.json')
        self.cases = load_document(FIXTURES / 'scenarios.json')['cases']

    def assert_invalid(self, needle: str) -> None:
        errors = validate_envelope(self.document, ROOT)
        self.assertTrue(any(needle in e for e in errors), errors)

    def test_CASE_M00_G01_01_named_scenarios_have_declared_outcomes(self):
        """CASE-M00-G01-01: planned labels, reason, owner; no false qualification."""
        self.assertEqual(validate_envelope(self.document, ROOT), [])
        self.assertEqual(evaluate_cases(self.document, self.cases), [])
        for case in self.cases[:-1]:
            with self.subTest(fixture=case['id']):
                result = resolve_scenario(self.document, case['action'], case['context'])
                self.assertEqual(result['support'], case['expected_support'])
                self.assertEqual(result['capability_id'], case['expected_capability_id'])
                self.assertTrue(result['reason'])
                self.assertEqual(result['accountable_owner'], 'project-owner')
                self.assertFalse(result['execution_authorized'])

    def test_CASE_M00_G01_02_unlisted_payment_requires_scope_decision(self):
        """CASE-M00-G01-02: no Cartesian-product or permissive fallback."""
        case = self.cases[-1]
        result = resolve_scenario(self.document, case['action'], case['context'])
        self.assertEqual(result['support'], 'scope_decision_required')
        self.assertIsNone(result['capability_id'])
        self.assertFalse(result['execution_authorized'])
        self.assertEqual(result['accountable_owner'], 'project-owner')

    def test_CASE_M00_G01_03_deleted_baseline_row_blocks_same_claim(self):
        """CASE-M00-G01-03: deliberately remove the protected return-request row."""
        candidate = copy.deepcopy(self.baseline)
        candidate['capabilities'] = [r for r in candidate['capabilities'] if r['id'] != 'SCOPE-002']
        errors = compare_envelopes(candidate, self.baseline)
        self.assertTrue(any('removed_capability:SCOPE-002' in e for e in errors), errors)
        self.assertTrue(any('missing claimed capability SCOPE-002' in e
                            for e in validate_envelope(candidate, ROOT)))

    def test_deleting_claim_and_row_cannot_hide_baseline_loss(self):
        candidate = copy.deepcopy(self.baseline)
        candidate['capabilities'] = [r for r in candidate['capabilities'] if r['id'] != 'SCOPE-002']
        candidate['release_claims'] = []
        errors = compare_envelopes(candidate, self.baseline)
        self.assertTrue(any('removed_capability:SCOPE-002' in e for e in errors))
        self.assertTrue(any('removed_claim:CLAIM-FIXTURE' in e for e in errors))

    def test_revision_bump_is_not_authority_to_remove_capability(self):
        candidate = copy.deepcopy(self.baseline)
        candidate['revision'] += 1
        candidate['capabilities'].pop()
        self.assertTrue(any('removed_capability:' in e for e in compare_envelopes(candidate, self.baseline)))

    def test_changed_context_cannot_silently_move_support(self):
        candidate = copy.deepcopy(self.baseline)
        candidate['contexts'][0]['payment'] = 'manual_record'
        self.assertTrue(any('changed_context:SHOPIFY-NATIVE' in e for e in compare_envelopes(candidate, self.baseline)))

    def test_changed_condition_cannot_silently_weaken_claim(self):
        candidate = copy.deepcopy(self.baseline)
        candidate['conditions'][0]['description'] = 'Trust the caller without checking.'
        self.assertTrue(any('changed_condition:' in e for e in compare_envelopes(candidate, self.baseline)))

    def test_removed_condition_requires_review(self):
        candidate = copy.deepcopy(self.baseline)
        candidate['capabilities'][2]['conditions'].remove('GATEWAY_QUALIFIED')
        self.assertTrue(any('changed_capability:SCOPE-003' in e for e in compare_envelopes(candidate, self.baseline)))

    def test_expanded_support_requires_review(self):
        candidate = copy.deepcopy(self.baseline)
        candidate['capabilities'][2]['support'] = 'supported'
        self.assertTrue(any('changed_capability:SCOPE-003' in e for e in compare_envelopes(candidate, self.baseline)))

    def test_new_capability_requires_scope_review(self):
        candidate = copy.deepcopy(self.baseline)
        extra = copy.deepcopy(candidate['capabilities'][0])
        extra['id'] = 'SCOPE-999'; extra['action'] = 'orders.other'
        candidate['capabilities'].append(extra)
        self.assertTrue(any('added_capability:SCOPE-999' in e for e in compare_envelopes(candidate, self.baseline)))

    def test_unchanged_baseline_is_comparable_not_accepted(self):
        self.assertEqual(compare_envelopes(copy.deepcopy(self.baseline), self.baseline), [])
        self.assertEqual(self.baseline['review_status'], 'proposed')
        self.assertIsNone(self.baseline['approval_ref'])

    def test_duplicate_capability_id_rejected(self):
        self.document['capabilities'].append(copy.deepcopy(self.document['capabilities'][0]))
        self.assert_invalid('duplicate id')

    def test_conflicting_same_action_context_rejected(self):
        extra = copy.deepcopy(self.document['capabilities'][0]); extra['id'] = 'SCOPE-999'
        self.document['capabilities'].append(extra)
        self.assert_invalid('duplicate action/context')

    def test_duplicate_context_tuple_rejected(self):
        extra = copy.deepcopy(self.document['contexts'][0]); extra['id'] = 'OTHER'
        self.document['contexts'].append(extra)
        self.assert_invalid('duplicate context tuple')

    def test_ambiguous_document_cannot_be_resolved(self):
        self.document['capabilities'].append(copy.deepcopy(self.document['capabilities'][0]))
        with self.assertRaisesRegex(ValueError, 'invalid envelope'):
            resolve_scenario(self.document, self.cases[0]['action'], self.cases[0]['context'])

    def test_missing_or_unknown_context_dimension_requires_decision(self):
        for mutation in ('missing', 'extra', 'unknown'):
            with self.subTest(mutation=mutation):
                context = copy.deepcopy(self.cases[0]['context'])
                if mutation == 'missing': context.pop('currency')
                elif mutation == 'extra': context['trusted'] = True
                else: context['currency'] = 'CAD'
                result = resolve_scenario(self.document, 'orders.status', context)
                self.assertEqual(result['support'], 'scope_decision_required')
                self.assertFalse(result['execution_authorized'])

    def test_unknown_action_requires_decision(self):
        result = resolve_scenario(self.document, 'orders.transfer_funds', self.cases[0]['context'])
        self.assertEqual(result['support'], 'scope_decision_required')

    def test_wildcard_dimension_rejected(self):
        self.document['contexts'][0]['payment'] = '*'
        self.assert_invalid('wildcard')

    def test_missing_reason_rejected(self):
        self.document['capabilities'][0]['reason'] = ' '
        self.assert_invalid('reason')

    def test_unresolvable_owner_rejected(self):
        self.document['capabilities'][0]['accountable_owner'] = 'somebody'
        self.assert_invalid('unknown owner')

    def test_conditional_without_conditions_rejected(self):
        self.document['capabilities'][2]['conditions'] = []
        self.assert_invalid('conditional capability needs conditions')

    def test_unknown_condition_rejected(self):
        self.document['capabilities'][0]['conditions'].append('INVENTED')
        self.assert_invalid('unknown condition')

    def test_excluded_row_cannot_claim_native_delivery(self):
        self.document['capabilities'][27]['delivery'] = 'native'
        self.assert_invalid('excluded capability must be unsupported')

    def test_claim_cannot_reference_excluded_row(self):
        self.document['release_claims'][0]['capability_ids'].append('SCOPE-028')
        self.assert_invalid('claim includes excluded capability')

    def test_unknown_support_label_rejected(self):
        self.document['capabilities'][0]['support'] = 'probably'
        self.assert_invalid('support')

    def test_false_qualification_and_approval_rejected(self):
        self.document['capabilities'][0]['qualification'] = 'passed'
        self.document['release']['public_claims_enabled'] = True
        self.document['review_status'] = 'approved'
        self.document['approval_ref'] = 'self-authored'
        self.assert_invalid('qualification')
        self.assert_invalid('public_claims_enabled')
        self.assert_invalid('review_status')
        self.assert_invalid('approval_ref')

    def test_extra_field_cannot_convey_permissions(self):
        self.document['capabilities'][0]['auto_approve'] = True
        self.assert_invalid('unexpected fields')

    def test_platform_order_cannot_change_silently(self):
        self.document['target_customer']['first_platform'] = 'woocommerce'
        self.assert_invalid('first_platform')

    def test_absent_target_disposition_rejected(self):
        self.document['capability_disposition'].pop()
        self.assert_invalid('target coverage')

    def test_invented_goal_or_target_reference_rejected(self):
        self.document['capabilities'][0]['implementation_goal'] = 'M00-G98'
        self.document['capabilities'][0]['target_refs'] = ['CAP-999']
        self.assert_invalid('unknown goal')
        self.assert_invalid('unknown target')

    def test_changed_target_milestone_is_not_hidden(self):
        self.document['capability_disposition'][0]['owning_milestone'] = 'M12'
        self.assert_invalid('target milestone differs')

    def test_removed_invariant_rejected(self):
        self.document['invariant_ids'].pop()
        self.assert_invalid('invariant coverage')

    def test_boolean_is_not_a_revision(self):
        self.document['revision'] = True
        self.assert_invalid('revision')

    def test_nonobject_or_malformed_document_returns_errors(self):
        for value in (None, [], 'bad', {'capabilities': None}, {'contexts': [None]}):
            with self.subTest(value=value):
                self.assertTrue(validate_envelope(value, ROOT))

    def test_invalid_nested_shapes_are_diagnostics_not_tracebacks(self):
        for key in ('target_customer','release','owners','conditions','contexts','capabilities',
                    'release_claims','invariant_ids','capability_disposition','boundaries'):
            with self.subTest(field=key):
                doc = copy.deepcopy(self.document); doc[key] = [None]
                self.assertTrue(validate_envelope(doc, ROOT))

    def test_duplicate_json_keys_and_nonfinite_numbers_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'bad.json'
            for content in ('{"support":"excluded","support":"supported"}', '{"revision":NaN}'):
                path.write_text(content, encoding='utf-8')
                with self.assertRaises(ValueError): load_document(path)

    def test_wrong_fixture_expectation_is_detected(self):
        cases = copy.deepcopy(self.cases); cases[-1]['expected_support'] = 'supported'
        self.assertTrue(evaluate_cases(self.document, cases))

    def test_empty_scenario_set_is_not_a_pass(self):
        self.assertTrue(evaluate_cases(self.document, []))

    def test_every_declared_row_remains_non_authorizing(self):
        contexts = {c['id']: {k:v for k,v in c.items() if k != 'id'} for c in self.document['contexts']}
        for row in self.document['capabilities']:
            with self.subTest(capability=row['id']):
                outcome = resolve_scenario(self.document, row['action'], contexts[row['context_id']])
                self.assertEqual(outcome['support'], row['support'])
                self.assertFalse(outcome['execution_authorized'])
                self.assertEqual(outcome['qualification'], 'not_qualified')

    def test_entire_proposed_contract_is_retained_without_silent_changes(self):
        frozen = load_document(FIXTURES / 'expected-proposal.v1.json')
        self.assertEqual(compare_envelopes(self.document, frozen), [])
        self.assertEqual(self.document['revision'], frozen['revision'])

    def test_invalid_owner_shapes_are_validation_errors(self):
        for group, field in (('target_customer','accountable_owner'), ('boundaries','owner')):
            for invalid in ([], {}, None, True, 17):
                with self.subTest(group=group, value=invalid):
                    doc = copy.deepcopy(self.document)
                    record = doc[group][0] if isinstance(doc[group],list) else doc[group]
                    record[field] = invalid
                    self.assertTrue(validate_envelope(doc,ROOT))

    def test_charter_and_decision_record_are_explicitly_pending(self):
        charter = (ROOT/'docs/CHARTER.md').read_text(encoding='utf-8')
        decision = (ROOT/'docs/decisions/0001-first-release-support-envelope.md').read_text(encoding='utf-8')
        self.assertIn('rifare-post-purchase-v1',charter)
        self.assertIn('revision 1',charter)
        self.assertIn('Status: proposed; human approval pending',decision)
        self.assertIn('Human decision: pending',decision)

    def test_cli_unknown_and_excluded_queries_are_not_zero_exit(self):
        for filename, expected in (('query-unlisted-payment.json','scope_decision_required'),
                                   ('query-unverified-warehouse.json','excluded')):
            with self.subTest(query=filename):
                result = self.run_cli('--query',str(FIXTURES/filename))
                self.assertEqual(result.returncode,3,result.stderr+result.stdout)
                report = json.loads(result.stdout)
                self.assertEqual(report['resolution']['support'],expected)
                self.assertFalse(report['resolution']['execution_authorized'])

    def run_cli(self, *args):
        return subprocess.run([sys.executable, str(ROOT/'tools/check_support_envelope.py'),
                               '--root',str(ROOT),*args],capture_output=True,text=True,timeout=20)

    def test_cli_validates_document_and_predeclared_scenarios(self):
        result = self.run_cli('--scenarios',str(FIXTURES/'scenarios.json'))
        self.assertEqual(result.returncode,0,result.stderr + result.stdout)
        report = json.loads(result.stdout)
        self.assertEqual(report['goal_acceptance'],'pending_external_review')
        self.assertFalse(report['execution_authorized'])
        self.assertEqual(report['scenarios_checked'],len(self.cases))

    def test_cli_baseline_requires_independently_supplied_digest(self):
        result = self.run_cli('--baseline',str(FIXTURES/'baseline.SYNTHETIC.json'))
        self.assertNotEqual(result.returncode,0)
        self.assertIn('baseline-sha256', result.stderr + result.stdout)

    def test_verified_baseline_parses_exactly_the_hashed_bytes(self):
        path = FIXTURES / 'baseline.SYNTHETIC.json'
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        with patch.object(Path, 'read_text', side_effect=AssertionError('second file read is forbidden')):
            self.assertEqual(load_verified_baseline(path, digest), self.baseline)

    def test_cli_baseline_digest_mismatch_rejected(self):
        result = self.run_cli('--baseline',str(FIXTURES/'baseline.SYNTHETIC.json'),
                              '--baseline-sha256','0'*64)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('digest mismatch',result.stderr + result.stdout)

    def test_cli_unchanged_synthetic_baseline_not_acceptance(self):
        path = FIXTURES/'baseline.SYNTHETIC.json'
        result = self.run_cli('--envelope',str(path),'--baseline',str(path),
                              '--baseline-sha256',hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertEqual(result.returncode,0,result.stderr + result.stdout)
        self.assertEqual(json.loads(result.stdout)['goal_acceptance'],'pending_external_review')

    def test_cli_missing_document_fails_without_traceback(self):
        result = self.run_cli('--envelope',str(ROOT/'nonexistent.json'))
        self.assertNotEqual(result.returncode,0)
        self.assertNotIn('Traceback',result.stderr + result.stdout)


if __name__ == '__main__':
    unittest.main()
