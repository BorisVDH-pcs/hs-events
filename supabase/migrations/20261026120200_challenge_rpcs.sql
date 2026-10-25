-- Challenge: the functions. Creating one, entering it, scoring it, ending it,
-- and reading Wise Old Man.
--
-- 20261026120100 added the tables and deliberately wired nothing to them. This
-- is the wiring. docs/challenge-mode.md has the rules.
--
-- ============================================================
-- WHY THE SHARED FUNCTIONS ARE PATCHED AND NOT REWRITTEN
-- ============================================================
-- The bingo, snakes and territory migrations each added their mode by copying
-- a shared function's latest definition out of the ledger and re-emitting it
-- with their lines added. That is not safe any more.
--
-- 20261025130000 swapped the guard on 44 functions AT RUNTIME, with
-- pg_get_functiondef and regexp_replace. The ledger never saw those edits. So
-- the newest `admin_new_game` in the migration files still reads
-- `if not is_admin()`, while the one in the database reads
-- `if not may_run_mode(p_mode)` -- and re-emitting the ledger's copy would
-- quietly hand every moderator's permission back to admins only.
--
-- Five shared functions are touched here, and every one of them is patched the
-- way the sweep patched its own: read the LIVE definition, change the one
-- fragment, assert the fragment matched exactly once, and put it back. The
-- guard, whatever it now says, is carried through untouched because nothing
-- here looks at it.
--
-- admin_game_readiness goes further and is a free integrity check: its anchor
-- is `where may_manage_game(g.id)`, which only exists because the sweep put it
-- there. If this migration ever runs against a database the sweep has not
-- reached, that pattern matches zero times and the whole thing aborts rather
-- than half-applying.

-- ============================================================
-- 1. Helpers
-- ============================================================

-- Two spellings of the same RuneScape name. WOM answers with a normalised
-- `username` ("zezima") beside the `displayName` a player would recognise
-- ("Zezima"), and OSRS treats a space and an underscore as the same character.
-- Ours is whatever the player typed into the sign-up box, so neither side can
-- be trusted to match the other exactly.
create or replace function challenge_rsn_key(p_name text)
returns text
language sql immutable
set search_path = public as $fn$
  select nullif(lower(btrim(regexp_replace(coalesce(p_name, ''), '[_\s]+', ' ', 'g'))), '');
$fn$;

-- The setup row, with a clear refusal rather than a null-pointer trail through
-- whichever function asked.
create or replace function challenge_setup_for(p_game_id uuid)
returns challenge_setup
language plpgsql stable
security definer set search_path = public as $fn$
declare
  v_mode  game_mode;
  v_setup challenge_setup%rowtype;
begin
  select mode into v_mode from games where id = p_game_id;
  if not found then raise exception 'No such game'; end if;
  if v_mode <> 'challenge' then raise exception 'That game is not a challenge'; end if;

  select * into v_setup from challenge_setup where game_id = p_game_id;
  if not found then raise exception 'This challenge has no setup row'; end if;
  return v_setup;
end;
$fn$;

-- ============================================================
-- 2. Creating one
-- ============================================================
-- Its own function rather than a branch of admin_new_game, which has no room
-- for a metric, a label, a unit or a ranking. admin_new_game is taught to
-- refuse 'challenge' and point here instead, in section 9.

create or replace function admin_new_challenge(
  p_name           text,
  p_ends_at        timestamptz,
  p_solo           boolean     default true,
  p_wom_metric     text        default null,
  p_declared_label text        default null,
  p_declared_unit  text        default null,
  p_ranked_by      text        default null,
  p_teams          text[]      default '{}')
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
  if p_ends_at is null then raise exception 'The event needs an end time'; end if;
  if p_ends_at <= now() then raise exception 'The end time is in the past'; end if;

  if coalesce(btrim(p_wom_metric), '') = '' and coalesce(btrim(p_declared_label), '') = '' then
    raise exception 'An event needs something to score: a Wise Old Man metric, a number for players to give, or both';
  end if;

  -- With only one figure there is nothing to choose between, so the ranking is
  -- allowed to go unsaid. With two it is the whole question and the organiser
  -- has to answer it.
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

  insert into games (name, mode, status, max_active_tiles, ends_at)
  values (btrim(p_name), 'challenge', 'setup', 1, p_ends_at)
  returning id into v_game_id;

  -- The check constraints on challenge_setup are the real validation: a
  -- ranking with no figure behind it, or a label with no unit, is refused
  -- there and takes the whole insert with it.
  insert into challenge_setup (game_id, solo, wom_metric, declared_label, declared_unit, ranked_by)
  values (v_game_id, p_solo,
          nullif(btrim(coalesce(p_wom_metric, '')), ''),
          nullif(btrim(coalesce(p_declared_label, '')), ''),
          nullif(btrim(coalesce(p_declared_unit, '')), ''),
          v_ranked);

  for v_i in 1 .. coalesce(array_length(v_names, 1), 0) loop
    insert into teams (game_id, name, slot) values (v_game_id, v_names[v_i], v_i);
  end loop;

  return v_game_id;
