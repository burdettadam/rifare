import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/** Serialize the two parallel upstream remote-link writes per original worker. */
export class Migration20261123260000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create function public.rifare_serialize_native_links() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
      begin if session_user::text ~ '^rifare_exec_[a-f0-9]{32}$' then perform pg_advisory_xact_lock(hashtextextended(session_user::text,0)); end if; return null; end $$;
      revoke all on function public.rifare_serialize_native_links() from public;
      create function public.rifare_install_native_link_serialization() returns void language plpgsql set search_path=pg_catalog as $$
      declare target text; relation_oid oid; begin
        if current_user is distinct from pg_get_userbyid((select relowner from pg_catalog.pg_class where oid='public.rifare_operation'::regclass)) then raise exception 'Native link serialization owner required' using errcode='42501'; end if;
        foreach target in array array['order_cart','order_payment_collection'] loop
          relation_oid := to_regclass(format('public.%I',target));
          if relation_oid is not null then
            if not exists(select 1 from pg_catalog.pg_trigger where tgrelid=relation_oid and tgname='rifare_native_00_serialize') then
              execute format('create trigger rifare_native_00_serialize before insert or update or delete on public.%I for each statement execute function public.rifare_serialize_native_links()',target); end if;
          end if;
        end loop; end $$;
      revoke all on function public.rifare_install_native_link_serialization() from public;
      create function public.rifare_native_link_serialization_ready() returns boolean language plpgsql stable set search_path=pg_catalog as $$
      declare target text; relation_oid oid; serializer oid := to_regprocedure('public.rifare_serialize_native_links()'); begin
        if serializer is null or has_function_privilege('public',serializer,'EXECUTE') then return false; end if;
        foreach target in array array['order_cart','order_payment_collection'] loop relation_oid := to_regclass(format('public.%I',target));
          if relation_oid is null or not exists(select 1 from pg_catalog.pg_trigger where tgrelid=relation_oid and tgname='rifare_native_00_serialize' and tgfoid=serializer and tgtype=30 and tgenabled='O') then return false; end if;
        end loop;
        return (select count(*) from pg_catalog.pg_trigger where tgname='rifare_native_00_serialize' and tgfoid=serializer)=2; end $$;
      select public.rifare_install_native_link_serialization();`);
  }
  override async down(): Promise<void> {
    this.addSql(`do $$ declare target text; begin if exists(select 1 from public.rifare_operation where execution_owner_fingerprint is not null) then raise exception 'Original execution records require link serialization retention'; end if;
      foreach target in array array['order_cart','order_payment_collection'] loop execute format('drop trigger rifare_native_00_serialize on public.%I',target); end loop; end $$;
      drop function public.rifare_native_link_serialization_ready(); drop function public.rifare_install_native_link_serialization(); drop function public.rifare_serialize_native_links();`);
  }
}
