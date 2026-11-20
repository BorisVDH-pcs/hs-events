-- RuneLite plugin, server part 2: which drops a team wants, and handing one
-- in. docs/runelite-plugin-plan.md, sections 4.4 and 4.5. Needs 001.
--
-- DRAFT. Not in supabase/migrations on purpose, so db-push cannot apply it.
-- It adds two columns to tile_evidence, one trigger on it, one table and new
-- functions. It rewrites no existing function: tiles_for_team,
-- regions_open_tile and add_evidence are called exactly as they are, so every
-- rule they hold applies to a plugin without being written down twice.
--
-- Tested offline by server/test/regions.test.mjs, against a replay of every
-- migration in supabase/migrations.
--
-- Region Bingo only, for now. The other modes are a branch in plugin_open
-- each, added one at a time (plan, section 7).

-- ============================================================
-- 1. Where a piece of evidence came from
-- ============================================================
-- 'web' is the site's uploader and stays the default, so every existing row
-- and every upload from the site is unchanged. 'dink' and 'plugin' mean "sent
-- by a plugin", which is NOT "verified": the data comes from a client the
-- player controls. The screenshot and the revoke button are what they were.

alter table tile_evidence
  add column if not exists source text not null default 'web'
    check (source in ('web', 'dink', 'plugin')),
  add column if not exists detail jsonb;

comment on column tile_evidence.source is
  'web: uploaded on the site. dink / plugin: sent by a RuneLite plugin. Never read as proof.';
comment on column tile_evidence.detail is
  'What the plugin reported with the drop: item, quantity, where it came from, world, in-game name.';

-- add_evidence writes the row and is not touched. plugin_submit leaves the
-- source in two transaction-local settings and this trigger reads them, so the
-- row is still written once and never updated. Nothing a browser can send
-- through PostgREST sets a custom setting, so the site cannot claim a source.
create or replace function evidence_stamp_source()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_source text := nullif(current_setting('hs.evidence_source', true), '');
  v_detail text := nullif(current_setting('hs.evidence_detail', true), '');
begin
  if v_source in ('dink', 'plugin') then
    new.source := v_source;
    new.detail := v_detail::jsonb;
  else
    new.source := 'web';
    new.detail := null;
  end if;
  return new;
end;
$$;

drop trigger if exists evidence_stamp_source on tile_evidence;
create trigger evidence_stamp_source
  before insert on tile_evidence
  for each row execute function evidence_stamp_source();

-- ============================================================
-- 2. plugin_intake_log
-- ============================================================
-- Two jobs: a drop Dink sends twice (it retries after a network error) is
-- counted once, and "why didn't my drop count" has an answer.

create table if not exists plugin_intake_log (
  id          uuid        primary key default gen_random_uuid(),
  profile_id  uuid        not null references profiles(id) on delete cascade,
  received_at timestamptz not null default now(),
  source      text        not null check (source in ('dink', 'plugin')),
  -- Made by the sender from what does not change between retries.
  dedupe_key  text        not null check (char_length(dedupe_key) between 8 and 200),
  tile_id     uuid        references tiles(id) on delete set null,
  evidence_id uuid,
  result      jsonb,
  unique (profile_id, dedupe_key)
);

alter table plugin_intake_log enable row level security;
revoke all on plugin_intake_log from public, anon, authenticated;

-- ============================================================
-- 3. plugin_wanted: the drops the caller's team can hand in right now
-- ============================================================
-- Internal, and only meaningful after plugin_as. Built on tiles_for_team, so
-- the second secret comes along for nothing: a tile in a region the team has
-- not opened is not in the answer, and no new code decides that.
--
-- One row per drop option of every tile the team can see and has not
-- completed, less the options evidence_refusal would turn away (a repeat cap
-- reached, a set already taken).

create or replace function plugin_wanted()
returns table (
  game_id uuid, team_id uuid, tile_id uuid, tile_name text, tile_position int,
  region text, claim_id uuid, option_id uuid, label text, drop text
)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_game uuid;
  v_team uuid;
begin
  -- A loop, not one join: tiles_for_team is only ever called with a team the
  -- caller is really on, never with a null one.
  for v_game in
    select g.id from games g where g.status = 'active' and g.mode = 'regions'
  loop
    v_team := my_team_in_game(v_game);
    continue when v_team is null;

    return query
      select v_game, v_team, t.id, t.name, t."position"::int,
             regions_region_at(t."position"::int), t.claim_id, o.id, o.label, drop_key(o.label)
        from tiles_for_team(v_game, v_team) t
        join tile_options o on o.tile_id = t.id
       where t.revealed
         and t.claim_status is distinct from 'completed'
         and drop_key(o.label) is not null
         and (t.claim_id is null or evidence_refusal(t.claim_id, o.id) is null);
  end loop;
end;
$$;

-- Is this in-game name one the caller has put on their own account list?
create or replace function plugin_rsn_ok(p_rsn text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from profile_accounts a
     where a.profile_id = auth.uid()
       and rsn_key(a.rsn) = rsn_key(p_rsn));
$$;

