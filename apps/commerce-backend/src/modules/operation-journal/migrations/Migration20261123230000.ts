import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** Scope the upstream cart-query promotion link to the claimed original cart. */
export class Migration20261123230000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create function public.rifare_native_cart_read_allowed(p_cart text) returns boolean
      language sql stable security definer set search_path=pg_catalog as $$
        select case when session_user::text !~ '^rifare_exec_[a-f0-9]{32}$' then true else exists(
          select 1 from public.rifare_operation o
          where o.execution_owner_fingerprint='sha256:' || encode(sha256(convert_to(session_user::text,'UTF8')),'hex')
            and o.cart_id=p_cart and o.state='unknown' and o.execution_generation=1
            and o.execution_revoked_at is null and o.execution_claimed_at is not null and o.execution_expires_at is not null
            and clock_timestamp() >= o.execution_claimed_at and clock_timestamp() < o.execution_expires_at)
        end
      $$;
      grant execute on function public.rifare_native_cart_read_allowed(text) to public;`);
    this.addSql(`create function public.rifare_install_native_cart_read_fence() returns void
      language plpgsql set search_path=pg_catalog as $$
      begin
        if current_user is distinct from pg_get_userbyid((select relowner from pg_catalog.pg_class where oid='public.rifare_operation'::regclass)) then
          raise exception 'Native cart-read provisioning owner required' using errcode='42501';
        end if;
        if to_regclass('public.cart_promotion') is null then return; end if;
        alter table public.cart_promotion enable row level security;
        alter table public.cart_promotion force row level security;
        if not exists(select 1 from pg_catalog.pg_policy where polrelid='public.cart_promotion'::regclass
          and polname='rifare_native_cart_read_base') then
          create policy rifare_native_cart_read_base on public.cart_promotion as permissive for all to public
            using (true) with check (true);
        end if;
        if not exists(select 1 from pg_catalog.pg_policy where polrelid='public.cart_promotion'::regclass
          and polname='rifare_native_cart_read') then
          create policy rifare_native_cart_read on public.cart_promotion as restrictive for all to public
            using (public.rifare_native_cart_read_allowed(cart_id))
            with check (public.rifare_native_cart_read_allowed(cart_id));
        end if;
      end $$;
      revoke all on function public.rifare_install_native_cart_read_fence() from public;
      select public.rifare_install_native_cart_read_fence();`);
    this.addSql(`create function public.rifare_native_cart_read_ready() returns boolean
      language plpgsql stable set search_path=pg_catalog as $$
      declare relation_oid oid := to_regclass('public.cart_promotion');
      begin
        if relation_oid is null then return false; end if;
        return exists(select 1 from pg_catalog.pg_class where oid=relation_oid
            and relrowsecurity and relforcerowsecurity)
          and (select count(*) from pg_catalog.pg_policy where polrelid=relation_oid)=2
          and exists(select 1 from pg_catalog.pg_policy where polrelid=relation_oid
            and polname='rifare_native_cart_read_base' and polcmd='*' and polpermissive and polroles='{0}'::oid[]
            and pg_get_expr(polqual,polrelid)='true' and pg_get_expr(polwithcheck,polrelid)='true')
          and exists(select 1 from pg_catalog.pg_policy where polrelid=relation_oid
            and polname='rifare_native_cart_read' and polcmd='*' and not polpermissive and polroles='{0}'::oid[]
            and replace(pg_get_expr(polqual,polrelid),' ','')='public.rifare_native_cart_read_allowed((cart_id)::text)'
            and replace(pg_get_expr(polwithcheck,polrelid),' ','')='public.rifare_native_cart_read_allowed((cart_id)::text)')
          and to_regprocedure('public.rifare_native_cart_read_allowed(text)') is not null
          and has_function_privilege('public','public.rifare_native_cart_read_allowed(text)','EXECUTE');
      end
      $$;`);
  }

  override async down(): Promise<void> {
    this.addSql(`do $$ begin
      if exists(select 1 from public.rifare_operation where execution_owner_fingerprint is not null) then
        raise exception 'Original execution records require cart-read-fence retention';
      end if;
      if to_regclass('public.cart_promotion') is not null then
        drop policy if exists rifare_native_cart_read on public.cart_promotion;
        drop policy if exists rifare_native_cart_read_base on public.cart_promotion;
        alter table public.cart_promotion no force row level security;
        alter table public.cart_promotion disable row level security;
      end if;
    end $$;
    drop function public.rifare_native_cart_read_ready();
    drop function public.rifare_install_native_cart_read_fence();
    drop function public.rifare_native_cart_read_allowed(text);`);
  }
}
