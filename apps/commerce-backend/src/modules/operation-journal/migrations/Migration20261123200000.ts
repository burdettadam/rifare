import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** Generation primitive only. It is not current authority, original row
 * visibility/correlation, dispatch permission or a payment-provider edge. */
export class Migration20261123200000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create function public.rifare_guard_native_generation() returns trigger
      language plpgsql security definer set search_path=pg_catalog,public as $$
      declare original public.rifare_operation%rowtype; selected_cart text; observed timestamptz;
      begin
        if session_user::text !~ '^rifare_exec_[a-f0-9]{32}$' then return null; end if;
        select cart_id into selected_cart from public.rifare_operation
          where execution_owner_fingerprint='sha256:' || encode(sha256(convert_to(session_user::text,'UTF8')),'hex');
        if selected_cart is null then
          raise exception 'Native execution generation unavailable on %',TG_TABLE_NAME using errcode='42501';
        end if;
        -- Match the existing admission lock order: native cart before journal.
        -- Hold both through the actual write transaction and its COMMIT.
        perform id from public.cart where id=selected_cart and deleted_at is null for share;
        if not found then
          raise exception 'Native execution generation unavailable on %',TG_TABLE_NAME using errcode='42501';
        end if;
        select * into original from public.rifare_operation
          where execution_owner_fingerprint='sha256:' || encode(sha256(convert_to(session_user::text,'UTF8')),'hex') for share;
        observed := clock_timestamp();
        if not found or original.cart_id is distinct from selected_cart or original.state is distinct from 'unknown'
          or original.execution_generation is distinct from 1 or original.execution_revoked_at is not null
          or original.execution_claimed_at is null or original.execution_expires_at is null
          or observed < original.execution_claimed_at or observed >= original.execution_expires_at then
          raise exception 'Native execution generation unavailable on %',TG_TABLE_NAME using errcode='42501';
        end if;
        return null;
      end $$;
      revoke all on function public.rifare_guard_native_generation() from public;`);
    this.addSql(`do $$ declare target text; begin
      foreach target in array array['cart','cart_line_item','order','order_address','order_line_item','order_item','order_summary',
        'order_cart','order_payment_collection','reservation_item','payment_collection','payment_session','payment','capture','refund'] loop
        if to_regclass(format('public.%I',target)) is null then raise exception 'Required native generation target missing: %',target; end if;
      end loop;
      foreach target in array array[
        'cart','cart_address','cart_line_item','cart_line_item_adjustment','cart_line_item_tax_line','cart_shipping_method',
        'cart_shipping_method_adjustment','cart_shipping_method_tax_line','cart_credit_line','credit_line',
        'order','order_address','order_item','order_line_item','order_line_item_adjustment','order_line_item_tax_line',
        'order_shipping','order_shipping_method','order_shipping_method_adjustment','order_shipping_method_tax_line',
        'order_summary','order_credit_line','order_transaction','reservation_item','inventory_level','inventory_item',
        'payment_collection','payment_session','payment','capture','refund','order_cart','order_payment_collection','order_promotion','cart_payment_collection'
      ] loop
        if to_regclass(format('public.%I',target)) is not null then
          execute format('create trigger rifare_native_generation before insert or update or delete or truncate on public.%I for each statement execute function public.rifare_guard_native_generation()',target);
        end if;
      end loop;
    end $$;`);
  }
  override async down(): Promise<void> {
    this.addSql(`do $$ declare target record; begin
      if exists(select 1 from public.rifare_operation where execution_owner_fingerprint is not null) then
        raise exception 'Original execution records require generation-fence retention';
      end if;
      for target in select c.relname from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
        join pg_catalog.pg_namespace n on n.oid=c.relnamespace where t.tgname='rifare_native_generation' and n.nspname='public' loop
        execute format('drop trigger rifare_native_generation on public.%I',target.relname);
      end loop;
    end $$;
    drop function public.rifare_guard_native_generation();`);
  }
}
