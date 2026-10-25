-- ============================================================
-- My Account: the RuneScape accounts a player says are theirs
-- ============================================================
--
-- 0004 seeds profiles.rsn from the platform username at sign-up:
--
--   options: { data: { display_name: username.trim(), rsn: username.trim() } }
--
-- so every account on this site already HAS a RuneScape name, and for anyone
-- who did not happen to register under their exact in-game name that name is
-- wrong. It was never a missing field -- it was a field quietly filled with a
-- guess, and nothing on the site has ever been able to edit it. The one place
-- a player types an RSN is the challenge sign-up box, and that writes to
-- challenge_entries.rsn, which is snapshotted on purpose and never written
-- back. So a correction has never survived the event it was made in: the same
-- wrong name comes back next time, and the time after.
--
-- This is the table behind the My Account screen. Three things follow from
-- the shape:
--
--  * A LIST, not a field. Alts are normal, and an account list is also what
--    lets an organiser reviewing a bingo screenshot tell a player's own alt
--    from a stranger's name.
--
--  * ONE OF THEM IS PRIMARY, and profiles.rsn is kept equal to it by trigger
--    (section 6). Every existing reader -- challenge_join's fallback, the
--    Discord feed -- therefore keeps working untouched, and keeps working
--    through a profile edit it knows nothing about.
--
--  * NOT WORLD-READABLE, unlike profiles. profiles_read is `using (true)`, so
--    a player's primary name is already public and stays public. The rest of
--    the list is not: people hide their alts, and publishing everyone's to
--    the whole clan is not a side effect a settings screen should have. The
--    owner and the organisers see it; nobody else does.

-- ============================================================
-- 1. One normaliser, named once
-- ============================================================
--
-- challenge_rsn_key has done this since 20261026120200 and is the thing WOM
-- names are compared with. It is lifted out here rather than copied, because
-- a second definition of "the same name" is a bug waiting for the day the two
-- drift. The challenge name keeps working and keeps its grants; it is now a
-- wrapper.
--
-- Underscores fold to spaces because that is how RuneScape writes a space in
-- a URL, and a player who types Zezima_1 means Zezima 1.

create or replace function rsn_key(p_name text)
returns text
language sql immutable
set search_path = public as $fn$
  select nullif(lower(btrim(regexp_replace(coalesce(p_name, ''), '[_\s]+', ' ', 'g'))), '');
$fn$;

comment on function rsn_key(text) is
  'Two RSNs are the same name when their keys match: case, padding and underscore-vs-space folded away.';

create or replace function challenge_rsn_key(p_name text)
returns text
language sql immutable
set search_path = public as $fn$
  select rsn_key(p_name);
$fn$;

-- The stored form: what the key folds, but readable. Collapsed spacing and
-- trimmed, with the player's own capitalisation left exactly as typed --
-- in-game names are shown the way their owner writes them, and WOM echoes
-- displayName back the same way.
create or replace function rsn_clean(p_name text)
returns text
language sql immutable
set search_path = public as $fn$
  select nullif(btrim(regexp_replace(coalesce(p_name, ''), '[_\s]+', ' ', 'g')), '');
$fn$;

revoke execute on function rsn_key(text), rsn_clean(text) from public, anon;
grant  execute on function rsn_key(text), rsn_clean(text) to authenticated;

-- ============================================================
-- 2. The table
-- ============================================================

create table profile_accounts (
  id         uuid        primary key default gen_random_uuid(),
  profile_id uuid        not null references profiles(id) on delete cascade,

  -- Stored in rsn_clean form by the trigger in section 4, so the check below
  -- is about characters only and never about stray padding.
  rsn        text        not null,

  -- Exactly one per profile, enforced by the partial unique index below and
  -- kept true through a delete by the trigger in section 5. This is the name
  -- that lands in profiles.rsn, which is the name the rest of the site has
  -- always read.
  is_primary boolean     not null default false,

  -- The player's own word for which account this is: 'main', 'ironman',
  -- 'the alt I do slayer on'. Never shown to WOM, which only ever sees `rsn`.
  label      text        check (label is null or char_length(label) <= 40),

  created_at timestamptz not null default now(),

  -- WOM's own rule, and the only one that matters: addParticipants validates
  -- the format and nothing else. One to twelve characters, letters, digits
  -- and spaces. Underscores are gone by now -- rsn_clean folded them.
  constraint profile_accounts_rsn_check
    check (rsn ~ '^[A-Za-z0-9 ]{1,12}$')
);

