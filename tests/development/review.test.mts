import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mts';
import { configuration } from '../../packages/development/config.mts';
import { SmokeStore } from '../../packages/development/store.mts';

function setup() {
  const f = fixture();
  const store = new SmokeStore(configuration(f.root, {}), true);
  store.enqueue({ id: 'review-job', value: 'synthetic' });
  return { store, close() { store.close(); f.cleanup(); } };
}

test('REVIEW-LEASE-01 expired failure cannot terminate recoverable work', () => {
  const f = setup();
  try {
    const job = f.store.claim(1000, 100)!;
    assert.equal(f.store.fail(job, 1101), false);
    assert.equal(f.store.state().jobs[0].state, 'running');
    assert.equal(f.store.state().jobs[0].failure_code, null);
  } finally { f.close(); }
});

test('REVIEW-LEASE-02 expired failure leaves work reclaimable and completable', () => {
  const f = setup();
  try {
    const old = f.store.claim(1000, 100)!;
    f.store.fail(old, 1101);
    const next = f.store.claim(1101, 1000)!;
    assert.ok(next, 'an expired owner must not turn retryable work into terminal failure');
    assert.notEqual(next.lease_owner, old.lease_owner);
    f.store.finish(next, 1102);
    assert.equal(f.store.state().jobs[0].state, 'completed');
    assert.equal(f.store.state().jobs[0].attempts, 2);
  } finally { f.close(); }
});

test('REVIEW-LEASE-03 reclaimed owner cannot fail the replacement lease', () => {
  const f = setup();
  try {
    const old = f.store.claim(1000, 100)!;
    const next = f.store.claim(1101, 1000)!;
    assert.equal(f.store.fail(old, 1102), false);
    assert.equal(f.store.state().jobs[0].state, 'running');
    f.store.finish(next, 1102);
    assert.equal(f.store.state().jobs[0].state, 'completed');
  } finally { f.close(); }
});

test('REVIEW-LEASE-04 current unexpired owner records an actual local failure', () => {
  const f = setup();
  try {
    const job = f.store.claim(1000, 1000)!;
    assert.equal(f.store.fail(job, 1001), true);
    assert.equal(f.store.state().jobs[0].state, 'failed');
    assert.equal(f.store.state().jobs[0].failure_code, 'LOCAL_EFFECT_FAILED');
    assert.equal(f.store.claim(3000), undefined);
  } finally { f.close(); }
});

test('REVIEW-LEASE-05 duplicate failure is a no-op rather than a new transition', () => {
  const f = setup();
  try {
    const job = f.store.claim(1000, 1000)!;
    assert.equal(f.store.fail(job, 1001), true);
    const state = f.store.state();
    assert.equal(f.store.fail(job, 1002), false);
    assert.deepEqual(f.store.state(), state);
  } finally { f.close(); }
});

test('REVIEW-LEASE-06 completed work cannot be changed to failed', () => {
  const f = setup();
  try {
    const job = f.store.claim(1000, 1000)!;
    f.store.finish(job, 1001);
    assert.equal(f.store.fail(job, 1002), false);
    assert.equal(f.store.state().jobs[0].state, 'completed');
    assert.equal(JSON.parse(f.store.readAttachment('review-job')).value, 'synthetic');
  } finally { f.close(); }
});

test('REVIEW-LEASE-07 failure uses the same inclusive expiry boundary as completion', () => {
  const f = setup();
  try {
    const job = f.store.claim(1000, 100)!;
    assert.equal(f.store.fail(job, 1100), true);
    assert.equal(f.store.state().jobs[0].state, 'failed');
  } finally { f.close(); }
});

test('REVIEW-LEASE-08 default clock cannot let an expired worker fail a job', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const f = setup();
  try {
    const job = f.store.claim(1000, 100)!;
    t.mock.timers.setTime(1101);
    assert.equal(f.store.fail(job), false);
    assert.equal(f.store.state().jobs[0].state, 'running');
  } finally { f.close(); }
});
