-- Rollback for 20261027130000_admin_profile_accounts.sql
--
-- Takes away the organiser's view of a player's accounts and puts my_accounts
-- back the way 20261026130000 wrote it, body and all, so that nothing is left
-- pointing at the shared helper this drops.
--
-- Nothing is lost but the screen. No table, column or row is touched here --
-- profile_accounts keeps everything, and its read policy still says an admin
-- or a moderator MAY read it. They simply have nowhere in the console to do
-- it, which is the state this migration found.
--
-- Run it in one transaction and open My Account as a player before committing:
-- that screen is the one this file rewrites.

begin;

drop function if exists admin_profile_accounts(uuid);

-- Verbatim from 20261026130000, so the player's own screen answers exactly
-- what it answered before any of this.
create or replace function my_accounts()
returns table (
  id uuid, rsn text, is_primary boolean, label text, created_at timestamptz,
  wom_found boolean, last_seen timestamptz
)
language sql stable
security definer set search_path = public as $fn$
  select a.id, a.rsn, a.is_primary, a.label, a.created_at,
         (select e.wom_found from challenge_entries e
           where e.profile_id = a.profile_id
             and rsn_key(e.rsn) = rsn_key(a.rsn)
             and e.wom_found is not null
           order by e.joined_at desc limit 1),
         (select max(e.joined_at) from challenge_entries e
           where e.profile_id = a.profile_id
             and rsn_key(e.rsn) = rsn_key(a.rsn))
    from profile_accounts a
   where a.profile_id = auth.uid()
   order by a.is_primary desc, a.created_at, a.id;
$fn$;

revoke execute on function my_accounts() from public, anon;
grant  execute on function my_accounts() to authenticated;

-- Only now, with my_accounts standing on its own again.
drop function if exists profile_accounts_for(uuid);

commit;
