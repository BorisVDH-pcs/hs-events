// Territory rules. Pure functions only, so scripts/territory-selftest.mjs can
// run them under plain Node. The map itself is in territoryWorld.js.
//
// The rules in one breath (docs/territory-rules.md has the long form):
//   * every team starts on a home place that has no task and cannot be taken;
//   * a team may open a place linked to one it holds, at most MAX_OPEN at once;
//   * finishing a place's task when you do not own it makes it yours, free or
//     not -- capturing and stealing are the same rule, at the same target;
//   * when the timer runs out, the highest score wins: places held plus a bonus
//     for every region held whole. Ties go to whoever made their last capture
//     first.
//
// Shapes used throughout:
//   owners    Map placeKey -> teamId, homes included
//   homes     Map teamId -> placeKey
//   captures  [{ place, team_id, from_team_id, at }] oldest first
//   bonuses   Map regionKey -> points for holding it whole

import { DEFAULT_HOMES, LINKS, PLACES, REGIONS, defaultBonus } from './territoryWorld.js';

/** Places a team may have in progress at once. */
export const MAX_OPEN = 2;

export const placeByKey = new Map(PLACES.map((p) => [p.key, p]));
export const placeByIndex = new Map(PLACES.map((p) => [p.index, p]));

// THE TASK LIST IS AN 8x8 CARD. Every place's task is a tile, and the 64
// places fill an 8x8 card exactly, place 1 top left, reading order. So a
// Territory game is stored as a bingo card of grid_size 8, and everything the
// console already does to a card -- deal it at random from the catalogue,
// save and load it as a template, check it is full -- works on it unchanged.
// Positions keep the 10-column numbering every mode shares (lib/board.js), so
// place 9 is position 11, not 9.
export const TASK_GRID = 8;

/** The tile position that holds a place's task. */
export function placePosition(place) {
  const i = (typeof place === 'string' ? placeByKey.get(place) : place).index - 1;
  return Math.floor(i / TASK_GRID) * 10 + (i % TASK_GRID) + 1;
}

/** The place whose task sits at a tile position, or undefined. */
export function placeAtPosition(position) {
  const row = Math.floor((position - 1) / 10);
  const col = (position - 1) % 10;
  if (col >= TASK_GRID) return undefined;
  return placeByIndex.get(row * TASK_GRID + col + 1);
}

/**
 * The organiser's homes until they choose: team slot 1 gets the first
 * suggested home, slot 2 the second, and so on. Map teamId -> placeKey.
 */
export function defaultHomes(teams) {
  return new Map([...teams].sort((a, b) => a.slot - b.slot)
    .map((t, i) => [t.id, DEFAULT_HOMES[i % DEFAULT_HOMES.length]]));
}

/**
 * Each team's home: the one the organiser picked (`team.home`, a place key),
 * or else the first suggested home nobody else has, by slot. Map teamId ->
 * placeKey.
 */
export function teamHomes(teams) {
  const sorted = [...teams].sort((a, b) => a.slot - b.slot);
  const taken = new Set();
  const picked = new Map();
  for (const t of sorted) {
    if (t.home && placeByKey.has(t.home) && !taken.has(t.home)) {
      picked.set(t.id, t.home);
      taken.add(t.home);
    }
  }
  const spare = [...DEFAULT_HOMES, ...PLACES.map((p) => p.key)].filter((k) => !taken.has(k));
  return new Map(sorted.map((t) => [t.id, picked.get(t.id) ?? spare.shift()]));
}

const NEIGHBOURS = new Map(PLACES.map((p) => [p.key, []]));
for (const [a, b, kind] of LINKS) {
  NEIGHBOURS.get(a)?.push({ key: b, kind });
  NEIGHBOURS.get(b)?.push({ key: a, kind });
}

/** The places linked to `key`, each with how the link travels. */
export function neighbours(key) {
  return NEIGHBOURS.get(key) ?? [];
}

/** Does `teamId` hold a place linked to `key`? */
export function touches(teamId, key, owners) {
  return neighbours(key).some((n) => owners.get(n.key) === teamId);
}

export const isHome = (key, homes) => [...homes.values()].includes(key);

const nameOf = (key) => placeByKey.get(key)?.name ?? key;

