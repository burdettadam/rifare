import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** Correlate every table writable by an execution worker to its one original.
 * The database owner remains the explicit administrative bypass. */
export class Migration20261123270000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create function public.rifare_native_scope_row(p_table text,p_row jsonb,p_owner text,p_cart text,p_order text,
      p_collection text,p_session text,p_currency text,p_minor text,p_exponent integer,p_handle text,p_command text) returns boolean
      language plpgsql stable security definer set search_path=pg_catalog as $$
      begin
        return case p_table
          when 'cart' then p_row->>'id'=p_cart and p_row->'metadata'->>'rifare_execution_owner'=p_owner
          when 'cart_address' then exists(select 1 from public.cart c where c.id=p_cart and c.deleted_at is null
            and p_row->>'id' in (c.shipping_address_id,c.billing_address_id))
          when 'cart_line_item' then p_row->>'cart_id'=p_cart
          when 'cart_line_item_adjustment' then exists(select 1 from public.cart_line_item i where i.id=p_row->>'item_id' and i.cart_id=p_cart and i.deleted_at is null)
          when 'cart_line_item_tax_line' then exists(select 1 from public.cart_line_item i where i.id=p_row->>'item_id' and i.cart_id=p_cart and i.deleted_at is null)
          when 'cart_shipping_method' then p_row->>'cart_id'=p_cart
          when 'cart_shipping_method_adjustment' then exists(select 1 from public.cart_shipping_method m where m.id=p_row->>'shipping_method_id' and m.cart_id=p_cart and m.deleted_at is null)
          when 'cart_shipping_method_tax_line' then exists(select 1 from public.cart_shipping_method m where m.id=p_row->>'shipping_method_id' and m.cart_id=p_cart and m.deleted_at is null)
          when 'cart_credit_line' then p_row->>'cart_id'=p_cart
          when 'order' then true
          when 'order_address' then true
          when 'order_line_item' then true
          when 'order_item' then true
          when 'order_line_item_adjustment' then exists(select 1 from public.order_line_item i where i.id=p_row->>'item_id' and i.deleted_at is null and i.metadata->>'rifare_execution_owner'=p_owner)
          when 'order_line_item_tax_line' then exists(select 1 from public.order_line_item i where i.id=p_row->>'item_id' and i.deleted_at is null and i.metadata->>'rifare_execution_owner'=p_owner)
          when 'order_shipping_method' then p_row->'metadata'->>'rifare_execution_owner'=p_owner
          when 'order_shipping' then exists(select 1 from public."order" o where o.id=p_row->>'order_id' and o.deleted_at is null
            and o.metadata->>'rifare_execution_owner'=p_owner) and exists(select 1 from public.order_shipping_method m
              where m.id=p_row->>'shipping_method_id' and m.deleted_at is null and m.metadata->>'rifare_execution_owner'=p_owner)
          when 'order_shipping_method_adjustment' then exists(select 1 from public.order_shipping_method m
            where m.id=p_row->>'shipping_method_id' and m.deleted_at is null and m.metadata->>'rifare_execution_owner'=p_owner)
          when 'order_shipping_method_tax_line' then exists(select 1 from public.order_shipping_method m
            where m.id=p_row->>'shipping_method_id' and m.deleted_at is null and m.metadata->>'rifare_execution_owner'=p_owner)
          when 'order_summary' then exists(select 1 from public."order" o where o.id=p_row->>'order_id' and o.deleted_at is null and o.metadata->>'rifare_execution_owner'=p_owner)
          when 'order_credit_line' then exists(select 1 from public."order" o where o.id=p_row->>'order_id' and o.deleted_at is null and o.metadata->>'rifare_execution_owner'=p_owner)
          when 'order_transaction' then exists(select 1 from public."order" o where o.id=p_row->>'order_id' and o.deleted_at is null and o.metadata->>'rifare_execution_owner'=p_owner)
          when 'order_promotion' then exists(select 1 from public."order" o where o.id=p_row->>'order_id' and o.deleted_at is null and o.metadata->>'rifare_execution_owner'=p_owner)
          when 'reservation_item' then true
          when 'payment_collection' then p_row->>'id'=p_collection
          when 'payment_session' then p_row->>'id'=p_session and p_row->>'payment_collection_id'=p_collection
            and p_row->'data'->'rifare_native_execution'->>'profile'='urn:rifare:local-fenced-system-correlation:v1'
            and p_row->'data'->'rifare_native_execution'->>'session_id'=p_session
            and p_row->'data'->'rifare_native_execution'->>'handle' is not null
            and 'sha256:' || encode(sha256(convert_to(p_row->'data'->'rifare_native_execution'->>'handle','UTF8')),'hex')=p_handle
          when 'payment' then p_row->>'payment_collection_id'=p_collection and p_row->>'payment_session_id'=p_session
            and p_row->>'provider_id'='pp_rifare_fenced_system_fixture' and p_row->>'currency_code'=p_currency
            and (p_row->'raw_amount'->>'value')::numeric=p_minor::numeric/power(10::numeric,p_exponent)
            and p_row->'data'->'rifare_native_execution'->>'original_command_id'=p_command
          when 'capture' then exists(select 1 from public.payment p where p.id=p_row->>'payment_id' and p.deleted_at is null
            and p.payment_collection_id=p_collection and p.payment_session_id=p_session and p.provider_id='pp_rifare_fenced_system_fixture')
          when 'refund' then exists(select 1 from public.payment p where p.id=p_row->>'payment_id' and p.deleted_at is null
            and p.payment_collection_id=p_collection and p.payment_session_id=p_session and p.provider_id='pp_rifare_fenced_system_fixture')
          when 'order_cart' then p_row->>'cart_id'=p_cart and exists(select 1 from public."order" o
            where o.id=p_row->>'order_id' and o.deleted_at is null and o.metadata->>'rifare_execution_owner'=p_owner)
          when 'order_payment_collection' then p_row->>'payment_collection_id'=p_collection and exists(select 1 from public."order" o
            where o.id=p_row->>'order_id' and o.deleted_at is null and o.metadata->>'rifare_execution_owner'=p_owner)
          when 'cart_payment_collection' then p_row->>'cart_id'=p_cart and p_row->>'payment_collection_id'=p_collection
          else false end;
      end $$;
      revoke all on function public.rifare_native_scope_row(text,jsonb,text,text,text,text,text,text,text,integer,text,text) from public;`);
    this.addSql(`create function public.rifare_native_scope_protected(p_table text,p_row jsonb) returns boolean
      language plpgsql stable security definer set search_path=pg_catalog as $$
      begin
        return exists(select 1 from public.rifare_operation o where o.execution_owner_fingerprint is not null and
          case p_table
            when 'cart' then p_row->>'id'=o.cart_id
              or p_row->'metadata'->>'rifare_execution_owner'=o.execution_owner_fingerprint
            when 'cart_address' then exists(select 1 from public.cart c where (c.id=o.cart_id
                or c.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint)
              and p_row->>'id' in (c.shipping_address_id,c.billing_address_id))
            when 'cart_line_item' then p_row->>'cart_id'=o.cart_id or exists(select 1 from public.cart c
              where c.id=p_row->>'cart_id' and c.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint)
            when 'cart_line_item_adjustment' then exists(select 1 from public.cart_line_item i
              join public.cart c on c.id=i.cart_id where i.id=p_row->>'item_id'
                and (i.cart_id=o.cart_id or c.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint))
            when 'cart_line_item_tax_line' then exists(select 1 from public.cart_line_item i
              join public.cart c on c.id=i.cart_id where i.id=p_row->>'item_id'
                and (i.cart_id=o.cart_id or c.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint))
            when 'cart_shipping_method' then p_row->>'cart_id'=o.cart_id or exists(select 1 from public.cart c
              where c.id=p_row->>'cart_id' and c.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint)
            when 'cart_shipping_method_adjustment' then exists(select 1 from public.cart_shipping_method m
              join public.cart c on c.id=m.cart_id where m.id=p_row->>'shipping_method_id'
                and (m.cart_id=o.cart_id or c.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint))
            when 'cart_shipping_method_tax_line' then exists(select 1 from public.cart_shipping_method m
              join public.cart c on c.id=m.cart_id where m.id=p_row->>'shipping_method_id'
                and (m.cart_id=o.cart_id or c.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint))
            when 'cart_credit_line' then p_row->>'cart_id'=o.cart_id or exists(select 1 from public.cart c
              where c.id=p_row->>'cart_id' and c.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint)
            when 'order' then p_row->>'id'=o.execution_order_id
              or p_row->'metadata'->>'rifare_execution_owner'=o.execution_owner_fingerprint
            when 'order_address' then p_row->'metadata'->>'rifare_execution_owner'=o.execution_owner_fingerprint
            when 'order_line_item' then p_row->'metadata'->>'rifare_execution_owner'=o.execution_owner_fingerprint
            when 'order_item' then p_row->>'order_id'=o.execution_order_id
              or exists(select 1 from public."order" parent where parent.id=p_row->>'order_id'
                and parent.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint)
              or p_row->'metadata'->>'rifare_execution_owner'=o.execution_owner_fingerprint
            when 'order_line_item_adjustment' then exists(select 1 from public.order_line_item i
              where i.id=p_row->>'item_id'
                and i.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint)
            when 'order_line_item_tax_line' then exists(select 1 from public.order_line_item i
              where i.id=p_row->>'item_id'
                and i.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint)
            when 'order_shipping_method' then p_row->'metadata'->>'rifare_execution_owner'=o.execution_owner_fingerprint
            when 'order_shipping' then p_row->>'order_id'=o.execution_order_id
              or exists(select 1 from public."order" parent where parent.id=p_row->>'order_id'
                and parent.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint)
              or exists(select 1 from public.order_shipping_method m
              where m.id=p_row->>'shipping_method_id'
                and m.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint)
            when 'order_shipping_method_adjustment' then exists(select 1 from public.order_shipping_method m
              where m.id=p_row->>'shipping_method_id'
                and m.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint)
            when 'order_shipping_method_tax_line' then exists(select 1 from public.order_shipping_method m
              where m.id=p_row->>'shipping_method_id'
                and m.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint)
            when 'order_summary' then p_row->>'order_id'=o.execution_order_id or exists(select 1 from public."order" parent
              where parent.id=p_row->>'order_id'
                and parent.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint)
            when 'order_credit_line' then p_row->>'order_id'=o.execution_order_id or exists(select 1 from public."order" parent
              where parent.id=p_row->>'order_id'
                and parent.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint)
            when 'order_transaction' then p_row->>'order_id'=o.execution_order_id or exists(select 1 from public."order" parent
              where parent.id=p_row->>'order_id'
                and parent.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint)
            when 'order_promotion' then p_row->>'order_id'=o.execution_order_id or exists(select 1 from public."order" parent
              where parent.id=p_row->>'order_id'
                and parent.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint)
            when 'reservation_item' then p_row->'metadata'->>'rifare_execution_owner'=o.execution_owner_fingerprint
              or exists(select 1 from public.order_item i where i.item_id=p_row->>'line_item_id'
                and i.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint)
            when 'payment_collection' then p_row->>'id'=o.payment_collection_id or exists(select 1 from public.payment_session ps
              where ps.payment_collection_id=p_row->>'id' and ps.data->'rifare_native_execution'->>'handle' is not null
                and 'sha256:' || encode(sha256(convert_to(ps.data->'rifare_native_execution'->>'handle','UTF8')),'hex')
                  =o.execution_payment_handle_fingerprint)
            when 'payment_session' then p_row->>'id'=o.payment_session_id
              or p_row->>'payment_collection_id'=o.payment_collection_id
              or p_row->'data'->'rifare_native_execution'->>'handle' is not null
                and 'sha256:' || encode(sha256(convert_to(p_row->'data'->'rifare_native_execution'->>'handle','UTF8')),'hex')
                  =o.execution_payment_handle_fingerprint
              or exists(select 1 from public.payment_session ps
                where ps.payment_collection_id=p_row->>'payment_collection_id'
                  and ps.data->'rifare_native_execution'->>'handle' is not null
                  and 'sha256:' || encode(sha256(convert_to(ps.data->'rifare_native_execution'->>'handle','UTF8')),'hex')
                    =o.execution_payment_handle_fingerprint)
            when 'payment' then p_row->>'payment_collection_id'=o.payment_collection_id
              or p_row->>'payment_session_id'=o.payment_session_id
              or p_row->'data'->'rifare_native_execution'->>'original_command_id'=o.original_command_uuid
              or exists(select 1 from public.payment_session ps where ps.id=p_row->>'payment_session_id'
                and ps.data->'rifare_native_execution'->>'handle' is not null
                and 'sha256:' || encode(sha256(convert_to(ps.data->'rifare_native_execution'->>'handle','UTF8')),'hex')
                  =o.execution_payment_handle_fingerprint)
              or exists(select 1 from public.payment_session ps
                where ps.payment_collection_id=p_row->>'payment_collection_id'
                  and ps.data->'rifare_native_execution'->>'handle' is not null
                  and 'sha256:' || encode(sha256(convert_to(ps.data->'rifare_native_execution'->>'handle','UTF8')),'hex')
                    =o.execution_payment_handle_fingerprint)
            when 'capture' then exists(select 1 from public.payment p where p.id=p_row->>'payment_id'
              and (p.payment_collection_id=o.payment_collection_id or p.payment_session_id=o.payment_session_id
                or p.data->'rifare_native_execution'->>'original_command_id'=o.original_command_uuid
                or exists(select 1 from public.payment_session ps where ps.id=p.payment_session_id
                  and ps.data->'rifare_native_execution'->>'handle' is not null
                  and 'sha256:' || encode(sha256(convert_to(ps.data->'rifare_native_execution'->>'handle','UTF8')),'hex')
                    =o.execution_payment_handle_fingerprint)))
            when 'refund' then exists(select 1 from public.payment p where p.id=p_row->>'payment_id'
              and (p.payment_collection_id=o.payment_collection_id or p.payment_session_id=o.payment_session_id
                or p.data->'rifare_native_execution'->>'original_command_id'=o.original_command_uuid
                or exists(select 1 from public.payment_session ps where ps.id=p.payment_session_id
                  and ps.data->'rifare_native_execution'->>'handle' is not null
                  and 'sha256:' || encode(sha256(convert_to(ps.data->'rifare_native_execution'->>'handle','UTF8')),'hex')
                    =o.execution_payment_handle_fingerprint)))
            when 'order_cart' then p_row->>'cart_id'=o.cart_id or p_row->>'order_id'=o.execution_order_id
              or exists(select 1 from public.cart c where c.id=p_row->>'cart_id'
                and c.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint)
              or exists(select 1 from public."order" parent where parent.id=p_row->>'order_id'
                and parent.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint)
            when 'order_payment_collection' then p_row->>'payment_collection_id'=o.payment_collection_id
              or p_row->>'order_id'=o.execution_order_id
              or exists(select 1 from public."order" parent where parent.id=p_row->>'order_id'
                and parent.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint)
              or exists(select 1 from public.payment_session ps where ps.payment_collection_id=p_row->>'payment_collection_id'
                and ps.data->'rifare_native_execution'->>'handle' is not null
                and 'sha256:' || encode(sha256(convert_to(ps.data->'rifare_native_execution'->>'handle','UTF8')),'hex')
                  =o.execution_payment_handle_fingerprint)
            when 'cart_payment_collection' then p_row->>'cart_id'=o.cart_id
              or p_row->>'payment_collection_id'=o.payment_collection_id
              or exists(select 1 from public.cart c where c.id=p_row->>'cart_id'
                and c.metadata->>'rifare_execution_owner'=o.execution_owner_fingerprint)
              or exists(select 1 from public.payment_session ps where ps.payment_collection_id=p_row->>'payment_collection_id'
                and ps.data->'rifare_native_execution'->>'handle' is not null
                and 'sha256:' || encode(sha256(convert_to(ps.data->'rifare_native_execution'->>'handle','UTF8')),'hex')
                  =o.execution_payment_handle_fingerprint)
            else false end);
      end $$;
      revoke all on function public.rifare_native_scope_protected(text,jsonb) from public;`);
    this.addSql(`create function public.rifare_guard_native_scope() returns trigger
      language plpgsql security definer set search_path=pg_catalog as $$
      declare original public.rifare_operation%rowtype; selected jsonb; previous jsonb; administrative text;
      begin
        select pg_get_userbyid(relowner) into administrative from pg_catalog.pg_class where oid='public.rifare_operation'::regclass;
        if session_user::text=administrative then return coalesce(NEW,OLD); end if;
        selected := case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
        previous := case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) else null end;
        if session_user::text !~ '^rifare_exec_[a-f0-9]{32}$' then
          if public.rifare_native_scope_protected(TG_TABLE_NAME,selected)
            or previous is not null and public.rifare_native_scope_protected(TG_TABLE_NAME,previous) then
            raise exception 'Native original scope unavailable on %',TG_TABLE_NAME using errcode='42501';
          end if;
          return coalesce(NEW,OLD);
        end if;
        select * into original from public.rifare_operation
          where execution_owner_fingerprint='sha256:' || encode(sha256(convert_to(session_user::text,'UTF8')),'hex');
        if not found then raise exception 'Native original scope unavailable on %',TG_TABLE_NAME using errcode='42501'; end if;
        if TG_OP='DELETE' and TG_TABLE_NAME in ('cart','payment_session') then
          raise exception 'Native original scope unavailable on %',TG_TABLE_NAME using errcode='42501';
        end if;
        if TG_TABLE_NAME='order_shipping_method' and TG_OP<>'DELETE' then
          if previous is not null and previous->'metadata'->>'rifare_execution_owner' is distinct from original.execution_owner_fingerprint
            or not exists(select 1 from public.cart_shipping_method m where m.cart_id=original.cart_id and m.deleted_at is null
              and m.name is not distinct from selected->>'name' and m.description is not distinct from selected->>'description'
              and m.amount is not distinct from (selected->>'amount')::numeric and m.raw_amount is not distinct from selected->'raw_amount'
              and m.is_tax_inclusive is not distinct from (selected->>'is_tax_inclusive')::boolean
              and m.shipping_option_id is not distinct from selected->>'shipping_option_id' and m.data is not distinct from selected->'data'
              and coalesce(m.metadata,'{}'::jsonb) is not distinct from coalesce(selected->'metadata','{}'::jsonb)-'rifare_execution_owner') then
            raise exception 'Native original scope unavailable on %',TG_TABLE_NAME using errcode='42501';
          end if;
          NEW.metadata := coalesce(NEW.metadata,'{}'::jsonb) || jsonb_build_object('rifare_execution_owner',original.execution_owner_fingerprint);
          selected := to_jsonb(NEW);
        end if;
        if TG_TABLE_NAME='cart' and TG_OP<>'DELETE' then
          if selected->>'id' is distinct from original.cart_id
            or previous is not null and previous->'metadata'->>'rifare_execution_owner' is distinct from original.execution_owner_fingerprint then
            raise exception 'Native original scope unavailable on %',TG_TABLE_NAME using errcode='42501';
          end if;
          NEW.metadata := coalesce(NEW.metadata,'{}'::jsonb) || jsonb_build_object('rifare_execution_owner',original.execution_owner_fingerprint);
          selected := to_jsonb(NEW);
        end if;
        if public.rifare_native_scope_row(TG_TABLE_NAME,selected,original.execution_owner_fingerprint,original.cart_id,
            original.execution_order_id,original.payment_collection_id,original.payment_session_id,original.currency,
            original.payable_minor_units,original.currency_exponent,original.execution_payment_handle_fingerprint,
            original.original_command_uuid) is distinct from true
          or previous is not null and public.rifare_native_scope_row(TG_TABLE_NAME,previous,original.execution_owner_fingerprint,
            original.cart_id,original.execution_order_id,original.payment_collection_id,original.payment_session_id,original.currency,
            original.payable_minor_units,original.currency_exponent,original.execution_payment_handle_fingerprint,
            original.original_command_uuid) is distinct from true then
          raise exception 'Native original scope unavailable on %',TG_TABLE_NAME using errcode='42501';
        end if;
        return coalesce(NEW,OLD);
      end $$;
      revoke all on function public.rifare_guard_native_scope() from public;`);
    this.addSql(`create function public.rifare_install_native_scope_fences() returns void
      language plpgsql set search_path=pg_catalog as $$
      declare target text; relation_oid oid; begin
        if current_user is distinct from pg_get_userbyid((select relowner from pg_catalog.pg_class where oid='public.rifare_operation'::regclass)) then
          raise exception 'Native scope provisioning owner required' using errcode='42501'; end if;
        foreach target in array array[
          'cart','cart_address','cart_line_item','cart_line_item_adjustment','cart_line_item_tax_line','cart_shipping_method',
          'cart_shipping_method_adjustment','cart_shipping_method_tax_line','cart_credit_line','order','order_address','order_item',
          'order_line_item','order_line_item_adjustment','order_line_item_tax_line','order_shipping','order_shipping_method',
          'order_shipping_method_adjustment','order_shipping_method_tax_line','order_summary','order_credit_line','order_transaction',
          'reservation_item','payment_collection','payment_session','payment','capture','refund','order_cart',
          'order_payment_collection','order_promotion','cart_payment_collection'] loop
          relation_oid := to_regclass(format('public.%I',target));
          if relation_oid is not null and not exists(select 1 from pg_catalog.pg_trigger where tgrelid=relation_oid and tgname='rifare_native_scope') then
            execute format('create trigger rifare_native_scope before insert or update or delete on public.%I for each row execute function public.rifare_guard_native_scope()',target);
          end if;
        end loop; end $$;
      revoke all on function public.rifare_install_native_scope_fences() from public;
      select public.rifare_install_native_scope_fences();`);
    this.addSql(`create function public.rifare_native_scope_ready() returns boolean
      language plpgsql stable set search_path=pg_catalog as $$
      declare target text; relation_oid oid; guard oid := to_regprocedure('public.rifare_guard_native_scope()');
        membership oid := to_regprocedure('public.rifare_native_scope_protected(text,jsonb)'); begin
        if guard is null or membership is null or has_function_privilege('public',guard,'EXECUTE')
          or has_function_privilege('public',membership,'EXECUTE') then return false; end if;
        foreach target in array array[
          'cart','cart_address','cart_line_item','cart_line_item_adjustment','cart_line_item_tax_line','cart_shipping_method',
          'cart_shipping_method_adjustment','cart_shipping_method_tax_line','cart_credit_line','order','order_address','order_item',
          'order_line_item','order_line_item_adjustment','order_line_item_tax_line','order_shipping','order_shipping_method',
          'order_shipping_method_adjustment','order_shipping_method_tax_line','order_summary','order_credit_line','order_transaction',
          'reservation_item','payment_collection','payment_session','payment','capture','refund','order_cart',
          'order_payment_collection','order_promotion','cart_payment_collection'] loop
          relation_oid := to_regclass(format('public.%I',target));
          if relation_oid is not null and not exists(select 1 from pg_catalog.pg_trigger where tgrelid=relation_oid
            and tgname='rifare_native_scope' and tgfoid=guard and tgtype=31 and tgenabled='O') then return false; end if;
        end loop;
        return true; end $$;`);
  }

  override async down(): Promise<void> {
    this.addSql(`do $$ declare target text; relation_oid oid; begin
      if exists(select 1 from public.rifare_operation where execution_owner_fingerprint is not null) then
        raise exception 'Original execution records require scope-fence retention'; end if;
      foreach target in array array[
        'cart','cart_address','cart_line_item','cart_line_item_adjustment','cart_line_item_tax_line','cart_shipping_method',
        'cart_shipping_method_adjustment','cart_shipping_method_tax_line','cart_credit_line','order','order_address','order_item',
        'order_line_item','order_line_item_adjustment','order_line_item_tax_line','order_shipping','order_shipping_method',
        'order_shipping_method_adjustment','order_shipping_method_tax_line','order_summary','order_credit_line','order_transaction',
        'reservation_item','payment_collection','payment_session','payment','capture','refund','order_cart',
        'order_payment_collection','order_promotion','cart_payment_collection'] loop
        relation_oid := to_regclass(format('public.%I',target));
        if relation_oid is not null then execute format('drop trigger rifare_native_scope on public.%I',target); end if;
      end loop; end $$;
      drop function public.rifare_native_scope_ready(); drop function public.rifare_install_native_scope_fences();
      drop function public.rifare_guard_native_scope();
      drop function public.rifare_native_scope_protected(text,jsonb);
      drop function public.rifare_native_scope_row(text,jsonb,text,text,text,text,text,text,text,integer,text,text);`);
  }
}
