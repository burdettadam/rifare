"""M00-G08: real one-test captures and deliberately untrusted evidence mutations.

All identities, reviews and approvals in these fixtures are synthetic. They test
read-only validation and never represent actual project reviews or acceptance.
"""
from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'tools'))
import evidence_gate as E
import regression_gate as G


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(G.canonical(value)+b'\n')


def git(root, *args):
    return G.git(root, *args).decode().strip()


def commit(root):
    git(root, 'add', '.')
    git(root, '-c', 'user.name=Synthetic Fixture', '-c', 'user.email=fixture@example.invalid',
        '-c', 'core.hooksPath='+os.devnull, 'commit', '--allow-empty', '-m', 'Synthetic evidence fixture')
    return git(root, 'rev-parse', 'HEAD')


def make_fixture(home):
    repo=home/'source';repo.mkdir()
    def write(path, body):
        target=repo/path;target.parent.mkdir(parents=True, exist_ok=True);target.write_text(body)
    write('.gitignore','__pycache__/\n*.pyc\n/evidence/\n')
    write('contract.json','{"synthetic":"one plus one equals two"}\n')
    write('tests/test_sample.py','import unittest\nclass Sample(unittest.TestCase):\n    def test_two(self): self.assertEqual(1+1,2)\n')
    for name in E.CONTROL_FILES:
        target=repo/'tools'/name;target.parent.mkdir(exist_ok=True)
        shutil.copyfile(ROOT/'tools'/name,target)
    write_json(repo/E.POLICY,json.loads((ROOT/E.POLICY).read_text()))
    write_json(repo/'planning/goals.json',{'goals':[{'id':'M00-G08','milestone':'M00','depends_on':[]},
                                                 {'id':'M00-G07','milestone':'M00','depends_on':[]}]})
    write_json(repo/'work/accepted-goals.json',{'acceptances':[]})
    registry={'schema_version':1,'id':'rifare-regression-registry',
              'qualification':'local_development_only_not_product_acceptance',
              'capabilities':[{'id':'SYNTHETIC-EVIDENCE','enabled':True,'qualification':'proposed_not_accepted',
                               'contract_files':['contract.json']}],
              'tests':[{'id':'python:test_sample.Sample.test_two','suite':'python',
                        'runner_case_id':'test_sample.Sample.test_two','source':'tests/test_sample.py',
                        'capability_id':'SYNTHETIC-EVIDENCE'}],
              'protected_files':['tests/test_sample.py','contract.json'],
              'source_count_fixture':None,'source_inventory':None}
    write_json(repo/G.REGISTRY,registry)
    git(repo,'init','-b','goal/M00-G08');base=commit(repo)
    pins=G.export_control(repo,base,base,home/'native-control')
    verifier=E.export_control(repo,base,home/'verifier')
    notes=home/'notes';notes.mkdir()
    for name in E.REQUIRED_NOTES:
        (notes/name).write_text('SYNTHETIC TEST FIXTURE ONLY. One native arithmetic assertion; no real review.\n')
    now=datetime.now(timezone.utc)
    categories={k:{'files':{},'settings':{},'not_applicable_reason':'Not used by synthetic arithmetic fixture.'}
                for k in E.PIN_CATEGORIES}
    categories['policies']={'files':{E.POLICY:G.sha((repo/E.POLICY).read_bytes())},'settings':{},'not_applicable_reason':None}
    categories['runtimes']={'files':{},'settings':{'profile':'synthetic-unittest'},'not_applicable_reason':None}
    request={'schema_version':1,'kind':'rifare-evidence-request-v1','goal_id':'M00-G08',
             'candidate_sha':base,'base_sha':base,'writer_id':'synthetic-writer','writer_session_id':'synthetic-author-session',
             'issued_at':(now-timedelta(minutes=2)).isoformat(),'expires_at':(now+timedelta(days=1)).isoformat(),
             'baseline_commit':base,'baseline_sha256':pins['baseline_sha256'],
             'regression_controller_sha256':pins['controller_sha256'],'pins':categories,
             'supporting_files':{p.name:G.sha(p.read_bytes()) for p in notes.iterdir()},
             'retention':{'owner':'synthetic-custodian','retain_until':(now+timedelta(days=7)).isoformat(),
                          'cleanup':'manual_after_decision_and_retained_references'}}
    write_json(home/'request.json',request);request_sha=G.sha((home/'request.json').read_bytes())
    with patch('sys.stdout',io.StringIO()):
        result=E.capture(repo,home/'request.json',request_sha,home/'native-control/baseline.json',
                         home/'verifier',verifier['verifier_sha256'],notes,home/'bundle',home/'receipt.json')
    write_json(home/'test-pins.json',{'request_sha':request_sha,'receipt_sha':result['receipt_sha256'],
                                    'verifier_sha':verifier['verifier_sha256'],'candidate':base})


class EvidenceFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.template=tempfile.TemporaryDirectory(prefix='rifare-g08-template-')
        cls.addClassCleanup(cls.template.cleanup)
        make_fixture(Path(cls.template.name))

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='rifare-g08-case-');self.addCleanup(self.temp.cleanup)
        self.home=Path(self.temp.name)/'fixture';shutil.copytree(self.template.name,self.home)
        self.repo=self.home/'source';self.bundle=self.home/'bundle';self.control=self.home/'verifier'
        self.baseline=self.home/'native-control/baseline.json';self.request_path=self.home/'request.json'
        self.receipt_path=self.home/'receipt.json';self.manifest_path=self.bundle/'manifest.json'
        self.pins=json.loads((self.home/'test-pins.json').read_text())
        self.request=json.loads(self.request_path.read_text());self.manifest=json.loads(self.manifest_path.read_text())

    def verify(self,now=None):
        return E.verify_bundle(self.repo,self.request_path,self.pins['request_sha'],self.baseline,self.control,
                               self.pins['verifier_sha'],self.bundle,self.receipt_path,self.pins['receipt_sha'],now)

    def reseal(self, *, request=False, run=False):
        """Synthetic fault producer only; emulate a buggy trusted capture to test semantics."""
        if request:
            write_json(self.request_path,self.request);self.pins['request_sha']=G.sha(self.request_path.read_bytes())
            self.manifest['request_sha256']=self.pins['request_sha']
        if run:
            report=json.loads((self.bundle/'run/results.json').read_text())
            for suite,layer in report['layers'].items():
                layer['native_sha256']=G.sha((self.bundle/f'run/{suite}/native.xml').read_bytes())
                layer['diagnostics_sha256']=G.sha((self.bundle/f'run/{suite}/native.stdout.txt').read_bytes()+b'\n'
                                                 +(self.bundle/f'run/{suite}/native.stderr.txt').read_bytes())
            write_json(self.bundle/'run/results.json',report)
            self.manifest['test_run']['sha256']=G.sha((self.bundle/'run/results.json').read_bytes())
        # Tests can intentionally insert secret-like bytes; avoid invoking the production scanner here.
        self.manifest['artifacts']={p.relative_to(self.bundle).as_posix():{'sha256':G.sha(p.read_bytes()),'bytes':p.stat().st_size}
                                   for p in self.bundle.rglob('*') if p.is_file() and p.name!='manifest.json'}
        write_json(self.manifest_path,self.manifest)
        receipt=json.loads(self.receipt_path.read_text())
        receipt.update(manifest_sha256=G.sha(self.manifest_path.read_bytes()),request_sha256=self.pins['request_sha'],
                       run_report_sha256=self.manifest['test_run']['sha256'],configuration_digest=self.manifest['configuration_digest'],
                       finished_at=self.manifest['finished_at'])
        write_json(self.receipt_path,receipt);self.pins['receipt_sha']=G.sha(self.receipt_path.read_bytes())

    def run_mutation(self,change):
        path=self.bundle/'run/results.json';r=json.loads(path.read_text());change(r);write_json(path,r);self.reseal(run=True)

    def attestations(self,verified):
        now=datetime.now(timezone.utc)
        binding={'candidate_sha':self.request['candidate_sha'],'base_sha':self.request['base_sha'],
                 'configuration_sha256':verified['configuration_digest'],'goal_id':'M00-G08',
                 'evidence_manifest_sha256':verified['manifest_sha256'],'receipt_sha256':verified['receipt_sha256'],
                 'status':'pass','blockers':[],'round':1,'created_at':now.isoformat(),
                 'expires_at':(now+timedelta(hours=1)).isoformat()}
        reviews={role:{**binding,'reviewer_id':'synthetic-'+role,'session_id':'synthetic-session-'+role,'role':role}
                 for role in ('authority_security','regression')}
        return {'schema_version':1,'kind':'rifare-external-review-index-v1',
                'evidence_manifest_sha256':verified['manifest_sha256'],'request_sha256':verified['request_sha256'],
                'receipt_sha256':verified['receipt_sha256'],'review_round':1,'review_refs':list(reviews), 'reviews':reviews,
                'assignments':[{'worktree':str(self.repo),'branch':'goal/M00-G08','writer_id':'synthetic-writer','active':True}],
                'blockers':[],'release_approval':None,'intent':'local_merge','tag':None}

    def assess(self,att=None,result=None):
        result=result or self.verify();att=att if att is not None else self.attestations(result)
        return E.assess_acceptance(self.repo,self.request,result,self.manifest,att,datetime.now(timezone.utc))


