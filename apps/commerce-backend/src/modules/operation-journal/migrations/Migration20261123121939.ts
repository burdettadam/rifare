import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261123121939 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "rifare_operation" add column if not exists "proof_context_bytes" text null, add column if not exists "proof_context_digest" text null, add column if not exists "proof_digest" text null, add column if not exists "proof_owner_digest" text null, add column if not exists "proof_claimed_at" timestamptz null, add column if not exists "proof_submission_bytes" text null, add column if not exists "proof_submission_digest" text null, add column if not exists "proof_submission_observed_at" timestamptz null, add column if not exists "final_command_uuid" text null, add column if not exists "final_command_bytes" text null, add column if not exists "final_command_digest" text null, add column if not exists "final_owner_digest" text null, add column if not exists "final_claimed_at" timestamptz null, add column if not exists "final_response_bytes" text null, add column if not exists "final_response_digest" text null, add column if not exists "final_response_observed_at" timestamptz null;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "rifare_operation_final_uuid_unique" ON "rifare_operation" ("final_command_uuid");`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_proof_context_tuple check((proof_context_bytes is null) = (proof_context_digest is null)
    and (proof_context_bytes is null) = (proof_digest is null) and (proof_context_bytes is null) = (proof_owner_digest is null)
    and (proof_context_bytes is null or request_bytes is not null)
    and (proof_claimed_at is null or proof_context_bytes is not null));`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_proof_digests check(proof_context_digest ~ '^sha256:[0-9a-f]{64}\$' and proof_digest ~ '^sha256:[0-9a-f]{64}\$' and proof_owner_digest ~ '^sha256:[0-9a-f]{64}\$' and proof_submission_digest ~ '^sha256:[0-9a-f]{64}\$');`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_proof_submission_tuple check((proof_submission_bytes is null) = (proof_submission_digest is null)
    and (proof_submission_bytes is null) = (proof_submission_observed_at is null)
    and (proof_submission_bytes is null or proof_context_bytes is not null));`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_proof_bounds check(octet_length(proof_context_bytes) between 1 and 4096 and octet_length(proof_submission_bytes) between 1 and 4096);`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_final_tuple check((final_command_bytes is null) = (final_command_digest is null)
    and (final_command_bytes is null) = (final_owner_digest is null)
    and (final_command_bytes is null or (final_command_uuid is not null and proof_submission_bytes is not null))
    and (final_command_uuid is null or final_command_bytes is not null or state = 'retired')
    and (final_claimed_at is null or final_command_bytes is not null));`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_final_uuid check(final_command_uuid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\$' and final_command_uuid <> '00000000-0000-0000-0000-000000000000' and final_command_uuid <> original_command_uuid);`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_final_digests check(final_command_digest ~ '^sha256:[0-9a-f]{64}\$' and final_owner_digest ~ '^sha256:[0-9a-f]{64}\$' and final_response_digest ~ '^sha256:[0-9a-f]{64}\$');`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_final_response_tuple check((final_response_bytes is null) = (final_response_digest is null)
    and (final_response_bytes is null) = (final_response_observed_at is null)
    and (final_response_bytes is null or final_command_bytes is not null));`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_final_bounds check(octet_length(final_command_bytes) between 1 and 65536 and octet_length(final_response_bytes) between 1 and 65536);`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "rifare_operation_final_uuid_unique";`);
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_proof_context_tuple;`);
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_proof_digests;`);
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_proof_submission_tuple;`);
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_proof_bounds;`);
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_final_tuple;`);
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_final_uuid;`);
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_final_digests;`);
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_final_response_tuple;`);
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_final_bounds;`);
    this.addSql(`alter table if exists "rifare_operation" drop column if exists "proof_context_bytes", drop column if exists "proof_context_digest", drop column if exists "proof_digest", drop column if exists "proof_owner_digest", drop column if exists "proof_claimed_at", drop column if exists "proof_submission_bytes", drop column if exists "proof_submission_digest", drop column if exists "proof_submission_observed_at", drop column if exists "final_command_uuid", drop column if exists "final_command_bytes", drop column if exists "final_command_digest", drop column if exists "final_owner_digest", drop column if exists "final_claimed_at", drop column if exists "final_response_bytes", drop column if exists "final_response_digest", drop column if exists "final_response_observed_at";`);
  }

}
