import { declarations } from './cases.mts';
const { test, register } = declarations();
import assert from 'node:assert/strict';
import { fixture, merchantIds, seeded, frozenClock, EPOCH, EXPECTED } from './fixtures.mts';
import { fakeProvider } from './fake-provider.mts';

test('CASE-M00-G06-01/unit frozen clock and seeded values match independent facts twice', t => {
  t.mock.timers.enable({ apis: ['Date'], now: EPOCH });
  assert.equal(Date.now(), EXPECTED.epoch_ms);
  for (let i=0;i<2;i++) { const next=seeded(7); assert.deepEqual(Array.from({length:5},next),EXPECTED.seed7_u32); }
});
test('SEED-01 fixtures have two distinct merchants with deliberately colliding record IDs', () => {
  assert.deepEqual(merchantIds(),EXPECTED.merchant_ids);
  const [a,b]=merchantIds().map(fixture);
  assert.equal(a.markers[0].id,EXPECTED.shared_marker_id); assert.equal(b.markers[0].id,EXPECTED.shared_marker_id);
  assert.deepEqual([a.markers[0].value,b.markers[0].value],EXPECTED.marker_values);
});
test('SEED-02 fixture mutation cannot poison a later case', () => {
  const a=fixture('merchant-alpha'); assert.throws(()=>a.markers[0].value='changed',TypeError);
  assert.equal(fixture('merchant-alpha').markers[0].value,'ALPHA');
  assert.throws(()=>EXPECTED.seed7_u32[0]=0,TypeError);
});
test('SEED-03 unknown merchant selection fails instead of using a default', () => {
  for(const id of ['','merchant-unknown','../merchant-alpha']) assert.throws(()=>fixture(id),/UNKNOWN_FIXTURE_MERCHANT/);
});
test('SEED-04 independent seed streams do not share mutable state', () => {
  const a=seeded(7),b=seeded(7); assert.equal(a(),b()); a();a();assert.equal(b(),EXPECTED.seed7_u32[1]);
});
test('SEED-05 invalid seeds and backwards clocks are rejected', () => {
  for(const n of [-1,0.5,NaN,Infinity,2**32])assert.throws(()=>seeded(n),/INVALID_FIXTURE_SEED/);
  const clock=frozenClock();for(const n of [-1,0.5,NaN,Infinity])assert.throws(()=>clock.advance(n),/INVALID_CLOCK_ADVANCE/);
  assert.equal(clock.now(),EPOCH); assert.throws(()=>frozenClock(-1),/INVALID_FIXTURE_CLOCK/);
});
test('CLOCK-01 advancing one clock cannot advance another', () => {
  const a=frozenClock(),b=frozenClock();a.advance(5000);assert.equal(a.now(),EPOCH+5000);assert.equal(b.now(),EPOCH);
});
test('PROVIDER-01 a successful synthetic operation is idempotent', () => {
  const p=fakeProvider();const a=p.act('merchant-alpha','same','value');assert.deepEqual(p.act('merchant-alpha','same','value'),a);
  assert.equal(p.snapshot().effects.length,1);assert.equal(p.snapshot().attempts,2);assert.equal(a.accepted_at,EPOCH);
});
test('PROVIDER-02 rejection produces no accepted effect', () => {
  const p=fakeProvider(['reject']);assert.throws(()=>p.act('merchant-alpha','same','value'),/PROVIDER_REJECTED/);
  assert.equal(p.lookup('merchant-alpha','same'),null);assert.equal(p.snapshot().effects.length,0);
});
test('PROVIDER-03 acceptance followed by lost response requires reconciliation', () => {
  const p=fakeProvider(['accepted-timeout']);assert.throws(()=>p.act('merchant-alpha','same','value'),/OUTCOME_UNKNOWN/);
  assert.equal(p.lookup('merchant-alpha','same')?.state,'accepted_synthetic');
  p.act('merchant-alpha','same','value');assert.equal(p.snapshot().effects.length,1);
});
test('PROVIDER-04 a failure before acceptance is different from an unknown outcome', () => {
  const p=fakeProvider(['transient-before']);assert.throws(()=>p.act('merchant-alpha','same','value'),/BEFORE_ACCEPTANCE/);
  assert.equal(p.lookup('merchant-alpha','same'),null);p.act('merchant-alpha','same','value');assert.equal(p.snapshot().effects.length,1);
});
test('PROVIDER-05 changed payload cannot reuse an operation identity', () => {
  const p=fakeProvider();p.act('merchant-alpha','same','value');assert.throws(()=>p.act('merchant-alpha','same','other'),/IDEMPOTENCY_CONFLICT/);
  assert.equal(p.lookup('merchant-alpha','same')?.value,'value');
});
test('PROVIDER-06 same key for different merchants does not share results', () => {
  const p=fakeProvider();p.act('merchant-alpha','same','ALPHA');p.act('merchant-beta','same','BETA');
  assert.equal(p.snapshot().effects.length,2);assert.equal(p.lookup('merchant-beta','same')?.value,'BETA');
});
test('PROVIDER-07 snapshots and fault plans cannot mutate accepted source records', () => {
  const plan:any[]=['reject'];const p=fakeProvider(plan);plan[0]='success';assert.throws(()=>p.act('merchant-alpha','same','x'),/PROVIDER_REJECTED/);
  const q=fakeProvider();const receipt=q.act('merchant-alpha','same','x');receipt.value='changed';q.snapshot().effects[0].value='changed';assert.equal(q.lookup('merchant-alpha','same')?.value,'x');
  assert.throws(()=>fakeProvider(['unknown'] as any),/INVALID_FAULT_PLAN/);
});
test('ENV-01 test process receives no ambient provider credentials or preload options', () => {
  for(const name of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','AWS_SECRET_ACCESS_KEY','DATABASE_URL','SECRET_TOKEN','NODE_OPTIONS','PYTHONPATH','HTTPS_PROXY'])assert.equal(process.env[name],undefined,name);
  assert.equal(process.env.TZ,'UTC'); assert.equal(process.env.NODE_ENV,'test');
});

register();
