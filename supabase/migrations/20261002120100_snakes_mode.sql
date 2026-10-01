-- Game modes: Snakes and Ladders, the third one.
--
-- The clan's earlier "Snakes & Rats" event, ported from its Google Sheet and
-- Apps Script into the platform, with every rat removed. The agreed rules are
-- in docs/snakes-and-ladders-rules.md; this is the database half.
--
-- It sits on top of bingo (20261001120100) rather than beside it. A tile is
-- still a tile task with one of the five completion rules, finished with
-- screenshots through add_evidence, and the board is open from the start, as
-- in bingo. What is new is WHICH tile a team may work on:
--
--   rule                       bingo                    snakes
--   -------------------------  -----------------------  ------------------------
--   teams                      one or more              one or more
--   board                      3x3 to 10x10, open       always 100 tiles, open
--   which tiles a team works   any, in any order        only the one it stands on
--   after finishing a tile     nothing                  roll the die
--   game ends                  full card, timer, admin  a team finishes tile 100,
--                                                       or the organiser ends it
--
-- WHERE A TEAM STANDS lives on `teams` (board_tile, 0 = Start), because teams
-- are world-readable and the board is open: every team sees every marker.
--
-- TILE NUMBERS are `tiles.position` as it already is, 1 to 100. The snake
-- path (left to right, then right to left, bottom to top) is only how the
-- website draws them; the database never needs it.
--
-- SNAKES are rows in `board_jumps`, from a head to a lower tail. A ladder is
-- the same row going up, so adding ladders later is a constraint and a word in
-- the feed, not a new table. The movement code below already says "jumps".
--
-- THE DIE is rolled here, never in the browser: `snakes_roll` and the other
-- callable functions draw random numbers and hand them to `snakes_move`, which
-- does all the moving. `snakes_move` takes the dice as an argument and is not
-- callable from the website, which is what lets the smoke test play exact
-- rolls.
--
-- Every battleships-only rule that bingo taught to stand aside ("is this
-- bingo?") now asks "is this battleships?" instead, so a third mode cannot fall
-- into the battleships branch of anything.

-- ============================================================
-- 1. games: snakes boards are 10x10, and a game can be won
-- ============================================================

-- The check was declared inline in 20261001120100, so its name is Postgres's
-- choice; find it rather than guess it.
do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.games'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%ended_reason%'
  loop
    execute format('alter table games drop constraint %I', v_name);
  end loop;
end;
$$;

alter table games add constraint games_ended_reason_check
  check (ended_reason is null or ended_reason in ('full_card', 'time_up', 'admin', 'won'));

comment on column games.ended_reason is
  'Bingo: full_card, time_up or admin. Snakes: won or admin. Null while running, and on battleships.';

alter table games drop constraint games_grid_size_check;
alter table games add constraint games_grid_size_check
  check (grid_size between 3 and 26
         and (mode <> 'bingo' or grid_size <= 10)
         and (mode <> 'snakes' or grid_size = 10));

-- ============================================================
-- 2. teams: where each team stands
-- ============================================================

alter table teams
  add column board_tile           smallint    not null default 0
    check (board_tile between 0 and 100),
  add column board_moved_at       timestamptz,
  add column rollbacks_available  smallint    not null default 0
    check (rollbacks_available >= 0),
  add column rollbacks_used       smallint    not null default 0
    check (rollbacks_used >= 0),
  add column auto_rollback_earned boolean     not null default false;

comment on column teams.board_tile is
  'Snakes only: the tile the team stands on, 1-100, or 0 for Start.';
comment on column teams.board_moved_at is
  'Snakes only: when the team arrived on board_tile. Breaks ties in "furthest along".';
comment on column teams.rollbacks_available is
  'Snakes only: rollbacks the team can still spend.';
comment on column teams.rollbacks_used is
  'Snakes only: rollbacks spent. The 1st goes back 1-3, the 2nd a d6, later ones the higher of two d6.';
comment on column teams.auto_rollback_earned is
  'Snakes only: the free rollback for a first tile at 40 or above has been given.';

-- ============================================================
-- 3. tile_claims: an organiser can complete a tile outright
-- ============================================================

alter table tile_claims
  add column completed_early boolean not null default false;
alter table tile_claims add constraint completed_early_is_completed
  check (not completed_early or status = 'completed');

comment on column tile_claims.completed_early is
  'Snakes: an organiser pressed "Complete tile now". The tile counts as done without meeting its rule.';

-- Body from 20261001120100, plus the early-completion pass.
create or replace function enforce_evidence_before_fire()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'active' or old.status = new.status then
    return new;
  end if;

  -- On purpose and on the record: only admin_snakes_complete_tile sets it, and
  -- players cannot write this table at all.
  if new.status = 'completed' and new.completed_early then
    return new;
  end if;

  if not claim_is_complete(new.id) then
    raise exception 'This tile is not finished yet';
  end if;

  return new;
end;
$$;

-- ============================================================
-- 4. board_jumps: the snakes (and, later, the ladders)
-- ============================================================

create table board_jumps (
  game_id   uuid     not null references games(id) on delete cascade,
  from_tile smallint not null,
  to_tile   smallint not null,
  primary key (game_id, from_tile),
  -- Snakes only, for now: down from a head on 2-99 to a lower tail. Ladders
  -- will relax this to "to_tile <> from_tile".
  constraint board_jumps_snakes_only
    check (from_tile between 2 and 99 and to_tile >= 1 and to_tile < from_tile)
);

comment on table board_jumps is
  'Snakes and Ladders: landing on from_tile moves a team to to_tile. Down = snake.';

-- Open, like the board. Written only through admin_set_snakes.
alter table board_jumps enable row level security;
create policy board_jumps_read on board_jumps for select using (true);

-- ============================================================
-- 5. Battleships-only rules: "not battleships" instead of "bingo"
-- ============================================================

create or replace function enforce_two_teams()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select mode from games where id = new.game_id) <> 'battleships' then
    return new;
  end if;
  if (select count(*) from teams where game_id = new.game_id) >= 2 then
    raise exception 'Game % already has two teams', new.game_id;
  end if;
  return new;
end;
$$;

create or replace function enforce_active_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  limit_n  smallint;
  active_n smallint;
  v_mode   game_mode;
begin
  select g.max_active_tiles, g.mode into limit_n, v_mode
    from games g join teams t on t.game_id = g.id
   where t.id = new.team_id;

  if v_mode <> 'battleships' then
    return new;
  end if;

  select count(*) into active_n
    from tile_claims
   where team_id = new.team_id
     and status = 'active'
     and paused_at is null
     and id <> new.id;

  if active_n >= limit_n then
    raise exception 'Team % is already holding % active tiles — finish or free one first',
      new.team_id, limit_n;
  end if;
  return new;
