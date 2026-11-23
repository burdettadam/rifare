import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** Generation primitive only. It is not current authority, original row
 * visibility/correlation, dispatch permission or a payment-provider edge. */
export class Migration20261123200000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create function public.rifare_guard_native_generation() returns trigger
      language plpgsql security definer set search_path=pg_catalog as $$
      declare original public.rifare_operation%rowtype; selected_cart text; observed timestamptz;
      begin
        if session_user::text !~ '^rifare_exec_[a-f0-9]{32}$' then return null; end if;
        if TG_OP='TRUNCATE' then raise exception 'Native execution generation unavailable on %',TG_TABLE_NAME using errcode='42501'; end if;
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
    this.addSql(`create function public.rifare_guard_native_original() returns trigger
      language plpgsql security definer set search_path=pg_catalog as $$
      declare original public.rifare_operation%rowtype; selected jsonb; previous jsonb;
      begin
        if session_user::text !~ '^rifare_exec_[a-f0-9]{32}$' then return coalesce(NEW,OLD); end if;
        select * into original from public.rifare_operation
          where execution_owner_fingerprint='sha256:' || encode(sha256(convert_to(session_user::text,'UTF8')),'hex');
        if not found then raise exception 'Native original unavailable on %',TG_TABLE_NAME using errcode='42501'; end if;
        selected := case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
        previous := case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) else null end;
        if TG_TABLE_NAME='cart' then
          if selected->>'id' is distinct from original.cart_id or previous is not null and previous->>'id' is distinct from original.cart_id
            then raise exception 'Native original unavailable on %',TG_TABLE_NAME using errcode='42501'; end if;
        elsif TG_TABLE_NAME='cart_line_item' then
          if selected->>'cart_id' is distinct from original.cart_id or previous is not null and previous->>'cart_id' is distinct from original.cart_id
            then raise exception 'Native original unavailable on %',TG_TABLE_NAME using errcode='42501'; end if;
        elsif TG_TABLE_NAME='order_address' then
          if previous is not null and previous->'metadata'->>'rifare_execution_owner' is distinct from original.execution_owner_fingerprint
            then raise exception 'Native original unavailable on %',TG_TABLE_NAME using errcode='42501'; end if;
          if not exists(select 1 from public.cart c join public.cart_address a
            on a.id in (c.shipping_address_id,c.billing_address_id) and a.deleted_at is null
            where c.id=original.cart_id and c.deleted_at is null
              and a.customer_id is not distinct from selected->>'customer_id'
              and a.company is not distinct from selected->>'company'
              and a.first_name is not distinct from selected->>'first_name'
              and a.last_name is not distinct from selected->>'last_name'
              and a.address_1 is not distinct from selected->>'address_1'
              and a.address_2 is not distinct from selected->>'address_2'
              and a.city is not distinct from selected->>'city'
              and a.country_code is not distinct from selected->>'country_code'
              and a.province is not distinct from selected->>'province'
              and a.postal_code is not distinct from selected->>'postal_code'
              and a.phone is not distinct from selected->>'phone'
              and a.metadata is not distinct from nullif(nullif(selected->'metadata','null'::jsonb) - 'rifare_execution_owner','{}'::jsonb)) then
            raise exception 'Native original unavailable on %',TG_TABLE_NAME using errcode='42501';
          end if;
          if TG_OP<>'DELETE' then NEW.metadata := coalesce(NEW.metadata,'{}'::jsonb) ||
            jsonb_build_object('rifare_execution_owner',original.execution_owner_fingerprint); end if;
        elsif TG_TABLE_NAME='order_line_item' then
          if previous is not null and previous->'metadata'->>'rifare_execution_owner' is distinct from original.execution_owner_fingerprint
            then raise exception 'Native original unavailable on %',TG_TABLE_NAME using errcode='42501'; end if;
          if not exists(select 1 from public.cart_line_item ci where ci.cart_id=original.cart_id and ci.deleted_at is null
            and ci.variant_id is not distinct from selected->>'variant_id' and ci.product_id is not distinct from selected->>'product_id'
            and ci.unit_price is not distinct from (selected->>'unit_price')::numeric
            and ci.raw_unit_price is not distinct from selected->'raw_unit_price'
            and ci.title is not distinct from selected->>'title') then
            raise exception 'Native original unavailable on %',TG_TABLE_NAME using errcode='42501';
          end if;
          if TG_OP<>'DELETE' then NEW.metadata := coalesce(NEW.metadata,'{}'::jsonb) ||
            jsonb_build_object('rifare_execution_owner',original.execution_owner_fingerprint); end if;
        elsif TG_TABLE_NAME='order_item' then
          if previous is not null and previous->'metadata'->>'rifare_execution_owner' is distinct from original.execution_owner_fingerprint
            then raise exception 'Native original unavailable on %',TG_TABLE_NAME using errcode='42501'; end if;
          if not exists(select 1 from public.order_line_item li join public.cart_line_item ci
            on ci.cart_id=original.cart_id and ci.deleted_at is null and ci.variant_id is not distinct from li.variant_id
              and ci.product_id is not distinct from li.product_id and ci.unit_price is not distinct from li.unit_price
            where li.id=selected->>'item_id' and li.deleted_at is null
              and li.metadata->>'rifare_execution_owner'=original.execution_owner_fingerprint
              and ci.quantity::numeric is not distinct from (selected->>'quantity')::numeric) then
            raise exception 'Native original unavailable on %',TG_TABLE_NAME using errcode='42501';
          end if;
          if TG_OP<>'DELETE' then NEW.metadata := coalesce(NEW.metadata,'{}'::jsonb) ||
            jsonb_build_object('rifare_execution_owner',original.execution_owner_fingerprint); end if;
        elsif TG_TABLE_NAME='reservation_item' then
          if previous is not null and previous->'metadata'->>'rifare_execution_owner' is distinct from original.execution_owner_fingerprint
            then raise exception 'Native original unavailable on %',TG_TABLE_NAME using errcode='42501'; end if;
          if not exists(select 1 from public.order_item oi where oi.item_id=selected->>'line_item_id' and oi.deleted_at is null
            and oi.metadata->>'rifare_execution_owner'=original.execution_owner_fingerprint
            and oi.quantity is not distinct from (selected->>'quantity')::numeric) then
            raise exception 'Native original unavailable on %',TG_TABLE_NAME using errcode='42501';
          end if;
          if TG_OP<>'DELETE' then NEW.metadata := coalesce(NEW.metadata,'{}'::jsonb) ||
            jsonb_build_object('rifare_execution_owner',original.execution_owner_fingerprint); end if;
        elsif TG_TABLE_NAME='payment_session' then
          if selected->>'id' is distinct from original.payment_session_id
            or selected->>'payment_collection_id' is distinct from original.payment_collection_id
            or selected->>'provider_id' is distinct from 'pp_rifare_fenced_system_fixture'
            or selected->>'currency_code' is distinct from original.currency
            or (selected->>'amount')::numeric is distinct from original.payable_minor_units::numeric / power(10::numeric,original.currency_exponent)
            or selected->'raw_amount'->>'value' is distinct from (original.payable_minor_units::numeric / power(10::numeric,original.currency_exponent))::text
            or selected->'raw_amount'->>'precision' is distinct from '20'
            or previous is not null and (previous->>'id' is distinct from original.payment_session_id
              or previous->>'payment_collection_id' is distinct from original.payment_collection_id
              or previous->>'provider_id' is distinct from 'pp_rifare_fenced_system_fixture'
              or previous->>'currency_code' is distinct from original.currency
              or (previous->>'amount')::numeric is distinct from original.payable_minor_units::numeric / power(10::numeric,original.currency_exponent)
              or previous->'raw_amount'->>'value' is distinct from (original.payable_minor_units::numeric / power(10::numeric,original.currency_exponent))::text
              or previous->'raw_amount'->>'precision' is distinct from '20') then
            raise exception 'Native original unavailable on %',TG_TABLE_NAME using errcode='42501';
          end if;
        end if;
        return coalesce(NEW,OLD);
      end $$;
      revoke all on function public.rifare_guard_native_original() from public;`);
    this.addSql(`create function public.rifare_native_generation_ready() returns boolean
      language plpgsql stable set search_path=pg_catalog as $$
      declare target text; relation_oid oid; guard_oid oid := to_regprocedure('public.rifare_guard_native_generation()');
        original_oid oid := to_regprocedure('public.rifare_guard_native_original()');
      begin
        foreach target in array array['cart','cart_line_item','order','order_address','order_line_item','order_item','order_summary',
          'order_cart','order_payment_collection','reservation_item','payment_collection','payment_session','payment','capture','refund'] loop
          if to_regclass(format('public.%I',target)) is null then return false; end if;
        end loop;
        foreach target in array array[
          'cart','cart_address','cart_line_item','cart_line_item_adjustment','cart_line_item_tax_line','cart_shipping_method',
          'cart_shipping_method_adjustment','cart_shipping_method_tax_line','cart_credit_line','credit_line',
          'order','order_address','order_item','order_line_item','order_line_item_adjustment','order_line_item_tax_line',
          'order_shipping','order_shipping_method','order_shipping_method_adjustment','order_shipping_method_tax_line',
          'order_summary','order_credit_line','order_transaction','reservation_item','inventory_level','inventory_item',
          'payment_collection','payment_session','payment','capture','refund','order_cart','order_payment_collection','order_promotion','cart_payment_collection'
        ] loop
          relation_oid := to_regclass(format('public.%I',target));
          if relation_oid is not null and (not exists(select 1 from pg_catalog.pg_trigger where tgrelid=relation_oid
            and tgname='rifare_native_generation' and tgfoid=guard_oid and tgtype=62 and tgenabled='O')
            or not exists(select 1 from pg_catalog.pg_trigger where tgrelid=relation_oid
            and tgname='rifare_native_generation_commit' and tgfoid=guard_oid and tgtype=29 and tgenabled='O' and tgdeferrable and tginitdeferred)) then return false; end if;
        end loop;
        foreach target in array array['cart','cart_line_item','order_address','order_line_item','order_item','reservation_item','payment_session'] loop
          relation_oid := to_regclass(format('public.%I',target));
          if relation_oid is null or not exists(select 1 from pg_catalog.pg_trigger where tgrelid=relation_oid
            and tgname='rifare_native_original' and tgfoid=original_oid and tgtype=31 and tgenabled='O') then return false; end if;
        end loop;
        return true;
      end $$;`);
    this.addSql(`create function public.rifare_install_native_generation_fences() returns void
      language plpgsql set search_path=pg_catalog as $$
      declare target text; relation_oid oid;
      begin
        if current_user is distinct from pg_get_userbyid((select relowner from pg_catalog.pg_class where oid='public.rifare_operation'::regclass)) then
          raise exception 'Native generation provisioning owner required' using errcode='42501';
        end if;
        foreach target in array array[
          'cart','cart_address','cart_line_item','cart_line_item_adjustment','cart_line_item_tax_line','cart_shipping_method',
          'cart_shipping_method_adjustment','cart_shipping_method_tax_line','cart_credit_line','credit_line',
          'order','order_address','order_item','order_line_item','order_line_item_adjustment','order_line_item_tax_line',
          'order_shipping','order_shipping_method','order_shipping_method_adjustment','order_shipping_method_tax_line',
          'order_summary','order_credit_line','order_transaction','reservation_item','inventory_level','inventory_item',
          'payment_collection','payment_session','payment','capture','refund','order_cart','order_payment_collection','order_promotion','cart_payment_collection'
        ] loop
          relation_oid := to_regclass(format('public.%I',target));
          if relation_oid is not null then
            if not exists(select 1 from pg_catalog.pg_trigger where tgrelid=relation_oid and tgname='rifare_native_generation') then
              execute format('create trigger rifare_native_generation before insert or update or delete or truncate on public.%I for each statement execute function public.rifare_guard_native_generation()',target);
            end if;
            if not exists(select 1 from pg_catalog.pg_trigger where tgrelid=relation_oid and tgname='rifare_native_generation_commit') then
              execute format('create constraint trigger rifare_native_generation_commit after insert or update or delete on public.%I deferrable initially deferred for each row execute function public.rifare_guard_native_generation()',target);
            end if;
            if target in ('cart','cart_line_item','order_address','order_line_item','order_item','reservation_item','payment_session')
              and not exists(select 1 from pg_catalog.pg_trigger where tgrelid=relation_oid and tgname='rifare_native_original') then
              execute format('create trigger rifare_native_original before insert or update or delete on public.%I for each row execute function public.rifare_guard_native_original()',target);
            end if;
          end if;
        end loop;
      end $$;
      revoke all on function public.rifare_install_native_generation_fences() from public;
      select public.rifare_install_native_generation_fences();`);
  }

  override async down(): Promise<void> {
    this.addSql(`do $$ declare target record; begin
      if exists(select 1 from public.rifare_operation where execution_owner_fingerprint is not null) then
        raise exception 'Original execution records require generation-fence retention';
      end if;
      for target in select c.relname,t.tgname from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
        join pg_catalog.pg_namespace n on n.oid=c.relnamespace where t.tgname in ('rifare_native_generation','rifare_native_generation_commit','rifare_native_original') and n.nspname='public' loop
        execute format('drop trigger %I on public.%I',target.tgname,target.relname);
      end loop;
    end $$;
    drop function public.rifare_install_native_generation_fences();
    drop function public.rifare_native_generation_ready();
    drop function public.rifare_guard_native_original();
    drop function public.rifare_guard_native_generation();`);
  }
}
