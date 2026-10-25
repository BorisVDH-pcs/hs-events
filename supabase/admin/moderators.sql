-- HS Events — admin snippets for moderator modes
--
-- Run these in the Supabase SQL Editor (service role), the same way as
-- player-accounts.sql. The console does the same thing through
-- admin_set_moderator_modes once the Accounts screen offers it; these snippets
-- are the way in before that, and the way in when nobody can reach the console.
--
-- A moderator holds MODES, not games: 'battleships', 'bingo', 'snakes',
-- 'territory'. They may create and run games of those modes and nothing else.
-- Admins are not listed here — is_admin already covers every mode.


-- ============================================================
-- Who holds what
-- ============================================================

select p.display_name,
       array_agg(m.mode order by m.mode) as modes,
       min(m.granted_at)                 as since
  from moderator_modes m
  join profiles p on p.id = m.profile_id
 group by p.display_name
 order by p.display_name;


-- ============================================================
-- Make someone a moderator of one or more modes
-- ============================================================
-- Replaces their whole grant, so list every mode they should end up with.
-- The username is matched the way the player typed it at sign-up.

insert into moderator_modes (profile_id, mode)
select p.id, m
  from profiles p
 cross join unnest(array['bingo', 'snakes']::game_mode[]) as m
 where lower(p.display_name) = lower('REPLACE WITH USERNAME')
on conflict (profile_id, mode) do nothing;


-- ============================================================
-- Take one mode back
-- ============================================================

delete from moderator_modes m
 using profiles p
 where m.profile_id = p.id
   and lower(p.display_name) = lower('REPLACE WITH USERNAME')
   and m.mode = 'snakes';


-- ============================================================
-- Demote to an ordinary player
-- ============================================================

delete from moderator_modes m
 using profiles p
 where m.profile_id = p.id
   and lower(p.display_name) = lower('REPLACE WITH USERNAME');
