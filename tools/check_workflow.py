#!/usr/bin/env python3
"""Read-only workflow contract checks. Does not schedule, lock, merge or authorize."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

from check_distribution import build_manifest, decode_json, read_json, require, sha256

BINDING = ('candidate_sha', 'base_sha', 'configuration_sha256')
HEX40 = re.compile(r'[0-9a-f]{40}\Z')
HEX64 = re.compile(r'[0-9a-f]{64}\Z')
CONFIGURATION_PATHS = (
    'AGENTS.md', 'docs/GOVERNANCE.md', 'docs/DEVELOPMENT.md', 'planning/workflow-policy.json',
    '.agents/skills/work-goal/SKILL.md', '.agents/skills/worktree-flow/SKILL.md',
)


def git(root: Path, *args: str) -> str:
    result = subprocess.run(['git', '-c', 'core.fsmonitor=false', '-C', str(root), *args],
                            capture_output=True, text=True, timeout=30)
    require(result.returncode == 0, 'Git inspection failed: ' + result.stderr.strip())
    return result.stdout


def configuration_digest(root: Path) -> str:
    entries = [(p, sha256((root / p).read_bytes())) for p in CONFIGURATION_PATHS]
    return sha256(json.dumps(entries, separators=(',', ':')).encode())


def validate_policy(policy: dict) -> None:
    require(type(policy) is dict and policy.get('id') == 'rifare-workflow-policy', 'unknown workflow policy')
    require(policy.get('schema_version') == 1 and type(policy.get('revision')) is int
            and policy['revision'] >= 1, 'invalid workflow policy version')
    require(bool(HEX40.fullmatch(policy.get('authority_commit', ''))), 'missing prior authority checkpoint')
    roles = policy.get('required_review_roles')
    require(type(roles) is list and set(roles) >= {'authority_security', 'regression'}
            and len(roles) == len(set(roles)), 'required review roles cannot omit regression or authority')
    minimum = policy.get('minimum_independent_reviewers')
    require(type(minimum) is int and minimum >= 2 and minimum <= len(roles), 'invalid independent reviewer minimum')
    rounds = policy.get('maximum_review_rounds')
    require(type(rounds) is int and 1 <= rounds <= 10, 'invalid review round limit')
    for key in ('require_candidate_bound_tests', 'require_clean_candidate', 'require_explicit_tagged_release_approval'):
        require(policy.get(key) is True, f'required control disabled: {key}')
    require(policy.get('allow_paid_or_production_effects') is False, 'external effects outside adopted workflow')
    exception = policy.get('bootstrap_local_integration_exception')
    require(type(exception) is dict and exception.get('id') == 'BOOTSTRAP-LOCAL-01', 'invalid bootstrap exception')
    require(exception.get('goals') == ['M00-G01', 'M00-G02', 'M00-G03', 'M00-G04']
            and exception.get('intent') == 'local_merge'
            and exception.get('expires_after_goal') == 'M00-G04', 'bootstrap exception scope expanded')
    require(exception.get('replaces') == 'missing_independent_reviews_only', 'exception cannot waive other controls')
    require(type(exception.get('g04_allowed_paths')) is list and exception['g04_allowed_paths'], 'missing change boundary')


def check_assignments(assignments: list, binding: dict, writer_id: str) -> None:
    """Check a supplied assignment snapshot, not live process ownership or OS locking."""
    require(type(assignments) is list and assignments, 'missing assignment snapshot')
    seen_paths, seen_branches, selected = set(), set(), []
    for assignment in assignments:
        require(type(assignment) is dict and type(assignment.get('active')) is bool, 'invalid assignment')
        if not assignment['active']:
            continue
        for field in ('worktree', 'branch', 'writer_id'):
            require(type(assignment.get(field)) is str and assignment[field].strip(), 'missing assignment identity')
        path = Path(assignment['worktree'])
        require(path.is_absolute(), 'assignment worktree must be absolute')
        canonical = str(path.resolve())
        require(canonical not in seen_paths, 'multiple active writers in one worktree')
        require(assignment['branch'] not in seen_branches, 'multiple active writers on one branch')
        seen_paths.add(canonical)
        seen_branches.add(assignment['branch'])
        if canonical == str(Path(binding['worktree']).resolve()):
            selected.append(assignment)
    require(len(selected) == 1, 'current worktree has no unique active assignment')
    require(selected[0]['writer_id'] == writer_id and selected[0]['branch'] == binding['branch'],
            'writer or branch disagrees with assignment')


def check_binding(value: dict, binding: dict, label: str) -> None:
    require(type(value) is dict, f'{label}: expected object')
    for key in BINDING:
        require(value.get(key) == binding.get(key), f'{label}: stale or mismatched {key}')


def assess_checkpoint(record: dict, policy: dict, binding: dict, attestations: dict) -> dict[str, Any]:
    """Evaluate facts supplied by a trusted caller; hashes alone do not authenticate people."""
    validate_policy(policy)
    require(type(record) is dict and record.get('schema_version') == 1, 'invalid checkpoint schema')
    require(type(binding) is dict and type(attestations) is dict, 'missing caller binding or attestations')
    for key in ('candidate_sha', 'base_sha'):
        require(type(binding.get(key)) is str and bool(HEX40.fullmatch(binding[key])), f'invalid {key}')
    require(type(binding.get('configuration_sha256')) is str
            and bool(HEX64.fullmatch(binding['configuration_sha256'])), 'invalid configuration digest')
    require(binding.get('clean') is True, 'dirty candidate cannot complete')
    require(binding.get('dependencies_accepted') is True, 'dependencies not accepted')
    require(record.get('goal_id') == binding.get('goal_id'), 'goal identity mismatch')
    check_binding(record, binding, 'checkpoint')
    writer = record.get('writer_id')
    require(type(writer) is str and writer.strip(), 'missing writer identity')
    require(type(record.get('writer_session_id')) is str and record['writer_session_id'].strip(), 'missing writer session')
    require(record.get('branch') == binding.get('branch'), 'branch identity mismatch')
    check_assignments(attestations.get('assignments'), binding, writer)
    require(record.get('blockers') == [], 'unresolved blockers prevent completion')
    round_number = record.get('review_round')
    require(type(round_number) is int and 1 <= round_number <= policy['maximum_review_rounds'], 'review round limit exceeded')
    intent = record.get('intent')
    require(intent in {'local_merge', 'tagged_release'}, 'unsupported completion intent')
    require(record.get('external_effects') == [], 'external effects outside workflow qualification')
    checks = record.get('checks')
    check_binding(checks, binding, 'tests')
    for key in ('discovered', 'executed', 'failures', 'skipped'):
        require(type(checks.get(key)) is int and checks[key] >= 0, f'invalid test count: {key}')
    require(checks['discovered'] > 0 and checks['executed'] == checks['discovered'], 'missing or zero executed tests')
    require(checks['failures'] == 0 and checks['skipped'] == 0 and checks.get('status') == 'pass', 'failed or skipped tests')
    require(type(checks.get('commands')) is list and bool(checks['commands'])
            and all(type(x) is str and x.strip() for x in checks['commands']), 'missing actual test commands')
    require(bool(HEX64.fullmatch(checks.get('report_sha256', ''))), 'missing test report identity')
    require(checks['report_sha256'] == attestations.get('verified_report_sha256'), 'test report disagrees with caller evidence')

    references = record.get('review_refs')
    require(type(references) is list and all(type(x) is str and x for x in references)
            and len(references) == len(set(references)), 'invalid or duplicate review references')
    index = attestations.get('reviews')
    require(type(index) is dict, 'missing independent review index')
    reviewers, sessions, roles = set(), set(), set()
    for reference in references:
        require(reference in index, 'unverified review reference')
        review = index[reference]
        check_binding(review, binding, 'review')
        require(review.get('goal_id') == record['goal_id'], 'review goal mismatch')
        require(review.get('status') == 'pass' and review.get('blockers') == [], 'blocking review cannot be outvoted')
        identity, session, role = review.get('reviewer_id'), review.get('session_id'), review.get('role')
        require(type(identity) is str and identity and identity != writer, 'author cannot be independent reviewer')
        require(type(session) is str and session and session != record.get('writer_session_id'), 'author session cannot review itself')
        require(identity not in reviewers and session not in sessions, 'reviews are not independent assignments')
        require(role in policy['required_review_roles'] and role not in roles, 'duplicate or unknown review role')
        require(review.get('round') == round_number, 'review round mismatch')
        reviewers.add(identity); sessions.add(session); roles.add(role)

    exception_id = record.get('exception_id')
    exception = policy['bootstrap_local_integration_exception']
    using_exception = exception_id is not None
    if using_exception:
        require(exception_id == exception['id'] and intent == 'local_merge', 'exception is not release authority')
        require(record['goal_id'] in exception['goals'] and writer == exception['delegate_id'], 'exception not delegated for this goal or writer')
        require(binding.get('change_class') == 'bootstrap_development', 'exception cannot qualify product changes')
        if record['goal_id'] != 'M00-G04':
            require(binding.get('previously_accepted_source') == binding['candidate_sha'],
                    'earlier-goal exception requires its immutable accepted source')
        if record['goal_id'] == 'M00-G04':
            paths = binding.get('changed_paths')
            require(type(paths) is list and bool(paths) and set(paths) <= set(exception['g04_allowed_paths']), 'change outside prior bounded exception')
    else:
        require(roles == set(policy['required_review_roles'])
                and len(reviewers) >= policy['minimum_independent_reviewers'], 'required independent reviews missing')

    if intent == 'tagged_release':
        release = attestations.get('release_approval')
        require(type(release) is dict, 'explicit human tagged-release approval missing')
        check_binding(release, binding, 'release approval')
        require(release.get('actor_type') == 'human' and release.get('actor_id') != writer
                and type(release.get('actor_id')) is str and bool(release['actor_id']), 'specific human release authority required')
        require(release.get('action') == 'tagged_release'
                and type(record.get('tag')) is str and re.fullmatch(r'v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', record['tag'])
                and release.get('tag') == record['tag'], 'release scope mismatch')
    return {
        'result': 'pass', 'goal_id': record['goal_id'], 'intent': intent,
        'policy_checks_satisfied': True,
        'review_basis': 'explicit_bootstrap_exception' if using_exception else 'supplied_independent_review_records',
        'independent_review_records_checked': len(reviewers),
        'candidate_sha': binding['candidate_sha'], 'base_sha': binding['base_sha'],
        'configuration_sha256': binding['configuration_sha256'],
        'execution_authorized': False, 'identity_authentication_performed': False,
        'note': 'Read-only evidence checks; acceptance and operations remain separate maintainer actions.',
    }


def inspect_adoption(root: Path) -> dict:
    root = root.resolve()
    require(Path(git(root, 'rev-parse', '--show-toplevel').strip()).resolve() == root, 'exact worktree root required')
    adoption = read_json(root / 'planning/workflow-adoption.json')
    require(adoption.get('schema_version') == 1 and adoption.get('id') == 'rifare-workflow-adoption', 'invalid adoption identity')
    source = adoption.get('upstream', {})
    require(source == {'repository': 'ElevenID/git-agent', 'version': '0.2.1',
                       'commit': '2ead37bfe9bf28489816bfdd4deeea137e23fa37',
                       'kind': 'adapted_instruction_files_not_bundled_initializer'}, 'unreviewed upstream change')
    require(adoption.get('mandatory_model_provider') is None, 'workflow cannot require a model provider')
    require(adoption.get('custom_orchestrator') is False and adoption.get('product_runtime_qualified') is False, 'unsupported runtime claim')
    skills = adoption.get('skills')
    require(type(skills) is list and len(skills) == 2, 'exactly two workflow skills required')
    require({x.get('name') for x in skills} == {'work-goal', 'worktree-flow'}, 'workflow skill identity mismatch')
    for skill in skills:
        path = f'.agents/skills/{skill["name"]}/SKILL.md'
        require(skill.get('path') == path, 'skill moved outside declared discovery path')
        data = (root / path).read_bytes()
        require(sha256(data) == skill.get('sha256'), 'review_required: workflow skill changed')
        require(data.startswith(b'---\n') and f'name: {skill["name"]}\n'.encode() in data, 'invalid skill frontmatter')
    require(adoption.get('goal_mapping') == {
        'packet': 'planning/goals/<milestone>/<goal-id>.md', 'branch': 'goal/<goal-id>',
        'work_record': 'work/records/<goal-id>.md', 'evidence': 'evidence/<goal-id>/<candidate-sha>/'}, 'goal mapping changed')
    validate_policy(read_json(root / 'planning/workflow-policy.json'))
    return {'result': 'pass', 'scope': 'installed_instruction_and_offline_workflow_contract',
            'skill_files_verified': len(skills), 'configuration_sha256': configuration_digest(root),
            'client_discovery_qualified': False, 'product_runtime_qualified': False,
            'execution_authorized': False, 'hosted_controls_verified': False}


def load_pinned(path: Path, expected: str) -> dict:
    require(type(expected) is str and bool(HEX64.fullmatch(expected)), 'independently retained sha256 required')
    data = path.read_bytes()
    require(sha256(data) == expected, 'trusted input digest mismatch')
    return decode_json(data)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--checkpoint', type=Path)
    parser.add_argument('--policy-commit')
    parser.add_argument('--policy-sha256')
    parser.add_argument('--attestations', type=Path)
    parser.add_argument('--attestations-sha256')
    args = parser.parse_args()
    try:
        root = args.root.resolve()
        output = inspect_adoption(root)
        if args.checkpoint:
            require(args.policy_commit and HEX40.fullmatch(args.policy_commit), 'exact prior policy commit required')
            raw = subprocess.run(['git', '-C', str(root), 'show', f'{args.policy_commit}:planning/workflow-policy.json'],
                                 capture_output=True, timeout=30, check=True).stdout
            require(args.policy_sha256 and HEX64.fullmatch(args.policy_sha256)
                    and sha256(raw) == args.policy_sha256, 'trusted policy digest mismatch')
            git(root, 'merge-base', '--is-ancestor', args.policy_commit, 'HEAD')
            require((root / 'planning/workflow-policy.json').read_bytes() == raw, 'candidate cannot change its own workflow policy')
            require(args.attestations is not None, 'separate caller attestations required')
            attestations = load_pinned(args.attestations, args.attestations_sha256)
            source = build_manifest(root)
            record = read_json(args.checkpoint)
            plan = decode_json(git(root, 'show', f'{args.policy_commit}:planning/goals.json').encode())
            goal = next((g for g in plan['goals'] if g['id'] == record.get('goal_id')), None)
            require(goal is not None, 'unknown goal')
            ledger = decode_json(git(root, 'show', f'{args.policy_commit}:work/accepted-goals.json').encode())
            accepted = {g['goal_id'] for g in ledger['acceptances'] if g['state'] == 'accepted'}
            binding = {
                'candidate_sha': source['candidate_commit'], 'base_sha': args.policy_commit,
                'configuration_sha256': configuration_digest(root), 'clean': True,
                'goal_id': goal['id'], 'worktree': str(root), 'branch': git(root, 'branch', '--show-current').strip(),
                'dependencies_accepted': set(goal['depends_on']) <= accepted,
                'previously_accepted_source': next((g['source_commit'] for g in ledger['acceptances']
                                                   if g['goal_id'] == goal['id'] and g['state'] == 'accepted'), None),
                'change_class': 'bootstrap_development' if goal['milestone'] == 'M00' else 'product',
                'changed_paths': git(root, 'diff', '--name-only', args.policy_commit, 'HEAD').splitlines(),
            }
            output = assess_checkpoint(record, decode_json(raw), binding, attestations)
        else:
            require(not any((args.policy_commit, args.policy_sha256, args.attestations, args.attestations_sha256)),
                    'checkpoint options require --checkpoint')
        print(json.dumps(output, indent=2))
        return 0
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        print(json.dumps({'result': 'blocked', 'reason': str(exc), 'execution_authorized': False}, indent=2))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
