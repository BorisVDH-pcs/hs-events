-- Take one pet jar submission back.
--
-- 0039 made `pet_jar_submissions` immutable, on the same reasoning 0021 gave
-- for evidence: the team cannot retract what earned it a preview. That still
-- holds -- there is no delete policy, and this is a definer function gated on
-- `is_admin()` that writes a `pet_jar_revoked` event naming who did it. The
-- gap was that NOBODY could undo one: a screenshot that was not a pet or a jar
-- at all banked a preview for good, and the admin console could not even show
-- the submissions, let alone take one back.
--
-- ---- what a revoke takes back ----
--
-- A submission is worth exactly one preview credit, and credits are not tied
-- to the submission that earned them. So the revoke takes one credit back:
--
--   1. UNSPENT: the team still holds a credit, so `pet_jar_count` drops by one.
--      Nothing on the board moves.
--   2. ALREADY SPENT: the count is 0, so the credit this submission earned has
--      become a preview. The team's most recent preview on a tile it has NOT
--      claimed is withdrawn -- the row goes, and `tiles_for_me` stops showing
--      that tile's name and icon. The team has seen it, and nothing can make
--      them unsee it, but they no longer have it on the board.
--   3. SPENT AND CLAIMED: every preview they hold is on a tile they have since
--      locked in, where the claim reveals the task on its own. There is
--      nothing left to take; the submission goes and the count stays at 0.
--
-- Which of the three it is appears in the dry run, so the organiser is told
-- before they press it. Same HS001 rollback trick as admin_revoke_evidence
-- (20260918163924): the preview is the real body, unwound.
--
-- The storage object stays in the bucket, orphaned, as every other revoke
-- leaves it.

-- ============================================================
-- 1. The new event is team-private
-- ============================================================
-- It names the submitter and, when a preview is withdrawn, the tile. Body
-- verbatim from 20260918172658 plus the new value.

create or replace function is_team_private_event(p_type event_type)
returns boolean
language sql immutable set search_path = '' as $$
  select p_type = any(array[
    'evidence_submitted',
    'evidence_revoked',
    'tile_relocked',
    'slot_freed',
    'pet_jar_submitted',
    'pet_jar_spent',
    'pet_jar_revoked'
  ]::public.event_type[]);
$$;

-- ============================================================
-- 2. The review list
-- ============================================================
-- RLS already lets an admin select the table, but not the team name beside it
-- in the same call, and the evidence screen set the pattern: one admin-gated
-- RPC for the list.

