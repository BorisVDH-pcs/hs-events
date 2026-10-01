// Bingo helpers. Pure functions only, so scripts/bingo-selftest.mjs can run
// them under plain Node.
//
// A bingo card is grid_size x grid_size, 3 to 10. Positions stay on the same
// 10-column numbering battleships uses (`tiles.position` is generated as
// (row-1)*10 + col), so coordLabel/fromPosition from board.js work unchanged
// on any card size -- only the loops that draw a card need to know its size.

import { coordLabel, toPosition } from './board.js';

/** Every square of a size x size card, in reading order. */
export function cardCells(size) {
  const cells = [];
  for (let row = 1; row <= size; row++) {
    for (let col = 1; col <= size; col++) {
      cells.push({ row, col, position: toPosition(row, col), label: coordLabel(row, col) });
    }
  }
  return cells;
}

/**
 * Where a tile stands for the team looking at it.
 *
 *   'done'     -- completed; it counts.
 *   'progress' -- something has been submitted, not enough yet.
 *   'open'     -- nothing submitted.
 */
export function tileState(tile) {
  if (!tile) return 'open';
  if (tile.claim_status === 'completed') return 'done';
  if ((tile.evidence_count ?? 0) > 0) return 'progress';
  return 'open';
}

/** Whether a running bingo's timer has passed. A game with no timer never has. */
export function timeIsUp(game, now = Date.now()) {
  if (!game?.ends_at) return false;
  return Date.parse(game.ends_at) <= now;
}

/** Whether a team can submit right now. The server re-checks all of it. */
export function canSubmit(game, myTeamId, now = Date.now()) {
  return Boolean(myTeamId) && game?.status === 'active' && !timeIsUp(game, now);
}

/** "3/25" -- how a team's count reads everywhere. */
export const countLabel = (s) => `${s.tiles_completed}/${s.tiles_total}`;

/**
 * The finished-game banner, in words.
 *
 * Reads the winner off the game row rather than the top of the standings: the
 * row is what the server decided, and an organiser revoking evidence after the
 * end can re-rank teams without the client needing to re-derive anything.
 */
export function resultText(game, teams) {
  if (game?.status !== 'finished') return null;
  const winner = teams.find((t) => t.id === game.winner_team_id)?.name;
  if (!winner) {
    return game.ended_reason === 'time_up'
      ? "Time's up — no tiles were completed, so nobody wins."
      : 'The game is over — no tiles were completed, so nobody wins.';
  }
  if (game.ended_reason === 'full_card') return `${winner} filled the whole card and wins!`;
  if (game.ended_reason === 'time_up') return `Time's up — ${winner} wins.`;
  return `The game is over — ${winner} wins.`;
}
