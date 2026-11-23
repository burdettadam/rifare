import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261123030615 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "rifare_operation" ("id" text not null, "original_command_uuid" text not null, "challenge_fingerprint" text null, "state" text check ("state" in ('admitted', 'awaiting_authority', 'approved', 'dispatching', 'unknown', 'observed', 'completed', 'denied', 'cancelled', 'retired')) not null, "revision" integer not null default 0, "merchant_namespace" text null, "store_id" text null, "customer_id" text null, "cart_id" text null, "actor_digest" text null, "command_bytes" text null, "command_digest" text null, "cart_facts_digest" text null, "payable_minor_units" text null, "currency" text null, "currency_exponent" integer null, "first_observation_digest" text null, "first_observed_at" timestamptz null, "privacy_hold" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "rifare_operation_pkey" primary key ("id"), constraint rifare_operation_original_uuid check (original_command_uuid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\$'), constraint rifare_operation_revision check (revision >= 0), constraint rifare_operation_no_soft_delete check (deleted_at is null), constraint rifare_operation_challenge_digest check (challenge_fingerprint ~ '^sha256:[0-9a-f]{64}\$'), constraint rifare_operation_first_observation_pair check ((first_observation_digest is null) = (first_observed_at is null)), constraint rifare_operation_payable check (payable_minor_units ~ '^(0|[1-9][0-9]{0,18})\$' and (length(payable_minor_units) < 19 or payable_minor_units collate "C" <= '9223372036854775807')), constraint rifare_operation_currency check (currency ~ '^[a-z]{3}\$' and currency_exponent between 0 and 4), constraint rifare_operation_active_binding check (
    state = 'retired' or (
      merchant_namespace is not null and store_id is not null and customer_id is not null
      and cart_id is not null and actor_digest is not null and command_bytes is not null
      and command_digest is not null and cart_facts_digest is not null
      and payable_minor_units is not null and currency is not null and currency_exponent is not null
    )
  ));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_rifare_operation_deleted_at" ON "rifare_operation" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "rifare_operation_original_unique" ON "rifare_operation" ("original_command_uuid");`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "rifare_operation_challenge_unique" ON "rifare_operation" ("challenge_fingerprint");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "rifare_operation" cascade;`);
  }

}
