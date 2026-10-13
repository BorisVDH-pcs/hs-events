-- Territory: the fourth game mode. Risk on the OSRS world map.
--
-- The rules (docs/territory-rules.md has the long form; web/src/lib/territory.js
-- is the same rules in JS, which the map draws with):
--
--   * The map is 64 real places in 11 regions, linked to their neighbours.
--     The same map for every game, so it lives in three plain tables seeded
--     from web/src/lib/territoryWorld.js (scripts/territory-selftest.mjs checks
--     the seed below still matches it).
--   * Every team starts on a home place (teams.home): no task, never taken.
--     The organiser picks them; they are refused if together they would wall
--     any place off from any team (territory_homes_problem).
--   * A place's task is the tile at its square of an 8x8 card (grid_size 8),
--     so dealing, templates and the board builder all work as for bingo.
--   * A team may open a place linked to land it holds, at most 2 at once.
--     Finishing its task takes the place, free or a rival's: capturing and
--     stealing are one rule, at the same target.
--   * When the timer runs out the highest score wins: places held plus a bonus
--     for each region held whole. Ties go to whoever made their last capture
--     first. The organiser can end it early.
--
-- How it sits on the shared tables:
--
--   * A place changes hands in territory_captures, an append-only log. Who
--     holds a place is its latest capture that has not been revoked
--     (territory_owners), so withdrawing the evidence behind a capture hands
--     the place straight back without anything else to repair.
--   * A team's work on a place is its tile_claims row, as in bingo:
--     active and not paused = open (counts towards the 2), paused = given up,
--     its screenshots kept for when the team comes back, completed = taken.
--   * tile_claims allows one row per team and tile, so a team that LOSES a
--     place keeps that row for a retake. Its screenshots move to
--     territory_lost_evidence (kept for the organiser, counted by nothing) and
--     the row goes back to paused: a retake starts from zero, at the same
--     target, and claim_is_complete and everything else that counts evidence
--     work unchanged.
--
-- Shared functions changed here, each copied from its latest definition with
-- only the territory lines added (the comment above each says which):
-- add_evidence, is_team_private_event, admin_new_game, admin_add_team,
-- admin_end_game, admin_reset_game, admin_revoke_evidence, start_game,
-- board_for_me, admin_board_for_team, admin_game_readiness,
-- admin_autofill_board, admin_apply_board_preset, admin_swap_tiles,
-- discord_line.
--
-- Prove it with scripts/territory-smoke-test.sql (rolls itself back).

-- ============================================================
-- 1. games: a territory card is 8x8
-- ============================================================
-- ended_reason needs nothing new: territory ends on 'time_up' or 'admin'.

alter table games drop constraint games_grid_size_check;
alter table games add constraint games_grid_size_check
  check (grid_size between 3 and 26
         and (mode <> 'bingo' or grid_size <= 10)
         and (mode <> 'snakes' or grid_size = 10)
         and (mode <> 'territory' or grid_size = 8));

comment on column games.ended_reason is
  'Bingo: full_card, time_up or admin. Snakes: won or admin. Territory: time_up or admin. Null while running, and on battleships.';

-- ============================================================
-- 2. The world: regions, places, links
-- ============================================================
-- Order is identity, as in territoryWorld.js: a place's idx never changes,
-- because its task is the tile at that square.

create table territory_regions (
  key   text     primary key,
  name  text     not null,
  bonus smallint not null check (bonus >= 0),
  sort  smallint not null unique
);

create table territory_places (
  key      text     primary key,
  idx      smallint not null unique check (idx between 1 and 64),
  name     text     not null,
  region   text     not null references territory_regions(key),
  -- The tile position of its task: 8 to a row, in the 10-column numbering
  -- every mode shares (placePosition in lib/territory.js).
  position smallint generated always as (((idx - 1) / 8) * 10 + ((idx - 1) % 8) + 1) stored unique
);

create table territory_links (
  a    text not null references territory_places(key),
  b    text not null references territory_places(key),
  kind text not null check (kind in ('land', 'boat', 'travel')),
  primary key (a, b),
  check (a < b)
);

alter table territory_regions enable row level security;
alter table territory_places  enable row level security;
alter table territory_links   enable row level security;
create policy territory_regions_read on territory_regions for select using (true);
create policy territory_places_read  on territory_places  for select using (true);
create policy territory_links_read   on territory_links   for select using (true);

-- Generated from web/src/lib/territoryWorld.js. Bonus = about half the
-- region's places, at least 2 (defaultBonus there).
insert into territory_regions (key, name, bonus, sort) values
  ('misthalin', 'Misthalin', 3, 1),
  ('asgarnia', 'Asgarnia', 3, 2),
  ('kandarin', 'Kandarin', 4, 3),
  ('fremennik', 'Fremennik Provinces', 3, 4),
  ('wilderness', 'Wilderness', 3, 5),
  ('morytania', 'Morytania', 3, 6),
  ('desert', 'Kharidian Desert', 3, 7),
  ('karamja', 'Karamja', 3, 8),
  ('tirannwn', 'Tirannwn', 2, 9),
  ('kourend', 'Kourend & Kebos', 4, 10),
  ('varlamore', 'Varlamore', 3, 11);

insert into territory_places (key, idx, name, region) values
  ('lumbridge', 1, 'Lumbridge', 'misthalin'),
  ('draynor', 2, 'Draynor Village', 'misthalin'),
  ('wizards_tower', 3, 'Wizards'' Tower', 'misthalin'),
  ('varrock', 4, 'Varrock', 'misthalin'),
  ('barbarian_village', 5, 'Barbarian Village', 'misthalin'),
  ('edgeville', 6, 'Edgeville', 'misthalin'),
  ('falador', 7, 'Falador', 'asgarnia'),
  ('port_sarim', 8, 'Port Sarim', 'asgarnia'),
  ('rimmington', 9, 'Rimmington', 'asgarnia'),
  ('taverley', 10, 'Taverley', 'asgarnia'),
  ('burthorpe', 11, 'Burthorpe', 'asgarnia'),
  ('trollheim', 12, 'Trollheim', 'asgarnia'),
  ('catherby', 13, 'Catherby', 'kandarin'),
  ('seers', 14, 'Seers'' Village', 'kandarin'),
  ('ardougne', 15, 'Ardougne', 'kandarin'),
  ('yanille', 16, 'Yanille', 'kandarin'),
  ('gnome_stronghold', 17, 'Gnome Stronghold', 'kandarin'),
  ('barbarian_outpost', 18, 'Barbarian Outpost', 'kandarin'),
  ('feldip_hills', 19, 'Feldip Hills', 'kandarin'),
  ('rellekka', 20, 'Rellekka', 'fremennik'),
  ('neitiznot', 21, 'Neitiznot', 'fremennik'),
  ('lunar_isle', 22, 'Lunar Isle', 'fremennik'),
  ('waterbirth', 23, 'Waterbirth Island', 'fremennik'),
  ('weiss', 24, 'Weiss', 'fremennik'),
  ('ferox', 25, 'Ferox Enclave', 'wilderness'),
  ('bandit_camp_wild', 26, 'Bandit Camp', 'wilderness'),
  ('lava_maze', 27, 'Lava Maze', 'wilderness'),
  ('mage_arena', 28, 'Mage Arena', 'wilderness'),
  ('rogues_castle', 29, 'Rogues'' Castle', 'wilderness'),
  ('canifis', 30, 'Canifis', 'morytania'),
  ('port_phasmatys', 31, 'Port Phasmatys', 'morytania'),
  ('mort_myre', 32, 'Mort Myre Swamp', 'morytania'),
  ('barrows', 33, 'Barrows', 'morytania'),
  ('darkmeyer', 34, 'Darkmeyer', 'morytania'),
  ('ver_sinhaza', 35, 'Ver Sinhaza', 'morytania'),
  ('al_kharid', 36, 'Al Kharid', 'desert'),
  ('kalphite_lair', 37, 'Kalphite Lair', 'desert'),
  ('pollnivneach', 38, 'Pollnivneach', 'desert'),
  ('nardah', 39, 'Nardah', 'desert'),
  ('sophanem', 40, 'Sophanem', 'desert'),
  ('uzer', 41, 'Uzer', 'desert'),
  ('musa_point', 42, 'Musa Point', 'karamja'),
  ('brimhaven', 43, 'Brimhaven', 'karamja'),
  ('tai_bwo_wannai', 44, 'Tai Bwo Wannai', 'karamja'),
  ('shilo_village', 45, 'Shilo Village', 'karamja'),
  ('ape_atoll', 46, 'Ape Atoll', 'karamja'),
  ('prifddinas', 47, 'Prifddinas', 'tirannwn'),
  ('lletya', 48, 'Lletya', 'tirannwn'),
  ('port_tyras', 49, 'Port Tyras', 'tirannwn'),
  ('zul_andra', 50, 'Zul-Andra', 'tirannwn'),
  ('kourend_castle', 51, 'Kourend Castle', 'kourend'),
  ('hosidius', 52, 'Hosidius', 'kourend'),
  ('port_piscarilius', 53, 'Port Piscarilius', 'kourend'),
  ('arceuus', 54, 'Arceuus', 'kourend'),
  ('lovakengj', 55, 'Lovakengj', 'kourend'),
  ('shayzien', 56, 'Shayzien', 'kourend'),
  ('wintertodt', 57, 'Wintertodt', 'kourend'),
  ('chambers_of_xeric', 58, 'Mount Quidamortem', 'kourend'),
  ('civitas', 59, 'Civitas illa Fortis', 'varlamore'),
  ('hunter_guild', 60, 'Hunter Guild', 'varlamore'),
  ('sunset_coast', 61, 'Sunset Coast', 'varlamore'),
  ('aldarin', 62, 'Aldarin', 'varlamore'),
  ('ralos_rise', 63, 'Ralos'' Rise', 'varlamore'),
  ('tal_teklan', 64, 'Tal Teklan', 'varlamore');

