// Snakes and Ladders helpers. Pure functions only, so scripts/snakes-selftest.mjs
// can run them under plain Node.
//
// TILE NUMBERS. The database numbers tiles 1-100 with `tiles.position`, and
// that number IS the square on the snake path: nothing is converted on the
// way in. Only the drawing differs from bingo: tile 1 is bottom-left, the
// bottom row runs left to right, the next one right to left, and so on up to
// 100 at the top-left, like the board game.
//
// The server decides every move (20261002120100, snakes_move). What lives
// here is reading its answer back: where a square is drawn, how a marker walks
// to where the server put it, and the words the feed uses.
//
// SNAKES AND LADDERS are one list of jumps, { from, to }: going down is a
// snake, going up a ladder. Landing on `from` moves a team straight on, so
// nobody ever stands there and those squares carry no task.

export const BOARD_SIZE = 10;
export const LAST_TILE = 100;

/** Where tile n sits on screen: row 1 is the top row, col 1 the left column. */
export function tileCell(n) {
  const i = n - 1;
  const fromBottom = Math.floor(i / BOARD_SIZE);
  const along = i % BOARD_SIZE;
  const col = fromBottom % 2 === 0 ? along + 1 : BOARD_SIZE - along;
  return { row: BOARD_SIZE - fromBottom, col };
}

/** Every tile number in the order a CSS grid lays squares out (reading order). */
export function boardOrder() {
  const out = [];
  for (let row = 1; row <= BOARD_SIZE; row++) {
    const fromBottom = BOARD_SIZE - row;
    const first = fromBottom * BOARD_SIZE + 1;
    const run = Array.from({ length: BOARD_SIZE }, (_, k) => first + k);
    out.push(...(fromBottom % 2 === 0 ? run : run.reverse()));
  }
  return out;
}

/** The middle of tile n in a 0-100 square, for the SVG drawn over the grid. */
export function tileCenter(n) {
  const { row, col } = tileCell(n);
  return { x: (col - 0.5) * 10, y: (row - 0.5) * 10 };
}

/**
 * The tile under a point of the same 0-100 square -- tileCenter the other way
 * round, for dragging a snake's or ladder's end. A point off the board counts
 * as the nearest square on its edge.
 */
export function tileAt(x, y) {
  const clamp = (v) => Math.min(BOARD_SIZE, Math.max(1, Math.floor(v / 10) + 1));
  const row = clamp(y);
  const col = clamp(x);
  const fromBottom = BOARD_SIZE - row;
  const along = fromBottom % 2 === 0 ? col - 1 : BOARD_SIZE - col;
  return fromBottom * BOARD_SIZE + along + 1;
}

/**
 * An SVG path for a snake from its head to its tail: a gentle S along the
 * line between them, so a snake never reads as a ruler line. Deterministic
 * (the same head and tail always draw the same snake), and which way it
 * wiggles alternates with the head, so two snakes side by side do not lie
 * exactly in step.
 */
