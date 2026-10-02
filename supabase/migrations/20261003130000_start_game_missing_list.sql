-- High Society Events -- a readable "squares missing" list when a snakes game
-- cannot start.
--
-- 20261003120000_snakes_ladders built the list of empty squares with
-- left(string_agg(...), 120), which cut it at 120 characters wherever that
-- fell: an empty board read "... 31, 32, 3)" -- a square that does not exist,
-- and no sign the list went on. The smoke test run of 2026-10-02 showed it.
--
-- Now the first 20 squares are named and an ellipsis says there are more:
-- "100 missing (1, 2, ..., 20, …)". The count in front was always right.
--
-- Only that select changes; the rest of start_game is copied unchanged from
-- 20261003120000_snakes_ladders. CREATE OR REPLACE keeps the grants.

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
