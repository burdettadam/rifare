"""Regression assertions for native selection, fixture pins, egress and evidence."""
from __future__ import annotations
from copy import deepcopy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('rifare_native_harness',ROOT/'tools/test_harness.py')
H=importlib.util.module_from_spec(spec);spec.loader.exec_module(H)


def xml(ids=('A','B'), extra='', attrs=''):
    return '<testsuite '+attrs+'>'+''.join('<testcase name="'+x+'">'+extra+'</testcase>' for x in ids)+'</testsuite>'


class NativeReportTests(unittest.TestCase):
    def test_nonempty_exact_inventory_passes(self): self.assertEqual(H.validate_native(xml(),['A','B'],0)['executed'],2)
    def test_empty_native_report_fails(self):
        with self.assertRaisesRegex(ValueError,'zero tests'): H.validate_native(xml(()),['A'],0)
    def test_empty_expected_inventory_fails(self):
        with self.assertRaisesRegex(ValueError,'empty expected'): H.validate_native(xml(),[],0)
    def test_missing_case_fails(self):
        with self.assertRaisesRegex(ValueError,'missing'): H.validate_native(xml(('A',)),['A','B'],0)
    def test_extra_case_fails(self):
        with self.assertRaisesRegex(ValueError,'unexpected'): H.validate_native(xml(),['A'],0)
    def test_duplicate_actual_case_fails(self):
        with self.assertRaisesRegex(ValueError,'duplicate'): H.validate_native(xml(('A','A')),['A'],0)
    def test_duplicate_expected_case_fails(self):
        with self.assertRaisesRegex(ValueError,'expected'): H.validate_native(xml(('A',)),['A','A'],0)
    def test_skipped_case_is_not_pass(self):
        with self.assertRaisesRegex(ValueError,'skipped'): H.validate_native(xml(extra='<skipped/>'),['A','B'],0)
    def test_failed_case_cannot_be_hidden_by_success_exit(self):
        with self.assertRaisesRegex(ValueError,'failed'): H.validate_native(xml(extra='<failure/>'),['A','B'],0)
    def test_error_case_cannot_be_hidden(self):
        with self.assertRaisesRegex(ValueError,'failed'): H.validate_native(xml(extra='<error/>'),['A','B'],0)
    def test_nonzero_exit_cannot_be_hidden_by_clean_report(self):
        with self.assertRaisesRegex(ValueError,'runner failed'): H.validate_native(xml(),['A','B'],1)
    def test_inconsistent_count_fails(self):
        with self.assertRaisesRegex(ValueError,'inconsistent'): H.validate_native(xml(attrs='tests="100"'),['A','B'],0)
    def test_report_level_failure_fails(self):
        with self.assertRaisesRegex(ValueError,'unsuccessful'): H.validate_native(xml(attrs='failures="1"'),['A','B'],0)
    def test_testsuites_aggregate_failure_is_not_ignored(self):
        with self.assertRaisesRegex(ValueError,'unsuccessful'): H.validate_native('<testsuites failures="1">'+xml()+'</testsuites>',['A','B'],0)
    def test_notrun_attribute_fails(self):
        with self.assertRaisesRegex(ValueError,'incomplete'): H.validate_native('<testsuite><testcase name="A" status="notrun"/></testsuite>',['A'],0)
    def test_malformed_xml_fails(self):
        with self.assertRaisesRegex(ValueError,'invalid native'): H.validate_native('<broken>',['A'],0)
    def test_entity_declaration_fails(self):
        with self.assertRaisesRegex(ValueError,'unsafe native'): H.validate_native('<!DOCTYPE x []>'+xml(),['A','B'],0)
    def test_caught_network_violation_still_fails(self):
        with self.assertRaisesRegex(ValueError,'network access'): H.inspect_output(xml(),'RIFARE_TEST_NETWORK_DENIED',['A','B'],0,[])
    def test_secret_in_stdout_fails_and_redacts(self):
        with self.assertRaisesRegex(ValueError,'secret'): H.inspect_output(xml()+H.CANARY,'',['A','B'],0,[H.CANARY])
        self.assertNotIn(H.CANARY,H.redact(xml()+H.CANARY,[H.CANARY]))
    def test_secret_in_stderr_fails(self):
        with self.assertRaisesRegex(ValueError,'secret'): H.inspect_output(xml(),H.CANARY,['A','B'],0,[H.CANARY])


