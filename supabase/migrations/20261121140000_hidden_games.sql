-- ============================================================
-- Hidden games: a game only its organisers and players come across
-- ============================================================
--
-- Asked for by Boris on 2026-11-21, to play-test Drops from Dink on the live
-- site without the clan coming across a test game. A hidden game is left off
-- the two lists that show games to people who are not in them:
--
--   * "Now running" on the login page (web/src/components/NowRunning.jsx),
--     which reads `games` directly and now asks for hidden = false;
--   * the sign-up list on Home, game_signup_list() below.
--
-- Everywhere else a game already shows only to the people in it: Home's own
-- games come from team_members (web/src/lib/games.js, listMyGames), and the
-- console is for organisers. So a hidden game is seen by its organisers
-- (may_manage_game), the players on its roster, and anyone who signed up.
--
-- HIDDEN, NOT SECRET. `games` is `for select using (true)` (0001) and stays
-- that way: much of the site reads it directly, and narrowing it would mean
-- narrowing teams and team_members with it. Somebody reading the API by hand
-- can still see a hidden game's name, mode and times, as for every game. Its
-- tiles, progress and evidence are behind their own rules, as for every game.
--
-- A hidden game takes sign-ups only from those who may manage it. Nobody else
-- can see it to sign up, and a sign-up call made with its id should not be a
-- way round that. An organiser still puts anybody on a team by hand
-- (admin_set_member), signed up or not.
--
-- Board modes only. A challenge's list (challenge_list) is the only way into
-- it, so a hidden challenge would be one nobody could enter.
--
-- Rewrites game_signup_join and game_signup_list (20261026160000) in place,
-- each with the hidden lines added and nothing else changed. Tested offline by
-- runelite-plugin/server/test/hidden.test.mjs, on a replay of every migration.

-- ============================================================
-- 1. The column, and the switch
-- ============================================================

alter table games add column if not exists hidden boolean not null default false;

comment on column games.hidden is
  'Left off the login page and the sign-up list for all but its organisers, roster and sign-ups (admin_set_game_hidden). Not a secret: games stays readable.';

-- An organiser's or the mode's moderator's, like admin_set_plugin_drops.
-- Either way at any time: a test game can be made a real one, and a game
-- made by mistake can be put out of sight while it is sorted out.
create or replace function admin_set_game_hidden(p_game_id uuid, p_hidden boolean)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_game games%rowtype;
begin
  if not may_manage_game(p_game_id) then raise exception 'Not your game'; end if;
  select * into v_game from games where id = p_game_id;
  if not found then raise exception 'No such game'; end if;
  if p_hidden is null then raise exception 'Say hidden or not'; end if;
  if p_hidden and v_game.mode = 'challenge' then
    raise exception 'A challenge cannot be hidden: its list is the only way in';
  end if;
  update games set hidden = p_hidden where id = p_game_id;
  return p_hidden;
end;
$$;

-- ============================================================
-- 2. Signing up: not for a hidden game, unless you may manage it
-- ============================================================

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
  -- Hidden (20261121140000): the same answer as an event that does not exist,
  -- for everyone but those who may manage it.
  if v_game.hidden and not may_manage_game(p_game_id) then
    raise exception 'No such event';
  end if;
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

-- ============================================================
-- 3. The sign-up list: a hidden game only for those in it
-- ============================================================

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
       -- Hidden (20261121140000): only for its organisers, its roster and
       -- the people who signed up for it.
       and (not g.hidden
            or may_manage_game(g.id)
            or exists (select 1 from game_signups s
                        where s.game_id = g.id and s.profile_id = v_uid)
            or exists (select 1 from team_members tm
                         join teams t on t.id = tm.team_id
                        where t.game_id = g.id and tm.profile_id = v_uid))
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
-- 4. Grants
-- ============================================================
-- The two rewritten functions keep the grants they had. The switch is a
-- signed-in organiser's; the function itself refuses everyone else.

revoke execute on function admin_set_game_hidden(uuid, boolean) from public, anon, service_role;
grant  execute on function admin_set_game_hidden(uuid, boolean) to authenticated;
