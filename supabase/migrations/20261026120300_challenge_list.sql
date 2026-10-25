-- ============================================================
-- Challenge: finding one
-- ============================================================
-- The one thing the player screen could not do without a server call.
--
-- Every other mode is reached through the roster: listMyGames (web/src/lib/
-- games.js) reads team_members and answers "which games am I in". A challenge
-- is opt-in and may have no teams at all, so a solo event has nothing in
-- team_members to find, and an event nobody has joined yet has nothing
-- anywhere -- which would leave the sign-up screen unreachable by the people
-- it is for.
--
-- challenge_setup and challenge_entries both have RLS on and no policies, so
-- a client cannot read either of them directly. This is the only way in, and
-- it answers only what a screen needs to draw a list.

create or replace function challenge_list()
returns jsonb
language plpgsql stable
security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'game_id',        g.id,
             'name',           g.name,
             'status',         g.status,
             'starts_at',      g.starts_at,
             'ends_at',        g.ends_at,
             'created_at',     g.created_at,
             'solo',           s.solo,
             'wom_metric',     s.wom_metric,
             'declared_label', s.declared_label,
             'declared_unit',  s.declared_unit,
             'ranked_by',      s.ranked_by,
             -- A count, never a list. Who has signed up stays the organiser's
             -- business until the event starts (challenge_standings says so
             -- and returns nothing before then); how many have is what makes
             -- a player join, and it gives nobody away.
             'entrants',       (select count(*) from challenge_entries e
                                 where e.game_id = g.id),
             'joined',         exists (select 1 from challenge_entries e
                                        where e.game_id = g.id and e.profile_id = v_uid))
           -- Open for sign-ups first, then running, then the ones just gone.
           order by case g.status when 'setup' then 0 when 'active' then 1 else 2 end,
                    g.ends_at desc nulls last, g.created_at desc)
      from games g
      join challenge_setup s on s.game_id = g.id
     where g.mode = 'challenge'
       and (
         -- Everything open or running, to everyone: a weekly event the clan
         -- cannot see is a weekly event nobody enters.
         g.status in ('setup', 'placement', 'active')
         -- Plus the recent ones this player was actually in, so a ladder can
         -- be looked at the morning after. Two weeks, then it leaves the list
         -- rather than growing it forever.
         or (exists (select 1 from challenge_entries e
                      where e.game_id = g.id and e.profile_id = v_uid)
             and coalesce(g.ended_at, g.created_at) > now() - interval '14 days')
         -- And every one an organiser runs, however old. The console needs the
         -- setup row to draw a finished event at all, and this is the only
         -- call that carries it; may_manage_game is the same gate every
         -- admin_challenge_* function uses.
         or may_manage_game(g.id)
       )), '[]'::jsonb);
end;
$fn$;

revoke execute on function challenge_list() from public, anon;
grant  execute on function challenge_list() to authenticated;
