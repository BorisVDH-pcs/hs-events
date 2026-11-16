-- HS_Battleships -- Region Bingo smoke test that leaves nothing behind
--
-- Paste the whole file into the Supabase SQL editor and press Run.
--
-- It plays two small Region Bingo games end to end, through the same functions
-- the site calls, as five throwaway accounts that exist only inside this run:
--
--   Smoke Organiser (admin)        Smoke Red  (Red captain)
--   Smoke Mate      (Red member)   Smoke Blue (Blue captain)
--   Smoke Outsider  (on no team)
--
-- No real account is put on a team, and nothing is kept: the whole test is one
-- DO block that ALWAYS ends by raising an error, which rolls every change back.
-- Because nothing commits, no Discord message is sent and no realtime update
-- reaches an open page.
--
-- So the editor will show this as an ERROR. That is the point: the error text
-- IS the report, one PASS/FAIL line per check. Look for any line starting with
-- FAIL, or a "STOPPED at" line if something broke part-way.
--
-- The board (docs/region-bingo-rules.md): region k owns squares (k-1)*9+1 to
-- k*9, square 100 none. Game 1 puts
--   Misthalin  squares 1, 2, 3   worth 2, 3, 5  (total 10, needs 5 at 50%)
--   Asgarnia   squares 10, 11    worth 4, 4     (total 8,  needs 4)
--   the other nine regions       one tile each, worth 1
--
-- The games:
--   1. Red v Blue -- set-up refusals, the captain's first pick, hidden tiles,
--      a region completed and its pick spent by a member, revokes before and
--      after a pick is spent, the timer, a revoke after the end that moves the
--      winner, and a reset.
--   2. One team, the board copied from game 1 through a saved board -- the
--      points come along; the organiser ends it; nobody scored, nobody wins.

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
  select E'\n' || case when coalesce(p_ok, false) then 'PASS  ' else 'FAIL  ' end
         || p_step || coalesce(' -- ' || p_detail, '');
$$;

-- A tile on square p of a 10x10 card, worth w.
create function pg_temp.smoke_tile(p_game uuid, p_square int, p_worth int)
returns uuid language plpgsql as $$
declare v uuid;
begin
  v := admin_set_tile(p_game, ((p_square - 1) / 10 + 1)::smallint, ((p_square - 1) % 10 + 1)::smallint,
                      jsonb_build_object('name', 'Smoke secret ' || p_square));
  perform admin_set_tile_worth(p_game, p_square, p_worth);
  return v;
end;
$$;

-- A player opens tile p_tile for their team and files one screenshot.
create function pg_temp.smoke_complete(p_game uuid, p_team uuid, p_tile uuid)
returns jsonb language plpgsql as $$
declare c uuid;
begin
  c := regions_open_tile(p_tile);
  return add_evidence(c, p_game || '/' || p_team || '/' || c || '/smoke-' || gen_random_uuid() || '.png',
                      null, null, null);
end;
$$;

do $smoke$
declare
  v_log   text := '';
  v_step  text := 'creating the throwaway accounts';
  v_admin uuid := gen_random_uuid();
  v_red   uuid := gen_random_uuid();
  v_mate  uuid := gen_random_uuid();
  v_blue  uuid := gen_random_uuid();
  v_out   uuid := gen_random_uuid();
  g1 uuid; g2 uuid;
  red uuid; blue uuid; solo uuid;
  t uuid[] := array_fill(null::uuid, array[100]);
  ev uuid; preset uuid;
  res jsonb; st jsonb;
  s text;
  n int; n2 int; n3 int; n4 int;
  w uuid; b boolean; b2 boolean;
  g games%rowtype;
  k int;
