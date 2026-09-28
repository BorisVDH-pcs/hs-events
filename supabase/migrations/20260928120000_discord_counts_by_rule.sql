-- The counter in Discord says what the board says
--
-- "(X/n)" on an `evidence_submitted` line has been wrong since 20260918163924.
-- That migration redefined `discord_line` to add the `evidence_revoked` branch
-- and said its body was "verbatim from 0045" -- which it was, and that was the
-- bug: 0045 predates the rule-aware branch that 20260906135718, 20260906152400,
-- 20260912184937 and 20260913040000 had built up. Every redefinition since has
-- copied that body forward, so every tile has been announced as
-- `evidence_count / required_evidence`: screenshots over points on a points
-- tile, screenshots over tenths of a million on a value tile ("1/150"), and a
-- number that means nothing at all on a set tile.
--
-- The withdrawal line had the same mismatch from birth: "now X/n" is
-- screenshots left over the tile's target.
--
-- Three pieces:
--
--   1. `claim_progress()`: the claim's counter as the board draws it, per
--      rule. A mirror of tileProgress() in web/src/lib/tileProgress.js, which
--      is itself a mirror of claim_is_complete(); keep all three in step.
--   2. A BEFORE INSERT trigger stamping that counter onto every
--      `evidence_submitted` and `evidence_revoked` event, at the moment the
--      event is written. A trigger rather than one more redefinition of
--      add_evidence() and admin_revoke_evidence(), because copying whole
--      bodies forward is exactly how the counter was lost in the first place.
--      Both functions insert their event after the evidence row has been
--      added or deleted, so the stamp sees the state the event is about.
--   3. `discord_line` again, from the CURRENT body (20260927130100), with the
--      rule-aware submission branch restored and both counters read from the
--      stamp. Events written before this migration carry no stamp and fall
--      back to what their payload can honestly say.
--
-- NEXT TIME `discord_line` IS REDEFINED: start from THIS file's body.

-- ============================================================
-- 1. Where a claim stands, as the board draws it
-- ============================================================
-- Returns {have, need, unit} and, for a named best set, {set}. `unit` is one
-- of: evidence, points, value, items, sets, best_set. Value numbers stay in
-- tenths of a million; whoever prints them divides.
--
-- The sums deliberately match the board rather than claim_is_complete() where
-- the two differ: `points` and `value` add every row (evidence_points in
-- tiles_for_me), `points_per_set` clamps to max_times (as tileProgress does).
-- evidence_refusal() stops a capped drop going over, so in practice they agree.