end;
$$;

create or replace function claim_tile(p_tile_id uuid)
returns tile_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id  uuid;
  v_tile     tiles%rowtype;
  v_claim    tile_claims;
  v_existing tile_claims%rowtype;
  v_relock   boolean := false;
begin
  select * into v_tile from tiles where id = p_tile_id;
  if not found then
    raise exception 'No such tile';
  end if;

  if (select mode from games where id = v_tile.game_id) <> 'battleships' then
    raise exception 'Tiles in this game need no lock-in — just submit your evidence';
  end if;

  v_team_id := my_team_in_game(v_tile.game_id);

  if v_team_id is null then
    raise exception 'You are not a member of a team in this game';
  end if;

  if (select status from games where id = v_tile.game_id) <> 'active' then
    raise exception 'The game is not active';
  end if;

  select * into v_existing from tile_claims
   where team_id = v_team_id and tile_id = p_tile_id for update;

  if found then
    if v_existing.status = 'fired' then
      raise exception 'Your team has already fired at that square';
    elsif v_existing.paused_at is null then
      raise exception 'Your team already has that tile locked in';
    end if;

    v_relock := true;

    update tile_claims
       set paused_at = null, claimed_by = auth.uid(), claimed_at = now()
     where id = v_existing.id
    returning * into v_claim;
  else
    insert into tile_claims (team_id, tile_id, claimed_by)
    values (v_team_id, p_tile_id, auth.uid())
    returning * into v_claim;
  end if;

  if v_relock then
    insert into game_events (game_id, team_id, type, payload)
    values (v_tile.game_id, v_team_id, 'tile_relocked',
            jsonb_build_object('tile_id', v_tile.id, 'position', v_tile.position,
                               'tile_name', v_tile.name, 'by', auth.uid(),
                               'by_name', (select display_name from profiles
                                            where id = auth.uid())));
  else
    insert into game_events (game_id, team_id, type, payload)
    values (v_tile.game_id, v_team_id, 'tile_claimed',
            jsonb_build_object('tile_id', v_tile.id,
                               'position', v_tile.position, 'by', auth.uid()));
  end if;

  return v_claim;
end;
$$;

create or replace function fire_tile(p_claim_id uuid)
returns shot_result
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim    tile_claims%rowtype;
  v_tile     tiles%rowtype;
  v_game_id  uuid;
  v_status   game_status;
  v_enemy_id uuid;
  v_result   shot_result;
  v_ship_id  uuid;
  v_ship     record;
begin
  select * into v_claim from tile_claims where id = p_claim_id;

  if v_claim is null then
    raise exception 'No such tile claim';
  end if;
  if v_claim.status = 'fired' then
    raise exception 'That tile has already been fired';
  end if;
  if not exists (select 1 from team_members
                  where team_id = v_claim.team_id and profile_id = auth.uid()) then
    raise exception 'That tile belongs to the other team';
  end if;

  select * into v_tile from tiles where id = v_claim.tile_id;
  v_game_id := v_tile.game_id;

  if (select mode from games where id = v_game_id) <> 'battleships' then
    raise exception 'Only a battleships tile is fired — this one is completed';
  end if;

  -- The game has to still be running. Without this a claim left open when the
  -- match ended can be fired afterwards, and the winner update below rewrites
  -- who won.
  select status into v_status from games where id = v_game_id;
  if v_status <> 'active' then
    raise exception 'The game is % — no more shots', v_status;
  end if;

  select id into v_enemy_id from teams
   where game_id = v_game_id and id <> v_claim.team_id;

  select sc.ship_id into v_ship_id
    from ship_cells sc
   where sc.team_id = v_enemy_id and sc.row = v_tile.row and sc.col = v_tile.col;

  v_result := case when v_ship_id is null then 'miss' else 'hit' end;

  update tile_claims
     set status = 'fired', result = v_result, fired_by = auth.uid(), fired_at = now()
   where id = p_claim_id;

  insert into game_events (game_id, team_id, type, payload)
  values (v_game_id, v_claim.team_id, 'shot_fired',
          jsonb_build_object('tile_id', v_tile.id,
                             'position', v_tile.position, 'result', v_result,
                             'by', auth.uid()));

  if v_result = 'hit' then
    -- Read once: the size announced and the sunk decision must come from the
    -- same row, or a wrong `ships.size` creeps back in through the payload.
    select * into v_ship from ship_status where ship_id = v_ship_id;

    if v_ship.sunk then
      insert into game_events (game_id, team_id, type, payload)
      values (v_game_id, v_claim.team_id, 'ship_sunk',
              jsonb_build_object('ship_id', v_ship_id,
                                 'size', v_ship.size,
                                 'victim_team_id', v_enemy_id));

      -- Open lock-ins on ring squares go first, so the reveal below can land
      -- on them. Evidence is counted before the delete cascades it away.
      with doomed as (
        select c.id, c.paused_at, t.id as tile_id, t.position,
               (select count(*) from tile_evidence e where e.claim_id = c.id)::int as n_evidence
          from tile_claims c
          join tiles t on t.id = c.tile_id
         where c.team_id = v_claim.team_id
           and c.status  = 'active'
           and t.game_id = v_game_id
           and exists (
                 select 1 from ship_cells hull
                  where hull.ship_id = v_ship_id
                    and abs(hull.row - t.row) <= 1
                    and abs(hull.col - t.col) <= 1
               )
           and not exists (
                 select 1 from ship_cells own
                  where own.ship_id = v_ship_id
                    and own.row = t.row and own.col = t.col
               )
      ),
      gone as (
        delete from tile_claims c
         using doomed d
         where c.id = d.id
        returning c.id
      )
      insert into game_events (game_id, team_id, type, payload)
      select v_game_id, v_claim.team_id, 'slot_freed',
             jsonb_build_object('claim_id',         d.id,
                                'tile_id',          d.tile_id,
                                'position',         d.position,
                                'reason',           'ring_revealed',
                                'evidence_deleted', d.n_evidence)
        from doomed d
        join gone g on g.id = d.id
       where d.paused_at is null;

      -- The ring: every neighbour of every cell of this hull, minus the
      -- hull's own cells, minus anything the sinking team already holds a
      -- claim on. Guaranteed water by the no-touching rule, so it costs the
      -- sinking team nothing to learn it. After the delete above, the only
      -- claims left to conflict with are fired ones.
      insert into tile_claims (team_id, tile_id, status, claimed_at, fired_at, result)
      select v_claim.team_id, ring_tile.id, 'fired', now(), now(), 'miss'
        from ship_cells hull
        cross join generate_series(-1, 1) as dr
        cross join generate_series(-1, 1) as dc
        join tiles ring_tile
          on ring_tile.game_id = v_game_id
         and ring_tile.row = hull.row + dr
         and ring_tile.col = hull.col + dc
       where hull.ship_id = v_ship_id
         and not (dr = 0 and dc = 0)
         and not exists (
               select 1 from ship_cells own
                where own.ship_id = v_ship_id
                  and own.row = ring_tile.row and own.col = ring_tile.col
             )
      on conflict (team_id, tile_id) do nothing;

      if not exists (select 1 from ship_status where team_id = v_enemy_id and not sunk) then
        -- `and status = 'active'` so a win can never overwrite a win.
        update games set status = 'finished', winner_team_id = v_claim.team_id, ended_at = now()
         where id = v_game_id and status = 'active';

        if found then
          insert into game_events (game_id, team_id, type, payload)
          values (v_game_id, v_claim.team_id, 'game_won',
                  jsonb_build_object('loser_team_id', v_enemy_id));
        end if;
      end if;
    end if;
  end if;

  return v_result;
