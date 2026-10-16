#!/usr/bin/env python3
"""Run ordinary native test runners, then validate their nonempty exact inventory."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
CANARY='rifare-test-secret-canary-never-publish'
MANIFEST='tests/fixtures/harness/test-manifest.v1.json'


def digest(data: bytes) -> str: return hashlib.sha256(data).hexdigest()


def clean_environment(source, scratch: Path):
    env={k:v for k,v in source.items() if k in ('PATH','SystemRoot','WINDIR','COMSPEC')}
    home=scratch/'home'; home.mkdir(exist_ok=True)
    env.update({'HOME':str(home),'TMPDIR':str(scratch),'TMP':str(scratch),'TEMP':str(scratch),
                'TZ':'UTC','LANG':'C.UTF-8','LC_ALL':'C.UTF-8','NODE_ENV':'test',
                'PYTHONHASHSEED':'0','TEST_SECRET_CANARY':CANARY})
    return env


def secret_values(source):
    return [CANARY]+[v for k,v in source.items() if re.search(r'(TOKEN|SECRET|PASSWORD|API_KEY)',k,re.I) and len(v)>=8]


def redact(text, secrets):
    for value in sorted(set(secrets),key=len,reverse=True): text=text.replace(value,'[REDACTED_TEST_SECRET]')
    return text


def validate_native(xml: str, expected: list[str], exit_code: int):
    if not expected or len(set(expected))!=len(expected): raise ValueError('invalid or empty expected test inventory')
    if exit_code: raise ValueError('native runner failed')
    if '<!DOCTYPE' in xml.upper() or '<!ENTITY' in xml.upper(): raise ValueError('unsafe native XML')
    try: root=ET.fromstring(xml)
    except ET.ParseError as exc: raise ValueError('invalid native XML') from exc
    if root.tag not in ('testsuites','testsuite'): raise ValueError('unexpected native report root')
    cases=list(root.iter('testcase'))
    ids=[c.attrib.get('name','').split()[0] if c.attrib.get('name','').split() else '' for c in cases]
    if not ids: raise ValueError('zero tests executed')
    if len(ids)!=len(set(ids)): raise ValueError('duplicate test IDs')
    if set(ids)!=set(expected): raise ValueError('missing or unexpected test IDs')
    if any(c.find(tag) is not None for c in cases for tag in ('failure','error','skipped')): raise ValueError('failed, skipped, or incomplete tests')
    for suite in [e for e in root.iter() if e.tag in ('testsuite','testsuites')]:
        for attr in ('failures','errors','skipped','disabled'):
            if attr in suite.attrib and suite.attrib[attr]!='0': raise ValueError('native suite reports unsuccessful tests')
        if 'tests' in suite.attrib and int(suite.attrib['tests'])!=len(list(suite.iter('testcase'))): raise ValueError('inconsistent native counts')
    if any(c.attrib.get(key, '0') not in ('0', 'false') for c in cases for key in ('failure','error','skipped')): raise ValueError('unsuccessful native case attribute')
    if any(c.attrib.get('status','') in ('skipped','notrun','disabled','todo') for c in cases): raise ValueError('incomplete native case status')
    return {'executed':len(ids),'passed':len(ids),'failed':0,'skipped':0,'case_ids':ids}


def inspect_output(stdout, stderr, expected, exit_code, secrets):
    combined=stdout+'\n'+stderr
    if any(v and v in combined for v in secrets): raise ValueError('secret canary or sensitive environment value in test output')
    if 'RIFARE_TEST_NETWORK_DENIED' in combined: raise ValueError('test attempted unapproved network access')
    return validate_native(stdout,expected,exit_code)


def load_manifest(root: Path):
    data=json.loads((root/MANIFEST).read_text())
    if data.get('schema_version')!=1 or set(data.get('layers',{}))!={'unit','database','browser'}: raise ValueError('invalid harness manifest')
    if set(data.get('fixture_sha256',{})) != {'tests/fixtures/harness/seed.v1.json','tests/fixtures/harness/expected.v1.json'}: raise ValueError('required fixture pin missing')
    for path,sha in data['fixture_sha256'].items():
        p=Path(path)
        if p.is_absolute() or '..' in p.parts or not path.startswith('tests/fixtures/harness/'): raise ValueError('unsafe fixture path')
        if digest((root/path).read_bytes())!=sha: raise ValueError('frozen fixture digest changed')
    for layer,entry in data['layers'].items():
        ids=entry['case_ids']; path=entry['file']
        if not ids or len(ids)!=len(set(ids)): raise ValueError('empty or duplicate manifest IDs')
        if not path.startswith('tests/') or Path(path).is_absolute() or '..' in Path(path).parts or not (root/path).is_file(): raise ValueError('unsafe or missing test source')
    return data


def git_environment(source=None):
    """Bind reads to the explicit checkout, not ambient routing or replacement refs."""
    source = os.environ if source is None else source
    env = {k: v for k, v in source.items()
           if k in ('PATH', 'SystemRoot', 'WINDIR', 'COMSPEC')}
    env.update({'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1',
                'GIT_TERMINAL_PROMPT': '0', 'GIT_NO_REPLACE_OBJECTS': '1',
                'LC_ALL': 'C'})
    return env


def source_identity(root: Path):
    def git(*args):
        return subprocess.check_output(['git','--no-replace-objects','--no-optional-locks',
                                        '-c','core.fsmonitor=false','-C',str(root),*args],
                                       env=git_environment(), timeout=30)
    commit=git('rev-parse','HEAD').decode().strip()
    object_format=git('rev-parse','--show-object-format').decode().strip()
    if object_format not in ('sha1','sha256'): raise ValueError('unsupported Git object format')
    paths=set(filter(None,git('ls-files','-z').decode().split('\0')))
    tree={}
    for entry in filter(None,git('ls-tree','-r','-z','HEAD').decode().split('\0')):
        header,path=entry.split('\t',1);mode,kind,sha=header.split()
        tree[path]=(mode,kind,sha)
    changed=paths!=set(tree); h=hashlib.sha256()
    for path in sorted(paths):
        file=root/path
        if file.is_symlink() or not file.is_file():
            changed=True; data=b'UNSAFE_OR_MISSING';mode='invalid'
        else:
            data=file.read_bytes();mode='100755' if file.stat().st_mode & 0o111 else '100644'
        blob=hashlib.new(object_format,b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
        if tree.get(path)!=(mode,'blob',blob):changed=True
        h.update(path.encode()+b'\0'+mode.encode()+b'\0'+data+b'\0')
    changed=changed or bool(git('status','--porcelain'))
    return {'commit':commit,'tracked_source_sha256':h.hexdigest(),'clean':not changed}


def execute_native(root: Path, command: list[str], expected: list[str], timeout=90, browser=None, output=None, reverse=False):
    secrets=secret_values(os.environ)
    with tempfile.TemporaryDirectory(prefix='rifare-g06-test-') as temp:
        env=clean_environment(os.environ,Path(temp))
        env['RIFARE_TEST_ORDER']='reverse' if reverse else 'forward'
        if browser: env['RIFARE_TEST_BROWSER']=str(Path(browser).resolve())
        if output: env['RIFARE_TEST_OUTPUT']=str(output)
        native_path=None
        if '--test-reporter=junit' in command:
            native_path=Path(temp)/'native.xml'
            command=[x for x in command if x!='--test-reporter=junit']
            at=command.index('--test')+1
            command[at:at]=['--test-reporter=junit','--test-reporter-destination='+str(native_path),
                            '--test-reporter=tap','--test-reporter-destination=stdout']
        try:
            with subprocess.Popen(command,cwd=root,env=env,text=True,stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE,start_new_session=(os.name=='posix')) as process:
                try:
                    stdout,stderr=process.communicate(timeout=timeout)
                except subprocess.TimeoutExpired:
                    if os.name=='posix': os.killpg(process.pid,signal.SIGTERM)
                    else: process.terminate()
                    try: process.communicate(timeout=2)
                    except subprocess.TimeoutExpired:
                        if os.name=='posix': os.killpg(process.pid,signal.SIGKILL)
                        else: process.kill()
                        process.communicate()
                    raise ValueError('native test timeout; no passing result')
                result=subprocess.CompletedProcess(command,process.returncode,stdout,stderr)
        except OSError:
            raise ValueError('native runner unavailable; no passing result')
        native=native_path.read_text() if native_path and native_path.is_file() else ('' if native_path else result.stdout)
        diagnostics=(result.stdout+'\n'+result.stderr) if native_path else result.stderr
        error=None; counts=None
        try: counts=inspect_output(native,diagnostics,expected,result.returncode,secrets)
        except ValueError as exc: error=str(exc)
        # Never retain output containing inherited secrets/canaries unredacted.
        out=redact(native,secrets); err=redact(result.stderr,secrets); stdout=redact(result.stdout,secrets)
        if output:
            (output/'native.xml').write_text(out)
            (output/'native.stderr.txt').write_text(err)
            (output/'native.stdout.txt').write_text(stdout)
        record={'order':'reverse' if reverse else 'forward','command':command,'exit_code':result.returncode,'status':'passed' if error is None else 'failed',
                'native_sha256':digest(out.encode()),'diagnostics_sha256':digest((stdout+'\n'+err).encode()),'error':error,'counts':counts}
        return record


def commands_for(root: Path, manifest, layer, pattern=None, reverse=False):
    path=manifest['layers'][layer]['file']
    if layer=='browser':
        command=[sys.executable,str(root/path)]
        if pattern: command+=['--pattern',pattern]
        if reverse: command+=['--reverse']
    else:
        node=shutil.which('node')
        if not node: raise ValueError('Node is required for the diagnostic harness')
        command=[node,'--experimental-strip-types','--import',str(root/'tests/harness/network-deny.mts'),
                 '--test','--test-concurrency=1','--test-reporter=junit']
        if pattern: command+=['--test-name-pattern='+pattern]
        # Reverse is implemented by the native loader entry, not by changing expected IDs.
        command += [str(root/path)]
    return command


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--layer',choices=['unit','database','browser','all'],default='all')
    parser.add_argument('--test-name-pattern')
    parser.add_argument('--reverse',action='store_true',help='reverse layer order and browser case order')
    parser.add_argument('--output',type=Path)
    parser.add_argument('--browser-executable',type=Path)
    parser.add_argument('--require-clean',action='store_true')
    args=parser.parse_args()
    try:
        manifest=load_manifest(ROOT); start=source_identity(ROOT)
        if args.require_clean and not start['clean']: raise ValueError('candidate is dirty')
        output=args.output or ROOT/'evidence'/'M00-G06'/('run-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
        output=output.absolute()
        relative=output.relative_to(ROOT)
        if relative.parts[0] not in ('evidence','test-results'): raise ValueError('reports must be in ignored evidence or test-results')
        current=ROOT
        for part in relative.parts:
            current=current/part
            if part in ('..','.') or current.is_symlink(): raise ValueError('unsafe output path')
        output.mkdir(parents=True,exist_ok=False)
        layers=['unit','database','browser'] if args.layer=='all' else [args.layer]
        if args.reverse: layers.reverse()
        browser=args.browser_executable or shutil.which('chromium') or shutil.which('chromium-browser')
        report={'goal':'M00-G06','qualification':'diagnostic_only_not_target_stack',
                'full_goal_accepted':False,'source':start,'fixture_sha256':manifest['fixture_sha256'],
                'started_at':datetime.now(timezone.utc).isoformat(),'layers':{}}
        for layer in layers:
            target=output/layer;target.mkdir()
            command=commands_for(ROOT,manifest,layer,args.test_name_pattern,args.reverse)
            result=execute_native(ROOT,command,manifest['layers'][layer]['case_ids'],browser=browser,output=target,reverse=args.reverse)
            report['layers'][layer]=result
            print(f"{layer}: {result['status']} ({(result['counts'] or {}).get('executed',0)} verified tests)",flush=True)
            if result['error']: print(result['error'],file=sys.stderr)
        if source_identity(ROOT)!=start: raise ValueError('source changed during native execution')
        report['finished_at']=datetime.now(timezone.utc).isoformat()
        report['status']='passed' if all(r['status']=='passed' for r in report['layers'].values()) else 'failed'
        (output/'results.json').write_text(json.dumps(report,indent=2)+'\n')
        print('Report: '+str(output.relative_to(ROOT)))
        return 0 if report['status']=='passed' else 1
    except (ValueError,OSError,KeyError,subprocess.SubprocessError,json.JSONDecodeError) as exc:
        print('FAIL: '+str(exc),file=sys.stderr);return 1

if __name__=='__main__': raise SystemExit(main())
