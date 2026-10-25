-- ============================================================
-- Challenge: letting people in after the event has started
-- ============================================================
--
-- challenge_join refused anyone once the event was active, and the comment
-- above it said why: the WOM competition is created at the start from exactly
-- the people who joined, so a latecomer would sit on our ladder and not on
-- WOM's, scoring nothing for a week they actually played. Refusing clearly was
-- the honest thing to do while that was true.
--
-- It is no longer true. WOM has POST /competitions/:id/participants, which
-- takes the verification code and a list of names, so this migration adds the
-- latecomer to the live competition instead of turning them away.
--
-- WHAT A LATECOMER IS SCORED ON. WOM measures every participant from the
-- competition's own start, so someone signing up on day five is credited with
-- the four days before they joined. That is wrong in principle and nearly
-- always harmless in practice -- the gain in those days is theirs either way,
-- it was simply earned before they thought to sign up. The honest alternative
-- is a second competition per latecomer, which is a great deal of machinery
-- for a small unfairness, so the full-window figure stands and the sign-up
-- card says so in words rather than leaving someone to discover it.
--
-- NONE OF THIS IS SWEPT. The function guards in 20261025130000 were swapped at
-- runtime, but that sweep ran before any challenge function existed, so the
-- live definitions of the three functions replaced here are exactly what
-- 20261026120200 emitted. Re-emitting them whole is safe; patching them
-- surgically would be the ceremony without the reason.

-- ============================================================
-- 1. Room in the log for a third kind of request
-- ============================================================

alter table challenge_fetch_log
  drop constraint challenge_fetch_log_purpose_check;

alter table challenge_fetch_log
  add constraint challenge_fetch_log_purpose_check
  check (purpose in ('create', 'fetch', 'add'));

-- WHICH entries an 'add' was for. The names are sent in one request rather
-- than one each -- WOM takes an array, and a quiet event that gains five
-- latecomers in a minute must not cost five of the twenty requests a minute
-- we are allowed. Reconcile marks exactly these rows and not "everyone who
-- looked unadded", which would also mark whoever joined while the request was
-- in flight and was never in it.
alter table challenge_fetch_log
  add column entry_ids uuid[];

comment on column challenge_fetch_log.entry_ids is
  'For purpose = add: the entries whose names went in this request. Null otherwise.';

-- ============================================================
-- 2. Whether WOM has actually heard of an entry
-- ============================================================
--
-- Null means the competition does not know this person yet: still queued,
-- refused, or never sent. It is not the same as "no standings yet", which is
-- also true of a perfectly good entry before the first fetch comes back, and
-- telling a player "you are in" when WOM has never heard of them is the exact
-- failure this migration exists to stop.

alter table challenge_entries
  add column wom_added_at timestamptz;

comment on column challenge_entries.wom_added_at is
  'When WOM confirmed this entry is in the competition. Null means it is not, so this entry scores nothing until it is.';

-- Everyone already playing went in the create body, so the competitions that
-- exist right now know all of them. Backfilling null would put every live
-- event into "waiting for Wise Old Man" on the strength of a column that did
-- not exist when they started.
update challenge_entries e
   set wom_added_at = w.created_at
  from challenge_wom w
 where w.game_id = e.game_id
   and e.rsn is not null;

-- ============================================================
-- 3. Putting names on a competition that is already running
-- ============================================================

-- Everyone this event has who WOM does not, in one request.
--
-- Not callable by a client: it is reached from challenge_join, when a latecomer
-- signs up, and from challenge_fetch, which every open browser already pulses
-- during an active event. That second caller is what makes it self-healing --
-- a request WOM refused, or one pg_net dropped, is simply tried again on the
-- next pulse rather than needing anybody to notice.
create or replace function challenge_wom_add(p_game_id uuid)
returns bigint
language plpgsql
security definer set search_path = public as $fn$
declare
  v_wom   challenge_wom%rowtype;
  v_ids   uuid[];
  v_names jsonb;
  v_req   bigint;
