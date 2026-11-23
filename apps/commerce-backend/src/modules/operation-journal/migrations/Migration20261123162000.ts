import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** Native claim admission only; existing history and later cancellation are retained. */
export class Migration20261123162000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create function public.rifare_guard_native_claim_activation() returns trigger
      language plpgsql set search_path = pg_catalog, public as $$
      declare original_status text; original_canceled timestamptz; original_deleted timestamptz;
      begin
        if new.deleted_at is null and new.canceled_at is null then
          select status::text, canceled_at, deleted_at
            into original_status, original_canceled, original_deleted
            from public."order" where id = new.order_id for no key update;
          if not found or original_status = 'canceled' or original_canceled is not null or original_deleted is not null then
            raise exception 'RIFARE_CANCELED_ORDER_CLAIM_UNAVAILABLE' using errcode = '23514';
          end if;
        end if;
        return new;
      end $$;`);
    this.addSql(`create trigger rifare_native_claim_activation
      before insert or update of order_id, deleted_at, canceled_at on public.order_claim
      for each row execute function public.rifare_guard_native_claim_activation();`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop trigger if exists rifare_native_claim_activation on public.order_claim;`);
    this.addSql(`drop function if exists public.rifare_guard_native_claim_activation();`);
  }
}