create or replace function claim_progress(p_claim_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tile   tiles%rowtype;
  v_rule   text;
  v_need   int;
  v_opts   int;
  v_groups int;
  v_done   int;
  v_have   int;
  v_best   record;
begin
  select t.* into v_tile
    from tiles t join tile_claims c on c.tile_id = t.id
   where c.id = p_claim_id;
  if not found then return null; end if;

  v_rule := coalesce(v_tile.completion::text, 'points');
  v_need := coalesce(v_tile.required_evidence, 1);
  select count(*) into v_opts from tile_options where tile_id = v_tile.id;

  if v_rule = 'points_per_set' then
    with grp as (
      select coalesce(o.grp, o.label) as g,
             sum(least(
                   (select count(*) from tile_evidence e
                     where e.claim_id = p_claim_id and e.option_id = o.id),
                   coalesce(o.max_times, 2147483647)
                 ) * o.points)::int as banked
        from tile_options o
       where o.tile_id = v_tile.id
       group by 1
    )
    select count(*), count(*) filter (where banked >= v_tile.per_set),
           coalesce(max(banked), 0)
      into v_groups, v_done, v_have
      from grp;

    -- One group is "this many points from this list": the target is the
    -- per-set quota, not "0/1 sets".
    if v_groups = 1 then
      return jsonb_build_object('unit', 'points', 'have', v_have, 'need', v_tile.per_set);
    end if;
    return jsonb_build_object('unit', 'sets', 'have', v_done, 'need', v_groups);
  end if;

  if v_rule in ('one_set', 'each_set') then
    -- Distinct drops per group: a second screenshot of the same piece is
    -- still one piece.

    if v_rule = 'one_set' then
      -- The set closest to finished, ties to the one further along, then to
      -- the first on the list -- the same pick tileProgress() makes.
      with grp as (
        select coalesce(o.grp, o.label) as g,
               bool_or(o.grp is not null) as named,
               min(o.sort) as first_sort,
               count(*)::int as need,
               count(*) filter (where exists (
                 select 1 from tile_evidence e
                  where e.claim_id = p_claim_id and e.option_id = o.id))::int as taken
          from tile_options o
         where o.tile_id = v_tile.id
         group by 1
      )
      select * into v_best from grp
       order by need - taken, taken desc, first_sort, g
       limit 1;
      return jsonb_build_object('unit', 'best_set',
                                'have', coalesce(v_best.taken, 0),
                                'need', coalesce(v_best.need, 0),
                                'set',  case when v_best.named then v_best.g end);
    end if;

    with grp as (
      select least(v_tile.per_set, count(*))::int as need,
             count(*) filter (where exists (
               select 1 from tile_evidence e
                where e.claim_id = p_claim_id and e.option_id = o.id))::int as taken
        from tile_options o
       where o.tile_id = v_tile.id
       group by coalesce(o.grp, o.label)
    )
    select count(*), count(*) filter (where taken >= need), coalesce(max(taken), 0),
           coalesce(max(need), 0)
      into v_groups, v_done, v_have, v_need
      from grp;

    -- One group with a quota is "N different items from this list".
    if v_groups = 1 then
      return jsonb_build_object('unit', 'items', 'have', v_have, 'need', v_need);
    end if;
    return jsonb_build_object('unit', 'sets', 'have', v_done, 'need', v_groups);
  end if;

  -- A plain tile is counted in screenshots (evidence_count on the card), a
  -- priced or value tile in points (evidence_points).
  select case when v_rule = 'value' or v_opts > 0
              then coalesce(sum(points), 0) else count(*) end::int
    into v_have
    from tile_evidence where claim_id = p_claim_id;

  return jsonb_build_object(
    'unit', case when v_rule = 'value' then 'value'
                 when v_opts > 0 then 'points'
                 else 'evidence' end,
    'have', v_have,
    'need', v_need);
end;
$$;

revoke execute on function claim_progress(uuid) from public, anon, authenticated;

comment on function claim_progress(uuid) is
  'A claim''s counter as the board draws it: {unit, have, need[, set]}. Mirrors tileProgress() in web/src/lib/tileProgress.js.';

-- ============================================================
-- 2. Stamp it on the event
-- ============================================================
-- `completion` is added only when missing: add_evidence() already sends it,
-- admin_revoke_evidence() never has.
--
-- The exception block is not decoration, for the same reason as
-- relay_on_commit() (0032): this runs inside the player's submission, and a
-- counter that cannot be worked out must cost the Discord line its number,
-- never the player their screenshot. Without a stamp, discord_line falls back.

create or replace function stamp_evidence_progress()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_claim uuid;
  v_rule  text;
begin
  begin
    v_claim := nullif(new.payload ->> 'claim_id', '')::uuid;
    if v_claim is null then return new; end if;

    select t.completion::text into v_rule
      from tiles t join tile_claims c on c.tile_id = t.id
     where c.id = v_claim;

    new.payload := new.payload
      || jsonb_build_object('progress', claim_progress(v_claim))
      || case when new.payload ? 'completion' then '{}'::jsonb
              else jsonb_build_object('completion', coalesce(v_rule, 'points')) end;
  exception when others then
    raise warning 'evidence progress stamp failed: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke execute on function stamp_evidence_progress() from public, anon, authenticated;

drop trigger if exists trg_stamp_evidence_progress on game_events;
create trigger trg_stamp_evidence_progress
  before insert on game_events
  for each row
  when (new.type in ('evidence_submitted', 'evidence_revoked'))
  execute function stamp_evidence_progress();

-- ============================================================
-- 3. Saying it
-- ============================================================
-- "6/10 pts", "4.5/15m", "2/5 sets complete", "best set (Barrows) 3/4" --
-- the same words tileProgressText() puts on the card. Null for an event from
-- before the stamp existed.

create or replace function progress_text(p_progress jsonb)
returns text
language sql immutable set search_path = public as $$
  select case p_progress ->> 'unit'
    when 'evidence' then format('%s/%s submitted', p_progress ->> 'have', p_progress ->> 'need')
    when 'points'   then format('%s/%s pts',       p_progress ->> 'have', p_progress ->> 'need')
    when 'value'    then format('%s/%sm', value_m((p_progress ->> 'have')::int),
                                          value_m((p_progress ->> 'need')::int))
    when 'items'    then format('%s/%s items collected', p_progress ->> 'have', p_progress ->> 'need')
    when 'sets'     then format('%s/%s sets complete',   p_progress ->> 'have', p_progress ->> 'need')
    when 'best_set' then format('best set%s %s/%s',
                                coalesce(' (' || (p_progress ->> 'set') || ')', ''),
                                p_progress ->> 'have', p_progress ->> 'need')
  end;
$$;

revoke execute on function progress_text(jsonb) from public, anon, authenticated;

-- Body from 20260927130100; only `evidence_submitted` and the counter in
-- `evidence_revoked` change.

create or replace function discord_line(p_event game_events)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_team text;
  v_pos  int := (p_event.payload ->> 'position')::int;
  v_at   text;
  v_img  text := nullif(btrim(coalesce(p_event.payload ->> 'image_url', '')), '');
  v_opt  text := nullif(btrim(coalesce(p_event.payload ->> 'option_label', '')), '');
  v_rule text := coalesce(p_event.payload ->> 'completion', 'points');
  v_prog text := progress_text(p_event.payload -> 'progress');
  v_who  text;
  v_tile text := coalesce(p_event.payload ->> 'tile_name', 'a tile');
begin
  select name into v_team from teams where id = p_event.team_id;
  v_team := coalesce(v_team, 'Someone');
  v_who  := coalesce(p_event.payload ->> 'uploaded_by_name', v_team);

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
    when 'evidence_submitted' then
      case
        -- Set rules: name the drop, then the counter the card shows.
        when v_rule in ('one_set', 'each_set', 'points_per_set') and v_opt is not null then
          format('**%s** submitted **%s** for **%s**%s.', v_who, v_opt, v_tile,
                 coalesce(' (' || v_prog || ')', ''))
        -- Every number on a value tile is stored in tenths of a million.
        when v_rule = 'value' then
          format('**%s** submitted a drop worth **%sm** for **%s** (%s).',
                 v_who, value_m((p_event.payload ->> 'points_awarded')::int), v_tile,
                 coalesce(v_prog,
                          value_m((p_event.payload ->> 'points_total')::int) || '/'
                          || value_m((p_event.payload ->> 'required_evidence')::int) || 'm'))
        when v_opt is not null then
          format('**%s** submitted **%s** for **%s** — %s points (%s).',
                 v_who, v_opt, v_tile, p_event.payload ->> 'points_awarded',
                 coalesce(v_prog,
                          (p_event.payload ->> 'points_total') || '/'
                          || (p_event.payload ->> 'required_evidence')))
        else
          format('**%s** submitted proof for **%s** (%s).', v_who, v_tile,
                 coalesce(v_prog,
                          (p_event.payload ->> 'evidence_count') || '/'
                          || (p_event.payload ->> 'required_evidence')))
      end
      || case when v_img is not null then E'\n' || v_img else '' end
    when 'evidence_revoked' then format(
        ':leftwards_arrow_with_hook: An admin withdrew %s''s submission for **%s**%s — now %s.%s',
        coalesce(p_event.payload ->> 'submitted_by_name', v_team),
        v_tile,
        coalesce(' (' || (p_event.payload ->> 'option_label') || ')', ''),
        -- An unstamped withdrawal only knows screenshots left, which is the
        -- right counter only on a plain tile; elsewhere say nothing numeric.
        coalesce(v_prog,
                 case when v_rule = 'points' and v_opt is null
                      then (p_event.payload ->> 'evidence_count') || '/'
                           || (p_event.payload ->> 'required_evidence')
                      else 'updated' end),
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
