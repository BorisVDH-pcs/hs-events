-- ============================================================
-- Five seconds was never enough for Wise Old Man
-- ============================================================
--
-- Test TFA, 2026-10-25, is what this migration is written from. The event
-- started, challenge_wom_create queued the POST, and pg_net gave up:
--
--   timed_out true
--   Timeout of 5000 ms reached. Total time: 5001.063 ms
--     (DNS 143.9 ms, TCP/SSL handshake 92.1 ms,
--      HTTP Request/Response 4764.2 ms)
--
-- WOM had already made the competition -- 162883, two participants, the right
-- metric -- and went on to finish the reply. Nobody was listening by then.
-- challenge_reconcile found a row with no status and no body, correctly judged
-- it useless, marked it handled and moved on. The event scored zero for the
-- rest of its life with nothing on screen to say why.
--
-- Two things were wrong, and this fixes both.
--
-- 1. None of the four senders passed a timeout, so all four ran on the pg_net
--    default of five seconds. Creating a competition is the slowest thing we
--    ask WOM to do -- it makes a player row for every participant before it
--    answers -- and it is also the only reply that carries the verification
--    code, which exists nowhere else. Losing that reply is unrecoverable.
--
-- 2. There was no way back. challenge_wom_create is called once, by
--    challenge_start, and refuses if a row already exists. A lost reply left
--    the organiser with no retry, and no way to point the event at the
--    competition that WOM had in fact created.

create or replace function challenge_wom_timeout() returns int
language sql immutable as $fn$ select 30000 $fn$;

comment on function challenge_wom_timeout() is
  'How long to wait for Wise Old Man. Their create answered in 4.8s once, so five seconds is not a margin.';

-- A deploy-time check rather than a silent default: if this pg_net cannot be
-- told to wait, the whole migration is pointless and should say so loudly.
do $guard$
begin
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null
     or to_regprocedure('net.http_get(text, jsonb, jsonb, integer)') is null then
    raise exception
      'pg_net on this database does not take timeout_milliseconds, so Wise Old Man cannot be given longer than five seconds';
  end if;
end
$guard$;

-- ============================================================
-- The four senders, unchanged but for that one argument
-- ============================================================

create or replace function challenge_wom_create(p_game_id uuid)
returns bigint
language plpgsql
security definer set search_path = public as $fn$
declare
  v_game  games%rowtype;
  v_setup challenge_setup%rowtype;
  v_names jsonb;
  v_req   bigint;