end;
$fn$;

-- ============================================================
-- 3. Entering
-- ============================================================

-- JOINING CLOSES WHEN THE EVENT STARTS, and that is a limitation, not a rule
-- anyone wanted. The WOM competition is created at the start from exactly the
-- people who joined, so a latecomer would be on our ladder and not on WOM's,
-- scoring zero for a week they actually played. WOM has an add-participants
-- endpoint and a later migration should use it; until then the honest thing is
-- to refuse clearly rather than enter someone who cannot score.
create or replace function challenge_join(p_game_id uuid, p_rsn text default null)
returns uuid
language plpgsql
security definer set search_path = public as $fn$
declare
  v_game  games%rowtype;
  v_setup challenge_setup%rowtype;
  v_rsn   text;
  v_id    uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  v_setup := challenge_setup_for(p_game_id);
  select * into v_game from games where id = p_game_id;

  if v_game.status <> 'setup' then
    raise exception 'Sign-ups for this event closed when it started';
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
  on conflict (game_id, profile_id) do update set rsn = excluded.rsn
  returning id into v_id;

  return v_id;
end;
$fn$;

create or replace function challenge_leave(p_game_id uuid)
returns void
language plpgsql
security definer set search_path = public as $fn$
declare
  v_status game_status;
begin
  perform challenge_setup_for(p_game_id);
  select status into v_status from games where id = p_game_id;
  if v_status <> 'setup' then
    raise exception 'The event has started — ask an organiser to take you out';
  end if;
  delete from challenge_entries where game_id = p_game_id and profile_id = auth.uid();
end;
$fn$;

