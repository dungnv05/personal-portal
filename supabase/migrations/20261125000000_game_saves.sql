-- supabase/migrations/20261125000000_game_saves.sql
-- NOT applied by bots. Yun applies it manually after TA + Security OK. Safe to run twice (idempotent), single transaction.
-- Size: API contract is 65536 bytes of compact JSON; 131072 gives headroom for jsonb::text formatting.
begin;

create table if not exists public.game_saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  game text not null check (game in ('vang-vong')),
  slot smallint not null check (slot between 0 and 2),
  data jsonb not null,
  version integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  previous_data jsonb,
  previous_version integer,
  previous_updated_at timestamptz,
  primary key (user_id, game, slot),
  constraint game_saves_data_size check (octet_length(data::text) <= 131072),
  constraint game_saves_previous_size check (previous_data is null or octet_length(previous_data::text) <= 131072)
);
-- Re-runnable column adds, in case an older shape exists on a dev/branch DB:
alter table public.game_saves add column if not exists previous_data jsonb;
alter table public.game_saves add column if not exists previous_version integer;
alter table public.game_saves add column if not exists previous_updated_at timestamptz;

alter table public.game_saves enable row level security;

revoke all on table public.game_saves from public;
revoke all on table public.game_saves from anon;
revoke all on table public.game_saves from authenticated;
grant select, insert, update, delete on table public.game_saves to authenticated;

drop policy if exists "game_saves_select_own" on public.game_saves;
drop policy if exists "game_saves_insert_own" on public.game_saves;
drop policy if exists "game_saves_update_own" on public.game_saves;
drop policy if exists "game_saves_delete_own" on public.game_saves;
drop policy if exists game_saves_select_own on public.game_saves;
drop policy if exists game_saves_insert_own on public.game_saves;
drop policy if exists game_saves_update_own on public.game_saves;
drop policy if exists game_saves_delete_own on public.game_saves;
create policy game_saves_select_own on public.game_saves for select to authenticated using ((select auth.uid()) = user_id);
create policy game_saves_insert_own on public.game_saves for insert to authenticated with check ((select auth.uid()) = user_id);
create policy game_saves_update_own on public.game_saves for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy game_saves_delete_own on public.game_saves for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.game_saves_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.version := 1;
    new.previous_data := null;
    new.previous_version := null;
    new.previous_updated_at := null;
  else
    if new.user_id <> old.user_id or new.game <> old.game or new.slot <> old.slot then
      raise exception 'game_saves: key change not allowed' using errcode = '23514';
    end if;
    if new.version is distinct from old.version + 1 then
      raise exception 'game_saves: version must be old.version + 1' using errcode = '23514';
    end if;
    new.previous_data := old.data;
    new.previous_version := old.version;
    new.previous_updated_at := old.updated_at;
  end if;
  return new;
end
$$;
revoke execute on function public.game_saves_guard() from public;
revoke execute on function public.game_saves_guard() from anon;
revoke execute on function public.game_saves_guard() from authenticated;

drop trigger if exists game_saves_touch on public.game_saves;
drop trigger if exists game_saves_guard on public.game_saves;
create trigger game_saves_guard before insert or update on public.game_saves
  for each row execute function public.game_saves_guard();
drop function if exists public.game_saves_touch();

commit;

-- Read-only verification after apply (run separately):
-- select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='game_saves' order by 1,2;
--   expect authenticated: DELETE, INSERT, SELECT, UPDATE only; no anon/public rows.
-- select policyname, cmd from pg_policies where schemaname='public' and tablename='game_saves' order by 1;  -- 4 rows
-- select has_function_privilege('authenticated','public.game_saves_guard()','execute');  -- false
