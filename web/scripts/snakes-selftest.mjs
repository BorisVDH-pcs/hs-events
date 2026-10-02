import assert from 'node:assert/strict';
import {
  DEFAULT_JUMPS, boardOrder, canRoll, checkJumps, isLadder, jumpFrom, ladderShape, currentTile, movePath, resultText, rollbackSize, snakePath,
  snakesEventText, teamInitials, tileCell, tileCenter,
} from '../src/lib/snakes.js';

// The snake path: 1 bottom-left, 10 bottom-right, 11 above 10, 100 top-left.
assert.deepEqual(tileCell(1), { row: 10, col: 1 });
assert.deepEqual(tileCell(10), { row: 10, col: 10 });
assert.deepEqual(tileCell(11), { row: 9, col: 10 });
assert.deepEqual(tileCell(20), { row: 9, col: 1 });
assert.deepEqual(tileCell(21), { row: 8, col: 1 });
assert.deepEqual(tileCell(91), { row: 1, col: 10 });
assert.deepEqual(tileCell(100), { row: 1, col: 1 });

// Reading order holds every tile once, top row first.
const order = boardOrder();
assert.equal(order.length, 100);
assert.equal(new Set(order).size, 100);
assert.deepEqual(order.slice(0, 3), [100, 99, 98]);
assert.deepEqual(order.slice(-3), [8, 9, 10]);
order.forEach((n, i) => {
  assert.deepEqual(tileCell(n), { row: Math.floor(i / 10) + 1, col: (i % 10) + 1 }, `tile ${n}`);
});

// Neighbours along the path are always next to each other on screen.
for (let n = 1; n < 100; n++) {
  const a = tileCenter(n);
  const b = tileCenter(n + 1);
  assert.equal(Math.hypot(a.x - b.x, a.y - b.y), 10, `${n} -> ${n + 1}`);
}
assert.ok(snakePath(16, 6).startsWith('M 45.00 85.00 '), 'starts at the head (16)');
assert.ok(snakePath(16, 6).endsWith(' 55.00 95.00'), 'ends at the tail (6)');
assert.equal(snakePath(16, 6), snakePath(16, 6), 'deterministic');

// ---- marker paths, from the payloads the smoke test checked server-side ----
const tiles = (p) => movePath(p).map((s) => (s.kind === 'slide' ? `>${s.tile}` : s.tile));

assert.deepEqual(tiles({ kind: 'roll', from: 0, landed: 4, to: 4, jumps: [] }), [1, 2, 3, 4]);
assert.deepEqual(tiles({ kind: 'roll', from: 10, landed: 16, to: 6,
  jumps: [{ from: 16, to: 6, then: 6 }] }), [11, 12, 13, 14, 15, 16, '>6']);
assert.deepEqual(tiles({ kind: 'roll', from: 6, landed: 10, to: 11, skipped: [10], jumps: [] }),
  [7, 8, 9, 10, 11], 'a skip walks on past the finished tile');
assert.deepEqual(tiles({ kind: 'roll', from: 30, landed: 33, to: 12,
  jumps: [{ from: 33, to: 26, then: 26 }, { from: 26, to: 12, then: 12 }] }),
  [31, 32, 33, '>26', '>12'], 'a chain slides twice');
assert.deepEqual(tiles({ kind: 'roll', from: 14, landed: 15, to: 7,
  jumps: [{ from: 16, to: 6, then: 7 }] }),
  [15, 16, '>6', 7], 'skip to a head, slide, skip again after the tail');
assert.deepEqual(tiles({ kind: 'roll', from: 98, landed: 97, to: 97, bounced: true, jumps: [] }),
  [99, 100, 99, 98, 97], 'bounce');
assert.deepEqual(tiles({ kind: 'roll', from: 60, landed: 67, to: 67, long_skip: true, jumps: [] }),
  [61, 62, 63, 64, 65, 66, 67], 'long skip');