-- Which team an entrant plays for. The organiser's job: a player picking their
-- own team would let them move to whichever one is winning.
create or replace function admin_challenge_set_team(p_entry_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer set search_path = public as $fn$
declare
  v_game_id uuid;
begin
  select game_id into v_game_id from challenge_entries where id = p_entry_id;
  if not found then raise exception 'No such entry'; end if;
  if not may_manage_game(v_game_id) then raise exception 'Not your game'; end if;

  if p_team_id is not null
     and not exists (select 1 from teams where id = p_team_id and game_id = v_game_id) then
    raise exception 'That team is not in this event';
  end if;

  update challenge_entries set team_id = p_team_id where id = p_entry_id;
end;
$fn$;

-- ============================================================
-- 4. The declared figure, and the evidence under it
-- ============================================================

-- The largest number either unit will take. gp is tenths of a million, so this
-- is 100,000m; count is a plain integer. Not a guess at what is reasonable --
-- a ceiling, so a slipped keyboard cannot put 9 999 999 999 at the top of a
-- ladder and leave an organiser hunting for it.
create or replace function challenge_max_figure() returns bigint
language sql immutable as $fn$ select 1000000000::bigint $fn$;

create or replace function challenge_declare(p_game_id uuid, p_amount bigint)
returns void
language plpgsql
security definer set search_path = public as $fn$
declare
  v_game  games%rowtype;
  v_setup challenge_setup%rowtype;
  v_entry challenge_entries%rowtype;
begin
  v_setup := challenge_setup_for(p_game_id);
  select * into v_game from games where id = p_game_id;

  if v_setup.declared_label is null then
    raise exception 'This event has no number to give — it is scored from the hiscores';
  end if;
  if v_game.status <> 'active' then
    raise exception 'The event is % — nothing can be submitted', v_game.status;
  end if;
  -- The timer is enforced by refusal, as bingo's is: there is no scheduler to
  -- close anything, so the close is a function that says no.
  if v_game.ends_at is not null and now() >= v_game.ends_at then
    raise exception 'The event is over — submissions closed';
  end if;
  if p_amount is null or p_amount < 0 then raise exception 'That is not an amount'; end if;
  if p_amount > challenge_max_figure() then raise exception 'That amount is too large'; end if;

  select * into v_entry from challenge_entries
   where game_id = p_game_id and profile_id = auth.uid();
  if not found then raise exception 'You are not in this event'; end if;

  -- Once an organiser has checked it, it stops being the player's to change.
  -- Otherwise a verified figure could be edited back afterwards and nothing
  -- would say so.
  if v_entry.verified_at is not null then
    raise exception 'An organiser has already checked your number — ask them to change it';
  end if;

  update challenge_entries
     set declared = p_amount, declared_at = now(),
         -- Their own number again, whatever an organiser had put there.
         altered_by = null, altered_at = null
   where id = v_entry.id;

  insert into game_events (game_id, team_id, type, payload)
  values (p_game_id, v_entry.team_id, 'challenge_declared',
          jsonb_build_object(
            'entry_id', v_entry.id,
            'by', auth.uid(),
            'by_name', (select display_name from profiles where id = auth.uid()),
            'amount', p_amount,
            'label', v_setup.declared_label,
            'unit', v_setup.declared_unit));
end;
$fn$;

-- At most this many screenshots per phase. A loot tracker needs one picture;
-- the allowance is for the second try when the first was cropped wrong.
create or replace function challenge_max_evidence() returns int
language sql immutable as $fn$ select 5 $fn$;

create or replace function challenge_add_evidence(
  p_game_id uuid, p_phase text, p_url text, p_note text default null)
returns uuid
language plpgsql
security definer set search_path = public as $fn$
declare
  v_game  games%rowtype;
  v_setup challenge_setup%rowtype;
  v_entry challenge_entries%rowtype;
  v_n     int;
  v_id    uuid;
begin
  v_setup := challenge_setup_for(p_game_id);
  select * into v_game from games where id = p_game_id;

  if v_setup.declared_label is null then
    raise exception 'This event has nothing to prove — it is scored from the hiscores';
  end if;
  if p_phase not in ('start', 'finish') then
    raise exception 'A shot is either the start or the finish';
  end if;
  if coalesce(btrim(p_url), '') = '' then raise exception 'That is not a picture'; end if;
  if v_game.status <> 'active' then
    raise exception 'The event is % — nothing can be submitted', v_game.status;
  end if;
  if v_game.ends_at is not null and now() >= v_game.ends_at then
    raise exception 'The event is over — submissions closed';
  end if;

  select * into v_entry from challenge_entries
   where game_id = p_game_id and profile_id = auth.uid();
  if not found then raise exception 'You are not in this event'; end if;

  select count(*) into v_n from challenge_evidence
   where entry_id = v_entry.id and phase = p_phase;
  if v_n >= challenge_max_evidence() then
    raise exception 'That is enough % shots', p_phase;
  end if;

  insert into challenge_evidence (entry_id, phase, url, note)
  values (v_entry.id, p_phase, btrim(p_url), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  return v_id;
end;
$fn$;

-- ============================================================
-- 5. Reading it back
-- ============================================================

-- The entrant's own corner: their figures, their shots, and whether anyone has
-- been at the number.
create or replace function challenge_mine(p_game_id uuid)
returns jsonb
language plpgsql stable
security definer set search_path = public as $fn$
declare
  v_entry challenge_entries%rowtype;
begin
  perform challenge_setup_for(p_game_id);
  select * into v_entry from challenge_entries
   where game_id = p_game_id and profile_id = auth.uid();
  if not found then return null; end if;

  return jsonb_build_object(
    'entry_id',    v_entry.id,
    'team_id',     v_entry.team_id,
    'rsn',         v_entry.rsn,
    'wom_start',   v_entry.wom_start,
    'wom_end',     v_entry.wom_end,
    'wom_gained',  v_entry.wom_gained,
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

-- The ladder. One row per entrant, or per team when the event runs in teams.
--
-- Both figures come back every time and `ranked` repeats whichever one decides
-- it, so a screen can show the deciding column without knowing the rules. Ties
-- break on who entered first, which makes the order stable rather than fair --
-- a draw at the top is for an organiser to settle, not a sort.
create or replace function challenge_standings(p_game_id uuid)
returns table (
  place      int,
  team_id    uuid,
  profile_id uuid,
  name       text,
  ranked     bigint,
  wom_gained bigint,
  declared   bigint,
  entrants   int)
language plpgsql stable
security definer set search_path = public as $fn$
declare
  v_game  games%rowtype;
  v_setup challenge_setup%rowtype;
begin
  v_setup := challenge_setup_for(p_game_id);
  select * into v_game from games where id = p_game_id;

  -- Nothing to show before it runs, and nothing to give away either: who has
  -- signed up is the organiser's business until the start.
  if v_game.status not in ('active', 'finished') then return; end if;

  if v_setup.solo then
    return query
      with figures as (
        select e.team_id as tid, e.profile_id as pid,
               coalesce(p.display_name, 'Someone') as nm,
               coalesce(e.wom_gained, 0)::bigint   as w,
               coalesce(e.declared, 0)::bigint     as d,
               e.joined_at as j
          from challenge_entries e
          join profiles p on p.id = e.profile_id
         where e.game_id = p_game_id)
      select (row_number() over (
                order by case when v_setup.ranked_by = 'wom' then f.w else f.d end desc, f.j))::int,
             f.tid, f.pid, f.nm,
             case when v_setup.ranked_by = 'wom' then f.w else f.d end,
             f.w, f.d, 1
        from figures f
       order by 1;
  else
    return query
      with figures as (
        select t.id as tid, t.name as nm,
               coalesce(sum(e.wom_gained), 0)::bigint as w,
               coalesce(sum(e.declared), 0)::bigint   as d,
               count(e.id)::int                       as n,
               min(e.joined_at)                       as j
          from teams t
          left join challenge_entries e
                 on e.team_id = t.id and e.game_id = p_game_id
         where t.game_id = p_game_id
         group by t.id, t.name)
      select (row_number() over (
                order by case when v_setup.ranked_by = 'wom' then f.w else f.d end desc,
                         f.j nulls last))::int,
             f.tid, null::uuid, f.nm,
             case when v_setup.ranked_by = 'wom' then f.w else f.d end,
             f.w, f.d, f.n
        from figures f
       order by 1;
  end if;
end;
$fn$;

-- ============================================================
-- 6. The organiser's list
-- ============================================================
-- Everything needed to check a number against the pictures behind it, in one
-- call: the figure, who it currently belongs to, and every shot.

create or replace function admin_challenge_entries(p_game_id uuid)
returns jsonb
language plpgsql stable
security definer set search_path = public as $fn$
begin
  perform challenge_setup_for(p_game_id);
  if not may_manage_game(p_game_id) then raise exception 'Not your game'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'entry_id',    e.id,
             'profile_id',  e.profile_id,
             'name',        coalesce(p.display_name, 'Someone'),
             'rsn',         e.rsn,
             'team_id',     e.team_id,
             'team_name',   t.name,
             'wom_gained',  e.wom_gained,
             'declared',    e.declared,
             'declared_at', e.declared_at,
             'altered_by',  e.altered_by,
             'altered_by_name', ap.display_name,
             'verified_at', e.verified_at,
             'evidence',    coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', v.id, 'phase', v.phase, 'url', v.url, 'note', v.note)
                      order by v.phase desc, v.added_at)
                 from challenge_evidence v where v.entry_id = e.id), '[]'::jsonb))
           order by e.declared desc nulls last, e.joined_at)
      from challenge_entries e
      join profiles p on p.id = e.profile_id
      left join teams t on t.id = e.team_id
      left join profiles ap on ap.id = e.altered_by
     where e.game_id = p_game_id), '[]'::jsonb);
