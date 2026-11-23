import type { ExecArgs } from "@medusajs/framework/types";
import { operationJournalModule } from "../modules/operation-journal";
import type OperationJournalService from "../modules/operation-journal/service";

export default async function verifyJournalWorker({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") {
    throw new Error("RIFARE_DISPOSABLE_COMMERCE_TEST_REQUIRED");
  }
  const command = Buffer.from(process.env.RIFARE_JOURNAL_TEST_COMMAND ?? "", "base64url");
  const context = JSON.parse(process.env.RIFARE_JOURNAL_TEST_CONTEXT ?? "");
  const result = await container.resolve<OperationJournalService>(operationJournalModule).admit(command, context);
  if (process.env.RIFARE_JOURNAL_TEST_LOSE_ACK === "true") process.exit(79);
  console.log("RIFARE_JOURNAL_WORKER=" + JSON.stringify({ pid: process.pid, result }));
}
