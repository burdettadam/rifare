import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261123124010 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_proof_submission_tuple;`);

    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_proof_submission_tuple check((proof_submission_bytes is null) = (proof_submission_digest is null)
    and (proof_submission_bytes is null) = (proof_submission_observed_at is null)
    and (proof_submission_bytes is null or (proof_context_bytes is not null and proof_claimed_at is not null)));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_proof_submission_tuple;`);

    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_proof_submission_tuple check((proof_submission_bytes is null) = (proof_submission_digest is null)
    and (proof_submission_bytes is null) = (proof_submission_observed_at is null)
    and (proof_submission_bytes is null or proof_context_bytes is not null));`);
  }

}
