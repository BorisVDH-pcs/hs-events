// Supabase client. Unlike HighSocietyScape (which uses a bare fetch wrapper with
// the anon key and no sign-in), Battleships needs real per-user auth and
// Realtime, so it uses the official SDK.
//
// The anon key is safe in the browser: RLS decides what it can read, and every
// write goes through a `security definer` RPC. See docs/architecture.md.

import { createClient } from '@supabase/supabase-js';
import { actingTeam, assertWritable } from './viewOnly.js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(URL && ANON);

if (!isSupabaseConfigured) {
  console.warn(
    'Supabase is not configured. Copy .env.example to web/.env and fill in ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  );
}

// While an organiser acts for a team (lib/viewOnly.js), every database request
// names that team in `x-act-as-team`; the server reads it for organisers only.
// Database requests only (/rest/v1/): sign-in, storage and Realtime never get
// it, and nothing is added at all the rest of the time.
function actingFetch(input, init) {
  const team = actingTeam();
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (!team || !url.includes('/rest/v1/')) return fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set('x-act-as-team', team);
  return fetch(input, { ...init, headers });
}

export const supabase = isSupabaseConfigured
  ? createClient(URL, ANON, { global: { fetch: actingFetch } })
  : null;

// ---- Game API ------------------------------------------------------------
// These four are the entire write surface (see supabase/migrations/0002_rpc.sql).
// Each player action starts with assertWritable(): it throws while an organiser
// is viewing a team's screen, unless they are acting for it (lib/viewOnly.js).

export async function placeFleet(teamId, ships) {
  assertWritable();
  const { error } = await supabase.rpc('place_fleet', {
    p_team_id: teamId,
    p_ships: ships,
  });
  if (error) throw new Error(error.message);
}

export async function startGame(gameId) {
  const { error } = await supabase.rpc('start_game', { p_game_id: gameId });
  if (error) throw new Error(error.message);
}

export async function claimTile(tileId) {
  assertWritable();
  const { data, error } = await supabase.rpc('claim_tile', { p_tile_id: tileId });
  if (error) throw new Error(error.message);
  return data;
}

/** Returns 'hit' or 'miss' immediately — no polling, unlike the Sheets version. */
export async function fireTile(claimId) {
  assertWritable();
  const { data, error } = await supabase.rpc('fire_tile', { p_claim_id: claimId });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Spend one pet jar preview on a tile this team could still claim. Returns
 * `{ name, icon, pet_jar_count }` — never claim_result or anything ship-
 * related, and refuses server-side if the counter is at 0, the tile is
 * already claimed by this team, or already previewed (0039).
 */
export async function spendPetJar(tileId) {
  assertWritable();
  const { data, error } = await supabase.rpc('spend_pet_jar', { p_tile_id: tileId });
  if (error) throw new Error(error.message);
  return data;
}

// ---- Bingo (20261001120100) ------------------------------------------------

/**
 * The id of this team's progress row for a bingo tile, made on first use.
 * Bingo has no lock-in, but evidence still hangs off a claim row, and the
 * upload path needs its id before the file goes up.
 */
export async function openBingoTile(tileId) {
  assertWritable();
  const { data, error } = await supabase.rpc('bingo_open_tile', { p_tile_id: tileId });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Record the result of a bingo whose timer has run out. Harmless at any other
 * time -- it answers false and does nothing -- so every open page calls it
 * when its countdown reaches zero, and whichever lands first settles it.
 */
export async function settleBingo(gameId) {
  const { data, error } = await supabase.rpc('bingo_settle', { p_game_id: gameId });
  if (error) throw new Error(error.message);
  return data;
}

// ---- Snakes and Ladders (20261002120100) -----------------------------------

/**
 * Roll the die for my team. The server rolls it, moves the team (skips,
 * bounce, snakes) and answers with the whole move -- the same payload the
 * `team_moved` event carries.
 */
export async function snakesRoll(gameId) {
  assertWritable();
  const { data, error } = await supabase.rpc('snakes_roll', { p_game_id: gameId });
  if (error) throw new Error(error.message);
  return data;
}

/** Spend one of my team's rollbacks. Answers with the move, like snakesRoll. */
export async function snakesSpendRollback(gameId) {
  assertWritable();
  const { data, error } = await supabase.rpc('snakes_spend_rollback', { p_game_id: gameId });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * The id of my team's progress row for the tile it stands on, made on first
 * use -- the upload path needs it before the file goes up, as in bingo.
 */
export async function snakesOpenTile(gameId) {
  assertWritable();
  const { data, error } = await supabase.rpc('snakes_open_tile', { p_game_id: gameId });
  if (error) throw new Error(error.message);
  return data;
}

// ---- Territory (20261013120100) ---------------------------------------------

/**
 * Open a place for my team and answer with its claim id, for the upload path.
 * The server checks the place is linked to my land and that the team has a
 * free one of its two; opening a place again carries on where it left off.
 */
export async function territoryOpenTile(gameId, place) {
  assertWritable();
  const { data, error } = await supabase.rpc('territory_open_tile', { p_game_id: gameId, p_place: place });
  if (error) throw new Error(error.message);
  return data;
}

/** Give up a place my team has open. Its screenshots are kept. */
export async function territoryDropTile(gameId, place) {
  assertWritable();
  const { error } = await supabase.rpc('territory_drop_tile', { p_game_id: gameId, p_place: place });
  if (error) throw new Error(error.message);
}

/** Record the result once the timer has run out; harmless before, like settleBingo. */
export async function settleTerritory(gameId) {
  const { data, error } = await supabase.rpc('territory_settle', { p_game_id: gameId });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * The game modes this account may run as a moderator: empty for a player,
 * and for an admin, who outranks every mode anyway. Answers only about the
 * caller, so unlike the admin_* calls it needs no gate.
 */
export const myModeratorModes = () => rpc('my_moderator_modes');

// ---- Challenge (20261026120200, 20261026120300) -----------------------------
// A short event: a start, an end, one figure per entrant, and a ladder. No
// board, so none of the tile calls above apply to it.

/**
 * Every challenge worth showing this player: open, running, and the ones they
 * entered in the last fortnight. The only way in — challenge_setup and
 * challenge_entries are both closed to clients.
 */
export const challengeList = () => rpc('challenge_list');

/**
 * The accounts this player's entry is being scored on.
 *
 * Empty for a normal event, where the entry carries one name and that name is
 * on the entry itself. Only an all_accounts event has rows here.
 */
export const challengeMyAccounts = (gameId) =>
  rpc('challenge_my_accounts', { p_game_id: gameId });

// ---- Signing up for a board event (20261026160000) --------------------------
// The challenge's sign-up step, for the four modes that have a board. One row
// per person per event: no figure, no evidence, no ladder. Reads go through the
// RPCs because game_signups is closed to clients, as challenge_entries is.

/**
 * Every board event worth showing this player: the ones open for sign-ups, and
 * the ones they signed up for in the last fortnight. Each carries a count of
 * who is in, never a list -- who signed up stays the organiser's business.
 */
export const gameSignupList = () => rpc('game_signup_list');

/**
 * Put your hand up. The name is snapshotted from profiles.rsn at sign-up, so a
 * profile tidied up in March does not rewrite what January's roster was built
 * from.
 *
 * Closes when the event starts, unlike a challenge: a board game is played by
 * teams formed before it began, and somebody arriving afterwards has nowhere to
 * go that does not change a game already in progress. An organiser can still
 * add them to a team by hand.
 */
export async function gameSignupJoin(gameId, rsn = null) {
  assertWritable();
  return rpc('game_signup_join', { p_game_id: gameId, p_rsn: rsn });
}

/**
 * Take it down again, while it is still only a name on a list. Refused once an
 * organiser has put them on a team -- a row quietly deleted then would leave
 * somebody rostered into a game they think they are out of.
 */
export async function gameSignupLeave(gameId) {
  assertWritable();
  return rpc('game_signup_leave', { p_game_id: gameId });
}

// ---- My Account (20261026130000) --------------------------------------------
//
// NO assertWritable ON THESE. That guard is about "view as team": an organiser
// looking at a team's screen must not act for them. These four only ever touch
// the signed-in player's OWN rows — RLS pins every one of them to auth.uid() —
// so an organiser editing their own accounts while a team is open is doing
// exactly what it looks like, and blocking it would be the bug.

/** This player's declared accounts, with whatever WOM last said about each. */
export const myAccounts = () => rpc('my_accounts');

/**
 * One player's accounts, read by an organiser rather than their owner.
 *
 * The permission is as old as the table -- profile_accounts' read policy has
 * always said `is_admin() or is_moderator()` -- but nothing ever asked, so the
 * console showed one name at a time and never the list. Read only: every write
 * policy on that table is the owner's alone.
 */
export const adminProfileAccounts = (profileId) =>
  rpc('admin_profile_accounts', { p_profile_id: profileId });

/**
 * Add one. The first account added becomes the primary whether or not it was
 * asked for, and the primary is what lands in profiles.rsn — which is the name
 * every challenge sign-up box starts from.
 */
export async function addAccount(profileId, rsn, label = null) {
  const { data, error } = await supabase
    .from('profile_accounts')
    .insert({ profile_id: profileId, rsn, label })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** Make one the primary. The trigger unmarks whichever was. */
export async function setPrimaryAccount(id) {
  const { error } = await supabase
    .from('profile_accounts').update({ is_primary: true }).eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Remove one. Deleting the primary promotes the oldest of what is left, so a
 * list is never left with accounts and no primary.
 */
export async function removeAccount(id) {
  const { error } = await supabase.from('profile_accounts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Sign up, or correct the name on an entry.
 *
 * Open for as long as the event runs: a latecomer is added to the live WOM
 * competition rather than turned away. Queued, not sent, so this answering
 * does not mean WOM took the name — `wom_added` on challengeMine is what says
 * that, and it is false until the competition has actually confirmed it.
 */
export async function challengeJoin(gameId, rsn = null) {
  assertWritable();
  return rpc('challenge_join', { p_game_id: gameId, p_rsn: rsn });
}

/**
 * The WOM competition's id, or null while the create request is still in
 * flight. The id only — the verification code beside it in challenge_wom is
 * the credential that lets anyone edit the competition, and no client may read
 * it. `womCompetitionUrl` turns this into a link.
 */
export const challengeWomCompetition = (gameId) =>
  rpc('challenge_wom_competition', { p_game_id: gameId });

/** Withdraw. Only before the event starts; after that it is an organiser's job. */
export async function challengeLeave(gameId) {
  assertWritable();
  return rpc('challenge_leave', { p_game_id: gameId });
}

/**
 * The number the player gives, in the event's own unit — tenths of a million
 * for `gp` (lib/millions.js), a plain count otherwise.
 */
export async function challengeDeclare(gameId, amount) {
  assertWritable();
  return rpc('challenge_declare', { p_game_id: gameId, p_amount: amount });
}

/** A screenshot behind that number. `phase` is 'start' or 'finish'. */
export async function challengeAddEvidence(gameId, phase, url, note = null) {
  assertWritable();
  return rpc('challenge_add_evidence', {
    p_game_id: gameId, p_phase: phase, p_url: url, p_note: note,
  });
}

/** This player's own entry, or null if they are not in it. */
export const challengeMine = (gameId) => rpc('challenge_mine', { p_game_id: gameId });

/** The ladder. Empty until the event starts. */
export const challengeStandings = (gameId) =>
  rpc('challenge_standings', { p_game_id: gameId });

/**
 * Ask Wise Old Man for the standings. Answers with a request id, or null when
 * somebody else has just asked — the rate limit is server-side, so every open
 * page may call this and between them they cost one request.
 */
export const challengeFetch = (gameId) => rpc('challenge_fetch', { p_game_id: gameId });

/**
 * Read whatever WOM has sent back and write it onto the entries. Answers with
 * how many replies it handled, so a screen can tell "nothing yet" from
 * "nothing to do". Idempotent, and any client may call it — there is no
 * scheduler, which is the arrangement bingo's timer already uses.
 */
export const challengeReconcile = (gameId) =>
  rpc('challenge_reconcile', { p_game_id: gameId });

/**
 * One turn of that loop.
 *
 * Read first, then ask: reading picks up the reply to the last request, and
 * asking queues the next one for whoever is looking a minute from now. Answers
 * with how many replies were handled, which is a screen's cue to re-read the
 * standings.
 */
export async function womPulse(gameId) {
  const handled = await challengeReconcile(gameId);
  await challengeFetch(gameId);
  return handled ?? 0;
}

// ---- Challenge, organiser side ---------------------------------------------

/** Its own call, not admin_new_game: that one has no room for a metric or a ranking. */
export const adminNewChallenge = ({
  name, startsAt, endsAt, solo = true, womMetric = null,
  declaredLabel = null, declaredUnit = null, rankedBy = null, teams = [],
  allAccounts = false,
}) =>
  rpc('admin_new_challenge', {
    p_name: name, p_starts_at: startsAt, p_ends_at: endsAt,
    p_solo: solo, p_wom_metric: womMetric,
    p_declared_label: declaredLabel, p_declared_unit: declaredUnit,
    p_ranked_by: rankedBy, p_teams: teams, p_all_accounts: allAccounts,
  });

/** Every entry with its figures and every screenshot behind them. */
export const adminChallengeEntries = (gameId) =>
  rpc('admin_challenge_entries', { p_game_id: gameId });

/**
 * The competition behind this challenge, for the organiser console: the id,
 * and the verification code that edits it on WOM. Organisers only -- players
 * get `challengeWomCompetition`, which is the id and nothing else. Called on a
 * click rather than with the rest of the console, so the code is not in the
 * page for a screenshot to catch.
 */
export const adminChallengeWom = (gameId, reveal = false) =>
  rpc('admin_challenge_wom', { p_game_id: gameId, p_reveal: reveal });

/**
 * Point an event at a competition Wise Old Man already has. The repair for a
 * create reply that never arrived: WOM made the competition, we never heard
 * its number. An empty code is allowed and means exactly what it says -- the
 * code was in the reply that was lost, and WOM will not issue another.
 */
export const adminChallengeWomLink = (gameId, competitionId, code = '') =>
  rpc('admin_challenge_wom_link', {
    p_game_id: gameId, p_competition_id: competitionId, p_verification_code: code,
  });

/** Ask for a competition again, for an event that has none anywhere. */
export const adminChallengeWomRetry = (gameId) =>
  rpc('admin_challenge_wom_retry', { p_game_id: gameId });

/** Correct a number. Records who corrected it; the old one is not kept. */
export const adminChallengeSetFigure = (entryId, amount) =>
  rpc('admin_challenge_set_figure', { p_entry_id: entryId, p_amount: amount });

/** Mark a number checked, or undo that with `ok` false. */
export const adminChallengeVerify = (entryId, ok = true) =>
  rpc('admin_challenge_verify', { p_entry_id: entryId, p_ok: ok });

/** Which team an entrant plays for; null takes them off one. */
export const adminChallengeSetTeam = (entryId, teamId) =>
  rpc('admin_challenge_set_team', { p_entry_id: entryId, p_team_id: teamId });

/**
 * Open it now rather than at its start time, and create the Wise Old Man
 * competition from whoever is in. Sign-ups stay open either way -- a latecomer
 * is added to the live competition rather than turned away.
 */
export const challengeStart = (gameId) => rpc('challenge_start', { p_game_id: gameId });

/**
 * One look at the clock. There is no scheduler -- the same arrangement bingo's
 * timer and `womPulse` already live with -- so whoever has the page open is
 * what makes a scheduled event start and finish. Any signed-in player may call
 * it, because it reads the times on the event rather than who is asking, and
 * does nothing the clock has not already earned.
 *
 * Answers with what it did, or null for nothing: 'started', 'competition' (an
 * event that opened before anybody had given a name finally got one), 'ending'
 * (the end time has passed and fresh figures are on the way -- call again in a
 * few seconds), 'ended', or 'unscored' (the end time passed on an event whose
 * competition was never created, which needs an organiser).
 */
export const challengeTick = (gameId) => rpc('challenge_tick', { p_game_id: gameId });

// ---- Admin API -----------------------------------------------------------
// Every one of these re-checks is_admin() server-side, so hiding the admin tab
// in the UI is a convenience, never the control.

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

/** Admins may rename either team; captains may rename only their own team. */
export const renameTeam = (teamId, name) => {
  assertWritable();
  return rpc('rename_team', { p_team_id: teamId, p_name: name });
};

export const adminCreateGame = (name, teamA, teamB, gridSize = 10, maxActive = 3) =>
  rpc('admin_create_game', {
    p_name: name, p_team_a: teamA, p_team_b: teamB,
    p_grid_size: gridSize, p_max_active: maxActive,
  });

/**
 * Either mode. `teams` is a list of names: exactly two for battleships, one or
 * more for bingo. `endsAt` (ISO or null) is bingo only.
 */
export const adminNewGame = ({ name, mode, teams, gridSize = 10, endsAt = null }) =>
  rpc('admin_new_game', {
    p_name: name, p_mode: mode, p_teams: teams,
    p_grid_size: gridSize, p_ends_at: endsAt,
  });

/** Bingo only. Adding works until the game is over; removing only before it starts. */
export const adminAddTeam = (gameId, name) =>
  rpc('admin_add_team', { p_game_id: gameId, p_name: name });

export const adminDeleteTeam = (teamId) =>
  rpc('admin_delete_team', { p_team_id: teamId });

/** Bingo only. ISO string, or null for no timer. Must be in the future. */
export const adminSetEndTime = (gameId, endsAt) =>
  rpc('admin_set_end_time', { p_game_id: gameId, p_ends_at: endsAt });

/** Bingo only: finish a running game now, winner by the standings. */
export const adminEndGame = (gameId) =>
  rpc('admin_end_game', { p_game_id: gameId });

// ---- Snakes and Ladders, organiser side (20261002120100, 20261003120000) ----

/**
 * The snakes and ladders on a board, as [{ from_tile, to_tile }]. board_jumps
 * is readable by anyone, so this is a plain select rather than an RPC; `gameId`
 * null reads every game's at once, for the Games list.
 */
export async function listBoardJumps(gameId = null) {
  let q = supabase.from('board_jumps').select('game_id, from_tile, to_tile').order('from_tile');
  if (gameId) q = q.eq('game_id', gameId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Replace every snake and ladder: `jumps` is [{ from, to }]. Before the start only. */
export const adminSetSnakes = (gameId, jumps) =>
  rpc('admin_set_snakes', { p_game_id: gameId, p_snakes: jumps });

/**
 * Territory: each team's home place, `homes` as { teamId: placeKey }. Before
 * the start only. The server refuses homes that would wall land off from a
 * team (lib/territory.js homesProblem asks the same first).
 */
export const adminSetTerritoryHomes = (gameId, homes) =>
  rpc('admin_set_territory_homes', { p_game_id: gameId, p_homes: homes });

/** Territory: every team, highest score first — who wins if the game ends now. */
export const territoryStandings = (gameId) =>
  rpc('territory_standings', { p_game_id: gameId });

/** Every team, furthest along first — also who wins if the game ends now. */
export const snakesStandings = (gameId) =>
  rpc('snakes_standings', { p_game_id: gameId });

/** Send a team back a d6. Answers with the move. */
export const adminSnakesPunish = (teamId) =>
  rpc('admin_snakes_punish', { p_team_id: teamId });

/** Put a team on a tile (not a snake head or a ladder's foot). Answers with the move. */
export const adminSnakesMove = (teamId, tile) =>
  rpc('admin_snakes_move', { p_team_id: teamId, p_tile: tile });

/** Give rollbacks, or take them back with a negative amount. Answers with the new count. */
export const adminSnakesGiveRollback = (teamId, amount) =>
  rpc('admin_snakes_give_rollback', { p_team_id: teamId, p_amount: amount });

/** The team's current tile counts as done, whatever its evidence says. */
export const adminSnakesCompleteTile = (teamId) =>
  rpc('admin_snakes_complete_tile', { p_team_id: teamId });

/** Open a completed tile again for that team; its evidence is kept. */
export const adminSnakesUncompleteTile = (teamId, tile) =>
  rpc('admin_snakes_uncomplete_tile', { p_team_id: teamId, p_tile: tile });

/**
 * End a running game; `winnerId` is the team the organiser was shown as in
 * front. Refused if the standings moved in between.
 */
export const adminSnakesEndGame = (gameId, winnerId) =>
  rpc('admin_snakes_end_game', { p_game_id: gameId, p_winner_team_id: winnerId });

/**
 * Who put their hand up for this event, and whether each is already on a team.
 * The roster picker's shortlist: without it, team-making starts from every
 * account that has ever registered on the site.
 */
export const adminGameSignups = (gameId) =>
  rpc('admin_game_signups', { p_game_id: gameId });

/**
 * Takes one name back off that list. Nothing else could: game_signup_leave
 * deletes the caller's own row and refuses once they are on a team, so a
 * sign-up left by somebody who went quiet had no way out of the shortlist.
 *
 * Does NOT touch team_members. Somebody already rostered stays on their team
 * and goes on playing -- this is the list, not the game.
 */
export const adminGameSignupRemove = (gameId, profileId) =>
  rpc('admin_game_signup_remove', { p_game_id: gameId, p_profile_id: profileId });

export const adminSetMember = (teamId, profileId, role) =>
  rpc('admin_set_member', { p_team_id: teamId, p_profile_id: profileId, p_role: role });

export const adminRemoveMember = (teamId, profileId) =>
  rpc('admin_remove_member', { p_team_id: teamId, p_profile_id: profileId });

export const adminOpenPlacement = (gameId) =>
  rpc('admin_open_placement', { p_game_id: gameId });

/** `startsAt` is an ISO string, or null to clear a previously set time. */
export const adminSetStartTime = (gameId, startsAt) =>
  rpc('admin_set_start_time', { p_game_id: gameId, p_starts_at: startsAt });

/**
 * The one game an unassigned player is shown. Setting a new game unfeatures
 * whatever held it before; passing null just clears it.
 */
export const adminSetFeaturedGame = (gameId) =>
  rpc('admin_set_featured_game', { p_game_id: gameId });

export const adminListTiles = (gameId) =>
  rpc('admin_list_tiles', { p_game_id: gameId });

export const adminListShipCells = (gameId) =>
  rpc('admin_list_ship_cells', { p_game_id: gameId });

/**
 * Counts per game, for the readiness badge on the Games list.
 *
 * Every game in one call rather than the per-game RPCs above in a loop. The
 * three numbers it returns are all behind RLS a client cannot read directly —
 * tiles refuses everyone, ship_cells answers only for your own team, and an
 * admin has none — and all three are counts, never content.
 */
export const adminGameReadiness = () => rpc('admin_game_readiness', {});

/**
 * Set a player's password directly — the one thing an admin cannot fix any
 * other way, since these accounts have no real mailbox to send a reset link
 * to. Same mechanism as the manual SQL snippet it replaces (pgcrypto, not the
 * service-role Admin API), and every call is logged (see below).
 */
export const adminResetPassword = (profileId, newPassword) =>
  rpc('admin_reset_password', { p_profile_id: profileId, p_new_password: newPassword });

/** Recent resets, newest first — who reset whose password, and when. */
export const adminListPasswordResets = (limit = 20) =>
  rpc('admin_list_password_resets', { p_limit: limit });

/**
 * Remove a player's account outright — for troll signups that never join a
 * game. Refused server-side for an admin account, and for a player who has
 * already submitted or spent a pet jar (real game activity on record).
 */
export const adminDeleteAccount = (profileId) =>
  rpc('admin_delete_account', { p_profile_id: profileId });

/** Recent deletions, newest first — who deleted which account, and when. */
export const adminListAccountDeletions = (limit = 20) =>
  rpc('admin_list_account_deletions', { p_limit: limit });

// ---- who runs what (20261025120000) ----
//
// A moderator holds MODES, not games. Grant 'challenge' and they run every
// challenge there is, including ones somebody else set up: may_manage_game
// joins moderator_modes to the game's mode, and nothing narrows it to whoever
// created the game. That is the tier's design, not an oversight.

/** Everyone holding at least one mode, with their modes and when granted. */
export const adminListModerators = () => rpc('admin_list_moderators');

/**
 * Replace one account's whole grant in a single call — the console sends what
 * its tick boxes say, so there is no per-mode add and remove to drift apart.
 * An empty array demotes them to an ordinary player. Refused outright on an
 * admin, who already outranks every mode.
 */
export const adminSetModeratorModes = (profileId, modes) =>
  rpc('admin_set_moderator_modes', { p_profile_id: profileId, p_modes: modes });

// ---- tile suggestions: players propose, an organiser reviews ----
//
// `tile` is the same payload `adminSaveLibraryTile` takes (payloadFromDraft),
// and the rows come back in the catalogue's row shape, so TileForm opens a
// suggestion exactly the way it opens a catalogue entry.

/** Suggest a tile for the catalogue. Returns the suggestion's id. */
export const submitTile = (tile, note) =>
  rpc('submit_tile', { p_tile: tile, p_note: note ?? null });

/** Change one of your own suggestions while it is still waiting for review. */
export const updateTileSubmission = (id, tile, note) =>
  rpc('update_tile_submission', { p_id: id, p_tile: tile, p_note: note ?? null });

/** Take back one of your own pending suggestions. Marks it, deletes nothing. */
export const withdrawTileSubmission = (id) =>
  rpc('withdraw_tile_submission', { p_id: id });

/** The caller's own suggestions, newest first. */
export const myTileSubmissions = () => rpc('my_tile_submissions');

/**
 * 'catalogue', 'pending' or null for a name -- whether suggesting it would
 * collide. `exceptId` skips one suggestion, so editing your own does not
 * report its own name as taken.
 */
export const tileNameStatus = (name, exceptId) =>
  rpc('tile_name_status', { p_name: name, p_except: exceptId ?? null });

/** Every suggestion: the pending queue oldest first, then the history. */
export const adminListTileSubmissions = () => rpc('admin_list_tile_submissions');

/** Copy a suggestion (as edited by the organiser) into the catalogue. */
export const adminAcceptTileSubmission = (id, tile, note) =>
  rpc('admin_accept_tile_submission', { p_id: id, p_tile: tile, p_note: note ?? null });

export const adminRefuseTileSubmission = (id, reason) =>
  rpc('admin_refuse_tile_submission', { p_id: id, p_reason: reason ?? null });

// ---- the tile library, and boards built one square at a time ----

/**
 * Every catalogued tile, most-used first. The rows come back in the same shape
 * `admin_list_tiles` returns a board in, so one renderer serves both.
 */
export const adminListLibrary = () => rpc('admin_list_library');

/**
 * Insert (`id` null) or update one catalogue entry. `tile` is the shape the
 * board builder's form emits — name, icon, amount, rule, perSet, description,
 * options[]. Returns the entry's id.
 */
export const adminSaveLibraryTile = (id, tile) =>
  rpc('admin_save_library_tile', { p_id: id ?? null, p_tile: tile });

export const adminDeleteLibraryTile = (id) =>
  rpc('admin_delete_library_tile', { p_id: id });

/**
 * Fill one square. Same payload shape as `adminSaveLibraryTile`, plus
 * `libraryId` when it came from the catalogue. Overwrites whatever was there.
 */
export const adminSetTile = (gameId, row, col, tile) =>
  rpc('admin_set_tile', { p_game_id: gameId, p_row: row, p_col: col, p_tile: tile });

export const adminClearTile = (gameId, row, col) =>
  rpc('admin_clear_tile', { p_game_id: gameId, p_row: row, p_col: col });

/**
 * Play a list of drops into a tile and report whether it finishes, without
 * committing any of it.
 *
 * `picks` is one entry per screenshot, in submission order: `{ option_id }` on
 * a tile with drops, `{ amount }` on a value tile, `{}` on a plain count. The
 * answer comes from `claim_is_complete()` itself rather than from
 * `tileProgress.js` — the point is to ask the authority, not the mirror it is
 * kept in step with by hand.
 *
 * Nothing survives the call: the claim and its evidence live inside a
 * subtransaction the function rolls back, so no shot is fired, no event is
 * written, and the other team's board never flickers.
 */
export const adminTestTile = (tileId, picks) =>
  rpc('admin_test_tile', { p_tile_id: tileId, p_picks: picks });

/**
 * Saved boards.
 *
 * A whole board under a name, so a hundred hand-placed squares are not a thing
 * that exists in one copy with `admin_clear_board` next to them. The snapshot
 * is taken server-side and never travels through here — `admin_list_board_presets`
 * deliberately returns a name and a count, not the tiles, because a board IS the
 * tile list and that is secret #2.
 *
 * Applying REPLACES the board. Refused once a game is past placement, or if any
 * tile on it has been claimed.
 */
export const adminSaveBoardPreset = (gameId, name) =>
  rpc('admin_save_board_preset', { p_game_id: gameId, p_name: name });

export const adminListBoardPresets = () => rpc('admin_list_board_presets');

export const adminApplyBoardPreset = (gameId, presetId) =>
  rpc('admin_apply_board_preset', { p_game_id: gameId, p_preset_id: presetId });

export const adminDeleteBoardPreset = (presetId) =>
  rpc('admin_delete_board_preset', { p_preset_id: presetId });

/**
 * Empty every square on a board. Returns how many squares it removed. Refused
 * once the game is past preparation, like every other write to `tiles`.
 */
export const adminClearBoard = (gameId) =>
  rpc('admin_clear_board', { p_game_id: gameId });

/**
 * Deal random catalogue tiles into the squares that are still empty.
 *
 * Never touches a square that already has a tile, and never deals a task the
 * board already holds. Returns `{ filled, similar, empty, pool }` — `empty` is
 * how many squares it found, `filled` how many it could fill, and `similar` how
 * many of those had to be a near-duplicate of another task to get there.
 *
 * Draws from the whole catalogue. It used to take a label to narrow that, and
 * the labels are gone: the only pool anyone ever scoped to was the one a saved
 * board already describes, and a random arrangement of exactly those tiles is
 * Load followed by Shuffle.
 */
export const adminAutofillBoard = (gameId) =>
  rpc('admin_autofill_board', { p_game_id: gameId });

/**
 * Move the tiles already on a board between the squares they occupy.
 *
 * The counterpart to dealing rather than a version of it: the catalogue is
 * never consulted, so no square can come out empty, a task placed more than
 * once stays placed more than once, and a one-off tile that exists nowhere but
 * on its square survives. Returns `{ tiles, moved }` — `moved` is how many
 * landed somewhere new, which on a real board is all but one or two of them.
 *
 * Refused once the game is past preparation: a square's coordinates are what a
 * team previewed, claimed and fired at.
 */
export const adminShuffleBoard = (gameId) =>
  rpc('admin_shuffle_board', { p_game_id: gameId });

/**
 * Move the tile on `from` to `to`, and whatever was on `to` back to `from`
 * (`{ row, col }` each). An empty `to` is a plain move. The tiles keep their
 * ids, drops and catalogue links. Returns `{ moved, swapped, changed }`, the
 * two names. Before the start only, like clearing a square.
 */
export const adminSwapTiles = (gameId, from, to) =>
  rpc('admin_swap_tiles', {
    p_game_id: gameId,
    p_from_row: from.row, p_from_col: from.col,
    p_to_row: to.row, p_to_col: to.col,
  });

export const adminDeleteGame = (gameId) =>
  rpc('admin_delete_game', { p_game_id: gameId });

/**
 * Roll a game back to preparation. Keeps the tiles and the roster; clears
 * locked-in tiles, the feed, manual score adjustments, the winner, and (by
 * default) the fleets.
 */
export const adminResetGame = (gameId, clearFleets = true) =>
  rpc('admin_reset_game', { p_game_id: gameId, p_clear_fleets: clearFleets });

/**
 * Give a team its slot back on a tile it cannot finish (0029).
 *
 * Admin only, and deliberately so: a captain able to drop their own square could
 * lock in, read the tile name, release, and repeat, which hands over the task
 * list a square at a time. The claim is deleted rather than flagged, so the
 * square becomes lockable again — and its submitted screenshots go with it.
 * Returns `{ released, position, evidence_deleted }`; show that count before
 * confirming. A fired tile is refused.
 */
export const adminReleaseClaim = (claimId) =>
  rpc('admin_release_claim', { p_claim_id: claimId });

/**
 * Take one submission back (20260918163924).
 *
 * The narrow fix `adminReleaseClaim` is too blunt for: a team picks the wrong
 * drop off the list, banks the wrong points, and wants to resubmit against the
 * right one. Releasing the claim would destroy every other screenshot on the
 * tile and refuses outright once it has fired. This removes the one piece and
 * puts the claim back where it stood before it arrived.
 *
 * ALWAYS call it with `dryRun` first and show what comes back. The preview is
 * the real function run against the real rows and rolled back, so what it
 * reports is what will happen — there is no second description to drift. It
 * refuses nothing, so a revoke can withdraw a shot, refloat a ship and reopen
 * a finished game, and the confirmation is the only thing standing in front of
 * that.
 *
 * Returns `{ unfired, ship_refloated, ship_size, reveals_withdrawn,
 * game_reopened, still_complete, evidence_left, points_left, over_slot_limit,
 * active_tiles, max_active_tiles, … }`.
 */
export const adminRevokeEvidence = (evidenceId, dryRun = false) =>
  rpc('admin_revoke_evidence', {
    p_evidence_id: evidenceId,
    p_dry_run: dryRun,
  });

/** Every pet jar submission in a game, newest first, with its team's name. */
export const adminListPetJars = (gameId) =>
  rpc('admin_list_pet_jars', { p_game_id: gameId });

/**
 * Take one pet jar submission back, and the preview credit it earned
 * (20260927130100). If the team has already spent that credit, their newest
 * preview on an unclaimed tile is withdrawn instead. `dryRun` answers what
 * would happen and commits nothing.
 *
 * Returns `{ count_before, count_after, credit_removed, preview_withdrawn,
 * preview_position, preview_tile_name, nothing_to_take, team_name, … }`.
 */
export const adminRevokePetJar = (submissionId, dryRun = false) =>
  rpc('admin_revoke_pet_jar', {
    p_submission_id: submissionId,
    p_dry_run: dryRun,
  });

/**
 * Discord webhook config (0040). `teamId` null means the shared/general
 * channel; a team id scopes it to that team's own private channel (evidence
 * and pet-jar submissions route there, never to general — see 0036/0039).
 */
export const adminListWebhooks = (gameId) =>
  rpc('admin_list_webhooks', { p_game_id: gameId });

export const adminSetWebhook = (gameId, teamId, url, enabled = true) =>
  rpc('admin_set_webhook', {
    p_game_id: gameId, p_team_id: teamId, p_url: url, p_enabled: enabled,
  });

export const adminDeleteWebhook = (id) =>
  rpc('admin_delete_webhook', { p_id: id });
