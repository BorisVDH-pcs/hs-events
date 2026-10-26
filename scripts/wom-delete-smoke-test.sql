-- High Society Events -- "deleting a challenge deletes its competition" smoke test
--
-- Paste the whole file into the Supabase SQL editor and press Run.
--
-- It checks 20261026170000: that admin_delete_game takes the WOM competition
-- down before the game, and in the right order.
--
-- NO REQUEST IS EVER SENT TO WISE OLD MAN. That is not a limitation of the
-- test, it is the thing the test proves. pg_net does not call out when you
-- invoke net.http_delete -- it writes a row into net.http_request_queue, and a
-- background worker sends it AFTER the transaction commits. This block always
-- ends by raising, so the queued row rolls back with everything else and the
-- fake competition below is never passed to WOM. That property is also what
-- makes the real thing safe: a deletion that fails half way through never
-- deletes a competition for a game that then survives.
--
-- So the editor will show this as an ERROR. That is the point: the error text
-- IS the report, one PASS/FAIL line per check. Look for any line starting with
-- FAIL, or a "STOPPED at" line if something broke part-way.
--
-- What it covers:
--   1. A challenge with a competition: the request is queued, challenge_wom_deleted
--      records it, and the game is gone.
--   2. The queue row actually carries a DELETE to /competitions/<id> with the
--      verification code in the body -- not to /participants, and not a POST.
--   3. challenge_wom_deleted survives the cascade that destroys the game.
--   4. A board game with no competition deletes exactly as it always did.
--   5. A non-admin cannot delete anything, competition or not.
--
-- WHAT IT CANNOT COVER. Whether WOM accepts the request. Nothing here reaches
-- them, and the live call is fire-and-forget, so acceptance is not observable
-- from Postgres at all -- that is why challenge_wom_deleted keeps the code.

create function pg_temp.smoke_as(p_id uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_id::text, true);
end;
$$;

do $smoke$
declare
  v_admin   uuid := gen_random_uuid();
  v_player  uuid := gen_random_uuid();
  v_chal    uuid;
  v_board   uuid;
  v_req     bigint;
  v_row     record;
  v_queued  record;
  v_report  text := '';
  v_step    text := 'setup';

  -- Obviously not a real competition. Nothing is sent, but if this file is ever
  -- run outside a rolled-back block, a 404 is the failure we would want.
  v_comp    bigint := 999000000;
  v_code    text   := 'smoke-test-not-a-real-code';
begin
  -- ---- throwaway accounts -------------------------------------------------
  v_step := 'accounts';
  insert into profiles (id, display_name, is_admin)
  values (v_admin, 'Smoke WOM Organiser', true),
         (v_player, 'Smoke WOM Player', false);

  perform pg_temp.smoke_as(v_admin);

  -- ---- 1. a challenge with a competition behind it ------------------------
  v_step := 'create challenge';
  insert into games (name, mode, status, grid_size)
  values ('Smoke WOM Challenge', 'challenge', 'active', 1)
  returning id into v_chal;

  insert into challenge_wom (game_id, competition_id, verification_code)
  values (v_chal, v_comp, v_code);

  v_step := 'delete challenge';
  perform admin_delete_game(v_chal);

  -- the game is gone
  v_report := v_report || case
    when not exists (select 1 from games where id = v_chal)
    then E'PASS  the game is deleted\n'
    else E'FAIL  the game is still there\n' end;

  -- and challenge_wom went with it
  v_report := v_report || case
    when not exists (select 1 from challenge_wom where game_id = v_chal)
    then E'PASS  challenge_wom cascaded away\n'
    else E'FAIL  challenge_wom survived\n' end;

  -- ---- 2. what was actually queued ----------------------------------------
  v_step := 'read the record';
  select * into v_row from challenge_wom_deleted where game_id = v_chal;

  v_report := v_report || case
    when v_row.request_id is not null
    then E'PASS  challenge_wom_deleted recorded the request\n'
    else E'FAIL  nothing was recorded\n' end;

  -- 3. the record outlived the game it pointed at
  v_report := v_report || case
    when v_row.competition_id = v_comp and v_row.verification_code = v_code
    then E'PASS  it kept the competition id and the code\n'
    else E'FAIL  the competition id or the code is wrong\n' end;

  v_report := v_report || case
    when v_row.game_name = 'Smoke WOM Challenge'
    then E'PASS  it kept the game name for a human to read\n'
    else E'FAIL  the game name was not kept\n' end;

  v_step := 'read the queue';
  select * into v_queued from net.http_request_queue where id = v_row.request_id;

  v_report := v_report || case
    when v_queued.method = 'DELETE'
    then E'PASS  the queued request is a DELETE\n'
    else E'FAIL  the queued request is ' || coalesce(v_queued.method, 'missing') || E'\n' end;

  v_report := v_report || case
    when v_queued.url like '%/competitions/' || v_comp
    then E'PASS  it points at the competition, not its participants\n'
    else E'FAIL  wrong url: ' || coalesce(v_queued.url, 'missing') || E'\n' end;

  v_report := v_report || case
    when v_queued.body::jsonb ->> 'verificationCode' = v_code
    then E'PASS  the verification code is in the body\n'
    else E'FAIL  the body does not carry the code\n' end;

  -- ---- 4. a board game, which has no competition --------------------------
  v_step := 'delete a board game';
  insert into games (name, mode, status, grid_size)
  values ('Smoke WOM Bingo', 'bingo', 'setup', 5)
  returning id into v_board;

  perform admin_delete_game(v_board);

  v_report := v_report || case
    when not exists (select 1 from games where id = v_board)
    then E'PASS  a board game still deletes\n'
    else E'FAIL  the board game survived\n' end;

  v_report := v_report || case
    when not exists (select 1 from challenge_wom_deleted where game_id = v_board)
    then E'PASS  and nothing was queued for it\n'
    else E'FAIL  a request was queued for a game with no competition\n' end;

  -- ---- 5. a player cannot delete ------------------------------------------
  v_step := 'non-admin refused';
  insert into games (name, mode, status, grid_size)
  values ('Smoke WOM Guarded', 'challenge', 'active', 1)
  returning id into v_chal;

  insert into challenge_wom (game_id, competition_id, verification_code)
  values (v_chal, v_comp + 1, v_code);

  perform pg_temp.smoke_as(v_player);
  begin
    perform admin_delete_game(v_chal);
    v_report := v_report || E'FAIL  a player deleted a game\n';
  exception when others then
    v_report := v_report || E'PASS  a player is refused\n';
  end;
  perform pg_temp.smoke_as(v_admin);

  v_report := v_report || case
    when not exists (select 1 from challenge_wom_deleted where game_id = v_chal)
    then E'PASS  and no competition was queued for deletion\n'
    else E'FAIL  a refused delete still queued a WOM deletion\n' end;

  raise exception E'\n\n==== WOM delete smoke test ====\n\n%\n(rolled back on purpose -- no request reached WOM)\n', v_report;

exception
  when sqlstate 'P0001' then raise;
  when others then
    raise exception E'\n\nSTOPPED at "%": % (%)\n\nwhat passed so far:\n%\n',
      v_step, sqlerrm, sqlstate, v_report;
end
$smoke$;
