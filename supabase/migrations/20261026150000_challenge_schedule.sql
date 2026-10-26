-- Challenge: a start time, and a clock that acts on it
--
-- An event took an end time and nothing else. It went live when the organiser
-- pressed Start, so a Monday-morning event needed somebody awake on Monday
-- morning. It takes a start time now, and the clock does the work.
--
-- THERE IS STILL NO SCHEDULER. No `pg_cron` on this project, so this follows
-- the pattern bingo set and the WOM fetch copied: nothing fires on its own,
-- and any client calls an idempotent function when its countdown says to.
-- `challenge_tick` is that function. It is granted to `authenticated` on
-- purpose -- an open browser is what drives it -- and that is safe because it
-- reads the clock rather than its caller, and refuses to do anything the
-- clock has not already earned. The row is locked for the same reason: a
-- clan's worth of browsers reaching the end time together must start, create
-- and settle an event once each.
--
-- WHAT A SCHEDULED START SKIPS. `challenge_start` refuses an event with
-- nobody in it, and a team event with anybody unseated. Those are good
-- answers for a person pressing a button and the wrong ones for a clock: an
-- event that sat in setup because nobody had joined by Monday is exactly what
-- this removes. So the scheduled path starts regardless. That is affordable
-- now that 20261026120500 lets people join an event already running, which it
-- was not when the mode was written a day ago.
--
-- THE COMPETITION, THEN. `challenge_wom_create` refuses when nobody with a
-- RuneScape name has joined, and the start calls it, so an empty scheduled
-- start would raise and roll the whole start back. The scheduled start
-- therefore creates the competition only when there is somebody to put in it,
-- and the tick creates it later -- on the first tick that finds a running
-- event with entrants and no competition. Both halves are needed:
-- `challenge_wom_add` returns null where there is no competition to add to,
-- so without the second one an event that started empty would never get a
-- competition and would quietly score nothing all week.
--
-- ENDING TAKES TWO PASSES. `challenge_end` will not settle a hiscores ladder
-- on standings older than fifteen minutes, which is right, and which one tick
-- cannot satisfy: `pg_net` is fire-and-forget, so queueing the fetch and
-- reading its reply are different transactions. The tick reconciles whatever
-- has landed; if the figures are still stale it queues a fetch and stops, and
-- the next tick a few seconds later finishes the job. So an event ends shortly
-- after its end time rather than on it. That delay is what having the right
-- winner costs, and it is the same trade `challenge_end` already made.

-- ============================================================
-- 1. The transitions, with nobody's permission in them
-- ============================================================
-- Split out of `challenge_start` and `challenge_end` so the organiser's path
-- and the clock's path cannot drift apart. Neither is reachable from the API:
-- the checks live in the callers, which is the whole point of lifting these
-- out, so a direct grant would hand a player the power to end an event.

create or replace function challenge_do_start(p_game_id uuid, p_by uuid)
returns void
language plpgsql
security definer set search_path = public as $fn$
begin
  update games set status = 'active', started_at = now() where id = p_game_id;

  insert into game_events (game_id, type, payload)
  values (p_game_id, 'game_started',
          jsonb_build_object('by', p_by, 'mode', 'challenge',
                             -- The feed says which of the two it was, because
                             -- "nobody started this" is the interesting part.
                             'scheduled', p_by is null,
                             'entrants', (select count(*) from challenge_entries
                                           where game_id = p_game_id)));
end;
$fn$;

revoke execute on function challenge_do_start(uuid, uuid) from public, anon, authenticated;

create or replace function challenge_do_end(p_game_id uuid)
returns uuid
language plpgsql
security definer set search_path = public as $fn$
declare
  v_game   games%rowtype;
  v_setup  challenge_setup%rowtype;
  v_top    record;
  v_reason text;
