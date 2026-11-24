import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** Permit only an inert retired refusal transfer to retain an already observed
 * provider-attempt time. This does not make an imported execution current. */
export class Migration20261123210000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create or replace function public.rifare_keep_native_payment_attempt() returns trigger
      language plpgsql set search_path=pg_catalog as $$
      begin
        if TG_OP='INSERT' or OLD.execution_owner_fingerprint is null then
          if NEW.execution_payment_attempted_at is not null and
            (NEW.execution_owner_fingerprint is null or NEW.state is distinct from 'retired') then
            raise exception 'Native payment attempt requires an existing or retired transferred execution' using errcode='23514';
          end if;
          return NEW;
        end if;
        if OLD.execution_payment_attempted_at is not null and NEW.execution_payment_attempted_at is distinct from OLD.execution_payment_attempted_at then
          raise exception 'Native payment attempt is immutable' using errcode='23514';
        end if;
        if OLD.execution_payment_attempted_at is null and NEW.execution_payment_attempted_at is not null
          and not (NEW.state = 'retired'
            and NEW.execution_owner_fingerprint is not distinct from OLD.execution_owner_fingerprint)
          and (session_user::text !~ '^rifare_exec_[a-f0-9]{32}$'
            or NEW.execution_owner_fingerprint is distinct from OLD.execution_owner_fingerprint
            or NEW.state is distinct from 'unknown' or NEW.execution_generation is distinct from 1
            or NEW.execution_revoked_at is not null) then
          raise exception 'Native payment attempt unavailable' using errcode='23514';
        end if;
        return NEW;
      end $$;`);
    this.addSql(`create or replace function public.rifare_keep_original_execution() returns trigger
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
        if OLD.state='retired' and OLD.execution_generation is null and OLD.execution_claimed_at is null
          and OLD.execution_expires_at is null and OLD.execution_revoked_at is null and OLD.execution_order_id is null
          and NEW.state='retired' and NEW.execution_generation is null and NEW.execution_claimed_at is null
          and NEW.execution_expires_at is null and NEW.execution_revoked_at is null and NEW.execution_order_id is null
          and NEW.execution_owner_fingerprint is not distinct from OLD.execution_owner_fingerprint
          and NEW.execution_seal_fingerprint is not distinct from OLD.execution_seal_fingerprint
          and NEW.execution_payment_handle_fingerprint is not distinct from OLD.execution_payment_handle_fingerprint
          and (OLD.execution_order_fingerprint is null or NEW.execution_order_fingerprint is not distinct from OLD.execution_order_fingerprint) then
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
      end $$;`);
  }

  override async down(): Promise<void> {
    this.addSql(`create or replace function public.rifare_keep_original_execution() returns trigger
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
      end $$;`);
    this.addSql(`create or replace function public.rifare_keep_native_payment_attempt() returns trigger
      language plpgsql set search_path=pg_catalog as $$
      begin
        if TG_OP='INSERT' or OLD.execution_owner_fingerprint is null then
          if NEW.execution_payment_attempted_at is not null then
            raise exception 'Native payment attempt requires an existing execution' using errcode='23514';
          end if;
          return NEW;
        end if;
        if OLD.execution_payment_attempted_at is not null and NEW.execution_payment_attempted_at is distinct from OLD.execution_payment_attempted_at then
          raise exception 'Native payment attempt is immutable' using errcode='23514';
        end if;
        if OLD.execution_payment_attempted_at is null and NEW.execution_payment_attempted_at is not null
          and (session_user::text !~ '^rifare_exec_[a-f0-9]{32}$'
            or NEW.execution_owner_fingerprint is distinct from OLD.execution_owner_fingerprint
            or NEW.state is distinct from 'unknown' or NEW.execution_generation is distinct from 1
            or NEW.execution_revoked_at is not null) then
          raise exception 'Native payment attempt unavailable' using errcode='23514';
        end if;
        return NEW;
      end $$;`);
  }
}
