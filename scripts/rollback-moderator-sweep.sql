-- Undo 20261025130000_moderator_sweep.sql: every guard goes back to is_admin(),
-- so moderators can do nothing again. The grants and the moderator_modes table
-- survive — this reverses the sweep only, not 20261025120000.
--
-- Same technique as the sweep: the body comes from the live definition and only
-- the guard line changes, so anything else that has been fixed in these
-- functions since is kept. Each swap asserts it matched exactly once.
--
-- Run in the Supabase SQL editor.

do $back$
declare
  r     record;
  v_def text;
  v_n   int;
begin
  for r in
    select fn, pat from (values
      ('admin_add_team(uuid, text)',                           'may_manage_game\(p_game_id\)'),
      ('admin_apply_board_preset(uuid, uuid)',                 'may_manage_game\(p_game_id\)'),
      ('admin_autofill_board(uuid)',                           'may_manage_game\(p_game_id\)'),
      ('admin_clear_board(uuid)',                              'may_manage_game\(p_game_id\)'),
      ('admin_clear_tile(uuid, smallint, smallint)',           'may_manage_game\(p_game_id\)'),
      ('admin_delete_game(uuid)',                              'may_manage_game\(p_game_id\)'),
      ('admin_end_game(uuid)',                                 'may_manage_game\(p_game_id\)'),
      ('admin_import_board_to_library(uuid)',                  'may_manage_game\(p_game_id\)'),
      ('admin_list_evidence(uuid)',                            'may_manage_game\(p_game_id\)'),
      ('admin_list_pet_jars(uuid)',                            'may_manage_game\(p_game_id\)'),
      ('admin_list_pet_trades(uuid)',                          'may_manage_game\(p_game_id\)'),
      ('admin_list_score_events(uuid)',                        'may_manage_game\(p_game_id\)'),
      ('admin_list_ship_cells(uuid)',                          'may_manage_game\(p_game_id\)'),
      ('admin_list_tiles(uuid)',                               'may_manage_game\(p_game_id\)'),
      ('admin_list_webhooks(uuid)',                            'may_manage_game\(p_game_id\)'),
      ('admin_open_placement(uuid)',                           'may_manage_game\(p_game_id\)'),
      ('admin_save_board_preset(uuid, text)',                  'may_manage_game\(p_game_id\)'),
      ('admin_set_end_time(uuid, timestamptz)',                'may_manage_game\(p_game_id\)'),
      ('admin_set_featured_game(uuid)',                        'may_manage_game\(p_game_id\)'),
      ('admin_set_scoring(uuid, smallint, smallint, smallint)','may_manage_game\(p_game_id\)'),
      ('admin_set_snakes(uuid, jsonb)',                        'may_manage_game\(p_game_id\)'),
      ('admin_set_start_time(uuid, timestamptz)',              'may_manage_game\(p_game_id\)'),
      ('admin_set_territory_homes(uuid, jsonb)',               'may_manage_game\(p_game_id\)'),
      ('admin_set_tile(uuid, smallint, smallint, jsonb)',      'may_manage_game\(p_game_id\)'),
      ('admin_set_tiles(uuid, jsonb)',                         'may_manage_game\(p_game_id\)'),
      ('admin_set_webhook(uuid, uuid, text, boolean, text)',   'may_manage_game\(p_game_id\)'),
      ('admin_shuffle_board(uuid)',                            'may_manage_game\(p_game_id\)'),
      ('admin_snakes_end_game(uuid, uuid)',                    'may_manage_game\(p_game_id\)'),
      ('admin_swap_tiles(uuid, int, int, int, int)',           'may_manage_game\(p_game_id\)'),
      ('admin_tile_progress(uuid)',                            'may_manage_game\(p_game_id\)'),
      ('admin_adjust_score(uuid, integer, text, uuid)',        'may_manage_team\(p_team_id\)'),
      ('admin_delete_team(uuid)',                              'may_manage_team\(p_team_id\)'),
      ('admin_remove_member(uuid, uuid)',                      'may_manage_team\(p_team_id\)'),
      ('admin_set_member(uuid, uuid, team_role)',              'may_manage_team\(p_team_id\)'),
      ('admin_snakes_complete_tile(uuid)',                     'may_manage_team\(p_team_id\)'),
      ('admin_snakes_give_rollback(uuid, integer)',            'may_manage_team\(p_team_id\)'),
      ('admin_snakes_move(uuid, integer)',                     'may_manage_team\(p_team_id\)'),
      ('admin_snakes_punish(uuid)',                            'may_manage_team\(p_team_id\)'),
      ('admin_snakes_uncomplete_tile(uuid, integer)',          'may_manage_team\(p_team_id\)'),
      ('admin_release_claim(uuid)',                            'may_manage_claim\(p_claim_id\)'),
      ('admin_revoke_evidence(uuid, boolean)',                 'may_manage_evidence\(p_evidence_id\)'),
      ('admin_test_tile(uuid, jsonb)',                         'may_manage_tile\(p_tile_id\)'),
      ('admin_delete_score_event(uuid)',                       'may_manage_score_event\(p_id\)'),
      ('admin_delete_webhook(uuid)',                           'may_manage_webhook\(p_id\)'),
      ('admin_revoke_pet_jar(uuid, boolean)',                  'may_manage_pet_jar\(p_submission_id\)'),
      ('admin_list_library()',                                 '\(is_admin\(\) or is_moderator\(\)\)'),
      ('admin_save_library_tile(uuid, jsonb)',                 '\(is_admin\(\) or is_moderator\(\)\)'),
      ('admin_list_board_presets()',                           '\(is_admin\(\) or is_moderator\(\)\)'),
      ('admin_new_game(text, game_mode, text[], smallint, timestamptz)', 'may_run_mode\(p_mode\)'),
      ('admin_create_game(text, text, text, smallint, smallint)',        'may_run_mode\(''battleships''\)')
    ) as t(fn, pat)
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    select count(*) into v_n from regexp_matches(v_def, r.pat, 'g');
    if v_n <> 1 then
      raise exception '% has % copies of its gate, expected 1 -- not changed', r.fn, v_n;
    end if;
    -- the message differs per function; put the guard back whole
    execute regexp_replace(
      v_def,
      'if not ' || r.pat || ' then raise exception ''[^'']*''; end if;',
      'if not is_admin() then raise exception ''Admins only''; end if;');
  end loop;
