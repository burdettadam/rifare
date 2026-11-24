import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** Scope product-shipping links to products actually present on the claimed cart. */
export class Migration20261123240000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create function public.rifare_native_product_read_allowed(p_product text) returns boolean
      language sql stable security definer set search_path=pg_catalog as $$
        select case when session_user::text !~ '^rifare_exec_[a-f0-9]{32}$' then true else exists(
          select 1 from public.rifare_operation o join public.cart_line_item i
            on i.cart_id=o.cart_id and i.product_id=p_product and i.deleted_at is null
          where o.execution_owner_fingerprint='sha256:' || encode(sha256(convert_to(session_user::text,'UTF8')),'hex')
            and o.state='unknown' and o.execution_generation=1 and o.execution_revoked_at is null
            and o.execution_claimed_at is not null and o.execution_expires_at is not null
            and clock_timestamp() >= o.execution_claimed_at and clock_timestamp() < o.execution_expires_at)
        end
      $$;
      grant execute on function public.rifare_native_product_read_allowed(text) to public;`);
    this.addSql(`create function public.rifare_install_native_product_read_fence() returns void
      language plpgsql set search_path=pg_catalog as $$
      begin
        if current_user is distinct from pg_get_userbyid((select relowner from pg_catalog.pg_class where oid='public.rifare_operation'::regclass)) then
          raise exception 'Native product-read provisioning owner required' using errcode='42501';
        end if;
        if to_regclass('public.product_shipping_profile') is null then return; end if;
        alter table public.product_shipping_profile enable row level security;
        alter table public.product_shipping_profile force row level security;
        if not exists(select 1 from pg_catalog.pg_policy where polrelid='public.product_shipping_profile'::regclass
          and polname='rifare_native_product_read_base') then
          create policy rifare_native_product_read_base on public.product_shipping_profile as permissive for all to public
            using (true) with check (true);
        end if;
        if not exists(select 1 from pg_catalog.pg_policy where polrelid='public.product_shipping_profile'::regclass
          and polname='rifare_native_product_read') then
          create policy rifare_native_product_read on public.product_shipping_profile as restrictive for all to public
            using (public.rifare_native_product_read_allowed(product_id))
            with check (public.rifare_native_product_read_allowed(product_id));
        end if;
      end $$;
      revoke all on function public.rifare_install_native_product_read_fence() from public;
      select public.rifare_install_native_product_read_fence();`);
    this.addSql(`create function public.rifare_native_product_read_ready() returns boolean
      language plpgsql stable set search_path=pg_catalog as $$
      declare relation_oid oid := to_regclass('public.product_shipping_profile');
      begin
        if relation_oid is null then return false; end if;
        return exists(select 1 from pg_catalog.pg_class where oid=relation_oid and relrowsecurity and relforcerowsecurity)
          and (select count(*) from pg_catalog.pg_policy where polrelid=relation_oid)=2
          and exists(select 1 from pg_catalog.pg_policy where polrelid=relation_oid
            and polname='rifare_native_product_read_base' and polcmd='*' and polpermissive and polroles='{0}'::oid[]
            and pg_get_expr(polqual,polrelid)='true' and pg_get_expr(polwithcheck,polrelid)='true')
          and exists(select 1 from pg_catalog.pg_policy where polrelid=relation_oid
            and polname='rifare_native_product_read' and polcmd='*' and not polpermissive and polroles='{0}'::oid[]
            and replace(pg_get_expr(polqual,polrelid),' ','')='public.rifare_native_product_read_allowed((product_id)::text)'
            and replace(pg_get_expr(polwithcheck,polrelid),' ','')='public.rifare_native_product_read_allowed((product_id)::text)')
          and to_regprocedure('public.rifare_native_product_read_allowed(text)') is not null
          and has_function_privilege('public','public.rifare_native_product_read_allowed(text)','EXECUTE');
      end
      $$;`);
  }

  override async down(): Promise<void> {
    this.addSql(`do $$ begin
      if exists(select 1 from public.rifare_operation where execution_owner_fingerprint is not null) then
        raise exception 'Original execution records require product-read-fence retention';
      end if;
      if to_regclass('public.product_shipping_profile') is not null then
        drop policy if exists rifare_native_product_read on public.product_shipping_profile;
        drop policy if exists rifare_native_product_read_base on public.product_shipping_profile;
        alter table public.product_shipping_profile no force row level security;
        alter table public.product_shipping_profile disable row level security;
      end if;
    end $$;
    drop function public.rifare_native_product_read_ready();
    drop function public.rifare_install_native_product_read_fence();
    drop function public.rifare_native_product_read_allowed(text);`);
  }
}
