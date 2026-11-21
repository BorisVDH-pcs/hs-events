-- ============================================================
-- Only from: a tile's drops count from these monsters only
-- ============================================================
-- Boris, 2026-11-21, after his live test: a Kalphite Queen "Dragon pickaxe"
-- tile should not be completed by a Dragon pickaxe from Callisto. Per tile,
-- on catalogue tiles too. Left empty, a drop counts from any monster, as
-- before, so no existing tile changes.
--
-- Only Dink is checked. Dink names the monster with every loot drop
-- (extra.source); an upload on the site is judged by the organiser, as
-- before, and add_evidence is not touched.
--
-- No existing function is rewritten. A board tile already remembers the
-- catalogue entry it came from (tiles.library_id), so a trigger copies the
-- entry's list onto a tile when it is placed: the site, autofill and a
-- preset all place tiles that way. Shuffle and swap move rows, and the list
-- moves with its tile. The site saves a list through two wrappers that call
-- the existing save functions first, so every rule of theirs still holds,
-- and reads it through two functions of its own, as admin_evidence_sources
-- does for the review screen.

-- ------------------------------------------------------------
-- 1. Where the list is kept
-- ------------------------------------------------------------
-- Null on a board tile: never set, the same as empty. Names as the
-- organiser typed them; compared with drop_key, as drop labels are.

alter table tile_library add column if not exists drop_from text[] not null default '{}';
alter table tiles        add column if not exists drop_from text[];

comment on column tile_library.drop_from is
  'Only from: a drop sent by Dink counts only when it came from one of these monsters. Empty: from any.';
comment on column tiles.drop_from is
  'Only from, as on tile_library. Null or empty: from any monster.';

-- ------------------------------------------------------------
-- 2. The list, cleaned
-- ------------------------------------------------------------
-- A JSON array of names: trimmed, blanks dropped, one of each (by drop_key,
-- the first spelling kept). Anything else is refused in words an organiser
-- can act on.

create or replace function drop_from_clean(p_list jsonb)
returns text[]
language plpgsql immutable
set search_path = public
as $$
declare
  v_out  text[] := '{}';
  v_keys text[] := '{}';
  v_el   jsonb;
  v_name text;
  v_key  text;
