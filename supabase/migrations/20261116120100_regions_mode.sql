-- Region Bingo, part 2: everything but the enum values.
-- The rules are docs/region-bingo-rules.md; this is how they are kept.
--
-- THE BOARD
--   The usual 10x10 card, cut into the 11 Leagues regions of territory_regions,
--   nine squares each, in that table's `sort` order: Misthalin owns squares
--   1-9, Asgarnia 10-18, ... Varlamore 91-99. Square 100 belongs to no region
--   and must stay empty. A region's pool is the tiles on its nine squares, so a
--   region may hold anything from 1 to 9 tiles.
--
--   Keying the region on the square, as territory keys its places, means every
--   board tool (the builder, random deal, saved boards, swap) works unchanged:
--   none of them has to learn that a tile has a region.
--
-- POINTS
--   tiles.worth: what a completed tile scores, set by the organiser per tile.
--   games.region_threshold: the x% of a region's total worth a team needs for
--   the region to count as complete. Rounded up: 50% of 15 is 8.
--
-- OPENING REGIONS
--   region_unlocks is the log of which team opened which region. A team's
--   first region is picked by its captain once the game has started, and pays
--   for nothing (funded_by null). Every later pick is paid for by one complete
--   region of the team's that has not paid for a pick before (funded_by), and
--   any player may make it. So:
--
--     picks available = complete regions that have not funded a pick
--
--   which is worked out, never stored. It gives the agreed rules for free: a
--   revoke that drops a region below x% before its pick is spent takes the pick
--   back, and one after the pick is spent changes nothing -- the region it
--   paid for stays open, and getting back over x% does not pay twice.
--
-- SECRECY
--   A team sees the tiles of the regions it has opened and nothing of the rest
--   -- no names, no count, no points -- until the game is over. tiles_for_team
--   drops the rows; regions_state answers totals only for opened regions; the
--   public tile_completed event carries the region and the points but never
--   the tile's name. Everything else (standings, which regions each team holds)
--   is public, as the feed announces it anyway.
--
-- THE SHARED FUNCTIONS
--   Each one changed here is patched in place: its LIVE definition is read,
--   one exact piece of text is replaced, and the result is re-created. The
--   same technique as 20261004130000 and 20261025130000, for their reason:
--   nothing else in those functions can drift. Every patch asserts that its
--   text occurs exactly once and aborts the whole migration otherwise, so none
--   of this applies by halves.

-- ============================================================
-- 1. Columns
-- ============================================================

alter table games add column region_threshold smallint not null default 50;
alter table games add constraint games_region_threshold_check
  check (region_threshold between 1 and 100);
comment on column games.region_threshold is
  'Region Bingo: the % of a region''s points a team needs before the region counts as complete and earns a pick. Rounded up. Unused by every other mode.';

alter table tiles add column worth smallint not null default 1;
alter table tiles add constraint tiles_worth_check check (worth between 1 and 100);
comment on column tiles.worth is
  'Region Bingo: the points a completed tile scores. Unused by every other mode.';

-- A region board is always the 10x10 card the regions are cut from.
alter table games drop constraint games_grid_size_check;
alter table games add constraint games_grid_size_check check (
  grid_size >= 3 and grid_size <= 26
  and (mode <> 'bingo'     or grid_size <= 10)
  and (mode <> 'snakes'    or grid_size = 10)
  and (mode <> 'territory' or grid_size = 8)
  and (mode <> 'regions'   or grid_size = 10));

-- ============================================================
-- 2. Opened regions
-- ============================================================

create table region_unlocks (
  game_id        uuid not null references games(id) on delete cascade,
  team_id        uuid not null references teams(id) on delete cascade,
  region         text not null references territory_regions(key),
  -- The complete region that paid for this pick. Null for the first region.
  funded_by      text references territory_regions(key),
  opened_by      uuid references profiles(id) on delete set null,
  opened_by_name text not null,
  opened_at      timestamptz not null default clock_timestamp(),
  primary key (team_id, region),
  -- A complete region pays for one pick in a game, once.
  unique (team_id, funded_by),
  check (funded_by is null or funded_by <> region)
);
-- One first region per team.
create unique index region_unlocks_one_first on region_unlocks (team_id) where funded_by is null;
create index region_unlocks_game on region_unlocks (game_id);

comment on table region_unlocks is
  'Region Bingo: the regions each team has opened, and which complete region paid for each one. Read through regions_state and regions_standings only.';

-- No policies: nobody reads this table directly.
alter table region_unlocks enable row level security;

-- ============================================================
-- 3. The board, the totals, the standings
-- ============================================================

-- The region a square belongs to: nine squares each, in territory_regions.sort
-- order. Null for square 100 and anything off the card.
create function regions_region_at(p_position int)
returns text
language sql stable security definer set search_path = public
as $$
  select r.key from territory_regions r
   where p_position between 1 and 99 and r.sort = (p_position - 1) / 9 + 1;
