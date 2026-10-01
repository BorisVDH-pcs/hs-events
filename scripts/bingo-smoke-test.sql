-- HS_Battleships -- bingo smoke test that leaves nothing behind
--
-- Paste the whole file into the Supabase SQL editor and press Run.
--
-- It plays three small bingo games end to end, through the same functions the
-- site calls, as four throwaway accounts that exist only inside this run:
--
--   Smoke Organiser  (admin)    Smoke Red  (Red team)
--   Smoke Blue       (Blue team) Smoke Outsider (on no team)
--
-- No real account is put on a team, and nothing is kept: the whole test is one
-- DO block that ALWAYS ends by raising an error, which rolls every change back
-- -- the accounts, the games, the tiles, the events. Because nothing commits,
-- no Discord message is sent (pg_net only sends queued requests after a
-- commit) and no realtime update reaches an open page.
--
-- So the editor will show this as an ERROR. That is the point: the error text
-- IS the report, one PASS/FAIL line per check. Look for any line starting with
-- FAIL, or a "STOPPED at" line if something broke part-way.
--
-- The games:
--   1. 3x3, Red v Blue -- set-up refusals, evidence, a two-screenshot tile,
--      hidden progress between teams, then Red fills the card and wins.
--   2. 3x3 with an end time -- Blue completes one tile, the timer runs out,
--      submissions are refused and the result is recorded as time_up.
--   3. 3x3, one team, nobody scores -- the organiser ends it; no winner.

create function pg_temp.smoke_as(p_id uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_id::text, true);
end;
$$;

create function pg_temp.smoke_line(p_step text, p_ok boolean, p_detail text)
returns text language sql as $$
  select E'\n' || case when p_ok then 'PASS  ' else 'FAIL  ' end
         || p_step || coalesce(' -- ' || p_detail, '');
$$;

do $smoke$
declare
  v_log   text := '';
  v_step  text := 'creating the throwaway accounts';
  v_admin uuid := gen_random_uuid();
  v_red   uuid := gen_random_uuid();
  v_blue  uuid := gen_random_uuid();
  v_out   uuid := gen_random_uuid();
  g1 uuid; g2 uuid; g3 uuid;
  red uuid; blue uuid; green uuid; red2 uuid; blue2 uuid; solo uuid;
  t1 uuid[] := '{}'; t2 uuid[] := '{}'; t3 uuid[] := '{}';
  c uuid; c_again uuid; c_blue uuid;
  res jsonb;
  n int; n2 int; n3 int; n4 int;
  w uuid; b boolean;
  g games%rowtype;
  r int; k int;