begin
  select * into v_wom from challenge_wom where game_id = p_game_id;
  if not found then return null; end if;   -- no competition, nothing to join

  -- The same rate limit the standings fetch uses, and for the same reason: a
  -- room full of open browsers must cost one request, not thirty.
  if exists (select 1 from challenge_fetch_log
              where game_id = p_game_id and purpose = 'add'
                and handled_at is null and created_at > now() - interval '2 minutes') then
    return null;
  end if;

  select array_agg(e.id), coalesce(jsonb_agg(distinct e.rsn), '[]'::jsonb)
    into v_ids, v_names
    from challenge_entries e
   where e.game_id = p_game_id
     and e.rsn is not null
     and e.wom_added_at is null;

  if v_ids is null then return null; end if;   -- WOM already has everybody

  select net.http_post(
    url     := challenge_wom_base() || '/competitions/' || v_wom.competition_id
               || '/participants',
    -- Both in the body: the deployed API answers an empty body with
    -- MISSING_VERIFICATION_CODE, and a code in a header with the same, so this
    -- is their shape and not a guess at it.
    body    := jsonb_build_object(
                 'verificationCode', v_wom.verification_code,
                 'participants',     v_names),
    headers := '{"Content-Type": "application/json"}'::jsonb
  ) into v_req;

  insert into challenge_fetch_log (request_id, game_id, purpose, entry_ids)
  values (v_req, p_game_id, 'add', v_ids);

  return v_req;
end;
$fn$;

revoke execute on function challenge_wom_add(uuid) from public, anon, authenticated;

-- ============================================================
-- 4. Joining, which no longer closes at the start
-- ============================================================

create or replace function challenge_join(p_game_id uuid, p_rsn text default null)
returns uuid
language plpgsql
security definer set search_path = public as $fn$
declare
  v_game  games%rowtype;
  v_setup challenge_setup%rowtype;
  v_rsn   text;
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

  -- The RSN is written onto the entry, not read through to the profile. WOM
  -- matches on it exactly, and a profile tidied up in March must not change
  -- what January's ladder was scored on.
  insert into challenge_entries (game_id, profile_id, rsn)
  values (p_game_id, auth.uid(), v_rsn)
  on conflict (game_id, profile_id) do update
    set rsn = excluded.rsn,
        -- A corrected name is a different player as far as WOM is concerned,
        -- so the old confirmation does not carry over to it and the new name
        -- has to be sent in its own right.
        wom_added_at = case when challenge_entries.rsn is distinct from excluded.rsn
                            then null
                            else challenge_entries.wom_added_at end
  returning id, wom_added_at into v_id, v_added;

  -- Signing up to something already running, or fixing a name while it runs.
  -- Queued, not sent: pg_net answers with a request id and the reply lands
  -- later, so this cannot tell the player here and now whether WOM took it.
  -- challenge_mine carries wom_added_at for exactly that reason.
  if v_game.status = 'active' and v_rsn is not null and v_added is null then
    perform challenge_wom_add(p_game_id);
  end if;

  return v_id;
end;
$fn$;

-- ============================================================
-- 5. Reading the replies
-- ============================================================
--
-- Re-emitted whole rather than patched: it gains a third branch and the create
-- branch gains a line, and a function this short is easier to read as one
-- piece than as two migrations that have to be held in the head at once.