$$;

-- Every region with its tile count, total worth and what a team needs there.
-- Secret for regions a team has not opened, so callers filter.
create function regions_totals(p_game_id uuid)
returns table(region text, name text, sort smallint, tiles int, total int, need int)
language sql stable security definer set search_path = public
as $$
  select r.key, r.name, r.sort,
         count(t.id)::int,
         coalesce(sum(t.worth), 0)::int,
         -- x% rounded up, in whole numbers: 50% of 15 is 8.
         ((coalesce(sum(t.worth), 0) * g.region_threshold + 99) / 100)::int
    from games g
    cross join territory_regions r
    left join tiles t on t.game_id = g.id
                     and t.position between (r.sort - 1) * 9 + 1 and r.sort * 9
   where g.id = p_game_id
   group by r.key, r.name, r.sort, g.region_threshold
   order by r.sort;
$$;

-- Every team x every region: opened, points, complete, and whether the region
-- has already paid for a pick.
create function regions_team_regions(p_game_id uuid)
returns table(team_id uuid, region text, sort smallint, opened boolean,
              opened_at timestamptz, funded_by text, points int,
              complete boolean, funds boolean)
language sql stable security definer set search_path = public
as $$
  select te.id, tt.region, tt.sort,
         u.region is not null,
         u.opened_at, u.funded_by,
         coalesce(p.points, 0),
         tt.total > 0 and coalesce(p.points, 0) >= tt.need,
         exists (select 1 from region_unlocks f
                  where f.team_id = te.id and f.funded_by = tt.region)
    from teams te
    cross join regions_totals(p_game_id) tt
    left join region_unlocks u on u.team_id = te.id and u.region = tt.region
    left join lateral (
      select sum(t.worth)::int as points
        from tile_claims c join tiles t on t.id = c.tile_id
       where c.team_id = te.id and c.status = 'completed'
         and t.game_id = p_game_id
         and t.position between (tt.sort - 1) * 9 + 1 and tt.sort * 9
    ) p on true
   where te.game_id = p_game_id;
$$;

-- Public. The most points wins; a tie goes to whoever got there first.
create function regions_standings(p_game_id uuid)
returns table(team_id uuid, team_name text, slot smallint, points int,
              tiles_completed int, last_completed_at timestamptz,
              regions_open text[], regions_complete text[], picks int,
              needs_start boolean, place int)
language sql stable security definer set search_path = public
as $$
  with tr as materialized (
    select * from regions_team_regions(p_game_id)
  ),
  sc as (
    select te.id, te.name, te.slot,
           coalesce(sum(t.worth), 0)::int as pts,
           count(c.id)::int               as n,
           max(c.fired_at)                as last_at
      from teams te
      left join tile_claims c on c.team_id = te.id and c.status = 'completed'
      left join tiles t on t.id = c.tile_id
     where te.game_id = p_game_id
     group by te.id, te.name, te.slot
  )
  select sc.id, sc.name, sc.slot, sc.pts, sc.n, sc.last_at,
         coalesce((select array_agg(tr.region order by tr.opened_at)
                     from tr where tr.team_id = sc.id and tr.opened), '{}'),
         coalesce((select array_agg(tr.region order by tr.sort)
                     from tr where tr.team_id = sc.id and tr.complete), '{}'),
         (select count(*)::int from tr
           where tr.team_id = sc.id and tr.complete and not tr.funds),
         not exists (select 1 from tr where tr.team_id = sc.id and tr.opened),
         (row_number() over (order by sc.pts desc, sc.last_at asc nulls last, sc.slot))::int
    from sc
   order by 11;
$$;

