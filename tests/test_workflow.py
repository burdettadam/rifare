"""M00-G04 workflow contracts and native rehearsals; no live reviewer identities."""
from __future__ import annotations

import copy
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from check_workflow import (assess_checkpoint, configuration_digest, inspect_adoption,
                            load_pinned, validate_policy)
from check_distribution import sha256
FIX = ROOT / 'tests/fixtures/workflow/scenarios.SYNTHETIC.json'


class WorkflowContracts(unittest.TestCase):
    def setUp(self):
        fixture = json.loads(FIX.read_text())
        self.record = fixture['checkpoint']; self.binding = fixture['binding']
        self.attestations = fixture['attestations']
        self.policy = json.loads((ROOT / 'planning/workflow-policy.json').read_text())

    def assess(self):
        return assess_checkpoint(self.record, self.policy, self.binding, self.attestations)

    def blocked(self, pattern):
        with self.assertRaisesRegex(ValueError, pattern):
            self.assess()

    def test_predeclared_positive_review_contract(self):
        result = self.assess()
        self.assertEqual(result['independent_review_records_checked'], 2)
        self.assertEqual(result['review_basis'], 'supplied_independent_review_records')
        self.assertFalse(result['execution_authorized'])
        self.assertFalse(result['identity_authentication_performed'])

    def test_CASE_M00_G04_02_duplicate_writer_and_unauthorized_tag_rejected(self):
        duplicate = copy.deepcopy(self.attestations['assignments'][0])
        duplicate['writer_id'] = 'synthetic-other-writer'
        self.attestations['assignments'].append(duplicate)
        self.blocked('multiple active writers')
        self.attestations['assignments'].pop()
        self.record['intent'] = 'tagged_release'; self.record['tag'] = 'v0.0.1'
        self.blocked('explicit human tagged-release approval missing')

    def test_CASE_M00_G04_03_changed_candidate_or_missing_review_revokes_readiness(self):
        self.record['review_refs'].remove('synthetic-regression-review')
        self.blocked('required independent reviews missing')
        self.record['review_refs'].append('synthetic-regression-review')
        self.binding['candidate_sha'] = 'e' * 40
        self.record['candidate_sha'] = self.binding['candidate_sha']
        self.record['checks']['candidate_sha'] = self.binding['candidate_sha']
        self.blocked('review: stale or mismatched candidate_sha')

    def test_changed_configuration_invalidates_reviews(self):
        self.binding['configuration_sha256'] = 'e' * 64
        self.record['configuration_sha256'] = 'e' * 64
        self.record['checks']['configuration_sha256'] = 'e' * 64
        self.blocked('review: stale or mismatched configuration')

    def test_changed_base_invalidates_tests(self):
        self.binding['base_sha'] = 'e' * 40; self.record['base_sha'] = 'e' * 40
        self.blocked('tests: stale or mismatched base_sha')

    def test_old_candidate_checkpoint_rejected(self):
        self.record['candidate_sha'] = 'e' * 40
        self.blocked('checkpoint: stale')

    def test_report_hash_must_match_separate_evidence(self):
        self.record['checks']['report_sha256'] = 'e' * 64
        self.blocked('test report disagrees')

    def test_empty_or_partial_test_execution_rejected(self):
        for discovered, executed in [(0, 0), (12, 11), (12, 13)]:
            with self.subTest(discovered=discovered, executed=executed):
                self.record['checks']['discovered'] = discovered
                self.record['checks']['executed'] = executed
                self.blocked('missing or zero executed tests')

    def test_failures_and_skips_cannot_be_excused(self):
        for key in ('failures', 'skipped'):
            with self.subTest(key=key):
                self.record['checks'][key] = 1
                self.blocked('failed or skipped')
                self.record['checks'][key] = 0

    def test_boolean_test_counts_rejected(self):
        self.record['checks']['failures'] = False
        self.blocked('invalid test count')

    def test_missing_command_rejected(self):
        self.record['checks']['commands'] = []
        self.blocked('actual test commands')

    def test_dirty_candidate_rejected(self):
        self.binding['clean'] = False
        self.blocked('dirty candidate')

    def test_unaccepted_dependency_rejected(self):
        self.binding['dependencies_accepted'] = False
        self.blocked('dependencies not accepted')

    def test_author_cannot_supply_independent_review(self):
        self.attestations['reviews']['synthetic-regression-review']['reviewer_id'] = self.record['writer_id']
        self.blocked('author cannot be independent')

    def test_renaming_same_author_session_does_not_create_review(self):
        self.attestations['reviews']['synthetic-regression-review']['session_id'] = self.record['writer_session_id']
        self.blocked('author session')

    def test_two_names_same_session_are_not_independent(self):
        self.attestations['reviews']['synthetic-regression-review']['session_id'] = 'synthetic-authority-session'
        self.blocked('not independent assignments')

    def test_same_identity_in_two_sessions_not_independent(self):
        self.attestations['reviews']['synthetic-regression-review']['reviewer_id'] = 'synthetic-authority-reviewer'
        self.blocked('not independent assignments')

    def test_two_security_reviews_do_not_replace_regression(self):
        self.attestations['reviews']['synthetic-regression-review']['role'] = 'authority_security'
        self.blocked('duplicate or unknown review role')

    def test_unverified_review_reference_rejected(self):
        self.record['review_refs'].append('author-generated-approval')
        self.blocked('unverified review reference')

    def test_approved_flag_does_not_manufacture_reviews(self):
        self.record['review_refs'] = []; self.record['approved'] = True
        self.blocked('required independent reviews missing')

    def test_valid_blocker_cannot_be_outvoted(self):
        self.attestations['reviews']['synthetic-regression-review']['blockers'] = ['incorrect authority boundary']
        self.blocked('blocking review cannot be outvoted')

    def test_round_limit_is_enforced(self):
        self.record['review_round'] = 4
        self.blocked('round limit')

    def test_review_round_must_cover_current_round(self):
        self.record['review_round'] = 2
        self.blocked('review round mismatch')

    def test_inactive_assignment_does_not_supply_current_writer(self):
        self.attestations['assignments'][0]['active'] = False
        self.blocked('no unique active assignment')

    def test_assignment_branch_mismatch(self):
        self.attestations['assignments'][0]['branch'] = 'goal/other'
        self.blocked('writer or branch disagrees')

    def test_duplicate_branch_in_different_worktree_rejected(self):
        other = copy.deepcopy(self.attestations['assignments'][0])
        other['worktree'] += '-other'
        self.attestations['assignments'].append(other)
        self.blocked('multiple active writers on one branch')

    def test_aliased_worktree_does_not_evade_detection(self):
        other = copy.deepcopy(self.attestations['assignments'][0])
        other['worktree'] += '/../rifare-synthetic-one'
        other['branch'] = 'goal/other'
        self.attestations['assignments'].append(other)
        self.blocked('multiple active writers in one worktree')

    def exception(self):
        self.record['exception_id'] = 'BOOTSTRAP-LOCAL-01'
        self.record['review_refs'] = []

    def test_bootstrap_exception_is_explicit_not_fake_review(self):
        self.exception()
        result = self.assess()
        self.assertEqual(result['review_basis'], 'explicit_bootstrap_exception')
        self.assertEqual(result['independent_review_records_checked'], 0)
        self.assertFalse(result['execution_authorized'])

    def test_exception_cannot_waive_failed_tests(self):
        self.exception(); self.record['checks']['failures'] = 1
        self.blocked('failed or skipped')

    def test_exception_does_not_hide_stale_review(self):
        self.exception(); self.record['review_refs'] = ['synthetic-regression-review']
        self.attestations['reviews']['synthetic-regression-review']['candidate_sha'] = 'e'*40
        self.blocked('review: stale')

    def test_exception_does_not_authorize_tag(self):
        self.exception(); self.record['intent'] = 'tagged_release'
        self.blocked('exception is not release authority')

    def test_exception_does_not_apply_to_next_goal(self):
        self.exception(); self.record['goal_id'] = 'M00-G05'; self.binding['goal_id'] = 'M00-G05'
        self.blocked('exception not delegated')

    def test_earlier_goal_exception_requires_immutable_accepted_source(self):
        self.exception(); self.record['goal_id'] = 'M00-G03'; self.binding['goal_id'] = 'M00-G03'
        self.blocked('immutable accepted source')
        self.binding['previously_accepted_source'] = self.binding['candidate_sha']
        self.assertTrue(self.assess()['policy_checks_satisfied'])
        self.binding['previously_accepted_source'] = 'e' * 40
        self.blocked('immutable accepted source')

    def test_writer_session_is_required(self):
        del self.record['writer_session_id']
        self.blocked('missing writer session')

    def test_exception_does_not_allow_product_scope(self):
        self.exception(); self.binding['change_class'] = 'product'
        self.blocked('cannot qualify product')

    def test_exception_requires_prior_path_boundary(self):
        self.exception(); self.binding['changed_paths'].append('apps/unapproved.py')
        self.blocked('change outside prior bounded exception')

    def test_exception_cannot_ignore_known_blocker(self):
        self.exception(); self.record['blockers'] = ['test evidence unavailable']
        self.blocked('unresolved blockers')

    def test_paid_effects_rejected(self):
        self.record['external_effects'] = ['paid deployment']
        self.blocked('external effects')

    def test_release_requires_exact_action_candidate_and_tag(self):
        self.record['intent'] = 'tagged_release'; self.record['tag'] = 'v0.0.1'
        release = {k:self.binding[k] for k in ('candidate_sha','base_sha','configuration_sha256')}
        release.update(actor_type='human', actor_id='synthetic-owner', action='tagged_release', tag='v0.0.1')
        self.attestations['release_approval'] = release
        self.assertTrue(self.assess()['policy_checks_satisfied'])
        release['tag'] = 'v0.0.2'
        self.blocked('release scope mismatch')
        release['tag'] = 'v0.0.1'; release['candidate_sha'] = 'e'*40
        self.blocked('release approval: stale')

    def test_delegated_agent_is_not_explicit_human_release_approval(self):
        self.record['intent'] = 'tagged_release'; self.record['tag'] = 'v0.0.1'
        self.attestations['release_approval'] = {k:self.binding[k] for k in ('candidate_sha','base_sha','configuration_sha256')}
        self.attestations['release_approval'].update(actor_type='agent',actor_id='delegate',action='tagged_release',tag='v0.0.1')
        self.blocked('specific human release authority')

    def test_policy_cannot_drop_regression_role(self):
        self.policy['required_review_roles'] = ['authority_security']
        self.blocked('cannot omit regression')

    def test_policy_cannot_broaden_bootstrap_exception(self):
        self.policy['bootstrap_local_integration_exception']['goals'].append('M00-G05')
        self.blocked('exception scope expanded')

    def test_unresolved_template_cannot_complete(self):
        self.record = json.loads((ROOT/'templates/WORKFLOW-CHECKPOINT.json').read_text())
        self.blocked('checkpoint: stale')

    def test_declared_adoption_pins_actual_instruction_files(self):
        result = inspect_adoption(ROOT)
        self.assertEqual(result['skill_files_verified'], 2)
        self.assertFalse(result['client_discovery_qualified'])
        self.assertFalse(result['product_runtime_qualified'])

    def test_pinned_context_digest_mismatch_rejected(self):
        with self.assertRaisesRegex(ValueError, 'digest mismatch'):
            load_pinned(FIX, '0'*64)

    def test_pinned_context_parses_exact_hashed_bytes(self):
        digest=sha256(FIX.read_bytes())
        with patch.object(Path, 'read_text', side_effect=AssertionError('must not reread unpinned text')):
            result=load_pinned(FIX,digest)
        self.assertEqual(result['checkpoint']['goal_id'],'M00-G04')

    def test_cli_requires_explicit_policy_pin_for_checkpoint(self):
        result=subprocess.run([sys.executable,str(ROOT/'tools/check_workflow.py'),'--root',str(ROOT),'--checkpoint',str(ROOT/'templates/WORKFLOW-CHECKPOINT.json')],capture_output=True,text=True,timeout=20)
        self.assertEqual(result.returncode,1,result.stdout+result.stderr)
        self.assertIn('exact prior policy commit required',result.stdout)
        self.assertNotIn('Traceback',result.stderr)


