-- ============================================================
-- Signing up for a board event
-- ============================================================
--
-- A challenge has always been opt-in: players put their hand up, and
-- challenge_entries is the list an organiser works from. The other four modes
-- had nothing of the kind. Their roster was built from `profiles` -- every
-- account that has ever registered on the site -- so making teams for a bingo
-- meant scrolling past everybody who was not playing it.
--
-- This is the same step, for the modes that have a board. One row per person
-- per event: no figure, no evidence, no ladder. Only "I am in".
--
-- WHY NOT challenge_entries. An entry there carries the declared figure, the
-- screenshots behind it, the WOM participation state and an RSN snapshotted
-- for Wise Old Man to match on exactly. None of that means anything to a
-- bingo. Widening it to cover five modes would put four modes' worth of null
-- columns on the one table a finished ladder is scored from, so instead this
-- table covers the four board modes and its trigger refuses a challenge --
-- which keeps exactly one answer per mode to "who signed up for this".
--
-- SIGNING UP IS NOT A TICKET. An organiser can still put anybody on a team,
-- signed up or not: the five events already running have rosters and no
-- sign-ups at all, and somebody who asked in Discord rather than clicking the
-- button still has to be addable. The list is a shortlist, not a gate, and
-- nothing in start_game or any mode's rules looks at it.
--
-- Like every other table in this project: RLS on, no policies, every grant
-- revoked. Reads come through the security definer functions at the bottom.

-- ============================================================
-- 1. The table
-- ============================================================

create table game_signups (
  id         uuid        primary key default gen_random_uuid(),
  game_id    uuid        not null references games(id) on delete cascade,
  profile_id uuid        not null references profiles(id) on delete cascade,

  -- SNAPSHOTTED, exactly as challenge_entries.rsn is and for a related reason.
  -- An organiser building teams needs to know who this is in game, and the
  -- answer should be the one the player gave when they signed up: a profile
  -- tidied up in March must not quietly rewrite what January's roster was
  -- built from. Nullable, because a board event asks nothing of Wise Old Man
  -- and a player with no name saved is still perfectly able to play a bingo.
  rsn        text,

  created_at timestamptz not null default now(),

  unique (game_id, profile_id)
);

comment on table game_signups is
  'One row per person who put their hand up for a board event. Opt-in, and not a condition of being rostered.';
comment on column game_signups.rsn is
  'The name as it was at sign-up, not a read-through to profiles.';

create index idx_game_signups_game on game_signups(game_id);

alter table game_signups enable row level security;
revoke all on game_signups from anon, authenticated;

-- A sign-up row for a challenge would be a second, emptier answer to a
-- question challenge_entries already answers, and the two would drift apart
-- the first time anybody read the wrong one. enforce_challenge_game in
-- 20261026120100 is the precedent, pointing the other way.
create or replace function enforce_signup_not_challenge()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if (select mode from games where id = new.game_id) = 'challenge' then
    raise exception 'Game % is a challenge -- use challenge_join', new.game_id;
  end if;
  return new;
end;
$fn$;

create trigger game_signups_is_not_a_challenge
  before insert or update on game_signups
  for each row execute function enforce_signup_not_challenge();

-- ============================================================
-- 2. Putting your hand up, and taking it down
-- ============================================================

-- SIGN-UPS CLOSE WHEN THE GAME DOES, and unlike a challenge that is a rule
-- rather than a limitation. A challenge ladder can take a latecomer because
-- every entrant scores on their own; a board game is played by teams that were
-- formed before it started, and somebody arriving afterwards has nowhere to go
-- that does not change a game already in progress. An organiser can still add
-- them to a team by hand -- that is their call to make, not a stranger's.
create or replace function game_signup_join(p_game_id uuid, p_rsn text default null)
returns uuid
language plpgsql
security definer set search_path = public as $fn$
declare
  v_game games%rowtype;
  v_rsn  text;
  v_id   uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;

  select * into v_game from games where id = p_game_id;
  if not found then raise exception 'No such event'; end if;
  if v_game.mode = 'challenge' then
    raise exception 'That is a challenge -- sign up on its own screen';
  end if;
  if v_game.status not in ('setup', 'placement') then
    raise exception 'Sign-ups for this event closed when it started';
  end if;

  v_rsn := nullif(btrim(coalesce(p_rsn, (select rsn from profiles where id = auth.uid()), '')), '');

  insert into game_signups (game_id, profile_id, rsn)
  values (p_game_id, auth.uid(), v_rsn)
  on conflict (game_id, profile_id) do update set rsn = excluded.rsn
  returning id into v_id;

  return v_id;
end;
$fn$;

