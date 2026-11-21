/** Test-only native fixture. No public provisioning or substitute successful facts. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openCheckoutFixture, readCheckoutFixtureSnapshot } from '../../packages/development/delegated-checkout-fixture.mts';

export async function reviewFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'rifare-checkout-review-'));
  const instanceId = 'checkout-review';
  let fixture: Awaited<ReturnType<typeof openCheckoutFixture>> | undefined;
  let closed = false;
  try {
    fixture = await openCheckoutFixture(directory, instanceId, 'fresh');
    const credentials = fixture.ready.credentials!;
    assert.equal(fixture.ready.intent_count, 0);
    const original = Object.freeze({ preview_id: credentials.primary.preview_id, context_id: credentials.primary.context_id });
    const pending = Object.freeze({ preview_id: credentials.pending.preview_id, context_id: credentials.pending.context_id });
    const inspect = () => {
      const db = new DatabaseSync(join(directory, 'commerce.sqlite'), { readOnly: true });
      try {
        return db.prepare("SELECT body FROM commerce_support_documents WHERE kind='delegated_checkout_intent' ORDER BY id")
          .all().map(row => JSON.parse(String(row.body)));
      } finally { db.close(); }
    };
    const effects = fixture.ready.effects_digest;
    let url = fixture.ready.url;
    const request = (operation: string, input?: unknown, bearer = credentials.bearer) => fetch(
      url + (operation.startsWith('/') ? operation : '/v1/delegated-checkout/' + operation), {
        method: input === undefined ? 'GET' : 'POST',
        headers: { ...(bearer ? { authorization: 'Bearer ' + bearer } : {}),
          ...(input === undefined ? {} : { 'content-type': 'application/json' }) },
        body: input === undefined ? undefined : JSON.stringify(input), signal: AbortSignal.timeout(4000),
      });
    return {
      get url() { return url; }, original, pending, bearer: credentials.bearer, inspect, request,
      async restartHistory() {
        assert.equal(closed, false);
        await fixture!.close();
        fixture = await openCheckoutFixture(directory, instanceId, 'history');
        url = fixture.ready.url;
        assert.equal(fixture.ready.credentials, undefined);
      },
      async close(expectedIntents: number) {
        if (closed) return; closed = true;
        await fixture!.close();
        const after = readCheckoutFixtureSnapshot(directory, instanceId);
        assert.equal(after.intent_count, expectedIntents);
        assert.equal(after.effects_digest, effects);
      },
      async dispose() {
        if (!closed) { closed = true; await fixture!.close(); }
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await fixture?.close(); rmSync(directory, { recursive: true, force: true }); throw error;
  }
}

export async function usingReview<T>(run: (fixture: Awaited<ReturnType<typeof reviewFixture>>) => Promise<T>): Promise<T> {
  const fixture = await reviewFixture();
  try { return await run(fixture); } finally { await fixture.dispose(); }
}
