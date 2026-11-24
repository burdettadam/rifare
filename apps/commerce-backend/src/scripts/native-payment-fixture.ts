import { createHash, randomUUID } from "node:crypto";
import { createPaymentCollectionForCartWorkflow, createPaymentSessionsWorkflow } from "@medusajs/medusa/core-flows";
import { nativeReceiptFixture, bytes } from "./native-receipt-fixture";

/** Test-only native pending session and genuine synthetic C7/C8 signing setup.
 * The presentation is syntax-only and no live provider/custody is represented. */
export async function nativePaymentFixture(container: any, preservePrivacyKey = false, nativeExecution = false) {
  const f = await nativeReceiptFixture(container, "https://authority.example.invalid", preservePrivacyKey,
    nativeExecution ? ["pp_system_default", "pp_rifare_fenced_system_fixture"] : ["pp_system_default"]);
  const makeOriginal = async (options: { existingCart?: { id: string }; reusePayment?: boolean; withFinalization?: boolean;
    retainReceipt?: boolean; receiptLifetime?: number; providerId?: string } = {}) => {
    const cart = options.existingCart ?? await f.makeCart();
    let collection: any, session: any;
    if (options.reusePayment) {
      const link = await f.postgres("cart_payment_collection").where({ cart_id: cart.id }).whereNull("deleted_at").first();
      collection = await f.postgres("payment_collection").where({ id: link.payment_collection_id }).first();
      session = await f.postgres("payment_session").where({ payment_collection_id: collection.id }).whereNull("deleted_at").first();
    } else {
      collection = (await createPaymentCollectionForCartWorkflow(container).run({ input: { cart_id: cart.id } })).result;
      session = (await createPaymentSessionsWorkflow(container).run({ input: { payment_collection_id: collection.id, provider_id: options.providerId ?? (nativeExecution ? "pp_rifare_fenced_system_fixture" : "pp_system_default") } })).result;
    }
    const original = await f.makeOriginal(true, 120, cart), id = original.command.command_id;
    const proof = Buffer.from("e30.e30.cGF5bWVudC1hc3NvY2lhdGlvbi1zeW50aGV0aWM"), hash = (value: Uint8Array) => "sha256:" + createHash("sha256").update(value).digest("hex");
    if (options.withFinalization !== false) {
      const intent = await f.journal.prepareAuthorityProof(id, proof, f.context, f.requestVerifier); intent.prepared.close();
      await f.journal.claimAuthorityProofDispatch(id, intent.send_ticket!, hash(proof), f.context, f.requestVerifier);
      await f.journal.observeAuthorityProof(id, bytes({ submission_id: randomUUID(), challenge_id: original.challenge,
        proof_digest: hash(proof), received_at: new Date(await f.clock()).toISOString(), recovered: false }), hash(proof), f.context);
    }
    const receipt = await original.receipt(undefined, options.receiptLifetime ?? 60000);
    if (options.withFinalization !== false) {
      const intent = await f.journal.prepareAuthorityFinalization(id, f.context);
      await f.journal.claimAuthorityFinalization(id, intent.send_ticket!, f.context);
      const row = await original.row(), payload = JSON.parse(Buffer.from(receipt.toString().split(".")[1], "base64url").toString());
      await f.journal.observeAuthorityFinalization(id, bytes({ profile: "urn:marty:delegation-command-response:v1",
        original_command_id: row.final_command_uuid, command_digest: intent.command_digest, recovered: false,
        result: { kind: "FINAL_USE", challenge_id: original.challenge, decision: "PERMIT", receipt_ref: "urn:marty:delegated-receipt:" + payload.id,
          receipt_digest: hash(receipt), recorded_at: new Date(await f.clock()).toISOString(), authorization_expires_at: payload.expires_at,
          semantics: "EVIDENCE_ONLY" } }), false, f.context);
    }
    if (options.retainReceipt !== false) await f.journal.verifyAuthorityReceipt(id, receipt, f.context, f.verifier);
    return { ...original, collection, session, receipt };
  };
  return { ...f, makePaymentOriginal: makeOriginal };
}
