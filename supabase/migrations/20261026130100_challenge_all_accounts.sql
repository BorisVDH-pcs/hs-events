-- ============================================================
-- Challenge: events where every account a player has counts
-- ============================================================
--
-- A weekly XP or kill-count event is scored per person, and one account per
-- person is the rule -- otherwise somebody with two can grind both and the
-- ladder stops meaning anything. That is what the schema has enforced since
-- 20261026120100, though by accident rather than by decision: challenge_entries
-- is unique on (game_id, profile_id) and holds one rsn, so there was nowhere
-- for a second account to go.
--
-- A bingo is not scored that way. We run a WOM competition alongside those
-- too, and there a player switching to an alt mid-event is normal and should
-- not cost them the drop. Which of the two an event is, is the game master's
-- call at creation: `all_accounts` on challenge_setup.
--
-- ADDITIVE ON PURPOSE. The existing single-account path is not rewritten --
-- challenge_entries.rsn, its wom_* columns and the matching in
-- challenge_reconcile stay exactly as they are, and an event with
-- all_accounts false has no rows in the new table and behaves identically,
-- line for line. Everything here hangs off a table that is empty unless an
-- organiser asked for it. Five migrations in one day went into getting the
-- single-account path right; this is not the moment to re-lay it.

-- ============================================================
-- 1. The setting
-- ============================================================

alter table challenge_setup
  add column all_accounts boolean not null default false;

comment on column challenge_setup.all_accounts is
  'False: one account per entrant, the one they pick at sign-up. True: every account on their My Account list goes on the competition and their figures are added together.';

-- ============================================================
-- 2. The accounts an entry is being scored on
-- ============================================================
--
-- Only written for an all_accounts event, and then it holds ALL of the
-- player's accounts including the primary -- not just the extras. A set that
-- is either empty or complete is one rule to hold in your head; a set that
-- means "the others, on top of the one over there" is two, and the second one
-- is where a double-count comes from.
--
-- SNAPSHOTTED, like challenge_entries.rsn and for the same reason
-- (20261026120100): WOM matches on the exact name, and a My Account list
-- tidied up in March must not change what January's ladder was scored on.

create table challenge_entry_accounts (
  id           uuid        primary key default gen_random_uuid(),
  entry_id     uuid        not null references challenge_entries(id) on delete cascade,
  rsn          text        not null,

  -- The same four figures challenge_entries carries, per account. The entry's
  -- own wom_gained becomes the sum of these (section 5).
  wom_added_at timestamptz,
  wom_found    boolean,
  wom_start    bigint,
  wom_end      bigint,
  wom_gained   bigint,

  created_at   timestamptz not null default now()
);

comment on table challenge_entry_accounts is
  'In an all_accounts event, the accounts one entry is scored on, as they were at sign-up.';

create unique index challenge_entry_accounts_one_name
  on challenge_entry_accounts (entry_id, rsn_key(rsn));

create index challenge_entry_accounts_entry_idx
  on challenge_entry_accounts (entry_id);

alter table challenge_entry_accounts enable row level security;
revoke all on challenge_entry_accounts from anon, authenticated;

-- ============================================================
-- 3. Putting the names on, and taking them off
-- ============================================================
--
-- challenge_wom_add sent the entries that WOM has not taken yet. It now sends
-- the per-account rows as well, in the same request, and logs both sets --
-- which means challenge_fetch_log needs a second column, because `entry_ids`
-- cannot say "and these three accounts of entry four".

alter table challenge_fetch_log
  add column account_ids uuid[];

comment on column challenge_fetch_log.account_ids is
  'The challenge_entry_accounts rows whose names went in this request, beside entry_ids.';

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
    headers := '{"Content-Type": "application/json"}'::jsonb
  ) into v_req;

  insert into challenge_fetch_log (request_id, game_id, purpose, entry_ids, account_ids)
  values (v_req, p_game_id, 'add', v_ids, v_accs);

  return v_req;
end;
$fn$;

revoke execute on function challenge_wom_add(uuid) from public, anon, authenticated;

-- A name is only safe to take off the competition when NOTHING is still being
-- scored on it -- not an entry, and now not another entry's account row
-- either. 20261026120600 checked the first; this adds the second.
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
    headers := '{"Content-Type": "application/json"}'::jsonb
  ) into v_req;

  insert into challenge_fetch_log (request_id, game_id, purpose)
  values (v_req, p_game_id, 'drop');

  return v_req;