end
$back$;

-- ---- the five reworded guards ----------------------------------------------

do $back_odd$
declare
  r     record;
  v_def text;
  v_n   int;
begin
  for r in
    select fn, pat, repl from (values
      ('start_game(uuid)',
       'if not may_manage_game\(p_game_id\) then raise exception ''Only an organiser of this game may start it'';',
       'if not is_admin() then raise exception ''Only an admin may start the game'';'),
      ('admin_board_for_team(uuid, uuid, team_role)',
       'if not may_manage_game\(p_game_id\) then raise exception ''Only an organiser of this game can view a team',
       'if not is_admin() then raise exception ''Only an organiser can view a team'),
      ('place_fleet(uuid, jsonb)',
       'if not may_manage_team\(p_team_id\) and not exists \(',
       'if not is_admin() and not exists ('),
      ('rename_team(uuid, text)',
       'if not may_manage_team\(p_team_id\) and not exists \(',
       'if not is_admin() and not exists ('),
      ('acting_as_team()',
       'if not \(is_admin\(\) or may_manage_team\(v::uuid\)\) then return null;',
       'if not is_admin() then return null;')
    ) as t(fn, pat, repl)
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    select count(*) into v_n from regexp_matches(v_def, r.pat, 'g');
    if v_n <> 1 then
      raise exception '% has % copies of its gate, expected 1 -- not changed', r.fn, v_n;
    end if;
    execute regexp_replace(v_def, r.pat, r.repl);
  end loop;
end
$back_odd$;

-- ---- readiness: refuse again, and stop filtering ----------------------------

do $back_ready$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('admin_game_readiness()'::regprocedure);
  v_def := regexp_replace(v_def,
    'if not \(is_admin\(\) or is_moderator\(\)\) then raise exception ''Organisers only''; end if;',
    'if not is_admin() then raise exception ''Admins only''; end if;');
  execute regexp_replace(v_def, 'from games g where may_manage_game\(g\.id\);', 'from games g;');
end
$back_ready$;

-- ---- the resolvers this migration added -------------------------------------

drop function if exists may_manage_team(uuid);
drop function if exists may_manage_claim(uuid);
drop function if exists may_manage_evidence(uuid);
drop function if exists may_manage_score_event(uuid);
drop function if exists may_manage_tile(uuid);
drop function if exists may_manage_pet_jar(uuid);
drop function if exists may_manage_webhook(uuid);