begin
  v_setup := challenge_setup_for(p_game_id);
  select * into v_game from games where id = p_game_id;

  v_reason := case when v_game.ends_at is not null and now() >= v_game.ends_at
                   then 'time_up' else 'admin' end;

  select * into v_top from challenge_standings(p_game_id) where place = 1;

  update games
     set status = 'finished', ended_at = now(), ended_reason = v_reason,
         winner_team_id = case when v_setup.solo then null else v_top.team_id end
   where id = p_game_id;

  insert into game_events (game_id, team_id, type, payload)
  values (p_game_id, case when v_setup.solo then null else v_top.team_id end,
          'challenge_ended',
          jsonb_build_object(
            'reason', v_reason,
            'solo', v_setup.solo,
            'winner_name', v_top.name,
            'winner_profile_id', v_top.profile_id,
            'score', v_top.ranked,
            'ranked_by', v_setup.ranked_by,
            'label', coalesce(v_setup.declared_label, v_setup.wom_metric),
            'unit', v_setup.declared_unit));

  return case when v_setup.solo then null else v_top.team_id end;
end;
$fn$;

revoke execute on function challenge_do_end(uuid) from public, anon, authenticated;

-- ============================================================
-- 2. The organiser's two buttons, now thin
-- ============================================================
-- Same checks, same messages, same signatures. Only the transition moved.

create or replace function challenge_start(p_game_id uuid)
returns void
language plpgsql
security definer set search_path = public as $fn$
declare
  v_game  games%rowtype;
  v_setup challenge_setup%rowtype;
  v_n     int;
begin
  v_setup := challenge_setup_for(p_game_id);
  if not may_manage_game(p_game_id) then
    raise exception 'Only an organiser of this event may start it';
  end if;

  select * into v_game from games where id = p_game_id;
  if v_game.status <> 'setup' then
    raise exception 'The event is % — it can only be started before it runs', v_game.status;
  end if;
  if v_game.ends_at is null or v_game.ends_at <= now() then
    raise exception 'The end time has already passed — move it first';
  end if;

  -- Kept for the button and skipped by the clock. A person pressing Start on
  -- an empty event has almost certainly pressed it too early; a clock reaching
  -- the start time has not.
  select count(*) into v_n from challenge_entries where game_id = p_game_id;
  if v_n < 1 then raise exception 'Nobody has signed up yet'; end if;

  if not v_setup.solo then
    select count(*) into v_n from challenge_entries
     where game_id = p_game_id and team_id is null;
    if v_n > 0 then
      raise exception '% entrant(s) are not on a team yet', v_n;
    end if;
  end if;

  perform challenge_do_start(p_game_id, auth.uid());

  -- Last, and deliberately: the competition is created from exactly the people
  -- who are in at the moment sign-ups close. It is queued, not sent, so a WOM
  -- outage cannot stop an event starting.
  if v_setup.wom_metric is not null then
    perform challenge_wom_create(p_game_id);
  end if;
end;
$fn$;

create or replace function challenge_end(p_game_id uuid)
returns uuid
language plpgsql
security definer set search_path = public as $fn$
declare
  v_game  games%rowtype;
  v_setup challenge_setup%rowtype;
  v_wom   challenge_wom%rowtype;
begin
  v_setup := challenge_setup_for(p_game_id);
  if not may_manage_game(p_game_id) then raise exception 'Not your game'; end if;

  select * into v_game from games where id = p_game_id;
  if v_game.status <> 'active' then
    raise exception 'The event is % — it is not running', v_game.status;
  end if;

  -- A ladder scored from the hiscores must not be settled on numbers nobody
  -- has refreshed. Refusing here costs a click; not refusing crowns the wrong
  -- person and there is no way to tell afterwards.
  if v_setup.ranked_by = 'wom' then
    select * into v_wom from challenge_wom where game_id = p_game_id;
    if not found then
      raise exception 'This event has no Wise Old Man competition yet — it cannot be scored';
    end if;
    if v_wom.fetched_at is null or v_wom.fetched_at < now() - interval '15 minutes' then
      raise exception 'The standings are out of date — refresh them, then end the event';
    end if;
  end if;

  return challenge_do_end(p_game_id);
end;
$fn$;

-- ============================================================
-- 3. The clock
-- ============================================================

create or replace function challenge_tick(p_game_id uuid)
returns text
language plpgsql
security definer set search_path = public as $fn$
declare
  v_game  games%rowtype;
  v_setup challenge_setup%rowtype;
  v_wom   challenge_wom%rowtype;
  v_names boolean := false;
