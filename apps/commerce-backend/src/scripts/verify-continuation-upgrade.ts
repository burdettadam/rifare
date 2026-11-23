import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { configure } from "safe-stable-stringify";

/** Quiescent populated pre-C9 database, including a real C7 authenticated
 * request observation. No test fixture is an application/customer migration. */
export default async function verifyContinuationUpgrade({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") throw new Error("RIFARE_DISPOSABLE_RECEIPT_TEST_REQUIRED");
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION), stringify = configure({ strict: true, deterministic: true, bigint: false });
  const fields = ["proof_context_bytes", "proof_context_digest", "proof_digest", "proof_owner_digest", "proof_claimed_at", "proof_submission_bytes", "proof_submission_digest", "proof_submission_observed_at", "final_command_uuid", "final_command_bytes", "final_command_digest", "final_owner_digest", "final_claimed_at", "final_response_bytes", "final_response_digest", "final_response_observed_at"];
  const mode = process.env.RIFARE_C9_UPGRADE_MODE; assert.ok(mode === "before" || mode === "after");
  const columns = await postgres("information_schema.columns").where({ table_schema: "public", table_name: "rifare_operation" }).whereIn("column_name", fields);
  assert.equal(columns.length, mode === "before" ? 0 : 16);
  if (mode === "after") assert.ok(columns.every(column => column.is_nullable === "YES"));
  const witness: Record<string, { count: number; digest: string }> = {};
  for (const table of ["cart", "cart_line_item", "order", "order_line_item", "payment", "payment_collection", "inventory_item", "inventory_level",
    "product", "store", "sales_channel", "rifare_operation", "auth_identity", "customer"]) {
    const rows = await postgres(table).orderBy("id").select("*"); assert.ok(rows.length < 1000);
    if (table === "rifare_operation") {
      assert.ok(rows.some(row => row.request_bytes && row.request_digest && row.request_context_digest && row.request_nonce && row.request_observed_at && row.receipt_bytes && row.receipt_digest));
      for (const row of rows) { if (mode === "after") for (const field of fields) assert.equal(row[field], null); for (const field of fields) delete row[field]; }
    }
    witness[table] = { count: rows.length, digest: createHash("sha256").update(stringify(rows)!).digest("hex") };
  }
  assert.ok(witness.order.count > 0 && witness.payment.count > 0 && witness.rifare_operation.count > 0);
  if (mode === "before") console.log("C9_UPGRADE_BASELINE=" + JSON.stringify(witness));
  else {
    assert.deepEqual(witness, JSON.parse(process.env.RIFARE_C9_UPGRADE_BASELINE ?? ""));
    console.log("C9_UPGRADE_RESULT=" + JSON.stringify({ result: "pass", tables: Object.keys(witness).length, source: "populated-pre-C9-schema",
      commerce_and_authenticated_request_receipt_history_preserved: true, production_qualified: false }));
  }
}
