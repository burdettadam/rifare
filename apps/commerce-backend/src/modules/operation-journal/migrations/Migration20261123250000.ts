import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** Validate the first upstream order against the marked original cart and bind
 * its immutable ID before the existing order-item original guard executes. */
export class Migration20261123250000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create function public.rifare_bind_native_order() returns trigger
      language plpgsql security definer set search_path=pg_catalog as $$
      declare original public.rifare_operation%rowtype; cart_row public.cart%rowtype;
        selected jsonb; previous jsonb; bound text;
      begin
        if session_user::text !~ '^rifare_exec_[a-f0-9]{32}$' then return coalesce(NEW,OLD); end if;
        select * into original from public.rifare_operation
          where execution_owner_fingerprint='sha256:' || encode(sha256(convert_to(session_user::text,'UTF8')),'hex') for update;
        if not found then raise exception 'Native order binding unavailable' using errcode='42501'; end if;
        select * into cart_row from public.cart where id=original.cart_id and deleted_at is null for share;
        if not found or cart_row.metadata->>'rifare_execution_owner' is distinct from original.execution_owner_fingerprint then
          raise exception 'Native order binding unavailable' using errcode='42501';
        end if;
        selected := case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
        previous := case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) else null end;
        if TG_TABLE_NAME='order' then
          if selected->>'id' !~ '^order_[A-Za-z0-9]{1,100}$'
            or selected->'metadata'->>'rifare_execution_owner' is distinct from original.execution_owner_fingerprint
            or coalesce(selected->'metadata','{}'::jsonb) - 'rifare_execution_owner'
              is distinct from coalesce(cart_row.metadata,'{}'::jsonb) - 'rifare_execution_owner'
            or selected->>'region_id' is distinct from cart_row.region_id
            or selected->>'customer_id' is distinct from cart_row.customer_id
            or selected->>'sales_channel_id' is distinct from cart_row.sales_channel_id
            or selected->>'email' is distinct from cart_row.email
            or selected->>'currency_code' is distinct from cart_row.currency_code
            or selected->>'locale' is distinct from cart_row.locale
            or selected->>'status' is distinct from 'pending'
            or (selected->>'is_draft_order')::boolean is distinct from false
            or (selected->>'no_notification')::boolean is distinct from false
            or selected->>'deleted_at' is not null or selected->>'canceled_at' is not null
            or cart_row.shipping_address_id is null and selected->>'shipping_address_id' is not null
            or cart_row.shipping_address_id is not null and (selected->>'shipping_address_id' is null or not exists(
              select 1 from public.order_address oa join public.cart_address ca on ca.id=cart_row.shipping_address_id
              where oa.id=selected->>'shipping_address_id' and oa.deleted_at is null and ca.deleted_at is null
                and oa.metadata->>'rifare_execution_owner'=original.execution_owner_fingerprint
                and oa.customer_id is not distinct from ca.customer_id and oa.company is not distinct from ca.company
                and oa.first_name is not distinct from ca.first_name and oa.last_name is not distinct from ca.last_name
                and oa.address_1 is not distinct from ca.address_1 and oa.address_2 is not distinct from ca.address_2
                and oa.city is not distinct from ca.city and oa.country_code is not distinct from ca.country_code
                and oa.province is not distinct from ca.province and oa.postal_code is not distinct from ca.postal_code
                and oa.phone is not distinct from ca.phone
                and coalesce(oa.metadata,'{}'::jsonb)-'rifare_execution_owner'
                  is not distinct from coalesce(ca.metadata,'{}'::jsonb)))
            or cart_row.billing_address_id is null and selected->>'billing_address_id' is not null
            or cart_row.billing_address_id is not null and (selected->>'billing_address_id' is null or not exists(
              select 1 from public.order_address oa join public.cart_address ca on ca.id=cart_row.billing_address_id
              where oa.id=selected->>'billing_address_id' and oa.deleted_at is null and ca.deleted_at is null
                and oa.metadata->>'rifare_execution_owner'=original.execution_owner_fingerprint
                and oa.customer_id is not distinct from ca.customer_id and oa.company is not distinct from ca.company
                and oa.first_name is not distinct from ca.first_name and oa.last_name is not distinct from ca.last_name
                and oa.address_1 is not distinct from ca.address_1 and oa.address_2 is not distinct from ca.address_2
                and oa.city is not distinct from ca.city and oa.country_code is not distinct from ca.country_code
                and oa.province is not distinct from ca.province and oa.postal_code is not distinct from ca.postal_code
                and oa.phone is not distinct from ca.phone
                and coalesce(oa.metadata,'{}'::jsonb)-'rifare_execution_owner'
                  is not distinct from coalesce(ca.metadata,'{}'::jsonb)))
            or previous is not null and previous->'metadata'->>'rifare_execution_owner' is distinct from original.execution_owner_fingerprint
            or previous is not null and (previous->>'shipping_address_id' is distinct from selected->>'shipping_address_id'
              or previous->>'billing_address_id' is distinct from selected->>'billing_address_id')
            or original.execution_order_id is not null and selected->>'id' is distinct from original.execution_order_id then
            raise exception 'Native order binding unavailable' using errcode='42501';
          end if;
          if TG_OP<>'DELETE' then NEW.metadata := coalesce(NEW.metadata,'{}'::jsonb) ||
            jsonb_build_object('rifare_execution_owner',original.execution_owner_fingerprint); end if;
          return coalesce(NEW,OLD);
        end if;
        if TG_TABLE_NAME='order_item' and TG_OP='INSERT' then
          if not exists(select 1 from public."order" o where o.id=selected->>'order_id' and o.deleted_at is null
              and o.metadata->>'rifare_execution_owner'=original.execution_owner_fingerprint)
            or not exists(select 1 from public.order_line_item li join public.cart_line_item ci
              on ci.cart_id=original.cart_id and ci.deleted_at is null and ci.variant_id is not distinct from li.variant_id
                and ci.product_id is not distinct from li.product_id and ci.unit_price is not distinct from li.unit_price
              where li.id=selected->>'item_id' and li.deleted_at is null
                and li.metadata->>'rifare_execution_owner'=original.execution_owner_fingerprint
                and ci.quantity::numeric is not distinct from (selected->>'quantity')::numeric) then
            raise exception 'Native order binding unavailable' using errcode='42501';
          end if;
          if original.execution_order_id is null then
            update public.rifare_operation set execution_order_id=selected->>'order_id',
              execution_order_fingerprint='sha256:' || encode(sha256(convert_to(selected->>'order_id','UTF8')),'hex'),
              revision=revision+1,updated_at=clock_timestamp()
              where id=original.id and execution_order_id is null and execution_revoked_at is null
              returning id into bound;
            if bound is null then raise exception 'Native order binding unavailable' using errcode='42501'; end if;
          elsif selected->>'order_id' is distinct from original.execution_order_id then
            raise exception 'Native order binding unavailable' using errcode='42501';
          end if;
          return NEW;
        end if;
        raise exception 'Native order binding unavailable' using errcode='42501';
      end $$;
      revoke all on function public.rifare_bind_native_order() from public;`);
    this.addSql(`create function public.rifare_install_native_order_binding() returns void
      language plpgsql set search_path=pg_catalog as $$
      begin
        if current_user is distinct from pg_get_userbyid((select relowner from pg_catalog.pg_class where oid='public.rifare_operation'::regclass)) then
          raise exception 'Native order-binding provisioning owner required' using errcode='42501';
        end if;
        if to_regclass('public.order') is null or to_regclass('public.order_item') is null then return; end if;
        if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.order'::regclass
          and tgname='rifare_native_order_binding') then
          create trigger rifare_native_order_binding before insert or update or delete on public.order
            for each row execute function public.rifare_bind_native_order();
        end if;
        if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.order_item'::regclass
          and tgname='rifare_native_order_binding') then
          create trigger rifare_native_order_binding before insert on public.order_item
            for each row execute function public.rifare_bind_native_order();
        end if;
      end $$;
      revoke all on function public.rifare_install_native_order_binding() from public;
      select public.rifare_install_native_order_binding();`);
    this.addSql(`create function public.rifare_native_order_binding_ready() returns boolean
      language sql stable set search_path=pg_catalog as $$
        select to_regprocedure('public.rifare_bind_native_order()') is not null
          and not has_function_privilege('public','public.rifare_bind_native_order()','EXECUTE')
          and exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.order'::regclass
            and tgname='rifare_native_order_binding' and tgfoid=to_regprocedure('public.rifare_bind_native_order()')
            and tgtype=31 and tgenabled='O')
          and exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.order_item'::regclass
            and tgname='rifare_native_order_binding' and tgfoid=to_regprocedure('public.rifare_bind_native_order()')
            and tgtype=7 and tgenabled='O')
      $$;`);
  }

  override async down(): Promise<void> {
    this.addSql(`do $$ begin
      if exists(select 1 from public.rifare_operation where execution_owner_fingerprint is not null) then
        raise exception 'Original execution records require order-binding retention';
      end if;
    end $$;
    drop trigger rifare_native_order_binding on public.order_item;
    drop trigger rifare_native_order_binding on public.order;
    drop function public.rifare_native_order_binding_ready();
    drop function public.rifare_install_native_order_binding();
    drop function public.rifare_bind_native_order();`);
  }
}
