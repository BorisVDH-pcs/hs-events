-- ============================================================
-- The end time belongs to more than bingo
-- ============================================================
-- `admin_set_end_time` has refused every mode but bingo since 20261001120100,
-- and the message says so: "Only a bingo has an end time".
--
-- That stopped being true twice.
--
--   * TERRITORY, in 20261013120100. The end time is the whole of how a
--     conquest finishes -- the biggest empire at that moment wins -- and the
--     console has offered an End time editor for it ever since. Pressing save
--     has been refused the entire time. A bug, found while adding the mode
--     below, and fixed here rather than left in place beside the fix for it.
--   * CHALLENGE, in 20261026120100. A challenge is a window: its figures are
--     what changed between the start and the end, so an event with no end has
--     nothing to measure. `challenge_start` refuses one without a future end
--     time, which an organiser could not then set.
--
-- Patched, not rewritten, for the reason 20261026120200 explains at length:
-- 20261025130000 swapped this function's guard at runtime, so the copy in the
-- ledger still reads `if not is_admin()` while the one in the database reads
-- `if not may_manage_game(p_game_id)`. Re-emitting the ledger's copy would
-- quietly hand every moderator's permission back to admins only. The anchor
-- below is the mode check, which the sweep never touched; whatever the guard
-- now says is carried through untouched.

do $patch$
declare
  v_def text;
  v_n   int;
  v_fn  constant text := 'admin_set_end_time(uuid, timestamptz)';
  v_pat constant text :=
    'if v_game\.mode <> ''bingo'' then\s+raise exception ''Only a bingo has an end time'';\s+end if;';
  v_rep constant text :=
    'if v_game.mode not in (''bingo'', ''territory'', ''challenge'') then'
    || ' raise exception ''This game has no end time''; end if;';
begin
  if to_regprocedure(v_fn) is null then
    raise exception 'nothing patched -- % does not exist', v_fn;
  end if;

  v_def := pg_get_functiondef(v_fn::regprocedure);
  select count(*) into v_n from regexp_matches(v_def, v_pat, 'g');
  if v_n <> 1 then
    raise exception 'nothing patched -- %: its anchor matched % times, expected 1', v_fn, v_n;
  end if;

  execute regexp_replace(v_def, v_pat, v_rep);
end
$patch$;
