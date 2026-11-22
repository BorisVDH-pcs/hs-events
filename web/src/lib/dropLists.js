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
 * UNIQUES ONLY. Dink hands in every drop that matches a tile by itself, so a
 * list may only hold what a tile would want counted: the boss's rare drops.
 * Left out on purpose:
 *   - common drops that the collection log also shows (Bolt racks at Barrows,
 *     Key master teleports at Cerberus): they would finish a tile on their own;
 *   - drops every kill or every completion gives (anima seeds at Hespori,
 *     Dizana's quiver, the Gauntlet cape), except the Fire and Infernal capes,
 *     which are what those two are played for;
 *   - jars;
 *   - pets, outside the pet lists at the end.
 * Giant Mole has no list: besides its pet, its collection log is the skin and
 * claw every kill gives. Obor and Bryophyta have none either.
 * A tile that wants any of those gets them added by hand.
 *
 * `set` is the group a drop goes in when the tile uses a set rule ("something
 * from every set"). On a plain tile it is not used. A boss's own list puts
 * everything in one set named after the boss; the lists of several bosses
 * give each boss its own set. A drop that all four Desert Treasure II bosses
 * drop (Chromium ingot, the Virtus pieces) goes in each of the four sets:
 * Dink names the monster, and a drop counts only for the set named after the
 * monster it came from (20261122120000_set_from_monster.sql). The Godsword
 * shards are not in the God Wars lists, and the Dragon pickaxe and Dragon 2h
 * sword are not in the Wilderness bosses list (Boris, 2026-11-22): they are
 * not the uniques those tiles are about. Each boss's own list still has them.
 *
 * Sources: the OSRS Wiki, read 2026-11-21: the raid reward pages ("Ancient
 * chest", "Monumental chest", "Chest (Tombs of Amascut)"), each boss's page
 * (its "Uniques" drop table, or its collection log where it has none), and
 * "Pet".
 */
import { dropKey } from './itemNames.js';

// The headings in the editor's "Add a list…" menu, in this order.
export const LIST_GROUPS = ['Raids', 'Groups of bosses', 'Bosses', 'Pets'];

const inSet = (set, labels) => labels.map((label) => ({ label, set }));

// ---- Raids ----

const COX = 'Chambers of Xeric';
const TOB = 'Theatre of Blood';
const TOA = 'Tombs of Amascut';

const cox = inSet(COX, [
  'Dexterous prayer scroll', 'Arcane prayer scroll', 'Twisted buckler',
  'Dragon hunter crossbow', "Dinh's bulwark", 'Ancestral hat',
  'Ancestral robe top', 'Ancestral robe bottom', 'Dragon claws', 'Elder maul',
  'Kodai insignia', 'Twisted bow',
]);

const tob = inSet(TOB, [
  'Avernic defender hilt', 'Ghrazi rapier', 'Sanguinesti staff (uncharged)',
  'Justiciar faceguard', 'Justiciar chestguard', 'Justiciar legguards',
  'Scythe of Vitur (uncharged)',
]);

const toa = inSet(TOA, [
  "Osmumten's fang", 'Lightbearer', "Elidinis' ward", 'Masori mask',
  'Masori body', 'Masori chaps', "Tumeken's shadow (uncharged)",
]);

// What a player holds in the weapon slot. Kodai insignia and the Avernic hilt
// are parts, not weapons, and the shields and the ring are not weapons either.
const weapons = inSet('Raids weapons', [
  'Twisted bow', 'Dragon claws', 'Elder maul', 'Dragon hunter crossbow',
  "Dinh's bulwark", 'Ghrazi rapier', 'Sanguinesti staff (uncharged)',
  'Scythe of Vitur (uncharged)', "Osmumten's fang", "Tumeken's shadow (uncharged)",
]);

// ---- Bosses that come in groups ----
//
// Each boss's own drops, without the ones several bosses share.

const graardor = ['Bandos chestplate', 'Bandos tassets', 'Bandos boots', 'Bandos hilt'];
const zilyana = ['Saradomin sword', "Saradomin's light", 'Armadyl crossbow', 'Saradomin hilt'];
const kreearra = ['Armadyl helmet', 'Armadyl chestplate', 'Armadyl chainskirt', 'Armadyl hilt'];
const kril = ['Steam battlestaff', 'Zamorakian spear', 'Staff of the Dead', 'Zamorak hilt'];

// What all four drop: in each boss's set, in the group list and in the
// boss's own list. Each boss's quartz is its own.
const virtus = ['Chromium ingot', 'Virtus mask', 'Virtus robe top', 'Virtus robe bottom'];
const duke = ['Magus vestige', 'Eye of the Duke', 'Ice quartz', ...virtus];
const leviathan = ['Venator vestige', "Leviathan's lure", 'Smoke quartz', ...virtus];
const whisperer = ['Bellator vestige', "Siren's staff", 'Shadow quartz', ...virtus];
const vardorvis = ['Ultor vestige', "Executioner's axe head", 'Blood quartz', ...virtus];

// In the bosses' own lists only, not in the group list.
const wildyShared = ['Dragon pickaxe', 'Dragon 2h sword'];
const callisto = ['Claws of Callisto', 'Voidwaker hilt', 'Tyrannical ring'];
const vetion = ["Skull of Vet'ion", 'Voidwaker blade', 'Ring of the gods'];
const venenatis = ['Fangs of Venenatis', 'Voidwaker gem', 'Treasonous ring'];
const fanatic = ['Odium shard 1', 'Malediction shard 1'];
const crazyArch = ['Odium shard 2', 'Malediction shard 2'];
const scorpia = ['Odium shard 3', 'Malediction shard 3'];

const BARROWS = {
  "Ahrim's": ["Ahrim's hood", "Ahrim's robetop", "Ahrim's robeskirt", "Ahrim's staff"],
  "Dharok's": ["Dharok's helm", "Dharok's platebody", "Dharok's platelegs", "Dharok's greataxe"],
  "Guthan's": ["Guthan's helm", "Guthan's platebody", "Guthan's chainskirt", "Guthan's warspear"],
  "Karil's": ["Karil's coif", "Karil's leathertop", "Karil's leatherskirt", "Karil's crossbow"],
  "Torag's": ["Torag's helm", "Torag's platebody", "Torag's platelegs", "Torag's hammers"],
  "Verac's": ["Verac's helm", "Verac's brassard", "Verac's plateskirt", "Verac's flail"],
};

const MOONS = {
  'Blood Moon': ['Dual macuahuitl', 'Blood Moon helm', 'Blood Moon chestplate', 'Blood Moon tassets'],
  'Blue Moon': ['Blue Moon spear', 'Blue Moon helm', 'Blue Moon chestplate', 'Blue Moon tassets'],
  'Eclipse Moon': ['Eclipse atlatl', 'Eclipse Moon helm', 'Eclipse Moon chestplate', 'Eclipse Moon tassets'],
};

// A list of several bosses: each boss in its own set.
function group(bosses) {
  return Object.entries(bosses).flatMap(([boss, labels]) => inSet(boss, labels));
}

// ---- The lists ----

const raids = [
  { id: 'raids-uniques', name: 'Raids uniques, all three raids', drops: [...cox, ...tob, ...toa] },
  { id: 'cox-uniques', name: 'Chambers of Xeric uniques', drops: cox },
  { id: 'tob-uniques', name: 'Theatre of Blood uniques', drops: tob },
  { id: 'toa-uniques', name: 'Tombs of Amascut uniques', drops: toa },
  { id: 'raids-weapons', name: 'Raids weapons', drops: weapons },
].map((l) => ({ ...l, group: 'Raids' }));

const groups = [
  { id: 'barrows', name: 'Barrows, a set per brother', drops: group(BARROWS) },
  {
    id: 'gwd', name: 'God Wars Dungeon, the four generals',
    drops: group({
      'General Graardor': graardor, 'Commander Zilyana': zilyana,
      "Kree'arra": kreearra, "K'ril Tsutsaroth": kril,
    }),
  },
  {
    // A set is named as Dink names the monster, so that a shared drop counts
    // for the boss it came from.
    id: 'dt2', name: 'Desert Treasure II bosses',
    drops: group({
      'Duke Sucellus': duke, 'The Leviathan': leviathan,
      'The Whisperer': whisperer, 'Vardorvis': vardorvis,
    }),
  },
  { id: 'moons', name: 'Moons of Peril, a set per moon', drops: group(MOONS) },
  {
    id: 'wilderness', name: 'Wilderness bosses',
    drops: group({
      'Callisto and Artio': callisto, "Vet'ion and Calvar'ion": vetion,
      'Venenatis and Spindel': venenatis, 'Chaos Fanatic': fanatic,
      'Crazy archaeologist': crazyArch, 'Scorpia': scorpia,
    }),
  },
].map((l) => ({ ...l, group: 'Groups of bosses' }));

// One boss each, alphabetical, named as players say them ("Nightmare", not
// "The Nightmare") so typing a letter in the menu finds them.
const BOSSES = {
  'Abyssal Sire': [
    // Unsired is the drop; the rest come from offering it at the Font of
    // Consumption, which Dink does not report: those are uploaded by hand.
    'Unsired', 'Abyssal head', 'Bludgeon spine', 'Bludgeon claw', 'Bludgeon axon', 'Abyssal dagger',
  ],
  'Alchemical Hydra': [
    "Hydra's eye", "Hydra's fang", "Hydra's heart", 'Hydra tail', 'Hydra leather',
    "Hydra's claw", 'Dragon thrownaxe', 'Dragon knife',
  ],
  'Amoxliatl': ['Glacial temotli', 'Pendant of Ates (inert)'],
  'Araxxor': ['Noxious pommel', 'Noxious point', 'Noxious blade', 'Araxyte fang'],
  'Brutus': ['Mooleta', 'Bottomless milk bucket (empty)', 'Cow slippers'],
  'Callisto and Artio': [...callisto, ...wildyShared],
  'Cerberus': ['Primordial crystal', 'Pegasian crystal', 'Eternal crystal', 'Smouldering stone'],
  'Chaos Elemental': wildyShared,
  'Chaos Fanatic': fanatic,
  'Commander Zilyana': zilyana,
  'Corporeal Beast': ['Spectral sigil', 'Arcane sigil', 'Elysian sigil', 'Spirit shield', 'Holy elixir'],
  'Crazy archaeologist': crazyArch,
  'Dagannoth Kings': [
    'Berserker ring', 'Warrior ring', 'Seers ring', 'Archers ring', 'Dragon axe',
    'Seercull', 'Mud battlestaff',
  ],
  'Deranged archaeologist': ['Steel ring'],
  'Doom of Mokhaiotl': ['Avernic treads', 'Eye of Ayak (uncharged)', 'Mokhaiotl cloth'],
  'Duke Sucellus': duke,
  'Fight Caves': ['Fire cape'],
  'Fortis Colosseum': [
    'Sunfire fanatic helm', 'Sunfire fanatic cuirass', 'Sunfire fanatic chausses',
    'Tonalztics of Ralos (uncharged)', 'Echo crystal',
  ],
  'Gauntlet (and Corrupted)': ['Crystal weapon seed', 'Crystal armour seed', 'Enhanced crystal weapon seed'],
  'General Graardor': graardor,
  'Grotesque Guardians': ['Granite maul', 'Granite gloves', 'Granite ring', 'Granite hammer', 'Black tourmaline core'],
  'Hespori': ['Bottomless compost bucket'],
  'Hueycoatl': ['Dragon hunter wand', 'Tome of Earth (empty)'],
  'Inferno': ['Infernal cape'],
  "K'ril Tsutsaroth": kril,
  'Kalphite Queen': ['Kq head', 'Dragon chainbody', 'Dragon 2h sword', 'Dragon pickaxe'],
  'King Black Dragon': ['Dragon pickaxe', 'Draconic visage'],
  'Kraken': ['Trident of the Seas (full)', 'Kraken tentacle'],
  "Kree'arra": kreearra,
  'Leviathan': leviathan,
  'Mad Angel': ['Hallowfell'],
  'Maggot King': ['Elder venator fang', 'Crimson kisten'],
  'Nex': [
    'Ancient hilt', 'Nihil horn', 'Torva full helm (damaged)', 'Torva platebody (damaged)',
    'Torva platelegs (damaged)', 'Zaryte vambraces',
  ],
  "Nightmare (and Phosani's)": [
    'Nightmare staff', "Inquisitor's great helm", "Inquisitor's hauberk", "Inquisitor's plateskirt",
    "Inquisitor's mace", 'Eldritch orb', 'Harmonised orb', 'Volatile orb',
  ],
  'Phantom Muspah': ['Venator shard'],
  'Royal Titans': ['Fire element staff crown', 'Mystic vigour prayer scroll', 'Ice element staff crown', 'Deadeye prayer scroll'],
  'Sarachnis': ['Sarachnis cudgel'],
  'Scorpia': scorpia,
  'Scurrius': ["Scurrius' spine"],
  'Shellbane Gryphon': ["Belle's folly (tarnished)"],
  'Skotizo': ['Dark claw', 'Uncut onyx'],
  'Tempoross': ['Fish barrel', 'Tackle box', 'Big harpoonfish', 'Tome of Water (empty)', 'Dragon harpoon'],
  'Thermonuclear smoke devil': ['Occult necklace', 'Smoke battlestaff', 'Dragon chainbody'],
  'Vardorvis': vardorvis,
  'Venenatis and Spindel': [...venenatis, ...wildyShared],
  "Vet'ion and Calvar'ion": [...vetion, ...wildyShared],
  'Vorkath': ['Draconic visage', 'Skeletal visage', 'Dragonbone necklace'],
  'Whisperer': whisperer,
  'Wintertodt': [
    'Warm gloves', 'Bruma torch', 'Pyromancer hood', 'Pyromancer garb', 'Pyromancer robe',
    'Pyromancer boots', 'Tome of Fire (empty)', 'Dragon axe',
  ],
  'Yama': ['Soulflame horn', 'Oathplate helm', 'Oathplate chest', 'Oathplate legs'],
  'Zalcano': ['Crystal tool seed', 'Zalcano shard', 'Uncut onyx'],
  'Zulrah': ['Tanzanite fang', 'Magic fang', 'Serpentine visage', 'Uncut onyx', 'Tanzanite mutagen', 'Magma mutagen'],
};

const slug = (name) => dropKey(name).replace(/ /g, '-');

const bosses = Object.entries(BOSSES).map(([name, labels]) => ({
  id: slug(name), name, group: 'Bosses', drops: inSet(name, labels),
}));

// ---- Pets ----
//
// From the wiki's "Pet" page. A pet arrives from Dink as a pet, not as loot,
// with the pet's name, and is matched the same way.

const BOSS_PETS = [
  'Abyssal orphan', 'Aggy', 'Baby Mole', 'Baron', 'Beef', 'Bran', 'Butch',
  'Callisto cub', 'Dom', 'Hellpuppy', 'Huberte', 'Ikkle Hydra',
  'Jal-Nib-Rek', 'Kalphite Princess', "Lil' Zik", "Lil'viathan",
  'Little Nightmare', 'Maggot marquess', 'Moxi', 'Muphin', 'Nexling', 'Nid',
  'Noon', 'Olmlet', 'Orion', 'Pet chaos elemental', 'Pet Dagannoth Prime',
  'Pet Dagannoth Rex', 'Pet Dagannoth Supreme', 'Pet dark core',
  'Pet General Graardor', "Pet K'ril Tsutsaroth", 'Pet Kraken', "Pet Kree'arra",
  'Pet Smoke Devil', 'Pet Snakeling', 'Pet Zilyana', 'Phoenix',
  'Prince Black Dragon', "Scorpia's offspring", 'Scurry', 'Skotos',
  'Smol Heredit', 'Smolcano', 'Sraracha', 'Tiny tempor', "Tumeken's guardian",
  'TzRek-Jad', 'Venenatis spiderling', "Vet'ion Jr.", 'Vorki', 'Wisp', 'Yami',
  'Youngllef',
];
const SKILLING_PETS = [
  'Baby chinchompa', 'Beaver', 'Giant Squirrel', 'Heron', 'Rift guardian',
  'Rock golem', 'Rocky', 'Soup', 'Tangleroot',
];
const OTHER_PETS = [
  'Abyssal protector', 'Bloodhound', 'Chompy chick', 'Herbi', "Lil' Creator",
  'Mr McGroot', 'Pet Penance Queen', 'Quetzin',
];

const pets = [
  {
    id: 'all-pets', name: 'All pets',
    drops: group({ 'Boss pets': BOSS_PETS, 'Skilling pets': SKILLING_PETS, 'Other pets': OTHER_PETS }),
  },
  { id: 'boss-pets', name: 'Boss pets', drops: inSet('Boss pets', BOSS_PETS) },
  { id: 'skilling-pets', name: 'Skilling pets', drops: inSet('Skilling pets', SKILLING_PETS) },
].map((l) => ({ ...l, group: 'Pets' }));

export const DROP_LISTS = [...raids, ...groups, ...bosses, ...pets];

/**
 * The tile's drops with a list added.
 *
 * Drops the tile already has (by the name Dink would match) are not added
 * twice, and empty rows ("Add drop" pressed, nothing typed) are cleared so the
 * list does not land below a blank. On a set rule each drop gets its list's
 * set; on a plain tile the set stays empty, since nothing reads it there.
 * A drop a list has in several sets (the Desert Treasure II ingot) is added
 * once per set on a set rule, and once on a plain tile.
 */
export function addDropList(options, list, rule) {
  const kept = (options ?? []).filter((o) => (o.label ?? '').trim() || (o.grp ?? '').trim());
  const have = new Set(kept.map((o) => dropKey(o.label)).filter(Boolean));
  const sets = (rule ?? 'points') !== 'points';
  const seen = new Set();
  const added = list.drops
    .filter((d) => !have.has(dropKey(d.label)))
    .map((d) => ({ label: d.label, points: '1', grp: sets ? d.set : '', maxTimes: '' }))
    .filter((o) => {
      const key = `${dropKey(o.label)}|${o.grp}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return [...kept, ...added];
}
