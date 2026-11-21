/**
 * Stand-in for lib/supabase.js, used ONLY by the evidence-review harness.
 *
 * There is no local Postgres on this machine and the dev server's Supabase is
 * the live project, so the revoke flow cannot be exercised end to end without
 * applying the migrations to the real event database. This replaces the two
 * calls EvidenceReview makes — `admin_list_evidence` and `admin_revoke_evidence`
 * — with canned answers, so the REAL component, the REAL confirm dialog and the
 * REAL stylesheet render exactly what an organiser would see.
 *
 * The dry-run payloads below are hand-written to the shape
 * `admin_revoke_evidence` returns (see 20260918163924, the `v_out` object).
 * They are a fixture, not a simulation: nothing here runs the completion rules,
 * so this shows what the screen LOOKS like, and proves nothing about whether
 * the SQL unwinds a sinking correctly.
 *
 * Swapped in by vite.preview.config.js. The app build never sees this file.
 *
 * The admin console's calls live in stub-admin.js and are re-exported from
 * here, since this is the one module the alias points at.
 */
import { adminFrom, adminRpc } from './stub-admin.js';
import { dinkUrl } from '../lib/pluginTokens.js';

export * from './stub-admin.js';

/** A grey placeholder in the shape of a screenshot thumbnail. */
const shot = (label) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="168" height="168">
       <rect width="168" height="168" fill="#2a2a2c"/>
       <rect x="8" y="8" width="152" height="152" fill="none" stroke="#3d3d40"/>
       <text x="84" y="80" fill="#8a8a8f" font-family="system-ui" font-size="15"
             text-anchor="middle">screenshot</text>
       <text x="84" y="102" fill="#f2c14e" font-family="system-ui" font-size="13"
             text-anchor="middle">${label}</text>
     </svg>`
  );

const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();

/**
 * Six rows, each a different thing a revoke can do. The first is the case this
 * feature was actually asked for; the rest get progressively more destructive,
 * which is the order the dialog has to be legible in.
 */
export const DEMO = [
  {
    id: 'ev-1',
    claim_id: 'cl-1',
    storage_path: 'p/1',
    uploaded_by_name: 'Sanchez',
    created_at: ago(4),
    team_id: 't-a',
    team_name: 'Kandarin',
    tile_position: 63,
    tile_name: 'Infernal cape, fire cape and quiver',
    status: 'active',
    option_label: 'Fire cape',
    points: 2,
    completion: 'points',
    required_evidence: 10,
    public_url: null,
    _preview: {
      dry_run: true, position: 63, tile_name: 'Infernal cape, fire cape and quiver',
      completion: 'points', required_evidence: 10, team_name: 'Kandarin',
      evidence_left: 3, points_left: 6, still_complete: false,
      was_fired: false, shot_result: null,
      unfired: false, parked: false, announced_to_all: false, ship_refloated: false, ship_size: null,
      reveals_withdrawn: 0, game_reopened: false,
      active_tiles: 3, max_active_tiles: 3, over_slot_limit: false,
    },
  },
  {
    id: 'ev-2',
    claim_id: 'cl-2',
    storage_path: 'p/2',
    uploaded_by_name: 'Thammaron',
    created_at: ago(26),
    team_id: 't-a',
    team_name: 'Kandarin',
    tile_position: 27,
    tile_name: 'Any three barrows pieces',
    status: 'fired',
    option_label: "Dharok's helm",
    points: 4,
    completion: 'points',
    required_evidence: 10,
    public_url: null,
    _preview: {
      dry_run: true, position: 27, tile_name: 'Any three barrows pieces',
      completion: 'points', required_evidence: 10, team_name: 'Kandarin',
      evidence_left: 3, points_left: 10, still_complete: true,
      was_fired: true, shot_result: 'miss',
      unfired: false, parked: false, announced_to_all: false, ship_refloated: false, ship_size: null,
      reveals_withdrawn: 0, game_reopened: false,
      active_tiles: 2, max_active_tiles: 3, over_slot_limit: false,
    },
  },
  {
    id: 'ev-3',
    claim_id: 'cl-3',
    storage_path: 'p/3',
    uploaded_by_name: 'Nieve',
    created_at: ago(51),
    team_id: 't-b',
    team_name: 'Misthalin',
    tile_position: 8,
    tile_name: '15M worth of Revenant emblems',
    status: 'fired',
    option_label: null,
    points: 55,
    completion: 'value',
    required_evidence: 150,
    public_url: null,
    _preview: {
      dry_run: true, position: 8, tile_name: '15M worth of Revenant emblems',
      completion: 'value', required_evidence: 150, team_name: 'Misthalin',
      evidence_left: 6, points_left: 98, still_complete: false,
      was_fired: true, shot_result: 'miss',
      unfired: true, parked: true, announced_to_all: true, ship_refloated: false, ship_size: null,
      reveals_withdrawn: 0, game_reopened: false,
      active_tiles: 3, max_active_tiles: 3, over_slot_limit: false,
    },
  },
  {
    id: 'ev-4',
    claim_id: 'cl-4',
    storage_path: 'p/4',
    uploaded_by_name: 'Duradel',
    created_at: ago(73),
    team_id: 't-b',
    team_name: 'Misthalin',
    tile_position: 41,
    tile_name: 'Any godsword hilt',
    status: 'fired',
    option_label: 'Bandos hilt',
    points: 3,
    completion: 'points',
    required_evidence: 6,
    public_url: null,
    _preview: {
      dry_run: true, position: 41, tile_name: 'Any godsword hilt',
      completion: 'points', required_evidence: 6, team_name: 'Misthalin',
      evidence_left: 1, points_left: 3, still_complete: false,
      was_fired: true, shot_result: 'hit',
      unfired: true, parked: true, announced_to_all: true, ship_refloated: false, ship_size: null,
      reveals_withdrawn: 0, game_reopened: false,
      active_tiles: 2, max_active_tiles: 3, over_slot_limit: false,
    },
  },
  {
    id: 'ev-5',
    claim_id: 'cl-5',
    storage_path: 'p/5',
    uploaded_by_name: 'Vannaka',
    created_at: ago(95),
    team_id: 't-a',
    team_name: 'Kandarin',
    tile_position: 55,
    tile_name: 'One of each Nightmare unique',
    status: 'fired',
    option_label: "Inquisitor's mace",
    points: 1,
    completion: 'each_set',
    required_evidence: 1,
    public_url: null,
    _preview: {
      dry_run: true, position: 55, tile_name: 'One of each Nightmare unique',
      completion: 'each_set', required_evidence: 1, team_name: 'Kandarin',
      evidence_left: 4, points_left: 4, still_complete: false,
      was_fired: true, shot_result: 'hit',
      unfired: true, parked: true, announced_to_all: true, ship_refloated: true, ship_size: 4,
      reveals_withdrawn: 12, game_reopened: false,
      active_tiles: 3, max_active_tiles: 3, over_slot_limit: false,
    },
  },
  {
    id: 'ev-6',
    claim_id: 'cl-6',
    storage_path: 'p/6',
    uploaded_by_name: 'Sanchez',
    created_at: ago(140),
    team_id: 't-a',
    team_name: 'Kandarin',
    tile_position: 100,
    tile_name: 'Any Chambers of Xeric unique',
    status: 'fired',
    option_label: 'Twisted bow',
    points: 8,
    completion: 'points',
    required_evidence: 8,
    public_url: null,
    _preview: {
      dry_run: true, position: 100, tile_name: 'Any Chambers of Xeric unique',
      completion: 'points', required_evidence: 8, team_name: 'Kandarin',
      evidence_left: 0, points_left: 0, still_complete: false,
      was_fired: true, shot_result: 'hit',
      unfired: true, parked: true, announced_to_all: true, ship_refloated: true, ship_size: 2,
      reveals_withdrawn: 6, game_reopened: true,
      active_tiles: 2, max_active_tiles: 3, over_slot_limit: false,
    },
  },
];

/**
 * admin_evidence_sources, for the "Sent by plugin" label: which DEMO rows Dink
 * handed in, and what it reported. The harness switches `mode`:
 *   'some'    two rows from Dink, one with a picture made smaller;
 *   'missing' the live project before the plugin's draft (null: no labels);
 *   'failed'  the call fails, and the screen says it cannot tell.
 * The other four rows are uploads from the site, as most evidence is.
 */
export const evidenceSourceFixtures = { mode: 'some' };
const DEMO_SOURCES = [
  {
    id: 'ev-4',
    source: 'dink',
    detail: {
      source: 'dink', rsn: 'Duradel Iron', item: 'Bandos hilt', item_id: 11812, quantity: 1,
      price_each: 13200000, from: 'General Graardor', category: 'NPC', world: 416,
      region_id: 11347, dink_type: 'LOOT',
    },
  },
  {
    id: 'ev-5',
    source: 'dink',
    detail: {
      source: 'dink', rsn: 'Vannaka', item: "Inquisitor's mace", item_id: 24417, quantity: 1,
      price_each: 1010000000, from: 'The Nightmare', category: 'NPC', world: 302,
      region_id: 15515, dink_type: 'LOOT', resized_from: '3840x2400',
    },
  },
];
export const evidenceSources = () => new Promise((resolve, reject) => setTimeout(() => {
  if (evidenceSourceFixtures.mode === 'missing') resolve(null);
  else if (evidenceSourceFixtures.mode === 'failed') reject(new Error('stub: the database did not answer'));
  else resolve(DEMO_SOURCES);
}, 80));

/**
 * A tile's panel, for the evidence harness (main.jsx): one drop Dink handed in,
 * like the Woman's Bones of 2026-11-21, whose screenshot did not show them, and
 * one upload from the site.
 */
export const PANEL_DEMO = [
  { id: 'pv-1', storage_path: 'pv/1', uploaded_by_name: 'Soft Papi', created_at: ago(3) },
  { id: 'pv-2', storage_path: 'pv/2', uploaded_by_name: 'Duradel', created_at: ago(42) },
];
const PANEL_SOURCES = [
  {
    id: 'pv-1',
    source: 'dink',
    detail: {
      source: 'dink', rsn: 'Soft Papi', item: 'Bones', item_id: 526, quantity: 1,
      price_each: 75, from: 'Woman', category: 'NPC', world: 308,
      region_id: 12850, dink_type: 'LOOT',
    },
  },
];

/**
 * evidence_sources, for a tile's panel: the same rows, asked by id, with the
 * same `mode` switch. Every other harness's rows are uploads from the site, so
 * nothing comes back for them, as on a real board.
 */
export const evidenceSourcesFor = (ids) => new Promise((resolve, reject) => setTimeout(() => {
  if (evidenceSourceFixtures.mode === 'missing') resolve(null);
  else if (evidenceSourceFixtures.mode === 'failed') reject(new Error('stub: the database did not answer'));
  else resolve([...DEMO_SOURCES, ...PANEL_SOURCES].filter((s) => ids.includes(s.id)));
}, 80));

/**
 * waiting_drops, for the box above a team's board (WaitingDrops.jsx): drops
 * Dink sent that two tiles want. The harness switches `mode`:
 *   'some'    two drops, one in two regions and one with three tiles;
 *   'none'    nothing waiting (the box hides);
 *   'missing' the live project before the plugin's draft (null: it hides);
 *   'failed'  the call fails.
 * stub-evidence.js's handInWaitingDrop takes a drop off `waitingLive`.
 */
export const waitingFixtures = { mode: 'some', refuse: false };
const minutesFrom = (m) => new Date(Date.now() + m * 60000).toISOString();
export const WAITING_DEMO = [
  {
    id: 'wd-1', item: 'Abyssal whip', storage_path: 'wd/1', dropped_by: 'Soft Papi',
    received_at: minutesFrom(-14), expires_at: minutesFrom(46),
    detail: { source: 'dink', rsn: 'Soft Papi', item: 'Abyssal whip', quantity: 1, from: 'Abyssal demon', world: 308, dink_type: 'LOOT' },
    choices: [
      { tile_id: 't-whips', option_id: 'o-whip', tile: 'Whips', position: 1, region: 'misthalin', label: 'Abyssal whip' },
      { tile_id: 't-slayer', option_id: 'o-whip-2', tile: 'Slayer drops', position: 101, region: 'asgarnia', label: 'Abyssal whip' },
    ],
  },
  {
    id: 'wd-2', item: 'Dragon bones', storage_path: 'wd/2', dropped_by: 'Duradel',
    received_at: minutesFrom(-52), expires_at: minutesFrom(8),
    detail: { source: 'dink', rsn: 'Duradel Iron', item: 'Dragon bones', quantity: 1, from: 'Vorkath', world: 416, dink_type: 'LOOT', resized_from: '3840x2400' },
    choices: [
      { tile_id: 't-bones', option_id: 'o-bones', tile: 'Dragon bones', position: 5, region: 'misthalin', label: 'Dragon bones' },
      { tile_id: 't-prayer', option_id: 'o-bones-2', tile: 'Anything for Prayer', position: 402, region: 'fremennik', label: 'Dragon bones' },
      { tile_id: 't-vork', option_id: 'o-bones-3', tile: 'Vorkath kill', position: 1002, region: 'varlamore', label: 'Dragon bones' },
    ],
  },
];
export let waitingLive = [...WAITING_DEMO];
export const resetWaiting = () => { waitingLive = [...WAITING_DEMO]; };
export const takeWaiting = (id) => { waitingLive = waitingLive.filter((d) => d.id !== id); };
export const waitingDrops = () => new Promise((resolve, reject) => setTimeout(() => {
  if (waitingFixtures.mode === 'missing') resolve(null);
  else if (waitingFixtures.mode === 'failed') reject(new Error('stub: the database did not answer'));
  else if (waitingFixtures.mode === 'none') resolve([]);
  else resolve(waitingLive);
}, 80));
export const waitingDropOpen = () => Promise.reject(new Error('Not available in the harness.'));
export const waitingDropChoose = () => Promise.reject(new Error('Not available in the harness.'));

/** Rows the harness has not revoked yet. Mutated so the list really shrinks. */
let live = [...DEMO];

export const resetDemo = () => { live = [...DEMO]; };

/**
 * Canned answers for any other RPC, keyed by name. The bingo harness
 * (bingo-main.jsx) fills this in; the evidence harness leaves it empty.
 */
export const rpcFixtures = {};

/** A realtime channel that never hears anything, for components that subscribe. */
const quietChannel = {
  on() { return quietChannel; },
  subscribe(cb) { cb?.('SUBSCRIBED'); return quietChannel; },
};

export const supabase = {
  rpc(name, args) {
    if (name in rpcFixtures) {
      return Promise.resolve({ data: rpcFixtures[name], error: null });
    }
    if (name in adminRpc) {
      return Promise.resolve({ data: adminRpc[name](args ?? {}), error: null });
    }
    if (name === 'admin_list_evidence') {
      return Promise.resolve({ data: live.map(({ _preview, ...r }) => r), error: null });
    }
    return Promise.resolve({ data: null, error: { message: `stub: no ${name}` } });
  },
  from: adminFrom,
  channel() { return quietChannel; },
  removeChannel() {},
};

// The bingo screens' own calls. They do nothing here: the harness shows what
// the screens look like, and has no game for them to change.
export const settleBingo = () => Promise.resolve(false);
export const openBingoTile = () => Promise.reject(new Error('Uploads are not available in the harness.'));

// The snakes screen's calls. The snakes harness (snakes-main.jsx) plugs in a
// small simulation so the die and the marker can be watched moving; anywhere
// else they refuse, like the bingo ones.
export const snakesHandlers = {};
const noSnakes = () => Promise.reject(new Error('Not available in the harness.'));
export const snakesRoll = (g) => (snakesHandlers.roll ?? noSnakes)(g);
export const snakesSpendRollback = (g) => (snakesHandlers.rollback ?? noSnakes)(g);
export const snakesOpenTile = (g) => (snakesHandlers.open ?? noSnakes)(g);

// The live territory screen's calls (TerritoryLive). The territory harness
// renders TerritoryGame with its own simulation instead, so here they refuse.
const noTerritory = () => Promise.reject(new Error('Not available in the harness.'));
export const territoryOpenTile = noTerritory;
export const territoryDropTile = noTerritory;
export const settleTerritory = () => Promise.resolve(false);

// The live Region Bingo screen's calls (RegionsLive). The regions harness
// renders RegionsGame with its own simulation instead, so here they refuse.
const noRegions = () => Promise.reject(new Error('Not available in the harness.'));
export const regionsOpenTile = noRegions;
export const regionsPick = noRegions;
export const settleRegions = () => Promise.resolve(false);
// regionsStandings comes from stub-admin.js (the admin Track lists the teams).

// Imported by AdminOverview, which the bingo overview borrows a helper from.
// Never called on the bingo page.
export const adminListShipCells = () => Promise.resolve([]);
export const adminReleaseClaim = () => Promise.reject(new Error('Not available in the harness.'));

export function adminRevokeEvidence(evidenceId, dryRun = false) {
  const row = live.find((r) => r.id === evidenceId);
  if (!row) return Promise.reject(new Error('No such piece of evidence'));
  if (!dryRun) live = live.filter((r) => r.id !== evidenceId);
  // A beat of latency, so the button's "Checking…" state is actually visible.
  return new Promise((resolve) =>
    setTimeout(() => resolve({ ...row._preview, dry_run: dryRun }), 220)
  );
}

export const DEMO_URLS = Object.fromEntries([
  ...DEMO.map((r) => [r.storage_path, shot(r.option_label ?? `${r.points / 10}m`)]),
  ['pv/1', shot('no bones in sight')],
  ['pv/2', shot('upload')],
  ['wd/1', shot('whip')],
  ['wd/2', shot('bones')],
]);

/**
 * The My Accounts list, for the Home harness (home-main.jsx), which fills
 * `accountFixtures` in before it renders. Empty everywhere else, which is also
 * a case worth looking at: it is what a brand new player sees.
 */
export const accountFixtures = [];
export const myAccounts = () => Promise.resolve(accountFixtures);

/**
 * Plugin tokens, for the My Account harness (account-main.jsx). `list` null is
 * the live project before the plugin's migrations: the section hides. Made
 * tokens are random and the link points at no project; nothing is sent.
 */
export const pluginTokenFixtures = { list: [] };
export const pluginTokens = () =>
  new Promise((resolve) => setTimeout(() => resolve(
    pluginTokenFixtures.list && pluginTokenFixtures.list.map((t) => ({ ...t }))), 120));
export function makePluginToken(label) {
  if (pluginTokenFixtures.list.length >= 5) {
    return Promise.reject(new Error('You already have 5 plugin tokens. Revoke one first.'));
  }
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  pluginTokenFixtures.list.push({
    id: `pt-${hex.slice(0, 8)}`, label, created_at: new Date().toISOString(), last_used_at: null,
  });
  return Promise.resolve(`hse_${hex}`);
}
export function revokePluginToken(id) {
  pluginTokenFixtures.list = pluginTokenFixtures.list.filter((t) => t.id !== id);
  return Promise.resolve(null);
}
export const pluginDinkUrl = (token) => dinkUrl('https://your-project.supabase.co', token);

/**
 * Enough of an auth surface to boot the real App (app-main.jsx).
 *
 * `previewSession` is set by the harness before it renders. null is the
 * signed-out screen; an object is a signed-in one. Nothing here authenticates
 * anything -- it exists so the component tree can be rendered at all, which
 * until now nothing in this repo could do without a live project.
 */
export const preview = { session: null };

const authListeners = new Set();

supabase.auth = {
  getSession: () => Promise.resolve({ data: { session: preview.session } }),
  onAuthStateChange(cb) {
    authListeners.add(cb);
    return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
  },
  signOut() {
    preview.session = null;
    authListeners.forEach((cb) => cb('SIGNED_OUT', null));
    return Promise.resolve({ error: null });
  },
};

/** The games list, for the App harness. */
export const previewGames = { rows: [] };
export const challengeList = () => Promise.resolve(previewGames.rows);

/**
 * The board events open for sign-ups, for the App harness.
 *
 * Putting a hand up really does move the row, so Home can be clicked through:
 * sign up, watch the card leave "Open to join" for the list above it, take it
 * back out again. Rows are REPLACED rather than mutated, for the same reason
 * challengeFixtures.entry is below -- App re-reads them through listMyGames,
 * and a mutation in place does not survive React's own equality checks.
 */
export const previewSignups = { rows: [] };
export const gameSignupList = () => Promise.resolve(previewSignups.rows);

const setSignup = (gameId, joined) => {
  previewSignups.rows = previewSignups.rows.map((r) => (r.game_id === gameId
    ? {
      ...r,
      joined,
      // Only when it actually changed: pressing Sign me up twice is one
      // sign-up, which is what the unique constraint says in the real thing.
      signups: Math.max(0, (r.signups ?? 0) + (r.joined === joined ? 0 : joined ? 1 : -1)),
    }
    : r));
  return Promise.resolve(null);
};
export const gameSignupJoin = (gameId) => setSignup(gameId, true);
export const gameSignupLeave = (gameId) => setSignup(gameId, false);

/**
 * What the challenge harness fills in before it renders.
 *
 * Empty here, which is deliberate: the App smoke test imports this same
 * module and gets exactly the inert answers it always had. Only a harness
 * that sets `entry` turns the player's half of a challenge into something
 * that can be clicked.
 *
 * The writes below replace `entry` rather than mutating it, because the
 * component re-reads it through challengeMine() after every action and a
 * mutation in place would not survive React's own equality checks.
 */
export const challengeFixtures = {
  entry: null,
  standings: [],
  entryAccounts: [],
  womId: null,
  // The organiser's half: every entrant, and the competition the figures are
  // read from. Only the admin harness fills these.
  entries: [],
  wom: null,
};

/**
 * The rest of lib/supabase.js's surface, so the whole App tree can be
 * imported. A missing name here is not a soft failure -- an ESM named import
 * that does not resolve kills the module graph before anything renders, which
 * is why these exist at all.
 *
 * Reads answer empty; writes refuse. The App harness is a smoke test for
 * "does it render", and a harness that silently accepted a write would be
 * claiming to test something it does not.
 */
export const isSupabaseConfigured = true;

const noop = () => Promise.reject(new Error('Not available in the harness.'));
const none = () => Promise.resolve([]);
const nothing = () => Promise.resolve(null);

export const challengeMine = () => Promise.resolve(challengeFixtures.entry);
export const challengeStandings = () => Promise.resolve(challengeFixtures.standings);
export const challengeMyAccounts = () => Promise.resolve(challengeFixtures.entryAccounts);
export const challengeWomCompetition = () => Promise.resolve(challengeFixtures.womId);

/*
 * Putting a hand up really happens.
 *
 * These two were noops, which left the sign-up screen the one state of a
 * challenge nobody could walk through: the button threw and the screen stayed
 * exactly as it was, so "signed up" was a thing you had to imagine. The entry
 * written here is the shape challengeMine answers with, and the entrant count
 * moves with it, so the screen goes where the real one goes.
 *
 * Joining with an entry already there is Save my name, not a second sign-up,
 * which is also what challenge_join does against its unique constraint.
 *
 * The row's `joined` flag moves with the count, which it did not use to --
 * setSignup below had always set its own. Without it the harness could not
 * walk the one trip this is about: sign up, press Home, read the card.
 */
const setEntry = (gameId, joined) => {
  previewGames.rows = previewGames.rows.map((r) => (r.game_id === gameId
    ? {
      ...r,
      entrants: Math.max(0, (r.entrants ?? 0) + (joined ? 1 : -1)),
      joined,
    }
    : r));
};

export const challengeJoin = (gameId, rsn) => {
  const had = Boolean(challengeFixtures.entry);
  challengeFixtures.entry = {
    ...(challengeFixtures.entry ?? { id: 'preview-entry', entry_id: 'preview-entry', evidence: [] }),
    rsn: rsn ?? null,
  };
  if (!had) setEntry(gameId, true);
  return Promise.resolve(null);
};

export const challengeLeave = (gameId) => {
  if (challengeFixtures.entry) setEntry(gameId, false);
  challengeFixtures.entry = null;
  return Promise.resolve(null);
};
// Nothing is ever taken: the harness has no catalogue to collide with, and a
// suggestion form that said "taken" about every name would be untestable.
export const tileNameStatus = nothing;
export const myTileSubmissions = none;
export const myModeratorModes = none;

export const addAccount = noop;
export const setPrimaryAccount = noop;
export const removeAccount = noop;
export const adminChallengeSetFigure = noop;
export const adminChallengeSetTeam = noop;
export const adminChallengeVerify = noop;
export const adminChallengeWomLink = noop;
export const adminChallengeWomRetry = noop;
export const adminNewChallenge = noop;
export const challengeStart = noop;
export const claimTile = noop;
export const fireTile = noop;
export const placeFleet = noop;
export const spendPetJar = noop;
export const submitTile = noop;
export const updateTileSubmission = noop;
export const withdrawTileSubmission = noop;
/**
 * The two writes the evidence screen is made of. They refuse with no fixture
 * loaded, exactly as every other write here does, so the App smoke test still
 * tests what it says it tests.
 */
let shotSeq = 0;

export const adminChallengeEntries = () => Promise.resolve(challengeFixtures.entries);

/**
 * The competition a challenge's figures are read from.
 *
 * `reveal` is the card's own button rather than part of the page load, so the
 * verification code is never in a payload nobody asked for. Answering it here
 * is what makes that button do something in the harness.
 */
export const adminChallengeWom = (_gameId, reveal = false) => Promise.resolve(
  challengeFixtures.wom && reveal
    ? { ...challengeFixtures.wom, verification_code: 'HS-PREVIEW-0000' }
    : challengeFixtures.wom,
);

export const challengeDeclare = (_gameId, value) => {
  if (!challengeFixtures.entry) return noop();
  challengeFixtures.entry = { ...challengeFixtures.entry, declared: value };
  return Promise.resolve(null);
};

export const challengeAddEvidence = (_gameId, phase, url, note) => {
  const entry = challengeFixtures.entry;
  if (!entry) return noop();
  challengeFixtures.entry = {
    ...entry,
    evidence: [...(entry.evidence ?? []), { id: `shot-${++shotSeq}`, phase, url, note }],
  };
  return Promise.resolve(null);
};

// Fire-and-forget in the real client, so it answers rather than refusing:
// the pulse runs on a timer and a rejection every minute is just noise.
export const womPulse = () => Promise.resolve(null);

// Null is "the clock owed nothing", which is the truth here: a fixture's phase
// is whatever the harness was pointed at, and it is not this stub's to move.
export const challengeTick = () => Promise.resolve(null);