/** "A", "A and B", "A, B and C", "A, B, C and 4 more". */
function nameList(keys) {
  const names = keys.map(nameOf);
  if (names.length > 4) names.splice(3, names.length - 3, `${names.length - 3} more`);
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** Every place a team starting at `home` can ever get to: never through another home. */
export function reachable(home, homes) {
  const walls = new Set(homes.values());
  const seen = new Set([home]);
  const queue = [home];
  while (queue.length) {
    for (const n of neighbours(queue.shift())) {
      if (!walls.has(n.key) && !seen.has(n.key)) { seen.add(n.key); queue.push(n.key); }
    }
  }
  return seen;
}

/**
 * Why the organiser cannot use these homes, or null when they can.
 *
 * A home can never be taken, so to every other team it is a wall. Homes are
 * refused when, together, they would wall any place off from any team: every
 * team must be able to reach every place that is not a home, for the whole
 * game. Two teams on one home is refused too. `homes` is Map teamId ->
 * placeKey; `teamName` words a team id for the message.
 */
export function homesProblem(homes, teamName = (id) => id) {
  const keys = [...homes.values()];
  const unknown = keys.find((k) => !placeByKey.has(k));
  if (unknown) return `${unknown} is not a place on the map.`;
  const twice = keys.find((k, i) => keys.indexOf(k) !== i);
  if (twice) return `Two teams have ${nameOf(twice)} as their home. Every team needs its own.`;
  const walls = new Set(keys);
  for (const [teamId, home] of homes) {
    const seen = reachable(home, homes);
    const cut = PLACES.filter((p) => !walls.has(p.key) && !seen.has(p.key)).map((p) => p.key);
    if (!cut.length) continue;
    const through = [...new Set(cut.flatMap((k) => neighbours(k).map((n) => n.key)))]
      .filter((k) => walls.has(k) && k !== home);
    return `${teamName(teamId)} could never reach ${nameList(cut)}: the only way in is through `
      + `${nameList(through)}, ${through.length === 1 ? 'a home' : 'homes'} that cannot be taken. `
      + 'Pick another home there.';
  }
  return null;
}

/**
 * Why `teamId` may not open `key`, or null when it may.
 *
 * `open` is the set of places the team already has in progress. A place
 * already in it is always allowed: that is the team carrying on, not opening.
 * The server asks the same questions and is the authority; this exists so the
 * map can grey out what would only be refused.
 */
export function openRefusal({ teamId, key, owners, homes, open, status }) {
  if (!teamId) return 'You are not on a team in this game.';
  if (status !== 'active') return 'The map opens when the game starts.';
  if (isHome(key, homes)) {
    return homes.get(teamId) === key
      ? 'This is your home. It is yours for the whole game.'
      : 'A home cannot be taken.';
  }
  if (owners.get(key) === teamId) return `Your team already holds ${nameOf(key)}.`;
  if (open.has(key)) return null;
  if (open.size >= MAX_OPEN) {
    return `Your team is already working on ${MAX_OPEN} places. Finish one first.`;
  }
  if (!touches(teamId, key, owners)) {
    return `${nameOf(key)} is not linked to your land.`;
  }
  return null;
}

/**
 * How a place looks to the team viewing it. One of:
 *   'home'      -- the viewer's home
 *   'home-rival'-- someone else's home
 *   'mine'      -- held by the viewer
 *   'rival'     -- held by another team
 *   'free'      -- nobody holds it
 * plus flags the map draws on top: `openable` (would be allowed), `working`
 * (the viewer has it in progress) and `attacked` (a rival is working on a place
 * the viewer holds).
 */
export function placeState({ key, teamId, owners, homes, open, attacked, status }) {
  const owner = owners.get(key) ?? null;
  let kind = 'free';
  if (isHome(key, homes)) kind = homes.get(teamId) === key ? 'home' : 'home-rival';
  else if (owner && owner === teamId) kind = 'mine';
  else if (owner) kind = 'rival';
  return {
    kind,
    owner,
    working: open.has(key),
    openable: !open.has(key) && openRefusal({ teamId, key, owners, homes, open, status }) === null,
    attacked: kind === 'mine' && attacked.has(key),
  };
}

/** The bonus for each region, defaulted from its size. */
export function defaultBonuses() {
  return new Map(REGIONS.map((r) => [r.key, defaultBonus(r.key)]));
}

/** Map regionKey -> teamId for every region one team holds whole. */
export function regionHolders(owners) {
  const out = new Map();
  for (const region of REGIONS) {
    const places = PLACES.filter((p) => p.region === region.key);
    const first = owners.get(places[0]?.key);
    if (first && places.every((p) => owners.get(p.key) === first)) out.set(region.key, first);
  }
  return out;
}

/**
 * The scoreboard, best first. Each row:
 *   { team_id, places, regions: [regionKey], bonus, score, last_capture_at }
 *
 * Ties go to the team whose last capture came FIRST: it reached its score
 * earlier and held it. A team that never captured anything has no last
 * capture and sorts after any team on the same score that did -- its score is
 * only its home, and a capture is what earns a place in a tie. Then by slot,
 * so the order never wobbles.
 */
export function standings(teams, owners, captures, bonuses = defaultBonuses()) {
  const held = regionHolders(owners);
  const rows = teams.map((t) => {
    const places = [...owners.values()].filter((id) => id === t.id).length;
    const regions = [...held].filter(([, id]) => id === t.id).map(([key]) => key);
    const bonus = regions.reduce((sum, key) => sum + (bonuses.get(key) ?? 0), 0);
    const mine = captures.filter((c) => c.team_id === t.id);
    return {
      team_id: t.id,
      slot: t.slot,
      places,
      regions,
      bonus,
      score: places + bonus,
      last_capture_at: mine.length ? mine[mine.length - 1].at : null,
    };
  });
  const time = (r) => (r.last_capture_at ? Date.parse(r.last_capture_at) : Infinity);
  return rows.sort((a, b) => b.score - a.score || time(a) - time(b) || a.slot - b.slot);
}

/**
 * Apply a finished task: `teamId` now holds `key`. Returns the new owners and
 * the capture record, whose `from_team_id` says whether it was a steal.
 * Refuses homes and places the team already holds, which the server refuses
 * too.
 */
export function capture(owners, homes, key, teamId, at = new Date().toISOString()) {
  if (isHome(key, homes)) throw new Error('A home cannot be taken.');
  const from = owners.get(key) ?? null;
  if (from === teamId) throw new Error('Already held.');
  const next = new Map(owners);
  next.set(key, teamId);
  return { owners: next, record: { place: key, team_id: teamId, from_team_id: from, at } };
}

/** The finished-game banner, in words. Reads the winner off the game row. */
export function resultText(game, teams) {
  if (game?.status !== 'finished') return null;
  const winner = teams.find((t) => t.id === game.winner_team_id)?.name;
  if (!winner) return 'The game is over.';
  return game.ended_reason === 'time_up'
    ? `Time's up — ${winner} rules the most land and wins!`
    : `The game is over — ${winner} wins.`;
}

/**
 * The feed line for a territory event, or null for anything this mode does not
 * word -- EventFeed then falls through to its own lines, as it does for snakes.
 * Places are public, so naming them gives nothing away.
 */
export function territoryEventText(e, who) {
  const p = e.payload ?? {};
  const place = placeByKey.get(p.place)?.name ?? 'a place';
  switch (e.type) {
    case 'tile_captured':
      return p.from_team_name
        ? `${who} took ${place} from ${p.from_team_name}!`
        : `${who} captured ${place}.`;
    case 'tile_attacked':
      return `${who} is attacking ${place}, held by ${p.owner_team_name ?? 'another team'}.`;
    case 'tile_dropped':
      return `${who} gave up on ${place}.`;
    case 'game_started':
      return p.mode === 'territory' ? 'The conquest has begun — every team marches out from home.' : null;
    case 'game_ended':
      if (p.mode !== 'territory') return null;
      return `${p.reason === 'time_up' ? "Time's up!" : 'The organiser ended the game.'}`
        + ` ${who} wins with ${p.score} points.`;
    default:
      return null;
  }
}

/** "12 places + 6 bonus" -- how a score reads in the standings. */
export function scoreLabel(row) {
  const places = `${row.places} place${row.places === 1 ? '' : 's'}`;
  return row.bonus ? `${places} + ${row.bonus} bonus` : places;
}
