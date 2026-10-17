import test from 'node:test';
import assert from 'node:assert/strict';
import { usingInstant, oracle, captureCount, authorizeMandate, releaseReplacement } from './instant-helpers.mts';
import { canonical,contentDigest } from '../../packages/commerce/configuration-values.mts';

test('CASE-M06-G10-01',()=>usingInstant(async f=>{
 await authorizeMandate(f);await releaseReplacement(f);
 f.source.confirmReceived(f.received('return_one',[1]));f.advance(oracle.trial_ms+1);
 const q=f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId});
 assert.equal(q.quote.amount_minor,oracle.one_return_capture_minor);
 const op=f.authorize(q),r=await f.instant.dispatch(f.a.scope,op.id);
 assert.equal(r.state,'captured');assert.equal(r.source.captured_minor,oracle.one_return_capture_minor);
 assert.equal(captureCount(f),oracle.expected_capture_effects);
}));

test('CASE-M06-G10-02',()=>usingInstant(async f=>{
 await authorizeMandate(f);await releaseReplacement(f);f.advance(oracle.mandate_lifetime_ms+1);
 assert.throws(()=>f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}),/INSTANT_REAUTHORIZATION_REQUIRED/);
 assert.equal(captureCount(f),0);
 const consent=f.consent({id:'reauth_consent',reauthorization_of:f.obligationId,mandate_expires_at:f.now()+90000,consent_expires_at:f.now()+90000});
 const q=f.instant.quoteReauthorize(f.a.scope,{obligation_id:f.obligationId,consent_id:consent.id}),op=f.authorize(q);
 assert.equal((await f.instant.dispatch(f.a.scope,op.id)).state,'mandate_active');
 const capture=f.authorize(f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}));
 assert.equal((await f.instant.dispatch(f.a.scope,capture.id)).source.captured_minor,oracle.full_capture_minor);
 assert.equal(captureCount(f),1);
}));

test('CASE-M06-G10-03',()=>usingInstant(async f=>{
 await authorizeMandate(f);await releaseReplacement(f);f.advance(oracle.trial_ms+1);
 const op=f.authorize(f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}));
 const issue=f.source.issue.bind(f.source);let sends=0;
 f.source.issue=async command=>{sends++;f.source.confirmReceived(f.received('raced_return',[1]));await issue(command);throw new Error('accepted capture response lost');};
 assert.equal((await f.instant.dispatch(f.a.scope,op.id)).state,'unknown');
 assert.equal(captureCount(f),1);
 assert.equal(f.source.db.prepare('SELECT captured_minor FROM fixture_instant_captures').get().captured_minor,oracle.one_return_capture_minor);
 f.advance(7*86400000);f.refreshSessions();
 await f.instant.dispatch(f.a.scope,op.id);assert.equal(sends,1);
 const r=await f.instant.reconcile(f.a.scope,op.id);assert.equal(r.state,'captured');
 assert.equal(r.source.captured_minor,oracle.one_return_capture_minor);assert.equal(captureCount(f),1);
}));

test('M06-G10-CAPTURE-BEFORE-DEADLINE-REJECTED',()=>usingInstant(async f=>{
 await authorizeMandate(f);await releaseReplacement(f);
 assert.throws(()=>f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}),/INSTANT_TRIAL_ACTIVE/);assert.equal(captureCount(f),0);
}));

test('M06-G10-ALL-RETURNED-NO-CAPTURE',()=>usingInstant(async f=>{
 await authorizeMandate(f);await releaseReplacement(f);f.source.confirmReceived(f.received('all_returned',[1,2,3]));f.advance(oracle.trial_ms+1);
 assert.throws(()=>f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}),/INSTANT_NOT_COLLECTIBLE/);assert.equal(captureCount(f),0);
 assert.equal(f.source.obligation(f.obligationId).remaining_minor,oracle.all_return_capture_minor);
}));

test('M06-G10-CANCEL-BEFORE-RELEASE-WAIVES-OBLIGATION',()=>usingInstant(async f=>{
 await authorizeMandate(f);const op=f.authorize(f.instant.quoteCancel(f.a.scope,{obligation_id:f.obligationId}));
 assert.equal((await f.instant.dispatch(f.a.scope,op.id)).state,'canceled');
 assert.throws(()=>f.instant.binding(f.a.scope,f.exchange.id),/INSTANT_MANDATE_INACTIVE/);f.advance(oracle.trial_ms+1);
 assert.throws(()=>f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}),/INSTANT_MANDATE_INACTIVE/);assert.equal(captureCount(f),0);
}));

test('M06-G10-RESERVED-RELEASE-BLOCKS-CAPTURE-AND-CANCEL',()=>usingInstant(async f=>{
 await authorizeMandate(f);const binding=f.instant.binding(f.a.scope,f.exchange.id).instant_exchange,cmd=f.replacementCommand(binding);
 f.source.reserveReplacement(cmd,binding);f.advance(oracle.trial_ms+1);
 assert.throws(()=>f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}),/INSTANT_RELEASE_UNCONFIRMED/);
 assert.throws(()=>f.instant.quoteCancel(f.a.scope,{obligation_id:f.obligationId}),/INSTANT_RELEASE_UNRESOLVED/);
 assert.equal(f.source.obligation(f.obligationId).release.state,'reserved');assert.equal(captureCount(f),0);
}));

test('M06-G10-RETURN-AFTER-CAPTURE-RETAINS-COMPENSATION',()=>usingInstant(async f=>{
 await authorizeMandate(f);await releaseReplacement(f);f.advance(oracle.trial_ms+1);
 const op=f.authorize(f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}));await f.instant.dispatch(f.a.scope,op.id);
 f.source.confirmReceived(f.received('late_return',[1]));f.source.confirmReceived(f.received('late_return',[1]));
 const native=f.source.obligation(f.obligationId);assert.equal(native.captured_minor,oracle.full_capture_minor);
 assert.equal(native.compensation_required_minor,oracle.late_return_compensation_minor);assert.equal(captureCount(f),1);
}));

test('M06-G10-REVOKED-CONSENT-CANNOT-CAPTURE',()=>usingInstant(async f=>{
 await authorizeMandate(f);await releaseReplacement(f);f.advance(oracle.trial_ms+1);
 const op=f.authorize(f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}));f.source.revokeConsent('consent_one');
 await assert.rejects(f.instant.dispatch(f.a.scope,op.id),/INSTANT_CONSENT_REVOKED/);assert.equal(captureCount(f),0);
}));

test('M06-G10-EXPIRY-AT-NATIVE-CAPTURE-BOUNDARY',()=>usingInstant(async f=>{
 await authorizeMandate(f);await releaseReplacement(f);f.advance(oracle.trial_ms+1);
 const op=f.authorize(f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId})),issue=f.source.issue.bind(f.source);
 f.source.issue=async command=>{f.advance(oracle.mandate_lifetime_ms);return issue(command);};
 assert.equal((await f.instant.dispatch(f.a.scope,op.id)).state,'rejected');assert.equal(captureCount(f),0);
}));

test('M06-G10-FORGED-LOCAL-MANDATE-CANNOT-RELEASE',()=>usingInstant(async f=>{
 const op=f.authorize(f.instant.quoteAuthorize(f.a.scope,f.authorizeInput()));
 f.db.prepare("UPDATE commerce_instant_operations SET state='mandate_active',native_id='forged' WHERE id=?").run(op.id);
 assert.throws(()=>f.instant.binding(f.a.scope,f.exchange.id),/INSTANT_MANDATE_UNCONFIRMED|INSTANT_SOURCE_NOT_FOUND/);
 assert.equal(captureCount(f),0);
}));
