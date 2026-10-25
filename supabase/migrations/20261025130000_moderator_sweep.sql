-- The guard swap: moderators can now actually do the job.
--
-- 20261025120000 added moderator_modes and the gates and changed nothing else.
-- This migration points the guards at them. After it, a moderator runs games of
-- their modes with the organiser's console, and everything else refuses them.
--
-- HOW, and why it is not 3,000 lines of re-emitted function bodies: each guard
-- is one line inside a function that is otherwise untouched, so the body is
-- taken from the LIVE definition and only that line is replaced — the same
-- technique 20261004130000 used on fire_tile and add_evidence, for the same
-- reason given there: "the rest of each function is taken from the live
-- definition, so nothing else in them can drift."
--
-- Every swap asserts it matched EXACTLY ONCE and raises otherwise, so a guard
-- that has been reworded since cannot be silently skipped. A failed assertion
-- aborts the whole migration; none of it applies by halves.
--
-- `create or replace` keeps each function's existing grants.
--
-- What is deliberately NOT swapped, decided 2026-10-25 (docs/moderator-role.md):
--   admin_reset_game                     wiping progress stays an admin act
--   admin_delete_library_tile            deleting from the shared catalogue
--   admin_delete_board_preset            deleting another organiser's preset
--   admin_list_tile_submissions, accept, refuse   the site-wide suggestion queue
--   admin_reset_password, admin_delete_account,
--   admin_list_password_resets, admin_list_account_deletions   accounts
--   admin_set_moderator_modes, admin_list_moderators           the tier itself

-- ============================================================
-- Resolvers: from a row back to its game
-- ============================================================
-- Not every admin_* function is handed a game id. These answer the same
-- question for the row that one IS handed, and defer to may_manage_game.

create or replace function may_manage_team(p_team_id uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from teams t
                  where t.id = p_team_id and may_manage_game(t.game_id));
$fn$;

create or replace function may_manage_claim(p_claim_id uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from tile_claims c
                  where c.id = p_claim_id and may_manage_team(c.team_id));
$fn$;

create or replace function may_manage_evidence(p_evidence_id uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from tile_evidence e
                  where e.id = p_evidence_id and may_manage_team(e.team_id));
$fn$;

create or replace function may_manage_score_event(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from score_events s
                  where s.id = p_id and may_manage_team(s.team_id));
$fn$;

create or replace function may_manage_tile(p_tile_id uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from tiles t
                  where t.id = p_tile_id and may_manage_game(t.game_id));
$fn$;

create or replace function may_manage_pet_jar(p_submission_id uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from pet_jar_submissions j
                  where j.id = p_submission_id and may_manage_game(j.game_id));
$fn$;