class CaptureAndIntegrityTests(EvidenceFixture):
    def test_CASE_M00_G08_01_real_native_capture_and_separate_decision(self):
        """Independent expected arithmetic test count is one; acceptance stays false."""
        result=self.verify()
        self.assertEqual(result['status'],'verified');self.assertEqual(result['executed_test_count'],1)
        self.assertEqual(self.manifest['test_run']['executed_test_ids'],['python:test_sample.Sample.test_two'])
        self.assertEqual(self.manifest['test_run']['exit_codes'],{'python':0})
        self.assertFalse(result['goal_accepted']);self.assertFalse(result['review_identity_authenticated'])
        self.assertEqual(self.manifest['independent_review_references'],[])
    def test_actual_source_digest_is_not_git_tree_sha(self):
        result=self.verify();self.assertEqual(result['source_tree_sha256'],G.inspect_checkout(self.repo,self.pins['candidate'])['tracked_source_sha256'])
        self.assertNotEqual(result['source_tree_sha256'],self.manifest['git_tree'])
    def test_relocation_preserves_content_identity(self):
        self.assertNotEqual(self.manifest['environment']['captured_worktree'],str(self.repo));self.assertEqual(self.verify()['status'],'verified')
    def test_fresh_capture_runs_native_again(self):
        with patch('sys.stdout',io.StringIO()):
            result=E.capture(self.repo,self.request_path,self.pins['request_sha'],self.baseline,self.control,self.pins['verifier_sha'],
                             self.home/'notes',self.home/'second-bundle',self.home/'second-receipt.json')
        self.assertEqual(result['executed_test_count'],1)
        second=json.loads((self.home/'second-bundle/manifest.json').read_text())
        self.assertNotEqual(second['finished_at'],self.manifest['finished_at'])
    def test_existing_bundle_cannot_be_overwritten(self):
        with self.assertRaisesRegex(ValueError,'fresh evidence'):
            E.capture(self.repo,self.request_path,self.pins['request_sha'],self.baseline,self.control,self.pins['verifier_sha'],
                      self.home/'notes',self.bundle,self.home/'unused-receipt.json')
    def test_existing_receipt_cannot_be_overwritten(self):
        with self.assertRaisesRegex(ValueError,'fresh evidence'):
            E.capture(self.repo,self.request_path,self.pins['request_sha'],self.baseline,self.control,self.pins['verifier_sha'],
                      self.home/'notes',self.home/'fresh',self.receipt_path)
    def test_failed_native_run_creates_no_receipt(self):
        source=self.repo/'tests/test_sample.py';source.write_text(source.read_text().replace('1+1,2','1+1,3'))
        self.request['candidate_sha']=commit(self.repo);write_json(self.request_path,self.request)
        receipt=self.home/'failed-receipt.json'
        with self.assertRaisesRegex(ValueError,'passing diagnostic'),patch('sys.stdout',io.StringIO()):
            E.capture(self.repo,self.request_path,G.sha(self.request_path.read_bytes()),self.baseline,self.control,self.pins['verifier_sha'],
                      self.home/'notes',self.home/'failed-bundle',receipt)
        self.assertFalse(receipt.exists())
    def test_required_notes_cannot_be_omitted(self):
        self.request['supporting_files'].pop('demo.md');self.reseal(request=True)
        with self.assertRaisesRegex(ValueError,'notes missing'):self.verify()
    def test_supporting_file_mutation_rejected_before_capture(self):
        (self.home/'notes/demo.md').write_text('altered proof')
        with self.assertRaisesRegex(ValueError,'predeclared'):
            E.capture(self.repo,self.request_path,self.pins['request_sha'],self.baseline,self.control,self.pins['verifier_sha'],
                      self.home/'notes',self.home/'fresh',self.home/'fresh.json')
    def test_receipt_must_stay_outside_candidate(self):
        receipt=self.repo/'evidence/receipt.json';receipt.parent.mkdir();shutil.copyfile(self.receipt_path,receipt);self.receipt_path=receipt
        with self.assertRaisesRegex(ValueError,'outside candidate'):self.verify()
    def test_receipt_cannot_live_inside_bundle(self):
        receipt=self.bundle/'receipt.json';shutil.copyfile(self.receipt_path,receipt);self.receipt_path=receipt
        with self.assertRaisesRegex(ValueError,'outside candidate'):self.verify()
    def test_candidate_owned_controller_is_rejected(self):
        self.control=self.repo/'tools'
        with self.assertRaisesRegex(ValueError,'outside candidate'):self.verify()
    def test_changed_pinned_controller_is_rejected(self):
        p=self.control/'check_workflow.py';p.write_text(p.read_text()+'\n# changed\n')
        with self.assertRaisesRegex(ValueError,'verifier mismatch'):self.verify()
    def test_changed_external_request_is_rejected(self):
        self.request_path.write_bytes(self.request_path.read_bytes()+b' ')
        with self.assertRaisesRegex(ValueError,'input digest'):self.verify()
    def test_changed_external_receipt_is_rejected(self):
        self.receipt_path.write_bytes(self.receipt_path.read_bytes()+b' ')
        with self.assertRaisesRegex(ValueError,'input digest'):self.verify()
    def test_changed_baseline_is_rejected(self):
        self.baseline.write_bytes(self.baseline.read_bytes()+b' ')
        with self.assertRaisesRegex(ValueError,'baseline SHA'):self.verify()
    def test_missing_expected_receipt_hash_is_rejected(self):
        self.pins['receipt_sha']=''
        with self.assertRaisesRegex(ValueError,'SHA-256 required'):self.verify()
    def test_CASE_M00_G08_02_source_and_native_bytes_cannot_reuse_capture(self):
        self.repo.joinpath('contract.json').write_text('{"changed":true}\n')
        with self.assertRaisesRegex(ValueError,'dirty'):self.verify()
    def test_hidden_source_change_is_detected(self):
        git(self.repo,'update-index','--assume-unchanged','contract.json')
        self.repo.joinpath('contract.json').write_text('{"changed":true}\n')
        self.assertEqual(git(self.repo,'status','--porcelain'),'')
        with self.assertRaisesRegex(ValueError,'dirty'):self.verify()
    def test_new_candidate_commit_requires_recapture(self):
        commit(self.repo)
        with self.assertRaisesRegex(ValueError,'pinned commit'):self.verify()
    def test_branch_name_is_not_immutable_pin(self):
        self.request['candidate_sha']='main';self.reseal(request=True)
        with self.assertRaisesRegex(ValueError,'immutable commit'):self.verify()
    def test_modified_artifact_bytes_rejected(self):
        (self.bundle/'supporting/demo.md').write_text('unbound demo')
        with self.assertRaisesRegex(ValueError,'artifact inventory'):self.verify()
    def test_removed_artifact_rejected(self):
        (self.bundle/'run/python/native.xml').unlink()
        with self.assertRaisesRegex(ValueError,'artifact inventory'):self.verify()
    def test_extra_artifact_rejected(self):
        (self.bundle/'unlisted.txt').write_text('extra')
        with self.assertRaisesRegex(ValueError,'artifact inventory'):self.verify()
    def test_symlink_artifact_rejected(self):
        p=self.bundle/'supporting/demo.md';p.unlink();p.symlink_to(self.home/'notes/demo.md')
        with self.assertRaisesRegex(ValueError,'symlink'):self.verify()
    def test_hardlinked_artifact_rejected(self):
        p=self.bundle/'supporting/demo.md';p.unlink();os.link(self.home/'notes/demo.md',p)
        with self.assertRaisesRegex(ValueError,'single-link'):self.verify()
    def test_symlink_ancestor_rejected(self):
        p=self.home/'alias';p.symlink_to(self.bundle,target_is_directory=True);self.bundle=p
        with self.assertRaisesRegex(ValueError,'symlink'):self.verify()
    def test_nonregular_artifact_does_not_block_on_fifo(self):
        os.mkfifo(self.bundle/'fifo')
        with self.assertRaisesRegex(ValueError,'regular single-link'):self.verify()
    def test_case_colliding_paths_rejected(self):
        (self.bundle/'MANIFEST.json').write_text('{}')
        with self.assertRaisesRegex(ValueError,'case-colliding'):self.verify()
    def test_no_leaking_known_secret_in_exception_text(self):
        p=self.bundle/'supporting/demo.md';p.write_text(E.H.CANARY);self.reseal()
        with self.assertRaisesRegex(ValueError,'sensitive artifact') as caught:self.verify()
        self.assertNotIn(E.H.CANARY,str(caught.exception))
    def test_private_key_artifact_rejected(self):
        (self.bundle/'supporting/demo.md').write_text('-----BEGIN PRIVATE KEY-----\nsynthetic\n');self.reseal()
        with self.assertRaisesRegex(ValueError,'sensitive artifact'):self.verify()
    def test_artifact_size_limit_precedes_read(self):
        with patch.object(E.G,'MAX_BYTES',16):
            with self.assertRaisesRegex(ValueError,'oversized'):E.read_file(self.manifest_path)
    def test_total_inventory_limit_rejected(self):
        with patch.object(E,'MAX_TOTAL',16):
            with self.assertRaisesRegex(ValueError,'exceeds bounds'):E.inventory(self.bundle)


