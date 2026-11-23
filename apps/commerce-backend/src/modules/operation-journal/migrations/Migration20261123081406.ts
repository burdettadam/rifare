import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261123081406 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "rifare_operation" add column if not exists "start_response_bytes" text null, add column if not exists "start_response_digest" text null, add column if not exists "start_response_observed_at" timestamptz null;`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_start_response check((start_response_bytes is null) = (start_response_digest is null) and (start_response_bytes is null) = (start_response_observed_at is null));`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_start_response_digest check(start_response_digest ~ '^sha256:[0-9a-f]{64}\$');`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_start_response;`);
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_start_response_digest;`);
    this.addSql(`alter table if exists "rifare_operation" drop column if exists "start_response_bytes", drop column if exists "start_response_digest", drop column if exists "start_response_observed_at";`);
  }

}
