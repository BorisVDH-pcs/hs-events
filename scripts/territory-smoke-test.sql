-- High Society Events -- Territory smoke test that leaves nothing behind
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
-- PASS/FAIL line per check. Look for FAIL, or a "STOPPED at" line if something
-- broke part-way.
--
-- The games:
--   1. Red (Lumbridge), Blue (Ardougne), Green (Canifis) -- set-up refusals,
--      homes, opening, the 2-place limit, giving up and coming back, capture,
--      a steal and a retake, the attack alert, a whole region, revoking a
--      capture, ending early, reset.
--   2. Two teams on a timer -- teams join with the next free home, dealing
--      tasks skips the homes, the timer runs out with nothing taken.

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

-- Who holds a place, by team name ('-' when nobody does).
create function pg_temp.smoke_owner(p_game uuid, p_place text) returns text
language sql as $$
  select coalesce((select te.name from teams te
                    where te.id = territory_owner(p_game, p_place)), '-');
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
  g1 uuid; g2 uuid;
  red uuid; blue uuid; green uuid; t3 uuid;
  c uuid; c_dr uuid; c_va uuid; c_wt uuid; c_gv uuid; c_bv uuid; c_ed uuid;
  ev uuid;
  res jsonb;
  n int; x int; y int;
  s text;
  g games%rowtype;
  st record;
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

    v_step := 'the map is there: 64 places, 11 regions, every place linked';
    select count(*) into n from territory_places;
    select count(*) into x from territory_regions;
    select count(*) into y from territory_places p
     where not exists (select 1 from territory_links l where p.key in (l.a, l.b));
    v_log := v_log || pg_temp.smoke_line(v_step, n = 64 and x = 11 and y = 0,
               n || ' places, ' || x || ' regions, ' || y || ' unlinked, '
               || (select count(*) from territory_links) || ' links');

    -- ========================================================
    -- Game 1: creating it
    -- ========================================================
    perform pg_temp.smoke_as(v_red);
    v_log := v_log || pg_temp.smoke_refused('a player cannot create a game',
      $q$select admin_new_game('Smoke', 'territory', array['A'], 8::smallint, null)$q$, '%admins only%');

    perform pg_temp.smoke_as(v_admin);
    v_log := v_log || pg_temp.smoke_refused('territory needs a team',
      $q$select admin_new_game('Smoke', 'territory', array[]::text[], 8::smallint, null)$q$,
      '%at least one team%');
    v_log := v_log || pg_temp.smoke_refused('territory has at most six teams',
      $q$select admin_new_game('Smoke', 'territory', array['A','B','C','D','E','F','G'], 8::smallint, null)$q$,
      '%at most six teams%');

    v_step := 'create game 1 (Red, Blue, Green; a 5 is ignored, the card is 8x8)';
    g1 := admin_new_game('Smoke territory 1', 'territory', array['Red', 'Blue', 'Green'], 5::smallint, null);
    select * into g from games where id = g1;
    select id into red   from teams where game_id = g1 and slot = 1;
    select id into blue  from teams where game_id = g1 and slot = 2;
    select id into green from teams where game_id = g1 and slot = 3;
    v_log := v_log || pg_temp.smoke_line(v_step,
               g.mode = 'territory' and g.status = 'setup' and g.grid_size = 8,
               g.mode || ', ' || g.status || ', ' || g.grid_size || 'x' || g.grid_size);

    v_step := 'every team starts on its suggested home';
    select string_agg(home, ',' order by slot) into s from teams where game_id = g1;
    v_log := v_log || pg_temp.smoke_line(v_step, s = 'lumbridge,ardougne,canifis', s);

    v_log := v_log || pg_temp.smoke_refused('a territory card cannot be any size but 8',
      format('update games set grid_size = 9 where id = %L', g1), '%grid_size%');

    v_log := v_log || pg_temp.smoke_refused('cannot start with no tasks',
      format('select start_game(%L)', g1), '%every place but the homes needs a task%61 still have none%');

    -- ========================================================
    -- Homes
    -- ========================================================
    perform pg_temp.smoke_as(v_red);
    v_log := v_log || pg_temp.smoke_refused('a player cannot pick homes',
      format($q$select admin_set_territory_homes(%L, '{"%s":"varrock"}')$q$, g1, red), '%admins only%');

    perform pg_temp.smoke_as(v_admin);
    v_log := v_log || pg_temp.smoke_refused('a home must be a place on the map',
      format($q$select admin_set_territory_homes(%L, '{"%s":"atlantis"}')$q$, g1, red),
      '%atlantis is not a place on the map%');
    v_log := v_log || pg_temp.smoke_refused('two teams cannot share a home',
      format($q$select admin_set_territory_homes(%L, '{"%s":"ardougne"}')$q$, g1, red),
      '%Two teams have Ardougne as their home%');
    v_log := v_log || pg_temp.smoke_refused('Rellekka would wall the Fremennik isles off',
      format($q$select admin_set_territory_homes(%L, '{"%s":"rellekka"}')$q$, g1, red),
      '%could never reach%through Rellekka, a home that cannot be taken%');

    -- The same homes, and the same words, as the case in territory-selftest.mjs.
    v_step := 'homes that wall land off are refused, worded as the console words them';
    begin
      perform admin_set_territory_homes(g1, jsonb_build_object(red, 'varrock', blue, 'catherby', green, 'falador'));
      s := 'it was allowed';
    exception when others then
      s := sqlerrm;
    end;
    v_log := v_log || pg_temp.smoke_line(v_step,
               s = 'Green could never reach Canifis, Port Phasmatys, Mort Myre Swamp and 3 more: '
                   || 'the only way in is through Varrock and Catherby, homes that cannot be taken. '
                   || 'Pick another home there.', s);
    select string_agg(home, ',' order by slot) into s from teams where game_id = g1;
    v_log := v_log || pg_temp.smoke_line('a refused save changes nothing', s = 'lumbridge,ardougne,canifis', s);

    v_step := 'two teams can swap homes in one save';
    n := admin_set_territory_homes(g1, jsonb_build_object(red, 'ardougne', blue, 'lumbridge'));
    select string_agg(home, ',' order by slot) into s from teams where game_id = g1;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 2 and s = 'ardougne,lumbridge,canifis', s);
    perform admin_set_territory_homes(g1, jsonb_build_object(red, 'lumbridge', blue, 'ardougne'));

    -- ========================================================
    -- Tasks
    -- ========================================================
    v_step := 'fill the card, homes too (Wizards'' Tower and Varrock need two screenshots)';
    for r in 1 .. 8 loop
      for k in 1 .. 8 loop
        perform admin_set_tile(g1, r::smallint, k::smallint,
                  case when r = 1 and k in (3, 4)
                       then jsonb_build_object('name', 'Smoke two-shot ' || k, 'rule', 'points', 'amount', 2)
                       else jsonb_build_object('name', 'Smoke task ' || ((r - 1) * 10 + k)) end);
      end loop;
    end loop;
    select count(*) into n from tiles where game_id = g1;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 64, n || ' tasks');

    v_step := 'readiness counts the 61 places that need a task, not the homes';
    select tile_count, tiles_needed into x, y from admin_game_readiness() where game_id = g1;
    v_log := v_log || pg_temp.smoke_line(v_step, x = 61 and y = 61, x || ' of ' || y);

    v_log := v_log || pg_temp.smoke_refused('a task cannot be moved onto a home',
      format('select admin_swap_tiles(%L, 1, 2, 1, 1)', g1), '%a home needs no task%');


    -- ========================================================
    -- Players and the start
    -- ========================================================
    perform admin_set_member(red,  v_red,  'captain');
    perform admin_set_member(red,  v_red2, 'member');
    perform admin_set_member(blue, v_blue, 'captain');
    v_log := v_log || pg_temp.smoke_refused('a team with no players stops the start',
      format('select start_game(%L)', g1), '%Green has no players yet%');
    perform admin_set_member(green, v_green, 'captain');
    perform pg_temp.smoke_as(v_red);
    v_log := v_log || pg_temp.smoke_refused('nothing opens before the start',
      format('select territory_open_tile(%L, %L)', g1, 'draynor'), '%opens when the game starts%');
    perform pg_temp.smoke_as(v_admin);

    v_step := 'start game 1';
    perform start_game(g1);
    select discord_line(e) into s from game_events e where e.game_id = g1 and e.type = 'game_started';
    v_log := v_log || pg_temp.smoke_line(v_step,
               (select status from games where id = g1) = 'active' and s ilike '%conquest has begun%', s);

    v_log := v_log || pg_temp.smoke_refused('homes are fixed once it runs',
      format($q$select admin_set_territory_homes(%L, '{"%s":"varrock"}')$q$, g1, red), '%fixed once%');
    v_log := v_log || pg_temp.smoke_refused('no team joins a running territory game',
      format('select admin_add_team(%L, %L)', g1, 'Yellow'), '%before it starts%');

    -- ========================================================
    -- Opening
    -- ========================================================
    perform pg_temp.smoke_as(v_out);
    v_log := v_log || pg_temp.smoke_refused('an outsider cannot open a place',
      format('select territory_open_tile(%L, %L)', g1, 'draynor'), '%not a member of a team%');

    perform pg_temp.smoke_as(v_red);
    v_log := v_log || pg_temp.smoke_refused('your own home is yours already',
      format('select territory_open_tile(%L, %L)', g1, 'lumbridge'), '%This is your home%');
    v_log := v_log || pg_temp.smoke_refused('a rival''s home cannot be taken',
      format('select territory_open_tile(%L, %L)', g1, 'ardougne'), '%A home cannot be taken%');
    v_log := v_log || pg_temp.smoke_refused('a place not linked to your land cannot be opened',
      format('select territory_open_tile(%L, %L)', g1, 'falador'), '%Falador is not linked to your land%');

    v_step := 'open Draynor and Varrock, next to Lumbridge; opening again carries on';
    c_dr := territory_open_tile(g1, 'draynor');
    c_va := territory_open_tile(g1, 'varrock');
    c    := territory_open_tile(g1, 'draynor');
    v_log := v_log || pg_temp.smoke_line(v_step, c_dr is not null and c_va is not null and c = c_dr, null);

    v_log := v_log || pg_temp.smoke_refused('a third open place is refused',
      format('select territory_open_tile(%L, %L)', g1, 'wizards_tower'), '%already working on 2 places%');

    -- ========================================================
    -- Capturing
    -- ========================================================
    v_step := 'one screenshot takes Draynor';
    res := pg_temp.smoke_upload(g1, red, c_dr);
    select discord_line(e) into s from game_events e where e.game_id = g1 and e.type = 'tile_captured';
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'completed')::boolean and pg_temp.smoke_owner(g1, 'draynor') = 'Red'
               and (select status from tile_claims where id = c_dr) = 'completed'
               and s like '%**Red** captured **Draynor Village**%', s);

    v_log := v_log || pg_temp.smoke_refused('a place you hold cannot be opened again',
      format('select territory_open_tile(%L, %L)', g1, 'draynor'), '%already holds Draynor Village%');

    v_step := 'giving up keeps the screenshots and frees the slot';
    c_wt := territory_open_tile(g1, 'wizards_tower');
    perform pg_temp.smoke_upload(g1, red, c_wt, 1);
    perform territory_drop_tile(g1, 'wizards_tower');
    select count(*) into n from tile_evidence where claim_id = c_wt;
    v_log := v_log || pg_temp.smoke_line(v_step,
               n = 1 and (select paused_at is not null from tile_claims where id = c_wt)
               and is_team_private_event('tile_dropped'), n || ' screenshot kept');

    v_log := v_log || pg_temp.smoke_refused('no screenshots on a place you gave up',
      format('select pg_temp.smoke_upload(%L, %L, %L, 2)', g1, red, c_wt), '%Open this place again%');

    v_step := 'a teammate opens it again and finishes it with the second screenshot';
    perform pg_temp.smoke_as(v_red2);
    c := territory_open_tile(g1, 'wizards_tower');
    res := pg_temp.smoke_upload(g1, red, c_wt, 2);
    v_log := v_log || pg_temp.smoke_line(v_step,
               c = c_wt and (res ->> 'completed')::boolean
               and pg_temp.smoke_owner(g1, 'wizards_tower') = 'Red', null);

    v_step := 'Green starts on Varrock while it is free: no attack alert';
    perform pg_temp.smoke_as(v_green);
    c_gv := territory_open_tile(g1, 'varrock');
    perform pg_temp.smoke_upload(g1, green, c_gv, 1);
    v_log := v_log || pg_temp.smoke_line(v_step,
               not exists (select 1 from game_events where game_id = g1 and type = 'tile_attacked'), null);

    v_step := 'Red takes Varrock first; Green''s work on it is now an attack';
    perform pg_temp.smoke_as(v_red);
    perform pg_temp.smoke_upload(g1, red, c_va, 1);
    perform pg_temp.smoke_upload(g1, red, c_va, 2);
    res := territory_state(g1);
    v_log := v_log || pg_temp.smoke_line(v_step,
               pg_temp.smoke_owner(g1, 'varrock') = 'Red'
               and res -> 'attacks' @> jsonb_build_array(jsonb_build_object('place', 'varrock', 'team_id', green)),
               res ->> 'attacks');

    v_step := 'Green finishes Varrock and takes it from Red';
    perform pg_temp.smoke_as(v_green);
    res := pg_temp.smoke_upload(g1, green, c_gv, 2);
    select discord_line(e) into s from game_events e
     where e.game_id = g1 and e.type = 'tile_captured' and e.team_id = green;
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'completed')::boolean and pg_temp.smoke_owner(g1, 'varrock') = 'Green'
               and s like '%**Green** took **Varrock** from Red!%', s);

    v_step := 'Red''s Varrock screenshots are put aside; a retake starts from zero';
    select count(*) into n from tile_evidence where claim_id = c_va;
    select count(*) into x from territory_lost_evidence where claim_id = c_va and lost_to_team_id = green;
    v_log := v_log || pg_temp.smoke_line(v_step,
               n = 0 and x = 2
               and (select status = 'active' and paused_at is not null from tile_claims where id = c_va),
               n || ' left, ' || x || ' put aside');

    v_step := 'Red goes back for Varrock: the first screenshot warns Green';
    perform pg_temp.smoke_as(v_red);
    c := territory_open_tile(g1, 'varrock');
    res := pg_temp.smoke_upload(g1, red, c_va, 3);
    select discord_line(e) into s from game_events e where e.game_id = g1 and e.type = 'tile_attacked';
    v_log := v_log || pg_temp.smoke_line(v_step,
               c = c_va and not (res ->> 'completed')::boolean
               and s like '%**Red** is attacking **Varrock**, held by Green.%', s);

    v_step := 'Red retakes Varrock at the same target';
    res := pg_temp.smoke_upload(g1, red, c_va, 4);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'completed')::boolean and pg_temp.smoke_owner(g1, 'varrock') = 'Red'
               and (select count(*) from tile_evidence where claim_id = c_gv) = 0, null);

    -- ========================================================
    -- A whole region
    -- ========================================================
    v_step := 'Red holds all of Misthalin: 6 places + 3 bonus';
    c_bv := territory_open_tile(g1, 'barbarian_village');
    perform pg_temp.smoke_upload(g1, red, c_bv);
    c_ed := territory_open_tile(g1, 'edgeville');
    perform pg_temp.smoke_upload(g1, red, c_ed);
    select * into st from territory_standings(g1) s where s.team_id = red;
    v_log := v_log || pg_temp.smoke_line(v_step,
               st.places = 6 and st.regions = array['misthalin'] and st.bonus = 3
               and st.score = 9 and st.place = 1,
               st.places || ' places, ' || st.bonus || ' bonus, place ' || st.place);

    v_step := 'the board carries the map and the standings';
    res := board_for_me(g1);
    v_log := v_log || pg_temp.smoke_line(v_step,
               jsonb_array_length(res -> 'territory' -> 'owners') = 8
               and (res -> 'standings' -> 0 ->> 'team_id')::uuid = red
               and (res -> 'territory' -> 'bonuses' ->> 'misthalin')::int = 3,
               jsonb_array_length(res -> 'territory' -> 'owners') || ' places held');

    v_step := 'an organiser viewing as Blue sees the same map';
    perform pg_temp.smoke_as(v_admin);
    res := admin_board_for_team(g1, blue);
    v_log := v_log || pg_temp.smoke_line(v_step,
               jsonb_array_length(res -> 'territory' -> 'owners') = 8
               and (res -> 'standings' -> 0 ->> 'team_id')::uuid = red, null);

    v_step := 'a signed-out visitor can read the map tables';
    execute 'set local role anon';
    select count(*) into n from territory_captures where game_id = g1;
    select count(*) into x from territory_lost_evidence;
    execute 'reset role';
    v_log := v_log || pg_temp.smoke_line(v_step, n = 7 and x = 0,
               n || ' captures visible, ' || x || ' put-aside screenshots (organisers only)');

    -- ========================================================
    -- Revoking
    -- ========================================================
    v_step := 'a dry run of withdrawing Edgeville''s screenshot changes nothing';
    select id into ev from tile_evidence where claim_id = c_ed;
    res := admin_revoke_evidence(ev, true);
    v_log := v_log || pg_temp.smoke_line(v_step,
               (res ->> 'uncompleted')::boolean and pg_temp.smoke_owner(g1, 'edgeville') = 'Red'
               and exists (select 1 from tile_evidence where id = ev), null);

    v_step := 'withdrawing it frees Edgeville and breaks the region';
    res := admin_revoke_evidence(ev, false);
    select * into st from territory_standings(g1) s where s.team_id = red;
    v_log := v_log || pg_temp.smoke_line(v_step,
               pg_temp.smoke_owner(g1, 'edgeville') = '-' and st.score = 5 and st.bonus = 0
               and (select status = 'active' and paused_at is not null from tile_claims where id = c_ed),
               'Red on ' || st.score);

    v_step := 'withdrawing a retake hands Varrock back to Green';
    select id into ev from tile_evidence where claim_id = c_va order by created_at limit 1;
    perform admin_revoke_evidence(ev, false);
    v_log := v_log || pg_temp.smoke_line(v_step, pg_temp.smoke_owner(g1, 'varrock') = 'Green',
               'Varrock: ' || pg_temp.smoke_owner(g1, 'varrock'));

    v_step := 'withdrawn places do not take an open slot';
    perform pg_temp.smoke_as(v_red);
    c := territory_open_tile(g1, 'edgeville');
    c := territory_open_tile(g1, 'varrock');
    v_log := v_log || pg_temp.smoke_line(v_step, c = c_va, null);

    -- ========================================================
    -- The end
    -- ========================================================
    v_step := 'settling with no timer does nothing';
    v_log := v_log || pg_temp.smoke_line(v_step, not territory_settle(g1), null);

    perform pg_temp.smoke_as(v_red);
    v_log := v_log || pg_temp.smoke_refused('a player cannot end the game',
      format('select admin_end_game(%L)', g1), '%admins only%');

    v_step := 'the organiser ends it: the biggest empire wins';
    perform pg_temp.smoke_as(v_admin);
    perform admin_end_game(g1);
    select * into g from games where id = g1;
    select discord_line(e) into s from game_events e where e.game_id = g1 and e.type = 'game_ended';
    v_log := v_log || pg_temp.smoke_line(v_step,
               g.status = 'finished' and g.winner_team_id = red and g.ended_reason = 'admin'
               and s like '%**Red** wins with 4 points.%', s);

    perform pg_temp.smoke_as(v_green);
    v_log := v_log || pg_temp.smoke_refused('nothing opens after the end',
      format('select territory_open_tile(%L, %L)', g1, 'edgeville'), '%opens when the game starts%');

    v_step := 'withdrawing after the end moves the winner';
    perform pg_temp.smoke_as(v_admin);
    for ev in select e.id from tile_evidence e
               where e.claim_id in (select c2.id from tile_claims c2 where c2.team_id = red) loop
      perform admin_revoke_evidence(ev, false);
    end loop;
    v_log := v_log || pg_temp.smoke_line(v_step,
               (select winner_team_id from games where id = g1) = green,
               'winner: ' || coalesce((select te.name from teams te join games gg on gg.winner_team_id = te.id
                                        where gg.id = g1), 'nobody'));

    v_step := 'reset game 1: every place free, homes kept';
    perform pg_temp.smoke_as(v_admin);
    perform admin_reset_game(g1);
    select string_agg(home, ',' order by slot) into s from teams where game_id = g1;
    v_log := v_log || pg_temp.smoke_line(v_step,
               (select status from games where id = g1) = 'placement'
               and not exists (select 1 from territory_captures where game_id = g1)
               and not exists (select 1 from territory_lost_evidence where game_id = g1)
               and s = 'lumbridge,ardougne,canifis', s);

    -- ========================================================
    -- Game 2: joining, dealing, the timer
    -- ========================================================
    v_step := 'create game 2 on a timer; a third team joins with the next free home';
    g2 := admin_new_game('Smoke territory 2', 'territory', array['North', 'South'], 8::smallint,
                         now() + interval '1 day');
    t3 := admin_add_team(g2, 'East');
    select string_agg(home, ',' order by slot) into s from teams where game_id = g2;
    v_log := v_log || pg_temp.smoke_line(v_step, s = 'lumbridge,ardougne,canifis', s);

    v_step := 'three more teams fill the six homes; a seventh is refused';
    perform admin_add_team(g2, 'West');
    perform admin_add_team(g2, 'Up');
    perform admin_add_team(g2, 'Down');
    select string_agg(home, ',' order by slot) into s from teams where game_id = g2;
    v_log := v_log || pg_temp.smoke_line(v_step,
               s = 'lumbridge,ardougne,canifis,hosidius,civitas,trollheim', s);
    v_log := v_log || pg_temp.smoke_refused('a seventh team is refused',
      format('select admin_add_team(%L, %L)', g2, 'Seventh'), '%at most six teams%');
    delete from teams where game_id = g2 and slot > 2;

    v_step := 'dealing tasks skips the homes';
    insert into tile_library (name, required_evidence)
    select 'Smoke library task ' || i, 1 from generate_series(1, 70) as i;
    res := admin_autofill_board(g2);
    select count(*) into n from tiles t join territory_places p on p.position = t.position
     where t.game_id = g2 and p.key in ('lumbridge', 'ardougne');
    select count(*) into x from tiles where game_id = g2;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 0 and x = 62,
               x || ' tasks dealt, ' || n || ' on a home');

    perform admin_set_member((select id from teams where game_id = g2 and slot = 1), v_red, 'captain');
    perform admin_set_member((select id from teams where game_id = g2 and slot = 2), v_blue, 'captain');
    perform start_game(g2);

    v_step := 'the timer runs out with nothing taken: nobody wins';
    update games set ends_at = now() - interval '1 minute' where id = g2;
    perform pg_temp.smoke_as(v_red);
    v_log := v_log || pg_temp.smoke_refused('nothing opens after time is up',
      format('select territory_open_tile(%L, %L)', g2, 'draynor'), '%time is up%');
    x := case when territory_settle(g2) then 1 else 0 end;
    select * into g from games where id = g2;
    select discord_line(e) into s from game_events e where e.game_id = g2 and e.type = 'game_ended';
    v_log := v_log || pg_temp.smoke_line(v_step,
               x = 1 and g.status = 'finished' and g.ended_reason = 'time_up'
               and g.winner_team_id is null and s like '%nobody wins%', s);
    v_log := v_log || pg_temp.smoke_line('settling twice does nothing', not territory_settle(g2), null);

    v_step := 'done';
  exception when others then
    v_log := v_log || E'\n\nSTOPPED at "' || v_step || '": ' || sqlerrm;
  end;

  raise exception using message =
    E'TERRITORY SMOKE TEST -- this error is deliberate: it rolled everything back, nothing was saved.\n'
    || (select count(*) from regexp_matches(v_log, E'\nPASS', 'g')) || ' passed, '
    || (select count(*) from regexp_matches(v_log, E'\nFAIL', 'g')) || ' failed'
    || case when v_step <> 'done' then ', and it stopped early' else '' end
    || E'\n' || v_log;
end;
$smoke$;
