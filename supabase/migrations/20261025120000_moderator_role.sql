-- Moderators: a second tier of organiser, trusted with some game modes but not
-- with the console as a whole.
--
-- Until now there was one privileged flag, profiles.is_admin, and every admin_*
-- function opens with `if not is_admin() then raise exception`. That is
-- all-or-nothing: handing someone the bingo nights also hands them player
-- passwords, account deletion and every other event in the database.
--
-- A moderator is granted a SET OF MODES, not a set of games. Running "the bingo
-- nights" is the real job; a per-game grant would mean handing out a permission
-- before every event, and the person who creates the game cannot be granted it
-- in advance anyway.
--
-- This migration is deliberately INERT: it adds the table, the gates and the
-- admin RPCs to hand out modes, but changes no existing function. Nothing a
-- moderator can do changes until the guards are swapped, which is the migration
-- that follows this one. Granting modes now is therefore safe — it has no
-- effect yet.
--
-- The escalation rule, which is the whole point of the tier: a moderator must
-- never be able to widen their own grant. moderator_modes has RLS on with NO
-- insert, update or delete policy at all, so the only way in is through the
-- security definer RPCs below, and those demand is_admin(). That mirrors what
-- 0006 did for profiles.is_admin, where the self-update policy pins the flag to
-- its current value.

-- ============================================================
-- Who is a moderator of what
-- ============================================================

create table if not exists moderator_modes (
  profile_id uuid        not null references profiles(id) on delete cascade,
  mode       game_mode   not null,
  granted_by uuid        references profiles(id),
  granted_at timestamptz not null default now(),
  primary key (profile_id, mode)
);

alter table moderator_modes enable row level security;

-- Readable by the holder (the console asks "what may I run?") and by admins
-- (the Accounts screen lists it). No write policy on purpose — see the header.
drop policy if exists moderator_modes_read on moderator_modes;
create policy moderator_modes_read on moderator_modes
  for select using (profile_id = auth.uid() or is_admin());

-- ============================================================
-- The gates
-- ============================================================
-- security definer for the same reason is_admin() is: these get called from
-- inside other definer functions, which must not depend on the caller's own
-- read access to the table.

-- May the caller run games of this mode at all? True for admins, who keep every
-- power they had. This is the gate for CREATING a game, where there is no game
-- row to ask about yet.
create or replace function may_run_mode(p_mode game_mode) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_admin() or exists (
    select 1 from moderator_modes m
     where m.profile_id = auth.uid() and m.mode = p_mode
  );
$fn$;

-- May the caller touch THIS game? The mode comes from the game row, so a
-- moderator's reach follows the game, not who created it. Unknown game: false,
-- so a wrong id is refused rather than waved through.
create or replace function may_manage_game(p_game_id uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select is_admin() or exists (
    select 1
      from games g
      join moderator_modes m on m.mode = g.mode
     where g.id = p_game_id and m.profile_id = auth.uid()
  );
$fn$;

-- "Does this account have a console at all?" — one cheap call for the frontend,
-- which needs an answer before it knows which game is open.
create or replace function is_moderator() returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from moderator_modes m where m.profile_id = auth.uid());
$fn$;

revoke execute on function may_run_mode(game_mode) from public, anon;
revoke execute on function may_manage_game(uuid)   from public, anon;
revoke execute on function is_moderator()          from public, anon;

grant execute on function may_run_mode(game_mode) to authenticated;
grant execute on function may_manage_game(uuid)   to authenticated;
grant execute on function is_moderator()          to authenticated;

-- ============================================================
-- Handing out and taking back modes
-- ============================================================

-- The whole grant for one person, replaced in one call: the console shows a row
-- of tick boxes and saves what it has, so a per-mode add and remove would only
-- be a way to get it wrong. An empty array demotes them to an ordinary player.
create or replace function admin_set_moderator_modes(p_profile_id uuid, p_modes game_mode[])
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_is_admin boolean;
begin
  if not is_admin() then raise exception 'Admins only'; end if;

  select p.is_admin into v_is_admin from profiles p where p.id = p_profile_id;
  if not found then raise exception 'No such account'; end if;

  -- An admin already outranks every mode. Granting them modes as well would
  -- read, on the Accounts screen, as though taking the modes away took
  -- something away — and it would not.
  if v_is_admin then
    raise exception 'That account is an admin, which already covers every mode';
  end if;

  delete from moderator_modes where profile_id = p_profile_id;

  insert into moderator_modes (profile_id, mode, granted_by)
  select p_profile_id, m, auth.uid()
    from unnest(coalesce(p_modes, '{}'::game_mode[])) as m
   group by m;   -- a repeated mode in the array is not an error, just one row
end;
$fn$;

-- Everyone who holds at least one mode, for the Accounts screen.
create or replace function admin_list_moderators()
returns table (profile_id uuid, display_name text, modes game_mode[], granted_at timestamptz)
language plpgsql security definer set search_path = public as $fn$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query
    select m.profile_id,
           p.display_name,
           array_agg(m.mode order by m.mode),
           min(m.granted_at)
      from moderator_modes m
      join profiles p on p.id = m.profile_id
     group by m.profile_id, p.display_name
     order by p.display_name;
end;
$fn$;

-- What the signed-in account may run. Not admin-gated: it answers only about
-- the caller, and the console needs it to decide what to draw.
create or replace function my_moderator_modes()
returns game_mode[]
language sql stable security definer set search_path = public as $fn$
  select coalesce(
    (select array_agg(m.mode order by m.mode)
       from moderator_modes m where m.profile_id = auth.uid()),
    '{}'::game_mode[]);
$fn$;

revoke execute on function admin_set_moderator_modes(uuid, game_mode[]) from public, anon;
revoke execute on function admin_list_moderators()                      from public, anon;
revoke execute on function my_moderator_modes()                         from public, anon;

grant execute on function admin_set_moderator_modes(uuid, game_mode[]) to authenticated;
grant execute on function admin_list_moderators()                      to authenticated;
grant execute on function my_moderator_modes()                         to authenticated;
