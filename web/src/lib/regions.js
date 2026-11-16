// Region Bingo helpers. Pure functions only, so scripts/regions-selftest.mjs
// can run them under plain Node. The rules are docs/region-bingo-rules.md; the
// server (20261116120100_regions_mode.sql) decides everything, and this file
// only words and draws what it is handed.
//
// THE BOARD gives each of the eleven Leagues regions a block of a hundred
// squares, in REGIONS order: Misthalin owns squares 1-100, Asgarnia 101-200,
// ... Varlamore 1001-1100. A square is still (row - 1) * 10 + col, ten to a
// row, so a region game runs to row 110. The organiser never sees squares:
// the builder adds a task to a region and takes the next free one. The server
// keys a tile's region on its square the same way (regions_region_at, see
// 20261116150000), so the two must never disagree; the self-test pins it.

import { REGIONS } from './territoryWorld.js';

export { REGIONS };

/** Squares (so tasks) per region, the last square, and the rows they take. */
export const PER_REGION = 100;
export const LAST_SQUARE = REGIONS.length * PER_REGION; // 1100
export const LAST_ROW = LAST_SQUARE / 10; // 110

export const regionByKey = new Map(REGIONS.map((r, i) => [r.key, { ...r, sort: i + 1 }]));

/** The region a square belongs to, or null (off the board). */
export function regionAt(position) {
  if (!Number.isInteger(position) || position < 1 || position > LAST_SQUARE) return null;
  return REGIONS[Math.floor((position - 1) / PER_REGION)].key;
}

/** A region's squares, in order. */
export function squaresOf(key) {
  const sort = regionByKey.get(key)?.sort;
  if (!sort) return [];
  return Array.from({ length: PER_REGION }, (_, i) => (sort - 1) * PER_REGION + i + 1);
}

/**
 * The square a new task in region `key` goes on: the one after its last task,
 * so tasks keep the order they were added in, or the first gap once the
 * region's last square is taken. Null when the region is full.
 */
export function nextSquareIn(tiles, key) {
  const squares = squaresOf(key);
  if (!squares.length) return null;
  const taken = new Set((tiles ?? []).map((t) => t.position));
  const used = squares.filter((p) => taken.has(p));
  const after = used.length ? used[used.length - 1] + 1 : squares[0];
  if (after <= squares[squares.length - 1] && !taken.has(after)) return after;
  return squares.find((p) => !taken.has(p)) ?? null;
}

/** The tiles in region `key`, in square order. */
export function tilesIn(tiles, key) {
  return (tiles ?? []).filter((t) => regionAt(t.position) === key)
    .sort((a, b) => a.position - b.position);
}

/** What a team needs in a region: x% of its points, rounded up. 50% of 15 is 8. */
export function needFor(total, threshold) {
  return Math.floor((total * threshold + 99) / 100);
}

/** "1 point", "5 points". */
export const pts = (n) => `${n} point${n === 1 ? '' : 's'}`;

/** What a tile with no picture shows: its first letter, never a digit (that
    would read as its worth beside the points pill). */
export const tileInitial = (name) => (name?.match(/\p{L}/u)?.[0] ?? '•').toUpperCase();

/** "3 picks", "a pick". */
const picksWord = (n) => (n === 1 ? 'a pick' : `${n} picks`);

/**
 * Where a region stands for the team looking at it:
 *   'locked'   -- not opened; its tiles are hidden
 *   'open'     -- opened, below the line
 *   'complete' -- over the line, its pick not spent yet
 *   'spent'    -- over the line and its pick already spent
 */
export function regionStatus(r) {
  if (!r?.opened) return 'locked';
  if (r.funds) return 'spent';
  if (r.complete) return 'complete';
  return 'open';
}

/**
 * The caption under a region's bar (RegionBar): where its line is, and
 * whether the team has reached it. "New region at 5 pts · 2 to go".
 */
export function lineNote(r) {
  if (r?.need == null) return null;
  const points = r.points ?? 0;
  return points >= r.need
    ? `New region at ${r.need} pts ✓`
    : `New region at ${r.need} pts · ${r.need - points} to go`;
}

/** How far a region is towards its line, 0 to 1. */
export function progress(r) {
  if (!r?.need) return r?.complete ? 1 : 0;
  return Math.min(1, (r.points ?? 0) / r.need);
}

