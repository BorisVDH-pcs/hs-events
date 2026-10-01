import assert from 'node:assert/strict';
import {
  canSubmit, cardCells, countLabel, resultText, tileState, timeIsUp,
} from '../src/lib/bingo.js';
import { fromPosition } from '../src/lib/board.js';

// Every card size a bingo may have maps onto the 10-column positions the
// database generates, and round-trips through the battleships helpers.
for (let size = 3; size <= 10; size++) {
  const cells = cardCells(size);
  assert.equal(cells.length, size * size);
  assert.equal(new Set(cells.map((c) => c.position)).size, size * size, `unique positions on ${size}x${size}`);
  for (const c of cells) {
    assert.deepEqual(fromPosition(c.position), { row: c.row, col: c.col });
  }
}
assert.deepEqual(cardCells(5).map((c) => c.label).slice(0, 6), ['A1', 'B1', 'C1', 'D1', 'E1', 'A2']);
assert.equal(cardCells(5).at(-1).position, 45, 'E5 is (5-1)*10 + 5, not 25');

assert.equal(tileState(undefined), 'open');
assert.equal(tileState({ claim_status: null, evidence_count: 0 }), 'open');
assert.equal(tileState({ claim_status: 'active', evidence_count: 0 }), 'open');
assert.equal(tileState({ claim_status: 'active', evidence_count: 2 }), 'progress');
assert.equal(tileState({ claim_status: 'completed', evidence_count: 3 }), 'done');

const now = Date.parse('2026-10-01T12:00:00Z');
assert.equal(timeIsUp({ ends_at: null }, now), false);
assert.equal(timeIsUp({ ends_at: '2026-10-01T12:00:01Z' }, now), false);
assert.equal(timeIsUp({ ends_at: '2026-10-01T12:00:00Z' }, now), true, 'the deadline itself is too late');

const running = { status: 'active', ends_at: '2026-10-02T00:00:00Z' };
assert.equal(canSubmit(running, 'team', now), true);
assert.equal(canSubmit(running, null, now), false, 'no team, no submissions');
assert.equal(canSubmit({ ...running, status: 'placement' }, 'team', now), false);
assert.equal(canSubmit({ ...running, ends_at: '2026-10-01T11:00:00Z' }, 'team', now), false);
assert.equal(canSubmit({ status: 'active', ends_at: null }, 'team', now), true);

assert.equal(countLabel({ tiles_completed: 3, tiles_total: 25 }), '3/25');

const teams = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Bravo' }];
assert.equal(resultText({ status: 'active' }, teams), null);
assert.equal(resultText({ status: 'finished', winner_team_id: 'a', ended_reason: 'full_card' }, teams),
  'Alpha filled the whole card and wins!');
assert.equal(resultText({ status: 'finished', winner_team_id: 'b', ended_reason: 'time_up' }, teams),
  "Time's up — Bravo wins.");
assert.equal(resultText({ status: 'finished', winner_team_id: 'b', ended_reason: 'admin' }, teams),
  'The game is over — Bravo wins.');
assert.match(resultText({ status: 'finished', winner_team_id: null, ended_reason: 'time_up' }, teams),
  /nobody wins/);

console.log('bingo selftest: ok');
