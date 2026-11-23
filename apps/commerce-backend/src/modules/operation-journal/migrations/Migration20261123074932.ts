import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261123074932 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "rifare_operation" add column if not exists "start_owner_digest" text null, add column if not exists "start_claimed_at" timestamptz null;`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_start_owner check(start_owner_digest ~ '^sha256:[0-9a-f]{64}\$');`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_start_claim check(start_claimed_at is null or start_owner_digest is not null);`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_start_owner;`);
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_start_claim;`);
    this.addSql(`alter table if exists "rifare_operation" drop column if exists "start_owner_digest", drop column if exists "start_claimed_at";`);
  }

}