end;
$$;

-- A team's progress is its own business in snakes too (20261001210000). Where
-- it stands and what it has finished are public, through the board.
drop policy if exists claims_read on tile_claims;
create policy claims_read on tile_claims
  for select to authenticated
  using (
    not exists (
      select 1 from teams t join games g on g.id = t.game_id
       where t.id = tile_claims.team_id and g.mode <> 'battleships'
    )
    or team_id in (select my_team_ids())
    or is_admin()
  );

drop policy if exists claims_read_anon on tile_claims;
create policy claims_read_anon on tile_claims
  for select to anon
  using (
    not exists (
      select 1 from teams t join games g on g.id = t.game_id
       where t.id = tile_claims.team_id and g.mode <> 'battleships'
    )
  );

-- ============================================================
-- 6. Moving
-- ============================================================

-- From p_tile, step forward past tiles the team has finished, stopping at the
-- first one that is open, is a snake head, or is p_cap.
create function snakes_shift(p_tile int, p_cap int, p_done int[], p_heads int[])
returns int
language sql
immutable
set search_path = ''
as $$
  select coalesce(min(s.t), p_tile)
    from generate_series(p_tile, greatest(p_tile, p_cap)) as s(t)
   where s.t >= p_cap or not (s.t = any(p_done)) or s.t = any(p_heads);
$$;

revoke execute on function snakes_shift(int, int, int[], int[]) from public, anon, authenticated;