end;
$fn$;

-- Correcting a number. The old one is not kept: what is kept is that it was
-- corrected and by whom, which is what a ladder has to be able to say.
create or replace function admin_challenge_set_figure(p_entry_id uuid, p_amount bigint)
returns void
language plpgsql
security definer set search_path = public as $fn$
declare
  v_entry challenge_entries%rowtype;
  v_setup challenge_setup%rowtype;
begin
  select * into v_entry from challenge_entries where id = p_entry_id;
  if not found then raise exception 'No such entry'; end if;
  if not may_manage_game(v_entry.game_id) then raise exception 'Not your game'; end if;

  v_setup := challenge_setup_for(v_entry.game_id);
  if v_setup.declared_label is null then
    raise exception 'This event has no number to correct';
  end if;
  if p_amount is null or p_amount < 0 then raise exception 'That is not an amount'; end if;
  if p_amount > challenge_max_figure() then raise exception 'That amount is too large'; end if;

  update challenge_entries
     set declared = p_amount,
         declared_at = coalesce(declared_at, now()),
         altered_by = auth.uid(), altered_at = now()
   where id = p_entry_id;

  insert into game_events (game_id, team_id, type, payload)
  values (v_entry.game_id, v_entry.team_id, 'challenge_declared',
          jsonb_build_object(
            'entry_id', p_entry_id,
            'by', v_entry.profile_id,
            'by_name', (select display_name from profiles where id = v_entry.profile_id),
            'amount', p_amount,
            'label', v_setup.declared_label,
            'unit', v_setup.declared_unit,
            'altered_by', auth.uid(),
            'altered_by_name', (select display_name from profiles where id = auth.uid())));
