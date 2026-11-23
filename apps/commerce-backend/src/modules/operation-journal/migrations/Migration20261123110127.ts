import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261123110127 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "rifare_operation" add column if not exists "receipt_fingerprint" text null, add column if not exists "receipt_bytes" text null, add column if not exists "receipt_digest" text null, add column if not exists "receipt_context_digest" text null, add column if not exists "receipt_id" text null, add column if not exists "receipt_observed_at" timestamptz null, add column if not exists "receipt_expires_at" timestamptz null;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "rifare_operation_receipt_unique" ON "rifare_operation" ("receipt_fingerprint");`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_receipt_tuple check((receipt_bytes is null) = (receipt_digest is null)
    and (receipt_bytes is null) = (receipt_context_digest is null) and (receipt_bytes is null) = (receipt_id is null)
    and (receipt_bytes is null) = (receipt_observed_at is null) and (receipt_bytes is null) = (receipt_expires_at is null)
    and (receipt_bytes is null or (request_bytes is not null and receipt_fingerprint is not null)));`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_receipt_digests check(receipt_fingerprint ~ '^sha256:[0-9a-f]{64}\$' and receipt_digest ~ '^sha256:[0-9a-f]{64}\$' and receipt_context_digest ~ '^sha256:[0-9a-f]{64}\$');`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_receipt_bounds check(octet_length(receipt_bytes) between 1 and 100000 and receipt_expires_at > receipt_observed_at and receipt_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\$');`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "rifare_operation_receipt_unique";`);
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_receipt_tuple;`);
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_receipt_digests;`);
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_receipt_bounds;`);
    this.addSql(`alter table if exists "rifare_operation" drop column if exists "receipt_fingerprint", drop column if exists "receipt_bytes", drop column if exists "receipt_digest", drop column if exists "receipt_context_digest", drop column if exists "receipt_id", drop column if exists "receipt_observed_at", drop column if exists "receipt_expires_at";`);
  }

}
