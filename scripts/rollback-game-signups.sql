-- Rollback for 20261026160000_game_signups.sql
--
-- Takes the board modes back to building a roster from every registered
-- account. Nothing else reads game_signups: no mode's rules look at it, and
-- team_members is untouched by this file, so every roster already built stays
-- exactly as it is. What is lost is who had put their hand up -- the table goes
-- with its rows, and there is nowhere else they are written down.
--
-- Run it in one transaction and check the roster still loads before committing.

begin;

-- 20261027120000 added this one on top; it reads the table below, so it goes
-- with it. Dropping it alone is scripts/rollback-admin-signup-remove.sql.
drop function if exists admin_game_signup_remove(uuid, uuid);
drop function if exists admin_game_signups(uuid);
drop function if exists game_signup_list();
drop function if exists game_signup_leave(uuid);
drop function if exists game_signup_join(uuid, text);

drop trigger if exists game_signups_is_not_a_challenge on game_signups;
drop function if exists enforce_signup_not_challenge();

drop table if exists game_signups;

commit;
