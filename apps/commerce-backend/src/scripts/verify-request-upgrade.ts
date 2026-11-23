import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { configure } from "safe-stable-stringify";

/** Compare only synthetic, quiescent commerce data during a paused upgrade. */
export default async function verifyRequestUpgrade({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") {
    throw new Error("RIFARE_DISPOSABLE_REQUEST_TEST_REQUIRED");
  }
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const stringify = configure({ strict: true, deterministic: true, bigint: false });
  const fields = ["request_bytes", "request_digest", "request_context_digest", "request_nonce", "request_observed_at", "request_expires_at"];
  const columns = await postgres("information_schema.columns").where({ table_schema: "public", table_name: "rifare_operation" }).whereIn("column_name", fields);
  const phase = process.env.RIFARE_C7_UPGRADE_MODE;
  assert.ok(phase === "before" || phase === "after"); assert.equal(columns.length, phase === "before" ? 0 : 6);
  const witness: Record<string, { count: number; digest: string }> = {};
  for (const table of ["cart", "cart_line_item", "order", "order_line_item", "payment", "payment_collection",
    "inventory_item", "inventory_level", "product", "store", "sales_channel", "rifare_operation", "auth_identity", "customer"]) {
    const rows = await postgres(table).orderBy("id").select("*");
    assert.ok(rows.length < 1000, "bounded synthetic upgrade witness");
    if (table === "rifare_operation") for (const row of rows) {
      if (phase === "after") for (const field of fields) assert.equal(row[field], null);
      for (const field of fields) delete row[field];
    }
    witness[table] = { count: rows.length, digest: createHash("sha256").update(stringify(rows)!).digest("hex") };
  }
  assert.ok(witness.order.count > 0); assert.ok(witness.payment.count > 0); assert.ok(witness.rifare_operation.count > 0);
  if (phase === "before") console.log("C7_UPGRADE_BASELINE=" + JSON.stringify(witness));
  else {
    assert.deepEqual(witness, JSON.parse(process.env.RIFARE_C7_UPGRADE_BASELINE ?? ""));
    console.log("C7_UPGRADE_RESULT=" + JSON.stringify({ result: "pass", tables: Object.keys(witness).length,
      source: "populated-pre-C7-schema", commerce_and_journal_preserved: true, production_qualified: false }));
  }
}
