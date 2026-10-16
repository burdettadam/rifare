import test from 'node:test';import assert from 'node:assert/strict';import { promisify } from 'node:util';import { execFile } from 'node:child_process';import { fileURLToPath } from 'node:url';
import { useAgent } from './agent-helpers.mts';
const execute=promisify(execFile),browser=fileURLToPath(new URL('../browser/configuration_component.py',import.meta.url));
async function run(f:any,scenario:string){const r=await execute('python3',[browser],{env:{PATH:process.env.PATH,HOME:process.env.HOME,RIFARE_TEST_BROWSER:process.env.RIFARE_BROWSER_EXECUTABLE??'/usr/bin/chromium',RIFARE_TEST_INPUT:JSON.stringify({url:f.server.url,bearer:f.a.bearer,scenario})},timeout:20000});const report=JSON.parse(r.stdout);assert.equal(report.passed,true);assert.equal(report.browser_network_requests,0);return report;}
test('M02-G06-BROWSER-KEYBOARD-EDIT-SIMULATE',()=>useAgent(f=>run(f,'edit')));
test('M02-G06-BROWSER-UNDO-DIGEST',()=>useAgent(f=>run(f,'undo')));
test('M02-G06-BROWSER-REVIEW-NOT-PUBLISH',()=>useAgent(f=>run(f,'review')));
test('M02-G06-BROWSER-LOGOUT-CLEARS',()=>useAgent(f=>run(f,'logout')));
test('M02-G06-BROWSER-DENIED-CLEARS',()=>useAgent(f=>run(f,'denied')));
test('M02-G06-BROWSER-TEXT-NOT-HTML',()=>useAgent(f=>run(f,'injection')));
test('M02-G06-BROWSER-MOBILE-NO-OVERFLOW',()=>useAgent(f=>run(f,'mobile')));
