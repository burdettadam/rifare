import { nativeReceiptFixture } from './delegated-receipt-native-helpers.mts';
import { DelegatedCheckoutIntents } from '../../packages/commerce/delegated-checkout-intents.mts';
import { INTENT_KIND, intentRecords } from '../../packages/commerce/delegated-checkout-intent-records.mts';

export async function intentFixture(options: Parameters<typeof nativeReceiptFixture>[0] = {}) {
  const f = await nativeReceiptFixture(options);
  try {
    const intents = new DelegatedCheckoutIntents(f.kernel, f.receiptOwner);
    const request = { preview_id: f.request.preview_id, context_id: f.request.context_id };
    const intent = intents.prepare(f.customer, request);
    return { ...f, intents, intent, intentRequest: request,
      get context() { return f.context; }, get verifyCalls() { return f.verifyCalls; },
      record: () => intentRecords(f.kernel).find(r => r.body.id === intent.intent_id)!,
      capture: () => intents.verifyReceipt(f.customer, { intent_id: intent.intent_id, compact_jws: f.token }),
      intentRows: () => f.db.prepare('SELECT * FROM commerce_support_documents WHERE kind=?').all(INTENT_KIND),
    };
  } catch (error) { f.cleanup(); throw error; }
}
export async function usingIntent(fn: (f: Awaited<ReturnType<typeof intentFixture>>) => unknown,
  options: Parameters<typeof intentFixture>[0] = {}) {
  const f = await intentFixture(options); try { await fn(f); } finally { f.cleanup(); }
}
