-- RuneLite plugin, server part 2: which drops a team wants, and handing one
-- in. docs/runelite-plugin-plan.md, sections 4.4 and 4.5. Needs 001.
--
-- DRAFT. Not in supabase/migrations on purpose, so db-push cannot apply it.
-- It adds two columns to tile_evidence, one trigger on it, one column to
-- games (Dink on or off, section 6e), three tables and new functions, six of
-- them for the site: admin_evidence_sources (the review screen's "sent by
-- plugin"), evidence_sources (the same lines under the picture in a tile's
-- panel), waiting_drops, waiting_drop_open and waiting_drop_choose (a drop
-- two tiles want, chosen by the team, section 6c), and admin_set_plugin_drops
-- (the switch). It rewrites no existing function:
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
-- counts there. Only a game an organiser has switched Dink on for takes
-- drops at all, and only a Region Bingo can be switched on (section 6e).

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
--
-- Only games with Dink switched on (section 6e). A game with it off is not
-- read at all, so its drops get the answer junk gets.

alter table games add column if not exists plugin_drops boolean not null default false;
comment on column games.plugin_drops is
  'Drops sent by Dink count in this game (admin_set_plugin_drops). Uploading on the site works either way.';

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
     where g.status = 'active' and g.plugin_drops and g.mode::text in ('regions', 'bingo')
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
-- intake function asks this first, and stores a screenshot only for a 'one'
-- (handed in) or an 'ask' (kept for the team to choose, section 6c).
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
-- 6c. A drop two tiles want: it waits, and the team chooses
-- ============================================================
-- Decided by Boris, 2026-11-21. Before, a drop more than one open tile wanted
-- (an 'ask') was handed in nowhere and its screenshot thrown away. Now the
-- intake keeps it, with the tiles that wanted it at that moment, and anyone
-- on the team chooses one of them on the site within an hour.
--
--   plugin_wait_open     intake: checks, answers where the screenshot goes
--   (the intake stores it in the team's folder, under waiting/)
--   plugin_wait          intake: checks again and keeps the drop for an hour
--   waiting_drops        site: the team's waiting drops and where each can go
--   waiting_drop_open    site: opens the chosen tile, answers where the copy goes
--   (the site copies the screenshot there, as the player, like an upload)
--   waiting_drop_choose  site: checks the copy is Dink's picture, hands it in
--
-- No rule moves here. The choices are read from plugin_wanted, so only tiles
-- the team can see and may still hand in to are ever offered; the tile is
-- opened by plugin_open_tile and the drop handed in by add_evidence, as the
-- player who got it. Only a tile that wanted the drop when it dropped can
-- take it, so a region opened later cannot, and nothing is banked. One game
-- at a time (Boris, 2026-11-21): a drop two games want is not kept.

create table if not exists plugin_waiting (
  id           uuid        primary key default gen_random_uuid(),
  game_id      uuid        not null references games(id) on delete cascade,
  team_id      uuid        not null references teams(id) on delete cascade,
  -- Who got the drop. The evidence is theirs, whoever chooses.
  profile_id   uuid        not null references profiles(id) on delete cascade,
  item         text        not null,
  detail       jsonb,
  storage_path text        not null,
  -- [{"tile_id": ..., "option_id": ...}]: the tiles that wanted it then.
  choices      jsonb       not null,
  received_at  timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '1 hour',
  chosen_at    timestamptz,
  chosen_by    uuid        references profiles(id) on delete set null,
  evidence_id  uuid,
  -- The copy that was handed in: the evidence's own file, never removed.
  chosen_path  text,
  -- When the intake removed storage_path from Storage (section 6d).
  file_removed_at timestamptz
);
-- For a database that ran an earlier draft of this table.
alter table plugin_waiting add column if not exists chosen_path text;
alter table plugin_waiting add column if not exists file_removed_at timestamptz;

create index if not exists plugin_waiting_open on plugin_waiting (team_id) where chosen_at is null;
alter table plugin_waiting enable row level security;
revoke all on plugin_waiting from public, anon, authenticated;

-- Every place waiting_drop_open told the site to copy the screenshot to. The
-- one handed in becomes evidence; any other (two teammates at once, a choice
-- refused after the copy, a browser closed half way) is removed by 6d.
create table if not exists plugin_waiting_copies (
  storage_path text        primary key,
  waiting_id   uuid        not null references plugin_waiting(id) on delete cascade,
  made_at      timestamptz not null default now(),
  removed_at   timestamptz
);
create index if not exists plugin_waiting_copies_drop on plugin_waiting_copies (waiting_id);
alter table plugin_waiting_copies enable row level security;
revoke all on plugin_waiting_copies from public, anon, authenticated;

-- Where a drop could go for the caller's team now, one row per tile. Internal.
create or replace function plugin_wait_choices(p_item text)
returns table (game_id uuid, team_id uuid, tile_id uuid, option_id uuid)
language sql stable security definer
set search_path = public
as $$
  select w.game_id, w.team_id, w.tile_id, w.option_id
    from plugin_wanted() w
   where w.drop = drop_key(p_item);
$$;

create or replace function plugin_wait_open(p_token text, p_rsn text, p_item text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_me    uuid := plugin_as(p_token);
  v_n     int;
  v_games int;
  v_game  uuid;
  v_team  uuid;
begin
  if not plugin_rsn_ok(p_rsn) then
    raise exception 'That in-game name is not on your account list. Add it under My Account.';
  end if;
  select count(*), count(distinct c.game_id), min(c.game_id::text)::uuid, min(c.team_id::text)::uuid
    into v_n, v_games, v_game, v_team
    from plugin_wait_choices(p_item) c;
  -- The answer a drop for no tile gets, for one tile (plugin_open's job) and
  -- for two games.
  if v_n < 2 or v_games <> 1 then
    raise exception 'That drop does not count for an open tile';
  end if;
  return jsonb_build_object('game_id', v_game, 'team_id', v_team,
    'path_prefix', v_game || '/' || v_team || '/waiting/');
end;
$$;

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
    from plugin_wait_choices(p_item) c;
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

-- The caller's team's drops waiting in this game, and the tiles each can
-- still go to. A choice that has stopped being one (the tile filled up, the
-- game ended) is left out, and a drop with none left is not listed. Nothing
-- for anyone not on a team in the game.
create or replace function waiting_drops(p_game_id uuid)
returns table (id uuid, item text, detail jsonb, storage_path text, dropped_by text,
               received_at timestamptz, expires_at timestamptz, choices jsonb)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_team uuid := my_team_in_game(p_game_id);
begin
  if v_team is null then
    return;
  end if;
  return query
    select w.id, w.item, w.detail, w.storage_path, p.display_name, w.received_at, w.expires_at,
           jsonb_agg(jsonb_build_object(
             'tile_id', n.tile_id, 'option_id', n.option_id, 'tile', n.tile_name,
             'position', n.tile_position, 'region', n.region, 'label', n.label)
             order by n.tile_position)
      from plugin_waiting w
      join profiles p on p.id = w.profile_id
      cross join lateral jsonb_to_recordset(w.choices) as c(tile_id uuid, option_id uuid)
      join plugin_wanted() n
        on n.game_id = w.game_id and n.team_id = w.team_id
       and n.tile_id = c.tile_id and n.option_id = c.option_id
     where w.game_id = p_game_id
       and w.team_id = v_team
       and w.chosen_at is null
       and w.expires_at > now()
     group by w.id, p.display_name
     order by w.received_at;
end;
$$;

-- Everything a choice must pass, for waiting_drop_open and _choose. One
-- message for a drop that does not exist, another team's drop, a tile that
-- was never a choice and one that no longer is: the answer must not tell
-- another team's drop, or a locked tile, from nothing at all. The other two
-- messages only ever reach the team the drop belongs to.
create or replace function waiting_drop_check(p_waiting_id uuid, p_tile_id uuid, p_option_id uuid)
returns plugin_waiting
language plpgsql stable security definer
set search_path = public
as $$
declare
  w plugin_waiting;
begin
  select * into w from plugin_waiting where id = p_waiting_id;
  if w.id is null or w.team_id is distinct from my_team_in_game(w.game_id) then
    raise exception 'That drop cannot be handed in there';
  end if;
  if w.chosen_at is not null then
    raise exception 'That drop has already been handed in';
  end if;
  if w.expires_at <= now() then
    raise exception 'That drop waited more than an hour, so it no longer counts';
  end if;
  if not (w.choices @> jsonb_build_array(jsonb_build_object('tile_id', p_tile_id, 'option_id', p_option_id)))
     or not exists (select 1 from plugin_wanted() n
                     where n.game_id = w.game_id and n.team_id = w.team_id
                       and n.tile_id = p_tile_id and n.option_id = p_option_id) then
    raise exception 'That drop cannot be handed in there';
  end if;
  return w;
end;
$$;

create or replace function waiting_drop_open(p_waiting_id uuid, p_tile_id uuid, p_option_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  w        plugin_waiting := waiting_drop_check(p_waiting_id, p_tile_id, p_option_id);
  v_claim  uuid;
  v_prefix text;
  v_copy   text;
begin
  -- A few tries are plenty; more is a button pressed in a loop. Only the
  -- drop's own team gets this far (waiting_drop_check).
  if (select count(*) from plugin_waiting_copies c where c.waiting_id = w.id) >= 10 then
    raise exception 'Too many tries for that drop';
  end if;
  -- What the site's first screenshot on a tile does, as the one choosing.
  v_claim := plugin_open_tile(p_tile_id);
  v_prefix := w.game_id || '/' || w.team_id || '/' || v_claim || '/';
  -- Where the copy goes is decided here and written down, so a copy that is
  -- never handed in can be found and removed (6d). Same type as Dink's file.
  v_copy := v_prefix || gen_random_uuid() || '.'
         || coalesce(lower(substring(w.storage_path from '\.([A-Za-z0-9]+)$')), 'png');
  insert into plugin_waiting_copies (storage_path, waiting_id) values (v_copy, w.id);
  return jsonb_build_object(
    'claim_id', v_claim, 'from_path', w.storage_path, 'path_prefix', v_prefix, 'copy_path', v_copy);
end;
$$;

create or replace function waiting_drop_choose(
  p_waiting_id uuid, p_tile_id uuid, p_option_id uuid, p_storage_path text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  w         plugin_waiting;
  v_chooser uuid := auth.uid();
  v_claims  text := current_setting('request.jwt.claims', true);
  v_sub     text := current_setting('request.jwt.claim.sub', true);
  v_headers text := current_setting('request.headers', true);
  v_claim   uuid;
  v_from    jsonb;
  v_to      jsonb;
  v_result  jsonb;
  v_ev      uuid;
begin
  -- Two clicks at once take turns, and the second finds it handed in.
  perform 1 from plugin_waiting where id = p_waiting_id for update;
  w := waiting_drop_check(p_waiting_id, p_tile_id, p_option_id);
  v_claim := plugin_open_tile(p_tile_id);

  -- The copy must be the screenshot Dink sent: at a place waiting_drop_open
  -- gave out for this drop, under this claim, with the same size and eTag
  -- (Storage's MD5 of the bytes). Anyone on the team may write a file there,
  -- so their own picture would otherwise pass for Dink's.
  select o.metadata into v_from from storage.objects o
   where o.bucket_id = 'evidence' and o.name = w.storage_path;
  select o.metadata into v_to from storage.objects o
   where o.bucket_id = 'evidence' and o.name = p_storage_path;
  if v_from ->> 'eTag' is null or v_from ->> 'size' is null
     or v_to ->> 'eTag' is distinct from v_from ->> 'eTag'
     or v_to ->> 'size' is distinct from v_from ->> 'size'
     or position(w.game_id || '/' || w.team_id || '/' || v_claim || '/' in coalesce(p_storage_path, '')) <> 1
     or not exists (select 1 from plugin_waiting_copies c
                     where c.waiting_id = w.id and c.storage_path = p_storage_path) then
    raise exception 'That is not the screenshot Dink sent for this drop';
  end if;

  -- Handed in as the player who got the drop, as Dink would have: the row is
  -- theirs, and add_evidence checks they are on the team. Who chose, and when
  -- the drop arrived, go beside what Dink reported.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', w.profile_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', w.profile_id::text, true);
  perform set_config('request.headers', '{}', true);
  perform set_config('hs.evidence_source',
                     case when w.detail ->> 'source' = 'dink' then 'dink' else 'plugin' end, true);
  perform set_config('hs.evidence_detail', (coalesce(w.detail, '{}'::jsonb) || jsonb_build_object(
    'waited', jsonb_build_object(
      'arrived_at', w.received_at,
      'chosen_by', (select p.display_name from profiles p where p.id = v_chooser))))::text, true);

  v_result := add_evidence(v_claim, p_storage_path, null, p_option_id, null);

  perform set_config('hs.evidence_source', '', true);
  perform set_config('hs.evidence_detail', '', true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.headers', coalesce(v_headers, ''), true);

  select e.id into v_ev
    from tile_evidence e
   where e.claim_id = v_claim and e.storage_path = p_storage_path;
  update plugin_waiting
     set chosen_at = now(), chosen_by = v_chooser, evidence_id = v_ev, chosen_path = p_storage_path
   where id = w.id;
  return v_result;
end;
$$;

-- ============================================================
-- 6d. Screenshots nobody needs any more
-- ============================================================
-- Asked for by Boris, 2026-11-21. A waiting drop leaves files behind: Dink's
-- screenshot under waiting/, and a copy in a tile's folder for each try at
-- choosing. Once the drop is handed in, the chosen copy is the evidence and
-- the rest are not needed; once its hour is up, none of them are.
--
-- The intake removes them through Storage, a few at a time, whenever Dink
-- sends it something: this project has no pg_cron, and a row deleted here
-- would leave the file itself behind. Five minutes' grace after the hour, so
-- a choice made in the last second meets "waited more than an hour" rather
-- than a missing file.
--
-- Nothing else is ever listed: no evidence, no upload from the site, and
-- never the copy that was handed in, whatever later happens to its row.

-- Internal: every such file, and since when it has not been needed.
create or replace function plugin_leftovers()
returns table (storage_path text, since timestamptz)
language sql stable security definer
set search_path = public
as $$
  select w.storage_path, coalesce(w.chosen_at, w.expires_at)
    from plugin_waiting w
   where w.file_removed_at is null
     and (w.chosen_at is not null or w.expires_at <= now() - interval '5 minutes')
  union all
  select c.storage_path, coalesce(w.chosen_at, w.expires_at)
    from plugin_waiting_copies c
    join plugin_waiting w on w.id = c.waiting_id
   where c.removed_at is null
     and c.storage_path is distinct from w.chosen_path
     and (w.chosen_at is not null or w.expires_at <= now() - interval '5 minutes');
$$;

-- The intake: the next few to remove, oldest first.
create or replace function plugin_leftover_files(p_limit int default 20)
returns table (storage_path text)
language sql stable security definer
set search_path = public
as $$
  select l.storage_path
    from plugin_leftovers() l
   order by l.since, l.storage_path
   limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

-- The intake, once Storage has removed them. Only a file that is still a
-- leftover is marked, so a path that is not one changes nothing.
create or replace function plugin_leftovers_removed(p_paths text[])
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_waiting int;
  v_copies  int;
begin
  update plugin_waiting w
     set file_removed_at = now()
   where w.storage_path = any(p_paths)
     and w.storage_path in (select l.storage_path from plugin_leftovers() l);
  get diagnostics v_waiting = row_count;
  update plugin_waiting_copies c
     set removed_at = now()
   where c.storage_path = any(p_paths)
     and c.storage_path in (select l.storage_path from plugin_leftovers() l);
  get diagnostics v_copies = row_count;
  return v_waiting + v_copies;
end;
$$;

-- ============================================================
-- 6e. Dink on or off, per game
-- ============================================================
-- Decided by Boris, 2026-11-21 (plan, section 10, item 6): a switch on each
-- game in the admin console, off until an organiser turns it on, and only
-- for Region Bingo for now. Bingo is built and tested, but waits for his
-- word; turning a game off works in every mode.
--
-- Off, the game is not read by plugin_wanted (section 3): Dink's drops get
-- the answer junk gets, nothing new waits, and drops already waiting are no
-- longer offered. Uploading on the site is not touched either way:
-- add_evidence does not read the switch.

create or replace function admin_set_plugin_drops(p_game_id uuid, p_on boolean)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_game games%rowtype;
begin
  if not may_manage_game(p_game_id) then raise exception 'Not your game'; end if;
  select * into v_game from games where id = p_game_id;
  if not found then raise exception 'No such game'; end if;
  if p_on is null then raise exception 'Say on or off'; end if;
  if p_on and v_game.mode <> 'regions' then
    raise exception 'Drops from Dink are for Region Bingo only, for now';
  end if;
  update games set plugin_drops = p_on where id = p_game_id;
  return p_on;
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
revoke execute on function plugin_open_tile(uuid)                  from public, anon, authenticated, service_role;
revoke execute on function plugin_match(text, text, jsonb)         from public, anon, authenticated;
revoke execute on function plugin_open(text, text, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function plugin_submit(text, text, uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function plugin_wait_choices(text)               from public, anon, authenticated, service_role;
revoke execute on function waiting_drop_check(uuid, uuid, uuid)    from public, anon, authenticated, service_role;
revoke execute on function plugin_wait_open(text, text, text)      from public, anon, authenticated;
revoke execute on function plugin_wait(text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function plugin_leftovers()                      from public, anon, authenticated, service_role;
revoke execute on function plugin_leftover_files(int)              from public, anon, authenticated;
revoke execute on function plugin_leftovers_removed(text[])        from public, anon, authenticated;

-- A signed-in organiser's, like admin_list_evidence; the function itself
-- refuses everyone else.
revoke execute on function admin_evidence_sources(uuid)            from public, anon, service_role;
grant  execute on function admin_evidence_sources(uuid)            to authenticated;
-- Any signed-in player's; the function answers only for what they can see.
revoke execute on function evidence_sources(uuid[])                from public, anon, service_role;
grant  execute on function evidence_sources(uuid[])                to authenticated;
-- The waiting box: any signed-in player's; each answers only for their team.
revoke execute on function waiting_drops(uuid)                     from public, anon, service_role;
revoke execute on function waiting_drop_open(uuid, uuid, uuid)     from public, anon, service_role;
revoke execute on function waiting_drop_choose(uuid, uuid, uuid, text) from public, anon, service_role;
grant  execute on function waiting_drops(uuid)                     to authenticated;
grant  execute on function waiting_drop_open(uuid, uuid, uuid)     to authenticated;
grant  execute on function waiting_drop_choose(uuid, uuid, uuid, text) to authenticated;
-- The switch: a signed-in organiser's, like admin_set_region_threshold; the
-- function itself refuses everyone else.
revoke execute on function admin_set_plugin_drops(uuid, boolean)   from public, anon, service_role;
grant  execute on function admin_set_plugin_drops(uuid, boolean)   to authenticated;

grant execute on function plugin_match(text, text, jsonb)          to service_role;
grant execute on function plugin_open(text, text, uuid, uuid, text) to service_role;
grant execute on function plugin_submit(text, text, uuid, uuid, text, text, text, jsonb)
  to service_role;
grant execute on function plugin_wait_open(text, text, text)       to service_role;
grant execute on function plugin_wait(text, text, text, text, jsonb) to service_role;
grant execute on function plugin_leftover_files(int)               to service_role;
grant execute on function plugin_leftovers_removed(text[])         to service_role;