/**
 * The board as the server sends it (board_for_me: `tiles`, `standings` and
 * the `regions` object from regions_state), in the shape RegionsGame draws.
 *
 *   regions   Map key -> the region, with its visible tiles and, once opened,
 *             points / need / total
 *   tiles     the visible tiles, each with its `worth` and `region`
 */
export function fromServer({ tiles, regions }) {
  const worth = regions?.worth ?? {};
  const shaped = (tiles ?? []).map((t) => ({
    ...t,
    worth: Number(worth[String(t.position)] ?? t.worth ?? 1),
    region: regionAt(t.position),
  }));
  const byKey = new Map((regions?.regions ?? []).map((r) => [r.key, r]));
  const map = new Map(REGIONS.map((base, i) => {
    const r = byKey.get(base.key) ?? { key: base.key, opened: false };
    return [base.key, {
      key: base.key,
      name: base.name,
      sort: i + 1,
      opened: Boolean(r.opened),
      openedAt: r.opened_at ?? null,
      fundedBy: r.funded_by ?? null,
      complete: Boolean(r.complete),
      funds: Boolean(r.funds),
      points: r.points ?? null,
      need: r.need ?? null,
      total: r.total ?? null,
      tileCount: r.tiles ?? null,
      tiles: shaped.filter((t) => t.region === base.key).sort((a, b) => a.position - b.position),
    }];
  }));
  return {
    threshold: regions?.threshold ?? 50,
    isCaptain: Boolean(regions?.is_captain),
    needsStart: Boolean(regions?.needs_start),
    picks: regions?.picks ?? 0,
    regions: map,
    tiles: shaped,
  };
}

/** Whether a running game's timer has passed. A game with no timer never has. */
export function timeIsUp(game, now = Date.now()) {
  return Boolean(game?.ends_at) && Date.parse(game.ends_at) <= now;
}

/**
 * Why my team cannot open this region now, or null when it can. The server
 * re-checks every word of it (regions_pick).
 */
export function pickRefusal({ game, view, regionKey, myTeamId, now = Date.now() }) {
  if (!myTeamId) return 'Only players in this game can pick regions.';
  if (game?.status !== 'active') return 'Regions are picked while the game runs.';
  if (timeIsUp(game, now)) return 'Time is up — no more picks.';
  const r = view?.regions.get(regionKey);
  if (!r) return 'No such region.';
  if (r.opened) return null; // not a pick at all; the panel shows the tiles
  if (view.needsStart) {
    return view.isCaptain ? null : 'Your captain picks your team’s first region.';
  }
  if (view.picks < 1) {
    return `No pick yet — reach ${view.threshold}% of a region’s points to earn one.`;
  }
  return null;
}

/**
 * The region that will pay for the next pick: the first complete one, in map
 * order, that has not paid before -- the same one the server takes.
 */
export function payingRegion(view) {
  return [...(view?.regions.values() ?? [])].find((r) => r.opened && r.complete && !r.funds) ?? null;
}

/** The words for the confirm dialog that guards every pick. */
export function pickConfirm(view, regionKey) {
  const r = view.regions.get(regionKey);
  if (view.needsStart) {
    return {
      title: `Start in ${r.name}?`,
      body: `${r.name} becomes your team’s first region and its tiles appear for everyone on your team. `
        + 'This cannot be undone.',
      confirmLabel: `Start in ${r.name}`,
    };
  }
  const pay = payingRegion(view);
  return {
    title: `Open ${r.name}?`,
    body: `This spends the pick ${pay ? `${pay.name} earned` : 'your team earned'}`
      + `${view.picks > 1 ? ` (you have ${view.picks})` : ''}. ${r.name}’s tiles appear for your whole team, `
      + 'and the pick cannot be taken back.',
    confirmLabel: `Open ${r.name}`,
  };
}

/** The one line that tells a player what to do next. */
export function nextStep(view, game, myTeamId) {
  if (!myTeamId || !view) return null;
  if (game?.status === 'finished') return null;
  if (game?.status !== 'active') return 'The regions open when the organiser starts the game.';
  if (view.needsStart) {
    return view.isCaptain
      ? 'Pick your team’s first region on the map.'
      : 'Waiting for your captain to pick your first region.';
  }
  if (view.picks > 0) return `You have ${picksWord(view.picks)} — choose a new region on the map.`;
  return `Reach ${view.threshold}% of a region’s points to open another.`;
}

