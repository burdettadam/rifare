import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** Durable original-attempt identity only. Native SQL dispatch fencing remains a
 * separate incomplete C12 boundary; no route or production profile is enabled. */
export class Migration20261123190000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table public.rifare_operation
      add column execution_owner_fingerprint text null, add column execution_seal_fingerprint text null,
      add column execution_payment_handle_fingerprint text null, add column execution_generation integer null,
      add column execution_claimed_at timestamptz null, add column execution_expires_at timestamptz null,
      add column execution_revoked_at timestamptz null, add column execution_order_id text null,
      add column execution_order_fingerprint text null;`);
    this.addSql(`create unique index rifare_operation_execution_owner_unique on public.rifare_operation(execution_owner_fingerprint);
      create unique index rifare_operation_execution_seal_unique on public.rifare_operation(execution_seal_fingerprint);
      create unique index rifare_operation_execution_order_unique on public.rifare_operation(execution_order_fingerprint);`);
    this.addSql(`alter table public.rifare_operation add constraint rifare_operation_execution_tuple check((execution_owner_fingerprint is null and execution_seal_fingerprint is null and execution_payment_handle_fingerprint is null
      and execution_generation is null and execution_claimed_at is null and execution_expires_at is null
      and execution_revoked_at is null and execution_order_id is null and execution_order_fingerprint is null)
    or (execution_owner_fingerprint is not null and execution_seal_fingerprint is not null and execution_payment_handle_fingerprint is not null
      and payment_fingerprint is not null and
      (state = 'retired' or (state in ('unknown','observed','completed') and execution_generation is not null and execution_generation between 1 and 2147483647
        and execution_claimed_at is not null and execution_expires_at is not null and execution_expires_at > execution_claimed_at))
      and ((execution_order_id is null) = (execution_order_fingerprint is null) or state = 'retired' and execution_order_id is null))),
      add constraint rifare_operation_execution_shape check(execution_owner_fingerprint ~ '^sha256:[0-9a-f]{64}$' and execution_seal_fingerprint ~ '^sha256:[0-9a-f]{64}$' and execution_payment_handle_fingerprint ~ '^sha256:[0-9a-f]{64}$' and execution_order_fingerprint ~ '^sha256:[0-9a-f]{64}$' and execution_order_id ~ '^order_[A-Za-z0-9]{1,100}$');`);
    this.addSql(`create function public.rifare_keep_original_execution() returns trigger
      language plpgsql set search_path=pg_catalog,public as $$
      begin
        if TG_OP='INSERT' then
          if NEW.execution_owner_fingerprint is not null and NEW.state<>'retired' then
            raise exception 'Original execution requires an existing original' using errcode='23514';
          end if;
          return NEW;
        end if;
        if OLD.execution_owner_fingerprint is null then
          if NEW.execution_owner_fingerprint is not null and NEW.state <> 'retired' and
            (OLD.state <> 'awaiting_authority' or NEW.state <> 'unknown' or NEW.execution_generation is distinct from 1
              or NEW.execution_revoked_at is not null or NEW.final_response_bytes is null or NEW.receipt_bytes is null
              or NEW.payment_provider_id is distinct from 'pp_rifare_fenced_system_fixture'
              or NEW.execution_order_id is not null or NEW.execution_order_fingerprint is not null
              or NEW.execution_expires_at is null or NEW.execution_expires_at is distinct from NEW.receipt_expires_at
              or NEW.execution_expires_at <= clock_timestamp()) then
            raise exception 'Original execution claim unavailable' using errcode='23514';
          end if;
          return NEW;
        end if;
        if NEW.execution_owner_fingerprint is distinct from OLD.execution_owner_fingerprint
          or NEW.execution_seal_fingerprint is distinct from OLD.execution_seal_fingerprint
          or NEW.execution_payment_handle_fingerprint is distinct from OLD.execution_payment_handle_fingerprint
          or (OLD.execution_order_fingerprint is not null and NEW.execution_order_fingerprint is distinct from OLD.execution_order_fingerprint)
          or NEW.execution_generation is null or NEW.execution_generation < OLD.execution_generation
          or NEW.state not in ('unknown','observed','completed','retired')
          or OLD.state='retired' and NEW.state<>'retired' then
          raise exception 'Original execution identity is immutable' using errcode='23514';
        end if;
        if NEW.state='retired' and OLD.execution_revoked_at is null then
          NEW.execution_generation := OLD.execution_generation + 1;
          NEW.execution_revoked_at := clock_timestamp();
        end if;
        if OLD.execution_revoked_at is not null and NEW.execution_revoked_at is distinct from OLD.execution_revoked_at
          or NEW.execution_generation > OLD.execution_generation and NEW.execution_revoked_at is null
          or (NEW.execution_generation = OLD.execution_generation and NEW.execution_revoked_at is distinct from OLD.execution_revoked_at)
          or NEW.state <> 'retired' and (NEW.execution_claimed_at is distinct from OLD.execution_claimed_at
            or NEW.execution_expires_at is distinct from OLD.execution_expires_at)
          or (OLD.execution_order_id is not null and NEW.execution_order_id is distinct from OLD.execution_order_id and NEW.state<>'retired') then
          raise exception 'Original execution cannot be renewed' using errcode='23514';
        end if;
        if OLD.execution_order_fingerprint is null and NEW.execution_order_fingerprint is not null
          and (NEW.execution_revoked_at is not null or NEW.execution_order_id is null or NEW.execution_expires_at <= clock_timestamp()) then
          raise exception 'Original execution order binding unavailable' using errcode='23514';
        end if;
        return NEW;
      end $$;
      create trigger rifare_keep_original_execution before insert or update on public.rifare_operation
        for each row execute function public.rifare_keep_original_execution();`);
  }
  override async down(): Promise<void> {
    // A downgrade must not erase an attempted effect or its refusal identity.
    this.addSql(`do $$ begin if exists(select 1 from public.rifare_operation where execution_owner_fingerprint is not null)
      then raise exception 'Original execution records require retention'; end if; end $$;`);
    this.addSql(`drop trigger rifare_keep_original_execution on public.rifare_operation;
      drop function public.rifare_keep_original_execution();
      drop index public.rifare_operation_execution_owner_unique;
      drop index public.rifare_operation_execution_seal_unique;
      drop index public.rifare_operation_execution_order_unique;
      alter table public.rifare_operation drop constraint rifare_operation_execution_tuple, drop constraint rifare_operation_execution_shape,
        drop column execution_owner_fingerprint, drop column execution_seal_fingerprint, drop column execution_payment_handle_fingerprint,
        drop column execution_generation, drop column execution_claimed_at, drop column execution_expires_at,
        drop column execution_revoked_at, drop column execution_order_id, drop column execution_order_fingerprint;`);
  }
}
