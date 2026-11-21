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
assert.equal(dink.drop, "Karil's coif ×1 from Barrows");
assert.deepEqual(dink.lines, ['World 302 · as Mate Iron']);
assert.equal(evidenceSource({ source: 'plugin', detail: { item: 'Abyssal whip' } }).label, 'Sent by plugin',
  'our own plugin, later, gets the same label');

// ---- What the plugin reported, as reported ----

// Boris, 2026-11-21: a Woman's Bones, handed in by Dink, on a screenshot that
// shows neither the Bones nor a chat line. The drop line is how anyone looking
// knows what the picture is for: the item, how many, from what, and the world.
const bones = evidenceSource({
  source: 'dink',
  detail: { source: 'dink', rsn: 'Soft Papi', item: 'Bones', item_id: 526, quantity: 1, from: 'Woman',
            category: 'NPC', world: 308, dink_type: 'LOOT' },
});
assert.equal(bones.drop, 'Bones ×1 from Woman', 'a single drop says ×1 too');
assert.deepEqual(bones.lines, ['World 308 · as Soft Papi']);

const arrows = evidenceSource({ source: 'dink', detail: { item: 'Rune arrow', quantity: 1500, from: 'Vorkath' } });
assert.equal(arrows.drop, 'Rune arrow ×1,500 from Vorkath', 'a stack says how many');
assert.deepEqual(arrows.lines, []);
assert.equal(evidenceSource({ source: 'dink', detail: { item: 'Abyssal whip', from: 'Abyssal demon' } }).drop,
  'Abyssal whip from Abyssal demon', 'no amount reported: none made up');
const pet = evidenceSource({ source: 'dink', detail: { item: 'Baby mole', quantity: 1, from: 'Giant Mole', dink_type: 'PET' } });
assert.equal(pet.drop, 'Pet: Baby mole', 'a pet says so, and nothing dropped it');
assert.deepEqual(pet.lines, []);
const hilt = evidenceSource({ source: 'dink', detail: { item: 'Bandos hilt', resized_from: '3840x2400' } });
assert.equal(hilt.drop, 'Bandos hilt');
assert.deepEqual(hilt.lines, ['Picture made smaller from 3840×2400'],
  'the reviewer is told the picture was made smaller here, and from what');
assert.deepEqual(evidenceSource({ source: 'dink', detail: null }), { label: PLUGIN_LABEL, title: PLUGIN_TITLE, drop: null, lines: [] },
  'no detail: the label alone');
assert.equal(evidenceSource({ source: 'dink' }).drop, null);
assert.deepEqual(evidenceSource({ source: 'dink', detail: { world: 330 } }),
  { label: PLUGIN_LABEL, title: PLUGIN_TITLE, drop: null, lines: ['World 330'] }, 'no item: no drop line');

// Everything in detail came from the player's computer. Only what has the
// right shape is shown, and nothing is long enough to push the row apart.
const odd = evidenceSource({
  source: 'dink',
  detail: {
    item: 'x'.repeat(500), quantity: '3', from: { name: 'obj' }, rsn: 42,
    world: 302.5, resized_from: '3840x2400; anything else',
  },
});
assert.deepEqual(odd.lines, [], 'only the item survives');
assert.equal(odd.drop.length, 60, 'cut to 60 characters');
assert.match(odd.drop, /…$/, 'with an ellipsis');
const tidied = evidenceSource({ source: 'dink', detail: { item: '  Dragon\n  pickaxe ', world: 0 } });
assert.equal(tidied.drop, 'Dragon pickaxe', 'spacing tidied');
assert.deepEqual(tidied.lines, [], 'world 0 is not a world');

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
assert.match(review, /\{sent\.drop\}/, 'and the drop line under it');
// Comments may name the word in order to forbid it; what is shown may not.
const uncommented = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
assert.doesNotMatch(uncommented(review), /verified/i, 'the screen never says verified');