end;
$fn$;

revoke execute on function challenge_wom_drop(uuid, text) from public, anon, authenticated;

-- The competition is created from the people who have joined by the start, and
-- it has to be created holding their account names too. Without this the
-- account rows would exist from sign-up, be left off the competition at the
-- start, and only get there on the first `add` after it -- which is a pulse
-- away at best, and never if nobody else joins, because challenge_wom_add
-- answers null when there is nothing new to send.
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
    headers := '{"Content-Type": "application/json"}'::jsonb
  ) into v_req;

  insert into challenge_fetch_log (request_id, game_id, purpose)
  values (v_req, p_game_id, 'create');

  return v_req;
end;
$fn$;

revoke execute on function challenge_wom_create(uuid) from public, anon, authenticated;

-- ============================================================
-- 4. Joining an all-accounts event
-- ============================================================
--
-- The entry still carries one rsn -- the primary, or whatever was typed --
-- because every screen and both ladder branches read it and because a
-- single-account event must stay exactly as it was. What changes is that an
-- all_accounts event also copies the player's My Account list onto the entry.

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
  v_gone  text;
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

  insert into challenge_entries (game_id, profile_id, rsn)
  values (p_game_id, auth.uid(), v_rsn)
  on conflict (game_id, profile_id) do update
    set rsn = excluded.rsn,
        wom_added_at = case when challenge_entries.rsn is distinct from excluded.rsn
                            then null
                            else challenge_entries.wom_added_at end,
        wom_found    = case when challenge_entries.rsn is distinct from excluded.rsn
                            then null
                            else challenge_entries.wom_found end
  returning id, wom_added_at into v_id, v_added;

  -- ---- The account rows ----
  if v_setup.all_accounts then
    -- Everything on the My Account list, plus the name on the entry, which
    -- may be a one-off the player typed into the sign-up box and never saved
    -- to their profile.
    insert into challenge_entry_accounts (entry_id, rsn)
    select v_id, n.rsn
      from (
        select a.rsn from profile_accounts a where a.profile_id = auth.uid()
        union
        select v_rsn where v_rsn is not null
      ) as n(rsn)
     where n.rsn is not null
    on conflict do nothing;

    -- An account taken off the list between sign-ups comes off the entry too,
    -- and off the competition with it. Done one at a time, because each needs
    -- its own check that nothing else is still scoring on that name.
    -- NOT EXISTS rather than NOT IN: one null anywhere in a NOT IN subquery
    -- makes the whole test null, which here would silently stop removing
    -- anything at all -- the kind of failure that looks like it worked.
    for v_gone in
      select a.rsn from challenge_entry_accounts a
       where a.entry_id = v_id
         and not exists (
               select 1 from (
                 select p.rsn from profile_accounts p where p.profile_id = auth.uid()
                 union
                 select v_rsn where v_rsn is not null) as s(x)
                where rsn_key(s.x) = rsn_key(a.rsn))
    loop
      delete from challenge_entry_accounts
       where entry_id = v_id and rsn_key(rsn) = rsn_key(v_gone);
      if v_game.status = 'active' then
        perform challenge_wom_drop(p_game_id, v_gone);
      end if;
    end loop;
  end if;

  if v_game.status = 'active' then
    -- Off with the old name first, so a competition cannot end up holding
    -- both halves of somebody's typo. challenge_wom_drop checks that nothing
    -- is still scoring on it, account rows included, so a name that is also
    -- on the player's list survives this.
    if v_old is distinct from v_rsn then
      perform challenge_wom_drop(p_game_id, v_old);
    end if;
    -- Unconditional now: the entry may be settled while a new account row is
    -- not, which the old `v_added is null` guard would have skipped.
    perform challenge_wom_add(p_game_id);
  end if;

  return v_id;
end;
$fn$;

