"""Self-tests for planning helpers only. These are NOT commerce product tests."""
from __future__ import annotations
import copy
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from validate_plan import load_documents, validate_documents
from check_regression_inventory import check_inventory

class PlanStructureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.original=load_documents(ROOT)
    def setUp(self): self.d=copy.deepcopy(self.original)
    def test_real_plan_is_structurally_valid(self): self.assertEqual(validate_documents(self.d),[])
    def test_orphan_requirement_fails(self):
        self.d['coverage']['requirements'][0]['worker_goal_ids']=[]
        self.assertTrue(any('orphan' in e for e in validate_documents(self.d)))
    def test_cycle_fails(self):
        self.d['goals']['goals'][0]['depends_on']=['M00-G99']
        self.assertTrue(any('cycle' in e for e in validate_documents(self.d)))
    def test_unknown_dependency_fails(self):
        self.d['goals']['goals'][0]['depends_on']=['M99-G01']
        self.assertTrue(any('invalid dependency' in e for e in validate_documents(self.d)))
    def test_missing_negative_test_fails(self):
        self.d['tests']['tests'][1]['kind']='positive'
        self.assertTrue(any('missing positive/negative' in e for e in validate_documents(self.d)))
    def test_false_product_pass_fails(self):
        self.d['tests']['tests'][0]['executed']=True
        self.d['tests']['tests'][0]['result']='passed'
        self.assertTrue(any('cannot claim' in e for e in validate_documents(self.d)))
    def test_modified_original_expectation_fails(self):
        seed=next(x for x in self.d['tests']['tests'] if x['id']=='TEST-001')
        seed['expected_result']='Refund twice'
        self.assertTrue(any('original scenario expectation changed' in e for e in validate_documents(self.d)))
    def test_modified_original_requirement_fails(self):
        self.d['coverage']['requirements'][0]['acceptance_criteria']='No protection needed'
        self.assertTrue(any('original acceptance criterion changed' in e for e in validate_documents(self.d)))
    def test_gate_missing_component_fails(self):
        gate=next(x for x in self.d['goals']['goals'] if x['id']=='M00-G99')
        gate['depends_on'].remove('M00-G08')
        self.assertTrue(any('gate omits' in e for e in validate_documents(self.d)))
    def test_missing_regression_fault_fails(self):
        self.d['tests']['tests'][2]['mutation_to_detect']=None
        self.assertTrue(any('missing fault' in e for e in validate_documents(self.d)))
    def test_duplicate_test_id_fails(self):
        self.d['tests']['tests'][1]['id']=self.d['tests']['tests'][0]['id']
        self.assertTrue(any('duplicate ID' in e for e in validate_documents(self.d)))

class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.sha='synthetic-candidate-not-product-evidence'
        self.b={'test_obligations':[{'id':'T-1','contract_digest':'c1','oracle_digest':'o1','test_source_digest':'s1'}],
                'capabilities':[{'id':'F-1','contract_digest':'f1','enabled':True}]}
        self.c=copy.deepcopy(self.b); self.c.update(candidate_sha=self.sha,configuration_digest='cfg')
        self.r={'candidate_sha':self.sha,'configuration_digest':'cfg','native_report_sha256':'synthetic-report',
                'command':['native-test-runner','synthetic-fixture'],'exit_code':0,'executed_count':1,'failed_count':0,
                'skipped_required_count':0,'tests':[{'id':'T-1','status':'passed','runner_case_id':'native-case-1'}]}
    def errors(self): return check_inventory(self.b,self.c,self.r,self.sha)
    def test_valid_synthetic_inventory(self): self.assertEqual(self.errors(),[])
    def test_removed_test_fails(self):
        self.c['test_obligations']=[];self.assertTrue(self.errors())
    def test_skipped_test_fails(self):
        self.r['tests'][0]['status']='skipped';self.assertTrue(self.errors())
    def test_todo_test_fails(self):
        self.r['tests'][0]['status']='todo';self.assertTrue(self.errors())
    def test_reidentified_test_fails(self):
        self.r['tests'][0]['id']='T-2';self.assertTrue(self.errors())
    def test_zero_tests_fails(self):
        self.r['tests']=[];self.r['executed_count']=0;self.assertTrue(self.errors())
    def test_stale_sha_fails(self):
        self.r['candidate_sha']='old';self.assertTrue(self.errors())
    def test_changed_config_fails(self):
        self.r['configuration_digest']='different';self.assertTrue(self.errors())
    def test_weakened_oracle_digest_fails(self):
        self.c['test_obligations'][0]['oracle_digest']='weakened';self.assertTrue(self.errors())
    def test_changed_test_source_requires_review(self):
        self.c['test_obligations'][0]['test_source_digest']='tautology';self.assertTrue(self.errors())
    def test_disabled_capability_fails(self):
        self.c['capabilities'][0]['enabled']=False;self.assertTrue(self.errors())
    def test_forged_count_fails(self):
        self.r['executed_count']=100;self.assertTrue(self.errors())
    def test_failed_runner_fails(self):
        self.r['exit_code']=1;self.assertTrue(self.errors())
    def test_empty_baseline_is_not_product_pass(self):
        self.b['test_obligations']=[];self.assertTrue(self.errors())
    def test_one_runner_case_cannot_cover_multiple_ids(self):
        self.r['tests'].append({'id':'T-2','status':'passed','runner_case_id':'native-case-1'})
        self.r['executed_count']=2;self.assertTrue(self.errors())
    def test_missing_native_report_fails(self):
        self.r.pop('native_report_sha256');self.assertTrue(self.errors())

if __name__=='__main__':unittest.main()
