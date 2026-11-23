import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { discoveryPath } from "@medusajs/medusa/payment";

/** Real native provider registration/preparation and fail-closed component tests.
 * No permissive substitute gate is installed to manufacture an authorization. */
export default async function verifyFencedSystemProvider({ container }: ExecArgs) {
  assert.equal(process.env.NODE_ENV, "test"); assert.equal(process.env.RIFARE_COMMERCE_VERIFY, "disposable");
  assert.equal(process.env.RIFARE_TEST_NATIVE_EXECUTION, "fenced-system");
  const payments: any = container.resolve(Modules.PAYMENT), postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const require = createRequire(discoveryPath), Native = require(resolve(dirname(discoveryPath), "providers/system.js")).SystemPaymentProvider;
  const methods = ["initiatePayment", "authorizePayment", "capturePayment", "refundPayment", "cancelPayment", "deletePayment", "updatePayment", "retrievePayment", "getPaymentStatus"];
  const original = new Map<string, any>(), counts = Object.fromEntries(methods.map(name => [name, 0]));
  for (const method of methods) {
    assert.equal(typeof Native.prototype[method], "function"); original.set(method, Native.prototype[method]);
    Native.prototype[method] = async function (...args: any[]) { counts[method]++; return original.get(method).apply(this, args); };
  }
  const checks: string[] = [];
  const check = async (name: string, run: () => Promise<void>) => { await run(); checks.push(name); console.log("C12_PROVIDER_CHECK " + name); };
  const snapshot = async () => {
    const values: Record<string, unknown> = {};
    for (const table of ["payment_collection", "payment_session", "payment", "capture", "refund"])
      values[table] = await postgres(table).orderBy("id");
    return createHash("sha256").update(JSON.stringify(values)).digest("hex");
  };
  const refusedWithoutEffects = async (run: () => Promise<unknown>) => {
    const before = await snapshot(), calls = { ...counts }; await assert.rejects(run());
    assert.equal(await snapshot(), before); assert.deepEqual(counts, calls, "Refusal must happen before any native System delegate call");
  };
  try {
    const providers = await payments.listPaymentProviders({});
    for (const id of ["pp_system_default", "pp_rifare_fenced_system_fixture"]) assert.ok(providers.some((row: any) => row.id === id && row.is_enabled));
    const legacyCollection = (await payments.createPaymentCollections([{ currency_code: "usd", amount: 1 }]))[0];
    const legacy = await payments.createPaymentSession(legacyCollection.id, { provider_id: "pp_system_default", currency_code: "usd", amount: 1, data: {} });
    const native = await payments.authorizePaymentSession(legacy.id, {}); assert.ok(native?.id);
    await check("C12-PROVIDER-LEGACY native System identity and positive authorization stay unchanged", async () => {
      assert.equal(counts.authorizePayment, 1); assert.equal(counts.initiatePayment, 1);
      assert.equal((await postgres("payment").where({ id: native.id }).first()).provider_id, "pp_system_default");
    });
    const collection = (await payments.createPaymentCollections([{ currency_code: "usd", amount: 1 }]))[0];
    const session = await payments.createPaymentSession(collection.id, { provider_id: "pp_rifare_fenced_system_fixture", currency_code: "usd", amount: 1,
      data: { session_id: "payses_forged", rifare_native_execution: { profile: "forged", handle: "0".repeat(64), session_id: "payses_forged" } } });
    await check("C12-PROVIDER-PREPARE supported distinct adapter delegates native preparation and overwrites claimed correlation", async () => {
      assert.equal(counts.initiatePayment, 2);
      assert.equal(session.provider_id, "pp_rifare_fenced_system_fixture");
      assert.equal(session.data.rifare_native_execution.profile, "urn:rifare:local-fenced-system-correlation:v1");
      assert.equal(session.data.rifare_native_execution.session_id, session.id);
      assert.match(session.data.rifare_native_execution.handle, /^[a-f0-9]{64}$/);
      assert.notEqual(session.data.rifare_native_execution.handle, "0".repeat(64));
    });
    await check("C12-PROVIDER-MISSING-GATE absent original worker/journal enforcement refuses before native authorization", async () => {
      assert.equal((await postgres.raw("select to_regprocedure('public.rifare_require_native_execution_payment(text,text,text)') as gate")).rows[0].gate, null);
      await refusedWithoutEffects(() => payments.authorizePaymentSession(session.id, {}));
      await refusedWithoutEffects(() => payments.authorizePaymentSession(session.id, { idempotency_key: legacy.id, verified: true, worker_role: "forged", generation: 999 }));
      assert.equal((await postgres("payment_session").where({ id: session.id }).first()).status, "pending");
      assert.equal((await postgres("payment").where({ payment_session_id: session.id })).length, 0);
    });
    const provider = payments.paymentProviderService_.retrieveProvider("pp_rifare_fenced_system_fixture");
    await check("C12-PROVIDER-SHAPE caller claims malformed handles and a foreign original are never authority", async () => {
      for (const data of [{}, { rifare_native_execution: { ...session.data.rifare_native_execution, handle: "invalid" } },
        { rifare_native_execution: { ...session.data.rifare_native_execution, verified: true } },
        { rifare_native_execution: { ...session.data.rifare_native_execution, original_command_id: "00000000-0000-0000-0000-000000000000" } }])
        await refusedWithoutEffects(() => provider.authorizePayment({ data, context: { verified: true } }));
    });
    await check("C12-PROVIDER-UNSUPPORTED no unapproved capture refund cancel status or compensation delegation", async () => {
      for (const name of ["capturePayment", "refundPayment", "cancelPayment", "deletePayment", "updatePayment", "retrievePayment", "getPaymentStatus", "getWebhookActionAndData"])
        await refusedWithoutEffects(() => provider[name]({ data: session.data, amount: 1 }));
    });
    await check("C12-PROVIDER-PROFILE normal or retired qualification profile cannot call the adapter", async () => {
      const previous = process.env.RIFARE_TEST_NATIVE_EXECUTION;
      delete process.env.RIFARE_TEST_NATIVE_EXECUTION;
      try { await refusedWithoutEffects(() => provider.authorizePayment({ data: session.data, context: {} })); }
      finally { process.env.RIFARE_TEST_NATIVE_EXECUTION = previous; }
    });
    console.log("C12_FENCED_SYSTEM_PROVIDER_RESULT=" + JSON.stringify({ result: "pass", checks,
      actual_native_system_calls: counts, native_authorization_gate_implemented: false, execution_owner_qualified: false,
      early_native_write_fence_qualified: false, connected_authority_qualified: false, production_qualified: false }));
  } finally { for (const [method, implementation] of original) Native.prototype[method] = implementation; }
}