-- ============================================================
-- 4. plugin_watchlist: what our own plugin keeps in memory
-- ============================================================

create or replace function plugin_watchlist(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_me uuid := plugin_as(p_token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'game_id', g.id, 'game', g.name, 'mode', g.mode, 'ends_at', g.ends_at,
             'team_id', te.id, 'team', te.name,
             'regions', regions_state(g.id, te.id),
             'wanted', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'tile_id', w.tile_id, 'tile', w.tile_name, 'region', w.region,
                        'option_id', w.option_id, 'label', w.label, 'drop', w.drop)
                      order by w.tile_position, w.label)
                 from plugin_wanted() w
                where w.game_id = g.id), '[]'::jsonb))
           order by g.created_at)
      from games g
      join teams te on te.id = my_team_in_game(g.id)
     where g.status = 'active' and g.mode = 'regions'
  ), '[]'::jsonb);
end;
$$;

-- ============================================================
-- 5. plugin_match: what would these drops count for?
-- ============================================================
-- For Dink, which knows nothing of the watch list and sends every drop: the
-- intake function asks this first, and stores a screenshot only for a 'one'.
--
-- p_items is [{"name": "Dharok's helm", ...}, ...]. For each: 'none', 'one' or
-- 'ask' (more than one open tile lists it; the player chooses, never the
-- plugin). A drop for a tile the team cannot see is a 'none', the same answer
-- as for a drop no tile wants at all.

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
         where w.drop = drop_key(i.val ->> 'name')) m
  ), '[]'::jsonb));
end;
$$;

-- ============================================================
-- 6. plugin_open and plugin_submit: handing a drop in
-- ============================================================
-- Two calls, because the storage path holds the claim id and the claim does
-- not exist until the tile is opened:
--
--   plugin_open    checks everything, opens the tile, answers where to store
--   (the intake function uploads the screenshot there)
--   plugin_submit  checks everything again and calls add_evidence
--
-- "Everything" is plugin_check below. The server never takes the plugin's
-- word for which option a drop is: the item's name has to match the option's
-- label, among the options the team may hand in now.

do $type$
begin
  if to_regtype('plugin_wanted_row') is null then
    create type plugin_wanted_row as (
      game_id uuid, team_id uuid, tile_id uuid, claim_id uuid, option_id uuid);
  end if;
end
$type$;

create or replace function plugin_check(
  p_rsn text, p_tile_id uuid, p_option_id uuid, p_item text)
returns plugin_wanted_row
language plpgsql stable security definer
set search_path = public
as $$
declare
  v plugin_wanted_row;
begin
  if not plugin_rsn_ok(p_rsn) then
    raise exception 'That in-game name is not on your account list. Add it under My Account.';
  end if;

  select w.game_id, w.team_id, w.tile_id, w.claim_id, w.option_id
    into v
    from plugin_wanted() w
   where w.tile_id = p_tile_id
     and w.option_id = p_option_id
     and w.drop = drop_key(p_item);

  -- One message for "no such tile", "a tile you cannot see yet", "not that
  -- tile's drop" and "that drop is full": the answer must not tell a locked
  -- tile from one that does not exist.
  if v.tile_id is null then
    raise exception 'That drop does not count for an open tile';
  end if;
  return v;
end;
$$;

create or replace function plugin_open(
  p_token text, p_rsn text, p_tile_id uuid, p_option_id uuid, p_item text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_me    uuid := plugin_as(p_token);
  v       plugin_wanted_row := plugin_check(p_rsn, p_tile_id, p_option_id, p_item);
  v_claim uuid;
begin
  -- Exactly what the first screenshot does on the site.
  v_claim := regions_open_tile(p_tile_id);
  return jsonb_build_object(
    'game_id', v.game_id, 'team_id', v.team_id, 'claim_id', v_claim,
    'path_prefix', v.game_id || '/' || v.team_id || '/' || v_claim || '/');
end;
$$;

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
  v_claim := regions_open_tile(p_tile_id);

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

-- ============================================================
-- 7. Grants
-- ============================================================
-- Internal ones to nobody; the token-taking ones to the service role only,
-- which is the intake Edge Function.

-- Supabase grants every new function in public to the three API roles by
-- default, so "to nobody" has to name the service role as well.
revoke execute on function evidence_stamp_source()                 from public, anon, authenticated, service_role;
revoke execute on function plugin_wanted()                         from public, anon, authenticated, service_role;
revoke execute on function plugin_rsn_ok(text)                     from public, anon, authenticated, service_role;
revoke execute on function plugin_check(text, uuid, uuid, text)    from public, anon, authenticated, service_role;
revoke execute on function plugin_watchlist(text)                  from public, anon, authenticated;
revoke execute on function plugin_match(text, text, jsonb)         from public, anon, authenticated;
revoke execute on function plugin_open(text, text, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function plugin_submit(text, text, uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function plugin_watchlist(text)                   to service_role;
grant execute on function plugin_match(text, text, jsonb)          to service_role;
grant execute on function plugin_open(text, text, uuid, uuid, text) to service_role;
grant execute on function plugin_submit(text, text, uuid, uuid, text, text, text, jsonb)
  to service_role;
