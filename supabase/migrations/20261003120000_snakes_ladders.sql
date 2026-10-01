-- High Society Events -- Snakes and Ladders, part 2: ladders.
--
-- 1. LADDERS. A row in board_jumps going UP is a ladder. The movement code
--    always said "jumps", so the table needs only its check relaxed; the
--    rest is the long skip, the organiser's Move, and the Discord wording.
--
-- 2. EACH SNAKE OR LADDER TAKES A TEAM AT MOST ONCE PER MOVE. Before this, a
--    team that had finished every tile from a snake's tail up to its head
--    would slide down, skip forward past its finished tiles onto the same
--    head, and go round until snakes_move gave up with an error -- the roll
--    failed. Now a snake or ladder already taken this move is passed over.
--
-- 3. NO TASK ON A SNAKE HEAD OR A LADDER'S FOOT. Landing there moves the team
--    on straight away, so nobody ever stands on one; the game now starts
--    without tiles there (tiles left there anyway are simply never used).
--
-- 4. CIRCLES ARE REFUSED when the organiser places them: a ladder up to 40
--    and a snake from 40 back to the ladder's foot would otherwise be found
--    by a team mid-game.

-- ============================================================
-- 1. The table
-- ============================================================
alter table board_jumps drop constraint board_jumps_snakes_only;
alter table board_jumps add constraint board_jumps_shape
  check (from_tile between 1 and 99 and to_tile between 1 and 100 and to_tile <> from_tile);

comment on table board_jumps is
  'Snakes and Ladders: landing on from_tile moves a team to to_tile. Down = snake, up = ladder.';

