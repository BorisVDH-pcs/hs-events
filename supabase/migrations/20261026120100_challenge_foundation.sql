-- Challenge: the fifth game mode. The tables, and nothing that uses them.
--
-- A challenge is a short event with no board: a start, an end, one figure per
-- entrant, and a ladder. docs/challenge-mode.md has the rules and why each of
-- the decisions below went the way it did.
--
-- THIS MIGRATION CHANGES NO SHARED FUNCTION. admin_new_game, start_game,
-- admin_end_game, board_for_me, admin_game_readiness and discord_line all
-- behave exactly as they did before it, so a challenge cannot yet be created
-- and nothing an organiser or a player does today takes a different path.
-- That is deliberate, and it is how 20261025120000_moderator_role.sql landed:
-- one migration that can be applied and read before anything depends on it.
--
-- Who may run one needs nothing here. may_run_mode('challenge') works the
-- moment 20261026120000 adds the enum value, because the moderator gates are
-- generic over game_mode.
--
-- Every table below has RLS on and NO POLICIES, and every grant is revoked
-- from anon and authenticated. Reads come in the next migration, as the
-- security definer RPCs the rest of this project already uses. A table nobody
-- can reach is the safe state to leave a half-built mode in.

-- ============================================================
-- 1. The setup: what kind of challenge this is
-- ============================================================
-- Its own table rather than more columns on `games`, which every other mode
-- shares. Territory did the same for the same reason: a mode's own shape
-- belongs to that mode.
--
-- grid_size is left at its default and means nothing here. It is `not null` on
-- the shared table and no challenge reads it; widening a constraint for a mode
-- with no board would be worse than ignoring the column.

create table challenge_setup (
  game_id        uuid    primary key references games(id) on delete cascade,

  -- Individuals or teams, picked per event. A team's figure is the sum of its
  -- members', which is what a clan event normally means and what Wise Old
  -- Man's own team competitions do.
  solo           boolean not null default true,

  -- The Wise Old Man side. Null when the event has no tracked figure.
  -- The metric is WOM's own string ('zulrah', 'clue_scrolls_master',
  -- 'theatre_of_blood', 'slayer'); it is not checked here, because the list is
  -- theirs and changes when they add a boss. A wrong one fails at creation,
  -- when WOM refuses the competition, not silently at the end of a week.
  wom_metric     text,

  -- The declared side. Null when the event has no number for a player to give.
  -- The organiser names it: 'Total loot', 'Points', 'Kills'.
  declared_label text,
  declared_unit  text,

  -- Which of the two decides the winner. The other is still collected and
  -- still shown in its own column -- it just does not rank. One ladder, one
  -- winner, as agreed.
  ranked_by      text    not null,

  created_at     timestamptz not null default now(),

  constraint challenge_setup_unit_check
    check (declared_unit is null or declared_unit in ('gp', 'count')),

  -- A declared figure needs both halves or neither: a label with no unit has
  -- no way to be formatted, and a unit with no label has nothing to call it.
  constraint challenge_setup_declared_check
    check ((declared_label is null) = (declared_unit is null)),

  constraint challenge_setup_ranked_by_check
    check (ranked_by in ('wom', 'declared')),

  -- The figure that ranks must be one the event actually collects. Without
  -- this an organiser can create an event whose ladder is every entrant on
  -- null, and only find out at the end of it.
  constraint challenge_setup_ranked_by_exists_check
    check ((ranked_by = 'wom'      and wom_metric     is not null)
        or (ranked_by = 'declared' and declared_label is not null))
);

comment on table challenge_setup is
  'One row per challenge game: solo or teams, which figures it collects, and which of them ranks.';
comment on column challenge_setup.wom_metric is
  'Wise Old Man metric string, theirs not ours. Null = no tracked figure.';
comment on column challenge_setup.declared_unit is
  'gp (stored in TENTHS OF A MILLION, as lib/millions.js) or count (a plain integer).';

alter table challenge_setup enable row level security;
revoke all on challenge_setup from anon, authenticated;

-- A setup row for a battleships game would be nonsense that only showed up as
-- an empty ladder weeks later. enforce_two_teams is the precedent: the shared
-- tables guard their own mode rules with a trigger.
create or replace function enforce_challenge_game()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if (select mode from games where id = new.game_id) <> 'challenge' then
    raise exception 'Game % is not a challenge', new.game_id;
  end if;
  return new;
end;
$fn$;

create trigger challenge_setup_is_a_challenge
  before insert or update on challenge_setup
  for each row execute function enforce_challenge_game();

-- ============================================================
-- 2. The entries: who is in, and what they scored
-- ============================================================
-- Opt in per event. No row, no ladder entry -- which keeps the board off the
-- people who never played, and keeps the WOM competition small enough to stay
-- inside its update limits.

