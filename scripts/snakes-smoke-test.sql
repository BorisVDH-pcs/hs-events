-- High Society Events -- Snakes and Ladders smoke test that leaves nothing behind
--
-- Paste the whole file into the Supabase SQL editor and press Run.
--
-- Same idea as scripts/bingo-smoke-test.sql: throwaway accounts that exist only
-- inside this run, the same functions the site calls, and one DO block that
-- ALWAYS ends by raising an error, which rolls every change back. Nothing is
-- kept, no Discord message is sent (pg_net only sends after a commit) and no
-- open page sees anything.
--
-- So the editor shows this as an ERROR. The error text IS the report: one
-- PASS/FAIL line per check, plus a few INFO lines showing the Discord wording.
-- Look for FAIL, or a "STOPPED at" line if something broke part-way.
--
-- Most moves are played with FIXED dice, by calling the internal snakes_move
-- directly (the SQL editor may; the website may not). That is what makes the
-- skip, bounce, snake and rollback checks exact. The player and organiser
-- buttons, which roll real dice, are checked too, on moves whose outcome does
-- not depend on the number.
--
-- Snakes on game 1: 16->6, 33->26, 26->12 (a chain), 53->39, 71->59, 96->83.
-- Game 4 has ladders: 4->14, 9->31, 62->80, and snakes 17->7, 40->22.
--
-- The games:
--   1. Red, Blue, Green (+ Yellow mid-game) -- set-up refusals, every way to
--      move, completion, rollbacks, privacy, revoke and undo, then the
--      organiser ends it early and the furthest-along team wins.
--   2. One team -- reaches tile 100, finishes it and wins; the win is undone
--      and redone; reset.
--   3. A battleships game, to show it still has exactly two teams.
--   4. One team on a board with ladders -- climbing, skipping after a ladder,
--      a ladder in reach stops the long skip, a snake that cannot loop, no
--      task needed on a snake head or a ladder's foot.

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

