import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_EVIDENCE, MAX_FIGURE, WOM_METRICS,
  challengeEventText, figureLabel, figureToStored, metricLabel, rankedLabel,
  storedToInput, womLabel,
} from '../src/lib/challenge.js';
import { PER_MILLION } from '../src/lib/millions.js';

// ---- What a player types, and what is stored ----
//
// `gp` is kept in tenths of a million, the unit value tiles already use, so
// every one of these is a number the database would hold.

assert.equal(figureToStored('250', 'gp'), 2500, '250m is 2500 tenths');
assert.equal(figureToStored('0.5', 'gp'), 5, 'half a million is 5');
assert.equal(figureToStored('0,5', 'gp'), 5, 'a decimal comma is a decimal point');
assert.equal(figureToStored('1250.5', 'gp'), 12505, 'past a value tile’s 1000m ceiling');
assert.equal(figureToStored('0', 'gp'), 0, 'nothing is a figure too');

// Refused rather than rounded: a number quietly turned into a different number
// is worse than a box that will not take it.
assert.equal(figureToStored('0.55', 'gp'), null, 'two decimals are refused');
assert.equal(figureToStored('', 'gp'), null);
assert.equal(figureToStored('   ', 'gp'), null);
assert.equal(figureToStored('-5', 'gp'), null, 'negative is not a figure');
assert.equal(figureToStored('lots', 'gp'), null);
assert.equal(figureToStored('1e6', 'gp'), null);

assert.equal(figureToStored('12', 'count'), 12);
assert.equal(figureToStored('012', 'count'), 12);
assert.equal(figureToStored('12.5', 'count'), null, 'a count is whole');
assert.equal(figureToStored('12', null), 12, 'no unit reads as a count');

// Round trips: what is stored goes back into the box as what was typed.
for (const [text, unit] of [['250', 'gp'], ['0.5', 'gp'], ['12', 'count']]) {
  assert.equal(storedToInput(figureToStored(text, unit), unit), text,
    `${text} (${unit}) round-trips`);
}
assert.equal(storedToInput(null, 'gp'), '', 'nothing declared leaves the box empty');
assert.equal(storedToInput(undefined, 'count'), '');

// ---- On screen ----

assert.equal(figureLabel(2500, 'gp'), '250m');
assert.equal(figureLabel(5, 'gp'), '0.5m');
assert.equal(figureLabel(null, 'gp'), '—', 'no figure is a dash, never a zero');
assert.equal(figureLabel(0, 'gp'), '0m', 'a declared zero is a zero, not a dash');
assert.equal(womLabel(null), '—');
assert.equal(womLabel(0), '0');

assert.equal(metricLabel('clue_scrolls_all'), 'Clues — all tiers');
assert.equal(metricLabel('some_boss_added_next_month'), 'some boss added next month',
  'a metric this file has never heard of still reads as words');
assert.equal(metricLabel(null), null);
assert.equal(new Set(WOM_METRICS.map((m) => m.value)).size, WOM_METRICS.length,
  'no metric is listed twice');
for (const m of WOM_METRICS) {
  assert.match(m.value, /^[a-z0-9_]+$/, `${m.value} is spelled the way WOM spells it`);
}

// Which figure the ladder is sorted on, in words.
assert.equal(rankedLabel({ ranked_by: 'wom', wom_metric: 'zulrah' }), 'Boss — Zulrah');
assert.equal(rankedLabel({ ranked_by: 'declared', declared_label: 'Total loot' }), 'Total loot');
assert.equal(rankedLabel(null), '');

// ---- The feed ----
//
// Same hand-off snakes and territory use: null for anything that is not ours,
// so the shared switch in EventFeed has it.

assert.equal(challengeEventText({ type: 'tile_completed', payload: {} }, 'Alpha'), null);
assert.equal(
  challengeEventText({ type: 'game_started', payload: { mode: 'bingo' } }, 'Alpha'), null,
  'a bingo starting is not ours to word',
);
assert.match(
  challengeEventText({ type: 'game_started', payload: { mode: 'challenge', entrants: 1 } }, 'x'),
  /1 entrant,/,
  'one entrant is not "1 entrants"',
);
assert.match(
  challengeEventText({ type: 'game_started', payload: { mode: 'challenge', entrants: 12 } }, 'x'),
  /12 entrants/,
);

const declared = challengeEventText({
  type: 'challenge_declared',
  payload: { by_name: 'Kaylee', amount: 2500, label: 'Total loot', unit: 'gp' },
}, 'Alpha');
assert.equal(declared, 'Kaylee put in 250m for total loot.');

// An organiser correcting a figure writes the same event with its own name on
// it. Saying so is the whole point: a number changed behind someone's back is
// worse than a wrong one.
const altered = challengeEventText({
  type: 'challenge_declared',
  payload: {
    by_name: 'Kaylee', amount: 1800, label: 'Total loot', unit: 'gp',
    altered_by: 'uuid', altered_by_name: 'Boris',
  },
}, 'Alpha');
assert.equal(altered, "Boris set Kaylee's total loot to 180m.");

assert.equal(
  challengeEventText({
    type: 'challenge_ended',
    payload: {
      reason: 'time_up', solo: true, winner_name: 'Kaylee', score: 2500,
      ranked_by: 'declared', label: 'Total loot', unit: 'gp',
    },
  }, 'x'),
  'Time is up — Kaylee wins with 250m.',
);
assert.equal(
  challengeEventText({
    type: 'challenge_ended',
    payload: {
      reason: 'admin', solo: false, winner_name: 'Alpha', score: 412,
      ranked_by: 'wom', label: 'zulrah',
    },
  }, 'x'),
  'The organiser called it — Alpha wins with 412 Boss — Zulrah.',
);

// ---- The database agrees ----
//
// Both ceilings are enforced server-side. A box that lets a player past one
// only turns a clear refusal into a confusing one.

const rpcs = readFileSync(
  new URL('../../supabase/migrations/20261026120200_challenge_rpcs.sql', import.meta.url),
  'utf8',
);
assert.ok(
  rpcs.includes(`select ${MAX_FIGURE}::bigint`),
  'MAX_FIGURE matches challenge_max_figure()',
);
assert.ok(
  new RegExp(`challenge_max_evidence\\(\\)[\\s\\S]{0,160}select ${MAX_EVIDENCE}\\b`).test(rpcs),
  'MAX_EVIDENCE matches challenge_max_evidence()',
);
// The stored unit, which both sides have to agree on or every gp figure is out
// by a factor of ten.
assert.equal(PER_MILLION, 10, 'gp is stored in tenths of a million');
assert.ok(
  rpcs.includes('tenths of a million') || readFileSync(
    new URL('../../supabase/migrations/20261026120100_challenge_foundation.sql', import.meta.url),
    'utf8',
  ).includes('tenths of a million'),
  'the migration says which unit the declared figure is in',
);

const listSql = readFileSync(
  new URL('../../supabase/migrations/20261026120300_challenge_list.sql', import.meta.url),
  'utf8',
);
for (const key of ['solo', 'wom_metric', 'declared_label', 'declared_unit', 'ranked_by', 'joined', 'entrants']) {
  assert.ok(listSql.includes(`'${key}'`), `challenge_list answers with ${key}`);
}

console.log(`challenge selftest: ok (${WOM_METRICS.length} metrics)`);
