-- ============================================================
-- Take out "deleting a challenge deletes its WOM competition"
-- ============================================================
--
-- 20261026170000 added it. It did not work: "Test TFA" was deleted on the site
-- on 2026-10-26, the game went, and competition 162883 was still live on
-- wiseoldman.net afterwards with its updatedAt untouched -- so nothing reached
-- WOM at all. Which link failed was never established, and rather than keep a
-- half-working path in the schema, it comes out.
--
-- Forward, not a revert. supabase db push only moves forward, and 170000 is
-- already applied to production: deleting that file would leave the applied
-- list and the repo disagreeing and put every later push into drift. So the
-- file stays where it is and this one undoes what it did.
--
-- BEFORE YOU RUN THIS, READ challenge_wom_deleted.
--
--   select competition_id, game_name, verification_code, requested_at
--     from challenge_wom_deleted order by requested_at desc;
--
-- Dropping that table destroys the verification codes in it, and for a game
-- that has already been deleted there is no other copy anywhere -- not in
-- challenge_wom, which the cascade took, and not from WOM, who issue a code
-- once. Any competition listed there is one you can still delete by hand while
-- this table exists, and cannot afterwards.
--
-- What goes back to how it was: deleting a challenge deletes the game and
-- leaves its competition running on wiseoldman.net, un-deletable, because the
-- cascade takes the verification code with it. That is the behaviour this
-- restores, and it is worth knowing it is the behaviour.

-- ============================================================
-- 1. admin_delete_game, as it was
-- ============================================================
-- Body verbatim from 0006_admin_and_ship_spacing.sql.

create or replace function admin_delete_game(p_game_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  delete from games where id = p_game_id;   -- cascades to teams, tiles, claims, events
end;
$$;

revoke execute on function admin_delete_game(uuid) from public, anon;
grant  execute on function admin_delete_game(uuid) to authenticated;

-- ============================================================
-- 2. And the rest of it out
-- ============================================================

drop function if exists challenge_wom_destroy(uuid);

drop table if exists challenge_wom_deleted;