class SemanticEvidenceTests(EvidenceFixture):
    def test_CASE_M00_G08_03_other_goal_and_self_approval_are_rejected(self):
        self.manifest['goal_id']='M00-G07';self.reseal()
        with self.assertRaisesRegex(ValueError,'binding mismatch'):self.verify()
    def test_self_authored_approved_flag_is_unknown_field(self):
        self.manifest['approved']=True;self.reseal()
        with self.assertRaisesRegex(ValueError,'unexpected fields'):self.verify()
    def test_self_authored_reviewer_is_not_imported(self):
        self.manifest['independent_review_references']=['synthetic-author-approval'];self.reseal()
        with self.assertRaisesRegex(ValueError,'trusted reviewers'):self.verify()
    def test_copied_receipt_for_other_goal_rejected(self):
        r=json.loads(self.receipt_path.read_text());r['goal_id']='M00-G07';write_json(self.receipt_path,r)
        self.pins['receipt_sha']=G.sha(self.receipt_path.read_bytes())
        with self.assertRaisesRegex(ValueError,'receipt binding'):self.verify()
    def test_stale_manifest_configuration_rejected(self):
        self.manifest['configuration_digest']='0'*64;self.reseal()
        with self.assertRaisesRegex(ValueError,'configuration digest'):self.verify()
    def test_changed_source_configuration_pin_rejected(self):
        self.request['pins']['policies']['files'][E.POLICY]='0'*64;self.reseal(request=True)
        with self.assertRaisesRegex(ValueError,'source pin mismatch'):self.verify()
    def test_inapplicable_runtime_pin_rejected(self):
        self.request['pins']['runtimes']={'files':{},'settings':{},'not_applicable_reason':'unsupported'};self.reseal(request=True)
        with self.assertRaisesRegex(ValueError,'cannot be inapplicable'):self.verify()
    def test_unpinned_governing_policy_rejected(self):
        self.request['pins']['policies']={'files':{},'settings':{},'not_applicable_reason':'unsupported'};self.reseal(request=True)
        with self.assertRaisesRegex(ValueError,'policy pin required'):self.verify()
    def test_changed_base_policy_rejected(self):
        p=self.repo/E.POLICY;x=json.loads(p.read_text());x['minimum_independent_reviewers']=1;write_json(p,x)
        self.request['candidate_sha']=commit(self.repo);self.reseal(request=True)
        with self.assertRaisesRegex(ValueError,'changed governing policy'):self.verify()
    def test_false_compiled_build_claim_rejected(self):
        self.manifest['build']['kind']='compiled';self.reseal()
        with self.assertRaisesRegex(ValueError,'build identity'):self.verify()
    def test_build_digest_rejected(self):
        self.manifest['build']['sha256']='0'*64;self.reseal()
        with self.assertRaisesRegex(ValueError,'build identity'):self.verify()
    def test_changed_source_tree_digest_rejected(self):
        self.manifest['source_tree_sha256']='0'*64;self.reseal()
        with self.assertRaisesRegex(ValueError,'source tree mismatch'):self.verify()
    def test_unbound_manifest_bytes_fail_receipt(self):
        self.manifest_path.write_bytes(self.manifest_path.read_bytes()+b' ')
        with self.assertRaisesRegex(ValueError,'independent capture receipt'):self.verify()
    def test_report_status_cannot_be_fabricated(self):
        self.run_mutation(lambda r:r.update(status='failed'))
        with self.assertRaisesRegex(ValueError,'passing diagnostic'):self.verify()
    def test_report_source_cannot_change(self):
        self.run_mutation(lambda r:r['source'].update(commit='0'*40))
        with self.assertRaisesRegex(ValueError,'run candidate/source'):self.verify()
    def test_report_configuration_cannot_change(self):
        self.run_mutation(lambda r:r.update(configuration_digest='0'*64))
        with self.assertRaisesRegex(ValueError,'run configuration'):self.verify()
    def test_report_baseline_cannot_change(self):
        self.run_mutation(lambda r:r.update(baseline_sha256='0'*64))
        with self.assertRaisesRegex(ValueError,'run control pins'):self.verify()
    def test_missing_native_layer_rejected(self):
        self.run_mutation(lambda r:r['layers'].clear())
        with self.assertRaisesRegex(ValueError,'native suite'):self.verify()
    def test_nonzero_native_exit_rejected(self):
        self.run_mutation(lambda r:r['layers']['python'].update(exit_code=1))
        with self.assertRaisesRegex(ValueError,'native suite failed'):self.verify()
    def test_boolean_exit_code_is_not_integer(self):
        self.run_mutation(lambda r:r['layers']['python'].update(exit_code=False))
        with self.assertRaisesRegex(ValueError,'native suite failed'):self.verify()
    def test_zero_native_xml_cannot_reuse_green_counts(self):
        (self.bundle/'run/python/native.xml').write_text('<testsuite tests="0"/>');self.reseal(run=True)
        with self.assertRaisesRegex(ValueError,'zero tests'):self.verify()
    def test_skipped_native_xml_cannot_be_green(self):
        (self.bundle/'run/python/native.xml').write_text('<testsuite tests="1"><testcase name="test_sample.Sample.test_two"><skipped/></testcase></testsuite>');self.reseal(run=True)
        with self.assertRaisesRegex(ValueError,'skipped'):self.verify()
    def test_native_inventory_cannot_be_reidentified(self):
        p=self.bundle/'run/python/native.xml';p.write_text(p.read_text().replace('test_sample.Sample.test_two','renamed'));self.reseal(run=True)
        with self.assertRaisesRegex(ValueError,'test IDs'):self.verify()
    def test_duplicate_native_ids_rejected(self):
        (self.bundle/'run/python/native.xml').write_text('<testsuite tests="2"><testcase name="test_sample.Sample.test_two"/><testcase name="test_sample.Sample.test_two"/></testsuite>');self.reseal(run=True)
        with self.assertRaisesRegex(ValueError,'duplicate test IDs'):self.verify()
    def test_normalized_counts_must_match_native(self):
        self.run_mutation(lambda r:r['layers']['python']['counts'].update(executed=2))
        with self.assertRaisesRegex(ValueError,'normalized native counts'):self.verify()
    def test_discovery_inventory_cannot_be_shrunk(self):
        self.manifest['test_run']['discovered_test_ids']=[];self.reseal()
        with self.assertRaisesRegex(ValueError,'test-run mismatch'):self.verify()
    def test_command_text_is_checked_against_run(self):
        self.manifest['test_run']['commands']={'python':['true']};self.reseal()
        with self.assertRaisesRegex(ValueError,'test-run mismatch'):self.verify()
    def test_diagnostics_are_hashed(self):
        (self.bundle/'run/python/native.stderr.txt').write_text('altered diagnostics');self.reseal()
        with self.assertRaisesRegex(ValueError,'diagnostics digest'):self.verify()
    def test_caught_network_marker_cannot_be_hidden(self):
        (self.bundle/'run/python/native.stderr.txt').write_text('RIFARE_TEST_NETWORK_DENIED');self.reseal(run=True)
        with self.assertRaisesRegex(ValueError,'network access'):self.verify()
    def test_duplicate_json_key_rejected(self):
        raw=self.request_path.read_bytes().rstrip()[:-1]+b',"goal_id":"M00-G08"}'
        self.request_path.write_bytes(raw);self.pins['request_sha']=G.sha(raw)
        with self.assertRaisesRegex(ValueError,'duplicate JSON'):self.verify()
    def test_expired_request_is_blocked(self):
        after=E.timestamp(self.request['expires_at'])+timedelta(seconds=1)
        with self.assertRaisesRegex(ValueError,'expired'):self.verify(after)
    def test_future_request_is_blocked(self):
        before=E.timestamp(self.request['issued_at'])-timedelta(seconds=1)
        with self.assertRaisesRegex(ValueError,'not yet valid'):self.verify(before)
    def test_naive_timestamp_is_blocked(self):
        self.request['issued_at']='2026-10-16T00:00:00';self.reseal(request=True)
        with self.assertRaisesRegex(ValueError,'timezone'):self.verify()
    def test_run_time_outside_request_is_blocked(self):
        self.run_mutation(lambda r:r.update(started_at='2000-01-01T00:00:00+00:00'))
        with self.assertRaisesRegex(ValueError,'time window'):self.verify()
    def test_retention_before_capture_is_blocked(self):
        self.request['retention']['retain_until']='2000-01-01T00:00:00Z'
        self.manifest['retention']=copy.deepcopy(self.request['retention']);self.reseal(request=True)
        with self.assertRaisesRegex(ValueError,'retention ends'):self.verify()
    def test_automatic_cleanup_cannot_be_requested(self):
        self.request['retention']['cleanup']='delete_on_pass';self.reseal(request=True)
        with self.assertRaisesRegex(ValueError,'cleanup policy'):self.verify()
    def test_traversal_in_supporting_path_is_blocked(self):
        self.request['supporting_files']['../escape']='0'*64;self.reseal(request=True)
        with self.assertRaisesRegex(ValueError,'unsafe relative'):self.verify()
    def test_rerendered_demo_even_with_bundle_reseal_needs_request_pin(self):
        (self.bundle/'supporting/demo.md').write_text('different demonstration');self.reseal()
        with self.assertRaisesRegex(ValueError,'supporting evidence identity'):self.verify()