-- ============================================================
-- 5. Reading the replies
-- ============================================================
--
-- Re-emitted whole, as every change to it has been. Two things are new, both
-- at the end and both no-ops for an event that does not use them:
--
--  * the standings update also writes the per-account rows;
--  * an all_accounts entry's wom_gained is then REPLACED by the sum of its
--    accounts. Replaced, not added to, so running reconcile twice on the same
--    reply cannot compound -- and the primary is in that sum because
--    challenge_join put it there.

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
    select request_id, purpose, entry_ids, account_ids from challenge_fetch_log
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
    if r.purpose = 'add' and not v_ok
       and (v_body ->> 'code') = 'ALL_PLAYERS_ALREADY_COMPETING' then
      v_ok := true;
      v_body := coalesce(v_body, '{}'::jsonb);
    end if;

    if not v_ok or v_body is null then
      update challenge_fetch_log set handled_at = now() where request_id = r.request_id;
      continue;
    end if;

    if r.purpose = 'create' then
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

      -- The competition is created from the entries that exist at the start,
      -- and challenge_wom_create sends their account names too, so the rows
      -- behind them are on it just the same.
      update challenge_entry_accounts a
         set wom_added_at = now()
        from challenge_entries e
       where e.id = a.entry_id
         and e.game_id = p_game_id
         and a.wom_added_at is null
         and exists (select 1 from challenge_wom w where w.game_id = p_game_id);

    elsif r.purpose = 'add' then
      -- Exactly the rows whose names went in this request. Anyone who joined
      -- while it was in flight was not in it and stays unadded, so the next
      -- pulse picks them up.
      update challenge_entries
         set wom_added_at = now()
       where id = any (coalesce(r.entry_ids, '{}'::uuid[]));

      update challenge_entry_accounts
         set wom_added_at = now()
       where id = any (coalesce(r.account_ids, '{}'::uuid[]));

    elsif r.purpose = 'drop' then
      null;   -- nothing to record; a name that would not come off is harmless

    else
      -- MINUS ONE IS NOT A SCORE. It is WOM for "this player is not ranked on
      -- the hiscores for this metric". Null is what the screen already reads
      -- as "nothing yet".
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

      -- The same reply, read again for the account rows. One extra join and
      -- nothing else: the matching, the -1 handling and the wom_found rule are
      -- the ones above, deliberately identical.
      update challenge_entry_accounts a
         set wom_start  = nullif(coalesce((p.v -> 'deltas' -> 0 -> 'values' ->> 'start')::bigint,
                                          (p.v -> 'progress' ->> 'start')::bigint), -1),
             wom_end    = nullif(coalesce((p.v -> 'deltas' -> 0 -> 'values' ->> 'end')::bigint,
                                          (p.v -> 'progress' ->> 'end')::bigint), -1),
             wom_gained = greatest(coalesce((p.v -> 'deltas' -> 0 -> 'values' ->> 'gained')::bigint,
                                            (p.v -> 'progress' ->> 'gained')::bigint), 0),
             wom_found  = ((p.v -> 'player' ->> 'updatedAt') is not null
                           and coalesce(p.v -> 'player' ->> 'status', 'active') = 'active')
        from jsonb_array_elements(coalesce(v_body -> 'participations', '[]'::jsonb)) as p(v),
             challenge_entries e
       where e.id = a.entry_id
         and e.game_id = p_game_id
         and rsn_key(a.rsn) = any (array[
               rsn_key(p.v -> 'player' ->> 'username'),
               rsn_key(p.v -> 'player' ->> 'displayName')]);

      -- And the roll-up, for an all_accounts event only. REPLACED, never
      -- added to: reconcile can run twice over one reply and must land on the
      -- same number both times.
      --
      -- wom_found on the entry becomes "is ANY of my accounts being found",
      -- because that is what the red banner on the event screen means -- you
      -- are scoring nothing. Which of several is broken is a question for My
      -- Account, which answers it per account.
      -- Correlated subqueries rather than a LATERAL beside the target: an
      -- UPDATE's target table is not in scope for the lateral items in its
      -- FROM list, so the tidier-looking join would not compile.
      update challenge_entries e
         set wom_gained = coalesce((select sum(a.wom_gained)
                                      from challenge_entry_accounts a
                                     where a.entry_id = e.id), e.wom_gained),
             wom_found  = coalesce((select bool_or(a.wom_found)
                                      from challenge_entry_accounts a
                                     where a.entry_id = e.id), e.wom_found)
       where e.game_id = p_game_id
         and exists (select 1 from challenge_setup c
                      where c.game_id = p_game_id and c.all_accounts);

      update challenge_wom set fetched_at = now() where game_id = p_game_id;
    end if;

    update challenge_fetch_log set handled_at = now() where request_id = r.request_id;
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$fn$;

