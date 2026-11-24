import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** Permit the per-original worker to persist only its sealed complete-cart
 * checkpoint. Native commerce guards remain the effect boundary. */
export class Migration20261123220000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create function public.rifare_native_workflow_allowed(p_workflow text,p_transaction text) returns boolean
      language sql stable security definer set search_path=pg_catalog as $$
        select case when session_user::text !~ '^rifare_exec_[a-f0-9]{32}$' then true else exists(
          select 1 from public.rifare_operation o
          where o.execution_owner_fingerprint='sha256:' || encode(sha256(convert_to(session_user::text,'UTF8')),'hex')
            and o.execution_seal_fingerprint='sha256:' || encode(sha256(convert_to(p_transaction,'UTF8')),'hex')
            and p_workflow='complete-cart' and o.state='unknown' and o.execution_generation=1
            and o.execution_revoked_at is null and o.execution_claimed_at is not null and o.execution_expires_at is not null
            and clock_timestamp() >= o.execution_claimed_at and clock_timestamp() < o.execution_expires_at)
        end
      $$;
      grant execute on function public.rifare_native_workflow_allowed(text,text) to public;`);
    this.addSql(`create function public.rifare_install_native_workflow_fence() returns void
      language plpgsql set search_path=pg_catalog as $$
      begin
        if current_user is distinct from pg_get_userbyid((select relowner from pg_catalog.pg_class where oid='public.rifare_operation'::regclass)) then
          raise exception 'Native workflow provisioning owner required' using errcode='42501';
        end if;
        if to_regclass('public.workflow_execution') is null then return; end if;
        alter table public.workflow_execution enable row level security;
        alter table public.workflow_execution force row level security;
        if not exists(select 1 from pg_catalog.pg_policy where polrelid='public.workflow_execution'::regclass
          and polname='rifare_native_workflow_base') then
          create policy rifare_native_workflow_base on public.workflow_execution as permissive for all to public
            using (true) with check (true);
        end if;
        if not exists(select 1 from pg_catalog.pg_policy where polrelid='public.workflow_execution'::regclass
          and polname='rifare_native_workflow_execution') then
          create policy rifare_native_workflow_execution on public.workflow_execution as restrictive for all to public
            using (public.rifare_native_workflow_allowed(workflow_id,transaction_id))
            with check (public.rifare_native_workflow_allowed(workflow_id,transaction_id));
        end if;
      end $$;
      revoke all on function public.rifare_install_native_workflow_fence() from public;
      select public.rifare_install_native_workflow_fence();`);
    this.addSql(`create function public.rifare_native_workflow_ready() returns boolean
      language sql stable set search_path=pg_catalog as $$
        select to_regclass('public.workflow_execution') is not null
          and exists(select 1 from pg_catalog.pg_class where oid='public.workflow_execution'::regclass
            and relrowsecurity and relforcerowsecurity)
          and (select count(*) from pg_catalog.pg_policy where polrelid='public.workflow_execution'::regclass)=2
          and exists(select 1 from pg_catalog.pg_policy where polrelid='public.workflow_execution'::regclass
            and polname='rifare_native_workflow_base' and polcmd='*' and polpermissive and polroles='{0}'::oid[]
            and pg_get_expr(polqual,polrelid)='true' and pg_get_expr(polwithcheck,polrelid)='true')
          and exists(select 1 from pg_catalog.pg_policy where polrelid='public.workflow_execution'::regclass
            and polname='rifare_native_workflow_execution' and polcmd='*' and not polpermissive and polroles='{0}'::oid[]
            and replace(pg_get_expr(polqual,polrelid),' ','')='public.rifare_native_workflow_allowed((workflow_id)::text,(transaction_id)::text)'
            and replace(pg_get_expr(polwithcheck,polrelid),' ','')='public.rifare_native_workflow_allowed((workflow_id)::text,(transaction_id)::text)')
          and to_regprocedure('public.rifare_native_workflow_allowed(text,text)') is not null
          and has_function_privilege('public','public.rifare_native_workflow_allowed(text,text)','EXECUTE')
      $$;`);
  }

  override async down(): Promise<void> {
    this.addSql(`do $$ begin
      if exists(select 1 from public.rifare_operation where execution_owner_fingerprint is not null) then
        raise exception 'Original execution records require workflow-fence retention';
      end if;
      if to_regclass('public.workflow_execution') is not null then
        drop policy if exists rifare_native_workflow_execution on public.workflow_execution;
        drop policy if exists rifare_native_workflow_base on public.workflow_execution;
        alter table public.workflow_execution no force row level security;
        alter table public.workflow_execution disable row level security;
      end if;
    end $$;
    drop function public.rifare_native_workflow_ready();
    drop function public.rifare_install_native_workflow_fence();
    drop function public.rifare_native_workflow_allowed(text,text);`);
  }
}
