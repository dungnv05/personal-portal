-- supabase/migrations/20261125000000_game_saves.sql
-- APPLY ONCE (create policy is not idempotent). Not applied by bots; needs TA + Security + Yun OK (plan B5).
-- Size: API contract is 65536 bytes of compact JSON; 131072 gives headroom for jsonb::text formatting.
create table if not exists public.game_saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  game text not null check (game in ('vang-vong')),
  slot smallint not null check (slot between 0 and 2),
  data jsonb not null,
  version integer not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, game, slot),
  constraint game_saves_data_size check (octet_length(data::text) <= 131072)
);
alter table public.game_saves enable row level security;
revoke all on public.game_saves from anon;
create policy "game_saves_select_own" on public.game_saves for select to authenticated using ((select auth.uid()) = user_id);
create policy "game_saves_insert_own" on public.game_saves for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "game_saves_update_own" on public.game_saves for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "game_saves_delete_own" on public.game_saves for delete to authenticated using ((select auth.uid()) = user_id);
create or replace function public.game_saves_touch() returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at := now(); return new; end $$;
create trigger game_saves_touch before update on public.game_saves for each row execute function public.game_saves_touch();
