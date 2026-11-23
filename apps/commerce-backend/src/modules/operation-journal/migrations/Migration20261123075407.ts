import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261123075407 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "rifare_operation" add column if not exists "start_command_bytes" text null, add column if not exists "start_command_digest" text null, add column if not exists "start_correlation" text null;`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_start_bytes check((start_command_bytes is null) = (start_command_digest is null) and (start_command_bytes is null) = (start_correlation is null));`);
    this.addSql(`alter table if exists "rifare_operation" add constraint rifare_operation_start_digest check(start_command_digest ~ '^sha256:[0-9a-f]{64}\$');`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_start_bytes;`);
    this.addSql(`alter table if exists "rifare_operation" drop constraint if exists rifare_operation_start_digest;`);
    this.addSql(`alter table if exists "rifare_operation" drop column if exists "start_command_bytes", drop column if exists "start_command_digest", drop column if exists "start_correlation";`);
  }

}