create table challenge_entries (
  id          uuid        primary key default gen_random_uuid(),
  game_id     uuid        not null references games(id) on delete cascade,
  profile_id  uuid        not null references profiles(id) on delete cascade,

  -- Null in a solo challenge. In a team one it is the team whose total this
  -- entry adds to, and it is one of this game's existing `teams` rows, so
  -- admin_add_team and the team-private feed work unchanged.
  team_id     uuid        references teams(id) on delete set null,

  -- THE RSN IS SNAPSHOTTED, not read through to profiles. Wise Old Man matches
  -- on the exact username, and profiles.rsn is typed by the player at sign-up
  -- and has never been checked against anything. Tidying a profile months later
  -- must not quietly change what a finished ladder was scored on.
  rsn         text,

  -- What WOM said, straight from the competition's participations. Start and
  -- end are kept beside the gain so a player can see where their week went,
  -- and so a figure that looks wrong can be argued about with the numbers
  -- behind it.
  wom_start   bigint,
  wom_end     bigint,
  wom_gained  bigint,

  -- The number the player gave. gp is tenths of a million (lib/millions.js);
  -- count is a plain integer. bigint, not the smallint a value tile uses --
  -- that caps at 1000m and a week of raids passes it.
  declared    bigint,
  declared_at timestamptz,

  -- Who the number currently belongs to. Null while it is the player's own.
  -- Set when an organiser alters it, so a ladder can always say whose figure
  -- it is showing rather than presenting an edited number as the player's.
  altered_by  uuid        references profiles(id) on delete set null,
  altered_at  timestamptz,

  -- An organiser has looked at the evidence and is happy with the number.
  verified_by uuid        references profiles(id) on delete set null,
  verified_at timestamptz,

  joined_at   timestamptz not null default now(),

  unique (game_id, profile_id),

  constraint challenge_entries_declared_check
    check (declared is null or declared >= 0)
);

comment on table challenge_entries is
  'One row per person in a challenge. Opt-in: no row means no ladder entry.';
comment on column challenge_entries.rsn is
  'The RSN as it was at sign-up, not a read-through to profiles. WOM matches on it exactly.';
comment on column challenge_entries.declared is
  'The player''s own number: tenths of a million for gp, a plain integer for count.';
comment on column challenge_entries.altered_by is
  'The organiser who last changed the number. Null = still the player''s own figure.';

create index idx_challenge_entries_game on challenge_entries(game_id);
create index idx_challenge_entries_team on challenge_entries(team_id) where team_id is not null;

alter table challenge_entries enable row level security;
revoke all on challenge_entries from anon, authenticated;

create trigger challenge_entries_is_a_challenge
  before insert or update on challenge_entries
  for each row execute function enforce_challenge_game();

-- ============================================================
-- 3. The evidence behind a declared number
-- ============================================================
-- Its own table, not tile_evidence. That hangs off tile_claims, which hangs off
-- tiles, and a challenge has no board -- inventing a fake tile to hold a
-- screenshot is the kind of thing architecture.md warns about.
--
-- Two phases, because the figure is a difference: what the loot tracker said at
-- the start and what it said at the finish. The site cannot read either, which
-- is exactly why the number is typed and the pictures are kept.

create table challenge_evidence (
  id       uuid        primary key default gen_random_uuid(),
  entry_id uuid        not null references challenge_entries(id) on delete cascade,
  phase    text        not null,
  url      text        not null,
  note     text,
  added_at timestamptz not null default now(),

  constraint challenge_evidence_phase_check
    check (phase in ('start', 'finish'))
);

comment on table challenge_evidence is
  'Screenshots behind a declared figure: one set at the start, one at the finish.';

create index idx_challenge_evidence_entry on challenge_evidence(entry_id);

alter table challenge_evidence enable row level security;
revoke all on challenge_evidence from anon, authenticated;

-- ============================================================
-- 4. The Wise Old Man competition
-- ============================================================
-- THE VERIFICATION CODE IS A CREDENTIAL. Anyone holding it can edit or delete
-- the competition, so this table is arranged exactly as discord_webhooks is:
-- RLS on, no policies at all, so anon and authenticated get nothing and only a
-- definer function or the service role can read it. It must never become a
-- VITE_ variable -- Vite inlines those into the public bundle.

create table challenge_wom (
  game_id           uuid        primary key references games(id) on delete cascade,
  competition_id    bigint      not null,
  verification_code text        not null,

  -- When the standings were last written. The rate limit lives here: a room
  -- full of open browsers must cost one fetch, not thirty. WOM allows 20
  -- requests a minute without an API key.
  fetched_at        timestamptz,

  created_at        timestamptz not null default now()
);

comment on table challenge_wom is
  'The WOM competition behind a challenge. CREDENTIALS: RLS on with no policies, so no client can read this.';

alter table challenge_wom enable row level security;
revoke all on challenge_wom from anon, authenticated;

create trigger challenge_wom_is_a_challenge
  before insert or update on challenge_wom
  for each row execute function enforce_challenge_game();

-- ============================================================
-- 5. The fetch log
-- ============================================================
-- pg_net is fire-and-forget: net.http_get queues a request and answers with an
-- id, and the reply turns up later in net._http_response. Reading WOM therefore
-- takes two phases, and this table is what joins them -- the same arrangement
-- discord_relay_log uses to find out what Discord did with a message.
--
-- There is no pg_cron on this project, so nothing here fires on its own. The
-- next migration adds challenge_fetch() and challenge_reconcile(), and any
-- client calls them, idempotently, the way bingo's timer already works.
--
-- Two kinds of request end up here, because CREATING the competition is as
-- asynchronous as reading it: the id and the verification code only come back
-- in the reply. `purpose` is how one reconcile pass tells them apart.

create table challenge_fetch_log (
  request_id bigint      primary key,
  game_id    uuid        not null references games(id) on delete cascade,
  purpose    text        not null,
  created_at timestamptz not null default now(),

  -- When the reply was read and acted on. Null means still in flight, or
  -- never answered -- pg_net gives up quietly, and a row that stays null is
  -- how that shows. Reconcile only looks at null rows, so it is idempotent
  -- however many times a client calls it.
  handled_at timestamptz,

  constraint challenge_fetch_log_purpose_check
    check (purpose in ('create', 'fetch'))
);

comment on table challenge_fetch_log is
  'pg_net request id -> the challenge it was for, and whether it was creating the competition or reading it.';

create index idx_challenge_fetch_log_game on challenge_fetch_log(game_id, created_at desc);

alter table challenge_fetch_log enable row level security;
revoke all on challenge_fetch_log from anon, authenticated;