-- Runs p_sql and expects it to fail with a message like p_like.
create function pg_temp.smoke_refused(p_step text, p_sql text, p_like text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return pg_temp.smoke_line(p_step, false, 'it was allowed');
exception when others then
  return pg_temp.smoke_line(p_step, sqlerrm ilike p_like, sqlerrm);
end;
$$;

-- One screenshot on a claim, filed where the client would file it.
create function pg_temp.smoke_upload(p_game uuid, p_team uuid, p_claim uuid, p_n int default 1)
returns jsonb language plpgsql as $$
begin
  return add_evidence(p_claim, p_game || '/' || p_team || '/' || p_claim || '/smoke-' || p_n || '.png',
                      null, null, null);
end;
$$;

-- The organiser puts a team on a tile and completes it outright.
create function pg_temp.smoke_done(p_admin uuid, p_team uuid, p_tile int)
returns void language plpgsql as $$
begin
  perform pg_temp.smoke_as(p_admin);
  perform admin_snakes_move(p_team, p_tile);
  perform admin_snakes_complete_tile(p_team);
end;
$$;

do $smoke$
declare
  v_log   text := '';
  v_step  text := 'creating the throwaway accounts';
  v_admin uuid := gen_random_uuid();
  v_red   uuid := gen_random_uuid();
  v_red2  uuid := gen_random_uuid();
  v_blue  uuid := gen_random_uuid();
  v_green uuid := gen_random_uuid();
  v_out   uuid := gen_random_uuid();
  g1 uuid; g2 uuid; g3 uuid; g4 uuid; lad uuid;
  red uuid; blue uuid; green uuid; yellow uuid; solo uuid;
  c uuid; c20 uuid; c4 uuid; c100 uuid;
  ev uuid;
  res jsonb;
  n int; x int; y int;
  w uuid;
  s text;
  g games%rowtype;
  tm teams%rowtype;
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
              (v_red2,  'smoke-red2@players.hs-battleships.invalid',     'Smoke Red Two'),
              (v_blue,  'smoke-blue@players.hs-battleships.invalid',     'Smoke Blue'),
              (v_green, 'smoke-green@players.hs-battleships.invalid',    'Smoke Green'),
              (v_out,   'smoke-outsider@players.hs-battleships.invalid', 'Smoke Outsider')
           ) as u(id, email, name);
    update profiles set is_admin = true where id = v_admin;

    select count(*) into n from profiles where id in (v_admin, v_red, v_red2, v_blue, v_green, v_out);
    v_log := v_log || pg_temp.smoke_line('six throwaway profiles made', n = 6, n || ' profiles');

    -- ========================================================
    -- Game 1: creating it
    -- ========================================================
    perform pg_temp.smoke_as(v_red);
    v_log := v_log || pg_temp.smoke_refused('a player cannot create a game',
      $q$select admin_new_game('Smoke', 'snakes', array['A'], 10::smallint, null)$q$, '%admins only%');

    perform pg_temp.smoke_as(v_admin);
    v_log := v_log || pg_temp.smoke_refused('snakes has no end time',
      $q$select admin_new_game('Smoke', 'snakes', array['A'], 10::smallint, now() + interval '1 day')$q$,
      '%no end time%');
    v_log := v_log || pg_temp.smoke_refused('snakes needs a team',
      $q$select admin_new_game('Smoke', 'snakes', array[]::text[], 10::smallint, null)$q$,
      '%at least one team%');

    v_step := 'create game 1 (Red, Blue, Green; a 5 is ignored, the board is 10x10)';
    g1 := admin_new_game('Smoke snakes 1', 'snakes', array['Red', 'Blue', 'Green'], 5::smallint, null);
    select * into g from games where id = g1;
    select id into red   from teams where game_id = g1 and slot = 1;
    select id into blue  from teams where game_id = g1 and slot = 2;
    select id into green from teams where game_id = g1 and slot = 3;
    v_log := v_log || pg_temp.smoke_line(v_step,
               g.mode = 'snakes' and g.status = 'setup' and g.grid_size = 10
               and red is not null and blue is not null and green is not null,
               g.mode || ', ' || g.status || ', ' || g.grid_size || 'x' || g.grid_size);

    v_log := v_log || pg_temp.smoke_refused('a snakes board cannot be any size but 10',
      format('update games set grid_size = 9 where id = %L', g1), '%grid_size%');

    v_log := v_log || pg_temp.smoke_refused('cannot start with an empty board',
      format('select start_game(%L)', g1), '%needs a tile on every square%100 missing%');

    v_step := 'fill the board (tile 20 needs two screenshots)';
    for r in 1 .. 10 loop
      for k in 1 .. 10 loop
        perform admin_set_tile(g1, r::smallint, k::smallint,
                  case when r = 2 and k = 10
                       then '{"name":"Smoke two-shot","rule":"points","amount":2}'::jsonb
                       else jsonb_build_object('name', 'Smoke tile ' || ((r - 1) * 10 + k)) end);
      end loop;
    end loop;
    select count(*), min(position), max(position) into n, x, y from tiles where game_id = g1;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 100 and x = 1 and y = 100,
               n || ' tiles, numbered ' || x || '-' || y);

    -- ========================================================
    -- The snakes
    -- ========================================================
    perform pg_temp.smoke_as(v_red);
    v_log := v_log || pg_temp.smoke_refused('a player cannot place snakes',
      format($q$select admin_set_snakes(%L, '[{"from":16,"to":6}]')$q$, g1), '%admins only%');

    perform pg_temp.smoke_as(v_admin);
    v_log := v_log || pg_temp.smoke_refused('no snake on tile 100',
      format($q$select admin_set_snakes(%L, '[{"from":100,"to":6}]')$q$, g1), '%1 to 99%');
    v_log := v_log || pg_temp.smoke_refused('a snake or ladder must go somewhere',
      format($q$select admin_set_snakes(%L, '[{"from":1,"to":1}]')$q$, g1), '%goes nowhere%');
    v_log := v_log || pg_temp.smoke_refused('nothing ends past 100',
      format($q$select admin_set_snakes(%L, '[{"from":90,"to":101}]')$q$, g1), '%ends on tile 1 to 100%');
    v_log := v_log || pg_temp.smoke_refused('a ladder and a snake cannot make a circle',
      format($q$select admin_set_snakes(%L, '[{"from":20,"to":40},{"from":40,"to":20}]')$q$, g1),
      '%go round in a circle%');
    v_log := v_log || pg_temp.smoke_refused('two snakes cannot share a head',
      format($q$select admin_set_snakes(%L, '[{"from":16,"to":6},{"from":16,"to":2}]')$q$, g1),
      '%two snakes or ladders start on tile 16%');

    v_step := 'place six snakes, one chain';
    n := admin_set_snakes(g1, '[{"from":16,"to":6},{"from":33,"to":26},{"from":26,"to":12},
                               {"from":53,"to":39},{"from":71,"to":59},{"from":96,"to":83}]'::jsonb);
    select count(*) into x from board_jumps where game_id = g1;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 6 and x = 6, x || ' snakes');

    v_step := 'a signed-out visitor can see the snakes';
    execute 'set local role anon';
    select count(*) into n from board_jumps where game_id = g1;
    execute 'reset role';
    v_log := v_log || pg_temp.smoke_line(v_step, n = 6, n || ' visible');

    v_step := 'a player cannot write snakes directly';
    perform pg_temp.smoke_as(v_red);
    begin
      execute 'set local role authenticated';
      insert into board_jumps (game_id, from_tile, to_tile) values (g1, 50, 2);
      execute 'reset role';
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was written');
    exception when others then
      execute 'reset role';
      v_log := v_log || pg_temp.smoke_line(v_step, true, sqlerrm);
    end;

    -- ========================================================
    -- Starting
    -- ========================================================
    perform pg_temp.smoke_as(v_admin);
    perform admin_set_member(red,  v_red,  'captain');
    perform admin_set_member(red,  v_red2, 'member');
    perform admin_set_member(blue, v_blue, 'captain');
    v_log := v_log || pg_temp.smoke_refused('cannot start while Green has no players',
      format('select start_game(%L)', g1), 'Green has no players%');

    v_step := 'starts once every team has a player; everyone at Start';
    perform admin_set_member(green, v_green, 'captain');
    perform start_game(g1);
    select count(*) filter (where board_tile = 0) into n from teams where game_id = g1;
    v_log := v_log || pg_temp.smoke_line(v_step,
               (select status from games where id = g1) = 'active' and n = 3,
               n || ' teams at Start');

    v_log := v_log || pg_temp.smoke_refused('the snakes are fixed once it starts',
      format($q$select admin_set_snakes(%L, '[]')$q$, g1), '%fixed once the game starts%');

    -- ========================================================
    -- Players rolling with real dice
    -- ========================================================
    perform pg_temp.smoke_as(v_red);
    v_log := v_log || pg_temp.smoke_refused('nothing to upload at Start',
      format('select snakes_open_tile(%L)', g1), '%leave Start%');

    perform pg_temp.smoke_as(v_out);
    v_log := v_log || pg_temp.smoke_refused('someone on no team cannot roll',
      format('select snakes_roll(%L)', g1), '%not a member%');

    v_step := 'any Red player rolls from Start (1-6)';
    perform pg_temp.smoke_as(v_red2);
    res := snakes_roll(g1);
    select board_tile into x from teams where id = red;
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'from')::int = 0 and x between 1 and 6 and (res ->> 'to')::int = x
               and res ->> 'by_name' = 'Smoke Red Two',
               'rolled ' || (res -> 'dice' ->> 0) || ', now on ' || x);

    v_log := v_log || pg_temp.smoke_refused('no second roll before the tile is done',
      format('select snakes_roll(%L)', g1), '%Finish tile%');

    v_step := 'Red finishes its tile with one screenshot';
    c := snakes_open_tile(g1);
    res := pg_temp.smoke_upload(g1, red, c);
    v_log := v_log || pg_temp.smoke_line(v_step, (res ->> 'completed')::boolean,
               'completed=' || (res ->> 'completed'));

    v_step := 'then Red may roll again';
    perform pg_temp.smoke_as(v_red);
    res := snakes_roll(g1);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'from')::int = x and (res ->> 'to')::int > x,
               (res ->> 'from') || ' -> ' || (res ->> 'to'));

    -- ========================================================
    -- Fixed dice: every rule of the road (Blue)
    -- ========================================================
    perform pg_temp.smoke_as(v_blue);
    v_log := v_log || pg_temp.smoke_refused('dice are 1 to 6',
      format('select snakes_move(%L, %L, array[7])', blue, 'roll'), '%1 to 6%');

    v_step := 'Blue rolls a 4 from Start';
    res := snakes_move(blue, 'roll', array[4]);
    v_log := v_log || pg_temp.smoke_line(v_step, (res ->> 'to')::int = 4, 'on ' || (res ->> 'to'));

    v_step := 'Blue finishes 4, rolls a 6 to 10, finishes it';
    c4 := snakes_open_tile(g1);
    perform pg_temp.smoke_upload(g1, blue, c4);
    res := snakes_move(blue, 'roll', array[6]);
    c := snakes_open_tile(g1);
    perform pg_temp.smoke_upload(g1, blue, c);
    select count(*) into n from tile_claims where team_id = blue and status = 'completed';
    v_log := v_log || pg_temp.smoke_line(v_step, (res ->> 'to')::int = 10 and n = 2,
               'on ' || (res ->> 'to') || ', ' || n || ' done');

    v_step := 'a 6 from 10 lands on the snake at 16, down to 6';
    res := snakes_move(blue, 'roll', array[6]);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'landed')::int = 16 and (res ->> 'to')::int = 6
               and (res -> 'jumps' -> 0 ->> 'from')::int = 16,
               (res ->> 'landed') || ' -> ' || (res ->> 'to'));

    v_step := 'a roll onto a finished tile skips past it (6 + 4 = 10 -> 11)';
    c := snakes_open_tile(g1);
    perform pg_temp.smoke_upload(g1, blue, c);
    res := snakes_move(blue, 'roll', array[4]);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'to')::int = 11 and res -> 'skipped' = '[10]'::jsonb,
               'on ' || (res ->> 'to') || ', skipped ' || (res -> 'skipped')::text);

    v_step := 'tile 20 takes two screenshots; one is not enough';
    perform pg_temp.smoke_as(v_admin);
    perform admin_snakes_move(blue, 20);
    perform pg_temp.smoke_as(v_blue);
    c20 := snakes_open_tile(g1);
    res := pg_temp.smoke_upload(g1, blue, c20, 1);
    v_log := v_log || pg_temp.smoke_line(v_step, not (res ->> 'completed')::boolean,
               'completed=' || (res ->> 'completed'));

    perform pg_temp.smoke_as(v_admin);
    perform admin_snakes_move(blue, 22);
    perform pg_temp.smoke_as(v_blue);
    v_log := v_log || pg_temp.smoke_refused('evidence only for the tile the team stands on',
      format('select pg_temp.smoke_upload(%L, %L, %L, 2)', g1, blue, c20), '%not your team''s current tile%');

    v_log := v_log || pg_temp.smoke_refused('a battleships lock-in is refused',
      format('select claim_tile(%L)', (select id from tiles where game_id = g1 and position = 22)),
      '%no lock-in%');

    perform pg_temp.smoke_as(v_admin);
    v_log := v_log || pg_temp.smoke_refused('the organiser cannot park a team on a snake head',
      format('select admin_snakes_move(%L, 33)', blue), '%snake head%');

    v_step := 'Complete tile now marks it done without evidence';
    perform pg_temp.smoke_done(v_admin, blue, 30);
    select count(*) into n from tile_claims c join tiles t on t.id = c.tile_id
     where c.team_id = blue and t.position = 30 and c.status = 'completed' and c.completed_early;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 1, n || ' early completion');

    v_step := 'snakes chain: 30 + 3 = 33 -> 26 -> 12';
    perform pg_temp.smoke_as(v_blue);
    res := snakes_move(blue, 'roll', array[3]);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'to')::int = 12 and jsonb_array_length(res -> 'jumps') = 2,
               'on ' || (res ->> 'to') || ', ' || jsonb_array_length(res -> 'jumps') || ' snakes');

    v_step := 'the skip stops at a snake head, and skips again after the tail';
    perform pg_temp.smoke_done(v_admin, blue, 15);
    perform pg_temp.smoke_done(v_admin, blue, 14);
    perform pg_temp.smoke_as(v_blue);
    res := snakes_move(blue, 'roll', array[1]);   -- 15 done -> 16 snake -> 6 done -> 7
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'to')::int = 7 and (res -> 'jumps' -> 0 ->> 'from')::int = 16,
               'on ' || (res ->> 'to'));

    v_step := 'first tile at 40+ earns one rollback';
    perform pg_temp.smoke_done(v_admin, blue, 98);
    select * into tm from teams where id = blue;
    select count(*) into n from game_events where team_id = blue and type = 'rollback_gained';
    v_log := v_log || pg_temp.smoke_line(v_step,
               tm.rollbacks_available = 1 and tm.auto_rollback_earned and n = 1,
               tm.rollbacks_available || ' available, ' || n || ' event(s)');

    v_step := 'overshooting 100 bounces back (98 + 5 -> 97)';
    perform pg_temp.smoke_as(v_blue);
    res := snakes_move(blue, 'roll', array[5]);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'to')::int = 97 and (res ->> 'bounced')::boolean,
               'on ' || (res ->> 'to'));

    v_step := 'long skip: 61-66 all done, so from 60 go straight to 67';
    for k in 60 .. 66 loop
      perform pg_temp.smoke_done(v_admin, blue, k);
    end loop;
    perform admin_snakes_move(blue, 60);
    perform pg_temp.smoke_as(v_blue);
    res := snakes_move(blue, 'roll', array[1]);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'to')::int = 67 and (res ->> 'long_skip')::boolean
               and res -> 'skipped' = '[61,62,63,64,65,66]'::jsonb,
               'on ' || (res ->> 'to'));

    v_step := 'only one free rollback, however many 40+ tiles';
    select rollbacks_available into n from teams where id = blue;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 1, n || ' available');

    v_step := 'a rollback never skips past where the team was (67 back 3, skip, stop at 67)';
    perform pg_temp.smoke_done(v_admin, blue, 67);
    perform pg_temp.smoke_as(v_blue);
    res := snakes_move(blue, 'rollback', array[6, 1]);   -- 1st rollback: 6 folds to 3
    select * into tm from teams where id = blue;
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'steps')::int = 3 and (res ->> 'landed')::int = 64
               and tm.board_tile = 67 and tm.rollbacks_available = 0 and tm.rollbacks_used = 1,
               'back ' || (res ->> 'steps') || ' to ' || (res ->> 'landed') || ', now on ' || tm.board_tile);

    v_log := v_log || pg_temp.smoke_refused('no rollbacks left',
      format('select snakes_spend_rollback(%L)', g1), '%no rollbacks left%');

    -- ========================================================
    -- Rollbacks, step by step (Green)
    -- ========================================================
    perform pg_temp.smoke_as(v_green);
    v_log := v_log || pg_temp.smoke_refused('a player cannot hand out rollbacks',
      format('select admin_snakes_give_rollback(%L, 3)', green), '%admins only%');

    perform pg_temp.smoke_as(v_admin);
    v_step := 'the organiser gives Green three';
    n := admin_snakes_give_rollback(green, 3);
    v_log := v_log || pg_temp.smoke_line(v_step, n = 3, n || ' available');

    v_log := v_log || pg_temp.smoke_refused('cannot take more than a team has',
      format('select admin_snakes_give_rollback(%L, -5)', green), '%only has 3%');

    perform admin_snakes_move(green, 50);
    perform pg_temp.smoke_as(v_green);
    v_step := '1st rollback goes back 1-3 (a 5 folds to 2: 50 -> 48)';
    res := snakes_move(green, 'rollback', array[5, 5]);
    v_log := v_log || pg_temp.smoke_line(v_step, (res ->> 'to')::int = 48, 'on ' || (res ->> 'to'));

    v_step := '2nd rollback goes back one d6 (5: 48 -> 43)';
    res := snakes_move(green, 'rollback', array[5, 1]);
    v_log := v_log || pg_temp.smoke_line(v_step, (res ->> 'to')::int = 43, 'on ' || (res ->> 'to'));

    v_step := '3rd rollback goes back the higher of two (2 and 6: 43 -> 37)';
    res := snakes_move(green, 'rollback', array[2, 6]);
    select * into tm from teams where id = green;
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'to')::int = 37 and tm.rollbacks_used = 3 and tm.rollbacks_available = 0,
               'on ' || (res ->> 'to') || ', used ' || tm.rollbacks_used);

    v_step := 'a punishment of 4 from 37 hits the 33 snake and its chain to 12';
    res := snakes_move(green, 'punish', array[4]);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'to')::int = 12 and jsonb_array_length(res -> 'jumps') = 2,
               'on ' || (res ->> 'to'));

    v_log := v_log || pg_temp.smoke_refused('a player cannot punish',
      format('select admin_snakes_punish(%L)', blue), '%admins only%');

    perform pg_temp.smoke_as(v_admin);
    v_step := 'the organiser''s punish button moves a team back';
    res := admin_snakes_punish(green);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'kind') = 'punish' and (res ->> 'to')::int <= 12,
               'back ' || (res ->> 'steps') || ' to ' || (res ->> 'to'));

    v_step := 'a team can join mid-game, at Start';
    yellow := admin_add_team(g1, 'Yellow');
    v_log := v_log || pg_temp.smoke_line(v_step,
               (select board_tile from teams where id = yellow) = 0, null);
    v_log := v_log || pg_temp.smoke_refused('a team at Start cannot be punished',
      format('select admin_snakes_punish(%L)', yellow), '%not left Start%');

    -- ========================================================
    -- Who can see and call what
    -- ========================================================
    v_step := 'the website cannot call snakes_move (it would choose its own dice)';
    perform pg_temp.smoke_as(v_blue);
    begin
      execute 'set local role authenticated';
      perform snakes_move(blue, 'roll', array[6]);
      execute 'reset role';
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was allowed');
    exception when others then
      execute 'reset role';
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%permission denied%', sqlerrm);
    end;

    v_step := 'Blue cannot see Red''s progress rows';
    execute 'set local role authenticated';
    select count(*) into n from tile_claims where team_id = red;
    execute 'reset role';
    v_log := v_log || pg_temp.smoke_line(v_step, n = 0, n || ' visible');

    v_step := 'Blue sees where every team stands';
    execute 'set local role authenticated';
    select count(*) into n from teams where game_id = g1 and board_tile > 0;
    execute 'reset role';
    v_log := v_log || pg_temp.smoke_line(v_step, n = 3, n || ' teams off Start');

    v_step := 'Blue''s board: whole board open, 4 teams in standings, 6 snakes';
    execute 'set local role authenticated';
    res := board_for_me(g1);
    execute 'reset role';
    select count(*) into n from jsonb_array_elements(res -> 'tiles') t where t ->> 'name' is not null;
    v_log := v_log || pg_temp.smoke_line(v_step,
               n = 100 and jsonb_array_length(res -> 'standings') = 4
               and jsonb_array_length(res -> 'jumps') = 6,
               n || ' named tiles, ' || jsonb_array_length(res -> 'standings') || ' teams, '
               || jsonb_array_length(res -> 'jumps') || ' snakes');

    -- ========================================================
    -- Undoing completions
    -- ========================================================
    perform pg_temp.smoke_as(v_admin);
    v_step := 'withdrawing Blue''s only screenshot on tile 4 reopens it';
    select id into ev from tile_evidence where claim_id = c4;
    res := admin_revoke_evidence(ev);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'uncompleted')::boolean and res ->> 'mode' = 'snakes'
               and (select status from tile_claims where id = c4) = 'active',
               'uncompleted=' || (res ->> 'uncompleted'));

    v_step := 'Undo completion on an early-completed tile (98)';
    res := admin_snakes_uncomplete_tile(blue, 98);
    select count(*) into n from tile_claims c join tiles t on t.id = c.tile_id
     where c.team_id = blue and t.position = 98 and c.status = 'active' and not c.completed_early;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 1 and (res ->> 'was_early')::boolean, null);

    v_log := v_log || pg_temp.smoke_refused('cannot undo a tile that is not done',
      format('select admin_snakes_uncomplete_tile(%L, 98)', blue), '%has not completed tile 98%');

    -- ========================================================
    -- Ending early
    -- ========================================================
    v_step := 'standings: Blue (tile 67) is furthest along';
    select s.team_id into w from snakes_standings(g1) s where s.place = 1;
    v_log := v_log || pg_temp.smoke_line(v_step, w = blue,
               (select name from teams where id = w));

    v_log := v_log || pg_temp.smoke_refused('the bingo End game button refuses snakes',
      format('select admin_end_game(%L)', g1), '%admin_snakes_end_game%');
    v_log := v_log || pg_temp.smoke_refused('confirming the wrong winner is refused',
      format('select admin_snakes_end_game(%L, %L)', g1, red), '%standings changed%Blue%');

    v_step := 'End game now: Blue wins, furthest along';
    w := admin_snakes_end_game(g1, blue);
    select * into g from games where id = g1;
    select count(*) into n from game_events where game_id = g1 and type = 'game_ended';
    v_log := v_log || pg_temp.smoke_line(v_step,
               w = blue and g.status = 'finished' and g.ended_reason = 'admin'
               and g.winner_team_id = blue and n = 1,
               g.status || ', ' || g.ended_reason || ', ' || n || ' game_ended');

    perform pg_temp.smoke_as(v_red);
    v_log := v_log || pg_temp.smoke_refused('nobody moves once it is over',
      format('select snakes_roll(%L)', g1), '%nobody moves%');

    v_step := 'every game 1 event has a Discord line';
    select count(*) into n from game_events e
     where e.game_id = g1 and (discord_line(e) is null or discord_line(e) = e.type::text);
    select count(*) into x from game_events e where e.game_id = g1;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 0, x || ' events, ' || n || ' without a line');

    -- A sample of the wording, one per kind, for a human to read.
    for s in
      select distinct on (e.type, e.payload ->> 'kind', e.payload ->> 'reason')
             discord_line(e)
        from game_events e
       where e.game_id = g1
         and e.type in ('team_moved', 'rollback_gained', 'tile_completed', 'tile_reopened',
                        'game_started', 'game_ended')
       order by e.type, e.payload ->> 'kind', e.payload ->> 'reason', e.created_at desc
    loop
      v_log := v_log || E'\nINFO  ' || s;
    end loop;

    -- ========================================================
    -- Game 2: winning on tile 100
    -- ========================================================
    perform pg_temp.smoke_as(v_admin);
    v_step := 'create and start game 2 (one team, no snakes)';
    g2 := admin_new_game('Smoke snakes 2', 'snakes', array['Solo'], 10::smallint, null);
    select id into solo from teams where game_id = g2;
    for r in 1 .. 10 loop
      for k in 1 .. 10 loop
        perform admin_set_tile(g2, r::smallint, k::smallint,
                  jsonb_build_object('name', 'Smoke tile ' || ((r - 1) * 10 + k)));
      end loop;
    end loop;
    perform admin_set_member(solo, v_red, 'captain');
    perform start_game(g2);
    v_log := v_log || pg_temp.smoke_line(v_step, (select status from games where id = g2) = 'active', null);

    v_step := 'reaching 100 is not winning';
    perform admin_snakes_move(solo, 100);
    v_log := v_log || pg_temp.smoke_line(v_step, (select status from games where id = g2) = 'active', null);

    v_step := 'finishing tile 100 wins and ends the game';
    perform pg_temp.smoke_as(v_red);
    c100 := snakes_open_tile(g2);
    res := pg_temp.smoke_upload(g2, solo, c100);
    select * into g from games where id = g2;
    v_log := v_log || pg_temp.smoke_line(v_step,
               g.status = 'finished' and g.ended_reason = 'won' and g.winner_team_id = solo,
               g.status || ', ' || coalesce(g.ended_reason, '-'));

    v_log := v_log || pg_temp.smoke_refused('no more rolls after the win',
      format('select snakes_roll(%L)', g2), '%nobody moves%');

    perform pg_temp.smoke_as(v_admin);
    v_step := 'withdrawing the winning screenshot reopens the game';
    select id into ev from tile_evidence where claim_id = c100;
    res := admin_revoke_evidence(ev);
    select * into g from games where id = g2;
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'game_reopened')::boolean and g.status = 'active' and g.winner_team_id is null,
               g.status::text);

    v_step := 'Complete tile now on 100 wins again';
    perform admin_snakes_complete_tile(solo);
    select * into g from games where id = g2;
    v_log := v_log || pg_temp.smoke_line(v_step,
               g.status = 'finished' and g.ended_reason = 'won' and g.winner_team_id = solo, null);

    v_step := 'Undo completion of 100 reopens it';
    res := admin_snakes_uncomplete_tile(solo, 100);
    select * into g from games where id = g2;
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'game_reopened')::boolean and g.status = 'active', g.status::text);

    v_step := 'every game 2 event has a Discord line';
    select count(*) into n from game_events e
     where e.game_id = g2 and (discord_line(e) is null or discord_line(e) = e.type::text);
    v_log := v_log || pg_temp.smoke_line(v_step, n = 0, n || ' without a line');

    for s in
      select discord_line(e) from game_events e
       where e.game_id = g2 and e.type in ('game_ended', 'team_moved')
       order by e.created_at limit 2
    loop
      v_log := v_log || E'\nINFO  ' || s;
    end loop;

    -- ========================================================
    -- Game 4: ladders
    -- ========================================================
    perform pg_temp.smoke_as(v_admin);
    v_step := 'create game 4 with three ladders and two snakes';
    g4 := admin_new_game('Smoke snakes 4', 'snakes', array['Ladder'], 10::smallint, null);
    select id into lad from teams where game_id = g4;
    n := admin_set_snakes(g4, '[{"from":4,"to":14},{"from":9,"to":31},{"from":62,"to":80},
                               {"from":17,"to":7},{"from":40,"to":22}]'::jsonb);
    v_log := v_log || pg_temp.smoke_line(v_step, n = 5, n || ' placed');

    -- Every square but the five starts, and leave 50 empty too for now.
    for r in 1 .. 10 loop
      for k in 1 .. 10 loop
        if ((r - 1) * 10 + k) not in (4, 9, 17, 40, 50, 62) then
          perform admin_set_tile(g4, r::smallint, k::smallint,
                    jsonb_build_object('name', 'Smoke tile ' || ((r - 1) * 10 + k)));
        end if;
      end loop;
    end loop;
    perform admin_set_member(lad, v_red, 'captain');
    v_log := v_log || pg_temp.smoke_refused('an ordinary empty square still stops the start',
      format('select start_game(%L)', g4), '%1 missing (50)%');

    -- The random deal fills the one ordinary empty square and nothing else:
    -- a task on a snake head or a ladder's foot would never be played.
    v_step := 'the random deal leaves snake heads and ladder feet empty';
    insert into tile_library (name) values ('Smoke autofill tile');
    res := admin_autofill_board(g4);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'filled')::int = 1 and (res ->> 'empty')::int = 1
               and exists (select 1 from tiles where game_id = g4 and position = 50)
               and not exists (select 1 from tiles where game_id = g4
                                and position in (4, 9, 17, 40, 62)),
               res::text);

    v_step := 'starts with no task on snake heads and ladder feet';
    perform start_game(g4);
    v_log := v_log || pg_temp.smoke_line(v_step, (select status from games where id = g4) = 'active',
               (select count(*) from tiles where game_id = g4) || ' tiles');

    v_step := 'a 4 from Start climbs the ladder to 14';
    perform pg_temp.smoke_as(v_red);
    res := snakes_move(lad, 'roll', array[4]);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'landed')::int = 4 and (res ->> 'to')::int = 14
               and (res -> 'jumps' -> 0 ->> 'to')::int = 14,
               (res ->> 'landed') || ' -> ' || (res ->> 'to'));

    v_log := v_log || pg_temp.smoke_refused('the organiser cannot park a team on a ladder''s foot',
      format('select pg_temp.smoke_done(%L, %L, 9)', v_admin, lad), '%bottom of a ladder%');

    v_step := 'after a ladder, finished tiles are skipped (5 + 4 = 9 -> 31 done -> 32)';
    perform pg_temp.smoke_done(v_admin, lad, 31);
    perform pg_temp.smoke_done(v_admin, lad, 5);
    perform pg_temp.smoke_as(v_red);
    res := snakes_move(lad, 'roll', array[4]);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'to')::int = 32 and (res -> 'jumps' -> 0 ->> 'then')::int = 32,
               'on ' || (res ->> 'to'));

    v_step := 'a ladder in reach is no reason for the long skip (60: 61, 63-66 done -> 62 -> 80)';
    for k in 60 .. 66 loop
      if k <> 62 then perform pg_temp.smoke_done(v_admin, lad, k); end if;
    end loop;
    perform admin_snakes_move(lad, 60);
    perform pg_temp.smoke_as(v_red);
    res := snakes_move(lad, 'roll', array[1]);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'to')::int = 80 and not (res ->> 'long_skip')::boolean,
               'on ' || (res ->> 'to') || ', long_skip=' || (res ->> 'long_skip'));

    v_step := 'a snake bites once per move: 22-39 all done, 38 + 2 = 40 -> 22, skip on to 41';
    for k in 22 .. 39 loop
      if k <> 31 then perform pg_temp.smoke_done(v_admin, lad, k); end if;
    end loop;
    perform admin_snakes_move(lad, 38);
    perform pg_temp.smoke_as(v_red);
    res := snakes_move(lad, 'roll', array[2]);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'to')::int = 41 and jsonb_array_length(res -> 'jumps') = 1
               and (res -> 'jumps' -> 0 ->> 'then')::int = 41,
               'on ' || coalesce(res ->> 'to', '-'));

    v_step := 'game 4 board shows five jumps, and the ladder in Discord';
    res := board_for_me(g4);
    select discord_line(e) into s from game_events e
     where e.game_id = g4 and e.type = 'team_moved' and e.payload -> 'jumps' -> 0 ->> 'from' = '4';
    v_log := v_log || pg_temp.smoke_line(v_step,
               jsonb_array_length(res -> 'jumps') = 5 and s like '%Ladder on 4, up to 14!%', s);
    perform pg_temp.smoke_as(v_admin);

    v_step := 'reset game 1: everyone back at Start, snakes kept';
    perform admin_reset_game(g1);
    select count(*) filter (where board_tile = 0 and rollbacks_available = 0 and rollbacks_used = 0
                                  and not auto_rollback_earned),
           count(*)
      into n, x
      from teams where game_id = g1;
    select count(*) into y from board_jumps where game_id = g1;
    v_log := v_log || pg_temp.smoke_line(v_step,
               (select status from games where id = g1) = 'placement' and n = x and y = 6
               and not exists (select 1 from tile_claims c join teams t on t.id = c.team_id
                                where t.game_id = g1),
               n || '/' || x || ' teams reset, ' || y || ' snakes');

    -- ========================================================
    -- Game 3: battleships still has its own rules
    -- ========================================================
    v_step := 'battleships still means exactly two teams';
    g3 := admin_new_game('Smoke battleships', 'battleships', array['A', 'B'], 10::smallint, null);
    v_log := v_log || pg_temp.smoke_refused(v_step,
      format('select admin_add_team(%L, %L)', g3, 'C'), '%exactly two teams%');

    v_step := 'done';
  exception when others then
    v_log := v_log || E'\n\nSTOPPED at "' || v_step || '": ' || sqlerrm;
  end;

  raise exception using message =
    E'SNAKES SMOKE TEST -- this error is deliberate: it rolled everything back, nothing was saved.\n'
    || (select count(*) from regexp_matches(v_log, E'\nPASS', 'g')) || ' passed, '
    || (select count(*) from regexp_matches(v_log, E'\nFAIL', 'g')) || ' failed'
    || case when v_step <> 'done' then ', and it stopped early' else '' end
    || E'\n' || v_log;
end;
$smoke$;
