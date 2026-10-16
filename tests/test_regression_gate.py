"""M00-G07: immutable-baseline, native-execution and weakened-oracle regressions."""
from __future__ import annotations
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import regression_gate as G
import test_harness as H


class GateFixture(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='rifare-g07-regression-')
        self.addCleanup(self.temp.cleanup)
        self.home=Path(self.temp.name);self.repo=self.home/'source';self.repo.mkdir()
        (self.repo/'tests').mkdir();(self.repo/'tools').mkdir();(self.repo/'planning').mkdir()
        self.write('.gitignore','__pycache__/\n*.pyc\n')
        self.write('contract.json','{"outcome":"one plus one equals two"}\n')
        self.write('tests/expected.json','{"answer":2}\n')
        self.write('tests/test_feature.py','import unittest\nclass Feature(unittest.TestCase):\n    def test_sum(self): self.assertEqual(1+1,2)\n')
        for name in G.CONTROL_FILES: shutil.copyfile(ROOT/'tools'/name,self.repo/'tools'/name)
        self.registry={'schema_version':1,'id':'rifare-regression-registry',
                       'qualification':'local_development_only_not_product_acceptance',
                       'capabilities':[{'id':'FEATURE-SYNTHETIC','enabled':True,'qualification':'proposed_not_accepted','contract_files':['contract.json']}],
                       'tests':[{'id':'python:test_feature.Feature.test_sum','suite':'python','runner_case_id':'test_feature.Feature.test_sum','source':'tests/test_feature.py','capability_id':'FEATURE-SYNTHETIC'}],
                       'protected_files':['tests/test_feature.py','tests/expected.json','contract.json'],
                       'source_count_fixture':None,'source_inventory':None}
        self.save_registry();self.git('init','-b','main');self.git('config','user.name','Synthetic Fixture')
        self.git('config','user.email','test@example.invalid');self.base=self.commit('Synthetic retained fixture')
        self.control=self.home/'controller'
        self.pins=G.export_control(self.repo,self.base,self.base,self.control)
        self.baseline=G.load_baseline(self.control/'baseline.json',self.pins['baseline_sha256'],self.repo)
        self.output_counter=0

    def write(self,path,text):
        p=self.repo/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text)
    def git(self,*args): return subprocess.check_output(['git','-C',str(self.repo),*args],stderr=subprocess.PIPE).decode().strip()
    def commit(self,message='Synthetic candidate change'):
        self.git('add','.');self.git('-c','core.hooksPath='+os.devnull,'commit','--allow-empty','-m',message)
        return self.git('rev-parse','HEAD')
    def save_registry(self): self.write(G.REGISTRY,json.dumps(self.registry,indent=2)+'\n')
    def gate(self,commit=None):
        self.output_counter+=1
        return G.run_gate(self.repo,commit or self.git('rev-parse','HEAD'),self.control/'baseline.json',
                          self.pins['baseline_sha256'],self.control,self.pins['controller_sha256'],self.home/('run-'+str(self.output_counter)))
    def delta(self): return G.compare(self.baseline,G.snapshot(self.repo,self.git('rev-parse','HEAD')))
    def add_test(self):
        self.write('tests/test_extra.py','import unittest\nclass Extra(unittest.TestCase):\n    def test_new(self): self.assertEqual(3*3,9)\n')
        self.registry['tests'].append({'id':'python:test_extra.Extra.test_new','suite':'python','runner_case_id':'test_extra.Extra.test_new','source':'tests/test_extra.py','capability_id':'FEATURE-SYNTHETIC'})
        self.save_registry();return self.commit()


