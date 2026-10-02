-- An organiser can open any team's player screen, read only.
--
-- Until now the only way to see a board the way a team sees it was to sign in
-- as one of its players. The player screen is fed by a single call,
-- board_for_me(), which works out the team from auth.uid(). This adds the same
-- answer for a team the organiser names:
--
--   admin_board_for_team(game, team, role)
--
-- It returns exactly the object board_for_me returns to a member of that team
-- (checked, key by key, by scripts/view-as-team-check.sql), so the site can
-- hand it to the very same components the players get.
--
-- Read only by construction. Every player action -- claim_tile, fire_tile,
-- snakes_roll, bingo_open_tile, add_evidence and the rest -- takes the team
-- from auth.uid(), and an organiser is on no team. The two that take a team id
-- and let an organiser through (place_fleet, rename_team) are blocked on the
-- site while viewing (web/src/lib/viewOnly.js).
--
-- Shared, not copied, where it matters:
--
--   * tiles_for_me is the part of the player view that changes most -- it has
--     been rewritten a dozen times. Its body moves into tiles_for_team(game,
--     team), and tiles_for_me becomes a one-line call to it with
--     my_team_in_game(). Same rows for every player; a change to what a tile
--     shows is now made once and reaches both views.
--   * my_evidence is left exactly as it is (it scopes by my_team_ids(), which
--     differs for a player rostered on both sides of one game -- see 0024).
--     evidence_for_team is the single-team version of it.
--   * board_for_me itself is untouched: it is `security invoker` and leans on
--     RLS, which an organiser's own rights would widen. admin_board_for_team
--     spells those same filters out instead. If you change board_for_me,
--     change it too, and run scripts/view-as-team-check.sql.
--
-- To undo all of this: scripts/rollback-admin-view-as-team.sql.

-- ---- tiles_for_team: the body of tiles_for_me, for a team given -------------

create or replace function tiles_for_team(p_game_id uuid, p_team_id uuid)
returns table(
  id uuid, game_id uuid, "row" smallint, col smallint, "position" smallint,
  revealed boolean, name text, icon text, required_evidence smallint,
  evidence_count integer, claim_id uuid, claim_status claim_status,
  claim_result shot_result, previewed boolean, ship_sunk boolean,
  evidence_points integer, options jsonb, description text, completion text,
  per_set smallint, claimed_by_name text, claimed_at timestamp with time zone,
  paused boolean)
language sql
stable security definer
set search_path to 'public'
as $function$
  select t.id, t.game_id, t.row, t.col, t.position,
    (c.id is not null or gm.open) as revealed,
    case when c.id is not null or pv.id is not null or gm.open then t.name end as name,
    case when c.id is not null or pv.id is not null or gm.open then t.icon end as icon,
    case when c.id is not null or gm.open then t.required_evidence end as required_evidence,
    case when c.id is not null
         then (select count(*) from tile_evidence e where e.claim_id = c.id)
         else 0 end::int as evidence_count,
    c.id, c.status, c.result,
    (pv.id is not null) as previewed,
    coalesce(
      c.result = 'hit' and not exists (
        select 1
          from ship_cells hull
         where hull.ship_id = (
                 select sc.ship_id
                   from ship_cells sc
                   join teams te on te.id = sc.team_id
                  where te.game_id = t.game_id
                    and te.id <> c.team_id
                    and sc.row = t.row and sc.col = t.col
                  limit 1
               )
           and not exists (
                 select 1
                   from tiles ti2
                   join tile_claims tc2 on tc2.tile_id = ti2.id
                  where ti2.game_id = t.game_id
                    and ti2.row = hull.row and ti2.col = hull.col
                    and tc2.team_id = c.team_id
                    and tc2.status = 'fired'
                    and tc2.result = 'hit'
               )
      ),
      false
    ) as ship_sunk,
    case when c.id is not null
         then (select coalesce(sum(e.points), 0) from tile_evidence e where e.claim_id = c.id)
         else 0 end::int as evidence_points,
    case when c.id is not null or gm.open
         then (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', o.id, 'label', o.label, 'points', o.points,
                        'grp', o.grp, 'max_times', o.max_times,
                        'taken', exists (select 1 from tile_evidence e
                                          where e.claim_id = c.id and e.option_id = o.id),
                        'got', (select count(*) from tile_evidence e
                                 where e.claim_id = c.id and e.option_id = o.id)
                      ) order by o.sort, o.label), '[]'::jsonb)
                 from tile_options o where o.tile_id = t.id)
         end as options,
    case when c.id is not null or gm.open then t.description end as description,
    case when c.id is not null or gm.open then t.completion::text end as completion,
    case when c.id is not null or gm.open then t.per_set end as per_set,
    p.display_name as claimed_by_name,
    c.claimed_at,
    (c.paused_at is not null) as paused
  from tiles t
  -- Open once the game has started, not before: the card is revealed when the
  -- organiser presses Start, so nobody can plan from it during preparation.
  cross join lateral (
    select coalesce((select g.mode <> 'battleships' and g.status in ('active', 'finished')
                       from games g where g.id = p_game_id), false) as open
  ) gm
  left join tile_claims c on c.tile_id = t.id
       and c.team_id = p_team_id
  left join profiles p on p.id = c.claimed_by
  left join pet_jar_previews pv on pv.tile_id = t.id
       and pv.team_id = p_team_id
  where t.game_id = p_game_id
  order by t.position;