begin
  v_setup := challenge_setup_for(p_game_id);
  select * into v_game from games where id = p_game_id;
  if v_setup.wom_metric is null then return null; end if;
  if exists (select 1 from challenge_wom where game_id = p_game_id) then
    raise exception 'This event already has a Wise Old Man competition';
  end if;

  -- The entries' own names, plus every account row behind them. `union` for
  -- the deduplication: in an all_accounts event the primary name is in both.
  select coalesce(jsonb_agg(distinct n.rsn), '[]'::jsonb)
    into v_names
    from (
      select e.rsn from challenge_entries e
       where e.game_id = p_game_id and e.rsn is not null
      union
      select a.rsn from challenge_entry_accounts a
       join challenge_entries e on e.id = a.entry_id
       where e.game_id = p_game_id
    ) as n(rsn);

  if jsonb_array_length(v_names) = 0 then
    raise exception 'Nobody with a RuneScape name has joined, so there is nothing to track';
  end if;

  -- A minute in the future, not now: the request is queued rather than sent,
  -- and WOM refuses a competition that starts in the past.
  select net.http_post(
    url     := challenge_wom_base() || '/competitions',
    body    := jsonb_build_object(
                 'title',        left(v_game.name, 50),
                 'metric',       v_setup.wom_metric,
                 'startsAt',     to_char((now() + interval '1 minute') at time zone 'UTC',
                                         'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                 'endsAt',       to_char(v_game.ends_at at time zone 'UTC',
                                         'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                 'participants', v_names),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    -- See 130200: pg_net defaults to five seconds, and WOM needs more.
    timeout_milliseconds := challenge_wom_timeout()
  ) into v_req;

  insert into challenge_fetch_log (request_id, game_id, purpose)
  values (v_req, p_game_id, 'create');

  return v_req;
end;
$fn$;

create or replace function challenge_wom_add(p_game_id uuid)
returns bigint
language plpgsql
security definer set search_path = public as $fn$
declare
  v_wom    challenge_wom%rowtype;
  v_ids    uuid[];
  v_accs   uuid[];
  v_names  jsonb;
  v_req    bigint;
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

  select array_agg(e.id)
    into v_ids
    from challenge_entries e
   where e.game_id = p_game_id
     and e.rsn is not null
     and e.wom_added_at is null;

  select array_agg(a.id)
    into v_accs
    from challenge_entry_accounts a
    join challenge_entries e on e.id = a.entry_id
   where e.game_id = p_game_id
     and a.wom_added_at is null;

  if v_ids is null and v_accs is null then return null; end if;   -- WOM has everybody

  -- One list, deduplicated: in an all_accounts event the primary name is on
  -- the entry AND in the account rows, and WOM answers the whole request with
  -- ALL_PLAYERS_ALREADY_COMPETING if every name in it is a repeat.
  select coalesce(jsonb_agg(distinct n.rsn), '[]'::jsonb)
    into v_names
    from (
      select e.rsn from challenge_entries e
       where e.id = any (coalesce(v_ids, '{}'::uuid[]))
      union
      select a.rsn from challenge_entry_accounts a
       where a.id = any (coalesce(v_accs, '{}'::uuid[]))
    ) as n(rsn);

  select net.http_post(
    url     := challenge_wom_base() || '/competitions/' || v_wom.competition_id
               || '/participants',
    -- Both in the body: the deployed API answers an empty body with
    -- MISSING_VERIFICATION_CODE, and a code in a header with the same, so this
    -- is their shape and not a guess at it.
    body    := jsonb_build_object(
                 'verificationCode', v_wom.verification_code,
                 'participants',     v_names),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    -- See 130200: pg_net defaults to five seconds, and WOM needs more.
    timeout_milliseconds := challenge_wom_timeout()
  ) into v_req;

  insert into challenge_fetch_log (request_id, game_id, purpose, entry_ids, account_ids)
  values (v_req, p_game_id, 'add', v_ids, v_accs);

  return v_req;
end;
$fn$;

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

  -- Never drop a name somebody else is still playing under.
  if exists (select 1 from challenge_entries
              where game_id = p_game_id
                and challenge_rsn_key(rsn) = challenge_rsn_key(p_rsn)) then
    return null;
  end if;

  if exists (select 1 from challenge_entry_accounts a
               join challenge_entries e on e.id = a.entry_id
              where e.game_id = p_game_id
                and rsn_key(a.rsn) = rsn_key(p_rsn)) then
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
    headers := '{"Content-Type": "application/json"}'::jsonb,
    -- See 130200: pg_net defaults to five seconds, and WOM needs more.
    timeout_milliseconds := challenge_wom_timeout()
  ) into v_req;

  insert into challenge_fetch_log (request_id, game_id, purpose)
  values (v_req, p_game_id, 'drop');

  return v_req;
end;
$fn$;

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
    url := challenge_wom_base() || '/competitions/' || v_wom.competition_id,
    -- See 130200: pg_net defaults to five seconds, and WOM needs more.
    timeout_milliseconds := challenge_wom_timeout()
  ) into v_req;

  insert into challenge_fetch_log (request_id, game_id, purpose)
  values (v_req, p_game_id, 'fetch');

  return v_req;
end;
$fn$;

revoke execute on function challenge_wom_create(uuid)       from public, anon, authenticated;
revoke execute on function challenge_wom_add(uuid)          from public, anon, authenticated;
revoke execute on function challenge_wom_drop(uuid, text)   from public, anon, authenticated;
revoke execute on function challenge_wom_timeout()          from public, anon, authenticated;

-- ============================================================
-- A way back from a lost reply
-- ============================================================

create or replace function admin_challenge_wom(p_game_id uuid,
                                               p_reveal boolean default false)
returns jsonb
language plpgsql stable
security definer set search_path = public as $fn$
declare
  v_wom     challenge_wom%rowtype;
  v_has     boolean;
  v_pending boolean;
  v_tried   boolean;
