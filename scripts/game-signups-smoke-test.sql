-- High Society Events -- board sign-ups smoke test that leaves nothing behind
--
-- Paste the whole file into the Supabase SQL editor and press Run.
--
-- It plays the sign-up step of a board event through the same four functions
-- the site calls (20261026160000), as four throwaway accounts that exist only
-- inside this run:
--
--   Smoke Organiser (admin)   Smoke Red (gets rostered)
--   Smoke Blue                Smoke Outsider (never signs up)
--
-- No real account is touched, and nothing is kept: the whole test is one DO
-- block that ALWAYS ends by raising an error, which rolls every change back.
--
-- So the editor will show this as an ERROR. That is the point: the error text
-- IS the report, one PASS/FAIL line per check. Look for any line starting with
-- FAIL, or a "STOPPED at" line if something broke part-way.
--
-- What it covers:
--   1. Signing up, twice (one row, and the second press corrects the name).
--   2. The name falling back to profiles.rsn when none is passed.
--   3. game_signup_list: a count for everybody, `joined` for the caller only.
--   4. A challenge refused, by the function and by the trigger behind it.
--   5. Leaving -- allowed before teams, refused once rostered, refused once
--      the game has started.
--   6. admin_game_signups: refused for a player, and `rostered` correct for
--      the organiser.
--   7. admin_game_signup_remove: refused for a player; works on a running
--      event; leaves a rostered player on their team; and is not an error
--      when there is no row to clear.
--
-- WHAT IT CANNOT COVER. This block runs as the table's owner, so RLS and the
-- revoked grants do not apply to it: the test can read game_signups directly
-- and no refusal there would prove anything. That the table is closed to anon
-- and authenticated is asserted by the migration itself, not here.

create function pg_temp.smoke_as(p_id uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_id::text, true);
end;
$$;