create or replace function challenge_reconcile(p_game_id uuid)
returns int
language plpgsql
security definer set search_path = public as $fn$
declare
  r      record;
  v_res  record;
  v_body jsonb;
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

    begin
      v_body := case when v_res.status_code between 200 and 299
                     then v_res.content::jsonb end;
    exception when others then
      v_body := null;   -- answered with something that is not JSON
    end;

    if v_body is null then
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

      -- The create body carried everyone who had a name, so the competition
      -- knows all of them -- but only if it was actually created, which the
      -- guard above means is not a given.
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

    else
      -- `deltas` first: the type definitions mark the flat `progress` object
      -- deprecated, but it is still sent, so it is the fallback rather than
      -- the other way round. A single-metric competition has one delta.
      -- MINUS ONE IS NOT A SCORE. It is WOM for "this player is not ranked on
      -- the hiscores for this metric" -- which is every account below the
      -- hiscore threshold, so a raid released last week has a competition full
      -- of them. Stored as null, because null is what the screen already reads
      -- as "nothing off the hiscores yet"; stored as -1 it would be shown as a
      -- figure, and a start of -1 against an end of -1 looks like a bug rather
      -- than a player who has not got going.
      update challenge_entries e
         set wom_start  = nullif(coalesce((p.v -> 'deltas' -> 0 -> 'values' ->> 'start')::bigint,
                                          (p.v -> 'progress' ->> 'start')::bigint), -1),
             wom_end    = nullif(coalesce((p.v -> 'deltas' -> 0 -> 'values' ->> 'end')::bigint,
                                          (p.v -> 'progress' ->> 'end')::bigint), -1),
             wom_gained = greatest(coalesce((p.v -> 'deltas' -> 0 -> 'values' ->> 'gained')::bigint,
                                            (p.v -> 'progress' ->> 'gained')::bigint), 0)
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
-- 6. The pulse, which now also catches anyone WOM is missing
-- ============================================================
--
-- Re-emitted for one inserted call. It goes BEFORE the fetch rate limits on
-- purpose: those exist to stop thirty browsers asking for the same standings,
-- and returning early from them must not also mean a latecomer sits unadded
-- until somebody happens to call this a full minute later.

create or replace function challenge_fetch(p_game_id uuid)
returns bigint
language plpgsql
security definer set search_path = public as $fn$
declare
  v_wom challenge_wom%rowtype;
  v_req bigint;
begin
  perform challenge_setup_for(p_game_id);

  select * into v_wom from challenge_wom where game_id = p_game_id;
  if not found then return null; end if;   -- no competition yet, nothing to ask

  -- Anyone the competition does not have yet. Rate-limited in its own right,
  -- and a no-op when there is nobody, so this costs a cheap count on the
  -- common pass.
  perform challenge_wom_add(p_game_id);

  -- The rate limit. A fetch already in flight, or standings written less than
  -- a minute ago, means somebody else has just done this.
  if exists (select 1 from challenge_fetch_log
              where game_id = p_game_id and purpose = 'fetch'
                and handled_at is null and created_at > now() - interval '2 minutes') then
    return null;
  end if;
  if v_wom.fetched_at is not null and v_wom.fetched_at > now() - interval '1 minute' then
    return null;
  end if;

  select net.http_get(
    url := challenge_wom_base() || '/competitions/' || v_wom.competition_id
  ) into v_req;

  insert into challenge_fetch_log (request_id, game_id, purpose)
  values (v_req, p_game_id, 'fetch');

  return v_req;
end;
$fn$;

-- ============================================================
-- 7. Telling the player where they stand
-- ============================================================
--
-- `wom_added` is the whole point of the column reaching the client: a latecomer
-- whose name WOM has not taken is on our ladder scoring nothing, and the one
-- unacceptable outcome is that they find that out at the end of the week.

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

  -- Before the competition exists there is nothing to be missing from, so an
  -- entry in a not-yet-started event is not "waiting" -- it is simply early.
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

-- ============================================================
-- 8. The competition itself, for anyone who wants to look at it
-- ============================================================
--
-- The id and nothing else. challenge_wom also holds the verification code,
-- which is the credential that lets anyone edit the competition, and that is
-- why the table has RLS on with no policies at all -- so this is a function
-- that hands back one column rather than a policy that opens the row.
--
-- The competition is public on wiseoldman.net, so there is nothing to protect
-- in the id, and plenty to gain: an organiser can see that the thing was
-- really created, and check our ladder against theirs when a figure looks
-- wrong. Null while the create request is still in flight, which is itself
-- worth showing.

create or replace function challenge_wom_competition(p_game_id uuid)
returns bigint
language plpgsql stable
security definer set search_path = public as $fn$
declare
  v_id bigint;
begin
  perform challenge_setup_for(p_game_id);
  select competition_id into v_id from challenge_wom where game_id = p_game_id;
  return v_id;
end;
$fn$;

revoke execute on function challenge_wom_competition(uuid) from public, anon;
grant  execute on function challenge_wom_competition(uuid) to authenticated;
