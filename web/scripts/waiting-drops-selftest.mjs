// A drop two tiles want, waiting for the team to choose (Boris, 2026-11-21):
// the box's helpers, the line it leaves on the evidence, and its wiring.
//
// What the database does with a choice is tested in
// runelite-plugin/server/test/waiting.test.mjs (offline) and stack.test.mjs
// (a local Supabase, through PostgREST and Storage's own copy).

// Times below are read in UTC, whatever this machine's own zone is.
process.env.TZ = 'UTC';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { choiceLabel, clock, minutesLeft, waitsUntil, WAIT_MINUTES } from '../src/lib/waitingDrops.js';
import { evidenceSource } from '../src/lib/evidenceSource.js';

// ---- Which tile a button names ----

assert.equal(choiceLabel({ tile: 'Whips', region: 'misthalin' }), 'Whips · Misthalin', 'Region Bingo: the tile and its region');
assert.equal(choiceLabel({ tile: 'Anything for Prayer', region: 'fremennik' }), 'Anything for Prayer · Fremennik Provinces',
  "the region's own name, as the map has it");
assert.equal(choiceLabel({ tile: 'Whip', region: null }), 'Whip', 'a Bingo card has no regions');
assert.equal(choiceLabel({ tile: 'Whip', region: 'atlantis' }), 'Whip', 'a region the site does not know: the tile alone');
assert.equal(choiceLabel({ tile: '  ', region: null }), 'A tile');
assert.equal(choiceLabel(null), 'A tile');

// ---- How long it waits ----

assert.equal(WAIT_MINUTES, 60);
const now = Date.parse('2026-11-21T16:30:00Z');
assert.equal(minutesLeft('2026-11-21T17:12:00Z', now), 42);
assert.equal(minutesLeft('2026-11-21T16:30:01Z', now), 1, 'a second left still reads as a minute');
assert.equal(minutesLeft('2026-11-21T16:29:00Z', now), 0, 'never below nothing');
assert.equal(minutesLeft('not a time', now), 0);
assert.equal(waitsUntil('2026-11-21T17:12:00Z', now), 'Waits until 17:12 (42 min left)');
assert.equal(waitsUntil('2026-11-21T16:30:00Z', now), null, 'once the hour is up, nothing to say');
assert.equal(clock('2026-11-21T16:57:22Z', true), '16:57:22');
assert.equal(clock('nope'), null);

// ---- The line it leaves on the evidence ----
//
// The evidence row's own time is when the tile was chosen. The panel and the
// review screen say when the drop arrived, and who chose.

const waited = evidenceSource({
  source: 'dink',
  detail: { item: 'Abyssal whip', quantity: 1, from: 'Abyssal demon', world: 302, rsn: 'Mate Iron',
            waited: { arrived_at: '2026-11-21T16:57:22.123+00:00', chosen_by: 'Red Cap' } },
});
assert.equal(waited.drop, 'Abyssal whip ×1 from Abyssal demon');
assert.deepEqual(waited.lines, ['World 302 · as Mate Iron', 'Arrived 16:57:22 · tile chosen by Red Cap']);
assert.deepEqual(evidenceSource({ source: 'dink', detail: { waited: { chosen_by: 'Red Cap' } } }).lines,
  ['Tile chosen by Red Cap'], 'no time: who chose, on its own');
assert.deepEqual(evidenceSource({ source: 'dink', detail: { waited: { arrived_at: 5, chosen_by: { x: 1 } } } }).lines, [],
  'nothing of the wrong shape');
assert.deepEqual(evidenceSource({ source: 'dink', detail: { item: 'Bones', waited: 'yes' } }).lines, []);

// ---- Wired in ----
//
// Read from the source rather than rendered: the repo has no DOM for its tests.

const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const uncommented = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const app = src('../src/App.jsx');
assert.match(app, /import WaitingDrops from '\.\/components\/WaitingDrops\.jsx';/);
assert.match(app,
  /\{game\.game && !waitingScreen && \(isBingo \|\| isRegions\) && isActive && myTeamId && \(\s*<WaitingDrops gameId=\{game\.game\.id\} events=\{events\} onHandedIn=\{game\.refresh\} \/>/,
  'shown on a team\'s board in Region Bingo and Bingo, while the game runs');

const lib = src('../src/lib/supabase.js');
assert.match(lib,
  /export async function waitingDrops\(gameId\) \{\s*const \{ data, error \} = await supabase\.rpc\('waiting_drops', \{ p_game_id: gameId \}\);\s*if \(isMissingFunction\(error\)\) return null;/,
  'null on a database without the plugin (the live project today), and the box hides');
for (const fn of ['waitingDropOpen', 'waitingDropChoose']) {
  assert.match(lib, new RegExp(`export const ${fn} = \\([^)]*\\) => \\{\\s*assertWritable\\(\\);`),
    `${fn}: an organiser only viewing a team changes nothing`);
}

const ev = src('../src/lib/evidence.js');
const hand = ev.slice(ev.indexOf('export async function handInWaitingDrop'));
const order = ['assertWritable()', 'await waitingDropOpen(', 'const to = opened.copy_path;', '.copy(opened.from_path, to)',
  'return waitingDropChoose('];
const at = order.map((s) => hand.indexOf(s));
assert.ok(at.every((i) => i >= 0) && at.every((i, k) => k === 0 || i > at[k - 1]),
  'the tile is opened, Storage copies the file as the player to where the database said, then it is handed in');
assert.match(hand, /if \(error\) throw new Error\(error\.message\);/, 'a refused copy stops it there');

const box = src('../src/components/WaitingDrops.jsx');
assert.match(box, /useConfirm\(\)/, 'a choice is asked twice: only an organiser can take it back');
assert.match(box, /handInWaitingDrop\(\{ waitingId: drop\.id, tileId: choice\.tile_id, optionId: choice\.option_id \}\)/);
assert.match(box, /if \(!shown\.length && !message\) return confirmDialog;/, 'nothing waiting: nothing shown');
assert.match(box, /if \(!document\.hidden\) load\(\);/, 'asked again only while the page is in view');
assert.doesNotMatch(uncommented(box), /verified/i, 'the box never says verified');

const stubs = src('../src/preview/stub-supabase.js') + src('../src/preview/stub-evidence.js');
for (const name of ['waitingDrops', 'waitingDropOpen', 'waitingDropChoose', 'handInWaitingDrop']) {
  assert.match(stubs, new RegExp(`export (const|function|async function) ${name}\\b`),
    `every harness that renders the app has ${name} to stand in`);
}

// ---- The migration says the same ----

const sql = src('../../supabase/migrations/20261121120100_plugin_drops.sql');
assert.match(sql, /expires_at\s+timestamptz not null default now\(\) \+ interval '1 hour'/,
  `the database waits ${WAIT_MINUTES} minutes too`);
for (const sig of ['waiting_drops\\(uuid\\)', 'waiting_drop_open\\(uuid, uuid, uuid\\)', 'waiting_drop_choose\\(uuid, uuid, uuid, text\\)']) {
  assert.match(sql, new RegExp(`revoke execute on function ${sig}\\s+from public, anon, service_role;`), `${sig}: never anon`);
  assert.match(sql, new RegExp(`grant  execute on function ${sig}\\s+to authenticated;`), `${sig}: any signed-in player`);
}

console.log('waiting-drops selftest: ok');
