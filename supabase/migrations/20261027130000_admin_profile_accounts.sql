-- ============================================================
-- An organiser can see the names a player actually plays under
-- ============================================================
--
-- The permission has been there since 20261026130000. Its read policy says
--
--   using (profile_id = auth.uid() or is_admin() or is_moderator())
--
-- and MyAccount's own header says who the list is for: "the player, and
-- organisers". What was never built is the screen. The only function over the
-- table is my_accounts(), filtered to auth.uid(), so in practice an organiser
-- saw one name at a time and never the list:
--
--   profiles.rsn             the primary only, wherever players are listed
--   admin_challenge_entries  e.rsn, the name snapshotted on one entry
--   admin_game_signups       s.rsn, the name snapshotted on one sign-up
--
-- None of those answers the question somebody asks when a score looks wrong --
-- which accounts does this player have, and has Wise Old Man ever found them.
-- That is a support question, and the answer was the Supabase dashboard.
--
-- WHY THE WOM COLUMNS ARE THE POINT. WOM's addParticipants validates a name's
-- format and nothing else: findOrCreatePlayers invents a row for a name it has
-- never seen, so a typo is accepted with a 200 and then scores nothing for a
-- week. challenge_entries.wom_found is what records that, and an organiser
-- holding it beside the account list can say "that alt has never been found on
-- the hiscores" instead of guessing. Those columns are the whole reason this
-- is a function rather than the client reading the table it is already allowed
-- to read: challenge_entries has RLS on with no policies at all.

-- ============================================================
-- 1. The list, without deciding who may see it
-- ============================================================
--
-- Two callers now, and the lookups into challenge_entries are fiddly enough
-- that having them written out twice would mean fixing them twice. Lifted
-- verbatim out of my_accounts() in 20261026130000; the gate is the caller's
-- business, which is why this one has none -- and why nobody may call it.

create or replace function profile_accounts_for(p_profile_id uuid)
returns table (
  id uuid, rsn text, is_primary boolean, label text, created_at timestamptz,
  wom_found boolean, last_seen timestamptz
)
language sql stable
security definer set search_path = public as $fn$
  select a.id, a.rsn, a.is_primary, a.label, a.created_at,
         -- The most recent thing WOM said about this name in any event this
         -- player entered. Null when they have never played a tracked one.
         (select e.wom_found from challenge_entries e
           where e.profile_id = a.profile_id
             and rsn_key(e.rsn) = rsn_key(a.rsn)
             and e.wom_found is not null
           order by e.joined_at desc limit 1),
         (select max(e.joined_at) from challenge_entries e
           where e.profile_id = a.profile_id
             and rsn_key(e.rsn) = rsn_key(a.rsn))
    from profile_accounts a
   where a.profile_id = p_profile_id
   order by a.is_primary desc, a.created_at, a.id;
$fn$;

comment on function profile_accounts_for(uuid) is
  'The body behind my_accounts and admin_profile_accounts. Takes any profile id and asks nothing: never grant it.';

-- Not even to authenticated. It takes a profile id and checks nobody, so the
-- two wrappers below are the only things that may run it -- and they can,
-- security definer, as the owner, whatever is revoked here.
revoke execute on function profile_accounts_for(uuid) from public, anon, authenticated;

-- ============================================================
-- 2. The player's own, unchanged in what it answers
-- ============================================================

create or replace function my_accounts()
returns table (
  id uuid, rsn text, is_primary boolean, label text, created_at timestamptz,
  wom_found boolean, last_seen timestamptz
)
language sql stable
security definer set search_path = public as $fn$
  select * from profile_accounts_for(auth.uid());
$fn$;

revoke execute on function my_accounts() from public, anon;
grant  execute on function my_accounts() to authenticated;

-- ============================================================
-- 3. And an organiser's view of somebody else's
-- ============================================================
--
-- is_admin() or is_moderator(), to the character the same answer the read
-- policy on the table already gives. Not may_manage_game: this is not about
-- an event. A moderator who runs bingo asking which names a player goes by is
-- asking the same question as an admin, and the row they would be allowed to
-- select directly says yes.
--
-- 'Organisers only' is the wording 20261025130000 settled on for the three
-- functions that are about an organiser rather than a game.

create or replace function admin_profile_accounts(p_profile_id uuid)
returns table (
  id uuid, rsn text, is_primary boolean, label text, created_at timestamptz,
  wom_found boolean, last_seen timestamptz
)
language plpgsql stable
security definer set search_path = public as $fn$
begin
  if not (is_admin() or is_moderator()) then raise exception 'Organisers only'; end if;

  return query select * from profile_accounts_for(p_profile_id);
end;
$fn$;

comment on function admin_profile_accounts(uuid) is
  'One player''s declared accounts, for an organiser. Read-only: nothing here changes anybody else''s list.';

revoke execute on function admin_profile_accounts(uuid) from public, anon;
grant  execute on function admin_profile_accounts(uuid) to authenticated;