-- ============================================================
-- 6. Creating one, with the setting on the form
-- ============================================================
--
-- Dropped and recreated rather than replaced: `create or replace` cannot
-- change an argument list, and adding a defaulted parameter would leave the
-- old function in place as an overload that PostgREST could pick instead.

drop function if exists admin_new_challenge(text, timestamptz, boolean, text, text, text, text, text[]);

create or replace function admin_new_challenge(
  p_name           text,
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
  if p_ends_at is null then raise exception 'The event needs an end time'; end if;
  if p_ends_at <= now() then raise exception 'The end time is in the past'; end if;

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

  insert into games (name, mode, status, max_active_tiles, ends_at)
  values (btrim(p_name), 'challenge', 'setup', 1, p_ends_at)
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

revoke execute on function admin_new_challenge(text, timestamptz, boolean, text, text, text, text, text[], boolean)
  from public, anon;
grant execute on function admin_new_challenge(text, timestamptz, boolean, text, text, text, text, text[], boolean)
  to authenticated;

-- ============================================================
-- 7. Telling the screens about it
-- ============================================================
--
-- challenge_list is what the player screen and the console both read their
-- setup from (20261026120300), so the setting has to come back through it or
-- nothing can say which kind of event this is.

create or replace function challenge_list()
returns jsonb
language plpgsql stable
security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'game_id',        g.id,
             'name',           g.name,
             'status',         g.status,
             'starts_at',      g.starts_at,
             'ends_at',        g.ends_at,
             'created_at',     g.created_at,
             'solo',           s.solo,
             'wom_metric',     s.wom_metric,
             'declared_label', s.declared_label,
             'declared_unit',  s.declared_unit,
             'ranked_by',      s.ranked_by,
             'all_accounts',   s.all_accounts,
             -- A count, never a list. Who has signed up stays the organiser's
             -- business until the event starts (challenge_standings says so
             -- and returns nothing before then); how many have is what makes
             -- a player join, and it gives nobody away.
             'entrants',       (select count(*) from challenge_entries e
                                 where e.game_id = g.id),
             'joined',         exists (select 1 from challenge_entries e
                                        where e.game_id = g.id and e.profile_id = v_uid))
           -- Open for sign-ups first, then running, then the ones just gone.
           order by case g.status when 'setup' then 0 when 'active' then 1 else 2 end,
                    g.ends_at desc nulls last, g.created_at desc)
      from games g
      join challenge_setup s on s.game_id = g.id
     where g.mode = 'challenge'
       and (
         -- Everything open or running, to everyone: a weekly event the clan
         -- cannot see is a weekly event nobody enters.
         g.status in ('setup', 'placement', 'active')
         -- Plus the recent ones this player was actually in, so a ladder can
         -- be looked at the morning after. Two weeks, then it leaves the list
         -- rather than growing it forever.
         or (exists (select 1 from challenge_entries e
                      where e.game_id = g.id and e.profile_id = v_uid)
             and coalesce(g.ended_at, g.created_at) > now() - interval '14 days')
         -- And every one an organiser runs, however old. The console needs the
         -- setup row to draw a finished event at all, and this is the only
         -- call that carries it; may_manage_game is the same gate every
         -- admin_challenge_* function uses.
         or may_manage_game(g.id)
       )), '[]'::jsonb);
end;
$fn$;

revoke execute on function challenge_list() from public, anon;
grant  execute on function challenge_list() to authenticated;

-- ============================================================
-- 8. The accounts behind one entry, for the player's own screen
-- ============================================================

create or replace function challenge_my_accounts(p_game_id uuid)
returns table (rsn text, wom_found boolean, wom_gained bigint, wom_added boolean)
language sql stable
security definer set search_path = public as $fn$
  select a.rsn, a.wom_found, a.wom_gained, a.wom_added_at is not null
    from challenge_entry_accounts a
    join challenge_entries e on e.id = a.entry_id
   where e.game_id = p_game_id
     and e.profile_id = auth.uid()
   order by a.created_at, a.id;
$fn$;

revoke execute on function challenge_my_accounts(uuid) from public, anon;
grant  execute on function challenge_my_accounts(uuid) to authenticated;

comment on function challenge_my_accounts(uuid) is
  'The accounts this player''s entry is scored on, and what WOM has said about each.';
