import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261123171000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "rifare_operation" add column "native_payment_fingerprint" text null,
      add column "native_payment_id" text null, add column "native_payment_observed_at" timestamptz null;`);
    this.addSql(`create unique index "rifare_operation_native_payment_unique" on "rifare_operation" ("native_payment_fingerprint");`);
    this.addSql(`alter table "rifare_operation" add constraint rifare_operation_native_payment_tuple check(
      (native_payment_id is null) = (native_payment_observed_at is null)
      and (native_payment_id is null or (native_payment_fingerprint is not null and payment_collection_id is not null))
      and (native_payment_fingerprint is null or (payment_fingerprint is not null and (native_payment_id is not null or state = 'retired'))));`);
    this.addSql(`alter table "rifare_operation" add constraint rifare_operation_native_payment_shape check(
      native_payment_id ~ '^pay_[A-Za-z0-9]{1,100}$' and native_payment_fingerprint ~ '^sha256:[0-9a-f]{64}$');`);
  }
  override async down(): Promise<void> {
    this.addSql(`drop index if exists "rifare_operation_native_payment_unique";`);
    this.addSql(`alter table "rifare_operation" drop constraint if exists rifare_operation_native_payment_tuple,
      drop constraint if exists rifare_operation_native_payment_shape;`);
    this.addSql(`alter table "rifare_operation" drop column "native_payment_fingerprint", drop column "native_payment_id",
      drop column "native_payment_observed_at";`);
  }
}