class PinnedExecutionTests(GateFixture):
    def test_CASE_M00_G07_01_retained_tests_and_addition_execute(self):
        """CASE-M00-G07-01: one retained and one new native assertion, exactly two."""
        candidate=self.add_test();r=self.gate(candidate)
        self.assertEqual(r['status'],'passed',r)
        self.assertEqual(r['executed_test_count'],2)
        self.assertEqual(r['changes']['added_test_ids'],['python:test_extra.Extra.test_new'])
        self.assertEqual(r['layers']['python']['counts']['case_ids'],['test_extra.Extra.test_new','test_feature.Feature.test_sum'])
        self.assertFalse(r['goal_accepted']);self.assertFalse(r['release_authorized'])
    def test_existing_baseline_executes_exactly_one(self):
        r=self.gate();self.assertEqual(r['status'],'passed',r);self.assertEqual(r['executed_test_count'],1)
    def test_native_command_uses_external_adapter(self):
        r=self.gate();cmd=r['layers']['python']['command']
        self.assertEqual(Path(cmd[2]).parent,self.control)
        self.assertIn('-I',cmd);self.assertNotIn('tools/run_tests.py',cmd)
    def test_candidate_fake_report_is_not_consumed(self):
        self.write('results.json','{"status":"passed","executed":999999}')
        self.commit();r=self.gate();self.assertEqual(r['executed_test_count'],1)
    def test_unregistered_new_test_cannot_hide(self):
        self.write('tests/test_extra.py','import unittest\nclass Extra(unittest.TestCase):\n    def test_new(self): self.assertEqual(3*3,9)\n')
        self.commit();r=self.gate();self.assertEqual(r['status'],'blocked')
        self.assertIn('unexpected',r['layers']['python']['error'])
    def test_addition_cannot_be_skipped(self):
        self.add_test();self.write('tests/test_extra.py','import unittest\nclass Extra(unittest.TestCase):\n    @unittest.skip("synthetic")\n    def test_new(self): self.assertEqual(3*3,9)\n')
        self.commit();r=self.gate();self.assertEqual(r['status'],'blocked');self.assertIn('native execution failed',str(r['errors']))
    def test_failing_addition_blocks_even_with_retained_success(self):
        self.add_test();p=self.repo/'tests/test_extra.py';p.write_text(p.read_text().replace('3*3,9','3*3,8'))
        self.commit();r=self.gate();self.assertEqual(r['status'],'blocked')
    def test_controller_from_checkout_cannot_be_used(self):
        with self.assertRaisesRegex(ValueError,'outside candidate'):
            G.run_gate(self.repo,self.base,self.control/'baseline.json',self.pins['baseline_sha256'],self.repo/'tools',G.controller_digest(self.repo/'tools'),self.home/'run')
    def test_baseline_inside_checkout_is_not_trusted(self):
        p=self.repo/'local-baseline.json';p.write_bytes((self.control/'baseline.json').read_bytes())
        with self.assertRaisesRegex(ValueError,'outside candidate'):G.load_baseline(p,self.pins['baseline_sha256'],self.repo)
    def test_wrong_controller_digest_is_rejected_before_running(self):
        self.pins['controller_sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'controller SHA'):self.gate()
    def test_changed_controller_module_is_rejected(self):
        p=self.control/'check_regression_inventory.py';p.write_text(p.read_text()+'\n# synthetic change\n')
        with self.assertRaisesRegex(ValueError,'controller SHA'):self.gate()
    def test_changed_baseline_is_rejected(self):
        p=self.control/'baseline.json';p.write_text(p.read_text()+' ')
        with self.assertRaisesRegex(ValueError,'baseline SHA'):self.gate()
    def test_wrong_full_candidate_sha_is_rejected(self):
        self.add_test()
        with self.assertRaisesRegex(ValueError,'pinned commit'):self.gate(self.base)
    def test_branch_name_is_not_a_commit_pin(self):
        with self.assertRaisesRegex(ValueError,'immutable commit'):self.gate('main')
    def test_dirty_source_is_rejected(self):
        self.write('tests/test_feature.py','broken candidate bytes')
        with self.assertRaisesRegex(ValueError,'dirty'):self.gate()
    def test_hidden_assume_unchanged_source_is_rejected(self):
        self.git('update-index','--assume-unchanged','tests/test_feature.py')
        self.write('tests/test_feature.py','broken hidden bytes')
        self.assertEqual(self.git('status','--porcelain'),'')
        with self.assertRaisesRegex(ValueError,'dirty'):self.gate()
    def test_ignored_executable_input_is_rejected(self):
        self.write('.gitignore','__pycache__/\n*.pyc\ntests/extra.py\n');self.commit()
        self.write('tests/extra.py','print("untracked code")')
        with self.assertRaisesRegex(ValueError,'ignored/untracked'):self.gate()
    def test_reusing_output_directory_is_rejected(self):
        self.gate();self.output_counter=0
        with self.assertRaises(FileExistsError):self.gate()
    def test_baseline_change_during_execution_is_rejected(self):
        original=G.native.execute_native
        def altered(*args,**kwargs):
            r=original(*args,**kwargs);p=self.control/'baseline.json';p.write_text(p.read_text()+' ');return r
        with patch.object(G.native,'execute_native',side_effect=altered):r=self.gate()
        self.assertEqual(r['status'],'blocked');self.assertIn('trusted inputs changed',str(r['errors']))


class BaselineRetentionTests(GateFixture):
    def test_CASE_M00_G07_02_candidate_cannot_drop_registration(self):
        """CASE-M00-G07-02: edited candidate registry cannot replace external obligations."""
        self.add_test();self.registry['tests']=[self.registry['tests'][1]];self.save_registry();self.commit()
        r=self.gate();self.assertEqual(r['status'],'blocked');self.assertEqual(r['layers'],{})
        self.assertIn('retained test registration',str(r['errors']))
    def test_CASE_M00_G07_03_same_count_tautological_assertion_requires_review(self):
        """CASE-M00-G07-03: count=1 and same ID cannot authorize changed assertion bytes."""
        p=self.repo/'tests/test_feature.py';p.write_text(p.read_text().replace('self.assertEqual(1+1,2)','self.assertTrue(True)'));self.commit()
        r=self.gate();self.assertEqual(r['status'],'blocked');self.assertEqual(r['layers'],{})
        self.assertIn('tests/test_feature.py',r['changes']['review_required_paths'])
        self.assertIn('targeted fault proof',str(r['errors']))
    def test_same_count_changed_independent_fixture_requires_review(self):
        self.write('tests/expected.json','{"answer":999}\n');self.commit()
        self.assertIn('tests/expected.json',self.delta()['review_required_paths'])
    def test_whitespace_changes_remain_explicit_review(self):
        p=self.repo/'tests/test_feature.py';p.write_text(p.read_text()+'\n');self.commit()
        self.assertIn('tests/test_feature.py',self.delta()['review_required_paths'])
    def test_renamed_id_is_not_same_test(self):
        t=self.registry['tests'][0];t['runner_case_id']='test_feature.Feature.test_renamed';t['id']='python:'+t['runner_case_id'];self.save_registry();self.commit()
        self.assertIn('reidentified',str(self.delta()['errors']))
    def test_disabling_capability_fails(self):
        self.registry['capabilities'][0]['enabled']=False;self.save_registry();self.commit()
        with self.assertRaisesRegex(ValueError,'disabled'):self.gate()
    def test_removing_protected_fixture_pin_is_detected(self):
        self.registry['protected_files'].remove('tests/expected.json');self.save_registry();self.commit()
        self.assertIn('tests/expected.json',self.delta()['review_required_paths'])
    def test_source_paths_cannot_disappear(self):
        self.write('notes.txt','retained extra source');new=self.commit();baseline=G.snapshot(self.repo,new)
        (self.repo/'notes.txt').unlink();self.commit()
        self.assertIn('retained source removed',G.compare(baseline,G.snapshot(self.repo,self.git('rev-parse','HEAD')))['errors'])
    def test_empty_registry_is_rejected(self):
        self.registry['tests']=[]
        with self.assertRaisesRegex(ValueError,'empty'):G.validate_registry(self.registry)
    def test_duplicate_native_ids_are_rejected(self):
        self.registry['tests'].append(copy.deepcopy(self.registry['tests'][0]))
        with self.assertRaisesRegex(ValueError,'duplicate'):G.validate_registry(self.registry)
    def test_path_traversal_is_rejected(self):
        self.registry['tests'][0]['source']='tests/../private.py'
        with self.assertRaisesRegex(ValueError,'unsafe'):G.validate_registry(self.registry)
    def test_unknown_runner_is_rejected(self):
        self.registry['tests'][0]['suite']='arbitrary_shell'
        with self.assertRaisesRegex(ValueError,'native test'):G.validate_registry(self.registry)
    def test_orphan_capability_is_rejected(self):
        self.registry['tests'][0]['capability_id']='MISSING'
        with self.assertRaisesRegex(ValueError,'orphan'):G.validate_registry(self.registry)
    def test_source_mode_change_requires_review(self):
        p=self.repo/'tests/test_feature.py';p.chmod(0o755);self.commit()
        self.assertIn('tests/test_feature.py',self.delta()['review_required_paths'])
    def test_candidate_approval_text_cannot_override_changed_oracle(self):
        self.write('approved.json','{"approved":true,"reviewer":"synthetic"}')
        self.write('tests/expected.json','{"answer":999}');self.commit()
        r=self.gate();self.assertEqual(r['status'],'blocked');self.assertEqual(r['layers'],{})
    def test_relabeling_diagnostic_as_accepted_is_not_allowed(self):
        self.registry['capabilities'][0]['qualification']='accepted_bootstrap';self.save_registry();self.commit()
        self.assertIn('retained capability',str(self.delta()['errors']))
    def test_switching_or_disabling_inventory_guard_is_not_allowed(self):
        base=copy.deepcopy(self.baseline);base['registry']['source_inventory']='inventory.json'
        current=G.snapshot(self.repo,self.base)
        self.assertIn('inventory configuration',str(G.compare(base,current)['errors']))
    def test_source_symlink_in_commit_is_not_supported(self):
        os.symlink('test_feature.py',self.repo/'tests/linked.py');self.commit()
        with self.assertRaisesRegex(ValueError,'links/submodules'):self.gate()
    def test_symlink_baseline_path_is_rejected(self):
        link=self.home/'linked.json';link.symlink_to(self.control/'baseline.json')
        with self.assertRaisesRegex(ValueError,'symlink'):G.load_baseline(link,self.pins['baseline_sha256'],self.repo)


class NativeAdapterTests(unittest.TestCase):
    def run_native(self,body,expected):
        with tempfile.TemporaryDirectory(prefix='rifare-g07-native-') as tmp:
            root=Path(tmp);(root/'tests').mkdir();(root/'tests/test_probe.py').write_text('import unittest\n'+body)
            return H.execute_native(root,[sys.executable,'-I',str(ROOT/'tools/unittest_report.py'),'--root',str(root)],expected,output=root)
    def test_real_unittest_success_has_native_id(self):
        r=self.run_native('class Probe(unittest.TestCase):\n    def test_run(self): self.assertEqual(2,2)\n',['test_probe.Probe.test_run'])
        self.assertEqual(r['status'],'passed');self.assertEqual(r['counts']['case_ids'],['test_probe.Probe.test_run'])
    def test_zero_native_tests_fails(self):
        r=self.run_native('class Probe(unittest.TestCase):\n    pass\n',['test_probe.Probe.test_run']);self.assertEqual(r['status'],'failed')
    def test_unittest_skip_is_not_pass(self):
        r=self.run_native('class Probe(unittest.TestCase):\n    @unittest.skip("synthetic")\n    def test_run(self): pass\n',['test_probe.Probe.test_run']);self.assertEqual(r['status'],'failed')
    def test_expected_failure_is_not_pass(self):
        r=self.run_native('class Probe(unittest.TestCase):\n    @unittest.expectedFailure\n    def test_run(self): self.assertEqual(2,3)\n',['test_probe.Probe.test_run']);self.assertEqual(r['status'],'failed')
    def test_subtest_failure_is_not_hidden(self):
        r=self.run_native('class Probe(unittest.TestCase):\n    def test_run(self):\n        with self.subTest(case="synthetic"): self.assertEqual(2,3)\n',['test_probe.Probe.test_run']);self.assertEqual(r['status'],'failed')
    def test_class_setup_error_is_not_pass(self):
        r=self.run_native('class Probe(unittest.TestCase):\n    @classmethod\n    def setUpClass(cls): raise ValueError("synthetic failure")\n    def test_run(self): pass\n',['test_probe.Probe.test_run']);self.assertEqual(r['status'],'failed')
    def test_failed_assertion_is_not_pass(self):
        r=self.run_native('class Probe(unittest.TestCase):\n    def test_run(self): self.assertEqual(2,3)\n',['test_probe.Probe.test_run']);self.assertEqual(r['status'],'failed')
    def test_renamed_test_is_not_equivalent(self):
        r=self.run_native('class Probe(unittest.TestCase):\n    def test_renamed(self): self.assertEqual(2,2)\n',['test_probe.Probe.test_run']);self.assertEqual(r['status'],'failed')
    def test_secret_print_during_native_run_fails(self):
        r=self.run_native('class Probe(unittest.TestCase):\n    def test_run(self):\n        import os\n        print(os.environ["TEST_SECRET_CANARY"])\n        self.assertEqual(2,2)\n',['test_probe.Probe.test_run']);self.assertEqual(r['status'],'failed');self.assertIn('secret',r['error'])
    def test_duplicate_json_fields_are_not_silently_overridden(self):
        with self.assertRaisesRegex(ValueError,'duplicate JSON'):G.decode(b'{"tests":1,"tests":2}')
    def test_relative_path_cannot_contain_git_or_traversal(self):
        for path in ('../x','/x','a/../x','.git/config','tests\\probe.py','tests//probe.py'):
            with self.subTest(path=path),self.assertRaisesRegex(ValueError,'unsafe'):G.relative(path)
    def test_controller_requires_every_module(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError,'regular'):G.controller_digest(Path(tmp))


class SourceExtensionTests(GateFixture):
    def with_inventory(self):
        self.registry['source_count_fixture']='tests/count.json'
        self.registry['source_inventory']='inventory.json'
        self.registry['protected_files'].append('tests/count.json')
        self.save_registry()
        self.write('tests/count.json','{}')
        self.write('inventory.json','{}')
        self.git('add','.')
        paths=self.git('ls-files').splitlines()
        self.write('tests/count.json',json.dumps({'source_file_count':len(paths),'source_count_reason':'Explicit synthetic fixture membership','retained_expectation':7}))
        self.write('inventory.json',json.dumps({'components':[{'id':'fixture','files':paths}]}))
        return self.commit()
    def test_exact_source_count_is_required(self):
        commit=self.with_inventory();G.validate_membership(self.repo,G.snapshot(self.repo,commit))
        data=json.loads((self.repo/'tests/count.json').read_text());data['source_file_count']+=1
        self.write('tests/count.json',json.dumps(data));commit=self.commit()
        with self.assertRaisesRegex(ValueError,'source count'):G.validate_membership(self.repo,G.snapshot(self.repo,commit))
    def test_inventory_cannot_omit_a_tracked_file(self):
        self.with_inventory();d=json.loads((self.repo/'inventory.json').read_text());d['components'][0]['files'].pop()
        self.write('inventory.json',json.dumps(d));commit=self.commit()
        with self.assertRaisesRegex(ValueError,'exactly match'):G.validate_membership(self.repo,G.snapshot(self.repo,commit))
    def test_inventory_cannot_count_a_file_twice(self):
        self.with_inventory();d=json.loads((self.repo/'inventory.json').read_text());d['components'][0]['files'].append('contract.json')
        self.write('inventory.json',json.dumps(d));commit=self.commit()
        with self.assertRaisesRegex(ValueError,'exactly match'):G.validate_membership(self.repo,G.snapshot(self.repo,commit))
    def test_structural_source_count_extension_preserves_other_expectations(self):
        before=G.snapshot(self.repo,self.with_inventory())
        self.write('additional-source.txt','Synthetic source addition')
        self.git('add','.');paths=self.git('ls-files').splitlines()
        d=json.loads((self.repo/'tests/count.json').read_text());d['source_file_count']=len(paths);d['source_count_reason']='One named source added'
        self.write('tests/count.json',json.dumps(d));self.write('inventory.json',json.dumps({'components':[{'id':'fixture','files':paths}]}))
        after=G.snapshot(self.repo,self.commit());G.validate_membership(self.repo,after)
        delta=G.compare(before,after);self.assertEqual(delta['errors'],[]);self.assertEqual(delta['review_required_paths'],[])
        self.assertEqual(delta['added_source_paths'],['additional-source.txt'])
    def test_source_count_exception_does_not_allow_oracle_changes(self):
        before=G.snapshot(self.repo,self.with_inventory())
        d=json.loads((self.repo/'tests/count.json').read_text());d['retained_expectation']=0
        self.write('tests/count.json',json.dumps(d));after=G.snapshot(self.repo,self.commit())
        self.assertIn('tests/count.json',G.compare(before,after)['review_required_paths'])
    def test_partial_membership_configuration_is_invalid(self):
        self.registry['source_count_fixture']='tests/count.json'
        with self.assertRaisesRegex(ValueError,'partial'):G.validate_registry(self.registry)
    def test_output_cannot_overwrite_controller(self):
        with self.assertRaisesRegex(ValueError,'overwrite controller'):
            G.run_gate(self.repo,self.base,self.control/'baseline.json',self.pins['baseline_sha256'],self.control,
                       self.pins['controller_sha256'],self.control/'report')
    def test_control_change_after_run_is_blocked(self):
        original=G.native.execute_native
        def altered(*args,**kwargs):
            result=original(*args,**kwargs);p=self.control/'check_regression_inventory.py';p.write_text(p.read_text()+'\n# synthetic\n');return result
        with patch.object(G.native,'execute_native',side_effect=altered):result=self.gate()
        self.assertEqual(result['status'],'blocked');self.assertIn('trusted inputs changed',str(result['errors']))


if __name__=='__main__':unittest.main()
