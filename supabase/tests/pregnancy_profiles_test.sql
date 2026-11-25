-- supabase/tests/pregnancy_profiles_test.sql
-- Never run against production. Run with psql against a local supabase db after applying the migration twice.
begin;

-- 1. Two fake users
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-0000000000a1', 'a1@test.invalid'),
  ('00000000-0000-0000-0000-0000000000a2', 'a2@test.invalid')
on conflict do nothing;

-- 2. Act as user A (a1)
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text,
  true
);

-- Case 1: Insert own row ok, updated_at set by trigger even if client sends an old value
do $$
declare
  v_row public.pregnancy_profiles%rowtype;
begin
  insert into public.pregnancy_profiles (user_id, due_date, updated_at)
  values (
    '00000000-0000-0000-0000-0000000000a1',
    date '2026-08-15',
    '2000-01-01T00:00:00Z'::timestamptz
  )
  returning * into v_row;

  if v_row.due_date <> date '2026-08-15' then
    raise exception 'FAIL case 1: expected due_date = 2026-08-15, got %', v_row.due_date;
  end if;
  if v_row.updated_at <= '2020-01-01T00:00:00Z'::timestamptz then
    raise exception 'FAIL case 1: expected updated_at > 2020-01-01, got %', v_row.updated_at;
  end if;

  raise notice 'PASS case 1';
end
$$;

-- Case 2: Update own due_date ok
do $$
declare
  v_row public.pregnancy_profiles%rowtype;
begin
  update public.pregnancy_profiles
  set due_date = date '2026-09-01'
  where user_id = '00000000-0000-0000-0000-0000000000a1'
  returning * into v_row;

  if v_row.due_date <> date '2026-09-01' then
    raise exception 'FAIL case 2: expected due_date = 2026-09-01, got %', v_row.due_date;
  end if;

  raise notice 'PASS case 2';
end
$$;

-- Case 3: Changing user_id raises trigger error (23514)
do $$
declare
  v_raised boolean := false;
begin
  begin
    update public.pregnancy_profiles
    set user_id = '00000000-0000-0000-0000-0000000000a2'
    where user_id = '00000000-0000-0000-0000-0000000000a1';
  exception
    when sqlstate '23514' then
      if sqlerrm <> 'pregnancy_profiles: user_id change not allowed' then
        raise exception 'FAIL case 3: unexpected 23514 message: %', sqlerrm;
      end if;
      v_raised := true;
  end;

  if not v_raised then
    raise exception 'FAIL case 3: changing user_id should have raised';
  end if;

  raise notice 'PASS case 3';
end
$$;

-- Case 4: due_date '2019-12-31' raises (check constraint)
do $$
declare
  v_raised boolean := false;
begin
  begin
    update public.pregnancy_profiles
    set due_date = date '2019-12-31'
    where user_id = '00000000-0000-0000-0000-0000000000a1';
  exception
    when check_violation then
      v_raised := true;
  end;

  if not v_raised then
    raise exception 'FAIL case 4: due_date 2019-12-31 should have raised';
  end if;

  raise notice 'PASS case 4';
end
$$;

-- Case 5: Act as user B (a2): cannot select/update a1's row (0 rows) and cannot insert a row with user_id a1 (raises)
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text,
  true
);

do $$
declare
  v_cnt integer;
  v_rows integer;
  v_raised boolean := false;
begin
  select count(*) into v_cnt
  from public.pregnancy_profiles
  where user_id = '00000000-0000-0000-0000-0000000000a1';

  if v_cnt <> 0 then
    raise exception 'FAIL case 5: user a2 saw % rows of user a1', v_cnt;
  end if;

  update public.pregnancy_profiles
  set due_date = date '2027-01-01'
  where user_id = '00000000-0000-0000-0000-0000000000a1';
  get diagnostics v_rows = row_count;

  if v_rows <> 0 then
    raise exception 'FAIL case 5: user a2 updated % rows of user a1', v_rows;
  end if;

  begin
    insert into public.pregnancy_profiles (user_id, due_date)
    values ('00000000-0000-0000-0000-0000000000a1', date '2027-01-01');
  exception
    when insufficient_privilege then
      v_raised := true;
  end;

  if not v_raised then
    raise exception 'FAIL case 5: user a2 insert for user a1 should have raised';
  end if;

  raise notice 'PASS case 5';
end
$$;

-- Case 6: As authenticated: truncate raises
do $$
declare
  v_raised boolean := false;
begin
  begin
    execute 'truncate public.pregnancy_profiles';
  exception
    when insufficient_privilege then
      v_raised := true;
  end;

  if not v_raised then
    raise exception 'FAIL case 6: authenticated truncate should have raised';
  end if;

  raise notice 'PASS case 6';
end
$$;

-- Case 7: As anon: select raises
reset role;
set local role anon;

do $$
declare
  v_raised boolean := false;
begin
  begin
    perform count(*) from public.pregnancy_profiles;
  exception
    when insufficient_privilege then
      v_raised := true;
  end;

  if not v_raised then
    raise exception 'FAIL case 7: anon select should have raised';
  end if;

  raise notice 'PASS case 7';
end
$$;

-- Case 8: has_function_privilege('authenticated','public.pregnancy_profiles_touch()','execute') is false
reset role;

do $$
begin
  if has_function_privilege('authenticated', 'public.pregnancy_profiles_touch()', 'execute') then
    raise exception 'FAIL case 8: authenticated should not have EXECUTE on public.pregnancy_profiles_touch()';
  end if;

  raise notice 'PASS case 8';
end
$$;

-- Case 9: Trigger user_id guard independent of RLS: same user_id succeeds, different user_id raises trigger error (23514)
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text,
  true
);

do $$
declare
  v_row public.pregnancy_profiles%rowtype;
  v_raised boolean := false;
begin
  update public.pregnancy_profiles
  set user_id = '00000000-0000-0000-0000-0000000000a1'
  where user_id = '00000000-0000-0000-0000-0000000000a1'
  returning * into v_row;

  if not found or v_row.user_id <> '00000000-0000-0000-0000-0000000000a1' then
    raise exception 'FAIL case 9: updating user_id to same id should succeed';
  end if;

  begin
    update public.pregnancy_profiles
    set user_id = '00000000-0000-0000-0000-0000000000a2'
    where user_id = '00000000-0000-0000-0000-0000000000a1';
  exception
    when sqlstate '23514' then
      if sqlerrm <> 'pregnancy_profiles: user_id change not allowed' then
        raise exception 'FAIL case 9: unexpected 23514 message: %', sqlerrm;
      end if;
      v_raised := true;
  end;

  if not v_raised then
    raise exception 'FAIL case 9: changing user_id should have raised trigger error';
  end if;

  raise notice 'PASS case 9';
end
$$;

rollback;
