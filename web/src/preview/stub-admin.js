/**
 * An in-memory stand-in for every call the admin console makes, used ONLY by
 * the admin harness (/preview-admin.html). Re-exported through
 * stub-supabase.js, which vite.preview.config.js swaps in for lib/supabase.js.
 *
 * Unlike the evidence fixtures this one keeps state, so the console can be
 * driven: create a game, add teams, draft players, fill the card, start it.
 * It mirrors the server's refusals where the console relies on them to explain
 * itself (start a bingo with an empty team, end time in the past, ...), but it
 * is a sketch of the rules, not the rules -- nothing here tests the SQL.
 *
 * Reload the page to start over.
 */

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();
const pos = (row, col) => (row - 1) * 10 + col;
const wait = (v) => new Promise((resolve) => setTimeout(() => resolve(v), 120));
const fail = (msg) => new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), 120));

// ---- seed ---------------------------------------------------------------

const CATALOGUE = [
  ['Zulrah unique', 'zulrah'], ['Vorkath head', 'vorkath'], ['Any Nex unique', 'nex'],
  ['Kraken tentacle', 'kraken'], ['Cerberus crystal', 'cerberus'], ['Corp sigil', 'corporeal_beast'],
  ['Giant Mole pet', 'giant_mole'], ['Hespori seed', 'hespori'], ['500 Tempoross permits', 'tempoross'],
  ['Dragon warhammer', 'dragon_warhammer'], ['Infernal cape', 'infernal_cape'], ['Twisted bow', 'twisted_bow'],
  ['Sarachnis cudgel', 'sarachnis'], ['Vardorvis axe piece', 'vardorvis'], ['Araxxor fang', 'araxxor'],
  ['Venator shard', 'phantom_muspah'], ['Scurrius spine', 'scurrius'], ['KQ head', 'kalphite_queen'],
  ['Hill giant club', 'obor'], ['Tormented synapse', 'tormented_demon'], ['Zamorak hilt', 'zamorak_hilt'],
  ['Skotizo jar', 'skotizo'], ['Blood fury', 'amulet_of_blood_fury'], ['Avernic treads', 'avernic_treads'],
  ['Bottomless compost bucket', 'bottomless_compost_bucket'], ['Craw\'s bow', 'craws_bow'],
  ['Dagannoth Rex ring', 'dagannoth_rex'], ['Dragon hunter wand', 'dragon_hunter_wand'],
  ['Duke Sucellus unique', 'duke_sucellus'], ['Elidinis\' ward', 'elidinis_ward'],
  ['Enhanced weapon seed', 'enhanced_crystal_weapon_seed'], ['Firemaking pet', 'firemaking_skill'],
  ['Great Olm unique', 'great_olm'], ['Justiciar faceguard', 'justiciar_faceguard'], ['Kephri unique', 'kephri'],
  ['Sanguinesti staff', 'sanguinesti_staff'], ['Slayer helmet', 'slayer_helmet'],
  ['Leviathan unique', 'the_leviathan'], ['Whisperer unique', 'the_whisperer'], ['Voidwaker piece', 'voidwaker'],
  ['Zenyte shard', 'zenyte_shard'], ['Ancestral colour kit', 'twisted_ancestral_colour_kit'],
  ['Barrows: full Verac set', 'verac_the_defiled'], ['Prince black dragon pet', 'prince_black_dragon'],
];

const library = CATALOGUE.map(([name, icon], i) => ({
  id: uid(), name, icon, description: null,
  required_evidence: i % 4 === 0 ? 2 : 1, completion: 'points', per_set: null,
  times_used: (i * 7) % 11, last_used_at: null, options: [],
}));

