import test from 'node:test';
import assert from 'node:assert/strict';
import { usingInstant, oracle, captureCount, authorizeMandate, releaseReplacement } from './instant-helpers.mts';

test('CASE-M06-G09-01',()=>usingInstant(async f=>{
 const operation=await authorizeMandate(f),view=f.instant.read(f.a.scope,operation.id);
 assert.equal(view.state,'mandate_active');
 assert.equal(view.source.maximum_minor,oracle.original_paid_minor);
 assert.equal(view.source.terms_digest,f.terms.digest);
 assert.equal(view.source.expires_at,f.startedAt+oracle.mandate_lifetime_ms);
 assert.equal(view.source.release.state,'none');
 assert.equal(captureCount(f),0);
 const binding=f.instant.binding(f.a.scope,f.exchange.id);
 assert.equal(binding.instant_exchange.allocation_id,f.allocation.id);
 await releaseReplacement(f,binding);
 assert.equal(f.source.obligation(f.obligationId).release.state,'confirmed');
}));

test('CASE-M06-G09-02',()=>usingInstant(f=>{
 f.source.qualifyAccount({...f.account,revision:2,mandates:false});
 assert.throws(()=>f.instant.quoteAuthorize(f.a.scope,f.authorizeInput()),/INSTANT_ACCOUNT_UNQUALIFIED|INSTANT_CONFIGURATION_CHANGED/);
 assert.equal(captureCount(f),0);
 assert.equal(f.source.db.prepare('SELECT count(*) n FROM fixture_instant_obligations').get().n,0);
}));

test('CASE-M06-G09-03',()=>usingInstant(async f=>{
 const consent=f.consent({id:'lower_consent',maximum_minor:oracle.lower_consent_ceiling_minor});
 await authorizeMandate(f,consent.id);
 const b=f.instant.binding(f.a.scope,f.exchange.id);
 assert.equal(b.instant_exchange.maximum_minor,oracle.lower_consent_ceiling_minor);
 assert.throws(()=>f.source.assertReplacement(f.replacementCommand({...b.instant_exchange,maximum_minor:oracle.original_paid_minor}),{...b.instant_exchange,maximum_minor:oracle.original_paid_minor}),/INSTANT_BINDING_CHANGED/);
 f.source.publishTerms({...f.termsInput,version:2,maximum_minor:'4000'});
 assert.throws(()=>f.instant.binding(f.a.scope,f.exchange.id),/INSTANT_TERMS_CHANGED/);
 assert.equal(captureCount(f),0);
}));

test('M06-G09-SAVED-CARD-IS-NOT-CONSENT',()=>usingInstant(f=>{
 assert.throws(()=>f.instant.quoteAuthorize(f.a.scope,{...f.authorizeInput(),consent_id:'saved_card_token'}),/INSTANT_CONSENT_REQUIRED/);
 assert.throws(()=>f.instant.quoteAuthorize(f.a.scope,{...f.authorizeInput(),card_token:'saved_card_token'}),/INVALID_INPUT/);
 assert.equal(f.source.db.prepare('SELECT count(*) n FROM fixture_instant_obligations').get().n,0);
}));

test('M06-G09-CUSTOMER-CANNOT-SELF-AUTHORIZE',()=>usingInstant(f=>{
 assert.throws(()=>f.instant.quoteAuthorize(f.customer,f.authorizeInput()),/ACCESS_DENIED|NOT_FOUND/);
 const q=f.instant.quoteAuthorize(f.a.scope,f.authorizeInput()),p=f.gateway.prepare(f.a.scope,q.proposal);
 assert.throws(()=>f.gateway.approve(f.a.scope,{preview_id:p.id,preview_digest:p.digest}),/ACCESS_DENIED|SELF_APPROVAL_DENIED/);
 assert.equal(captureCount(f),0);
}));

test('M06-G09-REVOKED-CONSENT-BEFORE-DISPATCH',()=>usingInstant(async f=>{
 const q=f.instant.quoteAuthorize(f.a.scope,f.authorizeInput()),op=f.authorize(q);
 f.source.revokeConsent('consent_one');
 await assert.rejects(f.instant.dispatch(f.a.scope,op.id),/INSTANT_CONSENT_REVOKED/);
 assert.equal(f.source.db.prepare('SELECT count(*) n FROM fixture_instant_obligations').get().n,0);
}));

test('M06-G09-NATIVE-COMMAND-BINDING-PREVENTS-DOWNGRADE',()=>usingInstant(async f=>{
 const issue=f.source.issue.bind(f.source);
 f.source.issue=async command=>issue({...command,operation_id:'forged_operation',maximum_minor:'999999',consent_id:'saved_card_token'});
 const op=await authorizeMandate(f,undefined,'unknown');
 assert.equal(f.instant.read(f.a.scope,op.id).state,'unknown');
 assert.equal(f.source.db.prepare('SELECT count(*) n FROM fixture_instant_obligations').get().n,0);
 assert.equal(captureCount(f),0);
}));

test('M06-G09-CROSS-TENANT-MANDATE-HIDDEN',()=>usingInstant(async f=>{
 const op=await authorizeMandate(f);
 assert.throws(()=>f.instant.read(f.b.scope,op.id),/NOT_FOUND/);
 assert.throws(()=>f.instant.quoteAuthorize(f.b.scope,f.authorizeInput()),/NOT_FOUND/);
 assert.throws(()=>f.instant.configure(f.customer,{enabled:true,expected_revision:1,source_identity:f.source.identity,account_id:'account_one',expires_at:f.now()+100000}),/ACCESS_DENIED/);
}));

test('M06-G09-MISSING-OR-EXPIRED-TERMS-DISABLED',()=>usingInstant(f=>{
 f.advance(oracle.mandate_lifetime_ms+1);
 assert.throws(()=>f.instant.quoteAuthorize(f.a.scope,f.authorizeInput()),/INSTANT_CONSENT_EXPIRED|INSTANT_MANDATE_EXPIRED|EXCHANGE_QUOTE_CHANGED/);
 assert.equal(captureCount(f),0);
}));

test('M06-G09-UNKNOWN-MANDATE-DOES-NOT-RELEASE',()=>usingInstant(async f=>{
 f.source.fault='after';
 const op=await authorizeMandate(f,undefined,'unknown');
 assert.throws(()=>f.instant.binding(f.a.scope,f.exchange.id),/INSTANT_MANDATE_UNCONFIRMED/);
 assert.equal(f.source.obligation(f.obligationId).release.state,'none');
 assert.equal((await f.instant.reconcile(f.a.scope,op.id)).state,'mandate_active');
 assert.equal(f.instant.binding(f.a.scope,f.exchange.id).instant_exchange.maximum_minor,oracle.original_paid_minor);
}));