class NativeWorktreeRehearsal(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='rifare-workflow-')
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.repo = self.home/'source'; self.repo.mkdir()
        self.git(self.repo,'init','-b','main')
        self.git(self.repo,'config','user.name','Rifare Synthetic Fixture')
        self.git(self.repo,'config','user.email','fixture@users.invalid')
        self.git(self.repo,'config','commit.gpgsign','false')
        (self.repo/'identity.txt').write_text('source fixture\n')
        self.git(self.repo,'add','.'); self.git(self.repo,'commit','-m','Synthetic fixture checkpoint')
        self.one=self.home/'worktree-one'; self.two=self.home/'worktree-two'
        self.git(self.repo,'worktree','add',str(self.one),'-b','goal/M00-G04','main')
        self.git(self.repo,'worktree','add',str(self.two),'-b','goal/WORKFLOW-SMOKE','main')

    def git(self, root, *args, success=True):
        p=subprocess.run(['git','-C',str(root),*args],capture_output=True,text=True,timeout=20)
        if success:
            self.assertEqual(p.returncode,0,p.stdout+p.stderr)
        return p

    def test_CASE_M00_G04_01_native_worktree_goal_rehearsal(self):
        self.assertTrue((self.one/'.git').is_file())
        common_one=self.git(self.one,'rev-parse','--path-format=absolute','--git-common-dir').stdout.strip()
        common_two=self.git(self.two,'rev-parse','--path-format=absolute','--git-common-dir').stdout.strip()
        self.assertEqual(common_one,common_two)
        (self.one/'identity.txt').write_text('goal M00-G04 candidate\n')
        self.git(self.one,'add','identity.txt'); self.git(self.one,'commit','-m','Synthetic goal checkpoint')
        candidate=self.git(self.one,'rev-parse','HEAD').stdout.strip()
        base=self.git(self.repo,'rev-parse','main').stdout.strip()
        self.assertNotEqual(candidate,base)
        self.assertEqual((self.two/'identity.txt').read_text(),'source fixture\n')
        self.assertEqual(self.git(self.one,'status','--porcelain').stdout,'')
        data=json.loads(FIX.read_text())
        record, binding, attestations = data['checkpoint'],data['binding'],data['attestations']
        binding.update(candidate_sha=candidate,base_sha=base,worktree=str(self.one))
        for obj in [record,record['checks'],*attestations['reviews'].values()]:
            obj.update(candidate_sha=candidate,base_sha=base)
        attestations['assignments'][0]['worktree']=str(self.one)
        policy=json.loads((ROOT/'planning/workflow-policy.json').read_text())
        result=assess_checkpoint(record,policy,binding,attestations)
        self.assertTrue(result['policy_checks_satisfied'])
        self.assertEqual(result['candidate_sha'],candidate)
        self.assertFalse(result['identity_authentication_performed'])

    def test_native_git_rejects_same_branch_in_second_worktree(self):
        result=self.git(self.repo,'worktree','add',str(self.home/'duplicate'),'goal/M00-G04',success=False)
        self.assertNotEqual(result.returncode,0)
        self.assertFalse((self.home/'duplicate').exists())

    def test_two_fixture_services_have_separate_ports_and_data(self):
        class QuietHandler(SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass
        servers=[]; threads=[]
        try:
            for path,text in [(self.one,'first-goal'),(self.two,'second-goal')]:
                (path/'identity.txt').write_text(text)
                handler=functools.partial(QuietHandler,directory=str(path))
                server=ThreadingHTTPServer(('127.0.0.1',0),handler)
                thread=threading.Thread(target=server.serve_forever,daemon=True)
                servers.append(server); threads.append(thread); thread.start()
            self.assertNotEqual(servers[0].server_port,servers[1].server_port)
            responses=[]
            for server in servers:
                with urlopen(f'http://127.0.0.1:{server.server_port}/identity.txt',timeout=5) as response:
                    responses.append(response.read().decode())
            self.assertEqual(responses,['first-goal','second-goal'])
            (self.one/'identity.txt').write_text('changed-first')
            with urlopen(f'http://127.0.0.1:{servers[1].server_port}/identity.txt',timeout=5) as response:
                self.assertEqual(response.read().decode(),'second-goal')
        finally:
            for server in servers:
                server.shutdown(); server.server_close()
            for thread in threads:
                thread.join(timeout=5)
        self.assertFalse(any(t.is_alive() for t in threads))


if __name__ == '__main__':
    unittest.main()
