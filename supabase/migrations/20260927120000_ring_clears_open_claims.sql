-- A locked-in tile the sinking reveals as water gives the team its slot back.
--
-- 20260912000000 reveals the ring around a sunk hull by inserting fired
-- 'miss' claims, with `on conflict (team_id, tile_id) do nothing`. That left a
-- hole: if the sinking team had ALREADY locked in one of those squares, their
-- claim was skipped. It stayed active, kept eating one of their
-- `max_active_tiles` slots, and made them finish a task whose answer the
-- no-touching rule had just handed them for free -- water. There is no player
-- way out of a lock-in (0029 keeps release admin-only on purpose), so the slot
-- was stuck until an organiser noticed.
--
-- Now the ring first DELETES the sinking team's unfired claims on ring tiles
-- (active or parked), then inserts the reveal as before. Deleting rather than
-- converting the row is deliberate: it leaves exactly the shape every other
-- ring tile has -- a fired miss with no claimed_by, no fired_by, no evidence --
-- so `admin_revoke_evidence`'s refloat cleanup (which recognises reveals by
-- that shape) treats it like any other ring square.
--
-- This is not the read-and-back-out loophole 0029 guards against: the team
-- only gets out of a square the game has already proved is empty, and it gets
-- out by the square being revealed, not by walking away from it.
--
-- Evidence on a cleared claim cascades away with it, as with
-- `admin_release_claim`. A miss scores nothing, so nothing is lost from the
-- score; the storage objects stay orphaned in the bucket, same as there.
--
-- Each cleared claim that was holding a slot (not parked) emits `slot_freed`,
-- which is team-private (`is_team_private_event`), with `reason` set so the
-- feed can say why the lock-in vanished. `tile_id` / `position` are safe in a
-- team-private event, and the enemy owns the ship -- they know its ring anyway.
--
-- Body is otherwise character-for-character 20260912000000's `fire_tile`.

create or replace function fire_tile(p_claim_id uuid)
returns shot_result
language plpgsql security definer set search_path = public as $$
declare
  v_claim    tile_claims%rowtype;
  v_tile     tiles%rowtype;
  v_game_id  uuid;
  v_status   game_status;
  v_enemy_id uuid;
  v_result   shot_result;
  v_ship_id  uuid;
  v_ship     record;
begin
  select * into v_claim from tile_claims where id = p_claim_id;

  if v_claim is null then
    raise exception 'No such tile claim';
  end if;
  if v_claim.status = 'fired' then
    raise exception 'That tile has already been fired';
  end if;
  if not exists (select 1 from team_members
                  where team_id = v_claim.team_id and profile_id = auth.uid()) then
    raise exception 'That tile belongs to the other team';
  end if;

  select * into v_tile from tiles where id = v_claim.tile_id;
  v_game_id := v_tile.game_id;

  -- The game has to still be running. Without this a claim left open when the
  -- match ended can be fired afterwards, and the winner update below rewrites
  -- who won.
  select status into v_status from games where id = v_game_id;
  if v_status <> 'active' then
    raise exception 'The game is % — no more shots', v_status;
  end if;

  select id into v_enemy_id from teams
   where game_id = v_game_id and id <> v_claim.team_id;

  select sc.ship_id into v_ship_id
    from ship_cells sc
   where sc.team_id = v_enemy_id and sc.row = v_tile.row and sc.col = v_tile.col;

  v_result := case when v_ship_id is null then 'miss' else 'hit' end;

  update tile_claims
     set status = 'fired', result = v_result, fired_by = auth.uid(), fired_at = now()
   where id = p_claim_id;

  insert into game_events (game_id, team_id, type, payload)
  values (v_game_id, v_claim.team_id, 'shot_fired',
          jsonb_build_object('tile_id', v_tile.id,
                             'position', v_tile.position, 'result', v_result,
                             'by', auth.uid()));

  if v_result = 'hit' then
    -- Read once: the size announced and the sunk decision must come from the
    -- same row, or a wrong `ships.size` creeps back in through the payload.
    select * into v_ship from ship_status where ship_id = v_ship_id;

    if v_ship.sunk then
      insert into game_events (game_id, team_id, type, payload)
      values (v_game_id, v_claim.team_id, 'ship_sunk',
              jsonb_build_object('ship_id', v_ship_id,
                                 'size', v_ship.size,
                                 'victim_team_id', v_enemy_id));

      -- Open lock-ins on ring squares go first, so the reveal below can land
      -- on them. Evidence is counted before the delete cascades it away.
      with doomed as (
        select c.id, c.paused_at, t.id as tile_id, t.position,
               (select count(*) from tile_evidence e where e.claim_id = c.id)::int as n_evidence
          from tile_claims c
          join tiles t on t.id = c.tile_id
         where c.team_id = v_claim.team_id
           and c.status  = 'active'
           and t.game_id = v_game_id
           and exists (
                 select 1 from ship_cells hull
                  where hull.ship_id = v_ship_id
                    and abs(hull.row - t.row) <= 1
                    and abs(hull.col - t.col) <= 1
               )
           and not exists (
                 select 1 from ship_cells own
                  where own.ship_id = v_ship_id
                    and own.row = t.row and own.col = t.col
               )
      ),
      gone as (
        delete from tile_claims c
         using doomed d
         where c.id = d.id
        returning c.id
      )
      insert into game_events (game_id, team_id, type, payload)
      select v_game_id, v_claim.team_id, 'slot_freed',
             jsonb_build_object('claim_id',         d.id,
                                'tile_id',          d.tile_id,
                                'position',         d.position,
                                'reason',           'ring_revealed',
                                'evidence_deleted', d.n_evidence)
        from doomed d
        join gone g on g.id = d.id
       where d.paused_at is null;

      -- The ring: every neighbour of every cell of this hull, minus the
      -- hull's own cells, minus anything the sinking team already holds a
      -- claim on. Guaranteed water by the no-touching rule, so it costs the
      -- sinking team nothing to learn it. After the delete above, the only
      -- claims left to conflict with are fired ones.
      insert into tile_claims (team_id, tile_id, status, claimed_at, fired_at, result)
      select v_claim.team_id, ring_tile.id, 'fired', now(), now(), 'miss'
        from ship_cells hull
        cross join generate_series(-1, 1) as dr
        cross join generate_series(-1, 1) as dc
        join tiles ring_tile
          on ring_tile.game_id = v_game_id
         and ring_tile.row = hull.row + dr
         and ring_tile.col = hull.col + dc
       where hull.ship_id = v_ship_id
         and not (dr = 0 and dc = 0)
         and not exists (
               select 1 from ship_cells own
                where own.ship_id = v_ship_id
                  and own.row = ring_tile.row and own.col = ring_tile.col
             )
      on conflict (team_id, tile_id) do nothing;

      if not exists (select 1 from ship_status where team_id = v_enemy_id and not sunk) then
        -- `and status = 'active'` so a win can never overwrite a win.
        update games set status = 'finished', winner_team_id = v_claim.team_id, ended_at = now()
         where id = v_game_id and status = 'active';

        if found then
          insert into game_events (game_id, team_id, type, payload)
          values (v_game_id, v_claim.team_id, 'game_won',
                  jsonb_build_object('loser_team_id', v_enemy_id));
        end if;
      end if;
    end if;
  end if;

  return v_result;
end;
$$;

revoke execute on function fire_tile(uuid) from public, anon;
grant  execute on function fire_tile(uuid) to authenticated;