-- Taking your own name off, while it is still only a name on a list. Once an
-- organiser has put you on a team, leaving is between you and them: a row
-- quietly deleted here would leave somebody rostered into a game they think
-- they are out of, which is the worst of both answers.
create or replace function game_signup_leave(p_game_id uuid)
returns void
language plpgsql
security definer set search_path = public as $fn$
declare
  v_status game_status;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;

  select status into v_status from games where id = p_game_id;
  if not found then raise exception 'No such event'; end if;
  if v_status not in ('setup', 'placement') then
    raise exception 'The event has started -- ask an organiser to take you out';
  end if;

  if exists (
    select 1 from team_members tm
      join teams t on t.id = tm.team_id
     where t.game_id = p_game_id and tm.profile_id = auth.uid()
  ) then
    raise exception 'You are already on a team -- ask an organiser to take you off it';
  end if;

  delete from game_signups where game_id = p_game_id and profile_id = auth.uid();
end;
$fn$;

-- ============================================================
-- 3. Finding an event to sign up for
-- ============================================================
--
-- The same gap challenge_list (20261026120300) was written to fill, now for
-- the other modes. listMyGames (web/src/lib/games.js) reads team_members and
-- answers "which games am I in" -- which says nothing at all about an event
-- this player has not been rostered into yet, and that is precisely the event
-- a sign-up button is for. So the open ones are listed to everybody, whether
-- they are in them or not: that is the way to the button.
--
-- A COUNT, NEVER A LIST. How many have signed up is what makes somebody join,
-- and it gives nobody away. Who has signed up stays the organiser's business,
-- the same line challenge_list draws.
create or replace function game_signup_list()
returns jsonb
language plpgsql stable
security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'game_id',    g.id,
             'name',       g.name,
             'mode',       g.mode,
             'status',     g.status,
             'starts_at',  g.starts_at,
             'created_at', g.created_at,
             'signups',    (select count(*) from game_signups s where s.game_id = g.id),
             'joined',     exists (select 1 from game_signups s
                                    where s.game_id = g.id and s.profile_id = v_uid))
           -- Open for sign-ups first, then the rest, newest first within each.
           order by case g.status when 'setup' then 0 when 'placement' then 1 else 2 end,
                    g.created_at desc)
      from games g
     where g.mode <> 'challenge'
       and (
         -- Everything a player could still join, to everyone: an event the
         -- clan cannot see is an event nobody signs up for.
         g.status in ('setup', 'placement')
         -- Plus the ones they did sign up for, so the card does not vanish the
         -- moment an organiser starts it. Two weeks, then it leaves the list
         -- rather than growing it forever. A player who was rostered reaches
         -- the same game through team_members anyway, and games.js folds the
         -- two together.
         or (exists (select 1 from game_signups s
                      where s.game_id = g.id and s.profile_id = v_uid)
             and coalesce(g.ended_at, g.created_at) > now() - interval '14 days')
       )), '[]'::jsonb);
end;
$fn$;

-- ============================================================
-- 4. The organiser's list
-- ============================================================
--
-- What the roster picker is fed from. `rostered` is here rather than worked out
-- in the client because the client already has team_members for the open game
-- and would get the same answer -- but a moderator opening a game they manage
-- reads this through may_manage_game, and a list that says who is already
-- placed is the difference between a shortlist and a puzzle.
create or replace function admin_game_signups(p_game_id uuid)
returns table (
  profile_id   uuid,
  display_name text,
  rsn          text,
  created_at   timestamptz,
  rostered     boolean
)
language plpgsql stable
security definer set search_path = public as $fn$
begin
  if not may_manage_game(p_game_id) then raise exception 'Not your game'; end if;

  return query
    select s.profile_id,
           p.display_name,
           s.rsn,
           s.created_at,
           exists (
             select 1 from team_members tm
               join teams t on t.id = tm.team_id
              where t.game_id = p_game_id and tm.profile_id = s.profile_id
           ) as rostered
      from game_signups s
      join profiles p on p.id = s.profile_id
     where s.game_id = p_game_id
     order by s.created_at;
end;
$fn$;

-- ============================================================
-- 5. Grants
-- ============================================================

revoke execute on function enforce_signup_not_challenge()        from public, anon;
revoke execute on function game_signup_join(uuid, text)          from public, anon;
revoke execute on function game_signup_leave(uuid)               from public, anon;
revoke execute on function game_signup_list()                    from public, anon;
revoke execute on function admin_game_signups(uuid)              from public, anon;

grant  execute on function game_signup_join(uuid, text)          to authenticated;
grant  execute on function game_signup_leave(uuid)               to authenticated;
grant  execute on function game_signup_list()                    to authenticated;
grant  execute on function admin_game_signups(uuid)              to authenticated;
