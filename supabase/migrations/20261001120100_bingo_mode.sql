-- Game modes: battleships, and now bingo.
--
-- The platform was one game. Most of it never cared which: accounts, teams,
-- tiles and their five completion rules, evidence, the catalogue, the feed and
-- the Discord relay are all "teams finish tile tasks with screenshots". What
-- happens AFTER a tile is finished is the game. Battleships fires a shot at the
-- enemy fleet; bingo just marks the square done.
--
-- So `games.mode` picks the game, every existing game is `battleships`, and the
-- battleships-only rules below learn to stand aside for bingo:
--
--   rule                                  battleships         bingo
--   ------------------------------------  ------------------  -----------------
--   teams per game                        exactly two         one or more
--   tile content                          secret until claim  open once started
--   lock a tile in first (claim_tile)     yes, max N active   no -- just submit
--   finishing a tile                      fires a shot        status 'completed'
--   score                                 hits                tiles completed
--   game ends                             a fleet is sunk     full card, timer,
--                                                             or the organiser
--
-- BINGO HAS NO CLAIMS -- for the player. The database still keeps one
-- `tile_claims` row per team per tile, because evidence, progress and the
-- completion rules all hang off that row. `bingo_open_tile` creates it silently
-- (no event, no slot, no limit) the first time a team submits against a tile.
--
-- THE TIMER. There is no scheduler on this project (no pg_cron), so nothing can
-- flip a game to finished at the stroke of `ends_at`. It does not need to:
-- `add_evidence` and `bingo_open_tile` refuse anything after `ends_at`, which
-- fixes the result at that instant, and `bingo_settle` -- which any player's
-- page calls when its countdown reaches zero -- records the winner afterwards.
-- The winner is the same whenever that call lands.
--
-- Ties: most tiles wins; equal counts go to the team that reached its count
-- first.
--
-- The 10-column `tiles.position` (generated, `(row-1)*10 + col`) is why a
-- bingo card is capped at 10x10. Every card up to that size fits it unchanged,
-- and so does every coordinate label built from it, here and in the client.

-- ============================================================
-- 1. games: mode, end time, how it ended
-- ============================================================

create type game_mode as enum ('battleships', 'bingo');

alter table games
  add column mode         game_mode   not null default 'battleships',
  add column ends_at      timestamptz,
  add column ended_reason text
    check (ended_reason is null or ended_reason in ('full_card', 'time_up', 'admin'));

comment on column games.mode is
  'Which game this is. Everything created before 20261001 is battleships.';
comment on column games.ends_at is
  'Bingo only: submissions are refused from this moment. Null = no timer.';
comment on column games.ended_reason is
  'Bingo only: full_card, time_up or admin. Null while running, and on battleships.';

-- Bingo cards can be small. Positions are 10 columns wide, so nothing in bingo
-- may be wider than 10.
alter table games drop constraint games_grid_size_check;
alter table games add constraint games_grid_size_check
  check (grid_size between 3 and 26 and (mode <> 'bingo' or grid_size <= 10));

-- ============================================================
-- 2. teams: any number in bingo
-- ============================================================

alter table teams drop constraint teams_slot_check;
alter table teams add constraint teams_slot_check check (slot >= 1);

create or replace function enforce_two_teams()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select mode from games where id = new.game_id) = 'bingo' then
    return new;
  end if;
  if (select count(*) from teams where game_id = new.game_id) >= 2 then
    raise exception 'Game % already has two teams', new.game_id;
  end if;
  return new;
end;
$$;

-- ============================================================
-- 3. tile_claims: a third state, and the two triggers
-- ============================================================

alter table tile_claims drop constraint fired_rows_complete;
alter table tile_claims add constraint fired_rows_complete check (
     (status = 'active'    and result is null     and fired_at is null)
  or (status = 'fired'     and result is not null and fired_at is not null)
  or (status = 'completed' and result is null     and fired_at is not null)
);

comment on column tile_claims.fired_at is
  'When the tile was finished: fired (battleships) or completed (bingo).';

-- No slots in bingo: every tile is open at once.
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

  if v_mode = 'bingo' then
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

-- Finishing a tile, either way, needs the tile to actually be finished.
create or replace function enforce_evidence_before_fire()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'active' or old.status = new.status then
    return new;
  end if;

  if not claim_is_complete(new.id) then
    raise exception 'This tile is not finished yet';
  end if;

  return new;
end;
$$;

-- ============================================================
-- 4. Standings
-- ============================================================
-- One row per team, in finishing order. `completed_tile_ids` lets a player
-- look at another team's card: which squares are done is not a secret in
-- bingo (claims were always world-readable, and the card is open).

