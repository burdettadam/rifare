import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { operationJournalModule } from "../modules/operation-journal";
import { readLockedCartFacts } from "../modules/operation-journal/cart-facts";
import type OperationJournalService from "../modules/operation-journal/service";

type Buyer = Parameters<OperationJournalService["admit"]>[1];
type Operator = Parameters<OperationJournalService["erasePrivacySubject"]>[1];
type Fixture = {
  merchant: { merchant_namespace: string; store_id: string };
  buyer: Buyer;
  operator: Operator;
  command: {
    cart_facts_digest: string; cart_id: string; command_id: string; currency: string;
    currency_exponent: number; kind: string; payable_minor_units: string; profile: string;
  };
  operationId: string;
};

function selectInstallation(merchant: Fixture["merchant"], operator: Operator) {
  process.env.RIFARE_MERCHANT_NAMESPACE = merchant.merchant_namespace;
  process.env.RIFARE_NATIVE_STORE_ID = merchant.store_id;
  process.env.RIFARE_JOURNAL_PRIVACY_OPERATOR_ID = operator.actor_id;
}

export default async function verifyDatabaseRestore({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") {
    throw new Error("RIFARE_DISPOSABLE_COMMERCE_TEST_REQUIRED");
  }

  const journal = container.resolve<OperationJournalService>(operationJournalModule);
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const phase = process.env.RIFARE_JOURNAL_RESTORE_PHASE;
  if (phase === "seed") {
    const [store] = await container.resolve(Modules.STORE).listStores();
    const channel = await container.resolve(Modules.SALES_CHANNEL).createSalesChannels({ name: "Backup witness" });
    const region = await container.resolve(Modules.REGION).createRegions({ name: "Backup witness", currency_code: "usd" });
    const customer = await container.resolve(Modules.CUSTOMER).createCustomers({
      email: "restore-buyer@example.invalid", has_account: true,
    });
    const user = await container.resolve(Modules.USER).createUsers({ email: "restore-owner@example.invalid" });
    const auth = container.resolve(Modules.AUTH);
    const customerAuth = await auth.createAuthIdentities({ app_metadata: { customer_id: customer.id } });
    const userAuth = await auth.createAuthIdentities({ app_metadata: { user_id: user.id } });
    const operator = { actor_type: "user", actor_id: user.id, auth_identity_id: userAuth.id };
    const buyer = {
      actor: { actor_type: "customer", actor_id: customer.id, auth_identity_id: customerAuth.id },
      salesChannelIds: [channel.id],
    };
    const cart = await container.resolve(Modules.CART).createCarts({
      currency_code: "usd", region_id: region.id, sales_channel_id: channel.id, customer_id: customer.id,
    });
    const merchant = { merchant_namespace: "restore-fixture", store_id: store.id };
    selectInstallation(merchant, operator);
    const locked = await postgres.transaction(tx => readLockedCartFacts(tx, cart.id, merchant, buyer),
      { isolationLevel: "serializable" });
    const command = {
      cart_facts_digest: locked.factsDigest,
      cart_id: cart.id,
      command_id: randomUUID(),
      currency: "usd",
      currency_exponent: 2,
      kind: "prepare_purchase",
      payable_minor_units: locked.facts.payable_total_minor,
      profile: "urn:rifare:medusa-original-operation:v1",
    };
    const operation = await journal.admit(Buffer.from(JSON.stringify(command)), buyer);
    const fixture: Fixture = { merchant, buyer, operator, command, operationId: operation.id };
    console.log("RIFARE_RESTORE_FIXTURE=" + JSON.stringify(fixture));
    return;
  }

  const fixture = JSON.parse(process.env.RIFARE_JOURNAL_RESTORE_FIXTURE ?? "") as Fixture;
  const { merchant, buyer, operator, command, operationId } = fixture;
  selectInstallation(merchant, operator);
  const customerId = buyer.actor.actor_id;
  const operationRow = () => postgres("rifare_operation").where({ id: operationId }).first();
  if (phase === "erase") {
    await journal.erasePrivacySubject(customerId, operator);
    const row = await operationRow();
    assert.equal(row.state, "retired");
    assert.equal(row.command_bytes, null);
    console.log("RIFARE_RESTORE_CURRENT_REFUSAL=" + JSON.stringify({
      id: row.id, original_command_uuid: row.original_command_uuid, challenge_fingerprint: row.challenge_fingerprint,
    }));
    return;
  }
  if (phase !== "reconcile") throw new Error("Unknown database restore fixture phase");

  const refusal = JSON.parse(process.env.RIFARE_JOURNAL_RESTORE_REFUSAL ?? "");
  const stale = await operationRow();
  assert.equal(stale.state, "awaiting_authority");
  assert.ok(stale.command_bytes);
  await assert.rejects(journal.reconcilePrivacyRestore([{ ...refusal, id: "rifop_conflict" }], [customerId], operator),
    /Invalid or conflicting/);
  assert.equal((await operationRow()).state, "awaiting_authority");

  await journal.reconcilePrivacyRestore([refusal], [customerId], operator);
  await journal.reconcilePrivacyRestore([refusal], [customerId], operator);
  const reconciled = await operationRow();
  assert.equal(reconciled.state, "retired");
  assert.equal(reconciled.revision, 1);
  assert.equal(reconciled.customer_id, null);
  assert.equal(reconciled.command_bytes, null);
  assert.equal(reconciled.original_command_uuid, command.command_id);
  assert.deepEqual(await journal.exportPrivacySubject(customerId, operator), []);
  await assert.rejects(journal.admit(Buffer.from(JSON.stringify(command)), buyer), /Cart context unavailable/);
  const fresh = { ...command, command_id: randomUUID() };
  await assert.rejects(journal.admit(Buffer.from(JSON.stringify(fresh)), buyer), /Cart context unavailable/);
  assert.equal(await postgres("rifare_operation").where({ original_command_uuid: fresh.command_id }).first(), undefined);
  console.log("RIFARE_JOURNAL_DATABASE_RESTORE_RESULT=pass");
}