-- What one team's screen needs. Totals and tile points only for the regions
-- that team has opened, or for every region once the game is over.
-- board_for_me runs with the player's own rights, so players may call this,
-- but only for their own team (or none, as a visitor); organisers for any.
create function regions_state(p_game_id uuid, p_team_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_game games%rowtype;
  v_all  boolean;
begin
  if p_team_id is not null
     and p_team_id is distinct from my_team_in_game(p_game_id)
     and p_team_id is distinct from acting_as_team()
     and not may_manage_game(p_game_id) then
    raise exception 'Not your team';
  end if;

  select * into v_game from games where id = p_game_id;
  if not found or v_game.mode <> 'regions' then return null; end if;
  v_all := v_game.status = 'finished';

  return jsonb_build_object(
    'threshold',   v_game.region_threshold,
    'team_id',     p_team_id,
    'is_captain',  p_team_id is not null and (
                     coalesce(acting_as_team() = p_team_id, false)
                     or exists (select 1 from team_members m
                                 where m.team_id = p_team_id
                                   and m.profile_id = auth.uid()
                                   and m.role = 'captain')),
    'needs_start', p_team_id is not null
                   and not exists (select 1 from region_unlocks u where u.team_id = p_team_id),
    'picks',       (select count(*)::int from regions_team_regions(p_game_id) tr
                     where tr.team_id = p_team_id and tr.complete and not tr.funds),
    'regions', (
      select jsonb_agg(
               case when coalesce(tr.opened, false) or v_all then
                 jsonb_build_object(
                   'key',       tt.region,
                   'opened',    coalesce(tr.opened, false),
                   'opened_at', tr.opened_at,
                   'funded_by', tr.funded_by,
                   'complete',  coalesce(tr.complete, false),
                   'funds',     coalesce(tr.funds, false),
                   'points',    coalesce(tr.points, 0),
                   'need',      tt.need,
                   'total',     tt.total,
                   'tiles',     tt.tiles)
               else jsonb_build_object('key', tt.region, 'opened', false) end
               order by tt.sort)
        from regions_totals(p_game_id) tt
        left join regions_team_regions(p_game_id) tr
               on tr.region = tt.region and tr.team_id = p_team_id),
    'worth', (
      select coalesce(jsonb_object_agg(t.position::text, t.worth), '{}'::jsonb)
        from tiles t
       where t.game_id = p_game_id
         and (v_all or exists (select 1 from region_unlocks u
                                where u.team_id = p_team_id
                                  and u.region = regions_region_at(t.position))))
  );
end;
$$;

-- tiles_for_team's filter: true for every other mode; in a region game, only
-- the squares of regions this team has opened, until the game is over.
create function regions_tile_visible(p_game_id uuid, p_team_id uuid, p_position int)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
           when g.mode <> 'regions' or g.status = 'finished' then true
           else exists (select 1 from region_unlocks u
                         where u.team_id = p_team_id
                           and u.region = regions_region_at(p_position))
         end
    from games g where g.id = p_game_id;
$$;

-- What stops a region game starting, in the words the organiser needs. Null
-- when nothing does.
create function regions_start_problem(p_game_id uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_list text;
  v_n    int;
begin
  if exists (select 1 from tiles where game_id = p_game_id and position > 99) then
    return 'Square 100 belongs to no region — clear it first';
  end if;

  select string_agg(tt.name, ', ' order by tt.sort) into v_list
    from regions_totals(p_game_id) tt where tt.tiles = 0;
  if v_list is not null then
    return 'Every region needs at least one tile. Still empty: ' || v_list;
  end if;

  -- The captain picks the first region, so a team without one could never start.
  select string_agg(t.name, ' and ' order by t.slot), count(*) into v_list, v_n
    from teams t
   where t.game_id = p_game_id
     and not exists (select 1 from team_members m
                      where m.team_id = t.id and m.role = 'captain');
  if v_list is not null then
    return v_list || case when v_n = 1 then ' needs a captain' else ' each need a captain' end
           || ' — the captain picks the first region. Set one in the roster';
  end if;

  return null;
end;
$$;

-- ============================================================
-- 4. Playing
-- ============================================================

-- A player's first screenshot on a tile. Like bingo's, plus: only in a region
-- the team has opened.
create function regions_open_tile(p_tile_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_tile   tiles%rowtype;
  v_game   games%rowtype;
  v_team   uuid;
  v_region text;
  v_id     uuid;
begin
  select * into v_tile from tiles where id = p_tile_id;
  if not found then raise exception 'No such tile'; end if;

  select * into v_game from games where id = v_tile.game_id;
  if v_game.mode <> 'regions' then
    raise exception 'That tile is not on a Region Bingo board';
  end if;

  v_team := my_team_in_game(v_game.id);
  if v_team is null then
    raise exception 'You are not a member of a team in this game';
  end if;

  if v_game.status <> 'active' then
    raise exception 'The game is % — no submissions now', v_game.status;
  end if;
  if v_game.ends_at is not null and now() >= v_game.ends_at then
    raise exception 'Time is up — no more submissions';
  end if;

  v_region := regions_region_at(v_tile.position);
  if v_region is null or not exists (select 1 from region_unlocks u
                                      where u.team_id = v_team and u.region = v_region) then
    raise exception 'Your team has not opened that region yet';
  end if;

  insert into tile_claims (team_id, tile_id, claimed_by)
  values (v_team, p_tile_id, auth.uid())
  on conflict (team_id, tile_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from tile_claims where team_id = v_team and tile_id = p_tile_id;
  end if;
  return v_id;
end;
$$;

-- Open a region: the first one (captain only), or one paid for by a complete
-- region. Any region the team does not have yet; it need not be next door.
create function regions_pick(p_game_id uuid, p_region text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_game   games%rowtype;
  v_team   uuid;
  v_region territory_regions%rowtype;
  v_tiles  int;
  v_first  boolean;
  v_fund   text;
  v_name   text;
begin
  select * into v_game from games where id = p_game_id;
  if not found then raise exception 'No such game'; end if;
  if v_game.mode <> 'regions' then
    raise exception 'Only a Region Bingo has regions to pick';
  end if;

  v_team := my_team_in_game(p_game_id);
  if v_team is null then
    raise exception 'You are not a member of a team in this game';
  end if;

  if v_game.status <> 'active' then
    raise exception 'The game is % — regions are picked while it runs', v_game.status;
  end if;
  if v_game.ends_at is not null and now() >= v_game.ends_at then
    raise exception 'Time is up — no more picks';
  end if;

  -- One pick at a time per team: two players pressing together must not spend
  -- the same complete region twice.
  perform 1 from teams where id = v_team for update;

  select * into v_region from territory_regions where key = p_region;
  if not found then raise exception 'No such region'; end if;
  if exists (select 1 from region_unlocks where team_id = v_team and region = p_region) then
    raise exception 'Your team already has %', v_region.name;
  end if;

  select tt.tiles into v_tiles from regions_totals(p_game_id) tt where tt.region = p_region;
  if coalesce(v_tiles, 0) = 0 then
    raise exception '% has no tiles in this game', v_region.name;
  end if;

  v_first := not exists (select 1 from region_unlocks where team_id = v_team);

  if v_first then
    if not (coalesce(acting_as_team() = v_team, false)
            or exists (select 1 from team_members m
                        where m.team_id = v_team and m.profile_id = auth.uid()
                          and m.role = 'captain')) then
      raise exception 'Your captain picks your first region';
    end if;
  else
    select tr.region into v_fund
      from regions_team_regions(p_game_id) tr
     where tr.team_id = v_team and tr.complete and not tr.funds
     order by tr.sort
     limit 1;
    if v_fund is null then
      raise exception '%', format('No pick yet — reach %s%% of a region''s points first',
                                  v_game.region_threshold);
    end if;
  end if;

  select display_name into v_name from profiles where id = auth.uid();

  insert into region_unlocks (game_id, team_id, region, funded_by, opened_by, opened_by_name)
  values (p_game_id, v_team, p_region, v_fund, auth.uid(), coalesce(v_name, 'unknown'));

  insert into game_events (game_id, team_id, type, payload)
  values (p_game_id, v_team, 'region_opened',
          jsonb_build_object('mode',           'regions',
                             'region',         p_region,
                             'region_name',    v_region.name,
                             'first',          v_first,
                             'funded_by',      v_fund,
                             'funded_by_name', (select name from territory_regions where key = v_fund),
                             'by',             auth.uid(),
                             'by_name',        coalesce(v_name, 'unknown')));

  return jsonb_build_object('region', p_region, 'region_name', v_region.name,
                            'first', v_first, 'funded_by', v_fund);
end;
$$;

-- add_evidence's hand-off once a tile's evidence is enough.
create function complete_regions_tile(p_claim_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_claim   tile_claims%rowtype;
  v_tile    tiles%rowtype;
  v_game    games%rowtype;
  v_region  text;
  v_rname   text;
  v_total   int;
  v_need    int;
  v_pts     int;
  v_all_pts int;
  v_left    boolean;
begin
  -- The claims_need_evidence trigger re-checks claim_is_complete here.
  update tile_claims
     set status = 'completed', fired_by = auth.uid(), fired_at = now()
   where id = p_claim_id and status = 'active'
  returning * into v_claim;
  if not found then return; end if;

  select * into v_tile from tiles where id = v_claim.tile_id;
  select * into v_game from games where id = v_tile.game_id;
  v_region := regions_region_at(v_tile.position);
  select name into v_rname from territory_regions where key = v_region;

  select tt.total, tt.need into v_total, v_need
    from regions_totals(v_game.id) tt where tt.region = v_region;

  select coalesce(sum(t.worth) filter (where regions_region_at(t.position) = v_region), 0)::int,
         coalesce(sum(t.worth), 0)::int
    into v_pts, v_all_pts
    from tile_claims c join tiles t on t.id = c.tile_id
   where c.team_id = v_claim.team_id and c.status = 'completed' and t.game_id = v_game.id;

  -- Public, so it carries the region and the points but never the tile's
  -- name: teams that have not opened this region must not learn its tasks.
  -- A page whose team can see the tile names it from tile_id.
  insert into game_events (game_id, team_id, type, payload)
  values (v_game.id, v_claim.team_id, 'tile_completed',
          jsonb_build_object('mode',          'regions',
                             'tile_id',       v_tile.id,
                             'region',        v_region,
                             'region_name',   v_rname,
                             'worth',         v_tile.worth,
                             'region_points', v_pts,
                             'region_need',   v_need,
                             'points',        v_all_pts,
                             'by',            auth.uid(),
                             'by_name',       (select display_name from profiles
                                                where id = auth.uid())));

  -- This tile took the region over the line, and the region has not paid for a
  -- pick before: the team has one to spend.
  if v_total > 0 and v_pts >= v_need and v_pts - v_tile.worth < v_need
     and not exists (select 1 from region_unlocks u
                      where u.team_id = v_claim.team_id and u.funded_by = v_region) then
    v_left := exists (
      select 1 from regions_totals(v_game.id) tt
       where tt.tiles > 0
         and not exists (select 1 from region_unlocks u
                          where u.team_id = v_claim.team_id and u.region = tt.region));
    insert into game_events (game_id, team_id, type, payload)
    values (v_game.id, v_claim.team_id, 'region_completed',
            jsonb_build_object('mode',          'regions',
                               'region',        v_region,
                               'region_name',   v_rname,
                               'region_points', v_pts,
                               'region_need',   v_need,
                               'threshold',     v_game.region_threshold,
                               'can_pick',      v_left));
  end if;
  -- No early end: the game runs until the end time or the organiser ends it.
end;
$$;

-- ============================================================
-- 5. Ending
-- ============================================================

-- The one way a region game ends: time up, or the organiser.
create function finish_regions(p_game_id uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_game   games%rowtype;
  v_winner uuid;
  v_points int;
begin
  select * into v_game from games where id = p_game_id for update;
  if not found or v_game.mode <> 'regions' or v_game.status <> 'active' then
    return null;
  end if;

  -- Nobody wins a game in which nobody scored.
  select s.team_id, s.points into v_winner, v_points
    from regions_standings(p_game_id) s
   where s.points > 0
   order by s.place
   limit 1;

  update games
     set status         = 'finished',
         winner_team_id = v_winner,
         ended_reason   = p_reason,
         ended_at       = case when p_reason = 'time_up'
                               then coalesce(v_game.ends_at, now()) else now() end
   where id = p_game_id;

  insert into game_events (game_id, team_id, type, payload)
  values (p_game_id, v_winner, 'game_ended',
          jsonb_build_object('mode',           'regions',
                             'reason',         p_reason,
                             'winner_team_id', v_winner,
                             'points',         coalesce(v_points, 0)));
  return v_winner;
end;
$$;

-- Any open page calls this when its countdown reaches zero. Idempotent.
create function regions_settle(p_game_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_game games%rowtype;
begin
  select * into v_game from games where id = p_game_id;
  if not found or v_game.mode <> 'regions' or v_game.status <> 'active'
     or v_game.ends_at is null or now() < v_game.ends_at then
    return false;
  end if;
  perform finish_regions(p_game_id, 'time_up');
  return true;
end;
$$;

-- admin_revoke_evidence's hand-off once a tile stops counting. Opened regions
-- stay open and picks are worked out afresh, so only a finished game's winner
-- can need changing.
create function regions_after_uncomplete(p_game_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_game games%rowtype;
  v_new  uuid;
begin
  select * into v_game from games where id = p_game_id;
  if not found or v_game.status <> 'finished' then return null; end if;

  select s.team_id into v_new
    from regions_standings(p_game_id) s
   where s.points > 0
   order by s.place limit 1;
  if v_new is distinct from v_game.winner_team_id then
    update games set winner_team_id = v_new where id = p_game_id;
    return 'winner_changed';
  end if;
  return null;
end;
$$;

-- ============================================================
-- 6. The organiser's settings
-- ============================================================

create function admin_set_region_threshold(p_game_id uuid, p_threshold int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_game games%rowtype;
begin
  if not may_manage_game(p_game_id) then raise exception 'Not your game'; end if;
  select * into v_game from games where id = p_game_id;
  if not found then raise exception 'No such game'; end if;
  if v_game.mode <> 'regions' then
    raise exception 'Only a Region Bingo has a region threshold';
  end if;
  if v_game.status not in ('setup', 'placement') then
    raise exception 'The threshold is fixed once the game has started';
  end if;
  if p_threshold is null or p_threshold < 1 or p_threshold > 100 then
    raise exception 'The threshold is a percentage from 1 to 100';
  end if;
  update games set region_threshold = p_threshold where id = p_game_id;
end;
$$;

create function admin_set_tile_worth(p_game_id uuid, p_position int, p_worth int)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_game games%rowtype;
begin
  if not may_manage_game(p_game_id) then raise exception 'Not your game'; end if;
  select * into v_game from games where id = p_game_id;
  if not found then raise exception 'No such game'; end if;
  if v_game.mode <> 'regions' then
    raise exception 'Only Region Bingo tiles have points';
  end if;
  if v_game.status not in ('setup', 'placement') then
    raise exception 'Points are fixed once the game has started';
  end if;
  if p_worth is null or p_worth < 1 or p_worth > 100 then
    raise exception 'A tile is worth 1 to 100 points';
  end if;
  update tiles set worth = p_worth where game_id = p_game_id and position = p_position;
  if not found then raise exception 'There is no tile on that square'; end if;
end;
$$;

-- admin_list_tiles' columns are fixed by its signature, so the builder reads
-- the points beside it.
create function admin_tile_worths(p_game_id uuid)
returns table("position" smallint, worth smallint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not may_manage_game(p_game_id) then raise exception 'Not your game'; end if;
  return query
    select t.position, t.worth from tiles t
     where t.game_id = p_game_id order by t.position;
end;
$$;

-- ============================================================
-- 7. Discord
-- ============================================================

-- The region lines. Null for anything else, so discord_line falls through to
-- the shared wording (evidence submitted, evidence withdrawn, ...).
create function regions_discord_line(p_event game_events, p_team text)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  p       jsonb := p_event.payload;
  v_rname text  := coalesce(p ->> 'region_name', 'a region');
begin
  if p_event.type = 'game_started' then
    return ':world_map: **Region Bingo has begun!** Captains, pick your team''s first region.';
  elsif p_event.type = 'game_reset' then
    return 'Region Bingo has been reset — every region is locked again.';
  elsif p_event.type = 'region_opened' then
    return case when (p ->> 'first')::boolean
      then format(':round_pushpin: **%s** starts in **%s**.', p_team, v_rname)
      else format(':unlock: **%s** opened **%s**.', p_team, v_rname) end;
  elsif p_event.type = 'region_completed' then
    return case when coalesce((p ->> 'can_pick')::boolean, true)
      then format(':white_check_mark: **%s** reached %s%% of **%s** and can pick a new region.',
                  p_team, p ->> 'threshold', v_rname)
      else format(':white_check_mark: **%s** reached %s%% of **%s**.',
                  p_team, p ->> 'threshold', v_rname) end;
  elsif p_event.type = 'tile_completed' then
    return format(':white_check_mark: **%s** completed a tile in **%s** (+%s) — %s points.',
                  p_team, v_rname, p ->> 'worth', p ->> 'points');
  elsif p_event.type = 'game_ended' then
    return case
      when p_event.team_id is null then
        case p ->> 'reason'
          when 'time_up' then ':hourglass: **Time''s up!** Nobody scored, so nobody wins.'
          else 'The organiser ended the game. Nobody scored, so nobody wins.'
        end
      when p ->> 'reason' = 'time_up' then
        format(':hourglass: **Time''s up!** :trophy: **%s** wins with %s points.', p_team, p ->> 'points')
      else
        format('The organiser ended the game. :trophy: **%s** wins with %s points.', p_team, p ->> 'points')
    end;
  end if;
  return null;
end;
$$;

-- ============================================================
-- 8. The shared functions, patched in place
-- ============================================================

create function pg_temp.regions_patch(p_fn text, p_old text, p_new text)
returns void
language plpgsql as $$
declare
  v_def text;
  v_n   int;
begin
  -- Line endings normalised, so a body once pasted from Windows still matches.
  v_def := replace(pg_get_functiondef(p_fn::regprocedure), E'\r', '');
  v_n   := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  if v_n <> 1 then
    raise exception 'regions patch: % matched % times, expected exactly once: %',
      p_fn, v_n, left(p_old, 120);
  end if;
  execute replace(v_def, p_old, p_new);
end;
$$;

-- add_evidence: the last screenshot on a region tile completes it here.
select pg_temp.regions_patch('add_evidence(uuid,text,text,uuid,integer)',
$o$    elsif v_open then
      perform complete_bingo_tile(p_claim_id);$o$,
$n$    elsif v_game.mode = 'regions' then
      perform complete_regions_tile(p_claim_id);
    elsif v_open then
      perform complete_bingo_tile(p_claim_id);$n$);

-- start_game: starts like a bingo, with the region checks in place of a full card.
select pg_temp.regions_patch('start_game(uuid)',
$o$  if v_game.mode in ('bingo', 'snakes', 'territory') then$o$,
$n$  if v_game.mode in ('bingo', 'snakes', 'territory', 'regions') then$n$);

select pg_temp.regions_patch('start_game(uuid)',
$o$    else
      select count(*) into v_tiles from tiles where game_id = p_game_id;$o$,
$n$    elsif v_game.mode = 'regions' then
      v_empty := regions_start_problem(p_game_id);
      if v_empty is not null then
        raise exception '%', v_empty;
      end if;
    else
      select count(*) into v_tiles from tiles where game_id = p_game_id;$n$);

-- admin_new_game: any number of teams, always the 10x10 card.
select pg_temp.regions_patch('admin_new_game(text,game_mode,text[],smallint,timestamp with time zone)',
$o$  if coalesce(array_length(v_names, 1), 0) < 1 then
    raise exception 'A bingo needs at least one team';$o$,
$n$  if p_mode = 'regions' and coalesce(array_length(v_names, 1), 0) < 1 then
    raise exception 'Region Bingo needs at least one team';
  end if;
  if coalesce(array_length(v_names, 1), 0) < 1 then
    raise exception 'A bingo needs at least one team';$n$);

select pg_temp.regions_patch('admin_new_game(text,game_mode,text[],smallint,timestamp with time zone)',
$o$case when p_mode = 'snakes' then 10 when p_mode = 'territory' then 8$o$,
$n$case when p_mode in ('snakes', 'regions') then 10 when p_mode = 'territory' then 8$n$);

-- admin_end_game: the organiser ends a region game like a bingo.
select pg_temp.regions_patch('admin_end_game(uuid)',
$o$  if v_game.mode = 'snakes' then
    raise exception 'Snakes and Ladders ends through admin_snakes_end_game$o$,
$n$  if v_game.mode = 'regions' then
    if v_game.status <> 'active' then
      raise exception 'The game is % — it is not running', v_game.status;
    end if;
    return finish_regions(p_game_id,
      case when v_game.ends_at is not null and now() >= v_game.ends_at
           then 'time_up' else 'admin' end);
  end if;
  if v_game.mode = 'snakes' then
    raise exception 'Snakes and Ladders ends through admin_snakes_end_game$n$);

-- admin_set_end_time: a region game has an end time.
select pg_temp.regions_patch('admin_set_end_time(uuid,timestamp with time zone)',
$o$if v_game.mode not in ('bingo', 'territory', 'challenge') then$o$,
$n$if v_game.mode not in ('bingo', 'territory', 'challenge', 'regions') then$n$);

-- admin_revoke_evidence: bingo's branch, and a finished game's winner checked again.
select pg_temp.regions_patch('admin_revoke_evidence(uuid,boolean)',
$o$  if v_game.mode in ('bingo', 'snakes', 'territory') then$o$,
$n$  if v_game.mode in ('bingo', 'snakes', 'territory', 'regions') then$n$);

select pg_temp.regions_patch('admin_revoke_evidence(uuid,boolean)',
$o$        elsif v_game.status = 'finished' then
          if v_game.ended_reason = 'full_card'$o$,
$n$        elsif v_game.mode = 'regions' then
          v_effect    := regions_after_uncomplete(v_game.id);
          v_win_moved := coalesce(v_effect = 'winner_changed', false);
        elsif v_game.status = 'finished' then
          if v_game.ended_reason = 'full_card'$n$);

-- board_for_me and admin_board_for_team: the standings, and the team's regions.
select pg_temp.regions_patch('board_for_me(uuid)',
$o$      else '[]'::jsonb end,
    'territory', case when v_mode = 'territory' then territory_state(p_game_id) end,$o$,
$n$      when v_mode = 'regions' then coalesce((
        select jsonb_agg(to_jsonb(s) order by s.place) from regions_standings(p_game_id) s
      ), '[]'::jsonb)
      else '[]'::jsonb end,
    'territory', case when v_mode = 'territory' then territory_state(p_game_id) end,
    'regions', case when v_mode = 'regions'
                    then regions_state(p_game_id, my_team_in_game(p_game_id)) end,$n$);

select pg_temp.regions_patch('admin_board_for_team(uuid,uuid,team_role)',
$o$      else '[]'::jsonb end,
    'territory', case when v_mode = 'territory' then territory_state(p_game_id) end,$o$,
$n$      when v_mode = 'regions' then coalesce((
        select jsonb_agg(to_jsonb(s) order by s.place) from regions_standings(p_game_id) s
      ), '[]'::jsonb)
      else '[]'::jsonb end,
    'territory', case when v_mode = 'territory' then territory_state(p_game_id) end,
    'regions', case when v_mode = 'regions' then regions_state(p_game_id, p_team_id) end,$n$);

-- tiles_for_team: a region game shows a team only its opened regions' squares.
select pg_temp.regions_patch('tiles_for_team(uuid,uuid)',
$o$  where t.game_id = p_game_id
  order by t.position;$o$,
$n$  where t.game_id = p_game_id
    and regions_tile_visible(p_game_id, p_team_id, t.position)
  order by t.position;$n$);

-- discord_line: the region lines first, and no "at B4" for a square in a region.
select pg_temp.regions_patch('discord_line(game_events)',
$o$  if (select g.mode = 'challenge' from games g where g.id = p_event.game_id) then$o$,
$n$  if (select g.mode = 'regions' from games g where g.id = p_event.game_id) then
    v_line := regions_discord_line(p_event, v_team);
    if v_line is not null then return v_line; end if;
  end if;
  if (select g.mode = 'challenge' from games g where g.id = p_event.game_id) then$n$);

select pg_temp.regions_patch('discord_line(game_events)',
$o$  if v_pos is not null and not coalesce(v_territory, false) then$o$,
$n$  if v_pos is not null and not coalesce(v_territory, false)
     and not exists (select 1 from games g
                      where g.id = p_event.game_id and g.mode = 'regions') then$n$);

-- admin_reset_game: every region locked again.
select pg_temp.regions_patch('admin_reset_game(uuid,boolean)',
$o$  delete from territory_lost_evidence where game_id = p_game_id;$o$,
$n$  delete from territory_lost_evidence where game_id = p_game_id;
  delete from region_unlocks          where game_id = p_game_id;$n$);

-- admin_autofill_board: deal nothing onto square 100, which has no region.
select pg_temp.regions_patch('admin_autofill_board(uuid)',
$o$              where te.game_id = p_game_id and tp.position = (r.n - 1) * 10 + c.n)
  ),$o$,
$n$              where te.game_id = p_game_id and tp.position = (r.n - 1) * 10 + c.n)
       -- Region Bingo: square 100 belongs to no region.
       and not (v_game.mode = 'regions' and (r.n - 1) * 10 + c.n > 99)
  ),$n$);

-- Saved boards carry each tile's points, so a region board comes back whole.
select pg_temp.regions_patch('admin_save_board_preset(uuid,text)',
$o$                 'libraryId',   t.library_id,$o$,
$n$                 'libraryId',   t.library_id,
                 'worth',       t.worth,$n$);

select pg_temp.regions_patch('admin_apply_board_preset(uuid,uuid)',
$o$                     description, completion, per_set, library_id)
  select p_game_id,$o$,
$n$                     description, completion, per_set, library_id, worth)
  select p_game_id,$n$);

select pg_temp.regions_patch('admin_apply_board_preset(uuid,uuid)',
$o$         nullif(btrim(coalesce(s.val -> 'tile' ->> 'libraryId', '')), '')::uuid
    from jsonb_array_elements(v_preset.squares) as s(val)$o$,
$n$         nullif(btrim(coalesce(s.val -> 'tile' ->> 'libraryId', '')), '')::uuid,
         least(greatest(coalesce((nullif(btrim(s.val -> 'tile' ->> 'worth'), ''))::int, 1), 1), 100)
    from jsonb_array_elements(v_preset.squares) as s(val)$n$);

-- ============================================================
-- 9. Who may call what
-- ============================================================
-- Internal: the totals would leak the regions a team has not opened, and the
-- rest change game state without the checks around them.
revoke execute on function regions_region_at(int)                          from public, anon, authenticated;
revoke execute on function regions_totals(uuid)                            from public, anon, authenticated;
revoke execute on function regions_team_regions(uuid)                      from public, anon, authenticated;
revoke execute on function regions_tile_visible(uuid, uuid, int)           from public, anon, authenticated;
revoke execute on function regions_start_problem(uuid)                     from public, anon, authenticated;
revoke execute on function complete_regions_tile(uuid)                     from public, anon, authenticated;
revoke execute on function finish_regions(uuid, text)                      from public, anon, authenticated;
revoke execute on function regions_after_uncomplete(uuid)                  from public, anon, authenticated;
revoke execute on function regions_discord_line(game_events, text)         from public, anon, authenticated;

-- Signed-in players and organisers; each checks who is asking itself.
revoke execute on function regions_state(uuid, uuid)                       from public, anon;
grant  execute on function regions_state(uuid, uuid)                       to authenticated;
revoke execute on function regions_standings(uuid)                         from public, anon;
grant  execute on function regions_standings(uuid)                         to authenticated;
revoke execute on function regions_open_tile(uuid)                         from public, anon;
grant  execute on function regions_open_tile(uuid)                         to authenticated;
revoke execute on function regions_pick(uuid, text)                        from public, anon;
grant  execute on function regions_pick(uuid, text)                        to authenticated;
revoke execute on function regions_settle(uuid)                            from public, anon;
grant  execute on function regions_settle(uuid)                            to authenticated;
revoke execute on function admin_set_region_threshold(uuid, int)           from public, anon;
grant  execute on function admin_set_region_threshold(uuid, int)           to authenticated;
revoke execute on function admin_set_tile_worth(uuid, int, int)            from public, anon;
grant  execute on function admin_set_tile_worth(uuid, int, int)            to authenticated;
revoke execute on function admin_tile_worths(uuid)                         from public, anon;
grant  execute on function admin_tile_worths(uuid)                         to authenticated;
