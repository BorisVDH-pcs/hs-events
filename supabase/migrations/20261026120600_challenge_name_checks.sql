-- ============================================================
-- Challenge: a name WOM took is not the same as a name that exists
-- ============================================================
--
-- 20261026120500 told a player they were not being counted when WOM REFUSED
-- their name. That guards the wrong case. WOM's addParticipants validates the
-- format and nothing else -- one to twelve characters, letters, digits and
-- spaces -- and then calls findOrCreatePlayers, which inserts a row for a name
-- it has never seen. A typo is therefore accepted with a 200, and the player
-- gets a green light and a week of zeroes.
--
-- The signal is already in the standings we fetch every minute. Every
-- participation carries its player, and a player WOM has actually pulled off
-- the hiscores has `updatedAt` set. A row invented from a typo has it null:
-- the Prisma default for `status` is 'active', so status alone says nothing
-- until their background job has tried and failed, at which point it becomes
-- 'unranked'. Both are worth reading; neither costs a request.
--
-- Two smaller things, both from 20261026120500 and both mine:
--
--  * ALL_PLAYERS_ALREADY_COMPETING is a refusal that means success. WOM
--    answers it when every name sent is already on the competition, which
--    happens on a retry after a dropped reply, and to anyone who corrects
--    their name and then corrects it back. Treating it as a failure left a
--    player permanently told they were not being counted while they were.
--
--  * A corrected name was added and the old one left behind for good. Mostly
--    cosmetic, since the ladder reads the entry's current name -- but a typo
--    can be a real stranger's account, and a stranger quietly out-scoring the
--    clan on WOM's own page is not cosmetic.

-- ============================================================
-- 1. Taking a name off again
-- ============================================================

alter table challenge_fetch_log
  drop constraint challenge_fetch_log_purpose_check;

alter table challenge_fetch_log
  add constraint challenge_fetch_log_purpose_check
  check (purpose in ('create', 'fetch', 'add', 'drop'));

-- ============================================================
-- 2. Whether the hiscores have ever heard of this name
-- ============================================================
--
-- Null until a standings reply has mentioned this player at all. True when WOM
-- has really fetched them. False when WOM holds the name but has never got
-- anything for it -- a typo, or an account too new to be on the hiscores. The
-- wording on screen says exactly that rather than accusing anyone of a typo,
-- because both are true cases and both score nothing.

alter table challenge_entries
  add column wom_found boolean;

comment on column challenge_entries.wom_found is
  'False when WOM has the name but has never found it on the hiscores -- a typo, or an account not ranked yet. Either way it scores nothing.';

-- ============================================================
-- 3. Dropping a name from a running competition
-- ============================================================
--
-- WOM's remove-participants is a real DELETE carrying a body, and pg_net only
-- grew a body parameter on http_delete later on. Checked here rather than
-- discovered inside challenge_join the first time somebody corrects a name:
-- an older signature would raise at runtime, in the middle of a join, which is
-- the worst possible place to find out.
do $guard$
begin
  if to_regprocedure('net.http_delete(text, jsonb, jsonb, integer, jsonb)') is null then
    raise exception
      'pg_net''s http_delete does not take a body on this database, so a corrected name cannot be removed from a competition';
  end if;
end
$guard$;

create or replace function challenge_wom_drop(p_game_id uuid, p_rsn text)
returns bigint
language plpgsql
security definer set search_path = public as $fn$
declare
  v_wom challenge_wom%rowtype;
  v_req bigint;
begin
  if nullif(btrim(coalesce(p_rsn, '')), '') is null then return null; end if;

  select * into v_wom from challenge_wom where game_id = p_game_id;
  if not found then return null; end if;

  -- Never drop a name somebody else is still playing under. Two entries can
  -- hold the same RSN only by mistake, but removing a name out from under a
  -- live entry would be a worse mistake than leaving a stale one behind.
  if exists (select 1 from challenge_entries
              where game_id = p_game_id
                and challenge_rsn_key(rsn) = challenge_rsn_key(p_rsn)) then
    return null;
  end if;

  -- A real DELETE. WOM's express app mounts no method-override middleware, so
  -- a POST wearing an override header would simply be taken at face value --
  -- and the POST route is the one that ADDS, which would put the old name
  -- straight back rather than take it off.
  select net.http_delete(
    url     := challenge_wom_base() || '/competitions/' || v_wom.competition_id
               || '/participants',
    body    := jsonb_build_object(
                 'verificationCode', v_wom.verification_code,
                 'participants',     jsonb_build_array(p_rsn)),
    headers := '{"Content-Type": "application/json"}'::jsonb
  ) into v_req;

  insert into challenge_fetch_log (request_id, game_id, purpose)
  values (v_req, p_game_id, 'drop');

  return v_req;
end;
$fn$;

