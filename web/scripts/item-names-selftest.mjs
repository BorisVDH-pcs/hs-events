import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ITEM_NAMES } from '../src/lib/itemNames.data.js';
import { dropKey, loadItemNames, makeItemIndex } from '../src/lib/itemNames.js';
import { DROP_LISTS, LIST_GROUPS, addDropList } from '../src/lib/dropLists.js';
import { payloadFromDraft, validateDraft } from '../src/lib/tileDraft.js';

// ---- dropKey is the server's drop_key ----
//
// The same cases as server/test/tokens.test.mjs (SQL).
// tokens.test.mjs also runs this function against the SQL over every name.

for (const [input, want] of [
  ["Dharok's helm", 'dharoks helm'],
  ['Dharok’s  Helm ', 'dharoks helm'],
  ['dharoks helm', 'dharoks helm'],
  ["Black d'hide body (g)", 'black dhide body g'],
  ['Abyssal whip', 'abyssal whip'],
  ['3rd age full helmet', '3rd age full helmet'],
  ["Tumeken's shadow (uncharged)", 'tumekens shadow uncharged'],
  ['  ’ ', null],
  [null, null],
  [undefined, null],
]) {
  assert.equal(dropKey(input), want, `dropKey(${JSON.stringify(input)})`);
}

// ---- The generated list ----

assert.ok(ITEM_NAMES.length > 4000, `a whole game's worth of names (${ITEM_NAMES.length})`);
assert.equal(new Set(ITEM_NAMES).size, ITEM_NAMES.length, 'no name twice');
for (const name of ITEM_NAMES) {
  assert.ok(typeof name === 'string' && name === name.trim() && name.length <= 80, `a clean name: ${JSON.stringify(name)}`);
  assert.doesNotMatch(name, /[\u0000-\u001f<>]/, `no control characters or markup: ${JSON.stringify(name)}`);
}
const items = makeItemIndex(ITEM_NAMES);

// Tradeable, from the price list.
for (const name of ['Twisted bow', "Thammaron's sceptre (u)", 'Abyssal whip', 'Raw beef', 'Cowhide', 'Feather', 'Bones']) {
  assert.ok(items.known(name), `${name} is an item`);
}
// Untradeable, typed into the build script: the price list has none of these.
for (const name of ['Olmlet', "Lil' Zik", "Tumeken's guardian", 'Metamorphic dust', 'Thread of Elidinis', 'Jar of dirt']) {
  assert.ok(items.known(name), `${name} is an item`);
}
// Forgiven the way the server forgives it.
assert.ok(items.known('THAMMARONS  SCEPTRE (u)'), 'capitals, apostrophe and spacing do not matter');

// ---- The check ----

assert.equal(items.check(''), null, 'a blank row is left alone');
assert.equal(items.check('   '), null);
assert.equal(items.check('Twisted bow'), null, 'a real item has nothing to say');

const sceptre = items.check('thamarons sceptre');
assert.ok(sceptre, 'Boris’s example is flagged');
assert.equal(sceptre.suggestions[0], "Thammaron's sceptre (u)", 'and the drop it meant comes first');

for (const [typed, meant] of [
  ["Tumeken's shadow", "Tumeken's shadow (uncharged)"],      // the bracket left out
  ['Scythe of vitur', 'Scythe of Vitur (uncharged)'],
  ['Sanguinesti staff', 'Sanguinesti staff (uncharged)'],
  ["Thammaron's scepter", "Thammaron's sceptre (u)"],        // US spelling
  ['Thammarons sceptre (uncharged)', "Thammaron's sceptre (u)"], // the wrong bracket
  ['Twsited bow', 'Twisted bow'],                             // two letters swapped
  ['Dragon claw', 'Dragon claws'],                            // one letter short
]) {
  const found = items.check(typed);
  assert.ok(found, `"${typed}" is flagged`);
  assert.ok(found.suggestions.includes(meant), `"${typed}" offers "${meant}" (got ${JSON.stringify(found.suggestions)})`);
  assert.ok(found.suggestions.length <= 3, 'three suggestions at most');
}

// Not an item and not near one: flagged, with nothing to offer.
assert.deepEqual(items.check('Any Barrows piece'), { suggestions: [] });
// Short names are not guessed at: one slip from a four-letter word is too many words.
assert.deepEqual(items.check('Bonz'), { suggestions: [] });

// Loaded lazily, and once.
const a = await loadItemNames();
const b = await loadItemNames();
assert.equal(a, b, 'one index, loaded once');
assert.equal(a.size, items.size);

// ---- The ready-made lists ----

