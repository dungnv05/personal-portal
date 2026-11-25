-- supabase/rollback/20261125100000_pregnancy_profiles_rollback.sql
-- NOT run by bots.
-- WARNING: Dropping public.pregnancy_profiles permanently deletes all saved due dates.
begin;

drop trigger if exists pregnancy_profiles_touch on public.pregnancy_profiles;
drop table if exists public.pregnancy_profiles;
drop function if exists public.pregnancy_profiles_touch();

commit;