begin
  if p_list is null or jsonb_typeof(p_list) = 'null' then
    return '{}';
  end if;
  if jsonb_typeof(p_list) <> 'array' then
    raise exception '"Only from" must be a list of monster names';
  end if;
  for v_el in select value from jsonb_array_elements(p_list) loop
    if jsonb_typeof(v_el) <> 'string' then
      raise exception '"Only from" must be a list of monster names';
    end if;
    v_name := btrim(regexp_replace(v_el #>> '{}', '\s+', ' ', 'g'));
    continue when v_name = '';
    if length(v_name) > 80 then
      raise exception '"%…" is too long for a monster name', left(v_name, 30);
    end if;
    v_key := drop_key(v_name);
    if v_key is null then
      raise exception '"%" is not a monster name', v_name;
    end if;
    continue when v_key = any(v_keys);
    v_keys := v_keys || v_key;
    v_out  := v_out || v_name;
  end loop;
  if cardinality(v_out) > 20 then
    raise exception '"Only from" takes at most 20 monsters';
  end if;
  return v_out;
end;
$$;

-- ------------------------------------------------------------
-- 3. A placed tile takes its catalogue entry's list
-- ------------------------------------------------------------
-- On insert, when nothing was given, and when a square is given another
-- catalogue entry (admin_set_tile's "on conflict" update). Editing a tile
-- that keeps its entry leaves its own list alone.

create or replace function tiles_take_drop_from()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.library_id is not null
     and (tg_op = 'INSERT' and new.drop_from is null
          or tg_op = 'UPDATE' and new.library_id is distinct from old.library_id) then
    select l.drop_from into new.drop_from from tile_library l where l.id = new.library_id;
  end if;
  return new;
end;
$$;

drop trigger if exists tiles_take_drop_from on tiles;
create trigger tiles_take_drop_from
  before insert or update of library_id on tiles
  for each row execute function tiles_take_drop_from();

-- ------------------------------------------------------------
-- 4. Saving: the existing functions first, then the list
-- ------------------------------------------------------------
-- p_tile is what the site already sends, with "dropFrom" beside the rest
-- (its keys are camelCase: libraryId, perSet, maxTimes). Without that key the
-- list is left as it is. A refusal from the existing
-- function (not your game, a claimed square, a locked board) stops
-- everything, so its rules are the only ones.

create or replace function admin_set_tile_with_from(
  p_game_id uuid, p_row smallint, p_col smallint, p_tile jsonb)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid := admin_set_tile(p_game_id, p_row, p_col, p_tile);
begin
  if p_tile ? 'dropFrom' then
    update tiles set drop_from = drop_from_clean(p_tile -> 'dropFrom') where id = v_id;
  end if;
  return v_id;
end;
$$;

create or replace function admin_save_library_tile_with_from(p_id uuid, p_tile jsonb)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid := admin_save_library_tile(p_id, p_tile);
begin
  if p_tile ? 'dropFrom' then
    update tile_library set drop_from = drop_from_clean(p_tile -> 'dropFrom') where id = v_id;
  end if;
  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- 5. Reading: the same gates as admin_list_tiles and admin_list_library
-- ------------------------------------------------------------
-- Only tiles with a list; the site treats any other as "from any monster".

create or replace function admin_tiles_drop_from(p_game_id uuid)
returns table (tile_id uuid, drop_from text[])
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not may_manage_game(p_game_id) then raise exception 'Not your game'; end if;
  return query
    select t.id, t.drop_from from tiles t
     where t.game_id = p_game_id and cardinality(t.drop_from) > 0;
end;
$$;

create or replace function admin_library_drop_from()
returns table (library_id uuid, drop_from text[])
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not (is_admin() or is_moderator()) then raise exception 'Organisers only'; end if;
  return query
    select l.id, l.drop_from from tile_library l where cardinality(l.drop_from) > 0;
end;
$$;

-- ------------------------------------------------------------
-- 6. Matching
-- ------------------------------------------------------------
-- May a drop from p_from count for this tile? Yes when the tile has no list,
-- and when Dink named no monster: a pet notification names none, and every
-- pet comes from one place anyway. Otherwise one of the names has to be the
-- monster's, or the start of it in whole words, so "Tombs of Amascut" also
-- covers "Tombs of Amascut: Expert Mode". Internal.

create or replace function plugin_from_ok(p_tile_id uuid, p_from text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when drop_key(p_from) is null then true
    else coalesce((
      select cardinality(coalesce(t.drop_from, '{}')) = 0
          or exists (select 1 from unnest(t.drop_from) f
                      where drop_key(f) = drop_key(p_from)
                         or starts_with(drop_key(p_from), drop_key(f) || ' '))
        from tiles t where t.id = p_tile_id), false)
  end;
$$;

-- plugin_match as in 20261121120100, with one more condition: each item
-- carries the monster it came from ("from"), and a tile whose list leaves
-- that monster out does not want it. Such a drop gets the answer a drop no
-- tile wants gets, so it tells nothing about any tile. An intake that sends
-- no "from" is matched as before.

create or replace function plugin_match(p_token text, p_rsn text, p_items jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_me uuid := plugin_as(p_token);
begin
  if not plugin_rsn_ok(p_rsn) then
    return jsonb_build_object('account_ok', false, 'items', '[]'::jsonb);
  end if;

  return jsonb_build_object('account_ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'name', i.val ->> 'name',
             'verdict', case m.n when 0 then 'none' when 1 then 'one' else 'ask' end,
             'matches', m.matches)
           order by i.ord)
      from jsonb_array_elements(
             case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end)
           with ordinality as i(val, ord)
      cross join lateral (
        select count(*)::int as n,
               coalesce(jsonb_agg(jsonb_build_object(
                          'game_id', w.game_id, 'tile_id', w.tile_id, 'tile', w.tile_name,
                          'option_id', w.option_id, 'label', w.label)
                        order by w.tile_position), '[]'::jsonb) as matches
          from plugin_wanted() w
         where w.drop = drop_key(i.val ->> 'name')
           and plugin_from_ok(w.tile_id, i.val ->> 'from')) m
  ), '[]'::jsonb));
end;
$$;

-- Where a drop two tiles want can go: the same condition, so a tile whose
-- list leaves the monster out is never offered on the site. plugin_wait
-- passes Dink's report's "from"; plugin_wait_open asks without it, which
-- only counts the tiles before the drop is stored.

drop function if exists plugin_wait_choices(text);
create or replace function plugin_wait_choices(p_item text, p_from text default null)
returns table (game_id uuid, team_id uuid, tile_id uuid, option_id uuid)
language sql stable security definer
set search_path = public
as $$
  select w.game_id, w.team_id, w.tile_id, w.option_id
    from plugin_wanted() w
   where w.drop = drop_key(p_item)
     and plugin_from_ok(w.tile_id, p_from);
$$;

-- plugin_wait as in 20261121120100, asking plugin_wait_choices with the
-- monster from the report.

create or replace function plugin_wait(
  p_token text, p_rsn text, p_item text, p_storage_path text, p_detail jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_me      uuid := plugin_as(p_token);
  v_source  text := case when p_detail ->> 'source' = 'dink' then 'dink' else 'plugin' end;
  v_dedupe  text := nullif(btrim(coalesce(p_detail ->> 'dedupe', '')), '');
  v_result  jsonb;
  v_n       int;
  v_games   int;
  v_game    uuid;
  v_team    uuid;
  v_choices jsonb;
  v_id      uuid;
begin
  if v_dedupe is null then
    raise exception 'A submission needs a dedupe key';
  end if;

  -- Sent twice: kept once. As in plugin_submit.
  perform pg_advisory_xact_lock(hashtextextended(v_me::text || ':' || v_dedupe, 0));
  select l.result into v_result
    from plugin_intake_log l
   where l.profile_id = v_me and l.dedupe_key = v_dedupe;
  if found then
    return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('duplicate', true);
  end if;

  if not plugin_rsn_ok(p_rsn) then
    raise exception 'That in-game name is not on your account list. Add it under My Account.';
  end if;
  select count(*), count(distinct c.game_id), min(c.game_id::text)::uuid, min(c.team_id::text)::uuid,
         jsonb_agg(jsonb_build_object('tile_id', c.tile_id, 'option_id', c.option_id) order by c.tile_id)
    into v_n, v_games, v_game, v_team, v_choices
    from plugin_wait_choices(p_item, p_detail ->> 'from') c;
  if v_n < 2 or v_games <> 1 then
    raise exception 'That drop does not count for an open tile';
  end if;
  -- In the team's own folder, so only the team can read it (0021's policy).
  if position(v_game || '/' || v_team || '/waiting/' in coalesce(p_storage_path, '')) <> 1
     or p_storage_path like '%..%' then
    raise exception 'That screenshot path does not belong to this drop';
  end if;

  insert into plugin_waiting (game_id, team_id, profile_id, item, detail, storage_path, choices)
  values (v_game, v_team, v_me, p_item, coalesce(p_detail, '{}'::jsonb) - 'dedupe', p_storage_path, v_choices)
  returning id into v_id;

  v_result := jsonb_build_object('waiting_id', v_id, 'choices', v_n);
  insert into plugin_intake_log (profile_id, source, dedupe_key, result)
  values (v_me, v_source, v_dedupe, v_result);
  return v_result || jsonb_build_object('duplicate', false);
end;
$$;

-- plugin_submit as in 20261121120100, refusing a drop whose monster the
-- tile's list leaves out, with the answer a drop for no tile gets. The
-- intake only gets here for a tile plugin_match offered, so this is the
-- second lock on the same door: a list changed in between, a request made
-- by hand with the service role.

create or replace function plugin_submit(
  p_token text, p_rsn text, p_tile_id uuid, p_option_id uuid, p_item text,
  p_storage_path text, p_public_url text, p_detail jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_me     uuid := plugin_as(p_token);
  v_source text := case when p_detail ->> 'source' = 'dink' then 'dink' else 'plugin' end;
  v_dedupe text := nullif(btrim(coalesce(p_detail ->> 'dedupe', '')), '');
  v        plugin_wanted_row;
  v_claim  uuid;
  v_before timestamptz := clock_timestamp();
  v_result jsonb;
  v_ev     uuid;
begin
  if v_dedupe is null then
    raise exception 'A submission needs a dedupe key';
  end if;

  -- Sent twice: answer what was answered the first time, and count it once.
  -- The lock makes two copies arriving together take turns.
  perform pg_advisory_xact_lock(hashtextextended(v_me::text || ':' || v_dedupe, 0));
  select l.result into v_result
    from plugin_intake_log l
   where l.profile_id = v_me and l.dedupe_key = v_dedupe;
  if found then
    return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('duplicate', true);
  end if;

  v := plugin_check(p_rsn, p_tile_id, p_option_id, p_item);
  if not plugin_from_ok(p_tile_id, p_detail ->> 'from') then
    raise exception 'That drop does not count for an open tile';
  end if;
  v_claim := plugin_open_tile(p_tile_id);

  perform set_config('hs.evidence_source', v_source, true);
  perform set_config('hs.evidence_detail', (coalesce(p_detail, '{}'::jsonb) - 'dedupe')::text, true);
  v_result := add_evidence(v_claim, p_storage_path, p_public_url, p_option_id, null);
  perform set_config('hs.evidence_source', '', true);
  perform set_config('hs.evidence_detail', '', true);

  select e.id into v_ev
    from tile_evidence e
   where e.claim_id = v_claim and e.storage_path = p_storage_path;

  insert into plugin_intake_log (profile_id, source, dedupe_key, tile_id, evidence_id, result)
  values (v_me, v_source, v_dedupe, p_tile_id, v_ev, v_result);

  return v_result || jsonb_build_object('duplicate', false);
end;
$$;

-- ------------------------------------------------------------
-- 7. Who may call what
-- ------------------------------------------------------------
-- The wrappers and readers: signed-in callers, gated inside as the functions
-- they stand beside. The helpers: nobody from outside. The plugin's own, as
-- in 20261121120100: the service role only.

revoke execute on function drop_from_clean(jsonb)                     from public, anon, authenticated, service_role;
revoke execute on function tiles_take_drop_from()                     from public, anon, authenticated, service_role;
revoke execute on function plugin_from_ok(uuid, text)                 from public, anon, authenticated, service_role;
revoke execute on function plugin_wait_choices(text, text)            from public, anon, authenticated, service_role;

revoke execute on function admin_set_tile_with_from(uuid, smallint, smallint, jsonb) from public, anon, service_role;
revoke execute on function admin_save_library_tile_with_from(uuid, jsonb)            from public, anon, service_role;
revoke execute on function admin_tiles_drop_from(uuid)                               from public, anon, service_role;
revoke execute on function admin_library_drop_from()                                 from public, anon, service_role;
grant  execute on function admin_set_tile_with_from(uuid, smallint, smallint, jsonb) to authenticated;
grant  execute on function admin_save_library_tile_with_from(uuid, jsonb)            to authenticated;
grant  execute on function admin_tiles_drop_from(uuid)                               to authenticated;
grant  execute on function admin_library_drop_from()                                 to authenticated;

revoke execute on function plugin_match(text, text, jsonb)                           from public, anon, authenticated;
revoke execute on function plugin_wait(text, text, text, text, jsonb)                from public, anon, authenticated;
revoke execute on function plugin_submit(text, text, uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant  execute on function plugin_match(text, text, jsonb)                           to service_role;
grant  execute on function plugin_wait(text, text, text, text, jsonb)                to service_role;
grant  execute on function plugin_submit(text, text, uuid, uuid, text, text, text, jsonb) to service_role;
