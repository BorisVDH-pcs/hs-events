-- Rollback for 20261026170000_wom_delete_with_game.sql
--
-- Puts admin_delete_game back to the one-line body from
-- 0006_admin_and_ship_spacing.sql, so deleting a challenge again leaves its
-- WOM competition running on wiseoldman.net with nobody able to delete it.
-- That is the behaviour this rolls back TO, and it is worth being sure about
-- before running this.
--
-- Competitions already deleted stay deleted -- WOM says irreversible and means
-- it. Nothing here can undo a request that has gone out.
--
-- READ challenge_wom_deleted BEFORE DROPPING IT. It is the only remaining
-- record of which competitions were taken down and the only place their
-- verification codes still exist. If any of those deletions was refused by
-- WOM, that row is the only way to clean the competition up by hand:
--
--   select request_id, competition_id, game_name, requested_at
--     from challenge_wom_deleted order by requested_at desc;
--
-- Run it in one transaction and check a game still deletes before committing.

begin;

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

drop function if exists challenge_wom_destroy(uuid);

drop table if exists challenge_wom_deleted;

commit;
