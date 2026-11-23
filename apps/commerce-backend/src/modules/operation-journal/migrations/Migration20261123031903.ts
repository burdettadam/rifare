import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261123031903 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "rifare_operation_privacy_subject" ("id" text not null, "suppressed" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "rifare_operation_privacy_subject_pkey" primary key ("id"), constraint rifare_operation_privacy_subject_key check (id ~ '^hmac-sha256:[0-9a-f]{64}\$'), constraint rifare_operation_privacy_subject_no_delete check (deleted_at is null));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_rifare_operation_privacy_subject_deleted_at" ON "rifare_operation_privacy_subject" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "rifare_operation_privacy_subject" cascade;`);
  }

}
