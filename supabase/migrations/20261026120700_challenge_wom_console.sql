-- ============================================================
-- The organiser's view of the Wise Old Man competition
-- ============================================================
--
-- Until now the competition was only reachable from the player page: an
-- organiser had to join their own event to find the link, and the
-- verification code -- the credential that lets anyone edit or delete the
-- competition on WOM -- was exposed nowhere at all.
--
-- It stays exposed nowhere for players. `challenge_wom_competition` keeps
-- handing out the competition id and nothing else, because every signed-in
-- player calls it. The code goes through this organiser-only function, and
-- only when `p_reveal` asks for it -- so the console can show the links
-- without the credential ever being in the page a screenshot would catch.
--
-- WOM offers no way to regenerate a verification code, so once an organiser
-- has seen it, it is seen. Hence the click.

create or replace function admin_challenge_wom(p_game_id uuid,
                                               p_reveal boolean default false)
returns jsonb
language plpgsql stable
security definer set search_path = public as $fn$
declare
  v_wom     challenge_wom%rowtype;
  v_has     boolean;
  v_pending boolean;
begin
  perform challenge_setup_for(p_game_id);
  if not may_manage_game(p_game_id) then raise exception 'Not your game'; end if;

  select * into v_wom from challenge_wom where game_id = p_game_id;
  v_has := found;   -- the count below overwrites `found`, so take it here

  -- Whether a create request is still out. Without this an organiser cannot
  -- tell "the event has not started yet" from "WOM was asked and never
  -- answered", which are the two reasons there is no competition and want
  -- opposite responses.
  select exists (select 1 from challenge_fetch_log
                  where game_id = p_game_id and purpose = 'create'
                    and handled_at is null)
    into v_pending;

  if not v_has then
    return jsonb_build_object('competition_id', null, 'pending', v_pending);
  end if;

  return jsonb_build_object(
    'competition_id',    v_wom.competition_id,
    'verification_code', case when p_reveal then v_wom.verification_code end,
    'has_code',          nullif(v_wom.verification_code, '') is not null,
    'fetched_at',        v_wom.fetched_at,
    'created_at',        v_wom.created_at,
    'pending',           false);
end;
$fn$;

comment on function admin_challenge_wom(uuid, boolean) is
  'CREDENTIALS: with p_reveal, returns the WOM verification code. Organisers of this game only.';

revoke execute on function admin_challenge_wom(uuid, boolean) from public, anon;
grant  execute on function admin_challenge_wom(uuid, boolean) to authenticated;