revoke execute on function challenge_wom_drop(uuid, text) from public, anon, authenticated;

-- ============================================================
-- 4. Joining, which now tidies up after a corrected name
-- ============================================================

create or replace function challenge_join(p_game_id uuid, p_rsn text default null)
returns uuid
language plpgsql
security definer set search_path = public as $fn$
declare
  v_game  games%rowtype;
  v_setup challenge_setup%rowtype;
  v_rsn   text;
  v_old   text;
  v_id    uuid;
  v_added timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  v_setup := challenge_setup_for(p_game_id);
  select * into v_game from games where id = p_game_id;

  -- Open for as long as the event is running. Finished is finished: there is
  -- no window left to measure, so an entry made now could only ever score a
  -- zero, which is worse than being told no.
  if v_game.status not in ('setup', 'active') then
    raise exception 'This event has finished — the next one will be along';
  end if;

  v_rsn := nullif(btrim(coalesce(p_rsn, (select rsn from profiles where id = auth.uid()), '')), '');
  if v_setup.wom_metric is not null and v_rsn is null then
    raise exception 'This event is scored from the hiscores, so it needs your RuneScape name';
  end if;

  -- What the entry said before, so a corrected name can be taken off the
  -- competition rather than left on it beside the right one.
  select rsn into v_old from challenge_entries
   where game_id = p_game_id and profile_id = auth.uid();

  -- The RSN is written onto the entry, not read through to the profile. WOM
  -- matches on it exactly, and a profile tidied up in March must not change
  -- what January's ladder was scored on.
  insert into challenge_entries (game_id, profile_id, rsn)
  values (p_game_id, auth.uid(), v_rsn)
  on conflict (game_id, profile_id) do update
    set rsn = excluded.rsn,
        -- A corrected name is a different player as far as WOM is concerned,
        -- so neither the old confirmation nor what the hiscores said about the
        -- old name carries over to it.
        wom_added_at = case when challenge_entries.rsn is distinct from excluded.rsn
                            then null
                            else challenge_entries.wom_added_at end,
        wom_found    = case when challenge_entries.rsn is distinct from excluded.rsn
                            then null
                            else challenge_entries.wom_found end
  returning id, wom_added_at into v_id, v_added;

  if v_game.status = 'active' and v_rsn is not null and v_added is null then
    -- Off with the old name first, so a competition cannot end up holding both
    -- halves of somebody's typo.
    if v_old is distinct from v_rsn then
      perform challenge_wom_drop(p_game_id, v_old);
    end if;
    perform challenge_wom_add(p_game_id);
  end if;

  return v_id;
end;
$fn$;

-- ============================================================
-- 5. Reading the replies
-- ============================================================
--
-- Re-emitted again. The shape changed rather than grew this time: the body is
-- now parsed whatever the status code was, because one of WOM's refusals has
-- to be read as a success and cannot be if the body is thrown away first.

create or replace function challenge_reconcile(p_game_id uuid)
returns int
language plpgsql
security definer set search_path = public as $fn$
declare
  r      record;
  v_res  record;
  v_body jsonb;
  v_ok   boolean;
  v_n    int := 0;
