-- Undo 20261005130000_snakes_pet_trade.sql.
--
-- Drops the pet trades (and their record of which screenshot went with which
-- tile) and puts snakes_discord_line back as it was. Rollbacks already given
-- for pets stay with the teams; take them back on the race table if needed.
-- The screenshots themselves stay in the evidence bucket.

drop function if exists snakes_trade_pet(uuid, text, text);
drop function if exists admin_list_pet_trades(uuid);
drop table if exists snakes_pet_trades;

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