export function snakePath(from, to) {
  const a = tileCenter(from);
  const b = tileCenter(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // Unit normal to the line, and how far the body swings off it.
  const nx = -dy / len;
  const ny = dx / len;
  const swing = Math.min(6, 2 + len / 12) * (from % 2 === 0 ? 1 : -1);
  const at = (t, s) => ({ x: a.x + dx * t + nx * s, y: a.y + dy * t + ny * s });
  const c1 = at(0.25, swing);
  const mid = at(0.5, 0);
  const c2 = at(0.75, -swing);
  const f = (p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  return `M ${f(a)} Q ${f(c1)} ${f(mid)} Q ${f(c2)} ${f(b)}`;
}

/** A ladder goes up; everything else on the board that jumps is a snake. */
export const isLadder = (j) => Number(j.to) > Number(j.from);

/** The jump starting on tile n, or null. */
export function jumpFrom(jumps, n) {
  return (jumps ?? []).find((j) => Number(j.from) === n) ?? null;
}

/**
 * The standard board: ten snakes and eight ladders, where the classic board
 * game has them, give or take. A few ladders early to get everyone going,
 * catch-up ladders through the middle, one late ladder to 99, and the
 * nastiest snakes in the top rows. No ladder ends on a snake and no snake
 * ends on a ladder, so a move never chains by accident.
 */
export const DEFAULT_JUMPS = [
  // ladders
  { from: 4, to: 14 }, { from: 9, to: 31 }, { from: 21, to: 42 }, { from: 28, to: 56 },
  { from: 36, to: 44 }, { from: 51, to: 67 }, { from: 71, to: 91 }, { from: 80, to: 99 },
  // snakes
  { from: 17, to: 7 }, { from: 47, to: 26 }, { from: 49, to: 11 }, { from: 54, to: 34 },
  { from: 62, to: 19 }, { from: 64, to: 60 }, { from: 87, to: 24 }, { from: 93, to: 73 },
  { from: 95, to: 75 }, { from: 98, to: 79 },
];

/**
 * What is wrong with a set of snakes and ladders, in words, or null. The same
 * rules admin_set_snakes enforces, checked here first so the organiser's
 * editor can say so before anything is sent.
 */
export function checkJumps(jumps) {
  const starts = new Map();
  for (const j of jumps) {
    const from = Number(j.from);
    const to = Number(j.to);
    if (!Number.isInteger(from) || !Number.isInteger(to)) return 'Every snake and ladder needs a start and an end.';
    if (from < 1 || from > 99) return `A snake or ladder starts on tile 1 to 99 (not ${from}).`;
    if (to < 1 || to > LAST_TILE) return `A snake or ladder ends on tile 1 to 100 (not ${to}).`;
    if (to === from) return `The snake or ladder on tile ${from} goes nowhere.`;
    if (starts.has(from)) return `Two snakes or ladders start on tile ${from}.`;
    starts.set(from, to);
  }
  for (const [from, to] of starts) {
    let t = to;
    for (let hops = 0; starts.has(t); hops++) {
      if (t === from || hops > LAST_TILE) return `The snakes and ladders from tile ${from} go round in a circle.`;
      t = starts.get(t);
    }
  }
  return null;
}

/**
 * What is wrong with one snake or ladder `j` among the `others`, in words, or
 * null -- checkJumps for a single change, so dragging one end or adding one
 * judges only that change, not a half-typed row elsewhere in the list. Any
 * loop it closes runs through its own start, so following on from its end
 * is enough to find one.
 */
export function jumpProblem(others, j) {
  const from = Number(j.from);
  const to = Number(j.to);
  if (from < 1 || from > 99) return `A snake or ladder starts on tile 1 to 99 (not ${from}).`;
  if (to < 1 || to > LAST_TILE) return `A snake or ladder ends on tile 1 to 100 (not ${to}).`;
  if (to === from) return 'It has to go somewhere: pick another square.';
  const starts = new Map(others.map((o) => [Number(o.from), Number(o.to)]));
  if (starts.has(from)) return `Another snake or ladder already starts on tile ${from}.`;
  starts.set(from, to);
  let t = to;
  for (let hops = 0; starts.has(t); hops++) {
    if (t === from || hops > LAST_TILE) return `That would send a team round in a circle back to tile ${from}.`;
    t = starts.get(t);
  }
  return null;
}

/**
 * A ladder from tile a up to tile b in the board's 0-100 square: two rails
 * and the rungs between them, as SVG path data.
 */
export function ladderShape(from, to) {
  const a = tileCenter(from);
  const b = tileCenter(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const w = 1.0;             // half the ladder's width
  const nx = -uy * w;
  const ny = ux * w;
  const f = (x, y) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  const rails = `M ${f(a.x + nx, a.y + ny)} L ${f(b.x + nx, b.y + ny)} `
    + `M ${f(a.x - nx, a.y - ny)} L ${f(b.x - nx, b.y - ny)}`;
  let rungs = '';
  for (let d = 1.6; d < len - 0.8; d += 2.6) {
    const x = a.x + ux * d;
    const y = a.y + uy * d;
    rungs += `M ${f(x + nx, y + ny)} L ${f(x - nx, y - ny)} `;
  }
  return { rails, rungs: rungs.trim() };
}

/** Counting steps from a to b, one tile at a time, excluding a. */
function walk(a, b) {
  const out = [];
  if (b > a) for (let t = a + 1; t <= b; t++) out.push(t);
  else for (let t = a - 1; t >= b; t--) out.push(t);
  return out;
}

/**
 * How a marker gets from where it was to where the server put it, as a list
 * of { tile, kind } steps, read off a `team_moved` payload:
 *
 *   'step'  -- one tile along the path (the die, a rollback, a skip)
 *   'slide' -- straight there (down a snake, up a ladder, or an organiser's move)
 *
 * Start (0) is off the board, so a walk from Start begins on tile 1.
 */
export function movePath(p) {
  if (!p || p.to == null) return [];
  const from = Number(p.from ?? 0);
  const to = Number(p.to);
  if (p.kind === 'move') return from === to || to < 1 ? [] : [{ tile: to, kind: 'slide' }];

  const steps = [];
  const stepTo = (b) => {
    const a = steps.length ? steps[steps.length - 1].tile : from;
    for (const t of walk(a, b)) if (t >= 1) steps.push({ tile: t, kind: 'step' });
  };

  const jumps = Array.isArray(p.jumps) ? p.jumps : [];
  // Where the first skip ended: the first snake head, or the final tile.
  const shifted = jumps.length ? Number(jumps[0].from) : to;
  const landed = Number(p.landed ?? to);

  if (p.kind === 'roll' && p.long_skip) {
    stepTo(landed);
  } else if (p.kind === 'roll' && p.bounced) {
    stepTo(LAST_TILE);
    stepTo(landed);
  } else {
    stepTo(landed);
  }
  stepTo(shifted);

  for (const j of jumps) {
    steps.push({ tile: Number(j.to), kind: 'slide' });
    stepTo(Number(j.then ?? j.to));
  }
  // Belt and braces: whatever the payload said, end where the server put it.
  if (!steps.length || steps[steps.length - 1].tile !== to) {
    if (to >= 1) steps.push({ tile: to, kind: 'slide' });
  }
  return steps;
}

/** The tile row a team stands on, or null at Start. */
export function currentTile(team, tiles) {
  if (!team || !team.board_tile) return null;
  return tiles.find((t) => t.position === team.board_tile) ?? null;
}

/**
 * Whether the team may roll: from Start always, otherwise once its current
 * tile is done. The server re-checks; this only decides which button shows.
 */
export function canRoll(team, tiles) {
  if (!team) return false;
  if (!team.board_tile) return true;
  return currentTile(team, tiles)?.claim_status === 'completed';
}

/** How far the team's next rollback goes, in words. */
export function rollbackSize(used = 0) {
  if (used <= 0) return '1–3 tiles';
  if (used === 1) return 'one die (1–6 tiles)';
  return 'the higher of two dice';
}

/** "Start" or "tile 37". */
export const tileWord = (n) => (Number(n) ? `tile ${n}` : 'Start');

/** Team marker colours, by slot. Distinct on the dark board, gold kept for "you". */
const MARKERS = ['#ff6b5e', '#64b5ff', '#4cd97b', '#c58cff', '#ff9f43', '#5ee0d6', '#ff7ab8', '#d4d46a'];
export const markerColor = (slot) => MARKERS[((slot ?? 1) - 1) % MARKERS.length];

// Words that start a team's name without telling it apart: "Team Alpha" and
// "Team Bravo" are both "T" until the "Team" goes.
const FILLER = new Set(['team', 'the', 'a', 'an', 'of', 'and', '&', 'clan', 'squad']);

/**
 * The letter on each team's marker, one per team and never the same twice:
 * Map(team id -> "A"). Takes teams ({ id, name, slot }) or standings rows
 * ({ team_id, team_name, slot }).
 *
 * The first letter of the name once the filler words are gone. Teams that
 * would share it get a second letter, the first one further along their name
 * that nobody else has taken -- Sharks and Shrimps become "Sh" and "Sr". If
 * even that runs out, the team's slot number. Decided in slot order, so the
 * same teams always get the same letters.
 */
export function teamInitials(teams) {
  const list = (teams ?? [])
    .map((t) => ({ id: t.id ?? t.team_id, name: String(t.name ?? t.team_name ?? ''), slot: t.slot ?? 0 }))
    .sort((a, b) => a.slot - b.slot);

  const letters = (name) => {
    const words = name.split(/[\s_\-.]+/).filter(Boolean);
    const kept = words.filter((w) => !FILLER.has(w.toLowerCase()));
    // Array.from, so an emoji or an accented letter counts as one character.
    return Array.from((kept.length ? kept : words).join('')).filter((c) => /[\p{L}\p{N}]/u.test(c));
  };
  const firstOf = (chars) => (chars[0] ?? '?').toUpperCase();

  const sharing = new Map();
  for (const t of list) {
    const first = firstOf(letters(t.name));
    sharing.set(first, (sharing.get(first) ?? 0) + 1);
  }

  const out = new Map();
  const taken = new Set();
  const claim = (label) => (label && !taken.has(label) ? label : null);
  list.forEach((t, i) => {
    const chars = letters(t.name);
    const first = firstOf(chars);
    let label = sharing.get(first) === 1 ? claim(first) : null;
    for (const c of chars.slice(1)) {
      if (label) break;
      label = claim(first + c.toLowerCase());
    }
    label = label ?? claim(String(t.slot || i + 1)) ?? `#${i + 1}`;
    taken.add(label);
    out.set(t.id, label);
  });
  return out;
}

/** The finished-game banner, read off the game row (the server's decision). */
export function resultText(game, teams) {
  if (game?.status !== 'finished') return null;
  const winner = teams.find((t) => t.id === game.winner_team_id)?.name;
  if (game.ended_reason === 'won' && winner) return `${winner} completed tile 100 and wins!`;
  if (!winner) return 'The game is over — no team left Start, so nobody wins.';
  return `The organiser ended the game — ${winner} wins, furthest along.`;
}

/**
 * The feed line for a snakes event, or null for anything this mode words the
 * same as the others (evidence submitted, withdrawn, ...). Plain text; the
 * Discord version of the same lines is snakes_discord_line in the database.
 */
export function snakesEventText(e, who) {
  const p = e?.payload ?? {};
  if (p.mode !== 'snakes') return null;

  switch (e.type) {
    case 'game_started':
      return 'Snakes and Ladders has begun! Every team starts before tile 1 — roll to get going.';
    case 'game_reset':
      return 'Snakes and Ladders has been reset — every team is back at Start.';
    case 'team_moved': {
      const to = Number(p.to) ? `tile ${p.to}${p.tile_name ? ` (${p.tile_name})` : ''}` : 'Start';
      const from = tileWord(p.from);
      const extra = [];
      if (p.kind !== 'move') {
        if (p.bounced) extra.push(`Overshot 100 and bounced back to ${p.landed}.`);
        const skipped = Array.isArray(p.skipped) ? p.skipped : [];
        if (!p.long_skip && skipped.length) extra.push(`Skipped ${skipped.join(', ')}, already done.`);
        for (const j of p.jumps ?? []) {
          extra.push(isLadder(j) ? `Ladder on ${j.from}, up to ${j.to}!` : `Snake on ${j.from}, down to ${j.to}!`);
        }
        if (Number(p.to) === LAST_TILE) extra.push('Tile 100 — finish it to win!');
      }
      const tail = extra.length ? ` ${extra.join(' ')}` : '';
      switch (p.kind) {
        case 'roll':
          return p.long_skip
            ? `${who} skipped from ${from} to ${to} — the next six tiles were all done or snake heads.${tail}`
            : `${who} rolled a ${p.dice?.[0]}: ${from} → ${to}.${tail}`;
        case 'rollback':
          return `${who} used a rollback and went back ${p.steps}: ${from} → ${to}. `
            + `${p.rollbacks_available} rollback${p.rollbacks_available === 1 ? '' : 's'} left.${tail}`;
        case 'punish':
          return `An organiser punished ${who}: back ${p.steps}, ${from} → ${to}.${tail}`;
        default:
          return `An organiser moved ${who} to ${to}.`;
      }
    }
    case 'rollback_gained': {
      const n = Number(p.amount);
      if (p.reason === 'auto') {
        return `${who} earned a rollback for finishing tile ${p.tile} — ${p.rollbacks_available} available.`;
      }
      if (p.reason === 'pet') {
        return `${who} traded a pet for a rollback on tile ${p.tile} — ${p.rollbacks_available} available.`;
      }
      return n < 0
        ? `An organiser took ${-n} rollback${n === -1 ? '' : 's'} from ${who} — ${p.rollbacks_available} left.`
        : `An organiser gave ${who} ${n} rollback${n === 1 ? '' : 's'} — ${p.rollbacks_available} available.`;
    }
    case 'tile_reopened':
      return `An organiser reopened tile ${p.position}${p.tile_name ? ` (${p.tile_name})` : ''} for ${who}`
        + ' — it is no longer complete.'
        + (p.game_reopened ? ' The game has been reopened.' : '')
        + (p.winner_changed ? ' The winner has changed.' : '');
    case 'tile_completed':
      return `${who} completed tile ${p.position}, ${p.tile_name ?? 'a tile'}.`
        + (p.early ? ' (Marked complete by an organiser.)' : '');
    case 'game_ended':
      if (p.reason === 'won') return `${who} completed tile 100 and wins Snakes and Ladders!`;
      if (!e.team_id) return 'The organiser ended the game. No team had left Start, so nobody wins.';
      return `The organiser ended the game. ${who} wins — furthest along, on tile ${p.tile}.`;
    default:
      return null;
  }
}
