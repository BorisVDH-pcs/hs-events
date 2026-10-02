-- High Society Events -- tile suggestions smoke test that leaves nothing behind
--
-- Paste the whole file into the Supabase SQL editor and press Run.
--
-- Same idea as scripts/bingo-smoke-test.sql: throwaway accounts that exist only
-- inside this run, the same functions the site calls, and one DO block that
-- ALWAYS ends by raising an error, which rolls every change back. Nothing is
-- kept: no suggestion, no catalogue entry, no account.
--
-- So the editor shows this as an ERROR. The error text IS the report: one
-- PASS/FAIL line per check. Look for FAIL, or a "STOPPED at" line if something
-- broke part-way.
--
-- What it covers (20261004120000_tile_submissions):
--   * a player suggests a tile; the catalogue's own rules apply to it
--   * duplicate names, against the catalogue and against other suggestions
--   * players cannot read, write or delete the table directly, or touch
--     anyone else's suggestions
--   * edit and withdraw, own and pending only; withdrawing deletes nothing
--   * the ten-pending cap
--   * the organiser accepts (with edits) into the catalogue, or refuses with
--     a reason the player can read
--   * deleting a troll account takes its suggestions with it

create function pg_temp.smoke_as(p_id uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     coalesce(json_build_object('sub', p_id, 'role', 'authenticated')::text, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(p_id::text, ''), true);
end;
$$;

create function pg_temp.smoke_line(p_step text, p_ok boolean, p_detail text)
returns text language sql as $$
  select E'\n' || case when coalesce(p_ok, false) then 'PASS  ' else 'FAIL  ' end
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

do $smoke$
declare
  v_log    text := '';
  v_step   text := 'creating the throwaway accounts';
  v_admin  uuid := gen_random_uuid();
  v_alice  uuid := gen_random_uuid();
  v_bob    uuid := gen_random_uuid();
  -- Unique per run, so a catalogue that happens to hold a "Smoke" tile
  -- cannot turn a PASS into a FAIL.
  v_tag    text := substr(md5(random()::text), 1, 8);
  v_lib    uuid;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid;
  v_new    uuid;
  row_s    tile_submissions%rowtype;
  n int; n2 int;
  t text;
  res jsonb;
begin
  begin  -- everything; a surprise is caught below so the report survives

    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
           u.email, '', '{}'::jsonb, jsonb_build_object('display_name', u.name), now(), now()
      from (values
              (v_admin, 'smoke-sub-admin-' || v_tag || '@players.hs-battleships.invalid', 'Smoke Organiser'),
              (v_alice, 'smoke-sub-alice-' || v_tag || '@players.hs-battleships.invalid', 'Smoke Alice'),
              (v_bob,   'smoke-sub-bob-'   || v_tag || '@players.hs-battleships.invalid', 'Smoke Bob')
           ) as u(id, email, name);
    update profiles set is_admin = true where id = v_admin;

    select count(*) into n from profiles where id in (v_admin, v_alice, v_bob);
    v_log := v_log || pg_temp.smoke_line('three throwaway profiles made', n = 3, n || ' profiles');

    -- A catalogue entry to collide with.
    perform pg_temp.smoke_as(v_admin);
    v_lib := admin_save_library_tile(null, jsonb_build_object('name', 'Smoke catalogue ' || v_tag));

    -- ========================================================
    -- Submitting
    -- ========================================================
    perform pg_temp.smoke_as(null);
    v_log := v_log || pg_temp.smoke_refused('signed out cannot suggest',
               format('select submit_tile(%L::jsonb)', jsonb_build_object('name', 'x')),
               '%sign in%');

    perform pg_temp.smoke_as(v_alice);
    v_step := 'Alice suggests a priced tile';
    s1 := submit_tile(jsonb_build_object(
            'name', '  Smoke   barrows ' || v_tag || ' ',
            'icon', 'ahrim<script>',
            'amount', 4,
            'options', jsonb_build_array(
              jsonb_build_object('label', 'Ahrim''s hood', 'points', 2, 'maxTimes', 2),
              jsonb_build_object('label', '',             'points', 9),
              jsonb_build_object('label', 'Dharok''s axe', 'points', 99))),
          'Fun one for mid-levels');
    select * into row_s from tile_submissions where id = s1;
    v_log := v_log || pg_temp.smoke_line(v_step,
               row_s.status = 'pending' and row_s.submitted_by = v_alice
               and row_s.name = 'Smoke barrows ' || v_tag
               and row_s.icon = 'ahrimscript'
               and jsonb_array_length(row_s.options) = 2
               and (row_s.options -> 0 ->> 'max_times')::int = 2
               and (row_s.options -> 1 ->> 'points')::int = 30
               and row_s.player_note = 'Fun one for mid-levels',
               row_s.name || ', icon ' || coalesce(row_s.icon, 'none')
               || ', ' || jsonb_array_length(row_s.options) || ' drops');

    v_log := v_log || pg_temp.smoke_refused('a set rule with no drops is refused',
               format('select submit_tile(%L::jsonb)',
                      jsonb_build_object('name', 'Smoke set ' || v_tag, 'rule', 'one_set')),
               '%needs the drops%');

    v_log := v_log || pg_temp.smoke_refused('a blank name is refused',
               format('select submit_tile(%L::jsonb)', jsonb_build_object('name', '   ')),
               '%needs a name%');

    v_log := v_log || pg_temp.smoke_refused('a name already in the catalogue is refused',
               format('select submit_tile(%L::jsonb)',
                      jsonb_build_object('name', 'SMOKE  catalogue ' || v_tag)),
               '%already a tile called%catalogue%');

    perform pg_temp.smoke_as(v_bob);
    v_log := v_log || pg_temp.smoke_refused('a name someone else has pending is refused',
               format('select submit_tile(%L::jsonb)',
                      jsonb_build_object('name', 'smoke barrows ' || v_tag)),
               '%already suggested%');

    v_step := 'tile_name_status answers catalogue / pending / free';
    v_log := v_log || pg_temp.smoke_line(v_step,
               tile_name_status('Smoke catalogue ' || v_tag) = 'catalogue'
               and tile_name_status('smoke BARROWS ' || v_tag) = 'pending'
               and tile_name_status('Smoke free ' || v_tag) is null
               and tile_name_status('Smoke barrows ' || v_tag, s1) is null,
               null);

    -- ========================================================
    -- What a player can do to the table directly: nothing
    -- ========================================================
    v_step := 'reading the table directly as Alice';
    perform pg_temp.smoke_as(v_alice);
    execute 'set local role authenticated';
    begin
      select count(*) into n from tile_submissions;
    exception when insufficient_privilege then
      n := 0;
    end;
    execute 'reset role';
    v_log := v_log || pg_temp.smoke_line('no direct read, not even of your own', n = 0, n || ' visible');

    v_step := 'writing the table directly as Alice';
    execute 'set local role authenticated';
    begin
      insert into tile_submissions (submitted_by, name) values (v_alice, 'Smoke direct ' || v_tag);
      t := 'insert allowed';
    exception when insufficient_privilege then
      t := null;
    end;
    if t is null then
      begin
        delete from tile_submissions where id = s1;
        t := 'delete allowed';
      exception when insufficient_privilege then
        t := null;
      end;
    end if;
    if t is null then
      begin
        update tile_submissions set status = 'accepted' where id = s1;
        t := 'update allowed';
      exception when insufficient_privilege then
        t := null;
      end;
    end if;
    execute 'reset role';
    select count(*) into n from tile_submissions where id = s1 and status = 'pending';
    v_log := v_log || pg_temp.smoke_line('no direct insert, update or delete',
               t is null and n = 1, coalesce(t, 'all refused'));

    -- ========================================================
    -- Own and pending only
    -- ========================================================
    perform pg_temp.smoke_as(v_bob);
    select count(*) into n from my_tile_submissions();
    v_log := v_log || pg_temp.smoke_line('Bob does not see Alice''s suggestion', n = 0, n || ' listed');

    v_log := v_log || pg_temp.smoke_refused('Bob cannot edit Alice''s suggestion',
               format('select update_tile_submission(%L, %L::jsonb)', s1,
                      jsonb_build_object('name', 'Smoke hijack ' || v_tag)),
               '%no such suggestion%');
    v_log := v_log || pg_temp.smoke_refused('Bob cannot withdraw Alice''s suggestion',
               format('select withdraw_tile_submission(%L)', s1),
               '%no such suggestion%');
    v_log := v_log || pg_temp.smoke_refused('a player cannot see the review queue',
               'select count(*) from admin_list_tile_submissions()', '%admins only%');
    v_log := v_log || pg_temp.smoke_refused('a player cannot accept',
               format('select admin_accept_tile_submission(%L, %L::jsonb)', s1,
                      jsonb_build_object('name', 'Smoke barrows ' || v_tag)),
               '%admins only%');
    v_log := v_log || pg_temp.smoke_refused('a player cannot refuse',
               format('select admin_refuse_tile_submission(%L, %L)', s1, 'no'),
               '%admins only%');

    perform pg_temp.smoke_as(v_alice);
    v_step := 'Alice edits her own pending suggestion';
    perform update_tile_submission(s1, jsonb_build_object(
              'name', 'Smoke barrows ' || v_tag, 'amount', 3,
              'options', jsonb_build_array(jsonb_build_object('label', 'Any barrows piece'))),
            'Changed my mind on the price');
    select * into row_s from tile_submissions where id = s1;
    v_log := v_log || pg_temp.smoke_line(v_step,
               row_s.required_evidence = 3 and jsonb_array_length(row_s.options) = 1
               and row_s.player_note = 'Changed my mind on the price',
               'target ' || row_s.required_evidence);

    select count(*) into n from my_tile_submissions();
    v_log := v_log || pg_temp.smoke_line('Alice sees her own suggestion', n = 1, n || ' listed');

    -- ========================================================
    -- The organiser
    -- ========================================================
    perform pg_temp.smoke_as(v_admin);
    select count(*) into n from admin_list_tile_submissions()
     where id = s1 and submitted_by_name = 'Smoke Alice' and status = 'pending';
    v_log := v_log || pg_temp.smoke_line('the organiser sees it, with who sent it', n = 1, null);

    v_log := v_log || pg_temp.smoke_refused('accepting under a catalogue name is refused',
               format('select admin_accept_tile_submission(%L, %L::jsonb)', s1,
                      jsonb_build_object('name', 'Smoke catalogue ' || v_tag)),
               '%already exists%');
    select count(*) into n from tile_submissions where id = s1 and status = 'pending';
    v_log := v_log || pg_temp.smoke_line('…and the suggestion is still pending', n = 1, null);

    v_step := 'the organiser accepts it, reworded';
    v_new := admin_accept_tile_submission(s1, jsonb_build_object(
               'name', 'Smoke Barrows piece ' || v_tag, 'amount', 2,
               'options', jsonb_build_array(jsonb_build_object('label', 'Any barrows piece'))),
             'Lowered the target');
    select * into row_s from tile_submissions where id = s1;
    select count(*) into n from tile_library
     where id = v_new and name = 'Smoke Barrows piece ' || v_tag
       and required_evidence = 2 and created_by = v_alice;
    select count(*) into n2 from tile_library_options where library_id = v_new;
    v_log := v_log || pg_temp.smoke_line(v_step,
               n = 1 and n2 = 1 and row_s.status = 'accepted' and row_s.library_id = v_new
               and row_s.reviewed_by = v_admin and row_s.review_note = 'Lowered the target',
               'catalogue row ' || n || ', ' || n2 || ' drop(s), ' || row_s.status);

    v_log := v_log || pg_temp.smoke_refused('accepting twice is refused',
               format('select admin_accept_tile_submission(%L, %L::jsonb)', s1,
                      jsonb_build_object('name', 'Smoke again ' || v_tag)),
               '%already been accepted%');

    perform pg_temp.smoke_as(v_alice);
    v_log := v_log || pg_temp.smoke_refused('Alice cannot edit it once accepted',
               format('select update_tile_submission(%L, %L::jsonb)', s1,
                      jsonb_build_object('name', 'Smoke later ' || v_tag)),
               '%already been accepted%');

    v_step := 'refusing, with a reason Alice can read';
    s2 := submit_tile(jsonb_build_object('name', 'Smoke refuse me ' || v_tag));
    perform pg_temp.smoke_as(v_admin);
    perform admin_refuse_tile_submission(s2, 'Too easy for a board');
    perform pg_temp.smoke_as(v_alice);
    select review_note into t from my_tile_submissions() where id = s2 and status = 'refused';
    v_log := v_log || pg_temp.smoke_line(v_step, t = 'Too easy for a board', coalesce(t, 'no reason seen'));

    v_step := 'withdrawing keeps the row';
    s3 := submit_tile(jsonb_build_object('name', 'Smoke withdraw me ' || v_tag));
    perform withdraw_tile_submission(s3);
    select count(*) into n from tile_submissions where id = s3 and status = 'withdrawn';
    v_log := v_log || pg_temp.smoke_line(v_step, n = 1, n || ' withdrawn row(s)');
    v_log := v_log || pg_temp.smoke_refused('withdrawing twice is refused',
               format('select withdraw_tile_submission(%L)', s3), '%already been withdrawn%');

    v_step := 'a withdrawn name is free again';
    s4 := submit_tile(jsonb_build_object('name', 'Smoke withdraw me ' || v_tag));
    v_log := v_log || pg_temp.smoke_line(v_step, s4 is not null, null);

    v_step := 'ten pending at once, and no more';
    -- s4 is pending already: nine more makes ten.
    for n in 1 .. 9 loop
      perform submit_tile(jsonb_build_object('name', 'Smoke bulk ' || n || ' ' || v_tag));
    end loop;
    v_log := v_log || pg_temp.smoke_refused(v_step,
               format('select submit_tile(%L::jsonb)', jsonb_build_object('name', 'Smoke eleven ' || v_tag)),
               '%10 tiles waiting%');

    -- ========================================================
    -- A troll account goes, and its suggestions with it
    -- ========================================================
    v_step := 'deleting Alice''s account';
    perform pg_temp.smoke_as(v_admin);
    perform admin_delete_account(v_alice);
    select count(*) into n from tile_submissions where submitted_by = v_alice;
    select count(*) into n2 from tile_library where id = v_new and created_by is null;
    v_log := v_log || pg_temp.smoke_line(v_step || ' removes her suggestions', n = 0, n || ' left');
    v_log := v_log || pg_temp.smoke_line('…but the tile she got accepted stays in the catalogue',
               n2 = 1, null);

    v_step := 'done';
  exception when others then
    v_log := v_log || E'\n\nSTOPPED at "' || v_step || '": ' || sqlerrm;
  end;

  raise exception using message =
    E'TILE SUGGESTIONS SMOKE TEST -- this error is deliberate: it rolled everything back, nothing was saved.\n'
    || (select count(*) from regexp_matches(v_log, E'\nPASS', 'g')) || ' passed, '
    || (select count(*) from regexp_matches(v_log, E'\nFAIL', 'g')) || ' failed'
    || case when v_step <> 'done' then ', and it stopped early' else '' end
    || E'\n' || v_log;
end;
$smoke$;