end;
$fn$;

create or replace function admin_challenge_verify(p_entry_id uuid, p_ok boolean default true)
returns void
language plpgsql
security definer set search_path = public as $fn$
declare
  v_game_id uuid;
begin
  select game_id into v_game_id from challenge_entries where id = p_entry_id;
  if not found then raise exception 'No such entry'; end if;
  if not may_manage_game(v_game_id) then raise exception 'Not your game'; end if;

  update challenge_entries
     set verified_at = case when p_ok then now() end,
         verified_by = case when p_ok then auth.uid() end
   where id = p_entry_id;
end;
$fn$;

-- ============================================================
-- 7. Wise Old Man
-- ============================================================
-- pg_net is fire-and-forget: a request is queued, the transaction carries on,
-- and the reply turns up later in net._http_response. Every call out is
-- therefore two halves -- queue it, then read it -- joined by
-- challenge_fetch_log. This is the arrangement discord_relay_log already uses
-- to find out what Discord did with a message, for the same reason.
--
-- Nothing here is scheduled, because this project has no pg_cron. Any client
-- may call challenge_fetch and challenge_reconcile, both are idempotent, and
-- both are rate-limited below, so a room full of open browsers costs one
-- request and not thirty. WOM allows 20 a minute without an API key.

create or replace function challenge_wom_base() returns text
language sql immutable as $fn$ select 'https://api.wiseoldman.net/v2' $fn$;

-- Create the competition, from exactly the people who joined. Called by
-- challenge_start; the id and the verification code only exist in the reply,
-- so challenge_reconcile is what actually stores them.
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

  select coalesce(jsonb_agg(distinct e.rsn), '[]'::jsonb)
    into v_names
    from challenge_entries e
   where e.game_id = p_game_id and e.rsn is not null;

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
    headers := '{"Content-Type": "application/json"}'::jsonb
  ) into v_req;

  insert into challenge_fetch_log (request_id, game_id, purpose)
  values (v_req, p_game_id, 'create');

  return v_req;
end;
$fn$;

-- Ask for the standings. Reading a competition needs no authentication, which
-- is why this is a plain GET and why any client may set it going.
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

-- Read whatever has come back and act on it. Returns how many replies it
-- handled, so a client can tell "nothing yet" from "nothing to do".
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
    select request_id, purpose from challenge_fetch_log
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
      -- the next fetch is a fresh request, not a retry of this one.
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
    else
      -- `deltas` first: the type definitions mark the flat `progress` object
      -- deprecated, but it is still sent, so it is the fallback rather than
      -- the other way round. A single-metric competition has one delta.
      update challenge_entries e
         set wom_start  = coalesce((p.v -> 'deltas' -> 0 -> 'values' ->> 'start')::bigint,
                                   (p.v -> 'progress' ->> 'start')::bigint),
             wom_end    = coalesce((p.v -> 'deltas' -> 0 -> 'values' ->> 'end')::bigint,
                                   (p.v -> 'progress' ->> 'end')::bigint),
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
-- 8. Starting and ending
-- ============================================================

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

  select count(*) into v_n from challenge_entries where game_id = p_game_id;
  if v_n < 1 then raise exception 'Nobody has signed up yet'; end if;

  if not v_setup.solo then
    select count(*) into v_n from challenge_entries
     where game_id = p_game_id and team_id is null;
    if v_n > 0 then
      raise exception '% entrant(s) are not on a team yet', v_n;
    end if;
  end if;

  update games set status = 'active', started_at = now() where id = p_game_id;

  insert into game_events (game_id, type, payload)
  values (p_game_id, 'game_started',
          jsonb_build_object('by', auth.uid(), 'mode', 'challenge',
                             'entrants', (select count(*) from challenge_entries
                                           where game_id = p_game_id)));

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
  v_game   games%rowtype;
  v_setup  challenge_setup%rowtype;
  v_wom    challenge_wom%rowtype;
  v_top    record;
  v_reason text;
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

