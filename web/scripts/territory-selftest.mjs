import assert from 'node:assert/strict';
import {
  DEFAULT_HOMES, LINKS, MAP, PLACES, REGIONS, defaultBonus, toPixel,
} from '../src/lib/territoryWorld.js';
import {
  MAX_OPEN, capture, neighbours, openRefusal, placeByIndex, placeByKey, placeState,
  regionHolders, resultText, scoreLabel, standings, touches,
  TASK_GRID, defaultHomes, homesProblem, placeAtPosition, placePosition, reachable, teamHomes,
  fromServer, territoryEventText,
} from '../src/lib/territory.js';
import { fromPosition } from '../src/lib/board.js';
import { readFileSync } from 'node:fs';

// ---- The world data ----

const keys = new Set(PLACES.map((p) => p.key));
assert.equal(keys.size, PLACES.length, 'place keys are unique');
assert.equal(PLACES.length, TASK_GRID * TASK_GRID, 'the places fill the 8x8 task card exactly');
assert.equal(new Set(PLACES.map((p) => p.name)).size, PLACES.length, 'place names are unique');

const regionKeys = new Set(REGIONS.map((r) => r.key));
for (const p of PLACES) {
  assert.ok(regionKeys.has(p.region), `${p.key} is in a known region`);
  const { px, py } = toPixel(p.x, p.y);
  assert.ok(px >= 0 && px < MAP.width && py >= 0 && py < MAP.height, `${p.key} lands on the map image`);
  // Each place's task is the tile at placePosition on the 8x8 card, and back.
  assert.equal(placeByIndex.get(p.index), p);
  const { row, col } = fromPosition(placePosition(p));
  assert.ok(row >= 1 && row <= TASK_GRID && col >= 1 && col <= TASK_GRID, `${p.key} sits on the 8x8 card`);
  assert.equal(placeAtPosition(placePosition(p)), p, `${p.key} round-trips through its position`);
}
for (const r of REGIONS) {
  assert.ok(PLACES.some((p) => p.region === r.key), `${r.key} has places`);
  assert.ok(defaultBonus(r.key) >= 2);
}

const seen = new Set();
for (const [a, b, kind] of LINKS) {
  assert.ok(keys.has(a) && keys.has(b), `link ${a}-${b} names real places`);
  assert.notEqual(a, b, 'no place links to itself');
  assert.ok(['land', 'boat', 'travel'].includes(kind), `link ${a}-${b} has a known kind`);
  const id = [a, b].sort().join('|');
  assert.ok(!seen.has(id), `link ${a}-${b} is listed once`);
  seen.add(id);
}
// Links are stored once and read both ways.
for (const [a, b] of LINKS) {
  assert.ok(neighbours(a).some((n) => n.key === b));
  assert.ok(neighbours(b).some((n) => n.key === a));
}

// The whole map is one connected piece: from any home, every place is
// reachable, so no team can be walled off by the map itself.
const reach = new Set([PLACES[0].key]);
const queue = [PLACES[0].key];
while (queue.length) {
  for (const n of neighbours(queue.shift())) {
    if (!reach.has(n.key)) { reach.add(n.key); queue.push(n.key); }
  }
}
assert.equal(reach.size, PLACES.length,
  `unreachable: ${PLACES.filter((p) => !reach.has(p.key)).map((p) => p.key).join(', ')}`);

for (const h of DEFAULT_HOMES) assert.ok(keys.has(h), `default home ${h} exists`);
assert.equal(new Set(DEFAULT_HOMES).size, DEFAULT_HOMES.length);

// The drawn areas (public/territory/areas.json, generated from the map image):
// every place has one, and two areas that share a border are linked, except
// across the River Salve, which only Paterdomus (Varrock - Canifis) crosses.
const areas = JSON.parse(readFileSync(new URL('../public/territory/areas.json', import.meta.url), 'utf8'));
const SALVE = new Set(['mort_myre|varrock', 'lumbridge|mort_myre', 'al_kharid|mort_myre',
  'al_kharid|barrows', 'barrows|uzer', 'canifis|ferox']);