/** The finished-game banner, in words. Reads the winner off the game row. */
export function resultText(game, teams, standings = []) {
  if (game?.status !== 'finished') return null;
  const winner = teams.find((t) => t.id === game.winner_team_id)?.name;
  if (!winner) {
    return game.ended_reason === 'time_up'
      ? "Time's up — nobody scored, so nobody wins."
      : 'The game is over — nobody scored, so nobody wins.';
  }
  const points = standings.find((s) => s.team_id === game.winner_team_id)?.points;
  const tail = points != null ? ` with ${pts(points)}` : '';
  return game.ended_reason === 'time_up'
    ? `Time's up — ${winner} wins${tail}!`
    : `The game is over — ${winner} wins${tail}.`;
}

/**
 * The feed line for a region event, or null for anything this mode does not
 * word (EventFeed then falls through to its shared lines). Public events never
 * name a tile: other teams must not learn the tasks of a region they have not
 * opened. `tileName`, when given, names it for the team that completed it.
 */
export function regionsEventText(e, who, tileName = () => null) {
  const p = e.payload ?? {};
  if (p.mode !== 'regions') return null;
  const region = p.region_name ?? regionByKey.get(p.region)?.name ?? 'a region';
  switch (e.type) {
    case 'region_opened':
      return p.first ? `${who} starts in ${region}.` : `${who} opened ${region}.`;
    case 'region_completed':
      return `${who} reached ${p.threshold}% of ${region}`
        + (p.can_pick === false ? '.' : ' and can pick a new region.');
    case 'tile_completed': {
      const name = tileName(p.tile_id);
      return `${who} completed ${name ? `“${name}”` : 'a tile'} in ${region} (+${p.worth}) — ${pts(Number(p.points))}.`;
    }
    case 'game_started':
      return 'Region Bingo has begun — captains, pick your team’s first region.';
    case 'game_ended':
      return `${p.reason === 'time_up' ? "Time's up!" : 'The organiser ended the game.'}`
        + (e.team_id ? ` ${who} wins with ${pts(Number(p.points))}.` : ' Nobody scored, so nobody wins.');
    case 'game_reset':
      return 'Region Bingo has been reset — every region is locked again.';
    default:
      return null;
  }
}

// ---- The organiser's side ----

/**
 * The board as the organiser builds it: every region with its squares,
 * the tile on each (or null), and its points. `tiles` are admin_list_tiles
 * rows; `worths` is admin_tile_worths as a Map position -> worth.
 */
export function builderRegions(tiles, worths = new Map(), threshold = 50) {
  const byPos = new Map((tiles ?? []).map((t) => [t.position, t]));
  return REGIONS.map((r) => {
    const squares = squaresOf(r.key).map((position) => {
      const tile = byPos.get(position) ?? null;
      return { position, tile, worth: tile ? Number(worths.get(position) ?? tile.worth ?? 1) : null };
    });
    const filled = squares.filter((s) => s.tile);
    const total = filled.reduce((sum, s) => sum + s.worth, 0);
    return { ...r, squares, count: filled.length, total, need: needFor(total, threshold) };
  });
}

/**
 * What stops the game starting, as the organiser's checklist shows it. The
 * same checks as regions_start_problem, less the captains (the roster step
 * covers those).
 */
export function boardProblems(tiles) {
  const out = [];
  if ((tiles ?? []).some((t) => t.position > LAST_SQUARE)) {
    out.push('A tile sits past Varlamore’s last square, in no region — clear it.');
  }
  const filled = new Set((tiles ?? []).map((t) => regionAt(t.position)).filter(Boolean));
  const empty = REGIONS.filter((r) => !filled.has(r.key)).map((r) => r.name);
  if (empty.length) out.push(`Every region needs at least one tile. Still empty: ${empty.join(', ')}.`);
  return out;
}

/** Teams with nobody marked captain: they could never pick a first region. */
export function teamsWithoutCaptain(teams, members) {
  const led = new Set((members ?? []).filter((m) => m.role === 'captain').map((m) => m.team_id));
  return (teams ?? []).filter((t) => !led.has(t.id));
}