const ids = new Set();
for (const list of DROP_LISTS) {
  assert.ok(!ids.has(list.id), `list id ${list.id} is unique`);
  ids.add(list.id);
  assert.ok(list.drops.length > 0, `${list.name} has drops`);
  // Once in each set. A drop may be in several sets (the Desert Treasure II
  // ingot, in each boss's), never twice in one.
  const keys = new Set();
  for (const drop of list.drops) {
    assert.ok(items.known(drop.label), `${list.name}: "${drop.label}" is an item`);
    assert.ok(drop.set && drop.set.trim(), `${list.name}: "${drop.label}" has a set`);
    const key = `${dropKey(drop.label)}|${drop.set}`;
    assert.ok(!keys.has(key), `${list.name}: "${drop.label}" only once in ${drop.set}`);
    keys.add(key);
  }
  if (list.id !== 'dt2') {
    const labels = list.drops.map((d) => dropKey(d.label));
    assert.equal(new Set(labels).size, labels.length, `${list.name}: each drop in one set only`);
  }
}
const byId = Object.fromEntries(DROP_LISTS.map((l) => [l.id, l]));
const exact = new Set(ITEM_NAMES);
for (const list of DROP_LISTS) {
  for (const drop of list.drops) {
    // Not just a name Dink would match: the name as the game prints it, so
    // the tile shows it the way the drop looks.
    assert.ok(exact.has(drop.label), `${list.name}: "${drop.label}" is spelled as the item is`);
  }
  assert.ok(LIST_GROUPS.includes(list.group), `${list.name} sits under a heading (${list.group})`);
}
for (const heading of LIST_GROUPS) {
  assert.ok(DROP_LISTS.some((l) => l.group === heading), `${heading} has lists`);
}
const bossNames = DROP_LISTS.filter((l) => l.group === 'Bosses').map((l) => l.name);
assert.deepEqual(bossNames, [...bossNames].sort((a, b) => a.localeCompare(b, 'en')), 'bosses are alphabetical');
assert.ok(bossNames.every((n) => !/^The /.test(n)), 'no boss starts with "The", so typing a letter finds it');
assert.ok(bossNames.length >= 50, `the collection log's bosses (${bossNames.length})`);

const sets = (id) => [...new Set(byId[id].drops.map((d) => d.set))];
const inSet = (id, set) => byId[id].drops.filter((d) => d.set === set).map((d) => d.label);

// Barrows: four pieces from each of six brothers, a set each.
assert.equal(byId.barrows.drops.length, 24, 'Barrows: twenty-four pieces');
assert.deepEqual(sets('barrows'), ["Ahrim's", "Dharok's", "Guthan's", "Karil's", "Torag's", "Verac's"]);
for (const brother of sets('barrows')) {
  const pieces = inSet('barrows', brother);
  assert.equal(pieces.length, 4, `${brother}: four pieces`);
  assert.ok(pieces.every((p) => p.startsWith(brother)), `${brother}: only ${brother} pieces`);
}

// God Wars: a set per general, each with its four uniques. The Godsword
// shards are not uniques, and are in no God Wars list (Boris, 2026-11-22).
assert.deepEqual(sets('gwd'), ['General Graardor', 'Commander Zilyana', "Kree'arra", "K'ril Tsutsaroth"]);
assert.equal(byId.gwd.drops.length, 16, 'God Wars: four uniques from each general');
for (const general of ['general-graardor', 'commander-zilyana', 'kreearra', 'kril-tsutsaroth']) {
  assert.ok(byId[general], `${general} has a list of its own`);
  assert.equal(byId[general].drops.length, 4, `${general}: four uniques`);
  assert.deepEqual(byId[general].drops.map((d) => d.label), inSet('gwd', byId[general].name),
    `${general}: the same four as in the God Wars list`);
}
for (const list of DROP_LISTS) {
  assert.ok(!list.drops.some((d) => /^Godsword shard/.test(d.label)), `${list.name}: no Godsword shard`);
}
assert.ok(inSet('gwd', "K'ril Tsutsaroth").includes('Staff of the Dead'));

assert.deepEqual(byId.nex.drops.map((d) => d.label), [
  'Ancient hilt', 'Nihil horn', 'Torva full helm (damaged)', 'Torva platebody (damaged)',
  'Torva platelegs (damaged)', 'Zaryte vambraces',
], 'Nex: six uniques, the Torva as it drops');