-- Stored once each way round, smaller key first; territory_neighbours reads both.
insert into territory_links (a, b, kind) values
  ('draynor', 'lumbridge', 'land'),
  ('lumbridge', 'varrock', 'land'),
  ('al_kharid', 'lumbridge', 'land'),
  ('draynor', 'wizards_tower', 'land'),
  ('draynor', 'port_sarim', 'land'),
  ('draynor', 'falador', 'land'),
  ('barbarian_village', 'draynor', 'land'),
  ('barbarian_village', 'varrock', 'land'),
  ('edgeville', 'varrock', 'land'),
  ('barbarian_village', 'edgeville', 'land'),
  ('canifis', 'varrock', 'land'),
  ('ferox', 'varrock', 'land'),
  ('edgeville', 'ferox', 'land'),
  ('civitas', 'varrock', 'travel'),
  ('barbarian_village', 'falador', 'land'),
  ('falador', 'rimmington', 'land'),
  ('falador', 'port_sarim', 'land'),
  ('port_sarim', 'rimmington', 'land'),
  ('falador', 'taverley', 'land'),
  ('burthorpe', 'taverley', 'land'),
  ('burthorpe', 'trollheim', 'land'),
  ('catherby', 'taverley', 'land'),
  ('bandit_camp_wild', 'burthorpe', 'land'),
  ('musa_point', 'port_sarim', 'boat'),
  ('port_piscarilius', 'port_sarim', 'boat'),
  ('catherby', 'seers', 'land'),
  ('barbarian_outpost', 'seers', 'land'),
  ('barbarian_outpost', 'gnome_stronghold', 'land'),
  ('ardougne', 'seers', 'land'),
  ('ardougne', 'gnome_stronghold', 'land'),
  ('ardougne', 'yanille', 'land'),
  ('feldip_hills', 'yanille', 'land'),
  ('rellekka', 'seers', 'land'),
  ('ardougne', 'prifddinas', 'land'),
  ('ardougne', 'brimhaven', 'boat'),
  ('ape_atoll', 'gnome_stronghold', 'travel'),
  ('rellekka', 'trollheim', 'land'),
  ('trollheim', 'weiss', 'land'),
  ('rellekka', 'waterbirth', 'boat'),
  ('neitiznot', 'rellekka', 'boat'),
  ('lunar_isle', 'rellekka', 'boat'),
  ('bandit_camp_wild', 'ferox', 'land'),
  ('ferox', 'lava_maze', 'land'),
  ('bandit_camp_wild', 'lava_maze', 'land'),
  ('lava_maze', 'mage_arena', 'land'),
  ('mage_arena', 'rogues_castle', 'land'),
  ('ferox', 'rogues_castle', 'land'),
  ('canifis', 'mort_myre', 'land'),
  ('canifis', 'port_phasmatys', 'land'),
  ('barrows', 'mort_myre', 'land'),
  ('darkmeyer', 'mort_myre', 'land'),
  ('barrows', 'ver_sinhaza', 'land'),
  ('darkmeyer', 'ver_sinhaza', 'land'),
  ('al_kharid', 'kalphite_lair', 'land'),
  ('kalphite_lair', 'pollnivneach', 'land'),
  ('nardah', 'pollnivneach', 'land'),
  ('pollnivneach', 'sophanem', 'land'),
  ('pollnivneach', 'uzer', 'land'),
  ('nardah', 'uzer', 'land'),
  ('brimhaven', 'musa_point', 'land'),
  ('musa_point', 'tai_bwo_wannai', 'land'),
  ('brimhaven', 'tai_bwo_wannai', 'land'),
  ('shilo_village', 'tai_bwo_wannai', 'land'),
  ('lletya', 'prifddinas', 'land'),
  ('lletya', 'port_tyras', 'land'),
  ('port_tyras', 'zul_andra', 'land'),
  ('hosidius', 'port_piscarilius', 'land'),
  ('arceuus', 'port_piscarilius', 'land'),
  ('arceuus', 'kourend_castle', 'land'),
  ('hosidius', 'kourend_castle', 'land'),
  ('kourend_castle', 'shayzien', 'land'),
  ('lovakengj', 'shayzien', 'land'),
  ('arceuus', 'lovakengj', 'land'),
  ('arceuus', 'wintertodt', 'land'),
  ('lovakengj', 'wintertodt', 'land'),
  ('chambers_of_xeric', 'shayzien', 'land'),
  ('chambers_of_xeric', 'ralos_rise', 'land'),
  ('civitas', 'ralos_rise', 'land'),
  ('ralos_rise', 'tal_teklan', 'land'),
  ('civitas', 'hunter_guild', 'land'),
  ('hunter_guild', 'sunset_coast', 'land'),
  ('sunset_coast', 'tal_teklan', 'land'),
  ('aldarin', 'sunset_coast', 'boat'),
  ('al_kharid', 'pollnivneach', 'land'),
  ('al_kharid', 'uzer', 'land'),
  ('ardougne', 'catherby', 'land'),
  ('ardougne', 'lletya', 'land'),
  ('bandit_camp_wild', 'edgeville', 'land'),
  ('bandit_camp_wild', 'trollheim', 'land'),
  ('barrows', 'darkmeyer', 'land'),
  ('burthorpe', 'catherby', 'land'),
  ('burthorpe', 'edgeville', 'land'),
  ('burthorpe', 'seers', 'land'),
  ('canifis', 'darkmeyer', 'land'),
  ('chambers_of_xeric', 'lovakengj', 'land'),
  ('chambers_of_xeric', 'tal_teklan', 'land'),
  ('darkmeyer', 'port_phasmatys', 'land'),
  ('draynor', 'varrock', 'land'),
  ('feldip_hills', 'lletya', 'land'),
  ('feldip_hills', 'zul_andra', 'land'),
  ('gnome_stronghold', 'lletya', 'land'),
  ('gnome_stronghold', 'prifddinas', 'land'),
  ('gnome_stronghold', 'seers', 'land'),
  ('hosidius', 'shayzien', 'land'),
  ('hunter_guild', 'ralos_rise', 'land'),
  ('hunter_guild', 'tal_teklan', 'land'),
  ('kalphite_lair', 'lumbridge', 'land'),
  ('kalphite_lair', 'sophanem', 'land'),
  ('kalphite_lair', 'wizards_tower', 'land'),
  ('kourend_castle', 'lovakengj', 'land'),
  ('kourend_castle', 'port_piscarilius', 'land'),
  ('lava_maze', 'rogues_castle', 'land'),
  ('lava_maze', 'weiss', 'land'),
  ('lletya', 'yanille', 'land'),
  ('lletya', 'zul_andra', 'land'),
  ('lumbridge', 'wizards_tower', 'land'),
  ('mage_arena', 'weiss', 'land'),
  ('nardah', 'sophanem', 'land'),
  ('port_piscarilius', 'wintertodt', 'land'),
  ('port_tyras', 'prifddinas', 'land'),
  ('rellekka', 'weiss', 'land'),
  ('al_kharid', 'varrock', 'land'),
  ('catherby', 'port_phasmatys', 'boat'),
  ('brimhaven', 'shilo_village', 'travel'),
  ('ape_atoll', 'tai_bwo_wannai', 'travel'),
  ('aldarin', 'civitas', 'travel');

-- DEFAULT_HOMES: lumbridge, ardougne, canifis, hosidius, civitas, trollheim

-- ============================================================
-- 3. Homes, captures, lost screenshots
-- ============================================================

alter table teams add column home text references territory_places(key);
-- Deferred, so the organiser can swap two teams' homes in one save.
alter table teams add constraint teams_one_home_per_place
  unique (game_id, home) deferrable initially deferred;

comment on column teams.home is
  'Territory only: the place the team starts on. It has no task and can never be taken.';

create table territory_captures (
  id           uuid        primary key default gen_random_uuid(),
  -- The order things happened in, exactly: several captures can share a
  -- timestamp inside one transaction.
  seq          bigint      generated always as identity,
  game_id      uuid        not null references games(id) on delete cascade,
  place        text        not null references territory_places(key),
  team_id      uuid        not null references teams(id) on delete cascade,
  from_team_id uuid        references teams(id) on delete set null,
  claim_id     uuid        references tile_claims(id) on delete set null,
  at           timestamptz not null default clock_timestamp(),
  revoked_at   timestamptz
);

create index territory_captures_live
  on territory_captures (game_id, place, seq desc) where revoked_at is null;

comment on table territory_captures is
  'Territory: every time a place changed hands. The holder is the latest capture not revoked.';

alter table territory_captures enable row level security;
-- The map is public: who holds what is no secret.
create policy territory_captures_read on territory_captures for select using (true);

create table territory_lost_evidence (
  id              uuid        primary key,   -- the tile_evidence id it had
  game_id         uuid        not null references games(id) on delete cascade,
  claim_id        uuid        not null,
  team_id         uuid        not null,
  lost_to_team_id uuid,
  lost_at         timestamptz not null default now(),
  evidence        jsonb       not null       -- the whole tile_evidence row
);

comment on table territory_lost_evidence is
  'Territory: screenshots behind a place the team later lost. Kept for the organiser; they count for nothing.';

alter table territory_lost_evidence enable row level security;
-- To authenticated only: anon may not call is_admin(), so a signed-out read
-- would error rather than see nothing.
create policy territory_lost_evidence_admin on territory_lost_evidence
  for select to authenticated using (is_admin());

-- ============================================================
-- 4. Reading the map
-- ============================================================

/** Suggested homes, spread across the map: DEFAULT_HOMES in territoryWorld.js. */
create function territory_default_homes()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['lumbridge', 'ardougne', 'canifis', 'hosidius', 'civitas', 'trollheim']::text[];
$$;

create function territory_neighbours(p_place text)
returns setof text
language sql
stable
set search_path = public
as $$
  select case when l.a = p_place then l.b else l.a end
    from territory_links l
   where l.a = p_place or l.b = p_place;
$$;

-- Who holds every held place: the homes, then each place's latest capture
-- that has not been revoked.
create function territory_owners(p_game_id uuid)
returns table (place text, team_id uuid, is_home boolean)
language sql
stable
security definer
set search_path = public
as $$
  select te.home, te.id, true
    from teams te
   where te.game_id = p_game_id and te.home is not null
  union all
  select x.place, x.team_id, false
    from (
      select distinct on (c.place) c.place, c.team_id
        from territory_captures c
       where c.game_id = p_game_id and c.revoked_at is null
       order by c.place, c.seq desc
    ) x
   where not exists (select 1 from teams te
                      where te.game_id = p_game_id and te.home = x.place);
$$;

