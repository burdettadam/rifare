#!/usr/bin/env python3
"""Pinned, read-only regression controller using native test runners.

Pins must be retained outside candidate control. This is not a sandbox, signature
verifier, reviewer identity service, goal-acceptance authority or release system.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
from typing import Any

# When exported, these imports resolve to pinned sibling files, never the candidate.
from check_regression_inventory import check_inventory
import test_harness as native

REGISTRY = 'planning/regression-registry.json'
CONTROL_FILES = ('regression_gate.py', 'unittest_report.py', 'check_regression_inventory.py', 'test_harness.py')
SUITES = ('python', 'runtime', 'unit', 'database', 'browser')
QUALIFICATIONS = ('accepted_bootstrap', 'retained_diagnostic_not_accepted', 'proposed_not_accepted')
MAX_BYTES = 16 * 1024 * 1024


def sha(data: bytes) -> str: return hashlib.sha256(data).hexdigest()

def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def decode(data: bytes):
    if len(data) > MAX_BYTES: raise ValueError('oversized control document')
    def pairs(items):
        result = {}
        for k,v in items:
            if k in result: raise ValueError('duplicate JSON key')
            result[k] = v
        return result
    return json.loads(data, object_pairs_hook=pairs)


def relative(value: str) -> str:
    if not isinstance(value, str) or not value or '\\' in value or ':' in value or any(ord(x) < 32 for x in value):
        raise ValueError('unsafe relative path')
    p = PurePosixPath(value)
    if p.is_absolute() or str(p) != value or any(x in ('..', '.', '.git') for x in p.parts):
        raise ValueError('unsafe relative path')
    return value


def regular(path: Path) -> bytes:
    if path.is_symlink() or any(p.is_symlink() for p in path.parents) or not path.is_file():
        raise ValueError('control/source path is not a regular non-symlink file')
    data = path.read_bytes()
    if len(data) > MAX_BYTES: raise ValueError('oversized file')
    return data


def outside(path: Path, root: Path):
    absolute = path.absolute()
    if path.is_symlink() or any(p.is_symlink() for p in absolute.parents): raise ValueError('symlink control boundary')
    if absolute.resolve().is_relative_to(root.resolve()): raise ValueError('control/output must be outside candidate checkout')


def commit_id(value: str):
    if not isinstance(value, str) or re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', value) is None:
        raise ValueError('full immutable commit identity required; branch names are not pins')
    return value


def git(root: Path, *args) -> bytes:
    env = native.git_environment()
    return subprocess.check_output(['git','--no-optional-locks','-c','core.fsmonitor=false',
                                    '-C',str(root),*args], env=env, stderr=subprocess.PIPE, timeout=30)


def git_files(root: Path, commit: str):
    commit_id(commit)
    if git(root, 'rev-parse', commit+'^{commit}').decode().strip() != commit: raise ValueError('not a commit')
    result = {}
    for line in git(root,'ls-tree','-rz',commit).split(b'\0'):
        if not line: continue
        head, raw = line.split(b'\t',1); mode,kind,blob = head.decode().split()
        path = relative(raw.decode())
        if kind != 'blob' or mode not in ('100644','100755'): raise ValueError('links/submodules are not supported source')
        result[path] = {'mode':mode,'blob':blob}
    return result


def read_blob(root, commit, path): return git(root, 'show', commit+':'+relative(path))


def validate_registry(r):
    if not isinstance(r,dict) or r.get('schema_version') != 1 or r.get('id') != 'rifare-regression-registry':
        raise ValueError('invalid registry')
    if r.get('qualification') != 'local_development_only_not_product_acceptance': raise ValueError('qualification scope mismatch')
    caps = r.get('capabilities',[]); tests = r.get('tests',[])
    if not caps or not tests: raise ValueError('empty regression registration')
    cap_ids = set()
    for c in caps:
        if c.get('id') in cap_ids or not isinstance(c.get('id'),str) or not c['id']: raise ValueError('duplicate/missing capability')
        cap_ids.add(c['id'])
        if c.get('enabled') is not True or c.get('qualification') not in QUALIFICATIONS: raise ValueError('disabled/invalid capability')
        if not c.get('contract_files'): raise ValueError('missing capability contract')
        for p in c['contract_files']: relative(p)
    ids=set(); natives=set()
    for t in tests:
        nid=t.get('runner_case_id'); suite=t.get('suite'); ident=t.get('id')
        if suite not in SUITES or not isinstance(nid,str) or not nid or len(nid.split()) != 1: raise ValueError('invalid native test identity')
        if ident != suite+':'+nid or ident in ids or (suite,nid) in natives: raise ValueError('duplicate/reidentified test identity')
        ids.add(ident); natives.add((suite,nid))
        if t.get('capability_id') not in cap_ids: raise ValueError('orphan capability')
        path=relative(t.get('source'))
        if suite=='python' and not (path.startswith('tests/test_') and path.endswith('.py')): raise ValueError('invalid Python test source')
        if suite=='runtime' and not (path.startswith('tests/development/') and path.endswith('.test.mts')): raise ValueError('invalid runtime source')
        fixed={'unit':'tests/harness/unit.test.mts','database':'tests/harness/database.test.mts','browser':'tests/browser/component.py'}
        if suite in fixed and path!=fixed[suite]: raise ValueError('invalid fixed harness source')
    if {t['capability_id'] for t in tests} != cap_ids: raise ValueError('capability has no executable obligations')
    paths=r.get('protected_files',[])
    if len(paths)!=len(set(paths)): raise ValueError('duplicate protected path')
    for p in paths: relative(p)
    for field in ('source_count_fixture','source_inventory'):
        if r.get(field) is not None: relative(r[field])
    if bool(r.get('source_count_fixture')) != bool(r.get('source_inventory')): raise ValueError('partial source inventory configuration')
    return r


def protected_digest(path, data, registry):
    if path == registry.get('source_count_fixture'):
        obj=decode(data); obj.pop('source_file_count',None); obj.pop('source_count_reason',None)
        return sha(canonical(obj))
    return sha(data)


def snapshot(root: Path, commit: str):
    files=git_files(root,commit)
    registry=validate_registry(decode(read_blob(root,commit,REGISTRY)))
    paths=set(registry['protected_files']) | {t['source'] for t in registry['tests']}
    paths |= {p for c in registry['capabilities'] for p in c['contract_files']}
    if not paths.issubset(files): raise ValueError('missing protected source in commit')
    contents={p:read_blob(root,commit,p) for p in paths}
    protected={p:{'mode':files[p]['mode'],'sha256':protected_digest(p,contents[p],registry)} for p in sorted(paths)}
    caps=[]
    for c in registry['capabilities']:
        digest=sha(canonical({'contract':c,'files':{p:protected[p] for p in c['contract_files']}}))
        caps.append({'id':c['id'],'enabled':True,'contract_digest':digest})
    capmap={c['id']:c for c in caps}
    tests=[{'id':t['id'],'contract_digest':sha(canonical(t)),
            'test_source_digest':protected[t['source']]['sha256'],
            'oracle_digest':capmap[t['capability_id']]['contract_digest']} for t in registry['tests']]
    return {'schema_version':1,'kind':'retained_development_baseline_not_acceptance',
            'commit':commit,'tree':git(root,'rev-parse',commit+'^{tree}').decode().strip(),
            'registry':registry,'source_paths':sorted(files),'protected_files':protected,
            'test_obligations':tests,'capabilities':caps}


def load_baseline(path: Path, expected: str, root: Path):
    outside(path,root)
    data=regular(path)
    if re.fullmatch('[0-9a-f]{64}',expected or '') is None or sha(data)!=expected: raise ValueError('trusted baseline SHA-256 mismatch')
    obj=decode(data)
    if obj.get('schema_version')!=1 or obj.get('kind')!='retained_development_baseline_not_acceptance': raise ValueError('invalid baseline kind')
    commit_id(obj.get('commit')); validate_registry(obj['registry'])
    if not obj.get('test_obligations') or not obj.get('protected_files'): raise ValueError('empty trusted baseline')
    return obj


def compare(baseline, candidate):
    errors=[]; review=[]
    old=baseline['registry']; new=candidate['registry']
    for field in ('source_count_fixture','source_inventory'):
        if new.get(field)!=old.get(field): errors.append('retained inventory configuration changed: '+field)
    oldtests={t['id']:t for t in old['tests']}; newtests={t['id']:t for t in new['tests']}
    oldcaps={c['id']:c for c in old['capabilities']}; newcaps={c['id']:c for c in new['capabilities']}
    for ident,item in oldtests.items():
        if newtests.get(ident)!=item: errors.append('retained test registration missing/reidentified/changed: '+ident)
    for ident,item in oldcaps.items():
        if newcaps.get(ident)!=item: errors.append('retained capability removed/changed: '+ident)
    if not set(baseline['source_paths']).issubset(candidate['source_paths']): errors.append('retained source removed')
    for path,pin in baseline['protected_files'].items():
        if candidate['protected_files'].get(path)!=pin: review.append(path)
    return {'errors':errors,'review_required_paths':sorted(review),
            'added_test_ids':sorted(set(newtests)-set(oldtests)),
            'added_capabilities':sorted(set(newcaps)-set(oldcaps)),
            'added_source_paths':sorted(set(candidate['source_paths'])-set(baseline['source_paths']))}


def validate_membership(root, candidate):
    r=candidate['registry']; count_path=r.get('source_count_fixture')
    if count_path:
        count=decode(read_blob(root,candidate['commit'],count_path))
        if type(count.get('source_file_count')) is not int or count['source_file_count']!=len(candidate['source_paths']): raise ValueError('source count differs from actual committed membership')
        if not isinstance(count.get('source_count_reason'),str) or not count['source_count_reason'].strip(): raise ValueError('missing source extension explanation')
        inv=decode(read_blob(root,candidate['commit'],r['source_inventory']))
        members=[p for c in inv['components'] for p in c['files']]
        if len(members)!=len(set(members)) or set(members)!=set(candidate['source_paths']): raise ValueError('source inventory does not exactly match commit')


def inspect_checkout(root, commit):
    root=root.resolve(); commit_id(commit)
    if git(root,'rev-parse','--show-toplevel').decode().strip()!=str(root): raise ValueError('candidate must be the exact worktree root')
    tracked=set(git_files(root,commit))
    identity=native.source_identity(root)
    if not identity['clean'] or identity['commit']!=commit: raise ValueError('candidate is dirty or does not match pinned commit')
    for prefix in ('tests','tools','apps','packages'):
        directory=root/prefix
        if directory.is_dir():
            for p in directory.rglob('*'):
                rel=p.relative_to(root).as_posix()
                if '__pycache__' in p.parts: continue
                if p.is_symlink(): raise ValueError('untracked source symlink')
                if p.is_file() and rel not in tracked: raise ValueError('ignored/untracked executable input: '+rel)
    return identity


def controller_digest(directory: Path):
    return sha(canonical({p:sha(regular(directory/p)) for p in CONTROL_FILES}))


def export_control(root, source_commit, baseline_commit, output):
    outside(output,root)
    commit_id(source_commit); commit_id(baseline_commit)
    baseline=snapshot(root,baseline_commit)
    bodies={p:read_blob(root,source_commit,'tools/'+p) for p in CONTROL_FILES}
    output.mkdir(parents=True,exist_ok=False)
    for p,data in bodies.items(): (output/p).write_bytes(data)
    data=canonical(baseline)+b'\n'; (output/'baseline.json').write_bytes(data)
    pins={'source_commit':source_commit,'baseline_commit':baseline_commit,'baseline_sha256':sha(data),
          'controller_sha256':controller_digest(output),'baseline_test_count':len(baseline['test_obligations']),
          'scope':'local_development_rehearsal_not_hosted_protection_or_acceptance'}
    (output/'pins.json').write_text(json.dumps(pins,indent=2)+'\n')
    return pins


def expected_by_suite(registry):
    return {suite:[t['runner_case_id'] for t in registry['tests'] if t['suite']==suite]
            for suite in SUITES if any(t['suite']==suite for t in registry['tests'])}


def command_for(suite, root, registry, controller, browser):
    if suite=='python': return [sys.executable,'-I',str(controller/'unittest_report.py'),'--root',str(root)]
    if suite=='browser': return [sys.executable,'-I',str(root/'tests/browser/component.py')]
    node=shutil.which('node')
    if not node: raise ValueError('Node unavailable')
    cmd=[node,'--experimental-strip-types']
    if suite in ('unit','database'): cmd+=['--import',str(root/'tests/harness/network-deny.mts')]
    cmd+=['--test','--test-concurrency=1','--test-reporter=junit']
    cmd += [str(root/p) for p in sorted({t['source'] for t in registry['tests'] if t['suite']==suite})]
    return cmd


def run_gate(root, commit, baseline_path, baseline_sha, controller, control_sha, output, browser=None):
    root=root.resolve(); controller=controller.resolve()
    outside(controller,root); outside(output,root)
    if output.resolve().is_relative_to(controller): raise ValueError('results must not overwrite controller inputs')
    if controller_digest(controller)!=control_sha: raise ValueError('trusted controller SHA-256 mismatch')
    baseline=load_baseline(baseline_path,baseline_sha,root)
    before=inspect_checkout(root,commit)
    try:
        git(root, 'merge-base', '--is-ancestor', baseline['commit'], commit)
    except subprocess.CalledProcessError as exc:
        raise ValueError('candidate does not descend from trusted baseline') from exc
    current=snapshot(root,commit); validate_membership(root,current)
    delta=compare(baseline,current)
    output.mkdir(parents=True,exist_ok=False)
    report={'goal':'M00-G07','status':'blocked','qualification':'local_development_only_not_product_acceptance',
            'goal_accepted':False,'release_authorized':False,'source':before,'baseline_commit':baseline['commit'],
            'baseline_sha256':baseline_sha,'controller_sha256':control_sha,
            'configuration_digest':sha(canonical({'registry':current['registry'],'controller':control_sha,'baseline':baseline_sha})),
            'started_at':datetime.now(timezone.utc).isoformat(),'changes':delta,'layers':{},'errors':list(delta['errors'])}
    if delta['review_required_paths']:
        report['errors'].append('independent regression review and targeted fault proof required; no candidate approval override')
    if not report['errors']:
        for suite,ids in expected_by_suite(current['registry']).items():
            target=output/suite;target.mkdir()
            cmd=command_for(suite,root,current['registry'],controller,browser)
            result=native.execute_native(root,cmd,ids,timeout=240,browser=browser,output=target)
            report['layers'][suite]=result
            print(suite+': '+result['status'],flush=True)
        failed=[s for s,r in report['layers'].items() if r['status']!='passed']
        if failed: report['errors'].append('native execution failed: '+','.join(failed))
        else:
            results=[]
            for suite,r in report['layers'].items():
                results += [{'id':suite+':'+tid,'status':'passed','runner_case_id':suite+':'+tid} for tid in r['counts']['case_ids']]
            configuration=report['configuration_digest']
            current.update(candidate_sha=commit,configuration_digest=configuration)
            normalized={'candidate_sha':commit,'configuration_digest':configuration,'command':['pinned-native-controller'],
                        'native_report_sha256':sha(canonical(report['layers'])),'exit_code':0,'executed_count':len(results),
                        'failed_count':0,'skipped_required_count':0,'tests':results}
            report['errors']+=check_inventory(baseline,current,normalized,commit)
            report['executed_test_count']=len(results)
    if inspect_checkout(root,commit)!=before: report['errors'].append('source changed during execution')
    if sha(regular(baseline_path))!=baseline_sha or controller_digest(controller)!=control_sha:
        report['errors'].append('trusted inputs changed during execution')
    report['status']='passed' if not report['errors'] else 'blocked'
    report['finished_at']=datetime.now(timezone.utc).isoformat()
    (output/'results.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


def main():
    ap=argparse.ArgumentParser(description=__doc__); sub=ap.add_subparsers(dest='action',required=True)
    p=sub.add_parser('export',help='export pinned source; not approval or acceptance')
    p.add_argument('--root',type=Path,required=True);p.add_argument('--source-commit',required=True)
    p.add_argument('--baseline-commit',required=True);p.add_argument('--output',type=Path,required=True)
    p=sub.add_parser('run',help='run from separately pinned exported controller only')
    p.add_argument('--root',type=Path,required=True);p.add_argument('--candidate-sha',required=True)
    p.add_argument('--baseline',type=Path,required=True);p.add_argument('--baseline-sha256',required=True)
    p.add_argument('--controller-sha256',required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--browser-executable',type=Path)
    args=ap.parse_args()
    try:
        if args.action=='export':
            result=export_control(args.root.resolve(),args.source_commit,args.baseline_commit,args.output.absolute());ok=True
        else:
            controller=Path(__file__).resolve().parent
            result=run_gate(args.root.resolve(),args.candidate_sha,args.baseline,args.baseline_sha256,controller,
                            args.controller_sha256,args.output.absolute(),args.browser_executable or shutil.which('chromium'))
            ok=result['status']=='passed'
        print(json.dumps(result,indent=2));return 0 if ok else 1
    except (ValueError,KeyError,TypeError,OSError,subprocess.SubprocessError) as exc:
        print(json.dumps({'status':'blocked','goal_accepted':False,'error':str(exc)},indent=2));return 1


if __name__=='__main__': raise SystemExit(main())
