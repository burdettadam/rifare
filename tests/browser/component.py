"""Native unittest browser-component cases; no served application or real API."""
from __future__ import annotations
import argparse
from copy import deepcopy
from datetime import datetime, timezone
from importlib.metadata import version
import io
import json
import os
from pathlib import Path
import re
import sys
import time
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
SEED = json.loads((ROOT / 'tests/fixtures/harness/seed.v1.json').read_text())


class FixtureBoundary:
    """Fake response boundary. Requests are recorded; no socket is opened."""
    def __init__(self, merchant='merchant-alpha', unavailable=False):
        self.data = deepcopy(next(m for m in SEED['merchants'] if m['id'] == merchant))
        self.unavailable = unavailable
        self.requests = []
        self.violations = []
        self.jobs = []

    def state(self):
        return {'instance_id': self.data['id'], 'profile': 'smoke-sqlite',
                'worker_last_seen': SEED['frozen_epoch_ms'], 'commerce_qualified': False,
                'migrations': [{'version': '001_fixture'}],
                'markers': sorted(self.data['markers'], key=lambda x: x['id']),
                'jobs': deepcopy(self.jobs)}

    def request(self, _source, path, options):
        method = options.get('method', 'GET')
        self.requests.append((method, path))
        if method == 'GET' and path == '/api/dev/state':
            return {'status': 503 if self.unavailable else 200, 'body': self.state()}
        if method == 'POST' and path in ('/api/dev/markers', '/api/dev/jobs'):
            value = json.loads(options.get('body', '{}'))
            if set(value) != {'id', 'value'}:
                self.violations.append('unexpected payload'); return {'status': 400, 'body': {'error': 'INVALID_FIXTURE'}}
            if path.endswith('markers'):
                self.data['markers'].append(value)
            else:
                self.jobs.append({**value, 'state': 'pending', 'attempts': 0})
            return {'status': 201, 'body': {'synthetic': True}}
        self.violations.append('unapproved fake request')
        return {'status': 403, 'body': {'error': 'RIFARE_TEST_NETWORK_DENIED'}}