create function territory_owner(p_game_id uuid, p_place text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select o.team_id from territory_owners(p_game_id) o where o.place = p_place;
$$;

-- "A", "A and B", "A, B and C", "A, B, C and 4 more", in map order.
create function territory_name_list(p_keys text[])
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_names text[];
  v_n     int;
begin
  select coalesce(array_agg(coalesce(p.name, u.k) order by p.idx nulls last, u.o), '{}')
    into v_names
    from unnest(p_keys) with ordinality as u(k, o)
    left join territory_places p on p.key = u.k;
  v_n := coalesce(array_length(v_names, 1), 0);
  if v_n > 4 then
    v_names := v_names[1:3] || ((v_n - 3) || ' more');
    v_n := 4;
  end if;
  if v_n < 2 then
    return coalesce(v_names[1], '');
  end if;
  return array_to_string(v_names[1:v_n - 1], ', ') || ' and ' || v_names[v_n];
end;
$$;

-- Why this game's homes cannot be used, or null when they can. The same
-- questions, and the same words, as homesProblem in lib/territory.js.
--
-- A home can never be taken, so to every other team it is a wall. Every team
-- must be able to reach every place that is not a home, for the whole game.
create function territory_homes_problem(p_game_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_team    record;
  v_name    text;
  v_homes   text[];
  v_cut     text[];
  v_through text[];
begin
  select te.name into v_name from teams te
   where te.game_id = p_game_id and te.home is null
   order by te.slot limit 1;
  if v_name is not null then
    return format('%s has no home yet. Pick one on the Board tab.', v_name);
  end if;

  select p.name into v_name
    from teams te join territory_places p on p.key = te.home
   where te.game_id = p_game_id
   group by p.name having count(*) > 1
   limit 1;
  if v_name is not null then
    return format('Two teams have %s as their home. Every team needs its own.', v_name);
  end if;

  select coalesce(array_agg(te.home), '{}') into v_homes
    from teams te where te.game_id = p_game_id;

  for v_team in select te.id, te.name, te.home from teams te
                 where te.game_id = p_game_id order by te.slot loop
    with recursive reach(place) as (
      select v_team.home
      union
      select case when l.a = r.place then l.b else l.a end
        from reach r
        join territory_links l on r.place in (l.a, l.b)
       where not (case when l.a = r.place then l.b else l.a end) = any (v_homes)
    )
    select array_agg(p.key order by p.idx) into v_cut
      from territory_places p
     where not p.key = any (v_homes)
       and p.key not in (select place from reach);

    if v_cut is not null then
      select array_agg(s.key order by s.idx) into v_through
        from (
          select distinct p.key, p.idx
            from unnest(v_cut) as c(key)
            join territory_links l on c.key in (l.a, l.b)
            join territory_places p on p.key = case when l.a = c.key then l.b else l.a end
           where p.key = any (v_homes) and p.key <> v_team.home
        ) s;
      return format('%s could never reach %s: the only way in is through %s, %s that cannot be taken. Pick another home there.',
                    v_team.name, territory_name_list(v_cut), territory_name_list(v_through),
                    case when coalesce(array_length(v_through, 1), 0) = 1 then 'a home' else 'homes' end);
    end if;
  end loop;

  return null;
end;
$$;

-- The scoreboard, best first: places held, plus each region held whole.
-- Ties go to the team whose last capture came first, then by slot -- the same
-- order as standings() in lib/territory.js.
create function territory_standings(p_game_id uuid)
returns table (
  team_id         uuid,
  team_name       text,
  slot            smallint,
  places          integer,
  regions         text[],
  bonus           integer,
  score           integer,
  last_capture_at timestamptz,
  place           integer
)
language sql
stable
security definer
set search_path = public
as $$
  with own as (
    select * from territory_owners(p_game_id)
  ),
  held as (
    select p.region, (array_agg(o.team_id))[1] as team_id
      from territory_places p
      left join own o on o.place = p.key
     group by p.region
    having count(o.team_id) = count(*) and count(distinct o.team_id) = 1
  ),
  tally as (
    select te.id, te.name, te.slot,
           (select count(*)::int from own o where o.team_id = te.id) as places,
           coalesce((select array_agg(h.region order by rg.sort)
                       from held h join territory_regions rg on rg.key = h.region
                      where h.team_id = te.id), '{}'::text[]) as regions,
           coalesce((select sum(rg.bonus)::int
                       from held h join territory_regions rg on rg.key = h.region
                      where h.team_id = te.id), 0) as bonus,
           (select max(c.at) from territory_captures c
             where c.game_id = p_game_id and c.team_id = te.id
               and c.revoked_at is null) as last_at
      from teams te
     where te.game_id = p_game_id
  )
  select r.id, r.name, r.slot, r.places, r.regions, r.bonus, r.places + r.bonus, r.last_at,
         (row_number() over (order by r.places + r.bonus desc, r.last_at asc nulls last, r.slot))::int
    from tally r
   order by 9;
$$;

-- Everything the map draws, in one object. All of it public.
--   owners   [{ place, team_id, home }]
--   captures [{ place, team_id, from_team_id, at }] oldest first, live only
--   attacks  [{ place, team_id }] a team working on a place another team
--            holds, with a screenshot in (the feed has said so already)
--   bonuses  { region: points }
create function territory_state(p_game_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'owners', coalesce((
      select jsonb_agg(jsonb_build_object('place', o.place, 'team_id', o.team_id, 'home', o.is_home))
        from territory_owners(p_game_id) o
    ), '[]'::jsonb),
    'captures', coalesce((
      select jsonb_agg(jsonb_build_object('place', c.place, 'team_id', c.team_id,
                                          'from_team_id', c.from_team_id, 'at', c.at)
                       order by c.seq)
        from territory_captures c
       where c.game_id = p_game_id and c.revoked_at is null
    ), '[]'::jsonb),
    'attacks', coalesce((
      select jsonb_agg(distinct jsonb_build_object('place', p.key, 'team_id', c.team_id))
        from tile_claims c
        join tiles t on t.id = c.tile_id
        join territory_places p on p.position = t.position
        join territory_owners(p_game_id) o on o.place = p.key
       where t.game_id = p_game_id
         and c.status = 'active' and c.paused_at is null
         and o.team_id <> c.team_id
         and exists (select 1 from tile_evidence e where e.claim_id = c.id)
    ), '[]'::jsonb),
    'bonuses', coalesce((
      select jsonb_object_agg(r.key, r.bonus) from territory_regions r
    ), '{}'::jsonb)
  );
$$;

-- ============================================================
-- 5. Playing
-- ============================================================

-- Open a place for my team: its claim id, for the upload path. Asks the same
-- questions as openRefusal in lib/territory.js, and is the authority.
-- Opening a place the team gave up on carries on from its screenshots.
create function territory_open_tile(p_game_id uuid, p_place text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game  games%rowtype;
  v_team  teams%rowtype;
  v_place territory_places%rowtype;
  v_tile  uuid;
  v_claim tile_claims%rowtype;
  v_open  int;
  v_id    uuid;
begin
  select * into v_game from games where id = p_game_id;
  if not found then raise exception 'No such game'; end if;
  if v_game.mode <> 'territory' then
    raise exception 'This is not a Territory game';
  end if;

  -- Locked, so two players on one team cannot both open a third place.
  select * into v_team from teams where id = my_team_in_game(p_game_id) for update;
  if not found then
    raise exception 'You are not a member of a team in this game';
  end if;

  if v_game.status <> 'active' then
    raise exception 'The map opens when the game starts';
  end if;
  if v_game.ends_at is not null and now() >= v_game.ends_at then
    raise exception 'Time is up — no more submissions';
  end if;

  select * into v_place from territory_places where key = p_place;
  if not found then raise exception '% is not a place on the map', p_place; end if;

  if v_team.home = v_place.key then
    raise exception 'This is your home. It is yours for the whole game.';
  end if;
  if exists (select 1 from teams te where te.game_id = p_game_id and te.home = v_place.key) then
    raise exception 'A home cannot be taken.';
  end if;
  if territory_owner(p_game_id, v_place.key) = v_team.id then
    raise exception 'Your team already holds %.', v_place.name;
  end if;

  select t.id into v_tile from tiles t
   where t.game_id = p_game_id and t.position = v_place.position;
  if v_tile is null then
    raise exception '% has no task', v_place.name;
  end if;

  select * into v_claim from tile_claims where team_id = v_team.id and tile_id = v_tile;
  if found and v_claim.status = 'active' and v_claim.paused_at is null then
    return v_claim.id;   -- already open: carrying on, not opening
  end if;

  select count(*) into v_open
    from tile_claims c join tiles t on t.id = c.tile_id
   where c.team_id = v_team.id and t.game_id = p_game_id
     and c.status = 'active' and c.paused_at is null;
  if v_open >= 2 then
    raise exception 'Your team is already working on 2 places. Finish one first.';
  end if;

  if not exists (select 1 from territory_neighbours(v_place.key) n(place)
                  where territory_owner(p_game_id, n.place) = v_team.id) then
    raise exception '% is not linked to your land.', v_place.name;
  end if;

  if v_claim.id is null then
    insert into tile_claims (team_id, tile_id, claimed_by)
    values (v_team.id, v_tile, auth.uid())
    returning id into v_id;
  else
    update tile_claims
       set status = 'active', paused_at = null, fired_by = null, fired_at = null
     where id = v_claim.id
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

-- Give up on a place my team has open. Its screenshots stay, for if the team
-- comes back to it; it stops counting towards the 2.
create function territory_drop_tile(p_game_id uuid, p_place text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game  games%rowtype;
  v_team  uuid;
  v_place territory_places%rowtype;
  v_claim tile_claims%rowtype;
begin
  select * into v_game from games where id = p_game_id;
  if not found then raise exception 'No such game'; end if;
  if v_game.mode <> 'territory' then
    raise exception 'This is not a Territory game';
  end if;
  v_team := my_team_in_game(p_game_id);
  if v_team is null then
    raise exception 'You are not a member of a team in this game';
  end if;
  if v_game.status <> 'active' then
    raise exception 'The game is % — nothing to give up now', v_game.status;
  end if;

  select * into v_place from territory_places where key = p_place;
  if not found then raise exception '% is not a place on the map', p_place; end if;

  select c.* into v_claim
    from tile_claims c join tiles t on t.id = c.tile_id
   where c.team_id = v_team and t.game_id = p_game_id and t.position = v_place.position
   for update of c;
  if not found or v_claim.status <> 'active' or v_claim.paused_at is not null then
    raise exception 'Your team is not working on %', v_place.name;
  end if;

  update tile_claims set paused_at = now() where id = v_claim.id;

  -- Team-private (is_team_private_event).
  insert into game_events (game_id, team_id, type, payload)
  values (p_game_id, v_team, 'tile_dropped',
          jsonb_build_object('mode',       'territory',
                             'place',      v_place.key,
                             'place_name', v_place.name,
                             'claim_id',   v_claim.id,
                             'by',         auth.uid(),
                             'by_name',    (select display_name from profiles
                                             where id = auth.uid())));
end;
$$;

-- A team lost a place: its screenshots for it move to territory_lost_evidence
-- and its claim goes back to given-up, so a retake starts from zero.
create function territory_lose_place(p_team_id uuid, p_tile_id uuid, p_to_team uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim tile_claims%rowtype;
begin
  select * into v_claim from tile_claims
   where team_id = p_team_id and tile_id = p_tile_id for update;
  if not found then return; end if;   -- held without a claim (a capture handed back)

  insert into territory_lost_evidence (id, game_id, claim_id, team_id, lost_to_team_id, evidence)
  select e.id, t.game_id, e.claim_id, e.team_id, p_to_team, to_jsonb(e)
    from tile_evidence e join tiles t on t.id = p_tile_id
   where e.claim_id = v_claim.id;

  delete from tile_evidence where claim_id = v_claim.id;

  update tile_claims
     set status = 'active', fired_by = null, fired_at = null, paused_at = now()
   where id = v_claim.id;
end;
$$;

-- The task on a place is done: the team takes it. Called by add_evidence when
-- the last screenshot lands.
create function complete_territory_tile(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim tile_claims%rowtype;
  v_tile  tiles%rowtype;
  v_place territory_places%rowtype;
  v_from  uuid;
begin
  select t.* into v_tile from tiles t join tile_claims c on c.tile_id = t.id
   where c.id = p_claim_id;
  if not found then return; end if;

  -- One capture of a place at a time: two teams finishing it together queue
  -- here, and the second takes it from the first.
  perform 1 from tiles where id = v_tile.id for update;

  select * into v_place from territory_places where position = v_tile.position;
  if exists (select 1 from teams te where te.game_id = v_tile.game_id and te.home = v_place.key) then
    raise exception 'A home cannot be taken.';
  end if;

  -- The claims_need_evidence trigger re-checks claim_is_complete.
  update tile_claims
     set status = 'completed', fired_by = auth.uid(), fired_at = now()
   where id = p_claim_id and status = 'active'
  returning * into v_claim;
  if not found then return; end if;

  v_from := territory_owner(v_tile.game_id, v_place.key);
  if v_from = v_claim.team_id then
    return;   -- handed back while the team was working on it: nothing changes hands
  end if;

  insert into territory_captures (game_id, place, team_id, from_team_id, claim_id)
  values (v_tile.game_id, v_place.key, v_claim.team_id, v_from, v_claim.id);

  if v_from is not null then
    perform territory_lose_place(v_from, v_tile.id, v_claim.team_id);
  end if;

  -- Public: the map is open.
  insert into game_events (game_id, team_id, type, payload)
  values (v_tile.game_id, v_claim.team_id, 'tile_captured',
          jsonb_build_object('mode',           'territory',
                             'place',          v_place.key,
                             'place_name',     v_place.name,
                             'position',       v_tile.position,
                             'tile_id',        v_tile.id,
                             'tile_name',      v_tile.name,
                             'from_team_id',   v_from,
                             'from_team_name', (select name from teams where id = v_from),
                             'by',             auth.uid(),
                             'by_name',        (select display_name from profiles
                                                 where id = auth.uid())));
end;
$$;

-- An organiser withdrew evidence and a taken place is no longer finished
-- (admin_revoke_evidence has already set the claim back to active). The
-- capture is revoked, so the place goes back to whoever held it before, and
-- the claim is parked so it does not take one of the team's 2 open places.
-- Answers 'winner_changed' when a finished game's winner moves, else null.
create function territory_after_uncomplete(p_claim_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game games%rowtype;
  v_new  uuid;
begin
  select g.* into v_game
    from games g join tiles t on t.game_id = g.id join tile_claims c on c.tile_id = t.id
   where c.id = p_claim_id;

  update tile_claims set paused_at = now() where id = p_claim_id;

  update territory_captures set revoked_at = now()
   where id = (select c.id from territory_captures c
                where c.claim_id = p_claim_id and c.revoked_at is null
                order by c.seq desc limit 1);

  if v_game.status = 'finished' then
    if exists (select 1 from territory_captures c
                where c.game_id = v_game.id and c.revoked_at is null) then
      select s.team_id into v_new from territory_standings(v_game.id) s order by s.place limit 1;
    end if;
    if v_new is distinct from v_game.winner_team_id then
      update games set winner_team_id = v_new where id = v_game.id;
      return 'winner_changed';
    end if;
  end if;
  return null;
end;
$$;

create function finish_territory(p_game_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game   games%rowtype;
  v_winner uuid;
  v_score  int;
  v_places int;
  v_bonus  int;
begin
  select * into v_game from games where id = p_game_id for update;
  if not found or v_game.mode <> 'territory' or v_game.status <> 'active' then
    return null;
  end if;

  -- Nobody wins a war nobody fought: with no capture at all, every team is
  -- just its home.
  if exists (select 1 from territory_captures c
              where c.game_id = p_game_id and c.revoked_at is null) then
    select s.team_id, s.score, s.places, s.bonus into v_winner, v_score, v_places, v_bonus
      from territory_standings(p_game_id) s order by s.place limit 1;
  end if;

  update games
     set status         = 'finished',
         winner_team_id = v_winner,
         ended_reason   = p_reason,
         ended_at       = case when p_reason = 'time_up'
                               then coalesce(v_game.ends_at, now()) else now() end
   where id = p_game_id;

  insert into game_events (game_id, team_id, type, payload)
  values (p_game_id, v_winner, 'game_ended',
          jsonb_build_object('mode',           'territory',
                             'reason',         p_reason,
                             'winner_team_id', v_winner,
                             'score',          v_score,
                             'places',         v_places,
                             'bonus',          v_bonus));

  return v_winner;
end;
$$;

-- The timer ran out: settle it. Harmless at any other time -- it answers false
-- -- so every open page calls it when its countdown reaches zero, as for bingo.
create function territory_settle(p_game_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game games%rowtype;
begin
  select * into v_game from games where id = p_game_id;
  if not found or v_game.mode <> 'territory' or v_game.status <> 'active'
     or v_game.ends_at is null or now() < v_game.ends_at then
    return false;
  end if;

  perform finish_territory(p_game_id, 'time_up');
  return true;
end;
$$;

-- ============================================================
-- 6. The organiser
-- ============================================================

-- Homes for some or all of the teams, as { team id: place key }. Refused as a
-- whole if together they would wall any place off from any team.
create function admin_set_territory_homes(p_game_id uuid, p_homes jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game    games%rowtype;
  v_team    text;
  v_place   text;
  v_n       int := 0;
  v_problem text;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into v_game from games where id = p_game_id for update;
  if not found then raise exception 'No such game'; end if;
  if v_game.mode <> 'territory' then
    raise exception 'Only a Territory game has homes';
  end if;
  if v_game.status not in ('setup', 'placement') then
    raise exception 'Homes are fixed once the game has started';
  end if;
  if p_homes is null or jsonb_typeof(p_homes) <> 'object' then
    raise exception 'Send the homes as { team: place }';
  end if;

  for v_team, v_place in select k, v from jsonb_each_text(p_homes) as e(k, v) loop
    if not exists (select 1 from teams where id::text = v_team and game_id = p_game_id) then
      raise exception 'That team is not in this game';
    end if;
    if not exists (select 1 from territory_places where key = v_place) then
      raise exception '% is not a place on the map.', v_place;
    end if;
    update teams set home = v_place where id::text = v_team;
    v_n := v_n + 1;
  end loop;

  v_problem := territory_homes_problem(p_game_id);
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;
  return v_n;
end;
$$;

-- ============================================================
-- 7. Discord
-- ============================================================

-- The territory lines. Null for anything else, so discord_line falls through
-- to the shared wording (evidence submitted, evidence withdrawn, ...).
create function territory_discord_line(p_event game_events, p_team text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p       jsonb := p_event.payload;
  v_place text := coalesce(p ->> 'place_name',
                           (select name from territory_places where key = p ->> 'place'),
                           'a place');
begin
  if p_event.type = 'game_started' then
    return ':crossed_swords: **The conquest has begun!** Every team marches out from home.';
  elsif p_event.type = 'game_reset' then
    return 'The conquest has been reset — every team is back to its home.';
  elsif p_event.type = 'tile_captured' then
    return case when p ->> 'from_team_name' is not null
      then format(':crossed_swords: **%s** took **%s** from %s!', p_team, v_place, p ->> 'from_team_name')
      else format(':triangular_flag_on_post: **%s** captured **%s**.', p_team, v_place) end;
  elsif p_event.type = 'tile_attacked' then
    return format(':warning: **%s** is attacking **%s**, held by %s.',
                  p_team, v_place, coalesce(p ->> 'owner_team_name', 'another team'));
  elsif p_event.type = 'tile_dropped' then
    return format('**%s** gave up on **%s**.', p_team, v_place);
  elsif p_event.type = 'game_ended' then
    return case
      when p_event.team_id is null then
        case p ->> 'reason'
          when 'time_up' then ':hourglass: **Time''s up!** No place changed hands, so nobody wins.'
          else 'The organiser ended the game. No place changed hands, so nobody wins.'
        end
      when p ->> 'reason' = 'time_up' then
        format(':hourglass: **Time''s up!** :trophy: **%s** rules the most land and wins with %s points.',
               p_team, p ->> 'score')
      else
        format('The organiser ended the game. :trophy: **%s** wins with %s points.', p_team, p ->> 'score')
    end;
  end if;
  return null;
end;
$$;

-- ============================================================
-- 8. The shared functions, with their territory lines
-- ============================================================
-- Each is its latest definition, named above it, with only the territory
-- lines added. Nothing else in them changes.

-- add_evidence: body from 20261002120100_snakes_mode.sql, with 20261004130000's acting_for_team check, plus: a given-up place must be
-- opened again first, the first screenshot on a rival's place announces the
-- attack, and the last one takes the place (complete_territory_tile).
create or replace function add_evidence(
  p_claim_id uuid, p_storage_path text, p_public_url text default null,
  p_option_id uuid default null, p_amount integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim     tile_claims%rowtype;
  v_tile      tiles%rowtype;
  v_game      games%rowtype;
  v_open      boolean;
  v_snakes    boolean;
  v_territory boolean;
  v_place     territory_places%rowtype;
  v_owner     uuid;
  v_team      teams%rowtype;
  v_name      text;
  v_prefix    text;
  v_row       tile_evidence;
  v_have      int;
  v_points    int;
  v_required  int;
  v_result    shot_result;
  v_will_fire boolean;
  v_left      int;
  v_has_opts  boolean;
  v_opt       tile_options%rowtype;
  v_opt_label text;
  v_award     int := 1;
  v_sets      boolean;
  v_refuse    text;
begin
  select * into v_claim from tile_claims where id = p_claim_id for update;
  if not found then raise exception 'No such tile claim'; end if;

  if not acting_for_team(v_claim.team_id) then
    raise exception 'That tile belongs to the other team';
  end if;

  if v_claim.status = 'fired' then
    raise exception 'That tile has already been fired';
  end if;
  if v_claim.status = 'completed' then
    raise exception 'Your team has already completed that tile';
  end if;

  select * into v_tile from tiles where id = v_claim.tile_id;
  select * into v_game from games where id = v_tile.game_id;
  -- Bingo and snakes: no slots, nothing fired, and the game must be running.
  v_open   := v_game.mode <> 'battleships';
  v_snakes := v_game.mode = 'snakes';
  v_territory := v_game.mode = 'territory';

  if v_open then
    if v_game.status <> 'active' then
      raise exception 'The game is % — no submissions now', v_game.status;
    end if;
    if v_game.ends_at is not null and now() >= v_game.ends_at then
      raise exception 'Time is up — no more submissions';
    end if;

    -- Snakes: only the tile the team stands on. Locks the team, so a roll or
    -- a punishment cannot move it mid-submission.
    if v_snakes then
      select * into v_team from teams where id = v_claim.team_id for update;
      if v_team.board_tile <> v_tile.position then
        raise exception 'That is not your team''s current tile — you are on tile %',
          v_team.board_tile;
      end if;
    end if;

    -- Territory: a place the team gave up on, or lost, is opened again first.
    if v_territory and v_claim.paused_at is not null then
      raise exception 'Open this place again before adding screenshots';
    end if;
  end if;

  v_prefix := v_tile.game_id || '/' || v_claim.team_id || '/' || v_claim.id || '/';
  if position(v_prefix in p_storage_path) <> 1 then
    raise exception 'That evidence path does not belong to this claim';
  end if;

  select exists (select 1 from tile_options where tile_id = v_tile.id) into v_has_opts;
  v_sets := v_tile.completion in ('one_set', 'each_set');

  if v_tile.completion = 'value' then
    if p_option_id is not null then
      raise exception 'This tile is scored on the value you enter, not on a drop list';
    end if;
    if p_amount is null then
      raise exception 'Say what this drop was worth';
    end if;
    -- Tenths of a million, so this is 0.1m to 1000m. The message is in the
    -- millions the player typed, not in the unit it arrived as.
    if p_amount < 1 or p_amount > 10000 then
      raise exception 'That value must be between 0.1m and 1000m';
    end if;
    v_award := p_amount;

  else
    if p_amount is not null then
      raise exception 'This tile is not scored on a typed value';
    end if;

    if p_option_id is not null then
      if not v_has_opts then
        raise exception 'This tile has no drop options to choose from';
      end if;
      select * into v_opt from tile_options
       where id = p_option_id and tile_id = v_tile.id;
      if not found then raise exception 'That is not one of this tile''s options'; end if;

      v_refuse := evidence_refusal(p_claim_id, p_option_id);
      if v_refuse is not null then raise exception '%', v_refuse; end if;

      v_award     := case when v_sets then 1 else v_opt.points end;
      v_opt_label := v_opt.label;
    elsif v_has_opts then
      raise exception 'Say which drop this screenshot shows';
    end if;
  end if;

  select display_name into v_name from profiles where id = auth.uid();

  insert into tile_evidence (claim_id, team_id, storage_path, uploaded_by,
                             uploaded_by_name, public_url, option_id, points)
  values (p_claim_id, v_claim.team_id, p_storage_path, auth.uid(),
          coalesce(v_name, 'unknown'), nullif(btrim(coalesce(p_public_url, '')), ''),
          p_option_id, v_award)
  returning * into v_row;

  select count(*), coalesce(sum(points), 0)
    into v_have, v_points
    from tile_evidence where claim_id = p_claim_id;

  v_required  := coalesce(v_tile.required_evidence, 1);
  v_will_fire := claim_is_complete(p_claim_id);

  -- Slots are a battleships idea; a bingo line has nothing to count down.
  if not v_open then
    select count(*) into v_left from tile_claims
     where team_id = v_claim.team_id and status = 'active';
    if v_will_fire then v_left := v_left - 1; end if;
  end if;

  insert into game_events (game_id, team_id, type, payload)
  values (v_tile.game_id, v_claim.team_id, 'evidence_submitted',
          jsonb_build_object(
            'claim_id', p_claim_id,
            'position', v_tile.position,
            'tile_name', v_tile.name,
            'uploaded_by_name', coalesce(v_name, 'unknown'),
            'evidence_count', v_have,
            'required_evidence', v_required,
            'tiles_left_to_fire', v_left,
            'image_url', v_row.public_url,
            -- Team-private event (0035), so the option label is safe here and
            -- ONLY here. Never add it to a globally readable event type.
            'option_label', v_opt_label,
            'points_awarded', v_award,
            'points_total', v_points,
            'completion', v_tile.completion::text,
            'weighted', v_has_opts
          ));

  -- Territory: the first screenshot on a place another team holds is public,
  -- so its owner sees the attack coming. Not when it already finishes it: the
  -- capture says so.
  if v_territory and v_have = 1 and not v_will_fire then
    select * into v_place from territory_places where position = v_tile.position;
    v_owner := territory_owner(v_tile.game_id, v_place.key);
    if v_owner is not null and v_owner <> v_claim.team_id then
      insert into game_events (game_id, team_id, type, payload)
      values (v_tile.game_id, v_claim.team_id, 'tile_attacked',
              jsonb_build_object('mode',            'territory',
                                 'place',           v_place.key,
                                 'place_name',      v_place.name,
                                 'owner_team_id',   v_owner,
                                 'owner_team_name', (select name from teams where id = v_owner)));
    end if;
  end if;

  if v_will_fire then
    if v_snakes then
      perform complete_snakes_tile(p_claim_id, false);
    elsif v_territory then
      perform complete_territory_tile(p_claim_id);
    elsif v_open then
      perform complete_bingo_tile(p_claim_id);
    else
      v_result := fire_tile(p_claim_id);

      insert into game_events (game_id, team_id, type, payload)
      values (v_tile.game_id, v_claim.team_id, 'slot_freed',
              jsonb_build_object('claim_id', p_claim_id, 'position', v_tile.position));
    end if;
  end if;

  return jsonb_build_object(
    'evidence_id',       v_row.id,
    'evidence_count',    v_have,
    'required_evidence', v_required,
    'points_awarded',    v_award,
    'points_total',      v_points,
    'fired',             v_result is not null,
    'result',            v_result,
    'completed',         v_will_fire
  );
end;
$$;

-- is_team_private_event: body from 20260927130100_admin_revoke_pet_jar.sql, plus tile_dropped.
create or replace function is_team_private_event(p_type event_type)
returns boolean
language sql immutable set search_path = '' as $$
  select p_type = any(array[
    'evidence_submitted',
    'evidence_revoked',
    'tile_relocked',
    'slot_freed',
    'pet_jar_submitted',
    'pet_jar_spent',
    'pet_jar_revoked',
    'tile_dropped'
  ]::public.event_type[]);
$$;

-- admin_new_game: body from 20261002120100_snakes_mode.sql, plus territory: 1 to 6 teams, an 8x8 card, and
-- every team on its suggested home.
create or replace function admin_new_game(
  p_name      text,
  p_mode      game_mode,
  p_teams     text[],
  p_grid_size smallint default 10,
  p_ends_at   timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_id uuid;
  v_names   text[];
  v_i       int;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Game needs a name'; end if;

  select coalesce(array_agg(btrim(n) order by ord), '{}')
    into v_names
    from unnest(coalesce(p_teams, '{}'::text[])) with ordinality as u(n, ord)
   where btrim(coalesce(n, '')) <> '';

  if p_mode = 'battleships' then
    if coalesce(array_length(v_names, 1), 0) <> 2 then
      raise exception 'Battleships needs exactly two teams';
    end if;
    return admin_create_game(p_name, v_names[1], v_names[2], p_grid_size, 3::smallint);
  end if;

  if p_mode = 'snakes' then
    if coalesce(array_length(v_names, 1), 0) < 1 then
      raise exception 'Snakes and Ladders needs at least one team';
    end if;
    if p_ends_at is not null then
      raise exception 'Snakes and Ladders has no end time — it ends when a team finishes tile 100';
    end if;
  end if;

  if p_mode = 'territory' then
    if coalesce(array_length(v_names, 1), 0) < 1 then
      raise exception 'Territory needs at least one team';
    end if;
    if array_length(v_names, 1) > array_length(territory_default_homes(), 1) then
      raise exception 'Territory has six homes, so at most six teams';
    end if;
  end if;

  if coalesce(array_length(v_names, 1), 0) < 1 then
    raise exception 'A bingo needs at least one team';
  end if;
  if (select count(distinct lower(u.n)) from unnest(v_names) as u(n)) <> array_length(v_names, 1) then
    raise exception 'Every team needs a different name';
  end if;
  if p_mode = 'bingo' and (p_grid_size is null or p_grid_size < 3 or p_grid_size > 10) then
    raise exception 'A bingo card is 3x3 to 10x10';
  end if;
  if p_ends_at is not null and p_ends_at <= now() then
    raise exception 'The end time is in the past';
  end if;

  insert into games (name, mode, status, grid_size, max_active_tiles, ends_at)
  -- A snakes board is always the 100 tiles, whatever size was sent.
  values (btrim(p_name), p_mode, 'setup',
          case when p_mode = 'snakes' then 10 when p_mode = 'territory' then 8
               else p_grid_size end, 1, p_ends_at)
  returning id into v_game_id;

  for v_i in 1 .. array_length(v_names, 1) loop
    insert into teams (game_id, name, slot, home)
    values (v_game_id, v_names[v_i], v_i,
            case when p_mode = 'territory' then (territory_default_homes())[v_i] end);
  end loop;

  return v_game_id;
end;
$$;

-- admin_add_team: body from 20261002120100_snakes_mode.sql, plus territory: only before the game starts, at
-- most six, and the new team gets the first suggested home nobody has.
create or replace function admin_add_team(p_game_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game games%rowtype;
  v_id   uuid;
  v_home text;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into v_game from games where id = p_game_id;
  if not found then raise exception 'No such game'; end if;
  if v_game.mode = 'battleships' then
    raise exception 'Battleships always has exactly two teams';
  end if;
  if v_game.status = 'finished' then
    raise exception 'The game is over';
  end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'The team needs a name'; end if;
  if exists (select 1 from teams where game_id = p_game_id and lower(name) = lower(btrim(p_name))) then
    raise exception 'There is already a team called %', btrim(p_name);
  end if;

  if v_game.mode = 'territory' then
    if v_game.status not in ('setup', 'placement') then
      raise exception 'Teams can only join a Territory game before it starts';
    end if;
    if (select count(*) from teams where game_id = p_game_id)
       >= array_length(territory_default_homes(), 1) then
      raise exception 'Territory has six homes, so at most six teams';
    end if;
    select u.k into v_home
      from unnest(territory_default_homes()
                  || array(select p.key from territory_places p order by p.idx))
           with ordinality as u(k, o)
     where not exists (select 1 from teams te
                        where te.game_id = p_game_id and te.home = u.k)
     order by u.o limit 1;
  end if;

  insert into teams (game_id, name, slot, home)
  values (p_game_id, btrim(p_name),
          coalesce((select max(slot) from teams where game_id = p_game_id), 0) + 1,
          v_home)
  returning id into v_id;
  return v_id;
end;
$$;

-- admin_end_game: body from 20261002120100_snakes_mode.sql, plus territory: the highest score wins now.
create or replace function admin_end_game(p_game_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game games%rowtype;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into v_game from games where id = p_game_id;
  if not found then raise exception 'No such game'; end if;
  if v_game.mode = 'territory' then
    if v_game.status <> 'active' then
      raise exception 'The game is % — it is not running', v_game.status;
    end if;
    return finish_territory(p_game_id,
      case when v_game.ends_at is not null and now() >= v_game.ends_at
           then 'time_up' else 'admin' end);
  end if;
  if v_game.mode = 'snakes' then
    raise exception 'Snakes and Ladders ends through admin_snakes_end_game, which names the winner first';
  end if;
  if v_game.mode <> 'bingo' then
    raise exception 'A battleships game ends when a fleet is sunk';
  end if;
  if v_game.status <> 'active' then
    raise exception 'The game is % — it is not running', v_game.status;
  end if;
  return finish_bingo(p_game_id,
    case when v_game.ends_at is not null and now() >= v_game.ends_at
         then 'time_up' else 'admin' end);
end;
$$;

-- admin_reset_game: body from 20261002120100_snakes_mode.sql, plus territory: every place back to free. Homes stay.
create or replace function admin_reset_game(p_game_id uuid, p_clear_fleets boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status game_status;
  v_mode   game_mode;
begin
  if not is_admin() then raise exception 'Admins only'; end if;

  select status, mode into v_status, v_mode from games where id = p_game_id;
  if not found then
    raise exception 'No such game';
  end if;
  if v_status = 'setup' then
    raise exception 'Game is still in setup — there is nothing to reset';
  end if;

  -- Must come first: freeze_fleet_after_placement refuses writes to ships while
  -- the game is not in placement (0013).
  update games
     set status         = 'placement',
         winner_team_id = null,
         started_at     = null,
         ended_at       = null,
         ended_reason   = null
   where id = p_game_id;

  delete from tile_claims
   where tile_id in (select id from tiles where game_id = p_game_id);

  delete from score_events
   where team_id in (select id from teams where game_id = p_game_id);

  -- Territory: every place free again; the homes stay where the organiser put them.
  delete from territory_captures      where game_id = p_game_id;
  delete from territory_lost_evidence where game_id = p_game_id;

  -- The uncovered tiles. Scoped by game_id, which pet_jar_previews carries
  -- directly, so a team playing in two games keeps the other one intact.
  delete from pet_jar_previews where game_id = p_game_id;

  -- The submissions that earned the jars, and the jars themselves.
  delete from pet_jar_submissions where game_id = p_game_id;

  update teams set pet_jar_count = 0 where game_id = p_game_id;

  -- Snakes: everyone back to Start, rollbacks gone. The snakes stay.
  update teams
     set board_tile = 0, board_moved_at = null, rollbacks_available = 0,
         rollbacks_used = 0, auto_rollback_earned = false
   where game_id = p_game_id;

  -- The feed is a live activity log, not an audit trail.
  delete from game_events where game_id = p_game_id;

  if p_clear_fleets and v_mode = 'battleships' then
    delete from ships
     where team_id in (select id from teams where game_id = p_game_id);
  end if;

  insert into game_events (game_id, type, payload)
  values (p_game_id, 'game_reset',
          jsonb_build_object('by', auth.uid(),
                             'fleets_cleared', p_clear_fleets and v_mode = 'battleships',
                             'mode', v_mode));
end;
$$;

-- admin_revoke_evidence: body from 20261002120100_snakes_mode.sql, plus territory, which takes bingo's branch: a
-- place no longer finished goes back to whoever held it before, and its claim is
-- parked (territory_after_uncomplete).
create or replace function admin_revoke_evidence(p_evidence_id uuid, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ev        tile_evidence%rowtype;
  v_claim     tile_claims%rowtype;
  v_tile      tiles%rowtype;
  v_game      games%rowtype;
  v_team      text;
  v_enemy_id  uuid;
  v_by        text;
  v_opt_label text;
  v_was_fired boolean;
  v_result    shot_result;
  v_ship_id   uuid;
  v_ship_size int := 0;
  v_was_sunk  boolean := false;
  v_refloated boolean := false;
  v_reopened  boolean := false;
  v_unfired   boolean := false;
  v_rings     int := 0;
  v_left      int := 0;
  v_points    int := 0;
  v_active    int := 0;
  v_limit     smallint;
  v_still     boolean;
  v_out       jsonb;
  v_was_done  boolean := false;
  v_undone    boolean := false;
  v_new_win   uuid;
  v_win_moved boolean := false;
  v_effect    text;
begin
  if not is_admin() then raise exception 'Admins only'; end if;

  select * into v_ev from tile_evidence where id = p_evidence_id;
  if not found then raise exception 'No such piece of evidence'; end if;

  select * into v_claim from tile_claims where id = v_ev.claim_id for update;
  if not found then raise exception 'No such tile claim'; end if;

  select * into v_tile from tiles  where id = v_claim.tile_id;
  select * into v_game from games  where id = v_tile.game_id;
  select name into v_team from teams where id = v_claim.team_id;

  if v_ev.option_id is not null then
    select label into v_opt_label from tile_options where id = v_ev.option_id;
  end if;

  select display_name into v_by from profiles where id = auth.uid();

  -- ---------------------------------------------------------- bingo
  if v_game.mode in ('bingo', 'snakes', 'territory') then
    v_was_done := v_claim.status = 'completed';

    begin
      delete from tile_evidence where id = p_evidence_id;

      select count(*), coalesce(sum(points), 0)
        into v_left, v_points
        from tile_evidence where claim_id = v_claim.id;

      -- An organiser's "complete tile now" (snakes) does not hang on evidence.
      v_still := claim_is_complete(v_claim.id) or v_claim.completed_early;

      if v_was_done and not v_still then
        v_undone := true;

        update tile_claims
           set status = 'active', fired_by = null, fired_at = null
         where id = v_claim.id;

        if v_game.mode = 'snakes' then
          v_effect    := snakes_after_uncomplete(v_game.id, v_claim.team_id, v_tile.position);
          v_reopened  := coalesce(v_effect = 'reopened', false);
          v_win_moved := coalesce(v_effect = 'winner_changed', false);
        elsif v_game.mode = 'territory' then
          v_effect    := territory_after_uncomplete(v_claim.id);
          v_win_moved := coalesce(v_effect = 'winner_changed', false);
        elsif v_game.status = 'finished' then
          if v_game.ended_reason = 'full_card'
             and (v_game.ends_at is null or now() < v_game.ends_at) then
            update games
               set status = 'active', winner_team_id = null,
                   ended_at = null, ended_reason = null
             where id = v_game.id;
            v_reopened := true;
          else
            select s.team_id into v_new_win
              from bingo_standings(v_game.id) s
             where s.tiles_completed > 0
             order by s.place limit 1;
            if v_new_win is distinct from v_game.winner_team_id then
              update games set winner_team_id = v_new_win where id = v_game.id;
              v_win_moved := true;
            end if;
          end if;
        end if;
      end if;

      v_out := jsonb_build_object(
        'evidence_id',       p_evidence_id,
        'claim_id',          v_claim.id,
        'dry_run',           p_dry_run,
        'mode',              v_game.mode::text,
        'position',          v_tile.position,
        'tile_name',         v_tile.name,
        'completion',        v_tile.completion::text,
        'required_evidence', coalesce(v_tile.required_evidence, 1),
        'team_id',           v_claim.team_id,
        'team_name',         v_team,
        'submitted_by',      v_ev.uploaded_by_name,
        'submitted_at',      v_ev.created_at,
        'option_label',      v_opt_label,
        'points_removed',    v_ev.points,
        'evidence_left',     v_left,
        'points_left',       v_points,
        'still_complete',    v_still,
        'was_completed',     v_was_done,
        'uncompleted',       v_undone,
        'was_fired',         false,
        'unfired',           false,
        'parked',            false,
        -- The revoke line is team-private; other teams only see the count in
        -- the standings drop.
        'announced_to_all',  false,
        'ship_refloated',    false,
        'reveals_withdrawn', 0,
        'game_reopened',     v_reopened,
        'winner_changed',    v_win_moved,
        'over_slot_limit',   false
      );

      if p_dry_run then
        raise exception 'dry run complete' using errcode = 'HS001';
      end if;

      insert into game_events (game_id, team_id, type, payload)
      values (v_game.id, v_claim.team_id, 'evidence_revoked',
              jsonb_build_object(
                'claim_id',          v_claim.id,
                'position',          v_tile.position,
                'tile_name',         v_tile.name,
                'option_label',      v_opt_label,
                'points_removed',    v_ev.points,
                'submitted_by_name', v_ev.uploaded_by_name,
                'evidence_count',    v_left,
                'required_evidence', coalesce(v_tile.required_evidence, 1),
                'uncompleted',       v_undone,
                'unfired',           false,
                'parked',            false,
                'game_reopened',     v_reopened,
                'winner_changed',    v_win_moved,
                'by',                auth.uid(),
                'by_name',           coalesce(v_by, 'an admin')
              ));

    exception
      when sqlstate 'HS001' then
        null;
    end;

    return v_out;
  end if;

  -- ---------------------------------------------------------- battleships
  select id into v_enemy_id from teams
   where game_id = v_game.id and id <> v_claim.team_id;

  v_was_fired := v_claim.status = 'fired';
  v_result    := v_claim.result;

  if v_was_fired and v_result = 'hit' then
    select sc.ship_id into v_ship_id
      from ship_cells sc
     where sc.team_id = v_enemy_id and sc.row = v_tile.row and sc.col = v_tile.col;

    if v_ship_id is not null then
      select count(distinct (sc.row, sc.col))::int into v_ship_size
        from ship_cells sc where sc.ship_id = v_ship_id;
      v_was_sunk := ship_is_sunk(v_ship_id, v_claim.team_id);
    end if;
  end if;

  begin
    delete from tile_evidence where id = p_evidence_id;

    select count(*), coalesce(sum(points), 0)
      into v_left, v_points
      from tile_evidence where claim_id = v_claim.id;

    v_still := claim_is_complete(v_claim.id);

    if v_was_fired and not v_still then
      v_unfired := true;

      update tile_claims
         set status = 'active', result = null, fired_by = null, fired_at = null,
             paused_at = now()
       where id = v_claim.id;

      if v_was_sunk and not ship_is_sunk(v_ship_id, v_claim.team_id) then
        v_refloated := true;

        with gone as (
          delete from tile_claims c
           using tiles t
           where c.tile_id  = t.id
             and c.team_id  = v_claim.team_id
             and c.status   = 'fired'
             and c.result   = 'miss'
             and c.claimed_by is null
             and c.fired_by   is null
             and not exists (select 1 from tile_evidence e where e.claim_id = c.id)
             and exists (
                   select 1 from ship_cells h
                    where h.ship_id = v_ship_id
                      and abs(h.row - t.row) <= 1
                      and abs(h.col - t.col) <= 1)
             and not exists (
                   select 1 from ship_cells h2
                    where h2.team_id  = v_enemy_id
                      and h2.ship_id <> v_ship_id
                      and abs(h2.row - t.row) <= 1
                      and abs(h2.col - t.col) <= 1
                      and ship_is_sunk(h2.ship_id, v_claim.team_id))
          returning 1
        )
        select count(*)::int into v_rings from gone;
      end if;

      if v_game.status = 'finished'
         and v_game.winner_team_id = v_claim.team_id
         and exists (select 1 from ships s
                      where s.team_id = v_enemy_id
                        and not ship_is_sunk(s.id, v_claim.team_id)) then
        update games
           set status = 'active', winner_team_id = null, ended_at = null
         where id = v_game.id;
        v_reopened := true;
      end if;
    end if;

    select count(*)::int into v_active from tile_claims
     where team_id = v_claim.team_id and status = 'active' and paused_at is null;
    v_limit := v_game.max_active_tiles;

    v_out := jsonb_build_object(
      'evidence_id',       p_evidence_id,
      'claim_id',          v_claim.id,
      'dry_run',           p_dry_run,
      'position',          v_tile.position,
      'tile_name',         v_tile.name,
      'completion',        v_tile.completion::text,
      'required_evidence', coalesce(v_tile.required_evidence, 1),
      'team_id',           v_claim.team_id,
      'team_name',         v_team,
      'submitted_by',      v_ev.uploaded_by_name,
      'submitted_at',      v_ev.created_at,
      'option_label',      v_opt_label,
      'points_removed',    v_ev.points,
      'evidence_left',     v_left,
      'points_left',       v_points,
      'still_complete',    v_still,
      'was_fired',         v_was_fired,
      'shot_result',       v_result,
      'unfired',           v_unfired,
      'parked',            v_unfired,
      'announced_to_all',  v_unfired,
      'ship_refloated',    v_refloated,
      'ship_size',         case when v_refloated then v_ship_size end,
      'reveals_withdrawn', v_rings,
      'game_reopened',     v_reopened,
      'active_tiles',      v_active,
      'max_active_tiles',  v_limit,
      'over_slot_limit',   false
    );

    if p_dry_run then
      raise exception 'dry run complete' using errcode = 'HS001';
    end if;

    insert into game_events (game_id, team_id, type, payload)
    values (v_game.id, v_claim.team_id, 'evidence_revoked',
            jsonb_build_object(
              'claim_id',          v_claim.id,
              'position',          v_tile.position,
              'tile_name',         v_tile.name,
              'option_label',      v_opt_label,
              'points_removed',    v_ev.points,
              'submitted_by_name', v_ev.uploaded_by_name,
              'evidence_count',    v_left,
              'required_evidence', coalesce(v_tile.required_evidence, 1),
              'unfired',           v_unfired,
              'parked',            v_unfired,
              'ship_refloated',    v_refloated,
              'reveals_withdrawn', v_rings,
              'game_reopened',     v_reopened,
              'by',                auth.uid(),
              'by_name',           coalesce(v_by, 'an admin')
            ));

    if v_unfired then
      insert into game_events (game_id, team_id, type, payload)
      values (v_game.id, v_claim.team_id, 'shot_withdrawn',
              jsonb_build_object('by_name', coalesce(v_by, 'an admin')));
    end if;

  exception
    when sqlstate 'HS001' then
      null;
  end;

  return v_out;
end;
$$;

-- start_game: body from 20261003130000_start_game_missing_list.sql, plus territory: every team has a home, the homes
-- wall nothing off, and every other place has a task.
create or replace function start_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game      games%rowtype;
  v_teams     int;
  v_unready   int;
  v_tiles     int;
  v_no_captain text;
  v_empty     text;
  v_missing   int[];
  v_places    text[];
begin
  if not is_admin() then
    raise exception 'Only an admin may start the game';
  end if;

  select * into v_game from games where id = p_game_id;

  if v_game.mode in ('bingo', 'snakes', 'territory') then
    -- No fleets to place, so preparation is optional: a bingo or a snakes game
    -- can start straight from setup.
    if v_game.status not in ('setup', 'placement') then
      raise exception 'Game is % — it can only be started before it runs', v_game.status;
    end if;

    select count(*) into v_teams from teams where game_id = p_game_id;
    if v_teams < 1 then
      raise exception 'Game needs at least one team before it can start';
    end if;

    if v_game.mode = 'snakes' then
      -- A snake head or a ladder's foot needs no task: landing there moves
      -- the team on at once, so nobody ever stands on one.
      select count(*), array_agg(s.p order by s.p)
        into v_tiles, v_missing
        from generate_series(1, 100) as s(p)
       where not exists (select 1 from tiles t
                          where t.game_id = p_game_id and t.position = s.p)
         and not exists (select 1 from board_jumps j
                          where j.game_id = p_game_id and j.from_tile = s.p);
      if v_tiles > 0 then
        -- Whole numbers only: the first 20, then an ellipsis if there are more.
        v_empty := array_to_string(v_missing[1:20], ', ')
                   || case when v_tiles > 20 then ', …' else '' end;
        raise exception 'Game needs a tile on every square except snake heads and ladder bottoms — % missing (%)',
          v_tiles, v_empty;
      end if;
    elsif v_game.mode = 'territory' then
      v_empty := territory_homes_problem(p_game_id);
      if v_empty is not null then
        raise exception '%', v_empty;
      end if;
      -- A home needs no task: nobody can take it.
      select count(*), array_agg(p.key order by p.idx)
        into v_tiles, v_places
        from territory_places p
       where not exists (select 1 from tiles t
                          where t.game_id = p_game_id and t.position = p.position)
         and not exists (select 1 from teams te
                          where te.game_id = p_game_id and te.home = p.key);
      if v_tiles > 0 then
        raise exception 'Every place but the homes needs a task — % still have none (%)',
          v_tiles, territory_name_list(v_places);
      end if;
    else
      select count(*) into v_tiles from tiles where game_id = p_game_id;
      if v_tiles <> v_game.grid_size * v_game.grid_size then
        raise exception 'Game needs % tiles before it can start (has %)',
          v_game.grid_size * v_game.grid_size, v_tiles;
      end if;
    end if;

    select string_agg(t.name, ' and ' order by t.slot) into v_empty
      from teams t
     where t.game_id = p_game_id
       and not exists (select 1 from team_members m where m.team_id = t.id);
    if v_empty is not null then
      raise exception '% has no players yet — add them in the roster', v_empty;
    end if;

    if v_game.ends_at is not null and v_game.ends_at <= now() then
      raise exception 'The end time has already passed — move it or clear it first';
    end if;

    -- Snakes: every team leaves from Start.
    update teams set board_tile = 0, board_moved_at = null where game_id = p_game_id;

    update games set status = 'active', started_at = now() where id = p_game_id;

    insert into game_events (game_id, type, payload)
    values (p_game_id, 'game_started',
            jsonb_build_object('by', auth.uid(), 'mode', v_game.mode));
    return;
  end if;

  if v_game.status <> 'placement' then
    raise exception 'Game is % — it can only be started from placement', v_game.status;
  end if;

  select count(*) into v_teams from teams where game_id = p_game_id;
  if v_teams <> 2 then
    raise exception 'Game needs two teams before it can start (has %)', v_teams;
  end if;

  select count(*) into v_tiles from tiles where game_id = p_game_id;
  if v_tiles <> v_game.grid_size * v_game.grid_size then
    raise exception 'Game needs % tiles before it can start (has %)',
      v_game.grid_size * v_game.grid_size, v_tiles;
  end if;

  -- Named, not counted: "1 team has no captain" sends the organiser hunting
  -- through the roster, and the roster is the one screen that cannot show it.
  select string_agg(t.name, ' and ' order by t.name) into v_no_captain
    from teams t
   where t.game_id = p_game_id
     and not exists (
       select 1 from team_members m
        where m.team_id = t.id and m.role = 'captain'
     );

  if v_no_captain is not null then
    raise exception
      '% needs a captain before the game can start — set one in the roster',
      v_no_captain;
  end if;

  select count(*) into v_unready
    from teams t
   where t.game_id = p_game_id
     and (select count(*) from ships s where s.team_id = t.id)
         <> array_length(v_game.fleet, 1);

  if v_unready > 0 then
    raise exception '% team(s) have not finished placing their fleet', v_unready;
  end if;

  -- Cheap, and the last moment anyone is looking at the board before it counts.
  perform assert_fleets_consistent(p_game_id);

  update games set status = 'active', started_at = now() where id = p_game_id;

  insert into game_events (game_id, type, payload)
  values (p_game_id, 'game_started', jsonb_build_object('by', auth.uid()));
end;
$$;

-- board_for_me: body from 20261002120100_snakes_mode.sql, plus territory: its standings, and the map
-- (territory_state).
create or replace function board_for_me(p_game_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_my_team    uuid;
  v_enemy_team uuid;
  v_mode       game_mode;
begin
  select g.mode into v_mode from games g where g.id = p_game_id;

  select t.id into v_my_team
  from teams t
  where t.game_id = p_game_id
    and exists (
      select 1 from team_members tm
      where tm.team_id = t.id and tm.profile_id = v_uid
    )
  order by t.name
  limit 1;

  select t.id into v_enemy_team
  from teams t
  where t.game_id = p_game_id
    and (v_my_team is null or t.id <> v_my_team)
  order by t.name
  limit 1;

  return jsonb_build_object(
    'game', (select to_jsonb(g) from games g where g.id = p_game_id),
    'teams', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.name)
      from teams t where t.game_id = p_game_id
    ), '[]'::jsonb),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object('team_id', tm.team_id, 'role', tm.role))
      from team_members tm where tm.profile_id = v_uid
    ), '[]'::jsonb),
    'tiles', coalesce((
      select jsonb_agg(to_jsonb(x)) from tiles_for_me(p_game_id) x
    ), '[]'::jsonb),
    'myShipCells', coalesce((
      select jsonb_agg(to_jsonb(sc)) from ship_cells sc
      where (v_my_team is null or sc.team_id = v_my_team)
    ), '[]'::jsonb),
    'myFleet', coalesce((
      select jsonb_agg(to_jsonb(ss)) from ship_status ss
      where ss.game_id = p_game_id
        and (v_my_team is null or ss.team_id = v_my_team)
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(
               to_jsonb(e) || jsonb_build_object(
                 'team_private', is_team_private_event(e.type))
               order by e.created_at desc)
      from (
        select * from game_events
        where game_id = p_game_id
        order by created_at desc
        limit 50
      ) e
    ), '[]'::jsonb),
    'scores', coalesce((
      select jsonb_agg(to_jsonb(s)) from team_scores(p_game_id) s
    ), '[]'::jsonb),
    'standings', case
      when v_mode = 'bingo' then coalesce((
        select jsonb_agg(to_jsonb(s) order by s.place) from bingo_standings(p_game_id) s
      ), '[]'::jsonb)
      when v_mode = 'snakes' then coalesce((
        select jsonb_agg(to_jsonb(s) order by s.place) from snakes_standings(p_game_id) s
      ), '[]'::jsonb)
      when v_mode = 'territory' then coalesce((
        select jsonb_agg(to_jsonb(s) order by s.place) from territory_standings(p_game_id) s
      ), '[]'::jsonb)
      else '[]'::jsonb end,
    'territory', case when v_mode = 'territory' then territory_state(p_game_id) end,
    'jumps', coalesce((
      select jsonb_agg(jsonb_build_object('from', j.from_tile, 'to', j.to_tile)
                       order by j.from_tile)
        from board_jumps j where j.game_id = p_game_id
    ), '[]'::jsonb),
    'evidence', coalesce((
      select jsonb_agg(to_jsonb(ev)) from my_evidence(p_game_id) ev
    ), '[]'::jsonb),
    'enemyShots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tile_id', tc.tile_id, 'result', tc.result, 'status', tc.status))
      from tile_claims tc
      where v_mode = 'battleships'
        and v_enemy_team is not null
        and tc.team_id = v_enemy_team
        and tc.status = 'fired'
    ), '[]'::jsonb)
  );
end;
$$;

-- admin_board_for_team: body from 20261003140000_admin_view_as_team.sql, plus the same two territory keys as
-- board_for_me.
create or replace function admin_board_for_team(
  p_game_id uuid, p_team_id uuid, p_role team_role default 'member')
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_enemy_team uuid;
  v_mode       game_mode;
begin
  if not is_admin() then
    raise exception 'Only an organiser can view a team''s board';
  end if;

  select g.mode into v_mode from games g where g.id = p_game_id;
  if v_mode is null then
    raise exception 'Game not found';
  end if;
  if not exists (select 1 from teams t where t.id = p_team_id and t.game_id = p_game_id) then
    raise exception 'That team is not in this game';
  end if;

  select t.id into v_enemy_team
  from teams t
  where t.game_id = p_game_id and t.id <> p_team_id
  order by t.name
  limit 1;

  -- Key for key what board_for_me answers a member of p_team_id. Where that
  -- one relies on RLS (ship_cells, ship_status, game_events), the policy's
  -- filter for a member of this team is written out here.
  return jsonb_build_object(
    'game', (select to_jsonb(g) from games g where g.id = p_game_id),
    'teams', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.name)
      from teams t where t.game_id = p_game_id
    ), '[]'::jsonb),
    -- One membership, the team being viewed, so the site picks it as "mine".
    'memberships', jsonb_build_array(
      jsonb_build_object('team_id', p_team_id, 'role', p_role)),
    'tiles', coalesce((
      select jsonb_agg(to_jsonb(x)) from tiles_for_team(p_game_id, p_team_id) x
    ), '[]'::jsonb),
    'myShipCells', coalesce((
      select jsonb_agg(to_jsonb(sc)) from ship_cells sc
      where sc.team_id = p_team_id
    ), '[]'::jsonb),
    -- As a player gets it. ship_status counts hits through `tiles`, which RLS
    -- hides from every player, so on their side hits is always 0 and sunk
    -- always false (MyFleet.jsx and lib/board.js work sinkings out for
    -- themselves). Read here with an owner's rights, the view would answer
    -- truthfully -- and differently. Same rows, same columns, same zeros.
    'myFleet', coalesce((
      select jsonb_agg(to_jsonb(f)) from (
        select s.id as ship_id, s.team_id, t.game_id,
               count(distinct (sc.row, sc.col))::smallint as size,
               0::bigint as hits,
               false as sunk
          from ships s
          join teams t on t.id = s.team_id
          join ship_cells sc on sc.ship_id = s.id
         where t.game_id = p_game_id and s.team_id = p_team_id
         group by s.id, s.team_id, t.game_id
      ) f
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(
               to_jsonb(e) || jsonb_build_object(
                 'team_private', is_team_private_event(e.type))
               order by e.created_at desc)
      from (
        select * from game_events ge
        where ge.game_id = p_game_id
          and (not is_team_private_event(ge.type) or ge.team_id = p_team_id)
        order by ge.created_at desc
        limit 50
      ) e
    ), '[]'::jsonb),
    'scores', coalesce((
      select jsonb_agg(to_jsonb(s)) from team_scores(p_game_id) s
    ), '[]'::jsonb),
    'standings', case
      when v_mode = 'bingo' then coalesce((
        select jsonb_agg(to_jsonb(s) order by s.place) from bingo_standings(p_game_id) s
      ), '[]'::jsonb)
      when v_mode = 'snakes' then coalesce((
        select jsonb_agg(to_jsonb(s) order by s.place) from snakes_standings(p_game_id) s
      ), '[]'::jsonb)
      when v_mode = 'territory' then coalesce((
        select jsonb_agg(to_jsonb(s) order by s.place) from territory_standings(p_game_id) s
      ), '[]'::jsonb)
      else '[]'::jsonb end,
    'territory', case when v_mode = 'territory' then territory_state(p_game_id) end,
    'jumps', coalesce((
      select jsonb_agg(jsonb_build_object('from', j.from_tile, 'to', j.to_tile)
                       order by j.from_tile)
        from board_jumps j where j.game_id = p_game_id
    ), '[]'::jsonb),
    'evidence', coalesce((
      select jsonb_agg(to_jsonb(ev)) from evidence_for_team(p_game_id, p_team_id) ev
    ), '[]'::jsonb),
    'enemyShots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tile_id', tc.tile_id, 'result', tc.result, 'status', tc.status))
      from tile_claims tc
      where v_mode = 'battleships'
        and v_enemy_team is not null
        and tc.team_id = v_enemy_team
        and tc.status = 'fired'
    ), '[]'::jsonb)
  );
end;
$function$;

-- admin_game_readiness: body from 20260907182504_admin_game_readiness.sql, plus territory: a home needs no task, so it
-- counts neither as a tile nor as one needed. Other modes have no homes.
create or replace function admin_game_readiness()
returns table (
  game_id               uuid,
  tile_count            integer,
  tiles_needed          integer,
  teams_with_full_fleet integer,
  webhook_count         integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;

  return query
    select
      g.id,
      (select count(*)::int from tiles t
        where t.game_id = g.id
          and not exists (select 1 from teams te join territory_places p on p.key = te.home
                           where te.game_id = g.id and p.position = t.position)),
      (g.grid_size * g.grid_size
         - (select count(*) from teams te where te.game_id = g.id and te.home is not null))::int,
      -- A team's fleet is complete when it has as many distinct hulls placed
      -- as the game's fleet has entries. Counting distinct ship_id rather than
      -- cells, because a five-hull fleet is seventeen cells and the checklist
      -- asks about hulls.
      (select count(*)::int
         from teams te
        where te.game_id = g.id
          and (select count(distinct sc.ship_id)
                 from ship_cells sc where sc.team_id = te.id)
              = coalesce(array_length(g.fleet, 1), 0)),
      (select count(*)::int from discord_webhooks w where w.game_id = g.id)
    from games g;
end;
$$;

-- admin_autofill_board: body from 20261003120100_snakes_autofill.sql, plus territory: no task is dealt onto a
-- team's home.
create or replace function admin_autofill_board(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_game   games%rowtype;
  v_result jsonb;
begin
  if not is_admin() then raise exception 'Admins only'; end if;

  select * into v_game from games where id = p_game_id;
  if not found then raise exception 'No such game'; end if;
  if v_game.status not in ('setup', 'placement') then
    raise exception 'Tiles are locked once the game is %', v_game.status;
  end if;

  with empty as materialized (
    select r.n::smallint as "row", c.n::smallint as col,
           row_number() over (order by random()) as slot
      from generate_series(1, v_game.grid_size) as r(n)
      cross join generate_series(1, v_game.grid_size) as c(n)
     where not exists (
             select 1 from tiles t
              where t.game_id = p_game_id and t.row = r.n and t.col = c.n)
       -- Snakes and Ladders: nobody stands on a snake head or a ladder's
       -- foot, so a task dealt there would be a catalogue entry spent on
       -- nothing. Other modes have no board_jumps rows.
       and not exists (
             select 1 from board_jumps j
              where j.game_id = p_game_id and j.from_tile = (r.n - 1) * 10 + c.n)
       -- Territory: a home needs no task. Other modes have no homes.
       and not exists (
             select 1 from teams te join territory_places tp on tp.key = te.home
              where te.game_id = p_game_id and tp.position = (r.n - 1) * 10 + c.n)
  ),
  taken as materialized (
    select tile_name_key(t.name) as name_key,
           tile_task_key(t.name) as task_key
      from tiles t where t.game_id = p_game_id
  ),
  pool as materialized (
    select l.id, tile_task_key(l.name) as task_key
      from tile_library l
     where tile_name_key(l.name) not in (select name_key from taken)
       and not (l.completion in ('one_set', 'each_set')
                and not exists (select 1 from tile_library_options o
                                 where o.library_id = l.id))
       and not (l.completion = 'value'
                and exists (select 1 from tile_library_options o
                             where o.library_id = l.id))
  ),
  first_choice as materialized (
    select distinct on (p.task_key) p.id
      from pool p
     where p.task_key not in (select task_key from taken)
     order by p.task_key, random()
  ),
  ranked as materialized (
    select f.id, 0 as tier, row_number() over (order by random()) as ord
      from first_choice f
    union all
    select p.id, 1 as tier, row_number() over (order by random()) as ord
      from pool p
     where p.id not in (select id from first_choice)
  ),
  chosen as materialized (
    select r.id, r.tier, row_number() over (order by r.tier, r.ord) as slot
      from ranked r
  ),
  plan as materialized (
    select e."row", e.col, c.id as library_id, c.tier
      from empty e join chosen c on c.slot = e.slot
  ),
  ins as (
    insert into tiles (game_id, "row", col, name, icon, required_evidence,
                       description, completion, per_set, library_id)
    select p_game_id, pl."row", pl.col, l.name, l.icon, l.required_evidence,
           l.description, l.completion, l.per_set, l.id
      from plan pl join tile_library l on l.id = pl.library_id
    returning id, library_id
  ),
  opts as (
    insert into tile_options (tile_id, label, points, sort, grp, max_times)
    select i.id, o.label, o.points, o.sort, o.grp, o.max_times
      from ins i join tile_library_options o on o.library_id = i.library_id
    returning 1
  ),
  bumped as (
    update tile_library l
       set times_used = l.times_used + 1, last_used_at = now()
      from ins i where l.id = i.library_id
    returning 1
  )
  select jsonb_build_object(
           'filled',  (select count(*) from plan),
           'similar', (select count(*) from plan where tier = 1),
           'empty',   (select count(*) from empty),
           'pool',    (select count(*) from pool)
         )
    into v_result;

  return v_result;
end;
$$;

-- admin_apply_board_preset: body from 20260913000000_board_presets.sql, plus territory: a saved board's task on a
-- square that is now a team's home is left out.
create or replace function admin_apply_board_preset(p_game_id uuid, p_preset_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_game   games%rowtype;
  v_preset board_presets%rowtype;
  v_placed int;
begin
  if not is_admin() then raise exception 'Admins only'; end if;

  select * into v_game from games where id = p_game_id;
  if not found then raise exception 'No such game'; end if;
  if v_game.status not in ('setup', 'placement') then
    raise exception 'Tiles are locked once the game is %', v_game.status;
  end if;

  select * into v_preset from board_presets where id = p_preset_id;
  if not found then raise exception 'No such saved board'; end if;

  if v_preset.grid_size <> v_game.grid_size then
    raise exception 'That board is %x% and this game is %x%',
      v_preset.grid_size, v_preset.grid_size, v_game.grid_size, v_game.grid_size;
  end if;

  -- Belt beside the braces of the status check: a claim on a tile about to be
  -- deleted is a team's work, and losing it silently is not a thing to risk on
  -- one enum comparison.
  if exists (
       select 1 from tile_claims c join tiles t on t.id = c.tile_id
        where t.game_id = p_game_id
     ) then
    raise exception 'This board already has claimed tiles — release them first';
  end if;

  delete from tiles where game_id = p_game_id;

  insert into tiles (game_id, "row", col, name, icon, required_evidence,
                     description, completion, per_set, library_id)
  select p_game_id,
         (s.val ->> 'row')::smallint,
         (s.val ->> 'col')::smallint,
         coalesce(nullif(btrim(s.val -> 'tile' ->> 'name'), ''), 'Tile'),
         nullif(regexp_replace(btrim(coalesce(s.val -> 'tile' ->> 'icon', '')),
                               '[^A-Za-z0-9_-]', '', 'g'), ''),
         least(greatest(coalesce((nullif(btrim(s.val -> 'tile' ->> 'amount'), ''))::int, 1), 1), 1000),
         nullif(left(btrim(coalesce(s.val -> 'tile' ->> 'description', '')), 500), ''),
         coalesce(nullif(btrim(coalesce(s.val -> 'tile' ->> 'rule', '')), ''),
                  'points')::tile_completion,
         least(greatest(coalesce((nullif(btrim(s.val -> 'tile' ->> 'perSet'), ''))::smallint, 1), 1), 30),
         nullif(btrim(coalesce(s.val -> 'tile' ->> 'libraryId', '')), '')::uuid
    from jsonb_array_elements(v_preset.squares) as s(val)
   where not exists (
             select 1 from teams te join territory_places tp on tp.key = te.home
              where te.game_id = p_game_id and tp.position = ((s.val ->> 'row')::int - 1) * 10 + (s.val ->> 'col')::int);

  get diagnostics v_placed = row_count;

  insert into tile_options (tile_id, label, points, sort, grp, max_times)
  select t.id,
         left(btrim(o.val ->> 'label'), 80),
         least(greatest(coalesce((o.val ->> 'points')::smallint, 1), 1), 30),
         (o.ord - 1)::smallint,
         nullif(left(btrim(coalesce(o.val ->> 'grp', '')), 40), ''),
         case when nullif(btrim(coalesce(o.val ->> 'maxTimes', '')), '') is null then null
              else least(greatest((o.val ->> 'maxTimes')::smallint, 1), 30)::smallint end
    from jsonb_array_elements(v_preset.squares) as s(val)
    join tiles t on t.game_id = p_game_id
                and t."row" = (s.val ->> 'row')::smallint
                and t.col   = (s.val ->> 'col')::smallint
   cross join lateral jsonb_array_elements(
                case when jsonb_typeof(s.val -> 'tile' -> 'options') = 'array'
                     then s.val -> 'tile' -> 'options' else '[]'::jsonb end
              ) with ordinality as o(val, ord)
   where btrim(coalesce(o.val ->> 'label', '')) <> '';

  return jsonb_build_object('placed', v_placed, 'name', v_preset.name);
end;
$$;

-- admin_swap_tiles: body from 20261004140000_admin_swap_tiles.sql, plus territory: a task cannot be moved onto a
-- team's home.
create or replace function admin_swap_tiles(
  p_game_id  uuid,
  p_from_row int, p_from_col int,
  p_to_row   int, p_to_col   int
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_game games%rowtype;
  v_from tiles%rowtype;
  v_to   tiles%rowtype;
begin
  if not is_admin() then raise exception 'Admins only'; end if;

  select * into v_game from games where id = p_game_id for update;
  if not found then raise exception 'No such game'; end if;

  if v_game.status not in ('setup', 'placement') then
    raise exception 'Tiles can only be moved before the game starts — it is %', v_game.status;
  end if;

  if least(p_from_row, p_from_col, p_to_row, p_to_col) < 1
     or greatest(p_from_row, p_from_col, p_to_row, p_to_col) > v_game.grid_size then
    raise exception 'Both squares must be on the %x% board', v_game.grid_size, v_game.grid_size;
  end if;

  if exists (select 1 from teams te join territory_places tp on tp.key = te.home
              where te.game_id = p_game_id
                and tp.position = (p_to_row - 1) * 10 + p_to_col) then
    raise exception 'That square is a team''s home — a home needs no task';
  end if;

  select * into v_from from tiles
   where game_id = p_game_id and "row" = p_from_row and col = p_from_col
   for update;
  if not found then raise exception 'There is no tile on that square to move'; end if;

  if p_from_row = p_to_row and p_from_col = p_to_col then
    return jsonb_build_object('moved', v_from.name, 'swapped', null, 'changed', false);
  end if;

  select * into v_to from tiles
   where game_id = p_game_id and "row" = p_to_row and col = p_to_col
   for update;

  -- Cannot exist before the start, but a claim is what makes a square's place
  -- matter, so it is checked rather than assumed.
  if exists (select 1 from tile_claims where tile_id in (v_from.id, v_to.id)) then
    raise exception 'A team has already locked one of these squares in';
  end if;

  -- Park the moving tile off the board, put the other one in its place, then
  -- land the moving tile.
  update tiles set "row" = ("row" + 100)::smallint where id = v_from.id;
  if v_to.id is not null then
    update tiles set "row" = p_from_row::smallint, col = p_from_col::smallint where id = v_to.id;
  end if;
  update tiles set "row" = p_to_row::smallint, col = p_to_col::smallint where id = v_from.id;

  return jsonb_build_object('moved', v_from.name, 'swapped', v_to.name, 'changed', true);
end;
$function$;

-- discord_line: body from 20261002120100_snakes_mode.sql, plus territory: its own lines
-- (territory_discord_line), and no "at C3" -- a place is named, not lettered.
create or replace function discord_line(p_event game_events)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_team text;
  v_pos  int := (p_event.payload ->> 'position')::int;
  v_at   text;
  v_img  text := nullif(btrim(coalesce(p_event.payload ->> 'image_url', '')), '');
  v_opt  text := nullif(btrim(coalesce(p_event.payload ->> 'option_label', '')), '');
  v_rule text := coalesce(p_event.payload ->> 'completion', 'points');
  v_prog text := progress_text(p_event.payload -> 'progress');
  v_who  text;
  v_tile text := coalesce(p_event.payload ->> 'tile_name', 'a tile');
  v_bingo boolean := p_event.payload ->> 'mode' = 'bingo';
  v_snakes boolean := p_event.payload ->> 'mode' = 'snakes';
  v_territory boolean;
  v_line text;
begin
  select name into v_team from teams where id = p_event.team_id;
  v_team := coalesce(v_team, 'Someone');
  v_who  := coalesce(p_event.payload ->> 'uploaded_by_name', v_team);

  -- Snakes numbers its tiles 1-100 along the snake path and has events of its
  -- own, so it has its own lines (snakes_discord_line). Anything it does not
  -- word falls through to the shared lines below.
  if v_snakes then
    v_line := snakes_discord_line(p_event, v_team);
    if v_line is not null then return v_line; end if;
  end if;

  -- Territory: from the game, not the payload -- the shared events (evidence
  -- submitted, withdrawn) carry no mode.
  select g.mode = 'territory' into v_territory from games g where g.id = p_event.game_id;
  if v_territory then
    v_line := territory_discord_line(p_event, v_team);
    if v_line is not null then return v_line; end if;
  end if;

  if v_pos is not null and not coalesce(v_territory, false) then
    v_at := ' at ' || chr(65 + ((v_pos - 1) % 10)) || (((v_pos - 1) / 10) + 1);
  else
    v_at := '';
  end if;

  return case p_event.type
    when 'fleet_placed'  then format('**%s**''s fleet is set.', v_team)
    when 'game_started'  then case when v_bingo
                                   then '**The bingo has begun** — every tile is open.'
                                   else '**The game has begun** — fleets are locked.' end
    when 'team_renamed'  then format('%s is now **%s**.',
                                     coalesce(p_event.payload ->> 'old_name', 'A team'),
                                     coalesce(p_event.payload ->> 'new_name', v_team))
    when 'tile_claimed'  then format('**%s** locked in a tile%s.', v_team, v_at)
    when 'tile_relocked' then format('**%s** locked **%s**%s back in.',
                                     coalesce(p_event.payload ->> 'by_name', v_team),
                                     coalesce(p_event.payload ->> 'tile_name', 'a tile'), v_at)
    when 'claim_released' then format('An admin released **%s**''s tile%s.', v_team, v_at)
    when 'shot_fired'    then format('**%s** fired%s — %s', v_team, v_at,
                                     case when p_event.payload ->> 'result' = 'hit'
                                          then '**HIT**' else 'miss.' end)
    when 'ship_sunk'     then format(':boom: **%s** sank a %s-tile ship!',
                                     v_team, p_event.payload ->> 'size')
    when 'game_won'      then format(':trophy: **%s** wins — the enemy fleet is gone.', v_team)
    when 'tile_completed' then format(':white_check_mark: **%s** completed **%s**%s — %s/%s tiles.',
                                     v_team, v_tile, v_at,
                                     p_event.payload ->> 'tiles_completed',
                                     p_event.payload ->> 'tiles_total')
    when 'game_ended'    then case
        when p_event.team_id is null then
          case p_event.payload ->> 'reason'
            when 'time_up' then ':hourglass: **Time''s up!** No tiles were completed, so nobody wins.'
            else 'The organiser ended the game. No tiles were completed, so nobody wins.'
          end
        when p_event.payload ->> 'reason' = 'full_card' then
          format(':trophy: **%s** filled the whole card and wins the bingo!', v_team)
        when p_event.payload ->> 'reason' = 'time_up' then
          format(':hourglass: **Time''s up!** :trophy: **%s** wins with %s/%s tiles.', v_team,
                 p_event.payload ->> 'tiles_completed', p_event.payload ->> 'tiles_total')
        else
          format('The organiser ended the game. :trophy: **%s** wins with %s/%s tiles.', v_team,
                 p_event.payload ->> 'tiles_completed', p_event.payload ->> 'tiles_total')
      end
    when 'game_reset'    then case
                                   when v_bingo then 'The bingo has been reset — every tile is open again.'
                                   when (p_event.payload ->> 'fleets_cleared')::boolean
                                   then 'The game has been reset — fleets need placing again.'
                                   else 'The game has been reset. Fleets are unchanged.' end
    when 'evidence_submitted' then
      case
        -- Set rules: name the drop, then the counter the card shows.
        when v_rule in ('one_set', 'each_set', 'points_per_set') and v_opt is not null then
          format('**%s** submitted **%s** for **%s**%s.', v_who, v_opt, v_tile,
                 coalesce(' (' || v_prog || ')', ''))
        -- Every number on a value tile is stored in tenths of a million.
        when v_rule = 'value' then
          format('**%s** submitted a drop worth **%sm** for **%s** (%s).',
                 v_who, value_m((p_event.payload ->> 'points_awarded')::int), v_tile,
                 coalesce(v_prog,
                          value_m((p_event.payload ->> 'points_total')::int) || '/'
                          || value_m((p_event.payload ->> 'required_evidence')::int) || 'm'))
        when v_opt is not null then
          format('**%s** submitted **%s** for **%s** — %s points (%s).',
                 v_who, v_opt, v_tile, p_event.payload ->> 'points_awarded',
                 coalesce(v_prog,
                          (p_event.payload ->> 'points_total') || '/'
                          || (p_event.payload ->> 'required_evidence')))
        else
          format('**%s** submitted proof for **%s** (%s).', v_who, v_tile,
                 coalesce(v_prog,
                          (p_event.payload ->> 'evidence_count') || '/'
                          || (p_event.payload ->> 'required_evidence')))
      end
      || case when v_img is not null then E'\n' || v_img else '' end
    when 'evidence_revoked' then format(
        ':leftwards_arrow_with_hook: An admin withdrew %s''s submission for **%s**%s — now %s.%s',
        coalesce(p_event.payload ->> 'submitted_by_name', v_team),
        v_tile,
        coalesce(' (' || (p_event.payload ->> 'option_label') || ')', ''),
        -- An unstamped withdrawal only knows screenshots left, which is the
        -- right counter only on a plain tile; elsewhere say nothing numeric.
        coalesce(v_prog,
                 case when v_rule = 'points' and v_opt is null
                      then (p_event.payload ->> 'evidence_count') || '/'
                           || (p_event.payload ->> 'required_evidence')
                      else 'updated' end),
        case when (p_event.payload ->> 'parked')::boolean
             then ' The shot is taken back and the tile is unlocked — **lock it in again** to finish it.'
             else '' end
        || case when (p_event.payload ->> 'uncompleted')::boolean
                then ' The tile is no longer complete.' else '' end
        || case when (p_event.payload ->> 'ship_refloated')::boolean
                then ' A ship is no longer sunk.' else '' end
        || case when (p_event.payload ->> 'game_reopened')::boolean
                then ' **The game has been reopened.**' else '' end
        || case when (p_event.payload ->> 'winner_changed')::boolean
                then ' **The winner has changed.**' else '' end)
    when 'shot_withdrawn' then format(
        ':leftwards_arrow_with_hook: One of **%s**''s shots has been withdrawn by an organiser.', v_team)
    when 'slot_freed'    then 'An active tile is available now. Lock in another target.'
    when 'pet_jar_submitted' then format(':jar: **%s** submitted a pet/jar — %s pet jar preview(s) now.',
                                     coalesce(p_event.payload ->> 'submitted_by_name', v_team),
                                     p_event.payload ->> 'pet_jar_count')
                                   || case when v_img is not null then E'\n' || v_img else '' end
    when 'pet_jar_spent' then format(':mag: A pet jar preview was spent on **%s** — %s left.',
                                     coalesce(p_event.payload ->> 'tile_name', 'a tile'),
                                     p_event.payload ->> 'pet_jar_count')
    when 'pet_jar_revoked' then format(
        ':leftwards_arrow_with_hook: An admin withdrew %s''s pet/jar submission%s — %s pet jar preview(s) now.',
        coalesce(p_event.payload ->> 'submitted_by_name', v_team),
        case when (p_event.payload ->> 'preview_withdrawn')::boolean
             then format(' and the preview of **%s**%s',
                         coalesce(p_event.payload ->> 'tile_name', 'a tile'), v_at)
             else '' end,
        p_event.payload ->> 'pet_jar_count')
    else p_event.type::text
  end;
end;
$$;

-- ============================================================
-- 9. Who may call what
-- ============================================================

revoke execute on function territory_default_homes()                    from public, anon, authenticated;
revoke execute on function territory_neighbours(text)                   from public, anon, authenticated;
revoke execute on function territory_owners(uuid)                       from public, anon, authenticated;
revoke execute on function territory_owner(uuid, text)                  from public, anon, authenticated;
revoke execute on function territory_name_list(text[])                  from public, anon, authenticated;
revoke execute on function territory_homes_problem(uuid)                from public, anon, authenticated;
revoke execute on function territory_lose_place(uuid, uuid, uuid)       from public, anon, authenticated;
revoke execute on function complete_territory_tile(uuid)                from public, anon, authenticated;
revoke execute on function territory_after_uncomplete(uuid)             from public, anon, authenticated;
revoke execute on function finish_territory(uuid, text)                 from public, anon, authenticated;
revoke execute on function territory_discord_line(game_events, text)    from public, anon, authenticated;

-- board_for_me is security invoker, so the player calls territory_state
-- through it and needs it.
revoke execute on function territory_state(uuid)                        from public, anon;
grant  execute on function territory_state(uuid)                        to authenticated;
revoke execute on function territory_standings(uuid)                    from public, anon;
grant  execute on function territory_standings(uuid)                    to authenticated;
revoke execute on function territory_open_tile(uuid, text)              from public, anon;
grant  execute on function territory_open_tile(uuid, text)              to authenticated;
revoke execute on function territory_drop_tile(uuid, text)              from public, anon;
grant  execute on function territory_drop_tile(uuid, text)              to authenticated;
revoke execute on function territory_settle(uuid)                       from public, anon;
grant  execute on function territory_settle(uuid)                       to authenticated;
revoke execute on function admin_set_territory_homes(uuid, jsonb)       from public, anon;
grant  execute on function admin_set_territory_homes(uuid, jsonb)       to authenticated;
