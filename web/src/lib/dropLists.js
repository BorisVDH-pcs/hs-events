/**
 * Ready-made lists of drops for the tile editor.
 *
 * A tile like "3 raids uniques" needs every raid unique as a drop of its own,
 * or Dink has nothing to match a purple against. Typing twenty-six names, and
 * typing each the way the game spells it, is the job these do once: choose a
 * list and its drops are added to the tile, spelled as the items are.
 *
 * Each drop is the item as it drops. Raid weapons that hold a charge drop
 * uncharged, so the list says "Tumeken's shadow (uncharged)", not "Tumeken's
 * shadow". Every name is checked against the item list by
 * scripts/item-names-selftest.mjs.
 *
 * `set` is the group a drop goes in when the tile uses a set rule ("something
 * from every set"). On a plain tile it is not used.
 *
 * Sources: the OSRS Wiki's raid reward pages, "Ancient chest", "Monumental
 * chest" and "Chest (Tombs of Amascut)", read 2026-11-21. Purples only: a tile
 * that also counts the pets, dusts or kits gets those added by hand.
 */
import { dropKey } from './itemNames.js';

const COX = 'Chambers of Xeric';
const TOB = 'Theatre of Blood';
const TOA = 'Tombs of Amascut';

const cox = [
  'Dexterous prayer scroll', 'Arcane prayer scroll', 'Twisted buckler',
  'Dragon hunter crossbow', "Dinh's bulwark", 'Ancestral hat',
  'Ancestral robe top', 'Ancestral robe bottom', 'Dragon claws', 'Elder maul',
  'Kodai insignia', 'Twisted bow',
].map((label) => ({ label, set: COX }));

const tob = [
  'Avernic defender hilt', 'Ghrazi rapier', 'Sanguinesti staff (uncharged)',
  'Justiciar faceguard', 'Justiciar chestguard', 'Justiciar legguards',
  'Scythe of Vitur (uncharged)',
].map((label) => ({ label, set: TOB }));

const toa = [
  "Osmumten's fang", 'Lightbearer', "Elidinis' ward", 'Masori mask',
  'Masori body', 'Masori chaps', "Tumeken's shadow (uncharged)",
].map((label) => ({ label, set: TOA }));

// What a player holds in the weapon slot. Kodai insignia and the Avernic hilt
// are parts, not weapons, and the shields and the ring are not weapons either.
const WEAPONS = 'Raids weapons';
const weapons = [
  'Twisted bow', 'Dragon claws', 'Elder maul', 'Dragon hunter crossbow',
  "Dinh's bulwark", 'Ghrazi rapier', 'Sanguinesti staff (uncharged)',
  'Scythe of Vitur (uncharged)', "Osmumten's fang", "Tumeken's shadow (uncharged)",
].map((label) => ({ label, set: WEAPONS }));

export const DROP_LISTS = [
  { id: 'raids-uniques', name: 'Raids uniques, all three raids', drops: [...cox, ...tob, ...toa] },
  { id: 'cox-uniques', name: 'Chambers of Xeric uniques', drops: cox },
  { id: 'tob-uniques', name: 'Theatre of Blood uniques', drops: tob },
  { id: 'toa-uniques', name: 'Tombs of Amascut uniques', drops: toa },
  { id: 'raids-weapons', name: 'Raids weapons', drops: weapons },
];

/**
 * The tile's drops with a list added.
 *
 * Drops the tile already has (by the name Dink would match) are not added
 * twice, and empty rows ("Add drop" pressed, nothing typed) are cleared so the
 * list does not land below a blank. On a set rule each drop gets its list's
 * set; on a plain tile the set stays empty, since nothing reads it there.
 */
export function addDropList(options, list, rule) {
  const kept = (options ?? []).filter((o) => (o.label ?? '').trim() || (o.grp ?? '').trim());
  const have = new Set(kept.map((o) => dropKey(o.label)).filter(Boolean));
  const sets = (rule ?? 'points') !== 'points';
  const added = list.drops
    .filter((d) => !have.has(dropKey(d.label)))
    .map((d) => ({ label: d.label, points: '1', grp: sets ? d.set : '', maxTimes: '' }));
  return [...kept, ...added];
}
