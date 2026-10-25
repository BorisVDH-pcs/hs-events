-- Undo 20261025120000_moderator_role.sql: there are admins and players again,
-- and nothing in between.
--
-- Safe to run while the sweep migration that uses these gates is NOT yet
-- applied, which is the only state this migration ships in on its own. Once the
-- guards have been swapped, drop that migration first — may_manage_game() is
-- called from inside the admin_* functions by then, and removing it would break
-- every one of them.
--
-- Run in the Supabase SQL editor. Any modes handed out are lost; they had no
-- effect, so nothing an organiser did is undone with them.

drop function if exists admin_set_moderator_modes(uuid, game_mode[]);
drop function if exists admin_list_moderators();
drop function if exists my_moderator_modes();
drop function if exists may_run_mode(game_mode);
drop function if exists may_manage_game(uuid);
drop function if exists is_moderator();

drop table if exists moderator_modes;