create function admin_list_pet_jars(p_game_id uuid)
returns table (id uuid, storage_path text, public_url text,
               submitted_by_name text, created_at timestamptz,
               team_id uuid, team_name text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query
    select s.id, s.storage_path, s.public_url, s.submitted_by_name,
           s.created_at, s.team_id, tm.name
      from pet_jar_submissions s
      join teams tm on tm.id = s.team_id
     where s.game_id = p_game_id
     order by s.created_at desc;
end;
$$;

revoke execute on function admin_list_pet_jars(uuid) from public, anon;
grant  execute on function admin_list_pet_jars(uuid) to authenticated;

-- ============================================================
-- 3. Taking it back
-- ============================================================

create function admin_revoke_pet_jar(
  p_submission_id uuid,
  p_dry_run       boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sub      pet_jar_submissions%rowtype;
  v_team     text;
  v_by       text;
  v_before   smallint;
  v_after    smallint;
  v_preview  pet_jar_previews%rowtype;
  v_tile     tiles%rowtype;
  v_credit   boolean := false;
  v_withdrew boolean := false;
  v_out      jsonb;
begin
  if not is_admin() then raise exception 'Admins only'; end if;

  select * into v_sub from pet_jar_submissions where id = p_submission_id;
  if not found then raise exception 'No such pet jar submission'; end if;

  select name into v_team from teams where id = v_sub.team_id;
  select display_name into v_by from profiles where id = auth.uid();

  -- Locked as spend_pet_jar locks it, so a player spending mid-revoke queues
  -- behind this rather than spending the credit being taken back.
  select pet_jar_count into v_before from teams where id = v_sub.team_id for update;

  begin
    delete from pet_jar_submissions where id = p_submission_id;

    if v_before > 0 then
      update teams set pet_jar_count = pet_jar_count - 1
       where id = v_sub.team_id
       returning pet_jar_count into v_after;
      v_credit := true;
    else
      v_after := v_before;

      -- The newest preview still doing anything. One on a tile the team has
      -- since claimed reveals nothing the claim does not, so it is skipped.
      select pv.* into v_preview
        from pet_jar_previews pv
       where pv.team_id = v_sub.team_id
         and pv.game_id = v_sub.game_id
         and not exists (select 1 from tile_claims c
                          where c.team_id = pv.team_id and c.tile_id = pv.tile_id)
       order by pv.created_at desc
       limit 1;

      if found then
        select * into v_tile from tiles where id = v_preview.tile_id;
        delete from pet_jar_previews where id = v_preview.id;
        v_withdrew := true;
      end if;
    end if;

    v_out := jsonb_build_object(
      'submission_id',     p_submission_id,
      'dry_run',           p_dry_run,
      'team_id',           v_sub.team_id,
      'team_name',         v_team,
      'submitted_by',      v_sub.submitted_by_name,
      'submitted_at',      v_sub.created_at,
      'count_before',      v_before,
      'count_after',       v_after,
      'credit_removed',    v_credit,
      'preview_withdrawn', v_withdrew,
      'preview_position',  case when v_withdrew then v_tile.position end,
      'preview_tile_name', case when v_withdrew then v_tile.name end,
      'nothing_to_take',   not v_credit and not v_withdrew
    );

    if p_dry_run then
      raise exception 'dry run complete' using errcode = 'HS001';
    end if;

    -- Team-private (section 1), so the tile name is safe here.
    insert into game_events (game_id, team_id, type, payload)
    values (v_sub.game_id, v_sub.team_id, 'pet_jar_revoked',
            jsonb_build_object(
              'submission_id',     p_submission_id,
              'submitted_by_name', v_sub.submitted_by_name,
              'pet_jar_count',     v_after,
              'credit_removed',    v_credit,
              'preview_withdrawn', v_withdrew,
              'position',          case when v_withdrew then v_tile.position end,
              'tile_name',         case when v_withdrew then v_tile.name end,
              'by',                auth.uid(),
              'by_name',           coalesce(v_by, 'an admin')
            ));

  exception
    when sqlstate 'HS001' then
      null;
  end;

  return v_out;
end;
$$;

revoke execute on function admin_revoke_pet_jar(uuid, boolean) from public, anon;
grant  execute on function admin_revoke_pet_jar(uuid, boolean) to authenticated;

-- ============================================================
-- 4. The broadcast line
-- ============================================================
-- Team channel only, by the same routing as pet_jar_submitted. Body verbatim
-- from 20260918172658 plus the one branch.

create or replace function discord_line(p_event game_events)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_team text;
  v_pos  int := (p_event.payload ->> 'position')::int;
  v_at   text;
  v_img  text := nullif(btrim(coalesce(p_event.payload ->> 'image_url', '')), '');
begin
  select name into v_team from teams where id = p_event.team_id;
  v_team := coalesce(v_team, 'Someone');

  if v_pos is not null then
    v_at := ' at ' || chr(65 + ((v_pos - 1) % 10)) || (((v_pos - 1) / 10) + 1);
  else
    v_at := '';
  end if;

  return case p_event.type
    when 'fleet_placed'  then format('**%s**''s fleet is set.', v_team)
    when 'game_started'  then '**The game has begun** — fleets are locked.'
    when 'team_renamed'  then format('%s is now **%s**.',
                                     coalesce(p_event.payload ->> 'old_name', 'A team'),
                                     coalesce(p_event.payload ->> 'new_name', v_team))
    when 'tile_claimed'  then format('**%s** locked in a tile%s.', v_team, v_at)
    when 'tile_relocked' then format('**%s** locked **%s**%s back in.',
                                     coalesce(p_event.payload ->> 'by_name', v_team),
                                     coalesce(p_event.payload ->> 'tile_name', 'a tile'), v_at)
    when 'claim_released' then format('An admin released **%s**''s tile%s.', v_team, v_at)
    when 'shot_fired'    then format('**%s** fired%s — %s', v_team, v_at,
                                     case when p_event.payload ->> 'result' = 'hit'
                                          then '**HIT**' else 'miss.' end)
    when 'ship_sunk'     then format(':boom: **%s** sank a %s-tile ship!',
                                     v_team, p_event.payload ->> 'size')
    when 'game_won'      then format(':trophy: **%s** wins — the enemy fleet is gone.', v_team)
    when 'game_reset'    then case when (p_event.payload ->> 'fleets_cleared')::boolean
                                   then 'The game has been reset — fleets need placing again.'
                                   else 'The game has been reset. Fleets are unchanged.' end
    when 'evidence_submitted' then format('**%s** submitted proof for **%s** (%s/%s).',
                                     coalesce(p_event.payload ->> 'uploaded_by_name', v_team),
                                     coalesce(p_event.payload ->> 'tile_name', 'a tile'),
                                     p_event.payload ->> 'evidence_count',
                                     p_event.payload ->> 'required_evidence')
                                   || case when v_img is not null then E'\n' || v_img else '' end
    when 'evidence_revoked' then format(
        ':leftwards_arrow_with_hook: An admin withdrew %s''s submission for **%s**%s — now %s/%s.%s',
        coalesce(p_event.payload ->> 'submitted_by_name', v_team),
        coalesce(p_event.payload ->> 'tile_name', 'a tile'),
        coalesce(' (' || (p_event.payload ->> 'option_label') || ')', ''),
        p_event.payload ->> 'evidence_count',
        p_event.payload ->> 'required_evidence',
        case when (p_event.payload ->> 'parked')::boolean
             then ' The shot is taken back and the tile is unlocked — **lock it in again** to finish it.'
             else '' end
        || case when (p_event.payload ->> 'ship_refloated')::boolean
                then ' A ship is no longer sunk.' else '' end
        || case when (p_event.payload ->> 'game_reopened')::boolean
                then ' **The game has been reopened.**' else '' end)
    when 'shot_withdrawn' then format(
        ':leftwards_arrow_with_hook: One of **%s**''s shots has been withdrawn by an organiser.', v_team)
    when 'slot_freed'    then 'An active tile is available now. Lock in another target.'
    when 'pet_jar_submitted' then format(':jar: **%s** submitted a pet/jar — %s pet jar preview(s) now.',
                                     coalesce(p_event.payload ->> 'submitted_by_name', v_team),
                                     p_event.payload ->> 'pet_jar_count')
                                   || case when v_img is not null then E'\n' || v_img else '' end
    when 'pet_jar_spent' then format(':mag: A pet jar preview was spent on **%s** — %s left.',
                                     coalesce(p_event.payload ->> 'tile_name', 'a tile'),
                                     p_event.payload ->> 'pet_jar_count')
    when 'pet_jar_revoked' then format(
        ':leftwards_arrow_with_hook: An admin withdrew %s''s pet/jar submission%s — %s pet jar preview(s) now.',
        coalesce(p_event.payload ->> 'submitted_by_name', v_team),
        case when (p_event.payload ->> 'preview_withdrawn')::boolean
             then format(' and the preview of **%s**%s',
                         coalesce(p_event.payload ->> 'tile_name', 'a tile'), v_at)
             else '' end,
        p_event.payload ->> 'pet_jar_count')
    else p_event.type::text
  end;
end;
$$;

revoke execute on function discord_line(game_events) from public, anon, authenticated;