begin
  -- Locked rather than read, because every open browser is calling this. The
  -- second caller waits here and then reads a row that has already moved on,
  -- so the work below happens once however many people are watching.
  select * into v_game from games
   where id = p_game_id and mode = 'challenge' for update;
  if not found then return null; end if;

  select * into v_setup from challenge_setup where game_id = p_game_id;
  if not found then return null; end if;

  -- Whether `challenge_wom_create` would have anybody to send, asked the same
  -- way it asks: the entries' own names plus the account rows behind them. It
  -- raises on an empty set, and this is the only thing standing between a
  -- scheduled start and a rolled-back transaction.
  if v_setup.wom_metric is not null then
    v_names := exists (select 1 from challenge_entries
                        where game_id = p_game_id and rsn is not null)
            or exists (select 1 from challenge_entry_accounts a
                        join challenge_entries e on e.id = a.entry_id
                        where e.game_id = p_game_id);
  end if;

  if v_game.status = 'setup' then
    if v_game.starts_at is null or now() < v_game.starts_at then return null; end if;

    -- Both times gone by: the event was created and forgotten, and starting a
    -- window that has already closed would only produce an empty ladder to
    -- settle. Left in setup for a person to move or delete.
    if v_game.ends_at is not null and v_game.ends_at <= now() then return null; end if;

    perform challenge_do_start(p_game_id, null);

    if v_setup.wom_metric is not null and v_names then
      perform challenge_wom_create(p_game_id);
    end if;
    return 'started';
  end if;

  if v_game.status <> 'active' then return null; end if;

  -- An event that opened before anybody had given a name needs its competition
  -- made the moment somebody does, or `challenge_wom_add` has nothing to add
  -- people to and the week scores nothing.
  --
  -- ASKED AT MOST ONCE, and the log is what says so rather than the
  -- `challenge_wom` row: the request is queued, and the row only appears when
  -- `challenge_reconcile` reads the reply a minute later. Between those two
  -- moments `challenge_wom_create`'s own guard sees nothing, so a tick on the
  -- `challenge_wom` row alone would ask WOM for a second competition -- a
  -- duplicate on somebody else's service, made by a clock. A create that was
  -- logged and then failed is `admin_challenge_wom_retry`'s to repeat, with a
  -- person deciding.
  if v_setup.wom_metric is not null and v_names
     and not exists (select 1 from challenge_wom where game_id = p_game_id)
     and not exists (select 1 from challenge_fetch_log
                      where game_id = p_game_id and purpose = 'create') then
    perform challenge_wom_create(p_game_id);
    return 'competition';
  end if;

  if v_game.ends_at is null or now() < v_game.ends_at then return null; end if;

  if v_setup.ranked_by = 'wom' then
    -- Whatever the last fetch brought back, written down before we judge how
    -- old the figures are.
    perform challenge_reconcile(p_game_id);

    select * into v_wom from challenge_wom where game_id = p_game_id;
    if not found then
      -- Ranked on a competition that was never created. Ending now would crown
      -- somebody on nothing, so this one waits for an organiser.
      return 'unscored';
    end if;

    if v_wom.fetched_at is null or v_wom.fetched_at < now() - interval '15 minutes' then
      perform challenge_fetch(p_game_id);
      return 'ending';
    end if;
  end if;

  perform challenge_do_end(p_game_id);
  return 'ended';
end;
$fn$;

revoke execute on function challenge_tick(uuid) from public, anon;
grant execute on function challenge_tick(uuid) to authenticated;

-- ============================================================
-- 4. Creating one, with both ends of the window
-- ============================================================
--
-- Dropped and recreated rather than replaced: `create or replace` cannot
-- change an argument list, and adding a defaulted parameter would leave the
-- old function in place as an overload that PostgREST could pick instead.
-- Carried forward from 20261026130100, which is where the newest copy lives.

drop function if exists admin_new_challenge(text, timestamptz, boolean, text, text, text, text, text[], boolean);

create or replace function admin_new_challenge(
  p_name           text,
  p_starts_at      timestamptz,
  p_ends_at        timestamptz,
  p_solo           boolean     default true,
  p_wom_metric     text        default null,
  p_declared_label text        default null,
  p_declared_unit  text        default null,
  p_ranked_by      text        default null,
  p_teams          text[]      default '{}',
  p_all_accounts   boolean     default false)
returns uuid
language plpgsql
security definer set search_path = public as $fn$
declare
  v_game_id uuid;
  v_names   text[];
  v_ranked  text;
  v_i       int;