assert.deepEqual(sets('moons'), ['Blood Moon', 'Blue Moon', 'Eclipse Moon']);
// Desert Treasure II: a set per boss, named as Dink names the monster, so a
// drop all four share (the ingot, the Virtus) counts for the boss it came
// from. Each set has the boss's own two, its quartz and the four shared.
const virtus = ['Chromium ingot', 'Virtus mask', 'Virtus robe top', 'Virtus robe bottom'];
assert.deepEqual(sets('dt2'), ['Duke Sucellus', 'The Leviathan', 'The Whisperer', 'Vardorvis']);
for (const [boss, own, quartz] of [
  ['Duke Sucellus', 'duke-sucellus', 'Ice quartz'], ['The Leviathan', 'leviathan', 'Smoke quartz'],
  ['The Whisperer', 'whisperer', 'Shadow quartz'], ['Vardorvis', 'vardorvis', 'Blood quartz'],
]) {
  const drops = inSet('dt2', boss);
  assert.equal(drops.length, 7, `${boss}: two uniques, a quartz and the four shared`);
  assert.equal(drops[2], quartz, `${boss}: its own quartz`);
  assert.deepEqual(drops.slice(3), virtus, `${boss}: the ingot and the Virtus`);
  assert.deepEqual(byId[own].drops.map((d) => d.label), drops, `${boss}'s own list is the same seven`);
}
assert.equal(byId.dt2.drops.filter((d) => /quartz$/.test(d.label)).length, 4, 'four quartzes, one per boss');

// Wilderness: a set per boss and nothing more. The Dragon pickaxe and Dragon
// 2h sword are not in the group list (Boris, 2026-11-22); the bosses' own
// lists still have them.
assert.deepEqual(sets('wilderness'), ['Callisto and Artio', "Vet'ion and Calvar'ion", 'Venenatis and Spindel',
  'Chaos Fanatic', 'Crazy archaeologist', 'Scorpia']);
assert.ok(!byId.wilderness.drops.some((d) => /^Dragon (pickaxe|2h sword)$/.test(d.label)), 'no pickaxe or 2h in the group list');
for (const name of ['Callisto and Artio', "Vet'ion and Calvar'ion", 'Venenatis and Spindel', 'Chaos Elemental']) {
  const labels = DROP_LISTS.find((l) => l.name === name).drops.map((d) => d.label);
  assert.ok(labels.includes('Dragon pickaxe') && labels.includes('Dragon 2h sword'), `${name}'s own list keeps both`);
}

// Every drop that is a pet is in a pet list, and nowhere else.
const petKeys = new Set(byId['all-pets'].drops.map((d) => dropKey(d.label)));
assert.equal(byId['all-pets'].drops.length, byId['boss-pets'].drops.length + byId['skilling-pets'].drops.length
  + inSet('all-pets', 'Other pets').length, 'all pets is the boss, skilling and other pets');
assert.ok(!petKeys.has('gull'), 'Gull is left out until its item name is checked');
for (const list of DROP_LISTS.filter((l) => l.group !== 'Pets')) {
  for (const drop of list.drops) {
    assert.ok(!petKeys.has(dropKey(drop.label)), `${list.name}: no pet (${drop.label})`);
    assert.doesNotMatch(drop.label, /^Jar of /, `${list.name}: no jar (${drop.label})`);
  }
}
// Left out on purpose: drops common enough, or certain enough, to finish a
// tile without anyone getting lucky. Dink would hand them in by itself.
const everything = new Set(DROP_LISTS.flatMap((l) => l.drops.map((d) => dropKey(d.label))));
for (const common of ['Bolt rack', 'Key master teleport', "Dizana's quiver (uncharged)", 'Gauntlet cape',
  'Attas seed', 'Iasor seed', 'Kronos seed', 'Abyssal whip', 'Ancient shard', 'Zulrah\'s scales', 'Dragon bones']) {
  assert.ok(!everything.has(dropKey(common)), `"${common}" is in no list`);
}