class ReviewBoundaryTests(EvidenceFixture):
    def test_two_synthetic_independent_reviews_satisfy_checks_not_acceptance(self):
        result=self.assess();self.assertEqual(result['status'],'checks_satisfied_not_accepted')
        self.assertFalse(result['goal_accepted']);self.assertFalse(result['release_authorized'])
        self.assertFalse(result['review_identity_authenticated'])
    def test_empty_review_index_cannot_approve(self):
        result=self.verify();att=self.attestations(result);att.update(review_refs=[],reviews={})
        with self.assertRaisesRegex(ValueError,'independent reviews missing'):self.assess(att,result)
    def test_author_cannot_review_itself(self):
        result=self.verify();att=self.attestations(result);att['reviews']['regression']['reviewer_id']='synthetic-writer'
        with self.assertRaisesRegex(ValueError,'author cannot'):self.assess(att,result)
    def test_author_session_cannot_review_itself(self):
        result=self.verify();att=self.attestations(result);att['reviews']['regression']['session_id']='synthetic-author-session'
        with self.assertRaisesRegex(ValueError,'author session'):self.assess(att,result)
    def test_same_reviewer_cannot_supply_both_roles(self):
        result=self.verify();att=self.attestations(result);att['reviews']['regression']['reviewer_id']=att['reviews']['authority_security']['reviewer_id']
        with self.assertRaisesRegex(ValueError,'independent assignments'):self.assess(att,result)
    def test_stale_candidate_review_rejected(self):
        result=self.verify();att=self.attestations(result);att['reviews']['regression']['candidate_sha']='0'*40
        with self.assertRaisesRegex(ValueError,'stale or mismatched'):self.assess(att,result)
    def test_stale_configuration_review_rejected(self):
        result=self.verify();att=self.attestations(result);att['reviews']['regression']['configuration_sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'stale or mismatched'):self.assess(att,result)
    def test_copied_other_bundle_review_rejected(self):
        result=self.verify();att=self.attestations(result);att['reviews']['regression']['evidence_manifest_sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'review evidence binding'):self.assess(att,result)
    def test_copied_other_receipt_index_rejected(self):
        result=self.verify();att=self.attestations(result);att['receipt_sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'index/evidence'):self.assess(att,result)
    def test_unreferenced_blocking_review_cannot_be_ignored(self):
        result=self.verify();att=self.attestations(result);att['reviews']['extra']={'status':'block'}
        with self.assertRaisesRegex(ValueError,'cannot omit'):self.assess(att,result)
    def test_blocking_review_cannot_be_outvoted(self):
        result=self.verify();att=self.attestations(result);att['reviews']['regression']['blockers']=['synthetic failure']
        with self.assertRaisesRegex(ValueError,'cannot be outvoted'):self.assess(att,result)
    def test_review_before_capture_is_invalid(self):
        result=self.verify();att=self.attestations(result);att['reviews']['regression']['created_at']='2000-01-01T00:00:00Z'
        with self.assertRaisesRegex(ValueError,'pre-capture review'):self.assess(att,result)
    def test_expired_review_is_invalid(self):
        result=self.verify();att=self.attestations(result);att['reviews']['regression']['expires_at']='2000-01-01T00:00:00Z'
        with self.assertRaisesRegex(ValueError,'stale'):self.assess(att,result)
    def test_recorded_blocker_prevents_completion(self):
        result=self.verify();att=self.attestations(result);att['blockers']=['target stack not qualified']
        with self.assertRaisesRegex(ValueError,'unresolved blockers'):self.assess(att,result)
    def test_duplicate_writer_prevents_completion(self):
        result=self.verify();att=self.attestations(result);att['assignments']*=2
        with self.assertRaisesRegex(ValueError,'multiple active writers'):self.assess(att,result)
    def test_review_round_must_match(self):
        result=self.verify();att=self.attestations(result);att['review_round']=2
        with self.assertRaisesRegex(ValueError,'round mismatch'):self.assess(att,result)
    def test_general_delegation_is_not_tag_authority(self):
        result=self.verify();att=self.attestations(result);att.update(intent='tagged_release',tag='v0.0.1')
        with self.assertRaisesRegex(ValueError,'human tagged-release approval missing'):self.assess(att,result)
    def test_candidate_supplied_approved_flag_in_index_is_invalid(self):
        result=self.verify();att=self.attestations(result);att['approved']=True
        with self.assertRaisesRegex(ValueError,'unexpected fields'):self.assess(att,result)
    def test_unverified_evidence_cannot_enter_assessment(self):
        with self.assertRaisesRegex(ValueError,'verified evidence'):self.assess({}, {'evidence_verified':False})
    def test_missing_dependency_in_trusted_base_blocks_even_reviewed_evidence(self):
        # Use a synthetic trusted reader response to exercise the accepted-dependency boundary.
        result=self.verify();att=self.attestations(result);old=G.read_blob
        def read(root,commit,path):
            raw=old(root,commit,path)
            if path=='planning/goals.json':
                data=json.loads(raw);data['goals'][0]['depends_on']=['M00-G06'];return G.canonical(data)
            return raw
        with patch.object(G,'read_blob',side_effect=read):
            with self.assertRaisesRegex(ValueError,'dependencies not accepted'):self.assess(att,result)



class AdditionalBoundaryTests(EvidenceFixture):
    def test_schema_matches_actual_capture_fields(self):
        schema=json.loads((ROOT/'templates/evidence-bundle.v1.schema.json').read_text())
        self.assertEqual(set(schema['required']),set(E.MANIFEST_KEYS))
        self.assertEqual(set(schema['properties']),set(E.MANIFEST_KEYS))
        self.assertFalse(schema['additionalProperties'])
        self.assertEqual(set(self.manifest),set(schema['required']))
    def test_artifact_integer_cannot_be_boolean(self):
        self.manifest['artifacts']['supporting/demo.md']['bytes']=True
        write_json(self.manifest_path,self.manifest)
        receipt=json.loads(self.receipt_path.read_text());receipt['manifest_sha256']=G.sha(self.manifest_path.read_bytes())
        write_json(self.receipt_path,receipt);self.pins['receipt_sha']=G.sha(self.receipt_path.read_bytes())
        with self.assertRaisesRegex(ValueError,'byte count'):self.verify()
    def test_source_changed_during_verification_is_detected(self):
        original=E.read_run
        def alter(*args):
            value=original(*args);(self.repo/'contract.json').write_text('{"changed":true}\n');return value
        with patch.object(E,'read_run',side_effect=alter):
            with self.assertRaisesRegex(ValueError,'dirty'):self.verify()
    def test_receipt_changed_during_verification_is_detected(self):
        original=E.read_run
        def alter(*args):
            value=original(*args);self.receipt_path.write_bytes(self.receipt_path.read_bytes()+b' ');return value
        with patch.object(E,'read_run',side_effect=alter):
            with self.assertRaisesRegex(ValueError,'trusted input changed'):self.verify()
    def test_unknown_release_approval_cannot_be_attached_to_local_merge(self):
        result=self.verify();att=self.attestations(result);att['release_approval']={'actor_type':'human'}
        with self.assertRaisesRegex(ValueError,'outside requested intent'):self.assess(att,result)
    def test_stale_release_evidence_cannot_be_reused(self):
        result=self.verify();att=self.attestations(result);att.update(intent='tagged_release',tag='v0.0.1')
        att['release_approval']={**att['reviews']['regression'],'actor_type':'human','actor_id':'synthetic-release-owner',
                                 'action':'tagged_release','tag':'v0.0.1','evidence_manifest_sha256':'0'*64}
        with self.assertRaisesRegex(ValueError,'review evidence binding'):self.assess(att,result)
    def test_interpreted_source_build_digest_is_explicit(self):
        self.assertEqual(self.manifest['build'],{'kind':'interpreted_source_not_compiled_artifact',
                                                'sha256':self.manifest['source_tree_sha256']})
    def test_missing_dependency_lock_pin_rejected(self):
        (self.repo/'package-lock.json').write_text('{"lockfileVersion":3}\n')
        self.request['candidate_sha']=commit(self.repo);self.reseal(request=True)
        with self.assertRaisesRegex(ValueError,'dependency input'):self.verify()


if __name__=='__main__': unittest.main()
