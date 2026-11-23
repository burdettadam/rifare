import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  eraseJournalSubject, exportJournalSubject, journalSubjectIsSuppressed,
  restoreJournalRefusalIdentities, setJournalOperationHold, uninstallJournal,
} from "../modules/operation-journal/privacy";

export default async function verifyOperationPrivacy({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") {
    throw new Error("RIFARE_DISPOSABLE_COMMERCE_TEST_REQUIRED");
  }
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const scope = { merchant_namespace: "fixture", store_id: "store_fixture", customer_id: "cus_fixture" };
  const key = randomBytes(32);
  const digest = "sha256:" + "b".repeat(64);
  const operations = () => postgres("rifare_operation");
  const fixtureOperation = (customer_id = scope.customer_id) => ({
    ...scope, customer_id,
    id: "rifop_" + randomUUID(), original_command_uuid: randomUUID(), state: "awaiting_authority",
    cart_id: "cart_fixture", actor_digest: digest, command_bytes: "{}", command_digest: digest,
    cart_facts_digest: digest, payable_minor_units: "1520", currency: "usd", currency_exponent: 2,
  });
  const held = { ...fixtureOperation(), challenge_fingerprint: digest };
  const unheld = fixtureOperation();
  const unrelated = fixtureOperation("cus_other");
  await operations().insert([held, unheld, unrelated]);

  await assert.rejects(postgres.transaction(async tx => {
    await eraseJournalSubject(tx, scope, key);
    throw new Error("rollback witness");
  }), /rollback witness/);
  assert.equal(await postgres.transaction(tx => journalSubjectIsSuppressed(tx, scope, key)), false);
  assert.equal((await operations().where({ id: unheld.id }).first()).state, "awaiting_authority");
  assert.equal(await postgres.transaction(tx => setJournalOperationHold(tx, scope, key, unrelated.id, 0, true)), false);
  assert.equal(await postgres.transaction(tx => setJournalOperationHold(tx, scope, key, held.id, 0, true)), true);
  assert.equal(await postgres.transaction(tx => setJournalOperationHold(tx, scope, key, held.id, 0, false)), false);

  await postgres.transaction(tx => eraseJournalSubject(tx, scope, key));
  await postgres.transaction(tx => eraseJournalSubject(tx, scope, key));
  assert.equal(await postgres.transaction(tx => journalSubjectIsSuppressed(tx, scope, key)), true);
  assert.equal(await postgres.transaction(tx => journalSubjectIsSuppressed(tx, { ...scope, customer_id: "cus_other" }, key)), false);
  const retained = await operations().where({ id: held.id }).first();
  const minimized = await operations().where({ id: unheld.id }).first();
  assert.equal(retained.state, "retired");
  assert.equal(retained.command_bytes, "{}");
  assert.equal(retained.revision, 2);
  const exported = await postgres.transaction(tx => exportJournalSubject(tx, scope, key));
  assert.equal(exported.length, 1);
  assert.equal(exported[0].id, held.id);
  assert.equal(exported[0].command_bytes, "{}");
  assert.equal(minimized.state, "retired");
  assert.equal(minimized.customer_id, null);
  assert.equal(minimized.command_bytes, null);
  assert.equal(minimized.revision, 1);
  assert.equal((await operations().where({ id: unrelated.id }).first()).state, "awaiting_authority");

  assert.equal(await postgres.transaction(tx => setJournalOperationHold(tx, scope, key, held.id, 2, false)), true);
  const tombstone = await operations().where({ id: held.id }).first();
  assert.equal(tombstone.command_bytes, null);
  assert.equal(tombstone.customer_id, null);
  assert.equal(tombstone.original_command_uuid, held.original_command_uuid);
  assert.equal(tombstone.challenge_fingerprint, held.challenge_fingerprint);
  assert.equal(tombstone.privacy_hold, false);
  assert.equal(await postgres.transaction(tx => setJournalOperationHold(tx, scope, key, held.id, 3, true)), false);
  const remembered = await postgres("rifare_operation_privacy_subject").where({ suppressed: true }).first();
  assert.match(remembered.id, /^hmac-sha256:[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(remembered).includes(scope.customer_id), false);
  const raceScope = { ...scope, customer_id: "cus_race" };
  const writer = await postgres.transaction();
  let pending: Promise<boolean | Error> | undefined;
  try {
    const writerPid = (await writer.raw("select pg_backend_pid() as pid")).rows[0].pid;
    await eraseJournalSubject(writer, raceScope, key);

    const reader = await postgres.transaction();
    try {
      const readerPid = (await reader.raw("select pg_backend_pid() as pid")).rows[0].pid;
      assert.notEqual(readerPid, writerPid);
      await reader.raw("set local statement_timeout = '10s'");
      pending = journalSubjectIsSuppressed(reader, raceScope, key).catch(error => error as Error);
      const deadline = Date.now() + 5000;
      let blocked = false;
      while (!blocked && Date.now() < deadline) {
        const { rows } = await writer.raw(
          "select ?::integer = any(pg_blocking_pids(?::integer)) as blocked", [writerPid, readerPid],
        );
        blocked = rows[0].blocked;
        if (!blocked) await delay(25);
      }
      assert.equal(blocked, true, "Suppression lookup must wait for an in-flight erasure");
      await writer.commit();
      assert.equal(await pending, true);
      await reader.rollback();
    } finally {
      if (!writer.isCompleted()) await writer.rollback();
      await pending;
      if (!reader.isCompleted()) await reader.rollback();
    }
  } finally {
    if (!writer.isCompleted()) await writer.rollback();
  }
  const fresh = () => ({ id: "rifop_" + randomUUID(), original_command_uuid: randomUUID(),
    challenge_fingerprint: null });
  const restored = fresh();
  const same = { id: held.id, original_command_uuid: held.original_command_uuid, challenge_fingerprint: digest };
  const importRecords = (records: Parameters<typeof restoreJournalRefusalIdentities>[3]) =>
    postgres.transaction(tx => restoreJournalRefusalIdentities(tx, scope, key, records));
  await importRecords([restored, same]);
  await importRecords([restored, same]);
  const imported = await operations().where({ id: restored.id }).first();
  assert.equal(imported.state, "retired");
  assert.equal(imported.command_bytes, null);
  assert.equal(imported.customer_id, null);
  await assert.rejects(importRecords([{ ...restored, ...{ command_bytes: "{}" } }]), /Invalid or conflicting/);
  const first = { ...fresh(), original_command_uuid: "10000000-0000-0000-0000-000000000000" };
  const conflicting = { ...fresh(), original_command_uuid: "20000000-0000-0000-0000-000000000000",
    challenge_fingerprint: digest };
  await assert.rejects(importRecords([first, conflicting]), /Invalid or conflicting/);
  assert.equal(await operations().where({ id: first.id }).first(), undefined);

  const outside = { ...fixtureOperation(), store_id: "store_other" };
  await operations().insert(outside);
  await postgres.transaction(tx => uninstallJournal(tx, scope, key));
  await postgres.transaction(tx => uninstallJournal(tx, scope, key));
  assert.equal((await operations().where({ id: unrelated.id }).first()).state, "retired");
  assert.equal((await operations().where({ id: outside.id }).first()).state, "awaiting_authority");
  assert.equal(await postgres.transaction(tx => journalSubjectIsSuppressed(tx, { ...scope, customer_id: "cus_unseen" }, key)), true);
  assert.equal(await postgres.transaction(tx => journalSubjectIsSuppressed(tx, { ...scope, store_id: "store_other" }, key)), false);
  await importRecords([restored]);
  assert.equal(await postgres.transaction(tx => journalSubjectIsSuppressed(tx, scope, key)), true);
  console.log("RIFARE_OPERATION_PRIVACY_RESULT=pass");
}