$function$;

-- Internal: it answers for whatever team it is handed, so nobody may call it
-- directly. tiles_for_me and admin_board_for_team reach it as its owner.
revoke execute on function tiles_for_team(uuid, uuid) from public, anon, authenticated;

create or replace function tiles_for_me(p_game_id uuid)
returns table(
  id uuid, game_id uuid, "row" smallint, col smallint, "position" smallint,
  revealed boolean, name text, icon text, required_evidence smallint,
  evidence_count integer, claim_id uuid, claim_status claim_status,
  claim_result shot_result, previewed boolean, ship_sunk boolean,
  evidence_points integer, options jsonb, description text, completion text,
  per_set smallint, claimed_by_name text, claimed_at timestamp with time zone,
  paused boolean)
language sql
stable security definer
set search_path to 'public'
as $function$
  select * from tiles_for_team(p_game_id, my_team_in_game(p_game_id));
$function$;

revoke execute on function tiles_for_me(uuid) from public, anon;
grant  execute on function tiles_for_me(uuid) to authenticated;

-- ---- evidence_for_team: my_evidence for one team ----------------------------

create or replace function evidence_for_team(p_game_id uuid, p_team_id uuid)
returns table(id uuid, claim_id uuid, storage_path text, uploaded_by_name text,
              created_at timestamp with time zone, option_label text, points smallint)
language sql
stable security definer
set search_path to 'public'
as $function$
  select e.id, e.claim_id, e.storage_path, e.uploaded_by_name, e.created_at,
         o.label, e.points
    from tile_evidence e
    join tile_claims c on c.id = e.claim_id
    join tiles t on t.id = c.tile_id
    left join tile_options o on o.id = e.option_id
   where t.game_id = p_game_id
     and e.team_id = p_team_id
   order by e.created_at;
$function$;

revoke execute on function evidence_for_team(uuid, uuid) from public, anon, authenticated;

-- ---- admin_board_for_team ----------------------------------------------------

create or replace function admin_board_for_team(
  p_game_id uuid, p_team_id uuid, p_role team_role default 'member')
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_enemy_team uuid;
  v_mode       game_mode;