const PLAYERS = [
  'Sanchez', 'Thammaron', 'Lil Sod', 'Iron Pyro', 'Gim Rocky', 'Zezima Jr', 'B0aty Fan',
  'Mazzy', 'Odablock Lite', 'Skill Specs', 'Moonfang', 'Crab Slayer', 'Barrows Bart',
  'Pet Hunter', 'Rune Rhi', 'Velma', 'Tbow Tom', 'Raid Ronnie', 'Granite Gwen', 'Nexling',
];
const profiles = [
  { id: uid(), display_name: 'HS Organiser', is_admin: true },
  ...PLAYERS.map((display_name) => ({ id: uid(), display_name, is_admin: false })),
];

const games = [];
const teams = [];
const members = [];
const tilesByGame = {};
const webhooks = [];
const presets = [];

function tileFromPayload(gameId, row, col, p, libraryId = null) {
  return {
    id: uid(), row, col, position: pos(row, col),
    name: p.name, icon: p.icon || null,
    required_evidence: p.amount ?? null,
    options: (p.options ?? []).map((o) => ({
      id: uid(), label: o.label, points: o.points ?? 1, grp: o.grp ?? null, max_times: o.maxTimes ?? null,
    })),
    description: p.description ?? null,
    completion: p.rule ?? 'points', per_set: p.perSet ?? null,
    library_id: p.libraryId ?? libraryId, claimed: false,
  };
}

const fromLibrary = (entry, row, col) => ({
  id: uid(), row, col, position: pos(row, col),
  name: entry.name, icon: entry.icon, required_evidence: entry.required_evidence,
  options: entry.options, description: entry.description, completion: entry.completion,
  per_set: entry.per_set, library_id: entry.id, claimed: false,
});

function addGame({ name, mode, grid, status, teamNames, startsAt = null, endsAt = null, fill = 0 }) {
  const id = uid();
  games.unshift({
    id, name, mode, grid_size: grid, status, is_featured: false,
    starts_at: startsAt, ends_at: endsAt, ended_reason: null, winner_team_id: null,
    fleet: mode === 'battleships' ? [5, 4, 3, 3, 2] : [],
    max_active_tiles: mode === 'battleships' ? 3 : 1,
    created_at: now(),
  });
  teamNames.forEach((n, i) => teams.push({ id: uid(), game_id: id, name: n, slot: i + 1 }));
  tilesByGame[id] = [];
  let k = 0;
  for (let row = 1; row <= grid && k < fill; row++) {
    for (let col = 1; col <= grid && k < fill; col++) {
      tilesByGame[id].push(fromLibrary(library[k % library.length], row, col));
      k++;
    }
  }
  return id;
}

// A finished battleships game, so the list shows both modes side by side.
const bs = addGame({
  name: 'Battleships V4', mode: 'battleships', grid: 10, status: 'finished',
  teamNames: ['Team Alpha', 'Team Bravo'], fill: 100,
});
games.find((g) => g.id === bs).winner_team_id = teams.find((t) => t.game_id === bs).id;

// A bingo being set up: half a card, four teams, one of them still empty.
const bingo = addGame({
  name: 'Clan Bingo — Autumn', mode: 'bingo', grid: 5, status: 'setup',
  teamNames: ['Kandarin', 'Misthalin', 'Asgarnia', 'Morytania'],
  startsAt: inHours(48), endsAt: inHours(48 + 24 * 7), fill: 13,
});
teams.filter((t) => t.game_id === bingo).slice(0, 3).forEach((t, i) => {
  PLAYERS.slice(i * 4, i * 4 + 4).forEach((name, j) => {
    const p = profiles.find((x) => x.display_name === name);
    members.push({ team_id: t.id, profile_id: p.id, role: j === 0 ? 'captain' : 'member' });
  });
});

// ---- helpers --------------------------------------------------------------

const game = (id) => games.find((g) => g.id === id);
const teamsOf = (id) => teams.filter((t) => t.game_id === id);
const tilesOf = (id) => (tilesByGame[id] ??= []);
const isBingo = (g) => g?.mode === 'bingo';

function removeTeam(teamId) {
  const i = teams.findIndex((t) => t.id === teamId);
  if (i >= 0) teams.splice(i, 1);
  for (let j = members.length - 1; j >= 0; j--) if (members[j].team_id === teamId) members.splice(j, 1);
}