begin
  perform challenge_setup_for(p_game_id);
  if not may_manage_game(p_game_id) then raise exception 'Not your game'; end if;

  select * into v_wom from challenge_wom where game_id = p_game_id;
  v_has := found;   -- the counts below overwrite `found`, so take it here

  -- Whether a create request is still out. Without this an organiser cannot
  -- tell "the event has not started yet" from "WOM was asked and never
  -- answered", which are the two reasons there is no competition and want
  -- opposite responses.
  select exists (select 1 from challenge_fetch_log
                  where game_id = p_game_id and purpose = 'create'
                    and handled_at is null)
    into v_pending;

  -- And whether one was asked for and came to nothing. With no row to show
  -- for it, that is the Test TFA case: there may well be a competition on WOM
  -- already, and making a second one would be the wrong move.
  select exists (select 1 from challenge_fetch_log
                  where game_id = p_game_id and purpose = 'create'
                    and handled_at is not null)
    into v_tried;

  if not v_has then
    return jsonb_build_object('competition_id', null,
                              'pending',        v_pending,
                              'tried',          v_tried);
  end if;

  return jsonb_build_object(
    'competition_id',    v_wom.competition_id,
    'verification_code', case when p_reveal then v_wom.verification_code end,
    'has_code',          nullif(v_wom.verification_code, '') is not null,
    'fetched_at',        v_wom.fetched_at,
    'created_at',        v_wom.created_at,
    'pending',           false,
    'tried',             false);
end;
$fn$;

comment on function admin_challenge_wom(uuid, boolean) is
  'CREDENTIALS: with p_reveal, returns the WOM verification code. Organisers of this game only.';

-- Point the event at a competition that already exists on WOM. This is the
-- repair for a lost create reply: the competition is there, we simply never
-- heard its number.
create or replace function admin_challenge_wom_link(p_game_id uuid,
                                                    p_competition_id bigint,
                                                    p_verification_code text default '')
returns jsonb
language plpgsql
security definer set search_path = public as $fn$
declare
  v_code text := coalesce(btrim(p_verification_code), '');
begin
  perform challenge_setup_for(p_game_id);
  if not may_manage_game(p_game_id) then raise exception 'Not your game'; end if;

  if p_competition_id is null or p_competition_id <= 0 then
    raise exception 'That is not a Wise Old Man competition number';
  end if;

  if exists (select 1 from challenge_wom where game_id = p_game_id) then
    raise exception 'This event already has a Wise Old Man competition';
  end if;

  insert into challenge_wom (game_id, competition_id, verification_code)
  values (p_game_id, p_competition_id, v_code);

  -- With no code, nothing can ever be added to this competition, so the only
  -- sensible reading is that it already holds the people it was made with --
  -- and leaving them unadded would queue a request a minute, for ever, that
  -- WOM can only refuse. With a code we do the opposite and let the ordinary
  -- add run: WOM answers ALL_PLAYERS_ALREADY_COMPETING for whoever is on it
  -- already, and challenge_reconcile reads that as success.
  if v_code = '' then
    update challenge_entries set wom_added_at = now()
     where game_id = p_game_id and rsn is not null and wom_added_at is null;

    update challenge_entry_accounts a set wom_added_at = now()
      from challenge_entries e
     where e.id = a.entry_id and e.game_id = p_game_id and a.wom_added_at is null;
  end if;

  return admin_challenge_wom(p_game_id);
end;
$fn$;

comment on function admin_challenge_wom_link(uuid, bigint, text) is
  'Attach an event to a competition WOM already has, after a create reply was lost.';

-- Ask again, for an event that genuinely has no competition anywhere.
create or replace function admin_challenge_wom_retry(p_game_id uuid)
returns bigint
language plpgsql
security definer set search_path = public as $fn$
begin
  perform challenge_setup_for(p_game_id);
  if not may_manage_game(p_game_id) then raise exception 'Not your game'; end if;

  if exists (select 1 from challenge_wom where game_id = p_game_id) then
    raise exception 'This event already has a Wise Old Man competition';
  end if;

  -- Deliberately not refused when a previous attempt was made: only the
  -- organiser can know whether that attempt left a competition behind, which
  -- is why the console warns before it offers this.
  return challenge_wom_create(p_game_id);
end;
$fn$;

comment on function admin_challenge_wom_retry(uuid) is
  'Queue another create for an event with no competition. May make a second one on WOM, so the console warns first.';

revoke execute on function admin_challenge_wom(uuid, boolean)           from public, anon;
revoke execute on function admin_challenge_wom_link(uuid, bigint, text) from public, anon;
revoke execute on function admin_challenge_wom_retry(uuid)              from public, anon;
grant  execute on function admin_challenge_wom(uuid, boolean)           to authenticated;
grant  execute on function admin_challenge_wom_link(uuid, bigint, text) to authenticated;
grant  execute on function admin_challenge_wom_retry(uuid)              to authenticated;
