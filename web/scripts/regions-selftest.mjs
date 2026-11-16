import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LAST_SQUARE, PER_REGION, REGIONS, boardProblems, builderRegions, fromServer, needFor,
  lineNote, nextStep, payingRegion, pickConfirm, pickRefusal, progress, regionAt, regionStatus,
  regionsEventText, resultText, squaresOf, teamsWithoutCaptain,
} from '../src/lib/regions.js';

const migrations = new URL('../../supabase/migrations/', import.meta.url);

// ---- The board: the same cut as the server's ----

// territory_regions' sort order is the order the squares are handed out in
// (regions_region_at). Read it from the migration that made the table, so a
// region added or moved on one side and not the other fails here.
const sql = readFileSync(new URL('20261013120100_territory_mode.sql', migrations), 'utf8');
const block = sql.slice(sql.indexOf('insert into territory_regions'), sql.indexOf('insert into territory_places'));
const serverOrder = [...block.matchAll(/\('([a-z]+)', '([^']+)', \d+, (\d+)\)/g)]
  .sort((a, b) => Number(a[3]) - Number(b[3]))
  .map((m) => [m[1], m[2]]);
assert.deepEqual(REGIONS.map((r) => [r.key, r.name]), serverOrder, 'regions in the server\'s sort order, same names');

assert.equal(PER_REGION, 9);
assert.equal(LAST_SQUARE, 99);
assert.equal(regionAt(1), 'misthalin');
assert.equal(regionAt(9), 'misthalin');
assert.equal(regionAt(10), 'asgarnia');
assert.equal(regionAt(91), 'varlamore');
assert.equal(regionAt(99), 'varlamore');
assert.equal(regionAt(100), null, 'square 100 has no region');
assert.equal(regionAt(0), null);
assert.equal(regionAt(2.5), null);
const all = REGIONS.flatMap((r) => squaresOf(r.key));
assert.deepEqual(all, Array.from({ length: 99 }, (_, i) => i + 1), 'the regions cut squares 1-99 exactly once');
for (const r of REGIONS) for (const p of squaresOf(r.key)) assert.equal(regionAt(p), r.key);
assert.deepEqual(squaresOf('nowhere'), []);

// The server's own formula, kept in step.
const mode = readFileSync(new URL('20261116120100_regions_mode.sql', migrations), 'utf8');
assert.ok(mode.includes('r.sort = (p_position - 1) / 9 + 1'), 'server cuts nine squares per region');
assert.ok(mode.includes('* g.region_threshold + 99) / 100'), 'server rounds x% up the same way');

// ---- x% rounds up ----
assert.equal(needFor(15, 50), 8, '50% of 15 is 8');
assert.equal(needFor(10, 50), 5);
assert.equal(needFor(10, 33), 4, '3.3 rounds up to 4');
assert.equal(needFor(8, 33), 3);
assert.equal(needFor(7, 100), 7);
assert.equal(needFor(1, 1), 1);
assert.equal(needFor(0, 50), 0);

// ---- The board from the server ----
const server = {
  tiles: [
    { id: 't1', position: 1, name: 'Kill a goblin', claim_status: 'completed' },
    { id: 't2', position: 2, name: 'Smith a bar' },
    { id: 't3', position: 3, name: 'Catch a shrimp' },
    { id: 't19', position: 19, name: 'Seers agility' },
  ],
  regions: {
    threshold: 50,
    team_id: 'red',
    is_captain: false,
    needs_start: false,
    picks: 1,
    regions: [
      { key: 'misthalin', opened: true, complete: true, funds: false, points: 5, need: 5, total: 10, tiles: 3 },
      { key: 'asgarnia', opened: false },
      { key: 'kandarin', opened: true, complete: false, funds: false, points: 0, need: 1, total: 1, tiles: 1, funded_by: null },
      ...REGIONS.slice(3).map((r) => ({ key: r.key, opened: false })),
    ],
    worth: { 1: 2, 2: 3, 3: 5, 19: 1 },
  },
};
const view = fromServer(server);
assert.equal(view.regions.size, 11);
assert.equal(view.picks, 1);
assert.equal(view.threshold, 50);
assert.equal(view.isCaptain, false);
const misthalin = view.regions.get('misthalin');
assert.deepEqual(misthalin.tiles.map((t) => [t.position, t.worth]), [[1, 2], [2, 3], [3, 5]]);
assert.equal(misthalin.total, 10);
assert.equal(regionStatus(misthalin), 'complete');
assert.equal(regionStatus(view.regions.get('asgarnia')), 'locked');
assert.equal(regionStatus(view.regions.get('kandarin')), 'open');
assert.equal(regionStatus({ opened: true, complete: true, funds: true }), 'spent');
assert.equal(regionStatus({ opened: true, complete: false, funds: true }), 'spent', 'a spent region stays spent after a revoke');
assert.equal(view.regions.get('asgarnia').total, null, 'a locked region has no totals');
assert.equal(progress(misthalin), 1);
assert.equal(progress(view.regions.get('kandarin')), 0);
assert.equal(progress({ opened: true, points: 9, need: 5 }), 1, 'progress is capped');
assert.equal(lineNote({ points: 3, need: 5, total: 9 }), 'New region at 5 pts · 2 to go');
assert.equal(lineNote({ points: 5, need: 5, total: 9 }), 'New region at 5 pts ✓');
assert.equal(lineNote({ opened: false }), null, 'no line without totals');
assert.equal(payingRegion(view)?.key, 'misthalin');

// An empty board (a visitor, or before the state arrives) still has 11 locked regions.
const empty = fromServer({});
assert.equal(empty.regions.size, 11);
assert.ok([...empty.regions.values()].every((r) => regionStatus(r) === 'locked'));

// ---- Picking ----
const active = { status: 'active', ends_at: null };
assert.equal(pickRefusal({ game: active, view, regionKey: 'asgarnia', myTeamId: 'red' }), null, 'a pick to spend');
assert.equal(pickRefusal({ game: active, view, regionKey: 'misthalin', myTeamId: 'red' }), null, 'an opened region is not a pick');
assert.match(pickRefusal({ game: active, view, regionKey: 'asgarnia', myTeamId: null }), /Only players/);
assert.match(pickRefusal({ game: { status: 'setup' }, view, regionKey: 'asgarnia', myTeamId: 'red' }), /while the game runs/);
assert.match(pickRefusal({
  game: { status: 'active', ends_at: '2026-01-01T00:00:00Z' }, view, regionKey: 'asgarnia', myTeamId: 'red',
  now: Date.parse('2026-01-02T00:00:00Z'),
}), /Time is up/);
assert.match(pickRefusal({ game: active, view: { ...view, picks: 0 }, regionKey: 'asgarnia', myTeamId: 'red' }),
  /reach 50% of a region/);
const starting = { ...view, needsStart: true, picks: 0, isCaptain: false };
assert.match(pickRefusal({ game: active, view: starting, regionKey: 'asgarnia', myTeamId: 'red' }), /captain picks/);
assert.equal(pickRefusal({ game: active, view: { ...starting, isCaptain: true }, regionKey: 'asgarnia', myTeamId: 'red' }), null);

const first = pickConfirm({ ...starting, isCaptain: true }, 'morytania');
assert.equal(first.title, 'Start in Morytania?');
assert.match(first.body, /cannot be undone/);
const later = pickConfirm(view, 'asgarnia');
assert.equal(later.title, 'Open Asgarnia?');
assert.match(later.body, /spends the pick Misthalin earned/);
assert.equal(later.confirmLabel, 'Open Asgarnia');

assert.match(nextStep({ ...starting, isCaptain: true }, active, 'red'), /Pick your team/);
assert.match(nextStep(starting, active, 'red'), /Waiting for your captain/);
assert.match(nextStep(view, active, 'red'), /a pick — choose/);
assert.match(nextStep({ ...view, picks: 2 }, active, 'red'), /2 picks/);
assert.match(nextStep({ ...view, picks: 0 }, active, 'red'), /Reach 50%/);
assert.equal(nextStep(view, { status: 'finished' }, 'red'), null);
assert.equal(nextStep(view, active, null), null);

// ---- Words ----
const teams = [{ id: 'red', name: 'Red' }, { id: 'blue', name: 'Blue' }];
assert.equal(resultText({ status: 'active' }, teams), null);
assert.equal(resultText({ status: 'finished', winner_team_id: 'red', ended_reason: 'time_up' }, teams,
  [{ team_id: 'red', points: 10 }]), "Time's up — Red wins with 10 points!");
assert.equal(resultText({ status: 'finished', winner_team_id: 'blue', ended_reason: 'admin' }, teams,
  [{ team_id: 'blue', points: 1 }]), 'The game is over — Blue wins with 1 point.');
assert.match(resultText({ status: 'finished', winner_team_id: null, ended_reason: 'admin' }, teams), /nobody wins/);

const ev = (type, payload, teamId = 'red') => ({ type, team_id: teamId, payload: { mode: 'regions', ...payload } });
assert.equal(regionsEventText(ev('region_opened', { region: 'misthalin', region_name: 'Misthalin', first: true }), 'Red'),
  'Red starts in Misthalin.');
assert.equal(regionsEventText(ev('region_opened', { region: 'kandarin', first: false }), 'Red'), 'Red opened Kandarin.');
assert.equal(regionsEventText(ev('region_completed', { region_name: 'Misthalin', threshold: 50, can_pick: true }), 'Red'),
  'Red reached 50% of Misthalin and can pick a new region.');
assert.equal(regionsEventText(ev('region_completed', { region_name: 'Misthalin', threshold: 50, can_pick: false }), 'Red'),
  'Red reached 50% of Misthalin.');
const done = ev('tile_completed', { tile_id: 't3', region_name: 'Misthalin', worth: 5, points: 10 });
assert.equal(regionsEventText(done, 'Red'), 'Red completed a tile in Misthalin (+5) — 10 points.', 'no tile name by default');
assert.equal(regionsEventText(done, 'Red', (id) => (id === 't3' ? 'Catch a shrimp' : null)),
  'Red completed “Catch a shrimp” in Misthalin (+5) — 10 points.');
assert.equal(regionsEventText(ev('game_ended', { reason: 'time_up', points: 10 }), 'Red'),
  "Time's up! Red wins with 10 points.");
assert.equal(regionsEventText(ev('game_ended', { reason: 'admin', points: 0 }, null), 'Nobody'),
  'The organiser ended the game. Nobody scored, so nobody wins.');
assert.equal(regionsEventText({ type: 'tile_completed', payload: { mode: 'bingo' } }, 'Red'), null, 'other modes fall through');
assert.equal(regionsEventText(ev('evidence_submitted', {}), 'Red'), null, 'shared lines fall through');

// ---- The organiser's side ----
const adminTiles = [
  { position: 1, name: 'a' }, { position: 2, name: 'b' }, { position: 10, name: 'c' }, { position: 100, name: 'x' },
];
const rows = builderRegions(adminTiles, new Map([[1, 2], [2, 3], [10, 4]]), 50);
assert.equal(rows.length, 11);
assert.equal(rows[0].count, 2);
assert.equal(rows[0].total, 5);
assert.equal(rows[0].need, 3);
assert.equal(rows[1].total, 4);
assert.equal(rows[2].count, 0);
assert.equal(rows[0].squares.length, 9);
const problems = boardProblems(adminTiles);
assert.equal(problems.length, 2);
assert.match(problems[0], /Square 100/);
assert.match(problems[1], /Still empty: Kandarin, Fremennik Provinces,.*Varlamore\./);
assert.deepEqual(boardProblems(REGIONS.map((r) => ({ position: squaresOf(r.key)[0] }))), []);

assert.deepEqual(
  teamsWithoutCaptain(teams, [{ team_id: 'red', role: 'captain' }, { team_id: 'blue', role: 'member' }]).map((t) => t.id),
  ['blue'],
);

console.log('regions self-test: all passed');