// ---- the table reads Admin.jsx makes directly ------------------------------

const TABLES = {
  games: () => games,
  teams: () => [...teams].sort((a, b) => a.slot - b.slot),
  profiles: () => [...profiles].sort((a, b) => a.display_name.localeCompare(b.display_name)),
  team_members: () => members,
};

/**
 * Canned rows for a table, in place of the console's seeded ones. The login
 * harness (login-main.jsx) uses it to put events on the front page.
 */
export const tableFixtures = {};

/**
 * `supabase.from(t).select(...).order(...)`, resolved straight from memory.
 * `in` and `limit` are honoured because the login page's list depends on
 * them; `eq` and `order` stay no-ops, as the console never needed more.
 */
export function adminFrom(table) {
  const filters = [];
  let max = Infinity;
  const q = {
    select: () => q, order: () => q, eq: () => q,
    in: (col, values) => { filters.push((r) => values.includes(r[col])); return q; },
    limit: (n) => { max = n; return q; },
    then: (resolve) => {
      const rows = tableFixtures[table] ?? TABLES[table]?.() ?? [];
      const data = rows.filter((r) => filters.every((f) => f(r))).slice(0, max);
      return resolve({ data: structuredClone(data), error: null });
    },
  };
  return q;
}

/** RPCs the Track pane calls through `supabase.rpc`. */
export const adminRpc = {
  admin_tile_progress: ({ p_game_id }) => teamsOf(p_game_id).flatMap((t) => tilesOf(p_game_id).map((tile) => ({
    team_id: t.id, team_name: t.name, tile_id: tile.id, position: tile.position,
    tile_name: tile.name, required_evidence: tile.required_evidence ?? 1,
    claim_id: null, status: null, result: null,
    evidence_count: 0, evidence_points: 0, option_count: tile.options.length, completion: tile.completion,
  }))),
  bingo_standings: ({ p_game_id }) => teamsOf(p_game_id).map((t, i) => ({
    team_id: t.id, team_name: t.name, slot: t.slot, tiles_completed: 0,
    tiles_total: tilesOf(p_game_id).length, last_completed_at: null, completed_tile_ids: [], place: i + 1,
  })),
};

// ---- games ---------------------------------------------------------------

export const adminCreateGame = (name, a, b) =>
  wait(addGame({ name, mode: 'battleships', grid: 10, status: 'setup', teamNames: [a, b] }));

export function adminNewGame({ name, mode, teams: names, gridSize = 10, endsAt = null }) {
  if (mode === 'battleships') return adminCreateGame(name, names[0], names[1]);
  if (!names.length) return fail('A bingo needs at least one team');
  if (gridSize < 3 || gridSize > 10) return fail('A bingo card is 3×3 to 10×10');
  if (endsAt && Date.parse(endsAt) <= Date.now()) return fail('The end time is in the past');
  return wait(addGame({ name, mode, grid: gridSize, status: 'setup', teamNames: names, endsAt }));
}

export function adminDeleteGame(id) {
  const i = games.findIndex((g) => g.id === id);
  if (i >= 0) games.splice(i, 1);
  teamsOf(id).forEach((t) => removeTeam(t.id));
  delete tilesByGame[id];
  return wait(null);
}

export function adminSetFeaturedGame(id) {
  games.forEach((g) => { g.is_featured = g.id === id; });
  return wait(null);
}

export function adminOpenPlacement(id) {
  const g = game(id);
  if (g.status !== 'setup') return fail(`Game is already ${g.status}`);
  g.status = 'placement';
  return wait(null);
}

export function adminSetStartTime(id, iso) { game(id).starts_at = iso; return wait(null); }

export function adminSetEndTime(id, iso) {
  if (iso && Date.parse(iso) <= Date.now()) {
    return fail('The end time is in the past — use "End game now" to end it');
  }
  game(id).ends_at = iso;
  return wait(null);
}