assert.deepEqual(tiles({ kind: 'rollback', from: 67, landed: 64, to: 67, jumps: [] }),
  [66, 65, 64, 65, 66, 67], 'back, then skip forward to where it was');
assert.deepEqual(tiles({ kind: 'punish', from: 37, landed: 33, to: 12,
  jumps: [{ from: 33, to: 26, then: 26 }, { from: 26, to: 12, then: 12 }] }),
  [36, 35, 34, 33, '>26', '>12']);
assert.deepEqual(tiles({ kind: 'move', from: 22, to: 50 }), ['>50']);
assert.deepEqual(tiles({ kind: 'move', from: 5, to: 0 }), [], 'back to Start: nothing to walk on the board');
assert.deepEqual(movePath(null), []);

// ---- whose turn ----
const board = [
  { id: 'a', position: 4, claim_status: 'completed' },
  { id: 'b', position: 5, claim_status: 'active' },
];
assert.equal(canRoll({ board_tile: 0 }, board), true, 'the first roll is free');
assert.equal(canRoll({ board_tile: 4 }, board), true);
assert.equal(canRoll({ board_tile: 5 }, board), false);
assert.equal(canRoll({ board_tile: 6 }, board), false, 'never opened is not done');
assert.equal(canRoll(null, board), false);
assert.equal(currentTile({ board_tile: 5 }, board).id, 'b');
assert.equal(currentTile({ board_tile: 0 }, board), null);

assert.equal(rollbackSize(0), '1–3 tiles');
assert.equal(rollbackSize(1), 'one die (1–6 tiles)');
assert.equal(rollbackSize(5), 'the higher of two dice');

// ---- words ----
const teams = [{ id: 'r', name: 'Red' }];
assert.equal(resultText({ status: 'active' }, teams), null);
assert.match(resultText({ status: 'finished', winner_team_id: 'r', ended_reason: 'won' }, teams), /Red completed tile 100/);
assert.match(resultText({ status: 'finished', winner_team_id: 'r', ended_reason: 'admin' }, teams), /furthest along/);
assert.match(resultText({ status: 'finished', winner_team_id: null, ended_reason: 'admin' }, teams), /nobody wins/);

const ev = (type, payload, team_id = 'r') => ({ type, team_id, payload: { mode: 'snakes', ...payload } });
assert.equal(snakesEventText({ type: 'team_moved', payload: { kind: 'roll' } }, 'Red'), null,
  'not a snakes payload: leave it to the shared wording');
assert.equal(snakesEventText(ev('team_moved', { kind: 'roll', from: 0, to: 4, dice: [4], tile_name: 'Kraken' }), 'Red'),
  'Red rolled a 4: Start → tile 4 (Kraken).');
assert.equal(snakesEventText(ev('team_moved', { kind: 'roll', from: 10, landed: 16, to: 6, dice: [6],
  jumps: [{ from: 16, to: 6 }] }), 'Red'), 'Red rolled a 6: tile 10 → tile 6. Snake on 16, down to 6!');
assert.match(snakesEventText(ev('team_moved', { kind: 'rollback', from: 50, to: 48, steps: 2,
  rollbacks_available: 1 }), 'Red'), /went back 2: tile 50 → tile 48\. 1 rollback left\./);
assert.match(snakesEventText(ev('team_moved', { kind: 'roll', from: 98, landed: 97, to: 97, dice: [5],
  bounced: true }), 'Red'), /bounced back to 97/);
assert.match(snakesEventText(ev('team_moved', { kind: 'roll', from: 95, to: 100, dice: [5] }), 'Red'),
  /finish it to win/);
assert.equal(snakesEventText(ev('team_moved', { kind: 'move', from: 3, to: 50, jumps: [] }), 'Red'),
  'An organiser moved Red to tile 50.');
assert.match(snakesEventText(ev('rollback_gained', { reason: 'admin', amount: -1, rollbacks_available: 0 }), 'Red'),
  /took 1 rollback from Red/);