class BrowserCases(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if version('playwright') != '1.57.0':
            raise RuntimeError('BLOCKED: browser profile requires host Playwright 1.57.0')
        from playwright.sync_api import sync_playwright
        cls.playwright = sync_playwright().start()
        try:
            executable = os.environ.get('RIFARE_TEST_BROWSER')
            cls.browser = cls.playwright.chromium.launch(
                executable_path=executable, headless=True,
                env={k: v for k, v in os.environ.items() if k in ('PATH','HOME','TMPDIR','TMP','TEMP','SystemRoot','WINDIR','LANG','TZ')})
            cls.browser_version = cls.browser.version
        except Exception:
            cls.playwright.stop(); raise

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(service_workers='block', viewport={'width': 1360, 'height': 1000})
        self.network_violations = []
        def deny(route):
            self.network_violations.append('unexpected browser request'); route.abort('blockedbyclient')
        self.context.route('**/*', deny)
        def deny_socket(route):
            self.network_violations.append('unexpected browser websocket'); route.close()
        self.context.route_web_socket('**/*', deny_socket)
        self.page = self.context.new_page()
        self.page_errors = []
        self.page.on('pageerror', lambda _error: self.page_errors.append('browser page error'))
        self.boundary = FixtureBoundary()
        self.page.expose_binding('__rifare_fixture_fetch', self.boundary.request)

    def mount(self):
        html = (ROOT / 'apps/web/index.html').read_text()
        script = '<script type="module" src="/smoke.js"></script>'
        style = '<link rel="stylesheet" href="/style.css">'
        self.assertEqual(html.count(script), 1); self.assertEqual(html.count(style), 1)
        self.page.set_content(html.replace(script, '').replace(style, ''))
        self.page.add_style_tag(content=(ROOT / 'apps/web/style.css').read_text())
        self.page.clock.set_fixed_time(datetime.fromtimestamp(SEED['frozen_epoch_ms']/1000, tz=timezone.utc))
        self.page.evaluate('''() => { window.fetch = async (path, options={}) => {
            const result = await window.__rifare_fixture_fetch(String(path), options);
            return new Response(JSON.stringify(result.body), {status: result.status,
                headers: {'content-type': 'application/json'}});
        }; }''')
        self.page.evaluate('(async () => {\n' + (ROOT / 'apps/web/smoke.js').read_text() + '\n})()')

    def tearDown(self):
        try:
            self.assertEqual(self.network_violations, [], 'unapproved browser egress')
            self.assertEqual(self.boundary.violations, [], 'unapproved fake-provider request')
            self.assertEqual(self.page_errors, [], 'browser script failure')
        finally:
            self.context.close()

    def test_clean_source_render(self):
        """CASE-M00-G06-01/browser unchanged source renders the frozen synthetic facts."""
        self.mount()
        self.assertEqual(self.page.title(), 'Rifare · Development workspace')
        self.assertEqual(self.page.locator('#api').inner_text(), 'Ready')
        self.assertEqual(self.page.locator('#worker').inner_text(), 'Running')
        self.assertEqual(self.page.locator('#marker-rows').inner_text(), 'shared-order\tALPHA')
        self.assertEqual(self.page.evaluate('Date.now()'), SEED['frozen_epoch_ms'])
        self.assertIn('PostgreSQL / React qualification is pending', self.page.locator('.notice').inner_text())
        target = os.environ.get('RIFARE_TEST_OUTPUT')
        if target:
            self.page.screenshot(path=str(Path(target)/'browser-component.png'), full_page=True)

    def test_save_marker_through_browser_events(self):
        """BROWSER-01 form interactions produce the expected synthetic boundary request."""
        self.mount()
        self.page.get_by_label('Marker ID', exact=True).fill('added-marker')
        self.page.get_by_label('Value', exact=True).fill('synthetic addition')
        self.page.get_by_role('button', name='Save marker', exact=True).click()
        self.page.wait_for_function("document.getElementById('marker-count').textContent === '2 records'")
        self.assertIn(('POST','/api/dev/markers'), self.boundary.requests)
        self.assertIn('added-marker\tsynthetic addition', self.page.locator('#marker-rows').inner_text())

    def test_queue_is_not_reported_as_settled(self):
        """BROWSER-02 a fake enqueue is shown as pending, never as real completion."""
        self.mount()
        self.page.get_by_label('Marker ID', exact=True).fill('queued-marker')
        self.page.get_by_label('Value', exact=True).fill('test queue')
        self.page.get_by_role('button', name='Queue attachment', exact=True).click()
        self.page.wait_for_function("document.getElementById('job-count').textContent === '1 jobs'")
        self.assertIn('pending', self.page.locator('#job-rows').inner_text())
        self.assertEqual(self.page.locator('#job-rows a').count(), 0)

    def test_provider_failure_is_visible(self):
        """BROWSER-03 an unavailable fake API produces a visible failure state."""
        self.boundary.unavailable=True; self.mount()
        self.assertEqual(self.page.locator('#api').inner_text(), 'Unavailable')
        self.assertTrue(self.page.get_by_role('alert').is_visible())
        self.assertEqual(self.page.locator('#worker').inner_text(), 'Unknown')

    def test_text_is_not_executed(self):
        """BROWSER-04 fixture strings are rendered as text instead of executable markup."""
        value='<img src="https://unexpected.example.invalid/" onerror="window.injected=1">'
        self.boundary.data['markers'][0]['value']=value
        self.mount()
        self.assertEqual(self.page.locator('#marker-rows img').count(), 0)
        self.assertIn(value, self.page.locator('#marker-rows').inner_text())
        self.assertIsNone(self.page.evaluate('window.injected'))

    def test_second_merchant_starts_with_its_own_seed(self):
        """CASE-M00-G06-03/browser fresh context uses Beta data despite colliding IDs."""
        self.boundary.data=deepcopy(SEED['merchants'][1]); self.mount()
        self.assertEqual(self.page.locator('#marker-rows').inner_text(), 'shared-order\tBETA')
        self.assertNotIn('ALPHA', self.page.locator('#marker-rows').inner_text())
        self.assertEqual(self.page.locator('#instance').inner_text(), 'merchant-beta')


class JUnitResult(unittest.TestResult):
    def __init__(self):
        super().__init__(); self.records=[]; self.starts={}
    def startTest(self, test):
        super().startTest(test); self.starts[id(test)]=time.monotonic()
    def record(self, test, kind=None, text=''):
        case_id=(test.shortDescription() or str(test)).split()[0]
        self.records.append((case_id,kind,text,time.monotonic()-self.starts.get(id(test),time.monotonic())))
    def addSuccess(self,test): super().addSuccess(test); self.record(test)
    def addFailure(self,test,err): super().addFailure(test,err); self.record(test,'failure',self._exc_info_to_string(err,test))
    def addError(self,test,err): super().addError(test,err); self.record(test,'error',self._exc_info_to_string(err,test))
    def addSkip(self,test,reason): super().addSkip(test,reason); self.record(test,'skipped',reason)
    def addExpectedFailure(self,test,err): super().addExpectedFailure(test,err); self.record(test,'skipped','expected failure is not qualification')
    def addUnexpectedSuccess(self,test): super().addUnexpectedSuccess(test); self.record(test,'failure','unexpected success')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pattern'); parser.add_argument('--reverse',action='store_true')
    args=parser.parse_args()
    cases=list(unittest.defaultTestLoader.loadTestsFromTestCase(BrowserCases))
    if args.pattern: cases=[t for t in cases if re.search(args.pattern,t.shortDescription() or str(t))]
    if args.reverse: cases.reverse()
    result=JUnitResult(); unittest.TestSuite(cases).run(result)
    suite=ET.Element('testsuite',name='Rifare browser component',tests=str(result.testsRun),failures=str(len(result.failures)),errors=str(len(result.errors)),skipped=str(len(result.skipped)))
    props=ET.SubElement(suite,'properties')
    ET.SubElement(props,'property',name='browser_version',value=getattr(BrowserCases,'browser_version','unavailable'))
    ET.SubElement(props,'property',name='qualification',value='in_memory_source_component_not_served_end_to_end')
    for name,kind,text,duration in result.records:
        element=ET.SubElement(suite,'testcase',name=name,time=str(max(0,duration)),classname='BrowserCases')
        if kind: ET.SubElement(element,kind).text=text
    print(ET.tostring(suite,encoding='unicode'))
    return 0 if cases and result.testsRun==len(cases) and result.wasSuccessful() and not result.skipped else 1

if __name__=='__main__': raise SystemExit(main())
