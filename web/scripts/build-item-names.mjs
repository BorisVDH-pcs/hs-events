/**
 * Writes `src/lib/itemNames.data.js`: the names of OSRS items, for the tile
 * editor's check on drop names (lib/itemNames.js).
 *
 * Two sources, both the Old School RuneScape Wiki:
 *
 *   - its price list, which has every item that can be traded on the Grand
 *     Exchange under its exact name (prices.runescape.wiki, the "mapping"
 *     endpoint). The wiki asks for one thing only: a User-Agent that says who
 *     is asking. Fetched in memory; nothing it sends is run or kept apart from
 *     the names, and each name is checked before it is written.
 *   - UNTRADEABLE below, typed from the wiki's own pages, because the price
 *     list leaves out everything that cannot be traded: pets above all.
 *
 * The list is generated and committed, like the icon manifest. Re-run it when
 * the game adds items, or a drop that exists is flagged as not existing:
 *
 *     npm run items:names              fetches the price list
 *     npm run items:names -- file.json reads one already downloaded
 *
 * Wiki content is licensed CC BY-NC-SA 3.0; the generated file says so.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'src', 'lib', 'itemNames.data.js');
const SOURCE = 'https://prices.runescape.wiki/api/v1/osrs/mapping';
// Descriptive, as the wiki asks, and nothing about who runs it.
const USER_AGENT = 'hs-events-item-list/1.0 (OSRS clan events site; tile editor name check; run by hand)';

// Read from the wiki on 2026-11-21. Pets: "Pet", the boss, skilling and
// collection-log tables (not the generic pets such as cats). Raids: the
// tertiary and challenge rewards on "Ancient chest", "Monumental chest" and
// "Chest (Tombs of Amascut)". Jars: "Jar", the boss lair jars. Names already in
// the price list are harmless here; the duplicates are dropped.
const UNTRADEABLE = [
  // Boss pets
  'Abyssal orphan', 'Aggy', 'Baby Mole', 'Baron', 'Beef', 'Bran', 'Butch',
  'Callisto cub', 'Dom', 'Gull', 'Hellpuppy', 'Huberte', 'Ikkle Hydra',
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
  // Skilling pets
  'Baby chinchompa', 'Beaver', 'Giant Squirrel', 'Heron', 'Rift guardian',
  'Rock golem', 'Rocky', 'Soup', 'Tangleroot',
  // Other pets in the collection log
  'Abyssal protector', 'Bloodhound', 'Chompy chick', 'Herbi', "Lil' Creator",
  'Mr McGroot', 'Pet Penance Queen', 'Quetzin',
  // Chambers of Xeric
  'Twisted ancestral colour kit', 'Metamorphic dust', 'Dark journal',
  // Theatre of Blood
  'Sanguine dust', 'Holy ornament kit', 'Sanguine ornament kit',
  // Tombs of Amascut
  'Thread of Elidinis', 'Eye of the Corruptor', 'Jewel of the Sun',
  'Breach of the Scarab', 'Jewel of Amascut', 'Cursed phalanx',
  'Masori crafting kit', 'Menaphite ornament kit', 'Remnant of Akkha',
  'Remnant of Ba-Ba', 'Remnant of Kephri', 'Remnant of Zebak', 'Ancient remnant',
  // Boss jars
  'Jar of Chemicals', 'Jar of Darkness', 'Jar of Decay', 'Jar of Dirt',
  'Jar of Dreams', 'Jar of Eyes', 'Jar of Feathers', 'Jar of Light',
  'Jar of Miasma', 'Jar of Sand', 'Jar of Smoke', 'Jar of Souls',
  'Jar of Spirits', 'Jar of Stone', 'Jar of Swamp', 'Jar of Venom',
  // Boss uniques in src/lib/dropLists.js that cannot be traded. Each title
  // checked to exist on the wiki on 2026-11-21; two were renamed in August
  // 2026 ("Eye of the Duke", "Pendant of Ates"), and these are the new names.
  'Unsired', 'Abyssal head', 'Bludgeon spine', 'Bludgeon claw', 'Bludgeon axon',
  "Hydra's eye", "Hydra's fang", "Hydra's heart",
  'Pendant of Ates (inert)',
  'Noxious pommel', 'Noxious point', 'Noxious blade', 'Araxyte fang',
  'Mooleta', 'Bottomless milk bucket (empty)',
  'Mokhaiotl cloth',
  'Magus vestige', 'Eye of the Duke', 'Venator vestige', "Leviathan's lure",
  'Bellator vestige', "Siren's staff", 'Ultor vestige', "Executioner's axe head",
  'Fire cape', 'Infernal cape',
  'Kq head', "Vorkath's head",
  'Elder venator fang',
  'Mystic vigour prayer scroll', 'Deadeye prayer scroll',
  "Scurrius' spine",
  'Dark claw',
  'Fish barrel', 'Tackle box', 'Big harpoonfish',
  'Warm gloves', 'Bruma torch', 'Pyromancer hood', 'Pyromancer garb',
  'Pyromancer robe', 'Pyromancer boots',
  'Tanzanite mutagen', 'Magma mutagen',
];

// A name as the game prints it: letters, digits, spaces and ordinary
// punctuation, at most the tile editor's 80 characters. Anything else means
// the source sent something that is not a name, and the run stops.
const NAME = /^[\p{L}\p{N} '’()\-.,!&:+/%#?]{1,80}$/u;

async function priceList(path) {
  if (path) return JSON.parse(readFileSync(path, 'utf8'));
  const res = await fetch(SOURCE, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${SOURCE}: ${res.status}`);
  return res.json();
}

const list = await priceList(process.argv[2]);
if (!Array.isArray(list)) throw new Error('The price list is not a list');
// Fewer than this is an error page or a cut-off download, not the game.
if (list.length < 3000) throw new Error(`Only ${list.length} items in the price list`);

const names = new Set();
for (const item of [...list.map((i) => i?.name), ...UNTRADEABLE]) {
  if (typeof item !== 'string' || !NAME.test(item.trim())) {
    throw new Error(`Not a name: ${JSON.stringify(item).slice(0, 100)}`);
  }
  names.add(item.trim());
}
const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en'));

const body = `// Generated by scripts/build-item-names.mjs — do not edit by hand.
// Re-run \`npm run items:names\` when the game adds items.
//
// The names of OSRS items: every one the Grand Exchange trades (the OSRS
// Wiki's price list) and the untradeable pets and raid drops typed into the
// script. From the Old School RuneScape Wiki, CC BY-NC-SA 3.0.
// ${sorted.length} names, ${new Date().toISOString().slice(0, 10)}.

export const ITEM_NAMES = [
${sorted.map((n) => `  ${JSON.stringify(n)},`).join('\n')}
];
`;
writeFileSync(out, body);
console.log(`Wrote ${sorted.length} names to src/lib/itemNames.data.js`);