assert.match(snakesEventText(ev('game_ended', { reason: 'won' }), 'Red'), /wins Snakes and Ladders/);
assert.match(snakesEventText(ev('game_ended', { reason: 'admin' }, null), 'Someone'), /nobody wins/);
assert.equal(snakesEventText(ev('evidence_submitted', {}), 'Red'), null);

// ---- ladders ----
assert.equal(checkJumps(DEFAULT_JUMPS), null, 'the standard board is valid');
assert.equal(DEFAULT_JUMPS.filter(isLadder).length, 8);
assert.equal(DEFAULT_JUMPS.filter((j) => !isLadder(j)).length, 10);
const starts = new Set(DEFAULT_JUMPS.map((j) => j.from));
for (const j of DEFAULT_JUMPS) assert.ok(!starts.has(j.to), `nothing chains on the standard board (${j.from} -> ${j.to})`);
assert.equal(jumpFrom(DEFAULT_JUMPS, 4).to, 14);
assert.equal(jumpFrom(DEFAULT_JUMPS, 5), null);
assert.match(checkJumps([{ from: 20, to: 40 }, { from: 40, to: 20 }]), /circle/);
assert.match(checkJumps([{ from: 16, to: 6 }, { from: 16, to: 30 }]), /Two snakes or ladders start on tile 16/);
assert.match(checkJumps([{ from: 100, to: 3 }]), /1 to 99/);
assert.match(checkJumps([{ from: 90, to: 101 }]), /1 to 100/);
assert.match(checkJumps([{ from: 5, to: 5 }]), /goes nowhere/);
assert.equal(checkJumps([{ from: 33, to: 26 }, { from: 26, to: 12 }]), null, 'a chain is fine');
const lad = ladderShape(4, 14);
assert.ok(lad.rails.startsWith('M ') && lad.rungs.split('M').length > 3, 'rails and rungs');

assert.deepEqual(tiles({ kind: 'roll', from: 0, landed: 4, to: 14, jumps: [{ from: 4, to: 14, then: 14 }] }),
  [1, 2, 3, 4, '>14'], 'up a ladder');
assert.deepEqual(tiles({ kind: 'roll', from: 5, landed: 9, to: 32, jumps: [{ from: 9, to: 31, then: 32 }] }),
  [6, 7, 8, 9, '>31', 32], 'up a ladder, then past a finished tile');
assert.equal(snakesEventText(ev('team_moved', { kind: 'roll', from: 0, landed: 4, to: 14, dice: [4],
  jumps: [{ from: 4, to: 14 }] }), 'Red'), 'Red rolled a 4: Start → tile 14. Ladder on 4, up to 14!');

// Marker letters: one per team, never the same twice.
const initials = (names) => [...teamInitials(names.map((name, i) => ({ id: `t${i}`, name, slot: i + 1 }))).values()];
assert.deepEqual(initials(['Team Alpha', 'Team Bravo']), ['A', 'B'], 'filler words dropped');
assert.deepEqual(initials(['Sharks', 'Shrimps']), ['Sh', 'Sr'], 'a shared letter gets a second one');
assert.deepEqual(initials(["Reece's Wanchors", 'SS Pale Shrimp']), ['R', 'S']);
assert.deepEqual(initials(['Team', 'The Team']), ['Te', 'Th'], 'a name of only filler words keeps them');
assert.deepEqual(initials(['Alpha', 'Alpha']), ['Al', 'Ap'], 'even the same name twice');
assert.deepEqual(initials(['A', 'A']), ['1', '2'], 'nothing left to tell apart: the slot');
assert.equal(teamInitials([{ team_id: 'x', team_name: 'Team Alpha', slot: 1 }]).get('x'), 'A', 'standings rows');
for (const n of [2, 4, 8]) {
  const many = initials(Array.from({ length: n }, (_, i) => `Team ${['Red', 'Rust', 'Rose', 'Ruby', 'Blue', 'Bolt', 'Bear', 'Bee'][i]}`));
  assert.equal(new Set(many).size, n, `${n} teams, ${many}`);
}

console.log('snakes selftest passed');