class EnvironmentAndManifestTests(unittest.TestCase):
    def test_ambient_secrets_and_preload_options_are_not_forwarded(self):
        with tempfile.TemporaryDirectory() as t:
            env=H.clean_environment({'PATH':'/bin','OPENAI_API_KEY':'real-not-used','DATABASE_URL':'not-used','NODE_OPTIONS':'untrusted','PYTHONPATH':'untrusted','HTTPS_PROXY':'untrusted','HOME':'/not-owned'},Path(t))
            for name in ['OPENAI_API_KEY','DATABASE_URL','NODE_OPTIONS','PYTHONPATH','HTTPS_PROXY']: self.assertNotIn(name,env)
            self.assertEqual(env['HOME'],str(Path(t)/'home'));self.assertEqual(env['TZ'],'UTC')
    def test_reports_are_bound_to_fixed_fixture_bytes(self):
        m=H.load_manifest(ROOT);self.assertEqual(len(m['layers']['unit']['case_ids']),15)
        self.assertEqual(len(m['layers']['database']['case_ids']),7);self.assertEqual(len(m['layers']['browser']['case_ids']),6)
    def temporary_source(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);root=Path(temp.name)
        for name in ['tests/fixtures/harness','tests/harness','tests/browser']:
            shutil.copytree(ROOT/name,root/name,ignore=shutil.ignore_patterns('__pycache__'))
        return root
    def test_changed_seed_is_rejected(self):
        root=self.temporary_source();p=root/'tests/fixtures/harness/seed.v1.json';p.write_text(p.read_text().replace('ALPHA','ALTERED'))
        with self.assertRaisesRegex(ValueError,'fixture digest'): H.load_manifest(root)
    def test_changed_independent_oracle_is_rejected(self):
        root=self.temporary_source();p=root/'tests/fixtures/harness/expected.v1.json';p.write_text(p.read_text()+' ')
        with self.assertRaisesRegex(ValueError,'fixture digest'): H.load_manifest(root)
    def test_removing_a_pin_is_not_an_exemption(self):
        root=self.temporary_source();p=root/H.MANIFEST;d=json.loads(p.read_text());d['fixture_sha256'].pop('tests/fixtures/harness/seed.v1.json');p.write_text(json.dumps(d))
        with self.assertRaisesRegex(ValueError,'pin missing'): H.load_manifest(root)
    def test_missing_layer_is_rejected(self):
        root=self.temporary_source();p=root/H.MANIFEST;d=json.loads(p.read_text());del d['layers']['browser'];p.write_text(json.dumps(d))
        with self.assertRaisesRegex(ValueError,'manifest'): H.load_manifest(root)
    def test_path_traversal_is_rejected(self):
        root=self.temporary_source();p=root/H.MANIFEST;d=json.loads(p.read_text());d['layers']['unit']['file']='tests/../private.py';p.write_text(json.dumps(d))
        with self.assertRaisesRegex(ValueError,'source'): H.load_manifest(root)