create function bingo_standings(p_game_id uuid)
returns table (
  team_id            uuid,
  team_name          text,
  slot               smallint,
  tiles_completed    integer,
  tiles_total        integer,
  last_completed_at  timestamptz,
  completed_tile_ids uuid[],
  place              integer
)
language sql
stable
security definer
set search_path = public
as $$
  with done as (
    select te.id, te.name, te.slot,
           count(c.id)::int as n,
           max(c.fired_at)  as last_at,
           coalesce(array_agg(c.tile_id order by c.fired_at)
                      filter (where c.id is not null), '{}'::uuid[]) as ids
      from teams te
      left join tile_claims c on c.team_id = te.id and c.status = 'completed'
     where te.game_id = p_game_id
     group by te.id, te.name, te.slot
  )
  select d.id, d.name, d.slot, d.n,
         (select count(*)::int from tiles t where t.game_id = p_game_id),
         d.last_at, d.ids,
         (row_number() over (order by d.n desc, d.last_at asc nulls last, d.slot))::int
    from done d
   order by 8;
$$;

revoke execute on function bingo_standings(uuid) from public, anon;
grant  execute on function bingo_standings(uuid) to authenticated;

-- ============================================================
-- 5. Ending a bingo game
-- ============================================================
-- Internal. The one place a bingo game finishes, whichever of the three ways
-- it happens, so the winner is always chosen by the same ordering the
-- standings show.

