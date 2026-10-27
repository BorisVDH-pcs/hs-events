-- Rollback for 20261027120000_admin_signup_remove.sql
--
-- Takes away the organiser's Remove button and nothing else. The sign-up rows
-- themselves are untouched, team_members is untouched, and the other four
-- functions from 20261026160000 go on working exactly as they did -- a player
-- can still put their hand up and take it down.
--
-- What comes back is the gap this closed: a sign-up nobody can clear once the
-- player is rostered or has gone quiet.
--
-- The console is not rolled back by this file and has no way to ask whether a
-- function exists short of calling it, so the Sign-ups list still draws its
-- Remove button. Pressing it afterwards reports the missing function in the
-- notice bar rather than quietly doing nothing. Deploy the matching console
-- build alongside this, or expect that one line.

begin;

drop function if exists admin_game_signup_remove(uuid, uuid);

commit;