comment on table profile_accounts is
  'The RuneScape accounts a player has declared. The primary one is mirrored into profiles.rsn.';
comment on column profile_accounts.rsn is
  'In WOM''s format: 1-12 characters, letters, digits and spaces. Stored as typed, matched on rsn_key().';
comment on column profile_accounts.is_primary is
  'Exactly one per profile. This is the one profiles.rsn holds and the one a challenge defaults to.';

-- The same name twice on one profile is a mistake, not a second account --
-- and it would put the same name on a WOM competition twice.
create unique index profile_accounts_one_name
  on profile_accounts (profile_id, rsn_key(rsn));

create unique index profile_accounts_one_primary
  on profile_accounts (profile_id) where is_primary;

create index profile_accounts_profile_idx on profile_accounts (profile_id);

-- Deliberately not unique across profiles. Two people claiming the same name
-- is worth an organiser's attention, but refusing the second one at the
-- database would let anybody lock a name they do not own away from its real
-- owner. A challenge already refuses to score the same RSN twice in one event
-- (challenge_wom_drop, 20261026120600), which is where it actually matters.

-- ============================================================
-- 3. How many
-- ============================================================
--
-- A cap, because the list goes onto a WOM competition in a multi-account
-- event and an unbounded one is an unbounded request. Five is main plus four,
-- which covers every real case anyone has described; it is a number to raise
-- when somebody hits it, not a judgement about how people should play.

create or replace function profile_accounts_cap()
returns trigger
language plpgsql
security definer set search_path = public as $fn$
begin
  if (select count(*) from profile_accounts where profile_id = new.profile_id) > 5 then
    raise exception 'Five accounts is the limit — remove one before adding another';
  end if;
  return null;
end;
$fn$;

create trigger profile_accounts_cap_trg
  after insert on profile_accounts
  for each row execute function profile_accounts_cap();

-- ============================================================
-- 4. Tidying the name on the way in
-- ============================================================

create or replace function profile_accounts_clean()
returns trigger
language plpgsql
security definer set search_path = public as $fn$
begin
  new.rsn := rsn_clean(new.rsn);
  if new.rsn is null then
    raise exception 'That is not a name — type the account''s RuneScape name';
  end if;
  new.label := nullif(btrim(coalesce(new.label, '')), '');
  return new;
end;
$fn$;

create trigger profile_accounts_clean_trg
  before insert or update on profile_accounts
  for each row execute function profile_accounts_clean();

-- ============================================================
-- 5. Keeping exactly one primary
-- ============================================================
--
-- Three cases, all of which can happen through the screen:
--
--  * The first account added is primary whether or not it was asked for --
--    a list of one with no primary would leave profiles.rsn null and the
--    challenge sign-up box empty for somebody who has clearly set a name.
--  * Marking one primary unmarks the other.
--  * Deleting the primary promotes the oldest of what is left, so a profile
--    never ends up with accounts but no primary.
--
-- THE FIRST TWO HAVE TO HAPPEN BEFORE THE ROW LANDS. profile_accounts_one_primary
-- is a partial unique INDEX, and a unique index is checked per row as the row
-- is written -- there is no deferring it, and a partial unique constraint,
-- which could be deferred, is not a thing Postgres has. So an AFTER trigger
-- that tidies up the old primary never gets to run: the write that makes the
-- second one primary is refused first. Clearing the old one BEFORE the new
-- row is written means the index only ever sees one.

create or replace function profile_accounts_one_primary()
returns trigger
language plpgsql
security definer set search_path = public as $fn$
begin
  -- On INSERT the row has no id of its own yet to exclude, and on UPDATE it
  -- must not unmark itself. Both are covered by `id is distinct from new.id`.
  if new.is_primary then
    update profile_accounts set is_primary = false
     where profile_id = new.profile_id
       and id is distinct from new.id
       and is_primary;

  -- First one in is primary whether or not the screen asked for it. Only on
  -- INSERT: an UPDATE that clears the flag is this trigger unmarking the old
  -- primary a line above, and flipping it straight back would deadlock the
  -- two rows against each other.
  elsif tg_op = 'INSERT'
    and not exists (select 1 from profile_accounts
                     where profile_id = new.profile_id and is_primary) then
    new.is_primary := true;
  end if;

  return new;
end;
$fn$;

