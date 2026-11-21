import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ITEM_NAMES } from '../src/lib/itemNames.data.js';
import { dropKey, loadItemNames, makeItemIndex } from '../src/lib/itemNames.js';
import { DROP_LISTS, addDropList } from '../src/lib/dropLists.js';
import { payloadFromDraft, validateDraft } from '../src/lib/tileDraft.js';

// ---- dropKey is the server's drop_key ----
//
// The same cases as server/test/tokens.test.mjs (SQL) and CoreSelfTest (Java).
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
  const keys = new Set();
  for (const drop of list.drops) {
    assert.ok(items.known(drop.label), `${list.name}: "${drop.label}" is an item`);
    assert.ok(drop.set && drop.set.trim(), `${list.name}: "${drop.label}" has a set`);
    assert.ok(!keys.has(dropKey(drop.label)), `${list.name}: "${drop.label}" only once`);
    keys.add(dropKey(drop.label));
  }
}
const byId = Object.fromEntries(DROP_LISTS.map((l) => [l.id, l]));
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

// What the list makes is a tile the editor and the database accept.
for (const rule of ['points', 'one_set', 'each_set', 'points_per_set']) {
  const draft = { name: '3 raids uniques', icon: '', description: '', rule, amount: '3', perSet: '1',
    options: addDropList([], byId['raids-uniques'], rule) };
  assert.deepEqual(validateDraft(draft), [], `a ${rule} tile from the list is valid`);
  assert.equal(payloadFromDraft(draft).options.length, 26);
}

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
assert.doesNotMatch(code, /import .*itemNames\.data/, 'the names are never in the main bundle');
// A warning, never a block: nothing about names may stop the save.
assert.doesNotMatch(code, /errors[^\n]*nameChecks|nameChecks[^\n]*errors/, 'name warnings are not errors');

console.log('item-names selftest: ok');