-- ============================================================
-- 9. The feed
-- ============================================================
-- Snakes and territory each word their own events and return null for anything
-- they do not, falling through to the shared lines. Challenge does the same,
-- and discord_line is taught to ask it in section 10.

create or replace function challenge_discord_line(p_event game_events, p_team text)
returns text
language plpgsql stable
security definer set search_path = public as $fn$
declare
  v_amount bigint := (p_event.payload ->> 'amount')::bigint;
  v_unit   text   := p_event.payload ->> 'unit';
  v_label  text   := coalesce(p_event.payload ->> 'label', 'their figure');
  v_fig    text;
begin
  -- gp is stored in tenths of a million, the unit lib/millions.js uses, so a
  -- whole number of millions reads as one rather than as "250.0m".
  v_fig := case
             when v_amount is null then '?'
             when v_unit = 'gp' and v_amount % 10 = 0 then (v_amount / 10)::text || 'm'
             when v_unit = 'gp' then trim(to_char(v_amount / 10.0, 'FM9999999990.0')) || 'm'
             else to_char(v_amount, 'FM999G999G999G999')
           end;

  return case p_event.type
    when 'challenge_declared' then
      case when p_event.payload ? 'altered_by'
           then format(':pencil: An organiser set **%s**''s %s to **%s**.',
                       coalesce(p_event.payload ->> 'by_name', p_team), v_label, v_fig)
           else format('**%s** submitted **%s** for %s.',
                       coalesce(p_event.payload ->> 'by_name', p_team), v_fig, v_label)
      end
    when 'challenge_ended' then
      format(':trophy: **%s** wins with **%s**.',
             coalesce(p_event.payload ->> 'winner_name', 'Nobody'), v_fig)
    else null
  end;
end;
$fn$;

-- ============================================================
-- 10. The five shared functions
-- ============================================================
-- Validate every pattern against the LIVE definitions first, report all the
-- failures at once, and only then change anything -- the structure
-- 20261025130000 settled on after a single missing function aborted a sweep at
-- statement 21 and left the rest unexamined.

do $patch$
declare
  r      record;
  v_def  text;
  v_n    int;
  v_proc regprocedure;
  v_bad  text[] := '{}';
begin
  create temp table challenge_patch(fn text, pat text, repl text) on commit drop;

  insert into challenge_patch (fn, pat, repl) values

    -- admin_new_game: no room for a metric, a label, a unit or a ranking, so
    -- it sends the organiser to the function that has them.
    ('admin_new_game(text, game_mode, text[], smallint, timestamptz)',
     'raise exception ''Game needs a name''; end if;',
     'raise exception ''Game needs a name''; end if; if p_mode = ''challenge'' then raise exception ''A challenge is created with admin_new_challenge, which also sets its figures''; end if;'),

    -- start_game: anchored on the row fetch, not the guard. The guard is
    -- whatever 20261025130000 made it and must stay that way.
    ('start_game(uuid)',
     'select \* into v_game from games where id = p_game_id;',
     'select * into v_game from games where id = p_game_id; if v_game.mode = ''challenge'' then raise exception ''A challenge is started with challenge_start''; end if;'),

    -- admin_end_game: this one does NOT refuse. Ending a game is one button in
    -- the console whatever the mode, so it hands over instead.
    ('admin_end_game(uuid)',
     'if v_game.mode = ''territory'' then',
     'if v_game.mode = ''challenge'' then return challenge_end(p_game_id); end if; if v_game.mode = ''territory'' then'),

    -- admin_game_readiness: a challenge has no board, so its row would read
    -- "0 of 100 tiles" forever. It is left out and answers through its own
    -- checklist instead.
    --
    -- The anchor is the sweep's own work: `where may_manage_game(g.id)` exists
    -- only because 20261025130000 put it there. On a database the sweep has
    -- not reached this matches nothing and the migration aborts, which is the
    -- correct outcome.
    ('admin_game_readiness()',
     'from games g where may_manage_game\(g\.id\);',
     'from games g where may_manage_game(g.id) and g.mode <> ''challenge'';'),

    -- discord_line: the same hand-off snakes and territory already use.
    ('discord_line(game_events)',
     '(v_line := territory_discord_line\(p_event, v_team\);\s+if v_line is not null then return v_line; end if;\s+end if;)',
     E'\\1\n  if (select g.mode = ''challenge'' from games g where g.id = p_event.game_id) then\n    v_line := challenge_discord_line(p_event, v_team);\n    if v_line is not null then return v_line; end if;\n  end if;')
    ;

  for r in select fn, pat from challenge_patch loop
    v_proc := to_regprocedure(r.fn);
    if v_proc is null then
      v_bad := v_bad || format('%s does not exist', r.fn);
    else
      select count(*) into v_n from regexp_matches(pg_get_functiondef(v_proc), r.pat, 'g');
      if v_n <> 1 then
        v_bad := v_bad || format('%s: its anchor matched %s times, expected 1', r.fn, v_n);
      end if;
    end if;
  end loop;

  if array_length(v_bad, 1) is not null then
    raise exception 'nothing patched -- %', array_to_string(v_bad, '; ');
  end if;

  for r in select fn, pat, repl from challenge_patch loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    execute regexp_replace(v_def, r.pat, r.repl);
  end loop;
