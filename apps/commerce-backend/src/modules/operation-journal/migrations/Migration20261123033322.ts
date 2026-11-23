import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261123033322 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "rifare_operation_privacy_installation" ("id" text not null, "key_binding" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "rifare_operation_privacy_installation_pkey" primary key ("id"), constraint rifare_operation_installation_id check (id ~ '^sha256:[0-9a-f]{64}\$'), constraint rifare_operation_installation_key check (key_binding ~ '^hmac-sha256:[0-9a-f]{64}\$'), constraint rifare_operation_installation_no_delete check (deleted_at is null));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_rifare_operation_privacy_installation_deleted_at" ON "rifare_operation_privacy_installation" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "rifare_operation_privacy_installation" cascade;`);
  }

}