begin
  begin  -- everything; a surprise is caught below so the report survives

    -- ========================================================
    -- Throwaway accounts (the signup trigger makes their profiles)
    -- ========================================================
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
           u.email, '', '{}'::jsonb, jsonb_build_object('display_name', u.name), now(), now()
      from (values
              (v_admin, 'smoke-admin@players.hs-battleships.invalid',    'Smoke Organiser'),
              (v_red,   'smoke-red@players.hs-battleships.invalid',      'Smoke Red'),
              (v_blue,  'smoke-blue@players.hs-battleships.invalid',     'Smoke Blue'),
              (v_out,   'smoke-outsider@players.hs-battleships.invalid', 'Smoke Outsider')
           ) as u(id, email, name);
    update profiles set is_admin = true where id = v_admin;

    select count(*) into n from profiles where id in (v_admin, v_red, v_blue, v_out);
    v_log := v_log || pg_temp.smoke_line('four throwaway profiles made', n = 4, n || ' profiles');

    -- ========================================================
    -- Game 1: creating it
    -- ========================================================
    perform pg_temp.smoke_as(v_red);
    v_step := 'a player cannot create a game';
    begin
      perform admin_new_game('Smoke', 'bingo', array['A'], 3::smallint, null);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was allowed');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%admins only%', sqlerrm);
    end;

    perform pg_temp.smoke_as(v_admin);
    v_step := 'team names must differ (case-insensitive)';
    begin
      perform admin_new_game('Smoke', 'bingo', array['Red', 'Blue', 'red'], 3::smallint, null);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was allowed');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%different name%', sqlerrm);
    end;

    v_step := 'card size is capped at 10x10';
    begin
      perform admin_new_game('Smoke', 'bingo', array['Red'], 11::smallint, null);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was allowed');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%3x3 to 10x10%', sqlerrm);
    end;

    v_step := 'an end time in the past is refused';
    begin
      perform admin_new_game('Smoke', 'bingo', array['Red'], 3::smallint, now() - interval '1 hour');
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was allowed');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%in the past%', sqlerrm);
    end;

    v_step := 'create game 1 (3x3, Red v Blue, ends tomorrow)';
    g1 := admin_new_game('Smoke game 1', 'bingo', array['Red', 'Blue'], 3::smallint,
                         now() + interval '1 day');
    select * into g from games where id = g1;
    select id into red  from teams where game_id = g1 and slot = 1;
    select id into blue from teams where game_id = g1 and slot = 2;
    v_log := v_log || pg_temp.smoke_line(v_step,
               g.mode = 'bingo' and g.status = 'setup' and g.grid_size = 3
               and red is not null and blue is not null,
               g.mode || ', ' || g.status || ', ' || g.grid_size || 'x' || g.grid_size);

    v_step := 'cannot start with an empty card';
    begin
      perform start_game(g1);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it started');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%needs 9 tiles%', sqlerrm);
    end;

    v_step := 'a square off the 3x3 card is refused';
    begin
      perform admin_set_tile(g1, 4::smallint, 1::smallint, '{"name":"Off the card"}'::jsonb);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was saved');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%off a 3x3%', sqlerrm);
    end;

    v_step := 'fill the card (top-left tile needs two screenshots)';
    for r in 1 .. 3 loop
      for k in 1 .. 3 loop
        t1 := t1 || admin_set_tile(g1, r::smallint, k::smallint,
                      case when r = 1 and k = 1
                           then '{"name":"Smoke two-shot","rule":"points","amount":2}'::jsonb
                           else jsonb_build_object('name', 'Smoke tile ' || r || ',' || k) end);
      end loop;
    end loop;
    select count(*) into n from tiles where game_id = g1;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 9, n || ' tiles');

    v_step := 'add a third team before the start';
    green := admin_add_team(g1, 'Green');
    select count(*) into n from teams where game_id = g1;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 3, n || ' teams');

    v_step := 'a duplicate team name is refused';
    begin
      perform admin_add_team(g1, 'red');
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was added');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%already a team%', sqlerrm);
    end;

    v_step := 'delete a team before the start';
    perform admin_delete_team(green);
    select count(*) into n from teams where game_id = g1;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 2, n || ' teams');

    v_step := 'cannot start with no players, and says which teams';
    begin
      perform start_game(g1);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it started');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%Red and Blue has no players%', sqlerrm);
    end;

    perform admin_set_member(red, v_red, 'captain');
    v_step := 'still refused while Blue is empty';
    begin
      perform start_game(g1);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it started');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike 'Blue has no players%', sqlerrm);
    end;

    v_step := 'starts once every team has a player';
    perform admin_set_member(blue, v_blue, 'member');
    perform start_game(g1);
    select status::text into strict v_step from games where id = g1;  -- reuse as scratch
    v_log := v_log || pg_temp.smoke_line('starts once every team has a player',
                                         v_step = 'active', 'status ' || v_step);

    v_step := 'a team can join mid-game but not be deleted';
    green := admin_add_team(g1, 'Latecomers');
    begin
      perform admin_delete_team(green);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was deleted');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%before the game starts%', sqlerrm);
    end;

    -- ========================================================
    -- Game 1: playing it
    -- ========================================================
    perform pg_temp.smoke_as(v_out);
    v_step := 'someone on no team cannot open a tile';
    begin
      perform bingo_open_tile(t1[1]);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it opened');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%not a member%', sqlerrm);
    end;

    perform pg_temp.smoke_as(v_red);
    v_step := 'Red opens the top-left tile (twice gives the same row)';
    c       := bingo_open_tile(t1[1]);
    c_again := bingo_open_tile(t1[1]);
    v_log := v_log || pg_temp.smoke_line(v_step, c is not null and c = c_again, null);

    v_step := 'evidence filed under another path is refused';
    begin
      perform add_evidence(c, g1 || '/' || blue || '/' || c || '/smoke.png', null, null, null);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was accepted');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%does not belong%', sqlerrm);
    end;

    v_step := 'first of two screenshots does not complete it';
    res := add_evidence(c, g1 || '/' || red || '/' || c || '/smoke-1.png', null, null, null);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'completed')::boolean = false and (res ->> 'evidence_count')::int = 1,
               'completed=' || (res ->> 'completed') || ', count=' || (res ->> 'evidence_count'));

    perform pg_temp.smoke_as(v_blue);
    v_step := 'Blue cannot add evidence to Red''s tile';
    begin
      perform add_evidence(c, g1 || '/' || red || '/' || c || '/smoke-x.png', null, null, null);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was accepted');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%other team%', sqlerrm);
    end;

    perform pg_temp.smoke_as(v_red);
    v_step := 'second screenshot completes the tile';
    res := add_evidence(c, g1 || '/' || red || '/' || c || '/smoke-2.png', null, null, null);
    select count(*) into n from game_events
     where game_id = g1 and team_id = red and type = 'tile_completed';
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'completed')::boolean and n = 1,
               'completed=' || (res ->> 'completed') || ', tile_completed events=' || n);

    v_step := 'a completed tile takes nothing more';
    begin
      perform add_evidence(c, g1 || '/' || red || '/' || c || '/smoke-3.png', null, null, null);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was accepted');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%already completed%', sqlerrm);
    end;

    perform pg_temp.smoke_as(v_blue);
    v_step := 'Blue works the same tile separately';
    c_blue := bingo_open_tile(t1[1]);
    res := add_evidence(c_blue, g1 || '/' || blue || '/' || c_blue || '/smoke-1.png', null, null, null);
    v_log := v_log || pg_temp.smoke_line(v_step,
               c_blue <> c and (res ->> 'completed')::boolean = false
               and (res ->> 'evidence_count')::int = 1,
               'own row, count=' || (res ->> 'evidence_count'));

    -- What Blue can see, read as the site reads it: the authenticated role,
    -- under row-level security. Values only here; logged after the role resets.
    v_step := 'reading as Blue under row-level security';
    execute 'set local role authenticated';
    select count(*) into n  from tile_claims  where team_id = red;
    select count(*) into n2 from tile_evidence where team_id = red;
    select count(*) into n3 from game_events
     where game_id = g1 and team_id = red and type = 'evidence_submitted';
    select count(*) into n4 from game_events
     where game_id = g1 and team_id = red and type = 'tile_completed';
    begin
      perform finish_bingo(g1, 'admin');
      b := true;
    exception when others then
      b := false;
    end;
    execute 'reset role';
    v_log := v_log || pg_temp.smoke_line('Blue cannot see Red''s progress rows', n = 0, n || ' visible');
    v_log := v_log || pg_temp.smoke_line('Blue cannot see Red''s screenshots', n2 = 0, n2 || ' visible');
    v_log := v_log || pg_temp.smoke_line('Blue cannot see Red''s submission events', n3 = 0, n3 || ' visible');
    v_log := v_log || pg_temp.smoke_line('Red''s completed tile is public (by design)', n4 = 1, n4 || ' visible');
    v_log := v_log || pg_temp.smoke_line('a player cannot call finish_bingo directly', not b, null);

    -- The other side of the same rule: hiding Red's rows from Blue must not
    -- hide them from Red, or from the organiser.
    v_step := 'reading Red''s progress as Red, the organiser and a visitor';
    perform pg_temp.smoke_as(v_red);
    execute 'set local role authenticated';
    select count(*) into n from tile_claims where team_id = red;
    execute 'reset role';
    perform pg_temp.smoke_as(v_admin);
    execute 'set local role authenticated';
    select count(*) into n2 from tile_claims where team_id = red;
    execute 'reset role';
    begin
      execute 'set local role anon';
      select count(*) into n3 from tile_claims where team_id = red;
      execute 'reset role';
    exception when insufficient_privilege then
      n3 := 0;  -- no grant at all is hidden too
    end;
    v_log := v_log || pg_temp.smoke_line('Red still sees its own progress row', n = 1, n || ' visible');
    v_log := v_log || pg_temp.smoke_line('the organiser still sees it', n2 = 1, n2 || ' visible');
    v_log := v_log || pg_temp.smoke_line('a signed-out visitor cannot see it', n3 = 0, n3 || ' visible');

    v_step := 'standings mid-game';
    select tiles_completed into n  from bingo_standings(g1) where team_id = red;
    select tiles_completed into n2 from bingo_standings(g1) where team_id = blue;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 1 and n2 = 0, 'Red ' || n || ', Blue ' || n2);

    perform pg_temp.smoke_as(v_red);
    v_step := 'Red completes the other 8 tiles';
    for k in 2 .. 9 loop
      c := bingo_open_tile(t1[k]);
      res := add_evidence(c, g1 || '/' || red || '/' || c || '/smoke.png', null, null, null);
    end loop;
    select * into g from games where id = g1;
    v_log := v_log || pg_temp.smoke_line('a full card ends the game, Red wins',
               g.status = 'finished' and g.ended_reason = 'full_card' and g.winner_team_id = red,
               g.status || ', ' || coalesce(g.ended_reason, 'no reason') || ', winner '
               || coalesce((select name from teams where id = g.winner_team_id), 'none'));

    select count(*) into n from game_events where game_id = g1 and type = 'game_ended';
    v_log := v_log || pg_temp.smoke_line('exactly one game_ended event', n = 1, n::text);

    perform pg_temp.smoke_as(v_blue);
    v_step := 'no submissions once the game is over';
    begin
      perform add_evidence(c_blue, g1 || '/' || blue || '/' || c_blue || '/smoke-2.png', null, null, null);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was accepted');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%finished%', sqlerrm);
    end;

    v_step := 'final standings';
    select tiles_completed, place into n, n2 from bingo_standings(g1) where team_id = red;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 9 and n2 = 1, 'Red ' || n || '/9, place ' || n2);

    perform pg_temp.smoke_as(v_admin);
    v_step := 'reset game 1 to preparation';
    perform admin_reset_game(g1, true);
    select * into g from games where id = g1;
    select count(*) into n from tile_claims c2 join tiles t on t.id = c2.tile_id where t.game_id = g1;
    v_log := v_log || pg_temp.smoke_line(v_step,
               g.status = 'placement' and g.winner_team_id is null and g.ended_reason is null,
               g.status || ', ' || n || ' progress rows left');

    -- ========================================================
    -- Game 2: the timer runs out
    -- ========================================================
    v_step := 'create and start game 2 (ends in an hour)';
    g2 := admin_new_game('Smoke game 2', 'bingo', array['Red2', 'Blue2'], 3::smallint,
                         now() + interval '1 hour');
    select id into red2  from teams where game_id = g2 and slot = 1;
    select id into blue2 from teams where game_id = g2 and slot = 2;
    for r in 1 .. 3 loop
      for k in 1 .. 3 loop
        t2 := t2 || admin_set_tile(g2, r::smallint, k::smallint,
                      jsonb_build_object('name', 'Smoke tile ' || r || ',' || k));
      end loop;
    end loop;
    perform admin_set_member(red2, v_red, 'captain');
    perform admin_set_member(blue2, v_blue, 'captain');
    perform start_game(g2);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (select status from games where id = g2) = 'active', null);

    v_step := 'the end time cannot be moved into the past';
    begin
      perform admin_set_end_time(g2, now() - interval '1 minute');
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was moved');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%End game now%', sqlerrm);
    end;

    perform pg_temp.smoke_as(v_blue);
    v_step := 'Blue2 completes one tile';
    c := bingo_open_tile(t2[5]);
    res := add_evidence(c, g2 || '/' || blue2 || '/' || c || '/smoke.png', null, null, null);
    v_log := v_log || pg_temp.smoke_line(v_step, (res ->> 'completed')::boolean, null);

    v_step := 'settling before the deadline does nothing';
    b := bingo_settle(g2);
    v_log := v_log || pg_temp.smoke_line(v_step,
               not b and (select status from games where id = g2) = 'active', null);

    -- The clock cannot be wound forward inside a transaction, so the deadline
    -- is brought back to now instead.
    update games set ends_at = now() where id = g2;

    perform pg_temp.smoke_as(v_red);
    v_step := 'after the deadline, opening a tile is refused';
    begin
      perform bingo_open_tile(t2[1]);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it opened');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%Time is up%', sqlerrm);
    end;

    v_step := 'the first page to notice records the result';
    b := bingo_settle(g2);
    select * into g from games where id = g2;
    v_log := v_log || pg_temp.smoke_line(v_step,
               b and g.status = 'finished' and g.ended_reason = 'time_up'
               and g.winner_team_id = blue2 and g.ended_at = g.ends_at,
               g.status || ', ' || coalesce(g.ended_reason, 'no reason') || ', winner '
               || coalesce((select name from teams where id = g.winner_team_id), 'none'));

    v_step := 'settling twice does nothing';
    b := bingo_settle(g2);
    select count(*) into n from game_events where game_id = g2 and type = 'game_ended';
    v_log := v_log || pg_temp.smoke_line(v_step, not b and n = 1, n || ' game_ended event(s)');

    -- ========================================================
    -- Game 3: the organiser ends it, nobody scored
    -- ========================================================
    perform pg_temp.smoke_as(v_admin);
    v_step := 'create and start game 3 (one team, no end time)';
    g3 := admin_new_game('Smoke game 3', 'bingo', array['Solo'], 3::smallint, null);
    select id into solo from teams where game_id = g3;
    for r in 1 .. 3 loop
      for k in 1 .. 3 loop
        t3 := t3 || admin_set_tile(g3, r::smallint, k::smallint,
                      jsonb_build_object('name', 'Smoke tile ' || r || ',' || k));
      end loop;
    end loop;
    perform admin_set_member(solo, v_red, 'captain');
    perform start_game(g3);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (select status from games where id = g3) = 'active', null);

    v_step := 'End game now: finished, no winner';
    w := admin_end_game(g3);
    select * into g from games where id = g3;
    v_log := v_log || pg_temp.smoke_line(v_step,
               w is null and g.status = 'finished' and g.ended_reason = 'admin'
               and g.winner_team_id is null,
               g.status || ', ' || coalesce(g.ended_reason, 'no reason'));

    v_step := 'ending it twice is refused';
    begin
      perform admin_end_game(g3);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was allowed');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%not running%', sqlerrm);
    end;

    v_step := 'done';
  exception when others then
    v_log := v_log || E'\n\nSTOPPED at "' || v_step || '": ' || sqlerrm;
  end;

  raise exception using message =
    E'BINGO SMOKE TEST -- this error is deliberate: it rolled everything back, nothing was saved.\n'
    || (select count(*) from regexp_matches(v_log, E'\nPASS', 'g')) || ' passed, '
    || (select count(*) from regexp_matches(v_log, E'\nFAIL', 'g')) || ' failed'
    || case when v_step <> 'done' then ', and it stopped early' else '' end
    || E'\n' || v_log;
end;
$smoke$;