-- discord_webhooks.game_id is nullable, and null means "every game". A relay
-- that fires for every game is not one moderator's to change, so only an admin
-- may touch those: the join drops them, and is_admin() short-circuits above.
create or replace function may_manage_webhook(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_admin() or exists (
    select 1 from discord_webhooks w
     where w.id = p_id and w.game_id is not null and may_manage_game(w.game_id));
$fn$;

revoke execute on function may_manage_team(uuid)        from public, anon;
revoke execute on function may_manage_claim(uuid)       from public, anon;
revoke execute on function may_manage_evidence(uuid)    from public, anon;
revoke execute on function may_manage_score_event(uuid) from public, anon;
revoke execute on function may_manage_tile(uuid)        from public, anon;
revoke execute on function may_manage_pet_jar(uuid)     from public, anon;
revoke execute on function may_manage_webhook(uuid)     from public, anon;

grant execute on function may_manage_team(uuid)        to authenticated;
grant execute on function may_manage_claim(uuid)       to authenticated;
grant execute on function may_manage_evidence(uuid)    to authenticated;
grant execute on function may_manage_score_event(uuid) to authenticated;
grant execute on function may_manage_tile(uuid)        to authenticated;
grant execute on function may_manage_pet_jar(uuid)     to authenticated;
grant execute on function may_manage_webhook(uuid)     to authenticated;

-- ============================================================
-- The swap
-- ============================================================

do $swap$
declare
  r      record;
  v_def  text;
  v_n    int;
  -- The guard as 61 functions write it, to the character.
  v_std  constant text := 'if not is_admin\(\) then raise exception ''Admins only''; end if;';
begin
  for r in
    select fn, gate, msg from (values
      -- ---- handed a game id: 30 functions ----------------------------------
      ('admin_add_team(uuid, text)',                          'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_apply_board_preset(uuid, uuid)',                'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_autofill_board(uuid)',                          'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_clear_board(uuid)',                             'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_clear_tile(uuid, smallint, smallint)',          'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_delete_game(uuid)',                             'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_end_game(uuid)',                                'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_import_board_to_library(uuid)',                 'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_list_evidence(uuid)',                           'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_list_pet_jars(uuid)',                           'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_list_pet_trades(uuid)',                         'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_list_score_events(uuid)',                       'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_list_ship_cells(uuid)',                         'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_list_tiles(uuid)',                              'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_list_webhooks(uuid)',                           'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_open_placement(uuid)',                          'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_save_board_preset(uuid, text)',                 'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_set_end_time(uuid, timestamptz)',               'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_set_featured_game(uuid)',                       'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_set_scoring(uuid, smallint, smallint, smallint)','may_manage_game(p_game_id)', 'Not your game'),
      ('admin_set_snakes(uuid, jsonb)',                       'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_set_start_time(uuid, timestamptz)',             'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_set_territory_homes(uuid, jsonb)',              'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_set_tile(uuid, smallint, smallint, jsonb)',     'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_set_tiles(uuid, jsonb)',                        'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_set_webhook(uuid, uuid, text, boolean, text)',  'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_shuffle_board(uuid)',                           'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_snakes_end_game(uuid, uuid)',                   'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_swap_tiles(uuid, int, int, int, int)',          'may_manage_game(p_game_id)', 'Not your game'),
      ('admin_tile_progress(uuid)',                           'may_manage_game(p_game_id)', 'Not your game'),

      -- ---- handed a team id: 9 functions ------------------------------------
      ('admin_adjust_score(uuid, integer, text, uuid)',       'may_manage_team(p_team_id)', 'Not your game'),
      ('admin_delete_team(uuid)',                             'may_manage_team(p_team_id)', 'Not your game'),
      ('admin_remove_member(uuid, uuid)',                     'may_manage_team(p_team_id)', 'Not your game'),
      ('admin_set_member(uuid, uuid, team_role)',             'may_manage_team(p_team_id)', 'Not your game'),
      ('admin_snakes_complete_tile(uuid)',                    'may_manage_team(p_team_id)', 'Not your game'),
      ('admin_snakes_give_rollback(uuid, integer)',           'may_manage_team(p_team_id)', 'Not your game'),
      ('admin_snakes_move(uuid, integer)',                    'may_manage_team(p_team_id)', 'Not your game'),
      ('admin_snakes_punish(uuid)',                           'may_manage_team(p_team_id)', 'Not your game'),
      ('admin_snakes_uncomplete_tile(uuid, integer)',         'may_manage_team(p_team_id)', 'Not your game'),

      -- ---- handed some other row: 6 functions -------------------------------
      ('admin_release_claim(uuid)',                           'may_manage_claim(p_claim_id)',        'Not your game'),
      ('admin_revoke_evidence(uuid, boolean)',                'may_manage_evidence(p_evidence_id)',  'Not your game'),
      ('admin_test_tile(uuid, jsonb)',                        'may_manage_tile(p_tile_id)',          'Not your game'),
      ('admin_delete_score_event(uuid)',                      'may_manage_score_event(p_id)',        'Not your game'),
      ('admin_delete_webhook(uuid)',                          'may_manage_webhook(p_id)',            'Not your game'),
      ('admin_revoke_pet_jar(uuid, boolean)',                 'may_manage_pet_jar(p_submission_id)', 'Not your game'),

      -- ---- any organiser, no game involved: 3 functions ---------------------
      -- The shared board catalogue. Moderators read it and save into it; only
      -- an admin deletes from it, so admin_delete_library_tile is not here.
      ('admin_list_library()',                                '(is_admin() or is_moderator())', 'Organisers only'),
      ('admin_save_library_tile(uuid, jsonb)',                '(is_admin() or is_moderator())', 'Organisers only'),
      ('admin_list_board_presets()',                          '(is_admin() or is_moderator())', 'Organisers only'),

      -- ---- creating a game: the mode is the permission ----------------------
      ('admin_new_game(text, game_mode, text[], smallint, timestamptz)', 'may_run_mode(p_mode)',        'Not a mode you run'),
      ('admin_create_game(text, text, text, smallint, smallint)',        'may_run_mode(''battleships'')', 'Not a mode you run')
    ) as t(fn, gate, msg)
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);

    select count(*) into v_n from regexp_matches(v_def, v_std, 'g');
    if v_n <> 1 then
      raise exception '% has % copies of the standard guard, expected 1 -- nothing swapped', r.fn, v_n;
    end if;

    execute regexp_replace(
      v_def, v_std,
      'if not ' || r.gate || ' then raise exception ''' || r.msg || '''; end if;');
  end loop;
end
$swap$;

-- ============================================================
-- The five that word their guard differently
-- ============================================================
-- Each matched on a fragment that stops before any apostrophe in the message,
-- so the rest of the sentence is carried through untouched.

do $odd$
declare
  r     record;
  v_def text;
  v_n   int;
begin
  for r in
    select fn, pat, repl from (values
      -- "Only an admin may start the game" -> the organiser of this game
      ('start_game(uuid)',
       'if not is_admin\(\) then\s+raise exception ''Only an admin may start the game'';',
       'if not may_manage_game(p_game_id) then raise exception ''Only an organiser of this game may start it'';'),

      -- "Only an organiser can view a team''s board" -- stop before the apostrophe
      ('admin_board_for_team(uuid, uuid, team_role)',
       'if not is_admin\(\) then\s+raise exception ''Only an organiser can view a team',
       'if not may_manage_game(p_game_id) then raise exception ''Only an organiser of this game can view a team'),

      -- A captain places their own fleet; an organiser may place it for them.
      ('place_fleet(uuid, jsonb)',
       'if not is_admin\(\) and not exists \(',
       'if not may_manage_team(p_team_id) and not exists ('),

      ('rename_team(uuid, text)',
       'if not is_admin\(\) and not exists \(',
       'if not may_manage_team(p_team_id) and not exists ('),

      -- The x-act-as-team header. v is the team id the caller sent. Wider than
      -- the old is_admin(), not tighter: an admin still answers for any team,
      -- and a moderator is added for the teams they may manage.
      ('acting_as_team()',
       'if not is_admin\(\) then\s+return null;',
       'if not (is_admin() or may_manage_team(v::uuid)) then return null;')
    ) as t(fn, pat, repl)
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    select count(*) into v_n from regexp_matches(v_def, r.pat, 'g');
    if v_n <> 1 then
      raise exception '% has % copies of its guard, expected 1 -- nothing swapped', r.fn, v_n;
    end if;
    execute regexp_replace(v_def, r.pat, r.repl);
  end loop;
end
$odd$;

-- ============================================================
-- admin_game_readiness: filter, do not refuse
-- ============================================================
-- The console asks this once for every game it lists. Refusing a moderator
-- outright would blank their own checklist, so it answers for the games they
-- may manage and leaves the rest out.

do $ready$
declare
  v_def text;
  v_n   int;
begin
  v_def := pg_get_functiondef('admin_game_readiness()'::regprocedure);

  select count(*) into v_n from regexp_matches(v_def, 'if not is_admin\(\) then raise exception ''Admins only''; end if;', 'g');
  if v_n <> 1 then
    raise exception 'admin_game_readiness has % copies of the guard, expected 1', v_n;
  end if;
  v_def := regexp_replace(v_def, 'if not is_admin\(\) then raise exception ''Admins only''; end if;',
                          'if not (is_admin() or is_moderator()) then raise exception ''Organisers only''; end if;');

  select count(*) into v_n from regexp_matches(v_def, 'from games g;', 'g');
  if v_n <> 1 then
    raise exception 'admin_game_readiness has % copies of "from games g;", expected 1', v_n;
  end if;
  execute regexp_replace(v_def, 'from games g;', 'from games g where may_manage_game(g.id);');
end
$ready$;

-- ============================================================
-- Nothing swept still asks is_admin() on its own
-- ============================================================
-- Cheap insurance against a swap that matched but replaced the wrong thing.

do $check$
declare
  v_fn    text;
  v_left  text[] := '{}';
begin
  foreach v_fn in array array[
    'admin_delete_game(uuid)', 'admin_set_tiles(uuid, jsonb)', 'admin_adjust_score(uuid, integer, text, uuid)',
    'admin_release_claim(uuid)', 'admin_new_game(text, game_mode, text[], smallint, timestamptz)',
    'start_game(uuid)', 'place_fleet(uuid, jsonb)', 'admin_game_readiness()'] loop
    if pg_get_functiondef(v_fn::regprocedure) ~ 'if not is_admin\(\) then raise exception ''Admins only''' then
      v_left := v_left || v_fn;
    end if;
  end loop;

  if array_length(v_left, 1) is not null then
    raise exception 'still admin-only after the sweep: %', array_to_string(v_left, ', ');
  end if;
end
$check$;
