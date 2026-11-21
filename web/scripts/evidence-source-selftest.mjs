import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLUGIN_LABEL, PLUGIN_TITLE, evidenceSource, withSources } from '../src/lib/evidenceSource.js';

// ---- An upload from the site has no label ----
//
// Most evidence, and the normal way in. A row admin_evidence_sources() did not
// name has no `source` at all, and reads as an upload.

assert.equal(evidenceSource({ id: 'a' }), null, 'a row with no source is an upload');
assert.equal(evidenceSource({ id: 'a', source: 'web', detail: null }), null, "'web' is an upload");
assert.equal(evidenceSource(null), null);
assert.equal(evidenceSource(undefined), null);

// ---- "Sent by plugin", never "verified" ----

assert.equal(PLUGIN_LABEL, 'Sent by plugin');
for (const text of [PLUGIN_LABEL, PLUGIN_TITLE]) {
  assert.doesNotMatch(text, /verif|confirm|approved|checked by/i, `"${text}" must not read as a seal`);
}

const dink = evidenceSource({
  id: 'e1',
  source: 'dink',
  detail: {
    source: 'dink', rsn: 'Mate Iron', item: "Karil's coif", item_id: 4732, quantity: 1,
    price_each: 50000, from: 'Barrows', category: 'EVENT', world: 302, region_id: 14131, dink_type: 'LOOT',
  },
});
assert.equal(dink.label, 'Sent by plugin');
assert.deepEqual(dink.lines, ["Karil's coif from Barrows", 'as Mate Iron · world 302']);
assert.equal(evidenceSource({ source: 'plugin', detail: { item: 'Abyssal whip' } }).label, 'Sent by plugin',
  'our own plugin, later, gets the same label');

// ---- What the plugin reported, as reported ----

assert.deepEqual(
  evidenceSource({ source: 'dink', detail: { item: 'Rune arrow', quantity: 1500, from: 'Vorkath' } }).lines,
  ['Rune arrow ×1,500 from Vorkath'],
  'a stack says how many',
);
assert.deepEqual(
  evidenceSource({ source: 'dink', detail: { item: 'Baby mole', quantity: 1, from: 'Giant Mole', dink_type: 'PET' } }).lines,
  ['Pet: Baby mole'],
  'a pet says so, and nothing dropped it',
);
assert.deepEqual(
  evidenceSource({ source: 'dink', detail: { item: 'Bandos hilt', resized_from: '3840x2400' } }).lines,
  ['Bandos hilt', 'Picture made smaller from 3840×2400'],
  'the reviewer is told the picture was made smaller here, and from what',
);
assert.deepEqual(evidenceSource({ source: 'dink', detail: null }).lines, [], 'no detail: the label alone');
assert.deepEqual(evidenceSource({ source: 'dink' }).lines, []);

// Everything in detail came from the player's computer. Only what has the
// right shape is shown, and nothing is long enough to push the row apart.
const odd = evidenceSource({
  source: 'dink',
  detail: {
    item: 'x'.repeat(500), quantity: '3', from: { name: 'obj' }, rsn: 42,
    world: 302.5, resized_from: '3840x2400; anything else',
  },
});
assert.equal(odd.lines.length, 1, 'only the item survives');
assert.equal(odd.lines[0].length, 60, 'cut to 60 characters');
assert.match(odd.lines[0], /…$/, 'with an ellipsis');
assert.deepEqual(evidenceSource({ source: 'dink', detail: { item: '  Dragon\n  pickaxe ', world: 0 } }).lines,
  ['Dragon pickaxe'], 'spacing tidied; world 0 is not a world');

// ---- Laid on by id, and nothing else changes ----

const rows = [{ id: 'a', tile_name: 'Whip' }, { id: 'b', tile_name: 'Barrows' }, { id: 'p', pet: true }];
const merged = withSources(rows, [{ id: 'b', source: 'dink', detail: { item: 'Dharok\'s helm' } }]);
assert.equal(merged.length, 3);
assert.equal(merged[0], rows[0], 'an upload is the very same row');
assert.equal(merged[2], rows[2], 'so is a pet trade');
assert.deepEqual(merged[1], { id: 'b', tile_name: 'Barrows', source: 'dink', detail: { item: "Dharok's helm" } });
assert.equal(withSources(rows, null), rows, 'a database without the function: the rows as they were');
assert.equal(withSources(rows, []), rows);

// ---- Wired in, behind the same gate as the list ----
//
// Read from the source rather than rendered: the repo has no DOM for its tests.

const review = readFileSync(new URL('../src/components/EvidenceReview.jsx', import.meta.url), 'utf8');
assert.match(review, /evidenceSources\(gameId\)\.catch\(/, 'the review screen asks, and a failure costs the labels only');
assert.match(review, /withSources\(/, 'and lays them on by id');
assert.match(review, /\{sent\.label\}/, 'the label shown is the one from lib/evidenceSource.js');
// Comments may name the word in order to forbid it; what is shown may not.
const shown = review.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
assert.doesNotMatch(shown, /verified/i, 'the screen never says verified');

const lib = readFileSync(new URL('../src/lib/supabase.js', import.meta.url), 'utf8');
assert.match(lib,
  /export async function evidenceSources\(gameId\) \{\s*const \{ data, error \} = await supabase\.rpc\('admin_evidence_sources', \{ p_game_id: gameId \}\);\s*if \(isMissingFunction\(error\)\) return null;/,
  'evidenceSources() answers null while the database has no such function');

// The draft's function, read from the draft, so the two cannot drift apart.
const sql = readFileSync(new URL('../../runelite-plugin/server/002_plugin_drops.sql', import.meta.url), 'utf8');
assert.match(sql, /create or replace function admin_evidence_sources\(p_game_id uuid\)\s*returns table \(id uuid, source text, detail jsonb\)/,
  'the draft answers id, source and detail');
assert.match(sql, /if not may_manage_game\(p_game_id\) then\s*raise exception 'Not your game';/,
  "the draft asks admin_list_evidence's own question");
assert.match(sql, /and e\.source <> 'web'/, 'and lists only what did not come from the site');

// ---- The site's own upload is untouched ----
//
// A manual upload sends no source; draft 002's trigger stamps it 'web'.

const upload = readFileSync(new URL('../src/lib/evidence.js', import.meta.url), 'utf8');
const call = upload.slice(upload.indexOf("supabase.rpc('add_evidence'"), upload.indexOf('});', upload.indexOf("supabase.rpc('add_evidence'")));
assert.ok(call.length > 0, 'found the upload call');
assert.doesNotMatch(call.replace(/\/\/.*$/gm, ''), /source|detail/, 'the upload call sends no source and no detail');

console.log('evidence-source selftest: ok');