begin
  begin  -- everything; a surprise is caught below so the report survives

    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
           u.email, '', '{}'::jsonb, jsonb_build_object('display_name', u.name), now(), now()
      from (values
              (v_admin, 'smoke-admin@players.hs-battleships.invalid',    'Smoke Organiser'),
              (v_red,   'smoke-red@players.hs-battleships.invalid',      'Smoke Red'),
              (v_mate,  'smoke-mate@players.hs-battleships.invalid',     'Smoke Mate'),
              (v_blue,  'smoke-blue@players.hs-battleships.invalid',     'Smoke Blue'),
              (v_out,   'smoke-outsider@players.hs-battleships.invalid', 'Smoke Outsider')
           ) as u(id, email, name);
    update profiles set is_admin = true where id = v_admin;

    select count(*) into n from profiles where id in (v_admin, v_red, v_mate, v_blue, v_out);
    v_log := v_log || pg_temp.smoke_line('five throwaway profiles made', n = 5, n || ' profiles');

    -- ========================================================
    -- Game 1: setting it up
    -- ========================================================
    perform pg_temp.smoke_as(v_red);
    v_step := 'a player cannot create a game';
    begin
      perform admin_new_game('Smoke', 'regions', array['A'], 10::smallint, null);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was allowed');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, true, sqlerrm);
    end;

    perform pg_temp.smoke_as(v_admin);
    v_step := 'create game 1 (Red v Blue, ends tomorrow): always the 10x10 card';
    g1 := admin_new_game('Smoke regions 1', 'regions', array['Red', 'Blue'], 3::smallint,
                         now() + interval '1 day');
    select * into g from games where id = g1;
    select id into red  from teams where game_id = g1 and slot = 1;
    select id into blue from teams where game_id = g1 and slot = 2;
    v_log := v_log || pg_temp.smoke_line(v_step,
               g.mode = 'regions' and g.status = 'setup' and g.grid_size = 10
               and g.region_threshold = 50 and red is not null and blue is not null,
               g.mode || ', ' || g.status || ', ' || g.grid_size || 'x' || g.grid_size
               || ', ' || g.region_threshold || '%');

    v_step := 'a threshold of 0% is refused';
    begin
      perform admin_set_region_threshold(g1, 0);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was saved');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%1 to 100%', sqlerrm);
    end;

    v_step := 'place Misthalin (2, 3, 5), Asgarnia (4, 4) and a tile on square 100';
    t[1]  := pg_temp.smoke_tile(g1, 1, 2);
    t[2]  := pg_temp.smoke_tile(g1, 2, 3);
    t[3]  := pg_temp.smoke_tile(g1, 3, 5);
    t[10] := pg_temp.smoke_tile(g1, 10, 4);
    t[11] := pg_temp.smoke_tile(g1, 11, 4);
    t[100] := pg_temp.smoke_tile(g1, 100, 1);
    select count(*), sum(worth) into n, n2 from admin_tile_worths(g1);
    v_log := v_log || pg_temp.smoke_line(v_step, n = 6 and n2 = 19, n || ' tiles, ' || n2 || ' points');

    v_step := 'a tile worth 0 is refused';
    begin
      perform admin_set_tile_worth(g1, 1, 0);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was saved');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%1 to 100 points%', sqlerrm);
    end;

    v_step := 'points on an empty square are refused';
    begin
      perform admin_set_tile_worth(g1, 4, 3);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was saved');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%no tile on that square%', sqlerrm);
    end;

    v_step := 'x% rounds up: 33% of 10 needs 4, of 8 needs 3';
    perform admin_set_region_threshold(g1, 33);
    select need into n  from regions_totals(g1) where region = 'misthalin';
    select need into n2 from regions_totals(g1) where region = 'asgarnia';
    v_log := v_log || pg_temp.smoke_line(v_step, n = 4 and n2 = 3, 'Misthalin ' || n || ', Asgarnia ' || n2);
    perform admin_set_region_threshold(g1, 50);

    v_step := 'cannot start with a tile on square 100';
    begin
      perform start_game(g1);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it started');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%square 100%', sqlerrm);
    end;

    perform admin_clear_tile(g1, 10::smallint, 10::smallint);
    v_step := 'cannot start with empty regions, and says which';
    begin
      perform start_game(g1);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it started');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step,
                 sqlerrm ilike '%Still empty: Kandarin, Fremennik%Varlamore'
                 and sqlerrm not ilike '%Misthalin%', sqlerrm);
    end;

    v_step := 'one tile, worth 1, in each of the other nine regions';
    for k in 3 .. 11 loop
      t[(k - 1) * 9 + 1] := pg_temp.smoke_tile(g1, (k - 1) * 9 + 1, 1);
    end loop;
    select count(*), sum(total) into n, n2 from regions_totals(g1) where tiles > 0;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 11 and n2 = 27, n || ' regions, ' || n2 || ' points');

    v_step := 'cannot start without captains, and says which teams';
    perform admin_set_member(red,  v_red,  'member');
    perform admin_set_member(red,  v_mate, 'member');
    perform admin_set_member(blue, v_blue, 'member');
    begin
      perform start_game(g1);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it started');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike 'Red and Blue each need a captain%', sqlerrm);
    end;

    perform admin_set_member(blue, v_blue, 'captain');
    v_step := 'still refused while Red has no captain';
    begin
      perform start_game(g1);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it started');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike 'Red needs a captain%', sqlerrm);
    end;

    perform admin_set_member(red, v_red, 'captain');
    v_step := 'starts once every region has a tile and every team a captain';
    perform start_game(g1);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (select status from games where id = g1) = 'active', null);

    v_step := 'points are fixed once the game has started';
    begin
      perform admin_set_tile_worth(g1, 1, 9);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was saved');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%fixed once%', sqlerrm);
    end;

    v_step := 'the threshold is fixed once the game has started';
    begin
      perform admin_set_region_threshold(g1, 60);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was saved');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%fixed once%', sqlerrm);
    end;

    -- ========================================================
    -- Game 1: the first region
    -- ========================================================
    -- Read as the site reads it: the authenticated role, through board_for_me.
    perform pg_temp.smoke_as(v_red);
    v_step := 'before its first pick Red sees no tiles and no region totals';
    execute 'set local role authenticated';
    res := board_for_me(g1);
    execute 'reset role';
    st := res -> 'regions';
    v_log := v_log || pg_temp.smoke_line(v_step,
               jsonb_array_length(res -> 'tiles') = 0
               and (st ->> 'needs_start')::boolean and (st ->> 'picks')::int = 0
               and (st ->> 'is_captain')::boolean and (st ->> 'threshold')::int = 50
               and jsonb_array_length(st -> 'regions') = 11
               and not (st -> 'regions' -> 0 ? 'total')
               and st -> 'worth' = '{}'::jsonb,
               jsonb_array_length(res -> 'tiles') || ' tiles, needs_start ' || (st ->> 'needs_start'));

    v_step := 'board_for_me carries the region standings';
    v_log := v_log || pg_temp.smoke_line(v_step,
               jsonb_array_length(res -> 'standings') = 2
               and (res -> 'standings' -> 0 ->> 'needs_start')::boolean,
               jsonb_array_length(res -> 'standings') || ' rows');

    perform pg_temp.smoke_as(v_mate);
    v_step := 'a member who is not the captain cannot pick the first region';
    begin
      perform regions_pick(g1, 'misthalin');
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was picked');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%captain picks%', sqlerrm);
    end;

    v_step := 'and Mate''s screen knows Mate is not the captain';
    st := regions_state(g1, red);
    v_log := v_log || pg_temp.smoke_line(v_step, st -> 'is_captain' = 'false'::jsonb, st ->> 'is_captain');

    perform pg_temp.smoke_as(v_out);
    v_step := 'someone on no team cannot pick';
    begin
      perform regions_pick(g1, 'misthalin');
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was picked');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%not a member%', sqlerrm);
    end;

    perform pg_temp.smoke_as(v_red);
    v_step := 'a region that does not exist is refused';
    begin
      perform regions_pick(g1, 'atlantis');
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was picked');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%no such region%', sqlerrm);
    end;

    v_step := 'Red''s captain picks Misthalin';
    res := regions_pick(g1, 'misthalin');
    select count(*) into n from tiles_for_me(g1);
    select count(*) into n2 from game_events
     where game_id = g1 and team_id = red and type = 'region_opened';
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'first')::boolean and res ->> 'funded_by' is null and n = 3 and n2 = 1,
               n || ' tiles visible, ' || n2 || ' region_opened');

    v_step := 'Red now sees Misthalin''s totals and points, nothing else''s';
    st := regions_state(g1, red);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (st -> 'regions' -> 0 ->> 'total')::int = 10
               and (st -> 'regions' -> 0 ->> 'need')::int = 5
               and not (st -> 'regions' -> 1 ? 'total')
               and (select count(*) from jsonb_object_keys(st -> 'worth')) = 3
               and not (st ->> 'needs_start')::boolean,
               'worth map ' || (st -> 'worth')::text);

    v_step := 'no second pick before a region is complete';
    begin
      perform regions_pick(g1, 'asgarnia');
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was picked');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, position('reach 50% of' in sqlerrm) > 0, sqlerrm);
    end;

    v_step := 'picking a region twice is refused';
    begin
      perform regions_pick(g1, 'misthalin');
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was picked');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%already has Misthalin%', sqlerrm);
    end;

    v_step := 'a tile in a region the team has not opened cannot be started';
    begin
      perform regions_open_tile(t[10]);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it opened');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%not opened that region%', sqlerrm);
    end;

    perform pg_temp.smoke_as(v_blue);
    v_step := 'Blue sees nothing of Misthalin; its captain picks Asgarnia';
    select count(*) into n from tiles_for_me(g1);
    perform regions_pick(g1, 'asgarnia');
    select count(*) into n2 from tiles_for_me(g1);
    select count(*) into n3 from tiles_for_me(g1) x where x.position <= 9;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 0 and n2 = 2 and n3 = 0,
               n || ' then ' || n2 || ' tiles, ' || n3 || ' of Misthalin');

    -- ========================================================
    -- Game 1: completing a region, spending the pick
    -- ========================================================
    perform pg_temp.smoke_as(v_red);
    v_step := 'Red completes square 1 (2 points): no region yet';
    res := pg_temp.smoke_complete(g1, red, t[1]);
    select count(*) into n from game_events
     where game_id = g1 and team_id = red and type = 'region_completed';
    select payload into st from game_events
     where game_id = g1 and team_id = red and type = 'tile_completed';
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'completed')::boolean and n = 0
               and st ->> 'region' = 'misthalin' and (st ->> 'points')::int = 2,
               coalesce(st::text, 'no event'));

    v_step := 'the public tile_completed event does not name the tile';
    v_log := v_log || pg_temp.smoke_line(v_step,
               not (st ? 'tile_name') and position('Smoke secret' in st::text) = 0, null);

    v_step := 'square 2 (3 more) takes Misthalin to 5 of 10: complete, one pick';
    res := pg_temp.smoke_complete(g1, red, t[2]);
    select count(*) into n from game_events
     where game_id = g1 and team_id = red and type = 'region_completed';
    select picks into n2 from regions_standings(g1) where team_id = red;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 1 and n2 = 1,
               n || ' region_completed, ' || n2 || ' pick(s)');

    perform pg_temp.smoke_as(v_mate);
    v_step := 'any member spends the pick: Mate opens Kandarin, paid for by Misthalin';
    res := regions_pick(g1, 'kandarin');
    select count(*) into n from tiles_for_me(g1);
    select picks into n2 from regions_standings(g1) where team_id = red;
    v_log := v_log || pg_temp.smoke_line(v_step,
               not (res ->> 'first')::boolean and res ->> 'funded_by' = 'misthalin'
               and n = 4 and n2 = 0,
               n || ' tiles visible, ' || n2 || ' pick(s) left');

    v_step := 'one complete region pays for one pick';
    begin
      perform regions_pick(g1, 'wilderness');
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was picked');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike 'No pick yet%', sqlerrm);
    end;

    perform pg_temp.smoke_as(v_red);
    v_step := 'square 3 (5 more): Misthalin does not pay twice';
    res := pg_temp.smoke_complete(g1, red, t[3]);
    select count(*) into n from game_events
     where game_id = g1 and team_id = red and type = 'region_completed';
    select points, picks into n2, n3 from regions_standings(g1) where team_id = red;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 1 and n2 = 10 and n3 = 0,
               n || ' region_completed, ' || n2 || ' points, ' || n3 || ' pick(s)');

    v_step := 'Discord: the first region, a later one, a tile, a region';
    select discord_line(e) into s from game_events e
     where e.game_id = g1 and e.team_id = red and e.type = 'region_opened'
       and (e.payload ->> 'first')::boolean;
    b := s ilike '%Red** starts in **Misthalin%';
    select discord_line(e) into s from game_events e
     where e.game_id = g1 and e.team_id = red and e.type = 'region_opened'
       and not (e.payload ->> 'first')::boolean;
    b := b and s ilike '%Red** opened **Kandarin%';
    select discord_line(e) into s from game_events e
     where e.game_id = g1 and e.team_id = red and e.type = 'tile_completed'
       and e.payload ->> 'worth' = '5';
    b := b and s ilike '%completed a tile in **Misthalin** (+5)%10 points%'
           and s not ilike '%Smoke secret%' and s not ilike '% at %';
    select discord_line(e) into s from game_events e
     where e.game_id = g1 and e.team_id = red and e.type = 'region_completed';
    b := b and s ilike '%reached 50% of **Misthalin** and can pick%';
    v_log := v_log || pg_temp.smoke_line(v_step, b, s);

    -- What Blue can reach, read as the site reads it.
    perform pg_temp.smoke_as(v_blue);
    v_step := 'reading as Blue under row-level security';
    execute 'set local role authenticated';
    select count(*) into n from region_unlocks;
    select count(*) into n2 from game_events
     where game_id = g1 and team_id = red
       and type in ('region_opened', 'region_completed', 'tile_completed');
    select count(*) into n3 from game_events
     where game_id = g1 and team_id = red and type = 'evidence_submitted';
    select count(*) into n4 from tiles_for_me(g1);
    begin
      perform regions_state(g1, red);
      b := true;
    exception when others then
      b := false;
    end;
    begin
      perform regions_totals(g1);
      b2 := true;
    exception when others then
      b2 := false;
    end;
    res := board_for_me(g1);
    execute 'reset role';
    v_log := v_log || pg_temp.smoke_line('Blue cannot read region_unlocks directly', n = 0, n || ' rows');
    v_log := v_log || pg_temp.smoke_line('Red''s regions and tiles completed are public', n2 = 6, n2 || ' events');
    v_log := v_log || pg_temp.smoke_line('Red''s submissions (with tile names) are not', n3 = 0, n3 || ' visible');
    v_log := v_log || pg_temp.smoke_line('Blue still sees only Asgarnia''s two tiles', n4 = 2, n4 || ' tiles');
    v_log := v_log || pg_temp.smoke_line('Blue cannot read Red''s region state', not b, null);
    v_log := v_log || pg_temp.smoke_line('Blue cannot read the region totals', not b2, null);
    v_log := v_log || pg_temp.smoke_line('Blue''s board shows Misthalin locked, no totals',
               not (res -> 'regions' -> 'regions' -> 0 ->> 'opened')::boolean
               and not (res -> 'regions' -> 'regions' -> 0 ? 'total')
               and (res -> 'regions' -> 'regions' -> 1 ->> 'total')::int = 8, null);

    -- ========================================================
    -- Game 1: revokes
    -- ========================================================
    v_step := 'Blue completes square 10 (4 of 8): Asgarnia complete, one pick';
    res := pg_temp.smoke_complete(g1, blue, t[10]);
    select picks into n from regions_standings(g1) where team_id = blue;
    v_log := v_log || pg_temp.smoke_line(v_step, (res ->> 'completed')::boolean and n = 1, n || ' pick(s)');

    perform pg_temp.smoke_as(v_admin);
    v_step := 'a revoke before the pick is spent takes the pick back';
    select e.id into ev from tile_evidence e join tile_claims c on c.id = e.claim_id
     where c.team_id = blue and c.tile_id = t[10];
    res := admin_revoke_evidence(ev, false);
    select picks, points into n, n2 from regions_standings(g1) where team_id = blue;
    v_log := v_log || pg_temp.smoke_line(v_step, (res ->> 'uncompleted')::boolean and n = 0 and n2 = 0,
               n || ' pick(s), ' || n2 || ' points');

    perform pg_temp.smoke_as(v_blue);
    v_step := 'so Blue cannot pick';
    begin
      perform regions_pick(g1, 'kandarin');
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was picked');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike 'No pick yet%', sqlerrm);
    end;

    v_step := 'Blue redoes square 10, gets the pick back and opens Kandarin';
    res := pg_temp.smoke_complete(g1, blue, t[10]);
    res := regions_pick(g1, 'kandarin');
    v_log := v_log || pg_temp.smoke_line(v_step, res ->> 'funded_by' = 'asgarnia', res::text);

    perform pg_temp.smoke_as(v_admin);
    v_step := 'a revoke after the pick is spent leaves Kandarin open';
    select e.id into ev from tile_evidence e join tile_claims c on c.id = e.claim_id
     where c.team_id = blue and c.tile_id = t[10];
    res := admin_revoke_evidence(ev, false);
    perform pg_temp.smoke_as(v_blue);
    select count(*) into n from tiles_for_me(g1);
    select picks, points into n2, n3 from regions_standings(g1) where team_id = blue;
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'uncompleted')::boolean and n = 3 and n2 = 0 and n3 = 0,
               n || ' tiles visible, ' || n2 || ' pick(s), ' || n3 || ' points');

    v_step := 'back over the line on square 11: Asgarnia does not pay twice';
    res := pg_temp.smoke_complete(g1, blue, t[11]);
    select picks, points into n, n2 from regions_standings(g1) where team_id = blue;
    select count(*) into n3 from game_events
     where game_id = g1 and team_id = blue and type = 'region_completed';
    v_log := v_log || pg_temp.smoke_line(v_step, n = 0 and n2 = 4 and n3 = 2,
               n || ' pick(s), ' || n2 || ' points, ' || n3 || ' region_completed');

    v_step := 'standings: Red 10 first, Blue 4 second';
    select points, place into n, n2 from regions_standings(g1) where team_id = red;
    select points, place into n3, n4 from regions_standings(g1) where team_id = blue;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 10 and n2 = 1 and n3 = 4 and n4 = 2,
               'Red ' || n || ' (' || n2 || '), Blue ' || n3 || ' (' || n4 || ')');

    v_step := 'regions open and complete per team';
    v_log := v_log || pg_temp.smoke_line(v_step,
               (select regions_open = '{misthalin,kandarin}' and regions_complete = '{misthalin}'
                  from regions_standings(g1) where team_id = red)
               and (select regions_open = '{asgarnia,kandarin}' and regions_complete = '{asgarnia}'
                      from regions_standings(g1) where team_id = blue),
               (select string_agg(team_name || ' ' || regions_open::text || ' ' || regions_complete::text, '; ')
                  from regions_standings(g1)));

    -- ========================================================
    -- Game 1: the timer
    -- ========================================================
    perform pg_temp.smoke_as(v_admin);
    v_step := 'the organiser can move the end time';
    perform admin_set_end_time(g1, now() + interval '2 hours');
    v_log := v_log || pg_temp.smoke_line(v_step,
               (select ends_at from games where id = g1) = now() + interval '2 hours', null);

    v_step := 'settling before the deadline does nothing';
    b := regions_settle(g1);
    v_log := v_log || pg_temp.smoke_line(v_step,
               not b and (select status from games where id = g1) = 'active', null);

    -- The clock cannot be wound forward inside a transaction, so the deadline
    -- is brought back to now instead.
    update games set ends_at = now() where id = g1;

    perform pg_temp.smoke_as(v_red);
    v_step := 'after the deadline, starting a tile is refused';
    begin
      perform regions_open_tile(t[19]);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it opened');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%Time is up%', sqlerrm);
    end;

    v_step := 'and so is a pick';
    begin
      perform regions_pick(g1, 'wilderness');
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was picked');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%Time is up%', sqlerrm);
    end;

    v_step := 'the first page to notice records the result: Red wins on points';
    b := regions_settle(g1);
    select * into g from games where id = g1;
    v_log := v_log || pg_temp.smoke_line(v_step,
               b and g.status = 'finished' and g.ended_reason = 'time_up'
               and g.winner_team_id = red and g.ended_at = g.ends_at,
               g.status || ', ' || coalesce(g.ended_reason, 'no reason') || ', winner '
               || coalesce((select name from teams where id = g.winner_team_id), 'none'));

    v_step := 'settling twice does nothing';
    b := regions_settle(g1);
    select count(*) into n from game_events where game_id = g1 and type = 'game_ended';
    v_log := v_log || pg_temp.smoke_line(v_step, not b and n = 1, n || ' game_ended event(s)');

    v_step := 'Discord: the winner and the points';
    select discord_line(e) into s from game_events e where e.game_id = g1 and e.type = 'game_ended';
    v_log := v_log || pg_temp.smoke_line(v_step, s ilike '%Red** wins with 10 points%', s);

    perform pg_temp.smoke_as(v_blue);
    v_step := 'once it is over every tile and total is shown';
    select count(*) into n from tiles_for_me(g1);
    st := regions_state(g1, blue);
    v_log := v_log || pg_temp.smoke_line(v_step,
               n = 14 and (st -> 'regions' -> 0 ->> 'total')::int = 10
               and (select count(*) from jsonb_object_keys(st -> 'worth')) = 14,
               n || ' tiles');

    -- ========================================================
    -- Game 1: a revoke after the end moves the winner
    -- ========================================================
    perform pg_temp.smoke_as(v_admin);
    v_step := 'revoking Red''s squares 3 and 2 leaves Red 2 v Blue 4: Blue wins';
    select e.id into ev from tile_evidence e join tile_claims c on c.id = e.claim_id
     where c.team_id = red and c.tile_id = t[3];
    perform admin_revoke_evidence(ev, false);
    select e.id into ev from tile_evidence e join tile_claims c on c.id = e.claim_id
     where c.team_id = red and c.tile_id = t[2];
    res := admin_revoke_evidence(ev, false);
    select * into g from games where id = g1;
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'winner_changed')::boolean and g.winner_team_id = blue and g.status = 'finished',
               'winner ' || coalesce((select name from teams where id = g.winner_team_id), 'none'));

    v_step := 'and Red keeps Kandarin';
    v_log := v_log || pg_temp.smoke_line(v_step,
               exists (select 1 from region_unlocks where team_id = red and region = 'kandarin'), null);

    v_step := 'save game 1''s board';
    res := admin_save_board_preset(g1, 'Smoke regions board ' || gen_random_uuid());
    preset := (res ->> 'id')::uuid;
    v_log := v_log || pg_temp.smoke_line(v_step, preset is not null, res::text);

    v_step := 'reset game 1: every region locked again';
    perform admin_reset_game(g1, true);
    select count(*) into n from region_unlocks where game_id = g1;
    v_log := v_log || pg_temp.smoke_line(v_step,
               n = 0 and (select status from games where id = g1) in ('setup', 'placement'),
               n || ' unlocks left, ' || (select status from games where id = g1));

    -- ========================================================
    -- Game 2: a saved board, the organiser ends it
    -- ========================================================
    v_step := 'create game 2 and lay game 1''s saved board on it: the points come along';
    g2 := admin_new_game('Smoke regions 2', 'regions', array['Solo'], 10::smallint, null);
    select id into solo from teams where game_id = g2;
    perform admin_apply_board_preset(g2, preset);
    select count(*), sum(worth) into n, n2 from admin_tile_worths(g2);
    select worth into n3 from admin_tile_worths(g2) where position = 3;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 14 and n2 = 27 and n3 = 5,
               n || ' tiles, ' || n2 || ' points, square 3 worth ' || n3);

    v_step := 'End game now on a game in set-up is refused';
    begin
      perform admin_end_game(g2);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was allowed');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%not running%', sqlerrm);
    end;

    perform admin_set_member(solo, v_red, 'captain');
    perform start_game(g2);
    v_step := 'End game now: finished, nobody scored, no winner';
    w := admin_end_game(g2);
    select * into g from games where id = g2;
    v_log := v_log || pg_temp.smoke_line(v_step,
               w is null and g.status = 'finished' and g.ended_reason = 'admin'
               and g.winner_team_id is null,
               g.status || ', ' || coalesce(g.ended_reason, 'no reason'));

    v_step := 'Discord: nobody wins';
    select discord_line(e) into s from game_events e where e.game_id = g2 and e.type = 'game_ended';
    v_log := v_log || pg_temp.smoke_line(v_step, s ilike '%Nobody scored, so nobody wins%', s);

    v_step := 'ending it twice is refused';
    begin
      perform admin_end_game(g2);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was allowed');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%not running%', sqlerrm);
    end;

    v_step := 'done';
  exception when others then
    v_log := v_log || E'\n\nSTOPPED at "' || v_step || '": ' || sqlerrm;
  end;

  raise exception using message =
    E'REGION BINGO SMOKE TEST -- this error is deliberate: it rolled everything back, nothing was saved.\n'
    || (select count(*) from regexp_matches(v_log, E'\nPASS', 'g')) || ' passed, '
    || (select count(*) from regexp_matches(v_log, E'\nFAIL', 'g')) || ' failed'
    || case when v_step <> 'done' then ', and it stopped early' else '' end
    || E'\n' || v_log;
end;
$smoke$;
