-- supabase/tests/game_saves_test.sql
-- Never run against production. Run with psql against a local supabase db after applying the migration twice.
begin;

-- 1. Two fake users
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-0000000000a1', 'a1@test.invalid'),
  ('00000000-0000-0000-0000-0000000000a2', 'a2@test.invalid')
on conflict do nothing;

-- 2. Act as user A
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text,
  true
);

-- 3. Insert for A: version=99, old updated_at, non-null previous_data -> trigger resets to version=1, now(), previous_* null
do $$
declare
  v_row public.game_saves%rowtype;
begin
  insert into public.game_saves (
    user_id, game, slot, data, version, updated_at, previous_data
  )
  values (
    '00000000-0000-0000-0000-0000000000a1',
    'vang-vong',
    0,
    '{"a":1}'::jsonb,
    99,
    '2000-01-01T00:00:00Z'::timestamptz,
    '{"x":1}'::jsonb
  )
  returning * into v_row;

  if v_row.version <> 1 then
    raise exception 'FAIL case 3: expected version = 1, got %', v_row.version;
  end if;
  if v_row.updated_at <= '2020-01-01T00:00:00Z'::timestamptz then
    raise exception 'FAIL case 3: expected updated_at > 2020-01-01, got %', v_row.updated_at;
  end if;
  if v_row.previous_data is not null then
    raise exception 'FAIL case 3: expected previous_data is null, got %', v_row.previous_data;
  end if;

  raise notice 'PASS case 3: insert sets version=1, fresh updated_at, null previous_data (trigger runs with EXECUTE revoked)';
end
$$;

-- 4. Update with version=2 and client-sent previous_data -> previous_* populated from old row
do $$
declare
  v_row public.game_saves%rowtype;
begin
  update public.game_saves
  set
    data = '{"b":2}'::jsonb,
    version = 2,
    previous_data = '{"spoof":true}'::jsonb
  where user_id = '00000000-0000-0000-0000-0000000000a1'
    and game = 'vang-vong'
    and slot = 0
  returning * into v_row;

  if v_row.version <> 2 then
    raise exception 'FAIL case 4: expected version = 2, got %', v_row.version;
  end if;
  if v_row.previous_version <> 1 then
    raise exception 'FAIL case 4: expected previous_version = 1, got %', v_row.previous_version;
  end if;
  if v_row.previous_data is distinct from '{"a":1}'::jsonb then
    raise exception 'FAIL case 4: expected previous_data = {"a":1}, got %', v_row.previous_data;
  end if;

  raise notice 'PASS case 4: update sets version=2, previous_version=1, previous_data overwritten with old data';
end
$$;

-- 5. Update with version=5 (not old.version + 1) must raise
do $$
declare
  v_raised boolean := false;
begin
  begin
    update public.game_saves
    set
      data = '{"c":3}'::jsonb,
      version = 5
    where user_id = '00000000-0000-0000-0000-0000000000a1'
      and game = 'vang-vong'
      and slot = 0;
  exception
    when others then
      v_raised := true;
  end;

  if not v_raised then
    raise exception 'FAIL case 5: update with version=5 should have raised';
  end if;

  raise notice 'PASS case 5: non-sequential version update rejected';
end
$$;

-- 6. Act as user B: cannot select, update, or insert A's rows (RLS)
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
  from public.game_saves
  where user_id = '00000000-0000-0000-0000-0000000000a1';

  if v_cnt <> 0 then
    raise exception 'FAIL case 6: user B saw % rows of user A', v_cnt;
  end if;

  update public.game_saves
  set data = '{"hack":1}'::jsonb, version = 3
  where user_id = '00000000-0000-0000-0000-0000000000a1';
  get diagnostics v_rows = row_count;

  if v_rows <> 0 then
    raise exception 'FAIL case 6: user B updated % rows of user A', v_rows;
  end if;

  begin
    insert into public.game_saves (user_id, game, slot, data)
    values ('00000000-0000-0000-0000-0000000000a1', 'vang-vong', 1, '{"hack":1}'::jsonb);
  exception
    when insufficient_privilege then
      v_raised := true;
    when others then
      v_raised := true;
  end;

  if not v_raised then
    raise exception 'FAIL case 6: user B insert for user A should have raised';
  end if;

  raise notice 'PASS case 6: RLS isolates user B from user A';
end
$$;

-- 7. As authenticated: truncate must raise
do $$
declare
  v_raised boolean := false;
begin
  begin
    execute 'truncate public.game_saves';
  exception
    when insufficient_privilege then
      v_raised := true;
    when others then
      v_raised := true;
  end;

  if not v_raised then
    raise exception 'FAIL case 7: authenticated truncate should have raised';
  end if;

  raise notice 'PASS case 7: authenticated has no TRUNCATE privilege';
end
$$;

-- 8. As anon: select must raise permission error
reset role;
set local role anon;

do $$
declare
  v_raised boolean := false;
begin
  begin
    perform count(*) from public.game_saves;
  exception
    when insufficient_privilege then
      v_raised := true;
    when others then
      v_raised := true;
  end;

  if not v_raised then
    raise exception 'FAIL case 8: anon select should have raised';
  end if;

  raise notice 'PASS case 8: anon has no SELECT privilege';
end
$$;

-- 9. authenticated has no EXECUTE privilege on public.game_saves_guard()
reset role;

do $$
begin
  if has_function_privilege('authenticated', 'public.game_saves_guard()', 'execute') then
    raise exception 'FAIL case 9: authenticated should not have EXECUTE on public.game_saves_guard()';
  end if;

  raise notice 'PASS case 9: authenticated EXECUTE revoked on public.game_saves_guard()';
end
$$;

rollback;
