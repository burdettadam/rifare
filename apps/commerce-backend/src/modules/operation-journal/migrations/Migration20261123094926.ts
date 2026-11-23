import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261123094926 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "rifare_operation" add column if not exists "request_bytes" text null, add column if not exists "request_digest" text null, add column if not exists "request_context_digest" text null, add column if not exists "request_nonce" text null, add column if not exists "request_observed_at" timestamptz null, add column if not exists "request_expires_at" timestamptz null;`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_request_tuple check((request_bytes is null) = (request_digest is null)
    and (request_bytes is null) = (request_context_digest is null) and (request_bytes is null) = (request_nonce is null)
    and (request_bytes is null) = (request_observed_at is null) and (request_bytes is null) = (request_expires_at is null)
    and (request_bytes is null or start_response_bytes is not null));`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_request_digest check(request_digest ~ '^sha256:[0-9a-f]{64}\$' and request_context_digest ~ '^sha256:[0-9a-f]{64}\$');`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_request_bounds check(octet_length(request_bytes) between 1 and 65536 and length(request_nonce) between 1 and 1024 and request_expires_at > request_observed_at);`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_request_tuple;`);
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_request_digest;`);
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_request_bounds;`);
    this.addSql(`alter table if exists "rifare_operation" drop column if exists "request_bytes", drop column if exists "request_digest", drop column if exists "request_context_digest", drop column if exists "request_nonce", drop column if exists "request_observed_at", drop column if exists "request_expires_at";`);
  }

}