begin
  if not is_admin() then
    raise exception 'Only an organiser can view a team''s board';
  end if;

  select g.mode into v_mode from games g where g.id = p_game_id;
  if v_mode is null then
    raise exception 'Game not found';
  end if;
  if not exists (select 1 from teams t where t.id = p_team_id and t.game_id = p_game_id) then
    raise exception 'That team is not in this game';
  end if;

  select t.id into v_enemy_team
  from teams t
  where t.game_id = p_game_id and t.id <> p_team_id
  order by t.name
  limit 1;

  -- Key for key what board_for_me answers a member of p_team_id. Where that
  -- one relies on RLS (ship_cells, ship_status, game_events), the policy's
  -- filter for a member of this team is written out here.
  return jsonb_build_object(
    'game', (select to_jsonb(g) from games g where g.id = p_game_id),
    'teams', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.name)
      from teams t where t.game_id = p_game_id
    ), '[]'::jsonb),
    -- One membership, the team being viewed, so the site picks it as "mine".
    'memberships', jsonb_build_array(
      jsonb_build_object('team_id', p_team_id, 'role', p_role)),
    'tiles', coalesce((
      select jsonb_agg(to_jsonb(x)) from tiles_for_team(p_game_id, p_team_id) x
    ), '[]'::jsonb),
    'myShipCells', coalesce((
      select jsonb_agg(to_jsonb(sc)) from ship_cells sc
      where sc.team_id = p_team_id
    ), '[]'::jsonb),
    -- As a player gets it. ship_status counts hits through `tiles`, which RLS
    -- hides from every player, so on their side hits is always 0 and sunk
    -- always false (MyFleet.jsx and lib/board.js work sinkings out for
    -- themselves). Read here with an owner's rights, the view would answer
    -- truthfully -- and differently. Same rows, same columns, same zeros.
    'myFleet', coalesce((
      select jsonb_agg(to_jsonb(f)) from (
        select s.id as ship_id, s.team_id, t.game_id,
               count(distinct (sc.row, sc.col))::smallint as size,
               0::bigint as hits,
               false as sunk
          from ships s
          join teams t on t.id = s.team_id
          join ship_cells sc on sc.ship_id = s.id
         where t.game_id = p_game_id and s.team_id = p_team_id
         group by s.id, s.team_id, t.game_id
      ) f
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(
               to_jsonb(e) || jsonb_build_object(
                 'team_private', is_team_private_event(e.type))
               order by e.created_at desc)
      from (
        select * from game_events ge
        where ge.game_id = p_game_id
          and (not is_team_private_event(ge.type) or ge.team_id = p_team_id)
        order by ge.created_at desc
        limit 50
      ) e
    ), '[]'::jsonb),
    'scores', coalesce((
      select jsonb_agg(to_jsonb(s)) from team_scores(p_game_id) s
    ), '[]'::jsonb),
    'standings', case
      when v_mode = 'bingo' then coalesce((
        select jsonb_agg(to_jsonb(s) order by s.place) from bingo_standings(p_game_id) s
      ), '[]'::jsonb)
      when v_mode = 'snakes' then coalesce((
        select jsonb_agg(to_jsonb(s) order by s.place) from snakes_standings(p_game_id) s
      ), '[]'::jsonb)
      else '[]'::jsonb end,
    'jumps', coalesce((
      select jsonb_agg(jsonb_build_object('from', j.from_tile, 'to', j.to_tile)
                       order by j.from_tile)
        from board_jumps j where j.game_id = p_game_id
    ), '[]'::jsonb),
    'evidence', coalesce((
      select jsonb_agg(to_jsonb(ev)) from evidence_for_team(p_game_id, p_team_id) ev
    ), '[]'::jsonb),
    'enemyShots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tile_id', tc.tile_id, 'result', tc.result, 'status', tc.status))
      from tile_claims tc
      where v_mode = 'battleships'
        and v_enemy_team is not null
        and tc.team_id = v_enemy_team
        and tc.status = 'fired'
    ), '[]'::jsonb)
  );
end;
$function$;

revoke execute on function admin_board_for_team(uuid, uuid, team_role) from public, anon;
grant  execute on function admin_board_for_team(uuid, uuid, team_role) to authenticated;

comment on function board_for_me(uuid) is
  'The player screen. admin_board_for_team (20261003140000) answers the same for a team an organiser names: change both together, then run scripts/view-as-team-check.sql.';
comment on function my_evidence(uuid) is
  'evidence_for_team (20261003140000) is the single-team copy used by admin_board_for_team: change both together.';