export function startGame(id) {
  const g = game(id);
  const ts = teamsOf(id);
  const need = g.grid_size * g.grid_size;
  if (tilesOf(id).length !== need) return fail(`The board has ${tilesOf(id).length} of ${need} tiles`);
  if (isBingo(g)) {
    if (!ts.length) return fail('A bingo needs at least one team');
    const empty = ts.find((t) => !members.some((m) => m.team_id === t.id));
    if (empty) return fail(`${empty.name} has no players yet — add them in the roster`);
    if (g.ends_at && Date.parse(g.ends_at) <= Date.now()) return fail('The end time has already passed');
  } else if (g.status !== 'placement') {
    return fail('Open preparation first');
  }
  g.status = 'active';
  g.started_at = now();
  return wait(null);
}

export function adminEndGame(id) {
  const g = game(id);
  if (g.status !== 'active') return fail('Only a running game can be ended');
  Object.assign(g, { status: 'finished', ended_reason: 'admin', winner_team_id: null, ended_at: now() });
  return wait(null);
}

export function adminResetGame(id) {
  Object.assign(game(id), { status: 'placement', winner_team_id: null, ended_reason: null });
  return wait(null);
}

export const adminGameReadiness = () => wait(games.map((g) => ({
  game_id: g.id, tile_count: tilesOf(g.id).length, tiles_needed: g.grid_size * g.grid_size,
  teams_with_full_fleet: 0, webhook_count: webhooks.filter((w) => w.game_id === g.id).length,
})));

// ---- teams and roster -------------------------------------------------------

export function adminAddTeam(gameId, name) {
  const ts = teamsOf(gameId);
  if (ts.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
    return fail(`There is already a team called ${name}`);
  }
  teams.push({ id: uid(), game_id: gameId, name, slot: Math.max(0, ...ts.map((t) => t.slot)) + 1 });
  return wait(null);
}

export function adminDeleteTeam(teamId) { removeTeam(teamId); return wait(null); }

export function renameTeam(teamId, name) {
  teams.find((t) => t.id === teamId).name = name;
  return wait(null);
}

export function adminSetMember(teamId, profileId, role) {
  const m = members.find((x) => x.team_id === teamId && x.profile_id === profileId);
  if (m) m.role = role;
  else members.push({ team_id: teamId, profile_id: profileId, role });
  return wait(null);
}

export function adminRemoveMember(teamId, profileId) {
  const i = members.findIndex((x) => x.team_id === teamId && x.profile_id === profileId);
  if (i >= 0) members.splice(i, 1);
  return wait(null);
}

// ---- the board -------------------------------------------------------------

export const adminListTiles = (id) => wait(structuredClone(tilesOf(id)));

export function adminSetTile(gameId, row, col, payload) {
  const list = tilesOf(gameId);
  const i = list.findIndex((t) => t.row === row && t.col === col);
  const tile = tileFromPayload(gameId, row, col, payload);
  if (i >= 0) list[i] = tile; else list.push(tile);
  return wait(tile.id);
}

export function adminClearTile(gameId, row, col) {
  const list = tilesOf(gameId);
  const i = list.findIndex((t) => t.row === row && t.col === col);
  if (i >= 0) list.splice(i, 1);
  return wait(null);
}

export function adminClearBoard(gameId) {
  const n = tilesOf(gameId).length;
  tilesByGame[gameId] = [];
  return wait(n);
}

export function adminAutofillBoard(gameId) {
  const g = game(gameId);
  const list = tilesOf(gameId);
  const used = new Set(list.map((t) => t.library_id));
  const pool = library.filter((e) => !used.has(e.id)).sort(() => Math.random() - .5);
  let empty = 0;
  let filled = 0;
  for (let row = 1; row <= g.grid_size; row++) {
    for (let col = 1; col <= g.grid_size; col++) {
      if (list.some((t) => t.row === row && t.col === col)) continue;
      empty++;
      const entry = pool.shift();
      if (entry) { list.push(fromLibrary(entry, row, col)); filled++; }
    }
  }
  return wait({ filled, empty, pool: filled + pool.length, similar: 0 });
}