begin
  perform challenge_setup_for(p_game_id);

  for r in
    select request_id, purpose, entry_ids from challenge_fetch_log
     where game_id = p_game_id and handled_at is null
     order by created_at
  loop
    select status_code, content into v_res
      from net._http_response where id = r.request_id;

    -- Still in flight. Leave it; the next pass will find it.
    if not found then continue; end if;

    v_ok := v_res.status_code between 200 and 299;
    begin
      v_body := v_res.content::jsonb;
    exception when others then
      v_body := null;   -- answered with something that is not JSON
    end;

    -- ALREADY COMPETING IS NOT A FAILURE. WOM says it when every name sent is
    -- already on the competition, which is what a retry after a dropped reply
    -- looks like, and what correcting a name back to the old one looks like.
    -- The entries it names are on the competition, which is all this was
    -- asking for.
    if r.purpose = 'add' and not v_ok
       and (v_body ->> 'code') = 'ALL_PLAYERS_ALREADY_COMPETING' then
      v_ok := true;
      v_body := coalesce(v_body, '{}'::jsonb);
    end if;

    if not v_ok or v_body is null then
      -- Answered, but not usefully. Mark it done so it stops being looked at;
      -- the next fetch is a fresh request, not a retry of this one. An 'add'
      -- that lands here leaves wom_added_at null, which is what sends it round
      -- again on the next pulse and what the sign-up card reads.
      update challenge_fetch_log set handled_at = now() where request_id = r.request_id;
      continue;
    end if;

    if r.purpose = 'create' then
      -- WOM answers { competition: {...}, verificationCode }. The fallback is
      -- for the flatter shape, so a change at their end costs a null id rather
      -- than an exception in the middle of a loop.
      insert into challenge_wom (game_id, competition_id, verification_code)
      select p_game_id,
             coalesce((v_body -> 'competition' ->> 'id')::bigint, (v_body ->> 'id')::bigint),
             coalesce(v_body ->> 'verificationCode', '')
       where coalesce((v_body -> 'competition' ->> 'id')::bigint, (v_body ->> 'id')::bigint) is not null
      on conflict (game_id) do nothing;

      update challenge_entries e
         set wom_added_at = now()
       where e.game_id = p_game_id
         and e.rsn is not null
         and e.wom_added_at is null
         and exists (select 1 from challenge_wom w where w.game_id = p_game_id);

    elsif r.purpose = 'add' then
      -- Exactly the entries whose names went in this request. Anyone who
      -- joined while it was in flight was not in it and stays unadded, so the
      -- next pulse picks them up.
      update challenge_entries
         set wom_added_at = now()
       where id = any (r.entry_ids);

    elsif r.purpose = 'drop' then
      null;   -- nothing to record; a name that would not come off is harmless

    else
      -- `deltas` first: the type definitions mark the flat `progress` object
      -- deprecated, but it is still sent, so it is the fallback rather than
      -- the other way round. A single-metric competition has one delta.
      --
      -- MINUS ONE IS NOT A SCORE. It is WOM for "this player is not ranked on
      -- the hiscores for this metric", which is every account below the
      -- threshold, so a raid released last week has a competition full of
      -- them. Null is what the screen already reads as "nothing yet".
      --
      -- `wom_found` is the other half, and the one that matters: a player WOM
      -- has really fetched has `updatedAt` set, and one invented from a typo
      -- never does. `status` is worth reading too, but only later -- it is
      -- 'active' by default on a row WOM has just made up, and only becomes
      -- 'unranked' once their own job has tried and failed.
      update challenge_entries e
         set wom_start  = nullif(coalesce((p.v -> 'deltas' -> 0 -> 'values' ->> 'start')::bigint,
                                          (p.v -> 'progress' ->> 'start')::bigint), -1),
             wom_end    = nullif(coalesce((p.v -> 'deltas' -> 0 -> 'values' ->> 'end')::bigint,
                                          (p.v -> 'progress' ->> 'end')::bigint), -1),
             wom_gained = greatest(coalesce((p.v -> 'deltas' -> 0 -> 'values' ->> 'gained')::bigint,
                                            (p.v -> 'progress' ->> 'gained')::bigint), 0),
             wom_found  = ((p.v -> 'player' ->> 'updatedAt') is not null
                           and coalesce(p.v -> 'player' ->> 'status', 'active') = 'active')
        from jsonb_array_elements(coalesce(v_body -> 'participations', '[]'::jsonb)) as p(v)
       where e.game_id = p_game_id
         and challenge_rsn_key(e.rsn) is not null
         and challenge_rsn_key(e.rsn) = any (array[
               challenge_rsn_key(p.v -> 'player' ->> 'username'),
               challenge_rsn_key(p.v -> 'player' ->> 'displayName')]);

      update challenge_wom set fetched_at = now() where game_id = p_game_id;
    end if;

    update challenge_fetch_log set handled_at = now() where request_id = r.request_id;
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$fn$;

-- ============================================================
-- 6. Telling the player which of the two is wrong
-- ============================================================
--
-- `wom_added` is whether the competition has the name. `wom_found` is whether
-- the name is an account. They fail separately and they need different words:
-- one is "we are still trying", the other is "this is not you".

create or replace function challenge_mine(p_game_id uuid)
returns jsonb
language plpgsql stable
security definer set search_path = public as $fn$
declare
  v_entry challenge_entries%rowtype;
  v_has   boolean;
begin
  perform challenge_setup_for(p_game_id);
  select * into v_entry from challenge_entries
   where game_id = p_game_id and profile_id = auth.uid();
  if not found then return null; end if;

  select exists (select 1 from challenge_wom where game_id = p_game_id) into v_has;

  return jsonb_build_object(
    'entry_id',    v_entry.id,
    'team_id',     v_entry.team_id,
    'rsn',         v_entry.rsn,
    'wom_start',   v_entry.wom_start,
    'wom_end',     v_entry.wom_end,
    'wom_gained',  v_entry.wom_gained,
    'wom_added',   case when not v_has or v_entry.rsn is null then null
                        else v_entry.wom_added_at is not null end,
    'wom_found',   v_entry.wom_found,
    'declared',    v_entry.declared,
    'declared_at', v_entry.declared_at,
    'altered',     v_entry.altered_by is not null,
    'verified',    v_entry.verified_at is not null,
    'evidence',    coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'phase', e.phase, 'url', e.url, 'note', e.note)
                       order by e.added_at)
        from challenge_evidence e where e.entry_id = v_entry.id), '[]'::jsonb));
end;
$fn$;