-- ============================================================
-- 2. Moving
-- ============================================================
create or replace function snakes_move(p_team_id uuid, p_kind text, p_dice int[] default null,
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
  v_heads   int[];   -- where every snake and ladder starts
  v_snakes  int[];   -- snake heads only
  v_used    int[] := '{}';  -- snakes and ladders already taken this move
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

  select coalesce(array_agg(j.from_tile::int order by j.from_tile), '{}') into v_snakes
    from board_jumps j where j.game_id = v_game.id and j.to_tile < j.from_tile;

  v_from := v_team.board_tile;

  if p_kind = 'roll' then
    if v_from >= 1 and not (v_from = any(v_done)) then
      raise exception 'Finish tile % before rolling again', v_from;
    end if;
    v_steps := p_dice[1];

    if v_from + 6 <= 100 and not exists (
         select 1 from generate_series(v_from + 1, v_from + 6) as s(t)
          where not (s.t = any(v_done)) and not (s.t = any(v_snakes))
       ) then
      select min(s.t) into v_land
        from generate_series(v_from + 1, 100) as s(t)
       where not (s.t = any(v_done)) and not (s.t = any(v_snakes));
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
    if p_target = any(v_snakes) then
      raise exception 'Tile % is a snake head — pick another tile', p_target;
    end if;
    if p_target = any(v_heads) then
      raise exception 'Tile % is the bottom of a ladder — pick another tile', p_target;
    end if;
    v_land := p_target;
    v_t    := p_target;
  end if;

  if not v_long and v_t > v_land then
    select array_agg(s.t order by s.t) into v_skipped
      from generate_series(v_land, v_t - 1) as s(t);
  end if;

  if p_kind <> 'move' then
    -- Each snake or ladder takes a team at most once per move; after that
    -- its start is passed over like a finished tile. Without this, a team
    -- that has finished every tile from a snake's tail up to its head slides
    -- down, skips back up to the same head, and goes round for ever.
    while v_t = any(v_heads) and not (v_t = any(v_used)) loop
      v_guard := v_guard + 1;
      if v_guard > 100 then
        raise exception 'The jumps on this board go round in a circle';
      end if;
      select j.to_tile into v_dest from board_jumps j
       where j.game_id = v_game.id and j.from_tile = v_t;
      v_used  := v_used || v_t;
      v_after := snakes_shift(v_dest, 100, v_done || v_used,
                   array(select unnest(v_heads) except select unnest(v_used)));
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
-- 3. Placing snakes and ladders
-- ============================================================
-- The snakes and ladders for a game, all at once: a JSON array of
-- {"from": start, "to": end}. Going down is a snake, going up is a ladder.
-- Replaces whatever was there. Only before the game starts.
--
-- One may end where another starts (a chain), but never in a circle -- a
-- ladder up to 40 and a snake from 40 back to the ladder's foot is refused
-- here rather than discovered by a team mid-game.
create or replace function admin_set_snakes(p_game_id uuid, p_snakes jsonb)
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
  v_j    record;
  v_t    int;
  v_hops int;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into v_game from games where id = p_game_id;
  if not found then raise exception 'No such game'; end if;
  if v_game.mode <> 'snakes' then
    raise exception 'Only a Snakes and Ladders game has snakes and ladders';
  end if;
  if v_game.status not in ('setup', 'placement') then
    raise exception 'The snakes and ladders are fixed once the game starts';
  end if;
  if p_snakes is null or jsonb_typeof(p_snakes) <> 'array' then
    raise exception 'Send the snakes and ladders as a list';
  end if;

  delete from board_jumps where game_id = p_game_id;

  for v_el in select * from jsonb_array_elements(p_snakes) loop
    v_from := (v_el ->> 'from')::int;
    v_to   := (v_el ->> 'to')::int;
    if v_from is null or v_to is null then
      raise exception 'Every snake and ladder needs a start and an end';
    end if;
    if v_from not between 1 and 99 then
      raise exception 'A snake or ladder starts on tile 1 to 99 (not %)', v_from;
    end if;
    if v_to not between 1 and 100 then
      raise exception 'A snake or ladder ends on tile 1 to 100 (not %)', v_to;
    end if;
    if v_to = v_from then
      raise exception 'The snake or ladder on tile % goes nowhere', v_from;
    end if;
    if exists (select 1 from board_jumps where game_id = p_game_id and from_tile = v_from) then
      raise exception 'Two snakes or ladders start on tile %', v_from;
    end if;
    insert into board_jumps (game_id, from_tile, to_tile) values (p_game_id, v_from, v_to);
    v_n := v_n + 1;
  end loop;

  -- Follow each one down its chain; a chain longer than the board is a circle.
  for v_j in select from_tile, to_tile from board_jumps where game_id = p_game_id loop
    v_t := v_j.to_tile;
    v_hops := 0;
    while exists (select 1 from board_jumps where game_id = p_game_id and from_tile = v_t) loop
      v_hops := v_hops + 1;
      if v_t = v_j.from_tile or v_hops > 100 then
        raise exception 'The snakes and ladders from tile % go round in a circle', v_j.from_tile;
      end if;
      select to_tile into v_t from board_jumps where game_id = p_game_id and from_tile = v_t;
    end loop;
  end loop;

  return v_n;
end;
$$;

revoke execute on function admin_set_snakes(uuid, jsonb) from public, anon;
grant  execute on function admin_set_snakes(uuid, jsonb) to authenticated;

-- ============================================================
-- 4. Starting: no task needed on a snake head or a ladder's foot
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

    if v_game.mode = 'snakes' then
      -- A snake head or a ladder's foot needs no task: landing there moves
      -- the team on at once, so nobody ever stands on one.
      select count(*), left(string_agg(s.p::text, ', ' order by s.p), 120)
        into v_tiles, v_empty
        from generate_series(1, 100) as s(p)
       where not exists (select 1 from tiles t
                          where t.game_id = p_game_id and t.position = s.p)
         and not exists (select 1 from board_jumps j
                          where j.game_id = p_game_id and j.from_tile = s.p);
      if v_tiles > 0 then
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


-- ============================================================
-- 5. Discord
-- ============================================================
create or replace function snakes_discord_line(p_event game_events, p_team text)
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
      v_extra := v_extra || case
        when (v_jump ->> 'to')::int > (v_jump ->> 'from')::int
          then format(' :ladder: Ladder on %s, up to %s!', v_jump ->> 'from', v_jump ->> 'to')
        else format(' :snake: Snake on %s, down to %s.', v_jump ->> 'from', v_jump ->> 'to')
      end;
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