begin
  if not may_run_mode('challenge') then raise exception 'Not a mode you run'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'The event needs a name'; end if;
  if p_starts_at is null then raise exception 'The event needs a start time'; end if;
  if p_ends_at is null then raise exception 'The event needs an end time'; end if;
  if p_ends_at <= now() then raise exception 'The end time is in the past'; end if;
  if p_ends_at <= p_starts_at then
    raise exception 'The end time has to be after the start time';
  end if;
  -- A start time in the past is allowed, and means the event is due now: the
  -- first tick opens it. Refusing it would make "run this straight away" the
  -- one thing the form could not say.

  if coalesce(btrim(p_wom_metric), '') = '' and coalesce(btrim(p_declared_label), '') = '' then
    raise exception 'An event needs something to score: a Wise Old Man metric, a number for players to give, or both';
  end if;

  -- Counting every account is a statement about the hiscores figure, and an
  -- event with no hiscores figure has nothing for it to be about. Refused
  -- rather than ignored: a setting that silently does nothing is worse than
  -- one that says it cannot.
  if p_all_accounts and coalesce(btrim(p_wom_metric), '') = '' then
    raise exception 'Counting every account only means something for a Wise Old Man figure, and this event has none';
  end if;

  v_ranked := nullif(btrim(coalesce(p_ranked_by, '')), '');
  if v_ranked is null then
    if coalesce(btrim(p_wom_metric), '') <> '' and coalesce(btrim(p_declared_label), '') <> '' then
      raise exception 'This event collects two figures, so it needs to say which one ranks';
    end if;
    v_ranked := case when coalesce(btrim(p_wom_metric), '') <> '' then 'wom' else 'declared' end;
  end if;

  select coalesce(array_agg(btrim(n) order by ord), '{}')
    into v_names
    from unnest(coalesce(p_teams, '{}'::text[])) with ordinality as u(n, ord)
   where btrim(coalesce(n, '')) <> '';

  if p_solo and coalesce(array_length(v_names, 1), 0) > 0 then
    raise exception 'A solo event ranks people, so it takes no teams';
  end if;
  if not p_solo and coalesce(array_length(v_names, 1), 0) < 1 then
    raise exception 'A team event needs at least one team';
  end if;
  if (select count(distinct lower(u.n)) from unnest(v_names) as u(n))
     <> coalesce(array_length(v_names, 1), 0) then
    raise exception 'Every team needs a different name';
  end if;

  insert into games (name, mode, status, max_active_tiles, starts_at, ends_at)
  values (btrim(p_name), 'challenge', 'setup', 1, p_starts_at, p_ends_at)
  returning id into v_game_id;

  insert into challenge_setup (game_id, solo, wom_metric, declared_label, declared_unit,
                               ranked_by, all_accounts)
  values (v_game_id, p_solo,
          nullif(btrim(coalesce(p_wom_metric, '')), ''),
          nullif(btrim(coalesce(p_declared_label, '')), ''),
          nullif(btrim(coalesce(p_declared_unit, '')), ''),
          v_ranked, coalesce(p_all_accounts, false));

  for v_i in 1 .. coalesce(array_length(v_names, 1), 0) loop
    insert into teams (game_id, name, slot) values (v_game_id, v_names[v_i], v_i);
  end loop;

  return v_game_id;
end;
$fn$;

revoke execute on function admin_new_challenge(text, timestamptz, timestamptz, boolean, text, text, text, text, text[], boolean)
  from public, anon;
grant execute on function admin_new_challenge(text, timestamptz, timestamptz, boolean, text, text, text, text, text[], boolean)
  to authenticated;

-- ============================================================
-- 5. The events that were already made
-- ============================================================
-- Nothing is backfilled, deliberately.
--
-- Every challenge created before this migration has no start time, and the
-- tempting thing is to give the ones still in setup a start a minute out so the
-- clock sweeps them up. It would also open them, which creates a competition on
-- Wise Old Man -- a change on somebody else's service, made by a migration, for
-- an event whose organiser has not asked for it yet.
--
-- So they stay as they are: `starts_at` null, no clock, and the Start event
-- button they have always had. The console shows a start time field for an
-- event waiting in setup, so giving one a schedule is a single edit.

-- (no data change)