export function adminShuffleBoard(gameId) {
  const list = tilesOf(gameId);
  const spots = list.map((t) => [t.row, t.col]).sort(() => Math.random() - .5);
  let moved = 0;
  list.forEach((t, i) => {
    const [row, col] = spots[i];
    if (row !== t.row || col !== t.col) moved++;
    Object.assign(t, { row, col, position: pos(row, col) });
  });
  return wait({ moved, tiles: list.length });
}

export const adminListBoardPresets = () => wait(presets.map(({ tiles, ...p }) => p));

export function adminSaveBoardPreset(gameId, name) {
  const g = game(gameId);
  const existing = presets.find((p) => p.name === name);
  const snap = structuredClone(tilesOf(gameId));
  if (existing) Object.assign(existing, { tiles: snap, squares: snap.length, grid_size: g.grid_size, updated_at: now() });
  else presets.unshift({ id: uid(), name, grid_size: g.grid_size, squares: snap.length, tiles: snap,
                         created_at: now(), updated_at: now(), created_by_name: 'HS Organiser' });
  return wait({ name, squares: snap.length });
}

export function adminApplyBoardPreset(gameId, presetId) {
  const p = presets.find((x) => x.id === presetId);
  if (p.grid_size !== game(gameId).grid_size) {
    return fail(`That board is ${p.grid_size}×${p.grid_size}; this game is not`);
  }
  tilesByGame[gameId] = structuredClone(p.tiles).map((t) => ({ ...t, id: uid() }));
  return wait({ name: p.name, placed: p.squares });
}

export function adminDeleteBoardPreset(id) {
  presets.splice(presets.findIndex((p) => p.id === id), 1);
  return wait(null);
}

export const adminTestTile = () => fail('Test submit needs the database — not available in the harness.');

// ---- the catalogue -------------------------------------------------------

export const adminListLibrary = () => wait(structuredClone(library));

export function adminSaveLibraryTile(id, p) {
  const row = {
    name: p.name, icon: p.icon || null, description: p.description ?? null,
    required_evidence: p.amount ?? null, completion: p.rule ?? 'points', per_set: p.perSet ?? null,
    options: (p.options ?? []).map((o) => ({ label: o.label, points: o.points ?? 1, grp: o.grp ?? null, max_times: o.maxTimes ?? null })),
  };
  if (id) { Object.assign(library.find((e) => e.id === id), row); return wait(id); }
  const entry = { id: uid(), times_used: 0, last_used_at: null, ...row };
  library.unshift(entry);
  return wait(entry.id);
}

export function adminDeleteLibraryTile(id) {
  library.splice(library.findIndex((e) => e.id === id), 1);
  return wait(null);
}

// ---- everything else the console touches -----------------------------------

export const adminListWebhooks = (gameId) => wait(webhooks.filter((w) => w.game_id === gameId));
export function adminSetWebhook(gameId, teamId, url, enabled = true) {
  const w = webhooks.find((x) => x.game_id === gameId && x.team_id === (teamId ?? null));
  if (w) Object.assign(w, { url, enabled });
  else webhooks.push({ id: uid(), game_id: gameId, team_id: teamId ?? null, url, enabled, created_at: now() });
  return wait(null);
}
export function adminDeleteWebhook(id) {
  webhooks.splice(webhooks.findIndex((w) => w.id === id), 1);
  return wait(null);
}

export const adminListPetJars = () => wait([]);
export const adminRevokePetJar = () => fail('Not available in the harness.');
export const adminResetPassword = () => fail('Passwords are not available in the harness.');
export const adminListPasswordResets = () => wait([]);
export const adminDeleteAccount = () => fail('Accounts are not available in the harness.');
export const adminListAccountDeletions = () => wait([]);
