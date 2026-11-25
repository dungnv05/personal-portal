-- supabase/migrations/20261125100000_pregnancy_profiles.sql
-- NOT applied by bots. Yun applies after TA + Security OK. Safe to run twice (idempotent), single transaction.
begin;

create table if not exists public.pregnancy_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  due_date date,
  updated_at timestamptz not null default now(),
  constraint pregnancy_profiles_due_date_range check (
    due_date is null or (due_date >= date '2020-01-01' and due_date <= date '2100-12-31')
  )
);

alter table public.pregnancy_profiles enable row level security;

revoke all on table public.pregnancy_profiles from public;
revoke all on table public.pregnancy_profiles from anon;
revoke all on table public.pregnancy_profiles from authenticated;
grant select, insert, update, delete on table public.pregnancy_profiles to authenticated;

drop policy if exists pregnancy_profiles_select_own on public.pregnancy_profiles;
drop policy if exists pregnancy_profiles_insert_own on public.pregnancy_profiles;
drop policy if exists pregnancy_profiles_update_own on public.pregnancy_profiles;
drop policy if exists pregnancy_profiles_delete_own on public.pregnancy_profiles;
create policy pregnancy_profiles_select_own on public.pregnancy_profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy pregnancy_profiles_insert_own on public.pregnancy_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy pregnancy_profiles_update_own on public.pregnancy_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy pregnancy_profiles_delete_own on public.pregnancy_profiles for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.pregnancy_profiles_touch() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception 'pregnancy_profiles: user_id change not allowed' using errcode = '23514';
  end if;
  return new;
end
$$;

revoke execute on function public.pregnancy_profiles_touch() from public;
revoke execute on function public.pregnancy_profiles_touch() from anon;
revoke execute on function public.pregnancy_profiles_touch() from authenticated;

drop trigger if exists pregnancy_profiles_touch on public.pregnancy_profiles;
create trigger pregnancy_profiles_touch before insert or update on public.pregnancy_profiles
  for each row execute function public.pregnancy_profiles_touch();

commit;

-- Read-only verification after apply (run separately):
-- select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='pregnancy_profiles' order by 1,2;
--   expect authenticated: DELETE, INSERT, SELECT, UPDATE only; no anon/public rows.
-- select relname, relrowsecurity from pg_class where oid = 'public.pregnancy_profiles'::regclass;
--   expect relrowsecurity = true.
-- select policyname, cmd from pg_policies where schemaname='public' and tablename='pregnancy_profiles' order by 1;
--   expect 4 rows: pregnancy_profiles_delete_own, pregnancy_profiles_insert_own, pregnancy_profiles_select_own, pregnancy_profiles_update_own.
-- select has_function_privilege('anon','public.pregnancy_profiles_touch()','execute'), has_function_privilege('authenticated','public.pregnancy_profiles_touch()','execute');
--   expect false, false.
-- select proname, proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname = 'pregnancy_profiles_touch';
--   expect proconfig contains search_path=.