// A tile's panel, which a team opens on its own board: the same label and
// lines beside every picture a plugin sent (Boris, 2026-11-21).
const panel = readFileSync(new URL('../src/components/EvidencePanel.jsx', import.meta.url), 'utf8');
assert.match(panel, /import \{ evidenceSourcesFor \} from '\.\.\/lib\/supabase\.js';/, 'the panel asks the database');
assert.match(panel, /evidenceSourcesFor\(list\)[\s\S]{0,200}\.catch\(/, 'and a failure costs the lines, not the pictures');
assert.match(panel, /withSources\(items, sources\)/, 'laid on by id');
assert.match(panel, /\{sent\.label\}/, 'the label from lib/evidenceSource.js');
assert.match(panel, /\{sent\.drop\}/, 'the drop line');
assert.match(panel, /sent\?\.lines\.map\(/, 'and the world and account');
assert.match(panel, /new Date\(e\.created_at\)\.toLocaleString\(\)/, 'beside the time it arrived');
assert.doesNotMatch(uncommented(panel), /verified/i, 'the panel never says verified');
const stub = readFileSync(new URL('../src/preview/stub-supabase.js', import.meta.url), 'utf8');
assert.match(stub, /export const evidenceSourcesFor = /, 'every harness that renders the panel has the call to stand in for it');

const lib = readFileSync(new URL('../src/lib/supabase.js', import.meta.url), 'utf8');
assert.match(lib,
  /export async function evidenceSources\(gameId\) \{\s*const \{ data, error \} = await supabase\.rpc\('admin_evidence_sources', \{ p_game_id: gameId \}\);\s*if \(isMissingFunction\(error\)\) return null;/,
  'evidenceSources() answers null while the database has no such function');
assert.match(lib,
  /export async function evidenceSourcesFor\(ids\) \{\s*const \{ data, error \} = await supabase\.rpc\('evidence_sources', \{ p_ids: ids \}\);\s*if \(isMissingFunction\(error\)\) return null;/,
  'and so does evidenceSourcesFor(), so the panel is what it was on a database without the plugin');

// The migration's function, read from the migration, so the two cannot drift apart.
const sql = readFileSync(new URL('../../supabase/migrations/20261121120100_plugin_drops.sql', import.meta.url), 'utf8');
assert.match(sql, /create or replace function admin_evidence_sources\(p_game_id uuid\)\s*returns table \(id uuid, source text, detail jsonb\)/,
  'the migration answers id, source and detail');
assert.match(sql, /if not may_manage_game\(p_game_id\) then\s*raise exception 'Not your game';/,
  "the migration asks admin_list_evidence's own question");
assert.match(sql, /and e\.source <> 'web'/, 'and lists only what did not come from the site');
// The panel's: by id, for the caller's own team's evidence or a game they run.
// runelite-plugin/server/test/regions.test.mjs proves what it answers.
const fn = sql.slice(sql.indexOf('create or replace function evidence_sources('));
assert.match(fn, /^create or replace function evidence_sources\(p_ids uuid\[\]\)\s*returns table \(id uuid, source text, detail jsonb\)/,
  'the panel is answered id, source and detail too');
assert.match(fn.slice(0, fn.indexOf('$$;')),
  /and e\.source <> 'web'\s*and \(may_manage_game\(t\.game_id\)\s*or e\.id in \(select m\.id from my_evidence\(t\.game_id\) m\)\);/,
  "by the questions the review screen and the team's own list already ask");
assert.match(sql, /revoke execute on function evidence_sources\(uuid\[\]\)\s+from public, anon, service_role;/,
  'and never to anyone not signed in');

// ---- The site's own upload is untouched ----
//
// A manual upload sends no source; plugin_drops.sql's trigger stamps it 'web'.

const upload = readFileSync(new URL('../src/lib/evidence.js', import.meta.url), 'utf8');
const call = upload.slice(upload.indexOf("supabase.rpc('add_evidence'"), upload.indexOf('});', upload.indexOf("supabase.rpc('add_evidence'")));
assert.ok(call.length > 0, 'found the upload call');
assert.doesNotMatch(call.replace(/\/\/.*$/gm, ''), /source|detail/, 'the upload call sends no source and no detail');

console.log('evidence-source selftest: ok');
