-- Snakes and Ladders: trade a pet for a rollback.
--
-- From the clan's original Snakes & Rats rules (hs-bingo's guide, "Earning
-- Rollbacks"): a team that gets a pet while working on its current tile may
-- hand in a screenshot of it for one rollback. The tile is NOT completed --
-- the team still has to finish it, or spend the rollback to get off it -- and
-- a pet counts for one thing only: the tile, or a rollback.
--
-- Rules, all checked here:
--   * Snakes, game running and not past its end time, the caller on the
--     claim's team (acting_for_team, like add_evidence -- so an organiser
--     acting as the team can do it too, under their own name).
--   * Only the tile the team stands on, only while it is unfinished, and not
--     tile 100: the finish has to be completed.
--   * Once per team per tile -- snakes_pet_trades is unique on the claim.
--     That is what stopped "pet farming" in the original.
--   * The screenshot is uploaded first, into the same evidence folder as the
--     tile's proof ({game}/{team}/{claim}/...), and the path is checked
--     against this claim.
--
-- The screenshot is kept in snakes_pet_trades, not tile_evidence, so it can
-- never count towards the tile. Organisers read the trades with
-- admin_list_pet_trades (shown on the Evidence screen); a wrong one is undone
-- by taking the rollback back on the race table (admin_snakes_give_rollback).
--
-- Announced as rollback_gained with reason 'pet' -- public, like every other
-- rollback line -- in the feed (lib/snakes.js) and on Discord
-- (snakes_discord_line, taken from the live definition plus that one case).
--
-- To undo: scripts/rollback-snakes-pet-trade.sql.

create table snakes_pet_trades (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references games(id) on delete cascade,
  team_id      uuid not null references teams(id) on delete cascade,
  claim_id     uuid not null unique references tile_claims(id) on delete cascade,
  tile_id      uuid not null references tiles(id) on delete cascade,
  storage_path text not null,
  public_url   text,
  traded_by    uuid default auth.uid(),
  created_at   timestamptz not null default now()
);

comment on table snakes_pet_trades is
  'Snakes only: a pet screenshot handed in for a rollback instead of the tile. One per claim.';

alter table snakes_pet_trades enable row level security;
-- Organisers read; nobody writes except snakes_trade_pet.
create policy snakes_pet_trades_admin_read on snakes_pet_trades
  for select using (is_admin());

