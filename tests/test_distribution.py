"""M00-G03 source/notice/privacy regressions; no public-release or legal qualification."""
from __future__ import annotations

from contextlib import contextmanager
import copy
import hashlib
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
sys.path.insert(0, str(ROOT / 'tools'))
from check_distribution import (
    build_manifest, checkout_paths, compare_inventory, dependency_path, load_pinned,
    private_path, read_json, read_regular, review_checkout, review_stage,
    safe_path, sha256, stage_paths, validate_inventory, validate_policy,
)

FIX = ROOT / 'tests/fixtures/licensing'


class DistributionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='rifare-license-tests-')
        cls.home = Path(cls.tmp.name)
        cls.repo = cls.home / 'source'
        shutil.copytree(ROOT, cls.repo, ignore=shutil.ignore_patterns(
            '.git', '__pycache__', 'evidence', 'artifacts', '.venv', 'node_modules', 'runtime'))
        def g(*args):
            return subprocess.run(['git', '-C', str(cls.repo), *args], capture_output=True,
                                  text=True, check=True, timeout=30)
        g('init', '-b', 'test-candidate')
        g('-c', 'user.name=Synthetic Test', '-c', 'user.email=test@example.invalid', 'add', '.')
        g('-c', 'user.name=Synthetic Test', '-c', 'user.email=test@example.invalid',
          '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Synthetic source fixture')
        cls.stage = cls.home / 'stage'
        shutil.copytree(cls.repo, cls.stage, ignore=shutil.ignore_patterns('.git'))
        cls.manifest = build_manifest(cls.repo)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def setUp(self):
        self.i = read_json(self.repo / 'planning/component-inventory.json')
        self.p = read_json(self.repo / 'planning/licensing-policy.json')
        self.o = read_json(self.repo / 'tests/fixtures/licensing/retained-obligations.v1.json')
        self.paths = sorted(p for c in self.i['components'] for p in c['files'])
        self.expected = read_json(FIX / 'artifact-oracle.v1.json')

    def validate(self):
        return validate_inventory(self.i, self.paths, self.repo, self.p, self.o)

    def bad(self, pattern):
        with self.assertRaisesRegex(ValueError, pattern):
            self.validate()

    def component(self, identity):
        return next(c for c in self.i['components'] if c['id'] == identity)

    @contextmanager
    def change(self, root, relative, value=None):
        path = root / relative
        previous = path.read_bytes() if path.is_file() else None
        path.parent.mkdir(parents=True, exist_ok=True)
        if value is None:
            path.unlink()
        elif isinstance(value, bytes):
            path.write_bytes(value)
        else:
            path.write_text(value, encoding='utf-8')
        try:
            yield path
        finally:
            if previous is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(previous)

    def cli(self, *args):
        return subprocess.run([sys.executable, str(self.repo / 'tools/check_distribution.py'),
                               '--root', str(self.repo), *map(str, args)], capture_output=True,
                              text=True, timeout=30)

    def test_CASE_M00_G03_01_exact_source_membership_and_dispositions(self):
        """CASE-M00-G03-01: inventory proof; final license selection still requires owner."""
        members = self.validate()
        self.assertEqual(len(members), self.expected['source_file_count'])
        self.assertEqual(sorted(c['id'] for c in self.i['components']), self.expected['component_ids'])
        self.assertEqual(set(members), set(checkout_paths(self.repo)))
        report = review_stage(self.repo, self.stage, self.manifest)
        self.assertEqual(report['artifact_files_verified'], self.expected['source_file_count'])
        self.assertEqual(report['result'], 'pass')
        self.assertFalse(report['publication_authorized'])
        self.assertFalse(report['legal_clearance'])
        self.assertEqual(report['public_release_blockers'], self.expected['release_blockers'])

    def test_CASE_M00_G03_02_unknown_license_and_private_profile_rejected(self):
        """CASE-M00-G03-02: no permissive fallback for unknown rights or private data."""
        c = self.component('git-agent-adaptations')
        c['license_declared'] = 'NOASSERTION'
        self.bad('unknown or unreviewed third-party license')
        with self.change(self.stage, 'merchant-data/customer-profile.json', '{"synthetic_test": true}'):
            with self.assertRaisesRegex(ValueError, 'private or runtime path'):
                review_stage(self.repo, self.stage, self.manifest)
        (self.stage / 'merchant-data').rmdir()

    def test_CASE_M00_G03_03_missing_notice_and_inventory_diff_block(self):
        """CASE-M00-G03-03: dropping notice bytes or declarations is blocking."""
        with self.change(self.stage, 'THIRD-PARTY-NOTICES.md'):
            with self.assertRaisesRegex(ValueError, 'artifact membership mismatch'):
                review_stage(self.repo, self.stage, self.manifest)
        baseline = copy.deepcopy(self.i)
        self.component('git-agent-adaptations')['notices'] = []
        self.bad('missing required notice declaration')
        self.assertIn('review_required:changed_component:git-agent-adaptations', compare_inventory(self.i, baseline))

    def test_actual_checkout_is_complete(self):
        report = review_checkout(ROOT)
        self.assertEqual(report['files_reviewed'], self.expected['source_file_count'])
        self.assertEqual(report['observed_dependency_inputs'], [])

    def test_pending_owner_decision_stays_a_public_release_blocker(self):
        result = self.cli('--public-release')
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report['result'], 'blocked')
        self.assertFalse(report['publication_authorized'])
        self.assertIn('explicit_owner_license_and_rights_holder_decision', report['public_release_blockers'])

    def test_emit_manifest_has_exact_membership(self):
        result = self.cli('--emit-manifest')
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(json.loads(result.stdout), self.manifest)

    def test_no_auto_approval_field(self):
        self.p['authority']['publication_authorized'] = True
        with self.assertRaisesRegex(ValueError, 'review_required'):
            validate_policy(self.p, read_json(FIX / 'expected-policy.v1.json'))

    def test_approval_in_both_policy_and_candidate_oracle_does_not_authorize(self):
        self.p['authority']['owner_decision'] = 'self-authored approval'
        with self.assertRaisesRegex(ValueError, 'cannot grant'):
            validate_policy(self.p, copy.deepcopy(self.p))

    def test_revision_bump_is_not_license_approval(self):
        self.p['revision'] += 1
        with self.assertRaisesRegex(ValueError, 'review_required'):
            validate_policy(self.p, read_json(FIX / 'expected-policy.v1.json'))

    def test_removed_release_requirement_requires_review(self):
        self.p['release_requirements'].pop()
        with self.assertRaisesRegex(ValueError, 'review_required'):
            validate_policy(self.p, read_json(FIX / 'expected-policy.v1.json'))

    def test_first_party_cannot_claim_an_applied_license(self):
        self.component('rifare-project-material')['license_declared'] = 'Apache-2.0'
        self.bad('first-party grant not approved')

    def test_invented_rights_holder_rejected(self):
        self.component('rifare-project-material')['copyright'] = 'Invented Owner'
        self.bad('unconfirmed rights holder')

    def test_mit_substring_does_not_pass_unknown_expression(self):
        self.component('git-agent-adaptations')['license_declared'] = 'MIT OR LicenseRef-Unknown'
        self.bad('unknown or unreviewed third-party license')

    def test_removed_upstream_component_rejected(self):
        self.i['components'] = [c for c in self.i['components'] if c['id'] != 'git-agent-adaptations']
        self.bad('file inventory mismatch')

    def test_upstream_files_cannot_be_silently_reclassified(self):
        c = self.component('git-agent-adaptations')
        p = c['files'].pop()
        self.component('rifare-project-material')['files'].append(p)
        self.bad('upstream attribution remapped')

    def test_notice_content_tampering_rejected(self):
        with self.change(self.repo, 'THIRD-PARTY-NOTICES.md', 'Attribution removed.\n'):
            self.bad('required notice changed')

    def test_notice_declaration_and_file_deletion_cannot_agree_away_obligation(self):
        c = self.component('git-agent-adaptations')
        c['notices'] = []
        self.bad('missing required notice declaration')

    def test_notice_hash_change_in_inventory_diff_is_blocking(self):
        before = copy.deepcopy(self.i)
        self.component('git-agent-adaptations')['provenance'] = 'Different upstream revision'
        self.assertIn('review_required:changed_component:git-agent-adaptations', compare_inventory(self.i, before))

    def test_duplicate_component_id_rejected(self):
        self.i['components'].append(copy.deepcopy(self.i['components'][0]))
        self.bad('duplicate component')

    def test_duplicate_file_ownership_rejected(self):
        path = self.i['components'][0]['files'][0]
        self.i['components'][1]['files'].append(path)
        self.bad('duplicate file ownership')

    def test_empty_inventory_rejected(self):
        self.i['components'] = []
        self.bad('components cannot be empty')

    def test_uninventoried_source_rejected(self):
        self.paths.append('unreviewed.py')
        self.bad('file inventory mismatch')

    def test_deleted_source_not_silently_ignored(self):
        self.paths.pop()
        self.bad('file inventory mismatch')

    def test_private_classification_rejected(self):
        self.component('rifare-synthetic-configurations')['classification'] = 'private_merchant_data'
        self.bad('private or unresolved classification')

    def test_new_synthetic_profile_needs_explicit_review(self):
        path = 'examples/profiles/another-example.json'
        self.component('rifare-synthetic-configurations')['files'].append(path)
        self.paths.append(path)
        self.bad('new merchant fixture needs synthetic-data review')

    def test_existing_synthetic_profile_cannot_gain_private_values(self):
        path = 'examples/profiles/apparel-example.json'
        with self.change(self.repo, path, '{"profile_id":"real-merchant", "test_marker":"synthetic-only"}'):
            self.bad('synthetic example changed; privacy review required')

    def test_synthetic_profile_cannot_be_relabeled_as_ordinary_source(self):
        path = 'examples/profiles/apparel-example.json'
        self.component('rifare-synthetic-configurations')['files'].remove(path)
        self.component('rifare-project-material')['files'].append(path)
        self.bad('synthetic-example scope cannot be relabeled')

    def test_unknown_classification_on_new_source_rejected(self):
        self.component('rifare-project-material')['classification'] = 'probably-public'
        self.bad('private or unresolved classification')

    def test_lockfile_cannot_be_reclassified_as_first_party(self):
        path = 'unreviewed/package-lock.json'
        self.component('rifare-project-material')['files'].append(path)
        self.paths.append(path)
        self.bad('dependency intake required')

    def test_dependency_inputs_cannot_claim_resolution_without_a_parser(self):
        self.i['dependency_inputs'] = [{'path':'package-lock.json','license':'MIT'}]
        self.bad('dependency graph intake not implemented')

    def test_recognized_dependency_families_all_require_intake(self):
        for path in ['package.json', 'nested/pnpm-lock.yaml', 'uv.lock', 'poetry.lock',
                     'Cargo.lock', 'go.mod', 'requirements-dev.txt', 'requirements.in',
                     'Dockerfile', 'Dockerfile.production', 'compose.yaml', '.gitmodules',
                     'project.csproj', 'Gemfile.lock', 'pom.xml', 'composer.lock']:
            with self.subTest(path=path):
                self.assertTrue(dependency_path(path))
        self.assertFalse(dependency_path('docs/LICENSING.md'))

    def test_external_requirements_cannot_be_silently_dropped(self):
        self.i['external_requirements'].pop()
        self.bad('external_requirements_changed')

    def test_action_pin_change_requires_review(self):
        path = '.github/workflows/verify.yml'
        old = (self.repo / path).read_text()
        new = old.replace('11bd71901bbe5b1630ceea73d27597364c9af683', 'main')
        with self.change(self.repo, path, new):
            self.bad('workflow dependency references changed')

    def test_planned_sdk_not_misreported_as_present(self):
        self.i['planned_surfaces'][1]['status'] = 'implemented'
        self.bad('planned surface coverage changed')

    def test_private_filename_rules_are_case_insensitive(self):
        for path in ['.env', '.ENV.PRODUCTION', 'private/x.json', 'x/SECRETS/key.json',
                     'merchant-data/a.json', 'a/CREDENTIAL.key', '.git/config', 'data.sqlite3']:
            with self.subTest(path=path):
                self.assertTrue(private_path(path))
        self.assertFalse(private_path('.env.example'))

    def test_force_added_ignored_private_file_is_not_hidden(self):
        path = self.repo / '.env'
        path.write_text('SYNTHETIC_TEST_ONLY=true\n')
        try:
            subprocess.run(['git','-C',str(self.repo),'add','-f','.env'], check=True, capture_output=True)
            self.assertIn('.env', checkout_paths(self.repo))
            with self.assertRaisesRegex(ValueError, 'inventory mismatch'):
                review_checkout(self.repo)
        finally:
            subprocess.run(['git','-C',str(self.repo),'reset','--','.env'], check=True, capture_output=True)
            path.unlink()

    def test_untracked_nonignored_file_requires_inventory(self):
        with self.change(self.repo, 'unreviewed.txt', 'synthetic-only\n'):
            with self.assertRaisesRegex(ValueError, 'inventory mismatch'):
                review_checkout(self.repo)

    def test_dirty_source_cannot_emit_candidate_manifest(self):
        old = (self.repo/'README.md').read_text()
        with self.change(self.repo, 'README.md', old+'\nSynthetic edit.\n'):
            with self.assertRaisesRegex(ValueError, 'clean candidate'):
                build_manifest(self.repo)

    def test_root_license_cannot_be_installed_as_an_unapproved_grant(self):
        path = 'LICENSE'
        self.component('rifare-project-material')['files'].append(path)
        self.paths.append(path)
        with self.change(self.repo, path, 'Synthetic, unapproved license fixture.\n'):
            self.bad('no root license grant may be installed')

    def test_removed_component_diff_is_blocking(self):
        before = copy.deepcopy(self.i)
        removed = self.i['components'].pop()
        self.assertIn(f'review_required:removed_component:{removed["id"]}', compare_inventory(self.i,before))

    def test_added_component_diff_is_blocking(self):
        before = copy.deepcopy(self.i)
        added = copy.deepcopy(self.i['components'][0]); added['id']='new-component'
        self.i['components'].append(added)
        self.assertIn('review_required:added_component:new-component', compare_inventory(self.i,before))

    def test_inventory_revision_change_is_still_a_review_change(self):
        before = copy.deepcopy(self.i)
        self.i['revision'] += 1
        self.assertIn('review_required:changed_inventory_field:revision', compare_inventory(self.i,before))

    def test_unknown_fields_do_not_create_authority(self):
        self.i['approved'] = True
        self.bad('missing or unexpected fields')

    def test_type_confusion_is_not_accepted(self):
        self.i['revision'] = True
        self.bad('wrong type')

    def test_manifest_cannot_omit_notice_even_with_coherent_file_list(self):
        manifest = copy.deepcopy(self.manifest)
        manifest['files'] = [r for r in manifest['files'] if r['path'] != 'THIRD-PARTY-NOTICES.md']
        with self.change(self.stage, 'THIRD-PARTY-NOTICES.md'):
            with self.assertRaisesRegex(ValueError, 'differs from the source candidate'):
                review_stage(self.repo, self.stage, manifest)

    def test_manifest_cannot_relabel_file_as_public(self):
        manifest = copy.deepcopy(self.manifest)
        next(r for r in manifest['files'] if r['path']=='examples/profiles/apparel-example.json')['classification']='project_source'
        with self.assertRaisesRegex(ValueError, 'differs from the source candidate'):
            review_stage(self.repo, self.stage, manifest)

    def test_manifest_cannot_claim_publication_approval(self):
        manifest = copy.deepcopy(self.manifest); manifest['publication_authorized']=True
        with self.assertRaisesRegex(ValueError, 'cannot grant publication authority'):
            review_stage(self.repo, self.stage, manifest)

    def test_manifest_bound_to_candidate_commit(self):
        manifest = copy.deepcopy(self.manifest); manifest['candidate_commit']='a'*40
        with self.assertRaisesRegex(ValueError, 'differs from the source candidate'):
            review_stage(self.repo,self.stage,manifest)

    def test_manifest_bound_to_source_tree(self):
        manifest = copy.deepcopy(self.manifest); manifest['candidate_tree']='b'*40
        with self.assertRaisesRegex(ValueError, 'differs from the source candidate'):
            review_stage(self.repo,self.stage,manifest)

    def test_manifest_duplicate_entries_rejected(self):
        manifest = copy.deepcopy(self.manifest); manifest['files'].append(copy.deepcopy(manifest['files'][0]))
        with self.assertRaisesRegex(ValueError, 'differs from the source candidate'):
            review_stage(self.repo,self.stage,manifest)

    def test_staged_extra_file_not_hidden_by_manifest(self):
        with self.change(self.stage,'unexpected.txt','synthetic extra'):
            with self.assertRaisesRegex(ValueError,'artifact membership mismatch'):
                review_stage(self.repo,self.stage,self.manifest)

    def test_staged_hidden_credential_rejected(self):
        with self.change(self.stage,'.env','SYNTHETIC_TOKEN=not-a-real-token'):
            with self.assertRaisesRegex(ValueError,'private or runtime path'):
                review_stage(self.repo,self.stage,self.manifest)

    def test_stage_notice_changed_even_when_inventory_is_good(self):
        with self.change(self.stage,'THIRD-PARTY-NOTICES.md','removed notice'):
            with self.assertRaisesRegex(ValueError,'artifact content mismatch'):
                review_stage(self.repo,self.stage,self.manifest)

    def test_stage_case_collision_rejected(self):
        with self.change(self.stage,'readme.md','synthetic collision'):
            with self.assertRaisesRegex(ValueError,'case-colliding artifact'):
                review_stage(self.repo,self.stage,self.manifest)

    def test_stage_symlink_rejected(self):
        path=self.stage/'linked.txt'
        path.symlink_to(self.stage/'README.md')
        try:
            with self.assertRaisesRegex(ValueError,'stage symlink'):
                stage_paths(self.stage)
        finally:
            path.unlink()

    def test_stage_symlink_directory_rejected(self):
        path=self.stage/'linked-dir'
        path.symlink_to(self.stage/'docs',target_is_directory=True)
        try:
            with self.assertRaisesRegex(ValueError,'stage symlink'):
                stage_paths(self.stage)
        finally:
            path.unlink()

    def test_stage_hardlink_rejected(self):
        path=self.stage/'hardlinked.txt'
        os.link(self.stage/'README.md',path)
        try:
            with self.assertRaisesRegex(ValueError,'hardlinked'):
                stage_paths(self.stage)
        finally:
            path.unlink()

    def test_empty_stage_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError,'empty artifact'):
                stage_paths(Path(directory))

    def test_nonexistent_stage_fails(self):
        with self.assertRaisesRegex(ValueError,'stage must be'):
            stage_paths(self.home/'missing-stage')

    def test_unsafe_paths_rejected(self):
        for path in ['../x','/tmp/x','x/../y','x//y','./x','x\\y','C:/x','x/CON.txt','x.','x/','x\x00y']:
            with self.subTest(path=path):
                with self.assertRaises(ValueError):
                    safe_path(path)
        self.assertEqual(safe_path('examples/profiles/apparel-example.json'),'examples/profiles/apparel-example.json')

    def test_json_duplicate_keys_fail_closed(self):
        with self.change(self.home,'bad.json','{"approved": false, "approved": true}') as path:
            with self.assertRaisesRegex(ValueError,'duplicate JSON key'):
                read_json(path)

    def test_json_nonfinite_number_fails_closed(self):
        with self.change(self.home,'bad.json','{"revision": NaN}') as path:
            with self.assertRaisesRegex(ValueError,'non-finite'):
                read_json(path)

    def test_pinned_manifest_hash_checked(self):
        path=self.home/'manifest.json'; path.write_text(json.dumps(self.manifest))
        with self.assertRaisesRegex(ValueError,'hash mismatch'):
            load_pinned(path,'a'*64)

    def test_malformed_expected_hash_rejected(self):
        path=self.home/'manifest.json'; path.write_text(json.dumps(self.manifest))
        with self.assertRaisesRegex(ValueError,'64 lowercase hex'):
            load_pinned(path,'not-a-digest')

    def test_cli_requires_manifest_hash(self):
        r=self.cli('--stage',self.stage,'--manifest',self.home/'manifest.json')
        self.assertEqual(r.returncode,1)
        self.assertIn('must be supplied together',r.stdout)

    def test_cli_requires_baseline_hash(self):
        r=self.cli('--baseline',self.repo/'planning/component-inventory.json')
        self.assertEqual(r.returncode,1)
        self.assertIn('must be supplied together',r.stdout)

    def test_cli_identical_retained_inventory_passes_without_approving(self):
        path=self.repo/'planning/component-inventory.json'
        r=self.cli('--baseline',path,'--baseline-sha256',sha256(path.read_bytes()))
        self.assertEqual(r.returncode,0,r.stdout)
        self.assertFalse(json.loads(r.stdout)['publication_authorized'])

    def test_cli_baseline_notice_change_is_blocking(self):
        baseline=copy.deepcopy(self.i)
        next(c for c in baseline['components'] if c['id']=='git-agent-adaptations')['notices'].append('legacy-notice.txt')
        path=self.home/'prior-inventory.json'; path.write_text(json.dumps(baseline))
        r=self.cli('--baseline',path,'--baseline-sha256',sha256(path.read_bytes()))
        self.assertEqual(r.returncode,1)
        self.assertIn('review_required:changed_component:git-agent-adaptations',r.stdout)

    def test_cli_valid_stage_passes(self):
        path=self.home/'stage-manifest.json'; path.write_text(json.dumps(self.manifest))
        r=self.cli('--stage',self.stage,'--manifest',path,'--manifest-sha256',sha256(path.read_bytes()))
        self.assertEqual(r.returncode,0,r.stdout+r.stderr)
        self.assertEqual(json.loads(r.stdout)['artifact_files_verified'],self.expected['source_file_count'])

    def test_nested_git_root_cannot_hide_source_files(self):
        with self.assertRaisesRegex(ValueError,'exact Git worktree root'):
            checkout_paths(self.repo/'docs')

    def test_inventory_command_failure_cannot_be_partial_success(self):
        with patch('check_distribution.git',side_effect=ValueError('Git inspection failed')):
            with self.assertRaisesRegex(ValueError,'Git inspection failed'):
                review_checkout(self.repo)


    def test_assume_unchanged_cannot_hide_different_source_bytes(self):
        path='README.md'
        old=(self.repo/path).read_text()
        subprocess.run(['git','-C',str(self.repo),'update-index','--assume-unchanged',path],check=True,capture_output=True)
        try:
            with self.change(self.repo,path,old+'\nHidden synthetic edit.\n'):
                with self.assertRaisesRegex(ValueError,'working bytes differ from committed blob'):
                    build_manifest(self.repo)
        finally:
            subprocess.run(['git','-C',str(self.repo),'update-index','--no-assume-unchanged',path],check=True,capture_output=True)

    def test_pinned_input_parses_exactly_the_hashed_bytes(self):
        path=self.home/'pinned.json'; path.write_bytes(b'{"trusted": true}')
        data=path.read_bytes()
        with patch.object(Path,'read_bytes',side_effect=[data,b'{"trusted": false}']) as read:
            self.assertEqual(load_pinned(path,sha256(data)),{'trusted':True})
            self.assertEqual(read.call_count,1)

    def test_malformed_retained_inventory_cannot_hide_duplicate_ids(self):
        before=copy.deepcopy(self.i)
        before['components'].append(copy.deepcopy(before['components'][0]))
        with self.assertRaisesRegex(ValueError,'duplicate component identity'):
            compare_inventory(self.i,before)

    def test_malformed_retained_inventory_is_reported_not_assumed_empty(self):
        before=copy.deepcopy(self.i); before['components']=['invalid']
        with self.assertRaisesRegex(ValueError,'missing or unexpected fields'):
            compare_inventory(self.i,before)


if __name__ == '__main__':
    unittest.main()