create trigger profile_accounts_one_primary_trg
  before insert or update of is_primary on profile_accounts
  for each row execute function profile_accounts_one_primary();

-- The promotion after a delete has no such problem: by the time it runs the
-- primary row is gone, so there is nothing for the index to collide with.
create or replace function profile_accounts_promote()
returns trigger
language plpgsql
security definer set search_path = public as $fn$
begin
  if old.is_primary then
    update profile_accounts set is_primary = true
     where id = (select id from profile_accounts
                  where profile_id = old.profile_id
                  order by created_at, id
                  limit 1);
  end if;
  return null;
end;
$fn$;

create trigger profile_accounts_promote_trg
  after delete on profile_accounts
  for each row execute function profile_accounts_promote();

-- ============================================================
-- 6. profiles.rsn follows the primary
-- ============================================================
--
-- The compatibility seam, and the reason nothing else in this repo had to
-- change. challenge_join falls back to profiles.rsn; the Discord feed reads
-- it; 0001 has called it "RuneScape name, for the Discord feed" since the
-- beginning. All of that keeps working, and now it is also correct, because
-- the player can finally edit what it holds.
--
-- security definer: profiles_self (0006) only lets a profile update itself,
-- and this runs on the owner's behalf from a trigger, not in their session.

create or replace function profile_accounts_sync_rsn()
returns trigger
language plpgsql
security definer set search_path = public as $fn$
declare
  v_profile uuid := coalesce(new.profile_id, old.profile_id);
begin
  update profiles p
     set rsn = (select a.rsn from profile_accounts a
                 where a.profile_id = v_profile and a.is_primary)
   where p.id = v_profile;
  return null;
end;
$fn$;

create trigger profile_accounts_sync_rsn_trg
  after insert or update or delete on profile_accounts
  for each row execute function profile_accounts_sync_rsn();

-- ============================================================
-- 7. Who may see and change a list
-- ============================================================

alter table profile_accounts enable row level security;

-- The owner, and the organisers who review their screenshots. Not the clan:
-- see the header. A player's PRIMARY name stays as public as it ever was,
-- because profiles_read still answers profiles.rsn to everybody.
create policy profile_accounts_read on profile_accounts
  for select using (profile_id = auth.uid() or is_admin() or is_moderator());

create policy profile_accounts_own_insert on profile_accounts
  for insert with check (profile_id = auth.uid());

create policy profile_accounts_own_update on profile_accounts
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy profile_accounts_own_delete on profile_accounts
  for delete using (profile_id = auth.uid());

revoke all on profile_accounts from anon;
grant select, insert, update, delete on profile_accounts to authenticated;

-- ============================================================
-- 8. What is already there
-- ============================================================
--
-- Every profile with an rsn gets it as their primary account, so nobody opens
-- My Account to an empty list and nobody's challenge sign-up box goes blank
-- on the day this ships.
--
-- A seeded name that does not fit WOM's format is skipped rather than
-- mangled: the username it was copied from has no length limit and may hold
-- anything. Those players get an empty list, which is the honest answer --
-- the name was never going to match the hiscores, and the screen now asks
-- them for one that will.

insert into profile_accounts (profile_id, rsn, is_primary)
select p.id, rsn_clean(p.rsn), true
  from profiles p
 where rsn_clean(p.rsn) is not null
   and rsn_clean(p.rsn) ~ '^[A-Za-z0-9 ]{1,12}$'
on conflict do nothing;

-- And the ones that were skipped: the profile keeps a name no hiscore will
-- ever match, which is exactly what the screen is for. Cleared, so the
-- challenge sign-up box asks rather than pre-filling a known-bad guess.
update profiles p
   set rsn = null
 where p.rsn is not null
   and not exists (select 1 from profile_accounts a where a.profile_id = p.id);

-- ============================================================
-- 9. Reading your own list
-- ============================================================
--
-- A plain select would do for the owner, but the screen also wants to know
-- whether a name has ever been found on the hiscores, and that lives on
-- challenge_entries behind RLS with no policies. One RPC, so the screen makes
-- one call and the player sees the warning in the place they can act on it.

create or replace function my_accounts()
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
   where a.profile_id = auth.uid()
   order by a.is_primary desc, a.created_at, a.id;
$fn$;

revoke execute on function my_accounts() from public, anon;
grant  execute on function my_accounts() to authenticated;

comment on function my_accounts() is
  'This player''s declared accounts, with whatever WOM last said about each.';