create function snakes_trade_pet(p_claim_id uuid, p_storage_path text, p_public_url text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim tile_claims%rowtype;
  v_tile  tiles%rowtype;
  v_game  games%rowtype;
  v_team  teams%rowtype;
begin
  select * into v_claim from tile_claims where id = p_claim_id for update;
  if not found then raise exception 'That tile is not open for your team'; end if;
  select * into v_tile from tiles where id = v_claim.tile_id;
  select * into v_game from games where id = v_tile.game_id;

  if v_game.mode <> 'snakes' then
    raise exception 'Pets are traded for rollbacks in Snakes and Ladders only';
  end if;
  if v_game.status <> 'active' then
    raise exception 'The game is % — no trades now', v_game.status;
  end if;
  if v_game.ends_at is not null and now() >= v_game.ends_at then
    raise exception 'Time is up — no more trades';
  end if;
  if not acting_for_team(v_claim.team_id) then
    raise exception 'That is not your team''s tile';
  end if;

  select * into v_team from teams where id = v_claim.team_id for update;
  if v_team.board_tile <> v_tile.position then
    raise exception 'A pet can only be traded on the tile your team is standing on';
  end if;
  if v_tile.position >= 100 then
    raise exception 'Tile 100 has to be completed — no trading on the finish';
  end if;
  if v_claim.status <> 'active' then
    raise exception 'This tile is already complete';
  end if;
  if p_storage_path is null
     or p_storage_path not like v_game.id || '/' || v_team.id || '/' || v_claim.id || '/%' then
    raise exception 'That screenshot does not belong to this tile';
  end if;
  if exists (select 1 from snakes_pet_trades where claim_id = v_claim.id) then
    raise exception 'Your team already traded a pet on this tile';
  end if;

  insert into snakes_pet_trades (game_id, team_id, claim_id, tile_id, storage_path, public_url, traded_by)
  values (v_game.id, v_team.id, v_claim.id, v_tile.id, p_storage_path,
          nullif(btrim(p_public_url), ''), auth.uid());

  update teams set rollbacks_available = rollbacks_available + 1
   where id = v_team.id
  returning * into v_team;

  insert into game_events (game_id, team_id, type, payload)
  values (v_game.id, v_team.id, 'rollback_gained',
          jsonb_build_object('mode',                'snakes',
                             'reason',              'pet',
                             'amount',              1,
                             'tile',                v_tile.position,
                             'tile_name',           v_tile.name,
                             'claim_id',            v_claim.id,
                             'by',                  auth.uid(),
                             'by_name',             (select display_name from profiles
                                                      where id = auth.uid()),
                             'rollbacks_available', v_team.rollbacks_available));

  return jsonb_build_object('rollbacks_available', v_team.rollbacks_available);
end;
$$;

revoke execute on function snakes_trade_pet(uuid, text, text) from public, anon;
grant  execute on function snakes_trade_pet(uuid, text, text) to authenticated;

create function admin_list_pet_trades(p_game_id uuid)
returns table (
  id uuid, claim_id uuid, team_id uuid, team_name text, tile_position int, tile_name text,
  storage_path text, public_url text, traded_by_name text, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query
    select p.id, p.claim_id, p.team_id, t.name, ti.position::int, ti.name,
           p.storage_path, p.public_url, pr.display_name, p.created_at
      from snakes_pet_trades p
      join teams t  on t.id = p.team_id
      join tiles ti on ti.id = p.tile_id
      left join profiles pr on pr.id = p.traded_by
     where p.game_id = p_game_id
     order by p.created_at desc;
end;
$$;

revoke execute on function admin_list_pet_trades(uuid) from public, anon;
grant  execute on function admin_list_pet_trades(uuid) to authenticated;

-- The live definition, plus the 'pet' line under rollback_gained.
CREATE OR REPLACE FUNCTION public.snakes_discord_line(p_event game_events, p_team text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  p       jsonb := p_event.payload;
  v_from  text;
  v_to    text;
  v_extra text := '';
  v_jump  jsonb;
  v_n     int;
begin
  if p_event.type = 'game_started' then
    return ':snake: **Snakes and Ladders has begun!** Every team starts before tile 1 — roll to get going.';
  elsif p_event.type = 'game_reset' then
    return 'Snakes and Ladders has been reset — every team is back at Start.';

  elsif p_event.type = 'team_moved' then
    v_from := case when (p ->> 'from')::int = 0 then 'Start' else 'tile ' || (p ->> 'from') end;
    v_to   := case when (p ->> 'to')::int = 0 then 'Start'
                   else '**tile ' || (p ->> 'to') || '**'
                        || coalesce(' (' || (p ->> 'tile_name') || ')', '') end;

    if (p ->> 'bounced')::boolean then
      v_extra := v_extra || format(' Overshot 100 and bounced back to %s.', p ->> 'landed');
    end if;
    if not coalesce((p ->> 'long_skip')::boolean, false)
       and jsonb_array_length(coalesce(p -> 'skipped', '[]'::jsonb)) > 0 then
      v_extra := v_extra || format(' Skipped %s, already done.',
        (select string_agg(x, ', ') from jsonb_array_elements_text(p -> 'skipped') as x));
    end if;
    for v_jump in select * from jsonb_array_elements(coalesce(p -> 'jumps', '[]'::jsonb)) loop
      v_extra := v_extra || case
        when (v_jump ->> 'to')::int > (v_jump ->> 'from')::int
          then format(' :ladder: Ladder on %s, up to %s!', v_jump ->> 'from', v_jump ->> 'to')
        else format(' :snake: Snake on %s, down to %s.', v_jump ->> 'from', v_jump ->> 'to')
      end;
    end loop;
    if (p ->> 'to')::int = 100 then
      v_extra := v_extra || ' :dart: **Tile 100** — finish it to win!';
    end if;

    return case p ->> 'kind'
      when 'roll' then
        case when (p ->> 'long_skip')::boolean
             then format(':fast_forward: **%s** skipped from %s to %s — the next six tiles were all done or snake heads.',
                         p_team, v_from, v_to)
             else format(':game_die: **%s** rolled a **%s**: %s → %s.', p_team, p -> 'dice' ->> 0, v_from, v_to)
        end
      when 'rollback' then
        format(':rewind: **%s** used a rollback and went back %s: %s → %s. %s rollback(s) left.',
               p_team, p ->> 'steps', v_from, v_to, p ->> 'rollbacks_available')
      when 'punish' then
        format(':warning: An organiser punished **%s**: back %s, %s → %s.', p_team, p ->> 'steps', v_from, v_to)
      else
        format(':arrow_right: An organiser moved **%s** to %s.', p_team, v_to)
    end || case when p ->> 'kind' = 'move' then '' else v_extra end;

  elsif p_event.type = 'rollback_gained' then
    v_n := (p ->> 'amount')::int;
    return case
      when p ->> 'reason' = 'auto' then
        format(':game_die: **%s** earned a rollback for finishing tile %s — %s available.',
               p_team, p ->> 'tile', p ->> 'rollbacks_available')
      when p ->> 'reason' = 'pet' then
        format(':paw_prints: **%s** traded a pet for a rollback on tile %s — %s available.',
               p_team, p ->> 'tile', p ->> 'rollbacks_available')
      when v_n < 0 then
        format('An organiser took %s rollback(s) from **%s** — %s left.',
               -v_n, p_team, p ->> 'rollbacks_available')
      else
        format('An organiser gave **%s** %s rollback(s) — %s available.',
               p_team, v_n, p ->> 'rollbacks_available')
    end;

  elsif p_event.type = 'tile_reopened' then
    return format(':leftwards_arrow_with_hook: An organiser reopened tile %s%s for **%s** — it is no longer complete.',
                  p ->> 'position', coalesce(' (**' || (p ->> 'tile_name') || '**)', ''), p_team)
      || case when (p ->> 'game_reopened')::boolean then ' **The game has been reopened.**' else '' end
      || case when (p ->> 'winner_changed')::boolean then ' **The winner has changed.**' else '' end;

  elsif p_event.type = 'tile_completed' then
    return format(':white_check_mark: **%s** completed tile %s, **%s**.%s',
                  p_team, p ->> 'position', coalesce(p ->> 'tile_name', 'a tile'),
                  case when (p ->> 'early')::boolean then ' (Marked complete by an organiser.)' else '' end);

  elsif p_event.type = 'game_ended' then
    return case
      when p ->> 'reason' = 'won' then
        format(':trophy: **%s** completed tile 100 and wins Snakes and Ladders!', p_team)
      when p_event.team_id is null then
        'The organiser ended the game. No team had left Start, so nobody wins.'
      else
        format('The organiser ended the game. :trophy: **%s** wins — furthest along, on tile %s.',
               p_team, p ->> 'tile')
    end;
  end if;

  return null;
end;
$function$;