for (const p of PLACES) assert.match(areas.places[p.key] ?? '', /^M/, `${p.key} has an area`);
for (const r of REGIONS) assert.match(areas.regions[r.key] ?? '', /^M/, `${r.key} has an outline`);
const linked = new Set(LINKS.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`)));
for (const t of areas.touching) {
  assert.ok(linked.has(t) || SALVE.has(t), `${t} share a border, so they should be linked`);
}
for (const t of SALVE) assert.ok(!linked.has(t), `${t} is across the Salve`);

assert.equal(placePosition('lumbridge'), 1, 'place 1 is the top left square');
assert.equal(placeAtPosition(9), undefined, 'columns 9 and 10 are off the card');
assert.equal(placePosition(placeByIndex.get(9)), 11, 'place 9 starts row 2');
assert.deepEqual([...defaultHomes([{ id: 'y', slot: 2 }, { id: 'x', slot: 1 }])],
  [['x', DEFAULT_HOMES[0]], ['y', DEFAULT_HOMES[1]]], 'default homes go by slot');

// ---- Homes never wall land off ----
// A home cannot be taken, so it is a wall to every other team. Any single
// place may be a home except Rellekka, the only way to the Fremennik isles.
for (const p of PLACES) {
  const problem = homesProblem(new Map([['a', p.key], ['b', p.key === 'falador' ? 'varrock' : 'falador']]));
  if (p.key === 'rellekka') {
    assert.match(problem, /Neitiznot, Lunar Isle and Waterbirth Island.*through Rellekka, a home/);
  } else {
    assert.equal(problem, null, `${p.key} as a home walls nothing off`);
  }
}
// The desert is not Lumbridge's to close: with Lumbridge and Wizards' Tower
// both homes, Varrock still reaches Al Kharid.
assert.equal(homesProblem(new Map([['a', 'lumbridge'], ['b', 'wizards_tower'], ['c', 'falador']])), null);
assert.ok(reachable('falador', new Map([['a', 'lumbridge'], ['b', 'wizards_tower'], ['c', 'falador']])).has('al_kharid'));
// Every default lineup, two teams to six, is a legal one.
for (let n = 1; n <= DEFAULT_HOMES.length; n++) {
  const homes = new Map(DEFAULT_HOMES.slice(0, n).map((k, i) => [`t${i}`, k]));
  assert.equal(homesProblem(homes), null, `the first ${n} suggested homes`);
}
assert.ok(!DEFAULT_HOMES.includes('rellekka'));
// Two homes that close a region between them are refused, by name.
// (Each of the two may still pass its own home: only a third team is shut out.)
assert.equal(homesProblem(new Map([['a', 'varrock'], ['b', 'catherby']])), null);
assert.match(homesProblem(new Map([['a', 'varrock'], ['b', 'catherby'], ['c', 'falador']]),
  (id) => ({ a: 'Alpha', b: 'Bravo', c: 'Charlie' })[id]),
  /^Charlie could never reach Canifis, Port Phasmatys, Mort Myre Swamp and 3 more: the only way in is through (Varrock and Catherby|Catherby and Varrock), homes/);
assert.match(homesProblem(new Map([['a', 'lumbridge'], ['b', 'lumbridge']])), /Two teams have Lumbridge/);
// Picked homes win; the rest fill from the suggestions, never doubling up.
assert.deepEqual([...teamHomes([{ id: 'x', slot: 1 }, { id: 'y', slot: 2, home: 'lumbridge' }])],
  [['x', 'ardougne'], ['y', 'lumbridge']]);
assert.deepEqual([...teamHomes([{ id: 'x', slot: 1, home: 'nowhere' }])], [['x', 'lumbridge']]);

// ---- The rules ----

const teams = [
  { id: 'a', name: 'Alpha', slot: 1 },
  { id: 'b', name: 'Bravo', slot: 2 },
];
const homes = new Map([['a', 'lumbridge'], ['b', 'varrock']]);
let owners = new Map([['lumbridge', 'a'], ['varrock', 'b']]);
const none = new Set();
const ask = (teamId, key, open = none, o = owners, status = 'active') =>
  openRefusal({ teamId, key, owners: o, homes, open, status });

assert.ok(touches('a', 'draynor', owners));
assert.ok(!touches('a', 'falador', owners));

assert.equal(ask('a', 'draynor'), null, 'linked to home: may open');
assert.match(ask('a', 'falador'), /not linked/);
assert.match(ask('a', 'lumbridge'), /your home/);
assert.match(ask('a', 'varrock'), /home cannot be taken/);
assert.match(ask(null, 'draynor'), /not on a team/);
assert.match(ask('a', 'draynor', none, owners, 'placement'), /when the game starts/);

// The open limit, and carrying on with one already open.
const two = new Set(['draynor', 'al_kharid']);
assert.equal(MAX_OPEN, 2);
assert.match(ask('a', 'wizards_tower', two), /already working on 2/);
assert.equal(ask('a', 'draynor', two), null, 'an open place stays workable at the limit');

// Capturing, then stealing at the same target.
let step = capture(owners, homes, 'draynor', 'a', '2026-10-13T10:00:00Z');
owners = step.owners;
assert.equal(step.record.from_team_id, null, 'free land is a capture');
assert.match(ask('a', 'draynor'), /already holds/);
assert.equal(ask('a', 'falador'), null, 'new land opens new links');

assert.match(ask('b', 'wizards_tower'), /not linked/, 'Varrock does not touch the Wizards\' Tower');
owners = capture(owners, homes, 'barbarian_village', 'b', '2026-10-13T10:30:00Z').owners;
assert.equal(ask('b', 'draynor'), null, 'a rival next to it may attack');
assert.match(ask('a', 'mort_myre'), /not linked/, 'the River Salve is crossed only at Paterdomus');
step = capture(owners, homes, 'draynor', 'b', '2026-10-13T11:00:00Z');
assert.equal(step.record.from_team_id, 'a', 'held land is a steal');
assert.throws(() => capture(step.owners, homes, 'varrock', 'a'), /home/);
assert.throws(() => capture(step.owners, homes, 'draynor', 'b'), /Already/);

// A cut-off place stays owned; it only stops opening new links.
let island = new Map(owners);
island.set('falador', 'a');
island = capture(island, homes, 'draynor', 'b').owners;
assert.equal(island.get('falador'), 'a');

// Map states.
const st = (key, open = none, attacked = none) =>
  placeState({ key, teamId: 'a', owners, homes, open, attacked, status: 'active' });
assert.equal(st('lumbridge').kind, 'home');
assert.equal(st('varrock').kind, 'home-rival');
assert.equal(st('draynor').kind, 'mine');
assert.equal(st('falador').openable, true);
assert.equal(st('edgeville').openable, false);
assert.equal(st('falador', new Set(['falador'])).working, true);
assert.equal(st('draynor', none, new Set(['draynor'])).attacked, true);

// Regions and the score.
const misthalin = PLACES.filter((p) => p.region === 'misthalin').map((p) => p.key);
const all = new Map(owners);
for (const k of misthalin) all.set(k, 'a');
assert.equal(regionHolders(all).get('misthalin'), 'a');
all.set('edgeville', 'b');
assert.equal(regionHolders(all).has('misthalin'), false, 'one place short is no region');

const bonuses = new Map([['misthalin', 3]]);
const whole = new Map(owners);
for (const k of misthalin) whole.set(k, 'a');
const caps = [
  { place: 'draynor', team_id: 'a', at: '2026-10-13T10:00:00Z' },
  { place: 'edgeville', team_id: 'a', at: '2026-10-13T12:00:00Z' },
];
const table = standings(teams, whole, caps, bonuses);
assert.equal(table[0].team_id, 'a');
assert.equal(table[0].places, misthalin.length);
assert.deepEqual(table[0].regions, ['misthalin']);
assert.equal(table[0].score, misthalin.length + 3);
assert.equal(scoreLabel(table[0]), `${misthalin.length} places + 3 bonus`);

// Tie-break: same score, earlier last capture wins.
const tie = new Map([['lumbridge', 'a'], ['varrock', 'b'], ['draynor', 'a'], ['edgeville', 'b']]);
const tieCaps = [
  { place: 'edgeville', team_id: 'b', at: '2026-10-13T09:00:00Z' },
  { place: 'draynor', team_id: 'a', at: '2026-10-13T10:00:00Z' },
];
assert.deepEqual(standings(teams, tie, tieCaps, new Map()).map((r) => r.team_id), ['b', 'a']);
// No captures at all: slot decides.
assert.deepEqual(standings(teams, new Map([['lumbridge', 'a'], ['varrock', 'b']]), [], new Map())
  .map((r) => r.team_id), ['a', 'b']);

assert.equal(resultText({ status: 'active' }, teams), null);
assert.match(resultText({ status: 'finished', winner_team_id: 'b', ended_reason: 'time_up' }, teams), /Bravo/);

assert.equal(placeByKey.get('lumbridge').name, 'Lumbridge');

// ---- The board as the server sends it ----

{
  const sTeams = [{ id: 'a', slot: 1, home: 'lumbridge' }, { id: 'b', slot: 2, home: 'ardougne' }];
  const at = (key) => placePosition(key);
  const board = fromServer({
    teams: sTeams,
    myTeamId: 'a',
    tiles: [
      { position: at('draynor'), claim_id: 'c1', claim_status: 'completed', paused: false },
      { position: at('varrock'), claim_id: 'c2', claim_status: 'active', paused: false },
      { position: at('edgeville'), claim_id: 'c3', claim_status: 'active', paused: true },
      { position: at('falador'), claim_id: null, claim_status: null, paused: false },
    ],
    territory: {
      owners: [{ place: 'lumbridge', team_id: 'a', home: true }, { place: 'ardougne', team_id: 'b', home: true },
        { place: 'draynor', team_id: 'a', home: false }],
      captures: [{ place: 'draynor', team_id: 'a', from_team_id: null, at: '2026-10-13T10:00:00Z' }],
      attacks: [{ place: 'draynor', team_id: 'b' }, { place: 'varrock', team_id: 'a' }],
      bonuses: { misthalin: 3 },
    },
  });
  assert.deepEqual([...board.open], ['varrock'], 'open = active claims not given up');
  assert.deepEqual([...board.attacked], ['draynor'], 'attacked = my land a rival is working on');
  assert.equal(board.owners.get('draynor'), 'a');
  assert.equal(board.homes.get('b'), 'ardougne');
  assert.equal(board.bonuses.get('misthalin'), 3);
  const t = (key) => board.tiles.find((x) => x.position === at(key));
  assert.equal(t('varrock').claim_id, 'c2', 'an open place uploads to its claim');
  assert.equal(t('edgeville').claim_id, null, 'a given-up place does not, until it is opened again');
  assert.equal(t('edgeville').own_claim_id, 'c3', 'but its screenshots can still be shown');
  assert.equal(t('draynor').claim_id, null);
  assert.equal(standings(sTeams, board.owners, board.captures, board.bonuses)[0].team_id, 'a');
  // Before the first load there is no territory object yet.
  assert.equal(fromServer({ teams: sTeams, tiles: [], territory: null, myTeamId: 'a' }).owners.size, 0);
}

assert.equal(territoryEventText({ type: 'game_ended', team_id: null, payload: { mode: 'territory', reason: 'time_up' } }, ''),
  "Time's up! No place changed hands, so nobody wins.");
assert.equal(territoryEventText({ type: 'game_ended', team_id: 'a', payload: { mode: 'territory', reason: 'admin', score: 9 } }, 'Red'),
  'The organiser ended the game. Red wins with 9 points.');

// ---- The database has the same map ----
// The server keeps the world in three tables seeded by the territory
// migration. A place moved or a link added here has to be added there too (in
// a new migration), or the map would draw one thing and the server allow
// another.

const sql = readFileSync(new URL('../../supabase/migrations/20261013120100_territory_mode.sql', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');
const rows = (table) => {
  const block = sql.match(new RegExp(`insert into ${table} \\([^)]*\\) values\\n([\\s\\S]*?);\\n`))?.[1];
  assert.ok(block, `the migration seeds ${table}`);
  return [...block.matchAll(/^\s*\((.*)\),?$/gm)].map((m) => [...m[1].matchAll(/'((?:[^']|'')*)'|(\d+)/g)]
    .map((v) => (v[1] !== undefined ? v[1].replace(/''/g, "'") : Number(v[2]))));
};
assert.deepEqual(rows('territory_regions'), REGIONS.map((r, i) => [r.key, r.name, defaultBonus(r.key), i + 1]),
  'the database regions and bonuses match territoryWorld.js');
assert.deepEqual(rows('territory_places'), PLACES.map((p) => [p.key, p.index, p.name, p.region]),
  'the database places match territoryWorld.js');
const pair = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
assert.deepEqual(new Set(rows('territory_links').map(([a, b]) => pair(a, b))),
  new Set(LINKS.map(([a, b]) => pair(a, b))), 'the database links match territoryWorld.js');
assert.ok(sql.includes(`array[${DEFAULT_HOMES.map((k) => `'${k}'`).join(', ')}]`),
  'the database suggests the same homes');

console.log(`territory selftest: ok (${PLACES.length} places, ${LINKS.length} links, ${REGIONS.length} regions)`);
