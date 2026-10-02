-- Undo 20261003140000_admin_view_as_team.sql ("View as team").
--
-- Puts tiles_for_me back exactly as it was before (copied from the live
-- database on 2026-10-02), then removes everything that migration added:
-- admin_board_for_team, tiles_for_team, evidence_for_team and the two notes on
-- board_for_me and my_evidence. board_for_me and my_evidence themselves were
-- never changed, so nothing else needs restoring.
--
-- Two ways to run it:
--
--   * The tracked way: copy this file to
--       supabase/migrations/<a timestamp after 20261003140000>_revert_admin_view_as_team.sql
--     and push to main. The db-push workflow applies it, and the repo's
--     migrations still describe the database.
--   * In a hurry: paste it into the Supabase SQL editor and press Run. Then add
--     the migration file as above anyway, so the next db push does not
--     surprise anyone.
--
-- The website half is a plain `git revert` of the "View as team" commit. On
-- its own that is enough to take the button away -- the database functions do
-- nothing until something calls them. Run this file too if tiles_for_me
-- itself is in doubt.

begin;

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
       and c.team_id = my_team_in_game(p_game_id)
  left join profiles p on p.id = c.claimed_by
  left join pet_jar_previews pv on pv.tile_id = t.id
       and pv.team_id = my_team_in_game(p_game_id)
  where t.game_id = p_game_id
  order by t.position;
$function$;

revoke execute on function tiles_for_me(uuid) from public, anon;
grant  execute on function tiles_for_me(uuid) to authenticated;

drop function if exists admin_board_for_team(uuid, uuid, team_role);
drop function if exists tiles_for_team(uuid, uuid);
drop function if exists evidence_for_team(uuid, uuid);

comment on function board_for_me(uuid) is null;
comment on function my_evidence(uuid) is null;

commit;