-- Internal. Every way a marker moves, with the dice given rather than rolled:
--
--   roll      only once the current tile is finished (free from Start). One
--             d6; past 100 bounces back. If the next six tiles are all
--             finished or snake heads, jump to the first open tile instead.
--   rollback  spends one. Back 1-3 the first time (d6 folded onto 1-3), a d6
--             the second, the higher of two d6 after that.
--   punish    back one d6.
--   move      straight to p_target (0-100, never a snake head); no skips, no
--             snakes.
--
-- After a roll, rollback or punishment: skip forward past finished tiles (a
-- backward move never past where the team started), then follow snakes, with
-- the skip again after each tail.
create function snakes_move(p_team_id uuid, p_kind text, p_dice int[] default null,
                            p_target int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team    teams%rowtype;
  v_game    games%rowtype;
  v_done    int[];
  v_heads   int[];
  v_from    int;
  v_steps   int;
  v_land    int;
  v_t       int;
  v_dest    int;
  v_after   int;
  v_skipped int[] := '{}';
  v_jumps   jsonb := '[]'::jsonb;
  v_bounced boolean := false;
  v_long    boolean := false;
  v_guard   int := 0;
  v_name    text;
  v_payload jsonb;
begin
  if p_kind is null or p_kind not in ('roll', 'rollback', 'punish', 'move') then
    raise exception 'Unknown move %', coalesce(p_kind, 'null');
  end if;

  select * into v_team from teams where id = p_team_id for update;
  if not found then raise exception 'No such team'; end if;

  select * into v_game from games where id = v_team.game_id;
  if v_game.mode <> 'snakes' then
    raise exception 'That team is not in a Snakes and Ladders game';
  end if;
  if v_game.status <> 'active' then
    raise exception 'The game is % — nobody moves now', v_game.status;
  end if;

  if p_kind <> 'move' and (
       coalesce(array_length(p_dice, 1), 0) = 0
       or exists (select 1 from unnest(p_dice) as d(v) where d.v is null or d.v not between 1 and 6)
     ) then
    raise exception 'Dice are 1 to 6';
  end if;

  select coalesce(array_agg(t.position::int order by t.position), '{}') into v_done
    from tile_claims c join tiles t on t.id = c.tile_id
   where c.team_id = p_team_id and c.status = 'completed';

  select coalesce(array_agg(j.from_tile::int order by j.from_tile), '{}') into v_heads
    from board_jumps j where j.game_id = v_game.id;

  v_from := v_team.board_tile;

  if p_kind = 'roll' then
    if v_from >= 1 and not (v_from = any(v_done)) then
      raise exception 'Finish tile % before rolling again', v_from;
    end if;
    v_steps := p_dice[1];

    if v_from + 6 <= 100 and not exists (
         select 1 from generate_series(v_from + 1, v_from + 6) as s(t)
          where not (s.t = any(v_done)) and not (s.t = any(v_heads))
       ) then
      select min(s.t) into v_land
        from generate_series(v_from + 1, 100) as s(t)
       where not (s.t = any(v_done)) and not (s.t = any(v_heads));
      if v_land is not null then
        v_long := true;
        v_t    := v_land;
        select coalesce(array_agg(s.t order by s.t), '{}') into v_skipped
          from generate_series(v_from + 1, v_land - 1) as s(t);
      end if;
    end if;

    if not v_long then
      v_land := v_from + v_steps;
      if v_land > 100 then
        v_land    := 200 - v_land;
        v_bounced := true;
      end if;
      v_t := snakes_shift(v_land, 100, v_done, v_heads);
    end if;

  elsif p_kind in ('rollback', 'punish') then
    if v_from < 1 then
      raise exception '% has not left Start yet', v_team.name;
    end if;

    if p_kind = 'rollback' then
      if v_team.rollbacks_available < 1 then
        raise exception 'Your team has no rollbacks left';
      end if;
      v_steps := case
        when v_team.rollbacks_used = 0 then ((p_dice[1] - 1) % 3) + 1
        when v_team.rollbacks_used = 1 then p_dice[1]
        else greatest(p_dice[1], coalesce(p_dice[2], p_dice[1]))
      end;
    else
      v_steps := p_dice[1];
    end if;

    v_land := greatest(1, v_from - v_steps);
    v_t    := snakes_shift(v_land, v_from, v_done, v_heads);

  else
    if p_target is null or p_target not between 0 and 100 then
      raise exception 'Pick a tile from 0 (Start) to 100';
    end if;
    if p_target = any(v_heads) then
      raise exception 'Tile % is a snake head — pick another tile', p_target;
    end if;
    v_land := p_target;
    v_t    := p_target;
  end if;

  if not v_long and v_t > v_land then
    select array_agg(s.t order by s.t) into v_skipped
      from generate_series(v_land, v_t - 1) as s(t);
  end if;

  if p_kind <> 'move' then
    while v_t = any(v_heads) loop
      v_guard := v_guard + 1;
      if v_guard > 100 then
        raise exception 'The jumps on this board go round in a circle';
      end if;
      select j.to_tile into v_dest from board_jumps j
       where j.game_id = v_game.id and j.from_tile = v_t;
      v_after := snakes_shift(v_dest, 100, v_done, v_heads);
      v_jumps := v_jumps || jsonb_build_array(
                   jsonb_build_object('from', v_t, 'to', v_dest, 'then', v_after));
      v_t := v_after;
    end loop;
  end if;

  update teams
     set board_tile          = v_t,
         board_moved_at      = now(),
         rollbacks_available = rollbacks_available - case when p_kind = 'rollback' then 1 else 0 end,
         rollbacks_used      = rollbacks_used      + case when p_kind = 'rollback' then 1 else 0 end
   where id = p_team_id
  returning * into v_team;

  select t.name into v_name from tiles t
   where t.game_id = v_game.id and t.position = v_t;

  v_payload := jsonb_build_object(
    'mode',                'snakes',
    'kind',                p_kind,
    'from',                v_from,
    'dice',                case when p_kind = 'move' then null else to_jsonb(p_dice) end,
    'steps',               v_steps,
    'landed',              v_land,
    'to',                  v_t,
    'bounced',             v_bounced,
    'long_skip',           v_long,
    'skipped',             to_jsonb(coalesce(v_skipped, '{}'::int[])),
    'jumps',               v_jumps,
    'tile_name',           v_name,
    'rollbacks_available', v_team.rollbacks_available,
    'rollbacks_used',      v_team.rollbacks_used,
    'by',                  auth.uid(),
    'by_name',             (select display_name from profiles where id = auth.uid()));

  insert into game_events (game_id, team_id, type, payload)
  values (v_game.id, p_team_id, 'team_moved', v_payload);

  return v_payload;
end;
$$;

revoke execute on function snakes_move(uuid, text, int[], int) from public, anon, authenticated;

-- ============================================================
-- 7. Standings, finishing a tile, ending the game
-- ============================================================
-- One row per team, best first: the winner of a won game, then furthest along
-- (highest tile, then most tiles finished, then whoever got there first). The
-- same order picks the winner when the organiser ends a game early.

create function snakes_standings(p_game_id uuid)
returns table (
  team_id             uuid,
  team_name           text,
  slot                smallint,
  board_tile          smallint,
  board_moved_at      timestamptz,
  tiles_completed     integer,
  rollbacks_available smallint,
  rollbacks_used      smallint,
  completed_tiles     integer[],
  place               integer
)
language sql
stable
security definer
set search_path = public
as $$
  with done as (
    select te.id, te.name, te.slot, te.board_tile, te.board_moved_at,
           te.rollbacks_available, te.rollbacks_used,
           count(t.id)::int as n,
           coalesce(array_agg(t.position::int order by t.position)
                      filter (where t.id is not null), '{}'::int[]) as tiles
      from teams te
      left join tile_claims c on c.team_id = te.id and c.status = 'completed'
      left join tiles t on t.id = c.tile_id
     where te.game_id = p_game_id
     group by te.id
  )
  select d.id, d.name, d.slot, d.board_tile, d.board_moved_at, d.n,
         d.rollbacks_available, d.rollbacks_used, d.tiles,
         (row_number() over (
            order by coalesce(g.ended_reason = 'won' and g.winner_team_id = d.id, false) desc,
                     d.board_tile desc, d.n desc, d.board_moved_at asc nulls last, d.slot
         ))::int
    from done d
    cross join games g
   where g.id = p_game_id
   order by 10;
$$;

revoke execute on function snakes_standings(uuid) from public, anon;
grant  execute on function snakes_standings(uuid) to authenticated;

-- Internal. The one place a snakes game finishes.
create function finish_snakes(p_game_id uuid, p_reason text, p_winner uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game games%rowtype;
  v_tile int;
  v_n    int;
begin
  select * into v_game from games where id = p_game_id for update;
  if not found or v_game.mode <> 'snakes' or v_game.status <> 'active' then
    return null;
  end if;

  update games
     set status         = 'finished',
         winner_team_id = p_winner,
         ended_reason   = p_reason,
         ended_at       = now()
   where id = p_game_id;

  select s.board_tile, s.tiles_completed into v_tile, v_n
    from snakes_standings(p_game_id) s where s.team_id = p_winner;

  insert into game_events (game_id, team_id, type, payload)
  values (p_game_id, p_winner, 'game_ended',
          jsonb_build_object('mode',            'snakes',
                             'reason',          p_reason,
                             'winner_team_id',  p_winner,
                             'tile',            v_tile,
                             'tiles_completed', v_n));
  return p_winner;
end;
$$;

revoke execute on function finish_snakes(uuid, text, uuid) from public, anon, authenticated;

-- Internal: called by add_evidence once the team's current tile meets its
-- rule, and by admin_snakes_complete_tile with p_early.
create function complete_snakes_tile(p_claim_id uuid, p_early boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim tile_claims%rowtype;
  v_tile  tiles%rowtype;
  v_team  teams%rowtype;
  v_done  int;
begin
  update tile_claims
     set status = 'completed', fired_by = auth.uid(), fired_at = now(),
         completed_early = p_early
   where id = p_claim_id and status = 'active'
  returning * into v_claim;
  if not found then return; end if;

  select * into v_tile from tiles where id = v_claim.tile_id;

  select count(*)::int into v_done
    from tile_claims c join tiles t on t.id = c.tile_id
   where c.team_id = v_claim.team_id and c.status = 'completed'
     and t.game_id = v_tile.game_id;

  insert into game_events (game_id, team_id, type, payload)
  values (v_tile.game_id, v_claim.team_id, 'tile_completed',
          jsonb_build_object('mode',            'snakes',
                             'tile_id',         v_tile.id,
                             'position',        v_tile.position,
                             'tile_name',       v_tile.name,
                             'early',           p_early,
                             'by',              auth.uid(),
                             'by_name',         (select display_name from profiles
                                                  where id = auth.uid()),
                             'tiles_completed', v_done));

  if v_tile.position = 100 then
    perform finish_snakes(v_tile.game_id, 'won', v_claim.team_id);
    return;
  end if;

  -- One free rollback, once, for the first tile at 40 or above.
  if v_tile.position >= 40 then
    update teams
       set rollbacks_available = rollbacks_available + 1,
           auto_rollback_earned = true
     where id = v_claim.team_id and not auto_rollback_earned
    returning * into v_team;

    if found then
      insert into game_events (game_id, team_id, type, payload)
      values (v_tile.game_id, v_claim.team_id, 'rollback_gained',
              jsonb_build_object('mode',                'snakes',
                                 'reason',              'auto',
                                 'amount',              1,
                                 'tile',                v_tile.position,
                                 'rollbacks_available', v_team.rollbacks_available));
    end if;
  end if;
end;
$$;

revoke execute on function complete_snakes_tile(uuid, boolean) from public, anon, authenticated;

-- Internal: a team's finished tile is no longer finished. A game won on that
-- tile (100) reopens; a game the organiser ended re-reads its winner.
-- Returns 'reopened', 'winner_changed' or null.
create function snakes_after_uncomplete(p_game_id uuid, p_team_id uuid, p_position int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game games%rowtype;
  v_new  uuid;
begin
  select * into v_game from games where id = p_game_id for update;
  if v_game.status <> 'finished' then return null; end if;

  if v_game.ended_reason = 'won' then
    if v_game.winner_team_id = p_team_id and p_position = 100 then
      update games
         set status = 'active', winner_team_id = null, ended_at = null, ended_reason = null
       where id = p_game_id;
      return 'reopened';
    end if;
    return null;
  end if;

  select s.team_id into v_new
    from snakes_standings(p_game_id) s
   where s.board_tile > 0
   order by s.place limit 1;

  if v_new is distinct from v_game.winner_team_id then
    update games set winner_team_id = v_new where id = p_game_id;
    return 'winner_changed';
  end if;
  return null;
end;
$$;

revoke execute on function snakes_after_uncomplete(uuid, uuid, int) from public, anon, authenticated;

-- ============================================================
-- 8. What a snakes player calls
-- ============================================================

-- The team's progress row for the tile it stands on, made on first use. Same
-- job as bingo_open_tile: the client needs the id for the storage path.
create function snakes_open_tile(p_game_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game games%rowtype;
  v_team teams%rowtype;
  v_tile uuid;
  v_id   uuid;
begin
  select * into v_game from games where id = p_game_id;
  if not found then raise exception 'No such game'; end if;
  if v_game.mode <> 'snakes' then
    raise exception 'This is not a Snakes and Ladders game';
  end if;

  select * into v_team from teams where id = my_team_in_game(p_game_id);
  if not found then
    raise exception 'You are not a member of a team in this game';
  end if;

  if v_game.status <> 'active' then
    raise exception 'The game is % — no submissions now', v_game.status;
  end if;
  if v_team.board_tile < 1 then
    raise exception 'Roll the die to leave Start first';
  end if;

  select t.id into v_tile from tiles t
   where t.game_id = p_game_id and t.position = v_team.board_tile;
  if v_tile is null then
    raise exception 'Tile % is missing from the board', v_team.board_tile;
  end if;

  insert into tile_claims (team_id, tile_id, claimed_by)
  values (v_team.id, v_tile, auth.uid())
  on conflict (team_id, tile_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from tile_claims
     where team_id = v_team.id and tile_id = v_tile;
  end if;

  return v_id;
end;
$$;

revoke execute on function snakes_open_tile(uuid) from public, anon;
grant  execute on function snakes_open_tile(uuid) to authenticated;

-- Any player on the team may roll, once the current tile is finished.
create function snakes_roll(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team uuid := my_team_in_game(p_game_id);
begin
  if v_team is null then
    raise exception 'You are not a member of a team in this game';
  end if;
  return snakes_move(v_team, 'roll', array[1 + floor(random() * 6)::int]);
end;
$$;

revoke execute on function snakes_roll(uuid) from public, anon;
grant  execute on function snakes_roll(uuid) to authenticated;

-- Any player on the team may spend one. Two dice are drawn every time;
-- snakes_move decides how many it reads from how many the team has used.
create function snakes_spend_rollback(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team uuid := my_team_in_game(p_game_id);
begin
  if v_team is null then
    raise exception 'You are not a member of a team in this game';
  end if;
  return snakes_move(v_team, 'rollback',
                     array[1 + floor(random() * 6)::int, 1 + floor(random() * 6)::int]);
end;
$$;

revoke execute on function snakes_spend_rollback(uuid) from public, anon;
grant  execute on function snakes_spend_rollback(uuid) to authenticated;

-- ============================================================
-- 9. add_evidence: only the current tile, in snakes
-- ============================================================
-- Body from 20261001120100, plus: in snakes the claim must be for the tile
-- the team stands on (checked with the team locked, so a roll or a punishment
-- cannot move it mid-submission), and the finishing submission calls
-- complete_snakes_tile.

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

  if not exists (select 1 from team_members
                  where team_id = v_claim.team_id and profile_id = auth.uid()) then
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

  if v_will_fire then
    if v_snakes then
      perform complete_snakes_tile(p_claim_id, false);
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

-- ============================================================
-- 10. What the board shows
-- ============================================================

create or replace function tiles_for_me(p_game_id uuid)
returns table (
  id uuid, game_id uuid, "row" smallint, col smallint, "position" smallint,
  revealed boolean, name text, icon text, required_evidence smallint,
  evidence_count integer, claim_id uuid, claim_status claim_status,
  claim_result shot_result, previewed boolean, ship_sunk boolean,
  evidence_points integer, options jsonb, description text, completion text,
  per_set smallint, claimed_by_name text, claimed_at timestamptz, paused boolean)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.game_id, t.row, t.col, t.position,
    (c.id is not null or gm.open) as revealed,
    case when c.id is not null or pv.id is not null or gm.open then t.name end as name,
    case when c.id is not null or pv.id is not null or gm.open then t.icon end as icon,
    case when c.id is not null or gm.open then t.required_evidence end as required_evidence,
    case when c.id is not null
         then (select count(*) from tile_evidence e where e.claim_id = c.id)
         else 0 end::int as evidence_count,
    c.id, c.status, c.result,
    (pv.id is not null) as previewed,
    coalesce(
      c.result = 'hit' and not exists (
        select 1
          from ship_cells hull
         where hull.ship_id = (
                 select sc.ship_id
                   from ship_cells sc
                   join teams te on te.id = sc.team_id
                  where te.game_id = t.game_id
                    and te.id <> c.team_id
                    and sc.row = t.row and sc.col = t.col
                  limit 1
               )
           and not exists (
                 select 1
                   from tiles ti2
                   join tile_claims tc2 on tc2.tile_id = ti2.id
                  where ti2.game_id = t.game_id
                    and ti2.row = hull.row and ti2.col = hull.col
                    and tc2.team_id = c.team_id
                    and tc2.status = 'fired'
                    and tc2.result = 'hit'
               )
      ),
      false
    ) as ship_sunk,
    case when c.id is not null
         then (select coalesce(sum(e.points), 0) from tile_evidence e where e.claim_id = c.id)
         else 0 end::int as evidence_points,
    case when c.id is not null or gm.open
         then (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', o.id, 'label', o.label, 'points', o.points,
                        'grp', o.grp, 'max_times', o.max_times,
                        'taken', exists (select 1 from tile_evidence e
                                          where e.claim_id = c.id and e.option_id = o.id),
                        'got', (select count(*) from tile_evidence e
                                 where e.claim_id = c.id and e.option_id = o.id)
                      ) order by o.sort, o.label), '[]'::jsonb)
                 from tile_options o where o.tile_id = t.id)
         end as options,
    case when c.id is not null or gm.open then t.description end as description,
    case when c.id is not null or gm.open then t.completion::text end as completion,
    case when c.id is not null or gm.open then t.per_set end as per_set,
    p.display_name as claimed_by_name,
    c.claimed_at,
    (c.paused_at is not null) as paused
  from tiles t
  -- Open once the game has started, not before: the card is revealed when the
  -- organiser presses Start, so nobody can plan from it during preparation.
  cross join lateral (
    select coalesce((select g.mode <> 'battleships' and g.status in ('active', 'finished')
                       from games g where g.id = p_game_id), false) as open
  ) gm
  left join tile_claims c on c.tile_id = t.id
       and c.team_id = my_team_in_game(p_game_id)
  left join profiles p on p.id = c.claimed_by
  left join pet_jar_previews pv on pv.tile_id = t.id
       and pv.team_id = my_team_in_game(p_game_id)
  where t.game_id = p_game_id
  order by t.position;
$$;

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
      else '[]'::jsonb end,
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

-- ============================================================
-- 11. Setting up, starting and ending
-- ============================================================

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
begin
  if not is_admin() then
    raise exception 'Only an admin may start the game';
  end if;

  select * into v_game from games where id = p_game_id;

  if v_game.mode in ('bingo', 'snakes') then
    -- No fleets to place, so preparation is optional: a bingo or a snakes game
    -- can start straight from setup.
    if v_game.status not in ('setup', 'placement') then
      raise exception 'Game is % — it can only be started before it runs', v_game.status;
    end if;

    select count(*) into v_teams from teams where game_id = p_game_id;
    if v_teams < 1 then
      raise exception 'Game needs at least one team before it can start';
    end if;

    select count(*) into v_tiles from tiles where game_id = p_game_id;
    if v_tiles <> v_game.grid_size * v_game.grid_size then
      raise exception 'Game needs % tiles before it can start (has %)',
        v_game.grid_size * v_game.grid_size, v_tiles;
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
          case when p_mode = 'snakes' then 10 else p_grid_size end, 1, p_ends_at)
  returning id into v_game_id;

  for v_i in 1 .. array_length(v_names, 1) loop
    insert into teams (game_id, name, slot) values (v_game_id, v_names[v_i], v_i);
  end loop;

  return v_game_id;
end;
$$;

create or replace function admin_add_team(p_game_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game games%rowtype;
  v_id   uuid;
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

  insert into teams (game_id, name, slot)
  values (p_game_id, btrim(p_name),
          coalesce((select max(slot) from teams where game_id = p_game_id), 0) + 1)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function admin_delete_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game games%rowtype;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select g.* into v_game from games g join teams t on t.game_id = g.id where t.id = p_team_id;
  if not found then raise exception 'No such team'; end if;
  if v_game.mode = 'battleships' then
    raise exception 'Battleships always has exactly two teams';
  end if;
  if v_game.status not in ('setup', 'placement') then
    raise exception 'Teams can only be removed before the game starts';
  end if;
  delete from teams where id = p_team_id;
end;
$$;

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

-- The snakes for a game, all at once: a JSON array of {"from": head, "to": tail}.
-- Replaces whatever was there. Only before the game starts.
create function admin_set_snakes(p_game_id uuid, p_snakes jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game games%rowtype;
  v_el   jsonb;
  v_from int;
  v_to   int;
  v_n    int := 0;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into v_game from games where id = p_game_id;
  if not found then raise exception 'No such game'; end if;
  if v_game.mode <> 'snakes' then
    raise exception 'Only a Snakes and Ladders game has snakes';
  end if;
  if v_game.status not in ('setup', 'placement') then
    raise exception 'The snakes are fixed once the game starts';
  end if;
  if p_snakes is null or jsonb_typeof(p_snakes) <> 'array' then
    raise exception 'Send the snakes as a list';
  end if;

  delete from board_jumps where game_id = p_game_id;

  for v_el in select * from jsonb_array_elements(p_snakes) loop
    v_from := (v_el ->> 'from')::int;
    v_to   := (v_el ->> 'to')::int;
    if v_from is null or v_to is null then
      raise exception 'Every snake needs a head and a tail';
    end if;
    if v_from not between 2 and 99 then
      raise exception 'A snake''s head goes on tile 2 to 99 (not %)', v_from;
    end if;
    if v_to < 1 or v_to >= v_from then
      raise exception 'The snake on tile % must go down, to a tile from 1 to %', v_from, v_from - 1;
    end if;
    if exists (select 1 from board_jumps where game_id = p_game_id and from_tile = v_from) then
      raise exception 'Two snakes start on tile %', v_from;
    end if;
    insert into board_jumps (game_id, from_tile, to_tile) values (p_game_id, v_from, v_to);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

revoke execute on function admin_set_snakes(uuid, jsonb) from public, anon;
grant  execute on function admin_set_snakes(uuid, jsonb) to authenticated;

-- End a running game early: the team furthest along wins. The console shows
-- the organiser who that is first and sends it back here; if the standings
-- moved in between, nothing happens and the organiser looks again.
create function admin_snakes_end_game(p_game_id uuid, p_winner_team_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game games%rowtype;
  v_lead uuid;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into v_game from games where id = p_game_id for update;
  if not found then raise exception 'No such game'; end if;
  if v_game.mode <> 'snakes' then
    raise exception 'That is not a Snakes and Ladders game';
  end if;
  if v_game.status <> 'active' then
    raise exception 'The game is % — it is not running', v_game.status;
  end if;

  -- Nobody wins a race nobody started.
  select s.team_id into v_lead
    from snakes_standings(p_game_id) s
   where s.board_tile > 0
   order by s.place limit 1;

  if v_lead is distinct from p_winner_team_id then
    raise exception 'The standings changed — % is in front now. Check again before ending.',
      coalesce((select name from teams where id = v_lead), 'nobody');
  end if;

  return finish_snakes(p_game_id, 'admin', v_lead);
end;
$$;

revoke execute on function admin_snakes_end_game(uuid, uuid) from public, anon;
grant  execute on function admin_snakes_end_game(uuid, uuid) to authenticated;

-- ============================================================
-- 12. Organiser controls during a snakes game
-- ============================================================

create function admin_snakes_punish(p_team_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return snakes_move(p_team_id, 'punish', array[1 + floor(random() * 6)::int]);
end;
$$;

revoke execute on function admin_snakes_punish(uuid) from public, anon;
grant  execute on function admin_snakes_punish(uuid) to authenticated;

create function admin_snakes_move(p_team_id uuid, p_tile integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return snakes_move(p_team_id, 'move', null, p_tile);
end;
$$;

revoke execute on function admin_snakes_move(uuid, integer) from public, anon;
grant  execute on function admin_snakes_move(uuid, integer) to authenticated;

-- Give rollbacks, or take them back with a negative amount (never below 0).
create function admin_snakes_give_rollback(p_team_id uuid, p_amount integer default 1)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_game games%rowtype;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into v_team from teams where id = p_team_id for update;
  if not found then raise exception 'No such team'; end if;
  select * into v_game from games where id = v_team.game_id;
  if v_game.mode <> 'snakes' then
    raise exception 'Only a Snakes and Ladders team has rollbacks';
  end if;
  if v_game.status = 'finished' then
    raise exception 'The game is over';
  end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 10 then
    raise exception 'Give 1 to 10 rollbacks, or take back up to 10';
  end if;
  if v_team.rollbacks_available + p_amount < 0 then
    raise exception '% only has % rollback(s)', v_team.name, v_team.rollbacks_available;
  end if;

  update teams set rollbacks_available = rollbacks_available + p_amount
   where id = p_team_id
  returning * into v_team;

  insert into game_events (game_id, team_id, type, payload)
  values (v_game.id, p_team_id, 'rollback_gained',
          jsonb_build_object('mode',                'snakes',
                             'reason',              'admin',
                             'amount',              p_amount,
                             'rollbacks_available', v_team.rollbacks_available,
                             'by',                  auth.uid(),
                             'by_name',             (select display_name from profiles
                                                      where id = auth.uid())));
  return v_team.rollbacks_available;
end;
$$;

revoke execute on function admin_snakes_give_rollback(uuid, integer) from public, anon;
grant  execute on function admin_snakes_give_rollback(uuid, integer) to authenticated;

-- "Complete tile now": the team's current tile counts as done, whatever its
-- evidence says. Locks the claim before the team, the same order add_evidence
-- takes them in.
create function admin_snakes_complete_tile(p_team_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team  teams%rowtype;
  v_game  games%rowtype;
  v_tile  uuid;
  v_claim tile_claims%rowtype;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into v_team from teams where id = p_team_id;
  if not found then raise exception 'No such team'; end if;
  select * into v_game from games where id = v_team.game_id;
  if v_game.mode <> 'snakes' then
    raise exception 'That team is not in a Snakes and Ladders game';
  end if;
  if v_game.status <> 'active' then
    raise exception 'The game is % — nothing to complete now', v_game.status;
  end if;
  if v_team.board_tile < 1 then
    raise exception '% has not left Start yet', v_team.name;
  end if;

  select t.id into v_tile from tiles t
   where t.game_id = v_game.id and t.position = v_team.board_tile;
  if v_tile is null then
    raise exception 'Tile % is missing from the board', v_team.board_tile;
  end if;

  insert into tile_claims (team_id, tile_id, claimed_by)
  values (p_team_id, v_tile, auth.uid())
  on conflict (team_id, tile_id) do nothing;

  select * into v_claim from tile_claims
   where team_id = p_team_id and tile_id = v_tile for update;

  select * into v_team from teams where id = p_team_id for update;
  if (select t.position from tiles t where t.id = v_tile) <> v_team.board_tile then
    raise exception '% moved while this was happening — try again', v_team.name;
  end if;
  if v_claim.status = 'completed' then
    raise exception '% has already completed tile %', v_team.name, v_team.board_tile;
  end if;

  perform complete_snakes_tile(v_claim.id, true);
  return v_claim.id;
end;
$$;

revoke execute on function admin_snakes_complete_tile(uuid) from public, anon;
grant  execute on function admin_snakes_complete_tile(uuid) to authenticated;

-- Undo a completion: the tile is open again for that team, its evidence kept.
create function admin_snakes_uncomplete_tile(p_team_id uuid, p_tile integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team   teams%rowtype;
  v_game   games%rowtype;
  v_tile   tiles%rowtype;
  v_claim  tile_claims%rowtype;
  v_effect text;
  v_out    jsonb;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into v_team from teams where id = p_team_id;
  if not found then raise exception 'No such team'; end if;
  select * into v_game from games where id = v_team.game_id;
  if v_game.mode <> 'snakes' then
    raise exception 'That team is not in a Snakes and Ladders game';
  end if;
  if v_game.status not in ('active', 'finished') then
    raise exception 'The game has not started';
  end if;

  select t.* into v_tile from tiles t where t.game_id = v_game.id and t.position = p_tile;
  if not found then raise exception 'There is no tile %', p_tile; end if;

  select * into v_claim from tile_claims
   where team_id = p_team_id and tile_id = v_tile.id for update;
  if not found or v_claim.status <> 'completed' then
    raise exception '% has not completed tile %', v_team.name, p_tile;
  end if;

  update tile_claims
     set status = 'active', completed_early = false, fired_by = null, fired_at = null
   where id = v_claim.id;

  v_effect := snakes_after_uncomplete(v_game.id, p_team_id, p_tile);

  v_out := jsonb_build_object('mode',           'snakes',
                              'position',       p_tile,
                              'tile_name',      v_tile.name,
                              'was_early',      v_claim.completed_early,
                              'game_reopened',  coalesce(v_effect = 'reopened', false),
                              'winner_changed', coalesce(v_effect = 'winner_changed', false),
                              'by',             auth.uid(),
                              'by_name',        (select display_name from profiles
                                                  where id = auth.uid()));

  insert into game_events (game_id, team_id, type, payload)
  values (v_game.id, p_team_id, 'tile_reopened', v_out);

  return v_out;
end;
$$;

revoke execute on function admin_snakes_uncomplete_tile(uuid, integer) from public, anon;
grant  execute on function admin_snakes_uncomplete_tile(uuid, integer) to authenticated;

-- ============================================================
-- 13. Reset and revoke
-- ============================================================
-- admin_reset_game: body from 20261001120100, plus every team back to Start
-- with no rollbacks. The snakes stay where the organiser put them.
--
-- admin_revoke_evidence: snakes takes bingo's branch. A tile the organiser
-- completed early stays complete whatever evidence is withdrawn from it, and
-- what happens to a finished game is snakes_after_uncomplete's call.

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
  if v_game.mode in ('bingo', 'snakes') then
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

-- ============================================================
-- 14. Discord
-- ============================================================

-- The snakes lines. Null for anything else, so discord_line falls through to
-- the shared wording (evidence submitted, evidence withdrawn, ...).
create function snakes_discord_line(p_event game_events, p_team text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p       jsonb := p_event.payload;
  v_from  text;
  v_to    text;
  v_extra text := '';
  v_jump  jsonb;
  v_n     int;
begin
  if p_event.type = 'game_started' then
    return ':snake: **Snakes and Ladders has begun!** Every team starts before tile 1 — roll to get going.';
  elsif p_event.type = 'game_reset' then
    return 'Snakes and Ladders has been reset — every team is back at Start.';

  elsif p_event.type = 'team_moved' then
    v_from := case when (p ->> 'from')::int = 0 then 'Start' else 'tile ' || (p ->> 'from') end;
    v_to   := case when (p ->> 'to')::int = 0 then 'Start'
                   else '**tile ' || (p ->> 'to') || '**'
                        || coalesce(' (' || (p ->> 'tile_name') || ')', '') end;

    if (p ->> 'bounced')::boolean then
      v_extra := v_extra || format(' Overshot 100 and bounced back to %s.', p ->> 'landed');
    end if;
    if not coalesce((p ->> 'long_skip')::boolean, false)
       and jsonb_array_length(coalesce(p -> 'skipped', '[]'::jsonb)) > 0 then
      v_extra := v_extra || format(' Skipped %s, already done.',
        (select string_agg(x, ', ') from jsonb_array_elements_text(p -> 'skipped') as x));
    end if;
    for v_jump in select * from jsonb_array_elements(coalesce(p -> 'jumps', '[]'::jsonb)) loop
      v_extra := v_extra || format(' :snake: Snake on %s, down to %s.', v_jump ->> 'from', v_jump ->> 'to');
    end loop;
    if (p ->> 'to')::int = 100 then
      v_extra := v_extra || ' :dart: **Tile 100** — finish it to win!';
    end if;

    return case p ->> 'kind'
      when 'roll' then
        case when (p ->> 'long_skip')::boolean
             then format(':fast_forward: **%s** skipped from %s to %s — the next six tiles were all done or snake heads.',
                         p_team, v_from, v_to)
             else format(':game_die: **%s** rolled a **%s**: %s → %s.', p_team, p -> 'dice' ->> 0, v_from, v_to)
        end
      when 'rollback' then
        format(':rewind: **%s** used a rollback and went back %s: %s → %s. %s rollback(s) left.',
               p_team, p ->> 'steps', v_from, v_to, p ->> 'rollbacks_available')
      when 'punish' then
        format(':warning: An organiser punished **%s**: back %s, %s → %s.', p_team, p ->> 'steps', v_from, v_to)
      else
        format(':arrow_right: An organiser moved **%s** to %s.', p_team, v_to)
    end || case when p ->> 'kind' = 'move' then '' else v_extra end;

  elsif p_event.type = 'rollback_gained' then
    v_n := (p ->> 'amount')::int;
    return case
      when p ->> 'reason' = 'auto' then
        format(':game_die: **%s** earned a rollback for finishing tile %s — %s available.',
               p_team, p ->> 'tile', p ->> 'rollbacks_available')
      when v_n < 0 then
        format('An organiser took %s rollback(s) from **%s** — %s left.',
               -v_n, p_team, p ->> 'rollbacks_available')
      else
        format('An organiser gave **%s** %s rollback(s) — %s available.',
               p_team, v_n, p ->> 'rollbacks_available')
    end;

  elsif p_event.type = 'tile_reopened' then
    return format(':leftwards_arrow_with_hook: An organiser reopened tile %s%s for **%s** — it is no longer complete.',
                  p ->> 'position', coalesce(' (**' || (p ->> 'tile_name') || '**)', ''), p_team)
      || case when (p ->> 'game_reopened')::boolean then ' **The game has been reopened.**' else '' end
      || case when (p ->> 'winner_changed')::boolean then ' **The winner has changed.**' else '' end;

  elsif p_event.type = 'tile_completed' then
    return format(':white_check_mark: **%s** completed tile %s, **%s**.%s',
                  p_team, p ->> 'position', coalesce(p ->> 'tile_name', 'a tile'),
                  case when (p ->> 'early')::boolean then ' (Marked complete by an organiser.)' else '' end);

  elsif p_event.type = 'game_ended' then
    return case
      when p ->> 'reason' = 'won' then
        format(':trophy: **%s** completed tile 100 and wins Snakes and Ladders!', p_team)
      when p_event.team_id is null then
        'The organiser ended the game. No team had left Start, so nobody wins.'
      else
        format('The organiser ended the game. :trophy: **%s** wins — furthest along, on tile %s.',
               p_team, p ->> 'tile')
    end;
  end if;

  return null;
end;
$$;

revoke execute on function snakes_discord_line(game_events, text) from public, anon, authenticated;

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

  if v_pos is not null then
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