assert.equal(byId['cox-uniques'].drops.length, 12, 'Chambers of Xeric: twelve purples');
assert.equal(byId['tob-uniques'].drops.length, 7, 'Theatre of Blood: seven');
assert.equal(byId['toa-uniques'].drops.length, 7, 'Tombs of Amascut: seven');
assert.equal(byId['raids-uniques'].drops.length, 26, 'all three, twenty-six');
// The weapons that hold a charge drop without one.
for (const label of byId['raids-weapons'].drops.map((d) => d.label)) {
  assert.doesNotMatch(label, /^(Tumeken's shadow|Scythe of Vitur|Sanguinesti staff)$/, `${label} is named as it drops`);
}

// ---- Adding a list to a tile ----

const blank = { label: '', points: '1', grp: '', maxTimes: '' };
const whip = { label: 'Abyssal whip', points: '2', grp: '', maxTimes: '1' };
const cox = byId['cox-uniques'];

let options = addDropList([blank], cox, 'points');
assert.equal(options.length, 12, 'the blank row left by "Add drop" is cleared');
assert.ok(options.every((o) => o.points === '1' && o.grp === '' && o.maxTimes === ''), 'a plain tile gets no sets');

options = addDropList([whip, { ...blank, label: 'twisted BOW' }], cox, 'points');
assert.equal(options.length, 13, 'a drop already on the tile is not added twice');
assert.equal(options[0], whip, 'what was there stays as it was, first');
assert.equal(options.filter((o) => dropKey(o.label) === 'twisted bow').length, 1);

options = addDropList([], byId['raids-uniques'], 'each_set');
assert.deepEqual([...new Set(options.map((o) => o.grp))], ['Chambers of Xeric', 'Theatre of Blood', 'Tombs of Amascut'],
  'a set rule gets one set per raid');
assert.deepEqual(addDropList(addDropList([], cox, 'points'), cox, 'points').length, 12, 'adding a list twice adds nothing');

// What a list makes is a tile the editor and the database accept, for every
// list and every rule that has drops.
for (const list of DROP_LISTS) {
  for (const rule of ['points', 'one_set', 'each_set', 'points_per_set']) {
    const draft = { name: list.name, icon: '', description: '', rule, amount: '1', perSet: '1',
      options: addDropList([], list, rule) };
    assert.deepEqual(validateDraft(draft), [], `a ${rule} tile from ${list.name} is valid`);
    // Every drop of the list, except that a drop in several of its sets is
    // there once on a plain tile.
    const want = new Set(list.drops.map((d) => `${dropKey(d.label)}|${rule === 'points' ? '' : d.set}`)).size;
    assert.equal(payloadFromDraft(draft).options.length, want, `${list.name} as a ${rule} tile`);
  }
}
// The Desert Treasure II list: the ingot once per boss on a set rule, once
// on a plain tile.
const ingots = (rule) => addDropList([], byId.dt2, rule).filter((o) => o.label === 'Chromium ingot');
assert.deepEqual(ingots('each_set').map((o) => o.grp), ['Duke Sucellus', 'The Leviathan', 'The Whisperer', 'Vardorvis']);
assert.equal(ingots('points').length, 1, 'a plain tile gets the ingot once');
assert.equal(addDropList([], byId.dt2, 'points').length, 16, 'a plain tile: twelve of the bosses\' own and the four shared');
// Two lists on one tile: what both hold is added once, in the first list's set.
options = addDropList(addDropList([], byId['kalphite-queen'], 'each_set'), byId['king-black-dragon'], 'each_set');
assert.equal(options.filter((o) => o.label === 'Dragon pickaxe').length, 1, 'the Dragon pickaxe only once');
assert.equal(options.find((o) => o.label === 'Dragon pickaxe').grp, 'Kalphite Queen');
assert.ok(options.some((o) => o.label === 'Draconic visage' && o.grp === 'King Black Dragon'));

// ---- Wired into the form ----

const form = readFileSync(new URL('../src/components/TileForm.jsx', import.meta.url), 'utf8');
const code = form.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
assert.match(code, /loadItemNames\(\)/, 'the form loads the names');
assert.match(code, /items\.check\(o\.label\)/, 'and checks each drop');
assert.match(code, /setOption\(index, \{ label: name \}\)/, 'a suggestion replaces the drop when clicked');
assert.match(code, /i === typing \? null : items\.check/, 'the drop being typed is not checked yet');
assert.match(code, /onFocus=\{\(\) => setTyping\(index\)\}/, 'typing starts when the box is entered');
assert.match(code, /onBlur=\{\(\) => setTyping\(null\)\}/, 'and ends when it is left');
assert.ok(code.indexOf('drop-warn-hint') > code.indexOf('</ul>'), 'the explanation sits below the list');
assert.match(code, /addDropList\(draft\.options, list, rule\)/, 'a list is added through addDropList');
assert.match(code, /LIST_GROUPS\.map\(\(g\) => \(\s*<optgroup key=\{g\} label=\{g\}>/, 'the menu has a heading per group');
assert.match(code, /DROP_LISTS\.filter\(\(l\) => l\.group === g\)/, 'and each list under its own heading');
assert.doesNotMatch(code, /import .*itemNames\.data/, 'the names are never in the main bundle');
// A warning, never a block: nothing about names may stop the save.
assert.doesNotMatch(code, /errors[^\n]*nameChecks|nameChecks[^\n]*errors/, 'name warnings are not errors');

console.log('item-names selftest: ok');