-- Signed out: claims with no `sub` at all, which is what auth.uid() reads.
create function pg_temp.smoke_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
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
  g_bingo uuid; g_chal uuid;
  red uuid; blue uuid;
  s1 uuid; s2 uuid;
  rows jsonb; one jsonb;
  n int;
  b boolean;
  t text;
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
              (v_admin, 'smoke-signup-admin@players.hs-events.invalid',    'Smoke Organiser'),
              (v_red,   'smoke-signup-red@players.hs-events.invalid',      'Smoke Red'),
              (v_blue,  'smoke-signup-blue@players.hs-events.invalid',     'Smoke Blue'),
              (v_out,   'smoke-signup-outsider@players.hs-events.invalid', 'Smoke Outsider')
           ) as u(id, email, name);

    update profiles set is_admin = true where id = v_admin;
    -- 0004 seeds rsn from the display name; pin Red's to something else so the
    -- fallback can be told apart from the name on the profile by eye.
    update profiles set rsn = 'SmokeRedRSN' where id = v_red;

    select count(*) into n from profiles where id in (v_admin, v_red, v_blue, v_out);
    v_log := v_log || pg_temp.smoke_line('four throwaway profiles made', n = 4, n || ' profiles');

    -- ========================================================
    -- Two events: a bingo to sign up for, and a challenge that must refuse
    -- ========================================================
    perform pg_temp.smoke_as(v_admin);

    v_step := 'create the bingo';
    g_bingo := admin_new_game('Smoke sign-ups', 'bingo', array['Red', 'Blue'], 3::smallint,
                              now() + interval '1 day');
    select id into red  from teams where game_id = g_bingo and slot = 1;
    select id into blue from teams where game_id = g_bingo and slot = 2;
    v_log := v_log || pg_temp.smoke_line(v_step,
               g_bingo is not null and red is not null and blue is not null, 'two teams');

    v_step := 'create the challenge';
    g_chal := admin_new_challenge('Smoke challenge', now(), now() + interval '2 days',
                                  true, 'zulrah', null, null, null, array[]::text[], false);
    v_log := v_log || pg_temp.smoke_line(v_step, g_chal is not null, 'made');

    -- ========================================================
    -- Putting a hand up
    -- ========================================================
    v_step := 'signed out, signing up is refused';
    perform pg_temp.smoke_anon();
    begin
      perform game_signup_join(g_bingo);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was allowed');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%sign in%', sqlerrm);
    end;

    perform pg_temp.smoke_as(v_red);
    v_step := 'Red signs up, and the name comes off their profile';
    s1 := game_signup_join(g_bingo);
    select rsn into t from game_signups where id = s1;
    v_log := v_log || pg_temp.smoke_line(v_step,
               s1 is not null and t = 'SmokeRedRSN', coalesce(t, 'no name'));

    v_step := 'signing up twice is one row, with the newer name';
    s2 := game_signup_join(g_bingo, '  Red Alt  ');
    select count(*) into n from game_signups where game_id = g_bingo and profile_id = v_red;
    select rsn into t from game_signups where id = s2;
    v_log := v_log || pg_temp.smoke_line(v_step,
               s2 = s1 and n = 1 and t = 'Red Alt', n || ' row, name ' || coalesce(t, 'null'));

    -- Clearing the box clears the name rather than storing a space, and does
    -- NOT fall back to the profile: challenge_join draws the same line, and
    -- nothing a board event does needs a name at all. Passing nothing is what
    -- takes the profile's name -- which is all the site itself ever sends.
    v_step := 'a cleared name is stored as nothing, not as a space';
    perform game_signup_join(g_bingo, '   ');
    select rsn into t from game_signups where game_id = g_bingo and profile_id = v_red;
    v_log := v_log || pg_temp.smoke_line(v_step, t is null, coalesce(t, 'null'));

    v_step := 'and passing nothing takes the name off the profile again';
    perform game_signup_join(g_bingo);
    select rsn into t from game_signups where game_id = g_bingo and profile_id = v_red;
    v_log := v_log || pg_temp.smoke_line(v_step, t = 'SmokeRedRSN', coalesce(t, 'null'));

    perform pg_temp.smoke_as(v_blue);
    v_step := 'Blue signs up too';
    perform game_signup_join(g_bingo);
    select count(*) into n from game_signups where game_id = g_bingo;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 2, n || ' signed up');

    -- ========================================================
    -- A challenge is not this table's business
    -- ========================================================
    v_step := 'signing up for a challenge through this call is refused';
    begin
      perform game_signup_join(g_chal);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was allowed');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%challenge%', sqlerrm);
    end;

    v_step := 'and the trigger refuses one written straight into the table';
    begin
      insert into game_signups (game_id, profile_id) values (g_chal, v_blue);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'the row was inserted');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%is a challenge%', sqlerrm);
    end;

    -- ========================================================
    -- What a player is shown
    -- ========================================================
    perform pg_temp.smoke_as(v_blue);
    v_step := 'the list carries a count and Blue''s own joined flag';
    rows := game_signup_list();
    select value into one from jsonb_array_elements(rows)
     where value->>'game_id' = g_bingo::text;
    v_log := v_log || pg_temp.smoke_line(v_step,
               one is not null and (one->>'signups')::int = 2 and (one->>'joined')::boolean,
               coalesce(one->>'signups', 'no row') || ' signed up, joined '
               || coalesce(one->>'joined', '-'));

    perform pg_temp.smoke_as(v_out);
    v_step := 'the outsider sees the same event, and joined false';
    rows := game_signup_list();
    select value into one from jsonb_array_elements(rows)
     where value->>'game_id' = g_bingo::text;
    v_log := v_log || pg_temp.smoke_line(v_step,
               one is not null and (one->>'signups')::int = 2
               and (one->>'joined')::boolean is false,
               coalesce(one->>'joined', 'no row'));

    v_step := 'and no challenge is in that list';
    select count(*) into n from jsonb_array_elements(rows) e
     where e.value->>'game_id' = g_chal::text;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 0, n || ' challenge rows');

    -- ========================================================
    -- Taking it down again
    -- ========================================================
    perform pg_temp.smoke_as(v_blue);
    v_step := 'Blue leaves while it is still only a list';
    perform game_signup_leave(g_bingo);
    select count(*) into n from game_signups where game_id = g_bingo;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 1, n || ' left signed up');

    v_step := 'leaving twice is quiet, not an error';
    begin
      perform game_signup_leave(g_bingo);
      v_log := v_log || pg_temp.smoke_line(v_step, true, 'no complaint');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, false, sqlerrm);
    end;

    perform pg_temp.smoke_as(v_blue);
    perform game_signup_join(g_bingo);

    -- ========================================================
    -- The organiser's list
    -- ========================================================
    perform pg_temp.smoke_as(v_admin);
    v_step := 'Red is put on a team';
    perform admin_set_member(red, v_red, 'captain');
    v_log := v_log || pg_temp.smoke_line(v_step,
               exists (select 1 from team_members where team_id = red and profile_id = v_red),
               'rostered');

    v_step := 'the organiser''s list says who is placed and who is not';
    select count(*) into n from admin_game_signups(g_bingo);
    select rostered into b from admin_game_signups(g_bingo) where profile_id = v_red;
    v_log := v_log || pg_temp.smoke_line(v_step,
               n = 2 and b,
               n || ' signed up, Red rostered ' || coalesce(b::text, 'null'));

    v_step := 'and the outsider is not in it';
    select count(*) into n from admin_game_signups(g_bingo) where profile_id = v_out;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 0, n || ' rows');

    perform pg_temp.smoke_as(v_red);
    v_step := 'a player cannot read that list';
    begin
      perform count(*) from admin_game_signups(g_bingo);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was allowed');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%not your game%', sqlerrm);
    end;

    v_step := 'and a rostered player cannot take their own name off';
    begin
      perform game_signup_leave(g_bingo);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was allowed');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%already on a team%', sqlerrm);
    end;

    -- ========================================================
    -- Once it has started
    -- ========================================================
    -- Set directly rather than through start_game: the guard under test is the
    -- status check in these two functions, and reaching 'active' the long way
    -- round would mean nine tiles and a roster on both teams for no extra
    -- assurance about either of them.
    update games set status = 'active' where id = g_bingo;

    perform pg_temp.smoke_as(v_out);
    v_step := 'signing up after it started is refused';
    begin
      perform game_signup_join(g_bingo);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was allowed');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%closed when it started%', sqlerrm);
    end;

    perform pg_temp.smoke_as(v_blue);
    v_step := 'and so is leaving';
    begin
      perform game_signup_leave(g_bingo);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was allowed');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%has started%', sqlerrm);
    end;

    v_step := 'the event stays in the list of somebody who signed up for it';
    rows := game_signup_list();
    select value into one from jsonb_array_elements(rows)
     where value->>'game_id' = g_bingo::text;
    v_log := v_log || pg_temp.smoke_line(v_step,
               one is not null and one->>'status' = 'active',
               coalesce(one->>'status', 'gone from the list'));

    perform pg_temp.smoke_as(v_out);
    v_step := 'and leaves the list of somebody who did not';
    rows := game_signup_list();
    select count(*) into n from jsonb_array_elements(rows) e
     where e.value->>'game_id' = g_bingo::text;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 0, n || ' rows');

    -- ========================================================
    -- The organiser takes a name off the list
    -- ========================================================
    -- Deliberately still on the running game. 20261027120000 carries no status
    -- guard, because a list worth tidying is one that has gone stale -- which
    -- is exactly after the start, when join and leave have both closed.
    perform pg_temp.smoke_as(v_red);
    v_step := 'a player cannot clear somebody else''s sign-up';
    begin
      perform admin_game_signup_remove(g_bingo, v_blue);
      v_log := v_log || pg_temp.smoke_line(v_step, false, 'it was allowed');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, sqlerrm ilike '%not your game%', sqlerrm);
    end;

    perform pg_temp.smoke_as(v_admin);
    v_step := 'the organiser clears a rostered player''s sign-up after the start';
    perform admin_game_signup_remove(g_bingo, v_red);
    select count(*) into n from game_signups
     where game_id = g_bingo and profile_id = v_red;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 0, n || ' rows left');

    -- The half of this that would be a bug: the list is not the game, and
    -- somebody mid-event must not quietly stop being on their team.
    v_step := 'and leaves them on their team';
    select exists (select 1 from team_members
                    where team_id = red and profile_id = v_red) into b;
    v_log := v_log || pg_temp.smoke_line(v_step, b, 'still rostered: ' || b::text);

    v_step := 'clearing a name that is not on the list is not an error';
    begin
      perform admin_game_signup_remove(g_bingo, v_red);
      v_log := v_log || pg_temp.smoke_line(v_step, true, 'no error');
    exception when others then
      v_log := v_log || pg_temp.smoke_line(v_step, false, sqlerrm);
    end;

    v_step := 'and the name it was not asked about is still there';
    select count(*) into n from game_signups
     where game_id = g_bingo and profile_id = v_blue;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 1, n || ' rows');

    -- ========================================================
    -- Deleting the game takes its sign-ups with it
    -- ========================================================
    perform pg_temp.smoke_as(v_admin);
    v_step := 'deleting the event clears its sign-ups';
    perform admin_delete_game(g_bingo);
    select count(*) into n from game_signups where game_id = g_bingo;
    v_log := v_log || pg_temp.smoke_line(v_step, n = 0, n || ' rows left');

    v_step := 'done';
  exception when others then
    v_log := v_log || E'\n\nSTOPPED at "' || v_step || '": ' || sqlerrm;
  end;

  raise exception using message =
    E'BOARD SIGN-UPS SMOKE TEST -- this error is deliberate: it rolled everything back, nothing was saved.\n'
    || (select count(*) from regexp_matches(v_log, E'\nPASS', 'g')) || ' passed, '
    || (select count(*) from regexp_matches(v_log, E'\nFAIL', 'g')) || ' failed'
    || case when v_step <> 'done' then ', and it stopped early' else '' end
    || E'\n' || v_log;
end;
$smoke$;
