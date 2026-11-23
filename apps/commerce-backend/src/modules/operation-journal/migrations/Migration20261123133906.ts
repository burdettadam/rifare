import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261123133906 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "rifare_operation" add column if not exists "payment_fingerprint" text null, add column if not exists "payment_collection_id" text null, add column if not exists "payment_session_id" text null, add column if not exists "payment_provider_id" text null, add column if not exists "payment_context_digest" text null, add column if not exists "payment_observed_at" timestamptz null;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "rifare_operation_payment_unique" ON "rifare_operation" ("payment_fingerprint");`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_payment_tuple check((payment_collection_id is null) = (payment_session_id is null)
    and (payment_collection_id is null) = (payment_provider_id is null) and (payment_collection_id is null) = (payment_context_digest is null)
    and (payment_collection_id is null) = (payment_observed_at is null)
    and (payment_collection_id is null or (payment_fingerprint is not null and receipt_bytes is not null and final_command_bytes is not null))
    and (payment_fingerprint is null or payment_collection_id is not null or state = 'retired'));`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_payment_digests check(payment_fingerprint ~ '^sha256:[0-9a-f]{64}\$' and payment_context_digest ~ '^sha256:[0-9a-f]{64}\$');`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_payment_ids check(payment_collection_id ~ '^pay_col_[A-Za-z0-9]{1,100}\$' and payment_session_id ~ '^payses_[A-Za-z0-9]{1,100}\$' and payment_provider_id ~ '^pp_[A-Za-z0-9_.:-]{1,250}\$');`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "rifare_operation_payment_unique";`);
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_payment_tuple;`);
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_payment_digests;`);
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_payment_ids;`);
    this.addSql(`alter table if exists "rifare_operation" drop column if exists "payment_fingerprint", drop column if exists "payment_collection_id", drop column if exists "payment_session_id", drop column if exists "payment_provider_id", drop column if exists "payment_context_digest", drop column if exists "payment_observed_at";`);
  }

}
