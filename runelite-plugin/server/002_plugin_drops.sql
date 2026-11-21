-- RuneLite plugin, server part 2: which drops a team wants, and handing one
-- in. docs/runelite-plugin-plan.md, sections 4.4 and 4.5. Needs 001.
--
-- DRAFT. Not in supabase/migrations on purpose, so db-push cannot apply it.
-- It adds two columns to tile_evidence, one trigger on it, one table and new
-- functions, two of them for the site (admin_evidence_sources, the review
-- screen's "sent by plugin", and evidence_sources, the same lines under the
-- picture in a tile's panel). It rewrites no existing function:
-- tiles_for_team, regions_open_tile, bingo_open_tile and add_evidence are
-- called exactly as they are, so every rule they hold applies to a plugin
-- without being written down twice.
--
-- Tested offline by server/test/regions.test.mjs and bingo.test.mjs, against
-- a replay of every migration in supabase/migrations, and on a local Supabase
-- stack by server/test/stack.test.mjs.
--
-- Region Bingo and Bingo, for now. Each mode is one line in plugin_wanted and
-- one branch in plugin_open_tile, added one at a time (plan, section 7);
-- Snakes and Ladders, Territory and Challenge are not wired, so a drop never
-- counts there.

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
--
-- Bingo needs nothing of its own here: tiles_for_team shows a Bingo team the
-- whole card once the game has started, and nothing of it before. region is
-- null for a Bingo tile.

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
  v_mode text;
  v_team uuid;
begin
  -- A loop, not one join: tiles_for_team is only ever called with a team the
  -- caller is really on, never with a null one.
  for v_game, v_mode in
    select g.id, g.mode::text from games g
     where g.status = 'active' and g.mode::text in ('regions', 'bingo')
  loop
    v_team := my_team_in_game(v_game);
    continue when v_team is null;

    return query
      select v_game, v_team, t.id, t.name, t."position"::int,
             case when v_mode = 'regions' then regions_region_at(t."position"::int) end,
             t.claim_id, o.id, o.label, drop_key(o.label)
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
-- The game puts a non-breaking space (chr(160)) between the words of a name
-- and a plugin may send it that way. rsn_key's \s does not fold it, and
-- rsn_key is not ours to change, so it is made a plain space here first.
create or replace function plugin_rsn_ok(p_rsn text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from profile_accounts a
     where a.profile_id = auth.uid()
       and rsn_key(a.rsn) = rsn_key(replace(p_rsn, chr(160), ' ')));
$$;

-- ============================================================
-- 4. plugin_match: what would these drops count for?
-- ============================================================
-- For Dink, which knows nothing of the tiles and sends every drop: the
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
-- 5. plugin_open and plugin_submit: handing a drop in
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

-- What the site's first screenshot does, mode by mode: the same function the
-- site calls, so its rules (the caller's team, the game running, the time,
-- and in Region Bingo the region opened) are checked by the site's own code.
-- Only reached for a tile plugin_check has passed, which is always one of the
-- modes below; anything else gets the answer a missing tile gets.

create or replace function plugin_open_tile(p_tile_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_mode text;
begin
  select g.mode::text into v_mode
    from tiles t join games g on g.id = t.game_id
   where t.id = p_tile_id;

  case v_mode
    when 'regions' then return regions_open_tile(p_tile_id);
    when 'bingo'   then return bingo_open_tile(p_tile_id);
    else raise exception 'That drop does not count for an open tile';
  end case;
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
  v_claim := plugin_open_tile(p_tile_id);
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

-- ============================================================
-- 6. admin_evidence_sources: the review screen's label
-- ============================================================
-- Which evidence a plugin sent, and what it reported, for EvidenceReview's
-- "sent by plugin" (never "verified").
--
-- A function of its own rather than two more columns on admin_list_evidence:
-- changing what that returns means dropping and re-creating it, and its live
-- body has been rewritten in place since (20261025130000), so a copy here
-- could drift from it. This one reads two columns and asks the same gate,
-- may_manage_game, in the same words.
--
-- Organisers only. A player who could call it would read the item names of
-- the other team's evidence, and through them tiles in regions their own team
-- has not opened.
--
-- Only rows that did not come from the site: a 'web' row has no detail, and
-- the screen treats a row it is not told about as an upload.

create or replace function admin_evidence_sources(p_game_id uuid)
returns table (id uuid, source text, detail jsonb)
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not may_manage_game(p_game_id) then
    raise exception 'Not your game';
  end if;
  return query
    select e.id, e.source, e.detail
      from tile_evidence e
      join tile_claims c on c.id = e.claim_id
      join tiles t on t.id = c.tile_id
     where t.game_id = p_game_id
       and e.source <> 'web';
end;
$$;

-- ============================================================
-- 6b. evidence_sources: what the plugin reported, under the picture
-- ============================================================
-- The same id, source and detail, for a tile's panel (EvidencePanel), which a
-- team opens on its own board and an organiser on theirs. Asked by Boris,
-- 2026-11-21: a Dink screenshot does not always show the drop (the chat box
-- closed, the item too small to see on the ground), so the panel shows what
-- Dink reported beside it: the item, how many, from what, the world.
--
-- Asked by evidence id, for the few pieces of one tile, and answered only for
-- rows the caller can already see: evidence in a game they run (the question
-- admin_evidence_sources asks), or evidence my_evidence already gives their
-- own team. A row of the other team, a row that does not exist and an upload
-- from the site all get the same answer: nothing. So it tells a player nothing
-- about the other team's tiles, or a region their team has not opened (the
-- second secret), and nothing their own team's list does not already hold.

create or replace function evidence_sources(p_ids uuid[])
returns table (id uuid, source text, detail jsonb)
language sql stable security definer
set search_path = public
as $$
  select e.id, e.source, e.detail
    from tile_evidence e
    join tile_claims c on c.id = e.claim_id
    join tiles t on t.id = c.tile_id
   where e.id = any (p_ids[1:100])
     and e.source <> 'web'
     and (may_manage_game(t.game_id)
          or e.id in (select m.id from my_evidence(t.game_id) m));
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
revoke execute on function plugin_open_tile(uuid)                  from public, anon, authenticated, service_role;
revoke execute on function plugin_match(text, text, jsonb)         from public, anon, authenticated;
revoke execute on function plugin_open(text, text, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function plugin_submit(text, text, uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated;

-- A signed-in organiser's, like admin_list_evidence; the function itself
-- refuses everyone else.
revoke execute on function admin_evidence_sources(uuid)            from public, anon, service_role;
grant  execute on function admin_evidence_sources(uuid)            to authenticated;
-- Any signed-in player's; the function answers only for what they can see.
revoke execute on function evidence_sources(uuid[])                from public, anon, service_role;
grant  execute on function evidence_sources(uuid[])                to authenticated;

grant execute on function plugin_match(text, text, jsonb)          to service_role;
grant execute on function plugin_open(text, text, uuid, uuid, text) to service_role;
grant execute on function plugin_submit(text, text, uuid, uuid, text, text, text, jsonb)
  to service_role;
