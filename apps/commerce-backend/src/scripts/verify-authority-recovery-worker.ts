import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExecArgs } from "@medusajs/framework/types";
import { operationJournalModule } from "../modules/operation-journal";
import type OperationJournalService from "../modules/operation-journal/service";

/** Separate disposable consumer process. Credentials are synthetic and remain in
 * the inherited test environment, never in arguments, output or the journal. */
export default async function verifyAuthorityRecoveryWorker({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") {
    throw new Error("RIFARE_DISPOSABLE_COMMERCE_TEST_REQUIRED");
  }
  const command = Buffer.from(process.env.RIFARE_AUTHORITY_TEST_COMMAND ?? "", "base64url");
  const descriptor = Buffer.from(process.env.RIFARE_AUTHORITY_TEST_DESCRIPTOR ?? "", "base64url");
  const context = JSON.parse(process.env.RIFARE_AUTHORITY_TEST_CONTEXT ?? "");
  const config = JSON.parse(process.env.RIFARE_AUTHORITY_TEST_TRANSPORT ?? "");
  assert.match(config.origin, /^https:\/\/localhost:[1-9][0-9]{0,4}$/);
  const mode = process.env.RIFARE_AUTHORITY_TEST_MODE;
  assert.ok(mode === "start-lose-ack" || mode === "recover");
  const module = await import(pathToFileURL(resolve(process.cwd(),
    "../../packages/adapters/delegated-commands/public-use-client.mts")).href);
  const transport = new module.PublicDelegatedUseClient(config);
  const journal = container.resolve<OperationJournalService>(operationJournalModule);
  const session = await journal.openAuthoritySession(command, descriptor, context, transport);
  try {
    if (mode === "start-lose-ack") {
      await session.start();
      // Abruptly lose the process after its durable observation, before acknowledgement.
      process.exit(79);
    }
    assert.equal(session.recovery_only, true);
    await assert.rejects(session.start(), /Authority sender is unavailable/);
    const result = await session.recover() as { response: { recovered: boolean }; execution_authorized: boolean };
    assert.equal(result.response.recovered, true);
    assert.equal(result.execution_authorized, false);
    console.log("RIFARE_AUTHORITY_RECOVERY_WORKER=" + JSON.stringify({
      pid: process.pid, operation_id: session.operation.id, recovered: true, execution_authorized: false,
    }));
  } finally { session.close(); transport.close(); }
}
