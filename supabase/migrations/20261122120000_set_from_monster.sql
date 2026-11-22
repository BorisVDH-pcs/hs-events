-- ============================================================
-- A drop in several sets counts for the set of the monster it came from
-- ============================================================
-- Boris, 2026-11-22, on the HS Leagues task "Two Uniques From Each DT2 Boss":
-- Chromium ingot and the three Virtus pieces drop from all four DT2 bosses,
-- so they are in all four of the task's sets. They should count, and count
-- by themselves, but only for the boss they came from. Until now Dink's ingot
-- matched all four sets and waited for the team to choose, between four
-- buttons that read the same.
--
-- The rule: when Dink names the monster, and one of a tile's sets has that
-- monster's name, the drop counts only for that set. A set's name is
-- compared as "Only from" compares a monster's: drop_key, and a name covers
-- what starts with it in whole words. When no set of the tile has the
-- monster's name, nothing changes, so a tile whose sets are not named after
-- monsters behaves as before. When the monster's set is already full, the
-- drop counts for no other set: it gets the answer a drop no tile wants gets.
--
-- Only Dink is checked, as with "Only from". An upload on the site is judged
-- by the organiser, and add_evidence is not touched. A pet notification
-- names no monster, and counts as before.
--
-- No existing rule is rewritten. plugin_match, plugin_wait_choices and
-- plugin_submit are those of 20261121160000_only_from.sql, each with this one
-- more condition beside plugin_from_ok. The check reads only the tile a drop
-- already matched, so it adds nothing to what a team can learn: a tile the
-- team cannot see is never matched, and a refusal is worded as every other.

-- ------------------------------------------------------------
-- 1. Is this name the monster's?
-- ------------------------------------------------------------
-- The comparison plugin_from_ok makes, for a set's name. False for no name.
-- Internal.

create or replace function plugin_name_is_monster(p_name text, p_from text)
returns boolean
language sql immutable
set search_path = public
as $$
  select coalesce(drop_key(p_name) = drop_key(p_from)
               or starts_with(drop_key(p_from), drop_key(p_name) || ' '), false);
$$;

-- ------------------------------------------------------------
-- 2. May a drop from p_from count for this option?
-- ------------------------------------------------------------
-- Yes when Dink named no monster. Yes when none of the tile's sets has the
-- monster's name. Otherwise only when the option is in that set. Every set
-- of the tile is read, not only the ones still open, so a full set does not
-- send its boss's drop to another. Internal.

create or replace function plugin_set_ok(p_option_id uuid, p_from text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when drop_key(p_from) is null then true
    else coalesce((
      select plugin_name_is_monster(o.grp, p_from)
          or not exists (select 1 from tile_options s
                          where s.tile_id = o.tile_id
                            and plugin_name_is_monster(s.grp, p_from))
        from tile_options o where o.id = p_option_id), false)
  end;
$$;

-- ------------------------------------------------------------
-- 3. plugin_match, with the set condition
-- ------------------------------------------------------------
-- As in 20261121160000_only_from.sql, with plugin_set_ok beside
-- plugin_from_ok.

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
           and plugin_from_ok(w.tile_id, i.val ->> 'from')
           and plugin_set_ok(w.option_id, i.val ->> 'from')) m
  ), '[]'::jsonb));
end;
$$;

-- ------------------------------------------------------------
-- 4. plugin_wait_choices, with the set condition
-- ------------------------------------------------------------
-- As in 20261121160000_only_from.sql: the same condition, so a set of
-- another monster is never offered on the site. plugin_wait passes Dink's
-- report's "from"; plugin_wait_open asks without it, as before.

create or replace function plugin_wait_choices(p_item text, p_from text default null)
returns table (game_id uuid, team_id uuid, tile_id uuid, option_id uuid)
language sql stable security definer
set search_path = public
as $$
  select w.game_id, w.team_id, w.tile_id, w.option_id
    from plugin_wanted() w
   where w.drop = drop_key(p_item)
     and plugin_from_ok(w.tile_id, p_from)
     and plugin_set_ok(w.option_id, p_from);
$$;

-- ------------------------------------------------------------
-- 5. plugin_submit, with the set condition
-- ------------------------------------------------------------
-- As in 20261121160000_only_from.sql, refusing a drop handed in for another
-- monster's set, with the answer a drop for no tile gets. The intake only
-- gets here for an option plugin_match offered, so this is the second lock
-- on the same door.

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
  if not plugin_from_ok(p_tile_id, p_detail ->> 'from')
     or not plugin_set_ok(p_option_id, p_detail ->> 'from') then
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
-- 6. Who may call what
-- ------------------------------------------------------------
-- The two new helpers: nobody from outside. The three replaced in place keep
-- their grants (same signatures); they are set again here so this file says
-- them in full.

revoke execute on function plugin_name_is_monster(text, text) from public, anon, authenticated, service_role;
revoke execute on function plugin_set_ok(uuid, text)          from public, anon, authenticated, service_role;
revoke execute on function plugin_wait_choices(text, text)    from public, anon, authenticated, service_role;

revoke execute on function plugin_match(text, text, jsonb)                               from public, anon, authenticated;
revoke execute on function plugin_submit(text, text, uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant  execute on function plugin_match(text, text, jsonb)                               to service_role;
grant  execute on function plugin_submit(text, text, uuid, uuid, text, text, text, jsonb) to service_role;