class NativeProcessTests(unittest.TestCase):
    def probe(self,body,pattern=None,guard=True):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);p=root/'probe.mts'
            p.write_text("import test from 'node:test'; import assert from 'node:assert/strict';\n"+body)
            command=[shutil.which('node'),'--experimental-strip-types']
            if guard:command+=['--import',str(ROOT/'tests/harness/network-deny.mts')]
            command+=['--test','--test-reporter=junit']
            if pattern:command+=['--test-name-pattern='+pattern]
            command+=[str(p)]
            return H.execute_native(root,command,['PROBE'],output=root)
    def test_native_zero_match_cannot_pass(self):
        """CASE-M00-G06-02 and CASE-M00-G06-03: selection must actually run required tests."""
        result=self.probe("test('PROBE runs an assertion',()=>assert.equal(1,1));",pattern='NO_MATCH_AT_ALL')
        self.assertEqual(result['status'],'failed');self.assertIsNone(result['counts'])
    def test_known_native_case_executes(self):
        result=self.probe("test('PROBE runs an assertion',()=>assert.equal(1,1));")
        self.assertEqual(result['status'],'passed');self.assertEqual(result['counts']['executed'],1)
    def test_ambient_canary_is_not_inherited(self):
        with patch.dict(os.environ,{'SECRET_TOKEN':'parent-only-synthetic-secret','NODE_OPTIONS':'--invalid-preload'}):
            result=self.probe("test('PROBE checks child environment',()=>{assert.equal(process.env.SECRET_TOKEN,undefined);assert.equal(process.env.NODE_OPTIONS,undefined);});")
        self.assertEqual(result['status'],'passed')
    def test_child_secret_logging_is_not_passing_evidence(self):
        result=self.probe("test('PROBE leaks only the test canary',()=>{console.error(process.env.TEST_SECRET_CANARY);assert.equal(1,1);});")
        self.assertEqual(result['status'],'failed');self.assertIn('secret',result['error'])
    def test_caught_fetch_attempt_fails_and_never_hits_the_trap(self):
        hits=[]
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self): hits.append(True);self.send_response(200);self.end_headers();self.wfile.write(b'unexpected')
            def log_message(self,*args): pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            result=self.probe(f"test('PROBE catches forbidden fetch',async()=>{{try{{await fetch('http://127.0.0.1:{server.server_port}/effect');}}catch{{}} assert.equal(1,1);}});")
            self.assertEqual(result['status'],'failed');self.assertIn('network',result['error']);self.assertEqual(hits,[])
        finally:server.shutdown();server.server_close();thread.join()
    def test_raw_tcp_attempt_is_also_denied(self):
        result=self.probe("import net from 'node:net'; test('PROBE catches raw TCP',()=>{try{net.connect(9,'127.0.0.1');}catch{}assert.equal(1,1);});")
        self.assertEqual(result['status'],'failed');self.assertIn('network',result['error'])
    def test_lookup_attempt_is_also_denied(self):
        result=self.probe("import dns from 'node:dns';test('PROBE catches lookup',()=>{try{dns.lookup('localhost',()=>{});}catch{}assert.equal(1,1);});")
        self.assertEqual(result['status'],'failed');self.assertIn('network',result['error'])
    def test_native_assertion_failure_is_reported(self):
        result=self.probe("test('PROBE assertion fails',()=>assert.equal(1,2));")
        self.assertEqual(result['status'],'failed')
    def test_timeout_is_a_failure_and_owned_process_is_reaped(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);pidfile=root/'pid';command=[sys.executable,'-c',f"import os,time,pathlib;pathlib.Path({str(pidfile)!r}).write_text(str(os.getpid()));time.sleep(30)"]
            with self.assertRaisesRegex(ValueError,'timeout'):H.execute_native(root,command,['PROBE'],timeout=2)
            pid=int(pidfile.read_text())
            if os.name=='posix':
                with self.assertRaises(ProcessLookupError):os.kill(pid,0)


class CandidateIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.git('init','-q');self.git('config','user.name','Rifare Fixture');self.git('config','user.email','fixture@example.invalid')
        (self.root/'sample.txt').write_text('accepted\n');self.git('add','.');self.git('commit','-qm','Synthetic source baseline')
    def tearDown(self):self.temp.cleanup()
    def git(self,*args):
        return subprocess.check_output(['git','-c','core.hooksPath=/dev/null','-C',str(self.root),*args],stderr=subprocess.DEVNULL)
    def test_clean_identity_is_repeatable(self):
        first=H.source_identity(self.root);self.assertTrue(first['clean']);self.assertEqual(first,H.source_identity(self.root))
    def test_hidden_worktree_changes_are_not_clean(self):
        self.git('update-index','--skip-worktree','sample.txt');(self.root/'sample.txt').write_text('hidden modification\n')
        self.assertEqual(self.git('status','--porcelain'),b'');self.assertFalse(H.source_identity(self.root)['clean'])
    def test_index_and_worktree_cannot_self_approve_new_source(self):
        (self.root/'new.txt').write_text('uncommitted\n');self.git('add','new.txt');self.assertFalse(H.source_identity(self.root)['clean'])