end
$patch$;

-- ============================================================
-- 11. Who may call what
-- ============================================================

revoke execute on function challenge_rsn_key(text)                 from public, anon, authenticated;
revoke execute on function challenge_setup_for(uuid)               from public, anon, authenticated;
revoke execute on function challenge_wom_base()                    from public, anon, authenticated;
revoke execute on function challenge_wom_create(uuid)              from public, anon, authenticated;
revoke execute on function challenge_discord_line(game_events, text) from public, anon, authenticated;
revoke execute on function challenge_max_figure()                  from public, anon, authenticated;
revoke execute on function challenge_max_evidence()                from public, anon, authenticated;

revoke execute on function admin_new_challenge(text, timestamptz, boolean, text, text, text, text, text[]) from public, anon;
revoke execute on function challenge_join(uuid, text)              from public, anon;
revoke execute on function challenge_leave(uuid)                   from public, anon;
revoke execute on function challenge_declare(uuid, bigint)         from public, anon;
revoke execute on function challenge_add_evidence(uuid, text, text, text) from public, anon;
revoke execute on function challenge_mine(uuid)                    from public, anon;
revoke execute on function challenge_standings(uuid)               from public, anon;
revoke execute on function challenge_start(uuid)                   from public, anon;
revoke execute on function challenge_end(uuid)                     from public, anon;
revoke execute on function challenge_fetch(uuid)                   from public, anon;
revoke execute on function challenge_reconcile(uuid)               from public, anon;
revoke execute on function admin_challenge_entries(uuid)           from public, anon;
revoke execute on function admin_challenge_set_figure(uuid, bigint) from public, anon;
revoke execute on function admin_challenge_set_team(uuid, uuid)    from public, anon;
revoke execute on function admin_challenge_verify(uuid, boolean)   from public, anon;

grant execute on function admin_new_challenge(text, timestamptz, boolean, text, text, text, text, text[]) to authenticated;
grant execute on function challenge_join(uuid, text)               to authenticated;
grant execute on function challenge_leave(uuid)                    to authenticated;
grant execute on function challenge_declare(uuid, bigint)          to authenticated;
grant execute on function challenge_add_evidence(uuid, text, text, text) to authenticated;
grant execute on function challenge_mine(uuid)                     to authenticated;
grant execute on function challenge_standings(uuid)                to authenticated;
grant execute on function challenge_start(uuid)                    to authenticated;
grant execute on function challenge_end(uuid)                      to authenticated;
-- Any client may ask for and read the standings: that is how a project with no
-- scheduler refreshes anything, and neither call writes a figure of its own.
grant execute on function challenge_fetch(uuid)                    to authenticated;
grant execute on function challenge_reconcile(uuid)                to authenticated;
grant execute on function admin_challenge_entries(uuid)            to authenticated;
grant execute on function admin_challenge_set_figure(uuid, bigint) to authenticated;
grant execute on function admin_challenge_set_team(uuid, uuid)     to authenticated;
grant execute on function admin_challenge_verify(uuid, boolean)    to authenticated;