create function finish_bingo(p_game_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game   games%rowtype;
  v_winner uuid;
  v_count  int;
begin
  select * into v_game from games where id = p_game_id for update;
  if not found or v_game.mode <> 'bingo' or v_game.status <> 'active' then
    return null;
  end if;

  -- Nobody wins a game in which nothing was finished.
  select s.team_id, s.tiles_completed into v_winner, v_count
    from bingo_standings(p_game_id) s
   where s.tiles_completed > 0
   order by s.place
   limit 1;

  update games
     set status         = 'finished',
         winner_team_id = v_winner,
         ended_reason   = p_reason,
         -- A timer that ran out ended the game at the time it was set for, not
         -- whenever the first page noticed.
         ended_at       = case when p_reason = 'time_up'
                               then coalesce(v_game.ends_at, now()) else now() end
   where id = p_game_id;

  insert into game_events (game_id, team_id, type, payload)
  values (p_game_id, v_winner, 'game_ended',
          jsonb_build_object('reason',          p_reason,
                             'winner_team_id',  v_winner,
                             'tiles_completed', coalesce(v_count, 0),
                             'tiles_total',     v_game.grid_size * v_game.grid_size));

  return v_winner;
end;
$$;

revoke execute on function finish_bingo(uuid, text) from public, anon, authenticated;

-- Internal: called by add_evidence once a bingo tile meets its rule.
create function complete_bingo_tile(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim tile_claims%rowtype;
  v_tile  tiles%rowtype;
  v_done  int;
  v_total int;
begin
  -- The claims_need_evidence trigger re-checks claim_is_complete on this
  -- transition, as it does for a battleships shot.
  update tile_claims
     set status = 'completed', fired_by = auth.uid(), fired_at = now()
   where id = p_claim_id and status = 'active'
  returning * into v_claim;
  if not found then return; end if;

  select * into v_tile from tiles where id = v_claim.tile_id;

  select count(*)::int into v_done
    from tile_claims c join tiles t on t.id = c.tile_id
   where c.team_id = v_claim.team_id and c.status = 'completed'
     and t.game_id = v_tile.game_id;
  select count(*)::int into v_total from tiles where game_id = v_tile.game_id;

  -- Public. The card is open in bingo, so the tile name is no secret.
  insert into game_events (game_id, team_id, type, payload)
  values (v_tile.game_id, v_claim.team_id, 'tile_completed',
          jsonb_build_object('tile_id',         v_tile.id,
                             'position',        v_tile.position,
                             'tile_name',       v_tile.name,
                             'by',              auth.uid(),
                             'by_name',         (select display_name from profiles
                                                  where id = auth.uid()),
                             'tiles_completed', v_done,
                             'tiles_total',     v_total));

  if v_done >= v_total then
    perform finish_bingo(v_tile.game_id, 'full_card');
  end if;
end;
$$;

revoke execute on function complete_bingo_tile(uuid) from public, anon, authenticated;

-- ============================================================
-- 6. What a bingo player calls
-- ============================================================

-- The team's progress row for a tile, made on first use. The client needs its
-- id before uploading, because the storage path is {game}/{team}/{claim}/...
create function bingo_open_tile(p_tile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tile tiles%rowtype;
  v_game games%rowtype;
  v_team uuid;
  v_id   uuid;
begin
  select * into v_tile from tiles where id = p_tile_id;
  if not found then raise exception 'No such tile'; end if;

  select * into v_game from games where id = v_tile.game_id;
  if v_game.mode <> 'bingo' then
    raise exception 'Battleships tiles are locked in, not opened';
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

  insert into tile_claims (team_id, tile_id, claimed_by)
  values (v_team, p_tile_id, auth.uid())
  on conflict (team_id, tile_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from tile_claims
     where team_id = v_team and tile_id = p_tile_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function bingo_open_tile(uuid) from public, anon;
grant  execute on function bingo_open_tile(uuid) to authenticated;

-- Record the result of a game whose timer has run out. Safe for anyone to call
-- at any time: before the deadline, or on a game already settled, it does
-- nothing.
create function bingo_settle(p_game_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game games%rowtype;
begin
  select * into v_game from games where id = p_game_id;
  if not found or v_game.mode <> 'bingo' or v_game.status <> 'active'
     or v_game.ends_at is null or now() < v_game.ends_at then
    return false;
  end if;

  perform finish_bingo(p_game_id, 'time_up');
  return true;
end;
$$;

revoke execute on function bingo_settle(uuid) from public, anon;
grant  execute on function bingo_settle(uuid) to authenticated;

-- ============================================================
-- 7. add_evidence: complete instead of fire, in bingo
-- ============================================================
-- Body from 20260918163924 / live, plus: the game must be running and inside
-- its timer, a completed tile takes nothing more, and the finishing submission
-- calls complete_bingo_tile rather than fire_tile. Returns `completed` on both
-- modes, so the client can stop a batch the moment the tile is done.

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
  v_bingo     boolean;
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
  v_bingo := v_game.mode = 'bingo';

  if v_bingo then
    if v_game.status <> 'active' then
      raise exception 'The game is % — no submissions now', v_game.status;
    end if;
    if v_game.ends_at is not null and now() >= v_game.ends_at then
      raise exception 'Time is up — no more submissions';
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
  if not v_bingo then
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
    if v_bingo then
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
-- 8. Battleships-only actions refuse bingo
-- ============================================================
-- claim_tile and fire_tile: bodies verbatim from live, plus the guard.

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

  if (select mode from games where id = v_tile.game_id) = 'bingo' then
    raise exception 'Bingo tiles need no lock-in — just submit your evidence';
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

  if (select mode from games where id = v_game_id) = 'bingo' then
    raise exception 'Bingo tiles are completed, not fired';
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

-- ============================================================
-- 9. tiles_for_me: the whole card is open in bingo
-- ============================================================
-- Body verbatim from live, with every "has my team claimed it" gate on tile
-- content widened to "... or this is a bingo game that has started".
-- `revealed` follows the same rule, so it keeps meaning "the content is
-- visible to me".

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
    select coalesce((select g.mode = 'bingo' and g.status in ('active', 'finished')
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

-- ============================================================
-- 10. board_for_me: standings for bingo
-- ============================================================
-- Body verbatim from live, plus a `standings` key on bingo games.

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
    'standings', case when v_mode = 'bingo' then coalesce((
      select jsonb_agg(to_jsonb(s) order by s.place) from bingo_standings(p_game_id) s
    ), '[]'::jsonb) else '[]'::jsonb end,
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
-- 11. start_game: bingo needs tiles and players, nothing else
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

  if v_game.mode = 'bingo' then
    -- No fleets to place, so preparation is optional: a bingo can start
    -- straight from setup.
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

    update games set status = 'active', started_at = now() where id = p_game_id;

    insert into game_events (game_id, type, payload)
    values (p_game_id, 'game_started',
            jsonb_build_object('by', auth.uid(), 'mode', 'bingo'));
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

-- ============================================================
-- 12. Organiser actions for bingo
-- ============================================================

-- Creating a game of either mode. admin_create_game stays as it was, for a
-- console that has not been redeployed yet; this one is what the new console
-- calls.
create function admin_new_game(
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

  if coalesce(array_length(v_names, 1), 0) < 1 then
    raise exception 'A bingo needs at least one team';
  end if;
  if (select count(distinct lower(u.n)) from unnest(v_names) as u(n)) <> array_length(v_names, 1) then
    raise exception 'Every team needs a different name';
  end if;
  if p_grid_size is null or p_grid_size < 3 or p_grid_size > 10 then
    raise exception 'A bingo card is 3x3 to 10x10';
  end if;
  if p_ends_at is not null and p_ends_at <= now() then
    raise exception 'The end time is in the past';
  end if;

  insert into games (name, mode, status, grid_size, max_active_tiles, ends_at)
  values (btrim(p_name), 'bingo', 'setup', p_grid_size, 1, p_ends_at)
  returning id into v_game_id;

  for v_i in 1 .. array_length(v_names, 1) loop
    insert into teams (game_id, name, slot) values (v_game_id, v_names[v_i], v_i);
  end loop;

  return v_game_id;
end;
$$;

revoke execute on function admin_new_game(text, game_mode, text[], smallint, timestamptz) from public, anon;
grant  execute on function admin_new_game(text, game_mode, text[], smallint, timestamptz) to authenticated;

-- Teams come and go until the game is over. A team added mid-game simply
-- starts with nothing done.
create function admin_add_team(p_game_id uuid, p_name text)
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
  if v_game.mode <> 'bingo' then
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

revoke execute on function admin_add_team(uuid, text) from public, anon;
grant  execute on function admin_add_team(uuid, text) to authenticated;

-- Only before the game runs: once it has, a team's finished tiles are part of
-- the result, and deleting the team would quietly rewrite the standings.
create function admin_delete_team(p_team_id uuid)
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
  if v_game.mode <> 'bingo' then
    raise exception 'Battleships always has exactly two teams';
  end if;
  if v_game.status not in ('setup', 'placement') then
    raise exception 'Teams can only be removed before the game starts';
  end if;
  delete from teams where id = p_team_id;
end;
$$;

revoke execute on function admin_delete_team(uuid) from public, anon;
grant  execute on function admin_delete_team(uuid) to authenticated;

create function admin_set_end_time(p_game_id uuid, p_ends_at timestamptz)
returns void
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
  if v_game.mode <> 'bingo' then
    raise exception 'Only a bingo has an end time';
  end if;
  if v_game.status = 'finished' then
    raise exception 'The game is over';
  end if;
  -- Ending a running game is its own button, so it says what it does.
  if p_ends_at is not null and p_ends_at <= now() then
    raise exception 'The end time is in the past — use "End game now" to end it';
  end if;
  update games set ends_at = p_ends_at where id = p_game_id;
end;
$$;

revoke execute on function admin_set_end_time(uuid, timestamptz) from public, anon;
grant  execute on function admin_set_end_time(uuid, timestamptz) to authenticated;

create function admin_end_game(p_game_id uuid)
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

revoke execute on function admin_end_game(uuid) from public, anon;
grant  execute on function admin_end_game(uuid) to authenticated;

-- ============================================================
-- 13. admin_reset_game: forget how it ended, and say which game it was
-- ============================================================
-- Body verbatim from live, plus `ended_reason` and `mode` in the payload, so
-- the feed and Discord do not tell a bingo its fleets need placing.

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

-- ============================================================
-- 14. admin_revoke_evidence: un-complete a bingo tile
-- ============================================================
-- Body verbatim from live for battleships. A bingo revoke is simpler and gets
-- its own branch: no shot, no ship, no ring, no slot to park. A tile that no
-- longer meets its rule goes back to active, and the result follows it:
--
--   * a game won on a FULL CARD that is no longer full reopens, unless its
--     timer has also run out -- then it stays finished, re-ranked;
--   * a game that ended on time or by the organiser stays finished, and its
--     winner is re-read from the standings.

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
  if v_game.mode = 'bingo' then
    v_was_done := v_claim.status = 'completed';

    begin
      delete from tile_evidence where id = p_evidence_id;

      select count(*), coalesce(sum(points), 0)
        into v_left, v_points
        from tile_evidence where claim_id = v_claim.id;

      v_still := claim_is_complete(v_claim.id);

      if v_was_done and not v_still then
        v_undone := true;

        update tile_claims
           set status = 'active', fired_by = null, fired_at = null
         where id = v_claim.id;

        if v_game.status = 'finished' then
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
        'mode',              'bingo',
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
-- 15. discord_line: the bingo lines
-- ============================================================
-- Body verbatim from 20260928120000, plus tile_completed and game_ended, and
-- bingo wording for game_started, game_reset and evidence_revoked.

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
begin
  select name into v_team from teams where id = p_event.team_id;
  v_team := coalesce(v_team, 'Someone');
  v_who  := coalesce(p_event.payload ->> 'uploaded_by_name', v_team);

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

revoke execute on function discord_line(game_events) from public, anon, authenticated;
