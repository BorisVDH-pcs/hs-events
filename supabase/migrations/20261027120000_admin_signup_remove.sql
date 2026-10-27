-- ============================================================
-- Taking a name off the sign-up list, as an organiser
-- ============================================================
--
-- 20261026160000 gave a player two buttons -- put my hand up, take it down --
-- and gave an organiser none. game_signups is RLS on with every grant revoked
-- from authenticated, so the only delete anywhere in the schema is
-- game_signup_leave, which deletes the caller's own row and refuses once they
-- are on a team.
--
-- That leaves rows nobody can clear. Somebody who signs up and then goes quiet,
-- or signs up for the wrong event, sits in the shortlist the roster picker
-- opens on for as long as the event exists. Worse: once an organiser has
-- rostered them, they cannot take their own name back off either -- leave
-- refuses, and the organiser removing them from the team only drops them back
-- into the shortlist, because `rostered` is read live from team_members. The
-- one way out of that loop was the Supabase dashboard.
--
-- ONE ROW, AND ONLY THAT ROW. This does not touch team_members. Clearing the
-- sign-up of somebody already on a team leaves them on it: they are playing,
-- and the roster is what says so. The two verbs stay as separate as
-- admin_remove_member and game_signup_leave already are, and the console says
-- in as many words which one it is about to do.
--
-- NO STATUS GUARD, unlike join and leave. Those close at placement because a
-- board game's teams are formed before it starts, and somebody arriving
-- afterwards has nowhere to go that does not change a game in progress. This
-- is an organiser tidying their own list, which is worth doing precisely when
-- the event has started and the list has gone stale. admin_remove_member, the
-- heavier of the two actions, has never carried one either.
--
-- WHO. may_manage_game, the same gate as admin_game_signups: whoever is
-- trusted to read the list is trusted to prune it, and a moderator who runs
-- the mode is an organiser for this purpose like any other.

create or replace function admin_game_signup_remove(p_game_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer set search_path = public as $fn$
begin
  if not may_manage_game(p_game_id) then raise exception 'Not your game'; end if;

  -- No row is not an error. Two organisers clearing the same stale name, or a
  -- player leaving between the list being drawn and the button being pressed,
  -- both want the same answer: the name is off the list.
  delete from game_signups
   where game_id = p_game_id and profile_id = p_profile_id;
end;
$fn$;

comment on function admin_game_signup_remove(uuid, uuid) is
  'Clears one sign-up row. Leaves team_members alone -- being rostered is a separate thing.';

revoke execute on function admin_game_signup_remove(uuid, uuid) from public, anon;
grant  execute on function admin_game_signup_remove(uuid, uuid) to authenticated;
