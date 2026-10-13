// The Territory map: real OSRS places on the real world map.
//
// Data only -- the rules live in territory.js. Kept apart because this file is
// long and changes for different reasons (a place moved, a link added).
//
// COORDINATES are game tiles, the same x/y the OSRS Wiki and RuneLite show, so
// a misplaced marker is fixed by looking the place up rather than by nudging
// pixels. The image is a crop of Explv's render of the surface (1 px per game
// tile) whose top-left corner is game tile (MAP.left, MAP.top), so
// px = x - left and py = top - y. scripts/territory-selftest.mjs checks every
// place lands on the image.
//
// ORDER IS IDENTITY. A place's number is its index in PLACES plus one, and its
// task is the tile at that square of an 8x8 card (placePosition in
// territory.js). So places are never reordered or removed once a game has
// used them. There are exactly 64, which fill the card; a 65th would need a
// 9x9 card, and the self-test says so.
//
// REGIONS are the eleven Leagues areas, which is how OSRS players already carve
// up the world.

export const MAP = {
  src: 'territory/osrs-world.webp',
  width: 2960,
  height: 1500,
  left: 1016,  // game x at the image's left edge
  top: 4160,   // game y at the image's top edge
  credit: 'Map © Jagex Ltd. Render by Explv (explv.github.io).',
};

/** Image pixel for a game coordinate. */
export function toPixel(x, y) {
  return { px: x - MAP.left, py: MAP.top - y };
}

export const REGIONS = [
  { key: 'misthalin', name: 'Misthalin' },
  { key: 'asgarnia', name: 'Asgarnia' },
  { key: 'kandarin', name: 'Kandarin' },
  { key: 'fremennik', name: 'Fremennik Provinces' },
  { key: 'wilderness', name: 'Wilderness' },
  { key: 'morytania', name: 'Morytania' },
  { key: 'desert', name: 'Kharidian Desert' },
  { key: 'karamja', name: 'Karamja' },
  { key: 'tirannwn', name: 'Tirannwn' },
  { key: 'kourend', name: 'Kourend & Kebos' },
  { key: 'varlamore', name: 'Varlamore' },
];

// [key, name, region, x, y]
const RAW = [
  ['lumbridge', 'Lumbridge', 'misthalin', 3222, 3218],
  ['draynor', 'Draynor Village', 'misthalin', 3093, 3248],
  ['wizards_tower', "Wizards' Tower", 'misthalin', 3109, 3162],
  ['varrock', 'Varrock', 'misthalin', 3212, 3428],
  ['barbarian_village', 'Barbarian Village', 'misthalin', 3082, 3420],
  ['edgeville', 'Edgeville', 'misthalin', 3093, 3493],

  ['falador', 'Falador', 'asgarnia', 2965, 3380],
  ['port_sarim', 'Port Sarim', 'asgarnia', 3023, 3208],
  ['rimmington', 'Rimmington', 'asgarnia', 2957, 3214],
  ['taverley', 'Taverley', 'asgarnia', 2895, 3443],
  ['burthorpe', 'Burthorpe', 'asgarnia', 2899, 3546],
  ['trollheim', 'Trollheim', 'asgarnia', 2890, 3675],

  ['catherby', 'Catherby', 'kandarin', 2813, 3447],
  ['seers', "Seers' Village", 'kandarin', 2725, 3485],
  ['ardougne', 'Ardougne', 'kandarin', 2662, 3305],
  ['yanille', 'Yanille', 'kandarin', 2606, 3093],
  ['gnome_stronghold', 'Gnome Stronghold', 'kandarin', 2465, 3495],
  ['barbarian_outpost', 'Barbarian Outpost', 'kandarin', 2530, 3570],
  ['feldip_hills', 'Feldip Hills', 'kandarin', 2550, 2950],

  ['rellekka', 'Rellekka', 'fremennik', 2660, 3660],
  ['neitiznot', 'Neitiznot', 'fremennik', 2335, 3805],
  ['lunar_isle', 'Lunar Isle', 'fremennik', 2100, 3915],
  ['waterbirth', 'Waterbirth Island', 'fremennik', 2525, 3740],
  ['weiss', 'Weiss', 'fremennik', 2850, 3935],

  ['ferox', 'Ferox Enclave', 'wilderness', 3130, 3630],
  ['bandit_camp_wild', 'Bandit Camp', 'wilderness', 3040, 3700],
  ['lava_maze', 'Lava Maze', 'wilderness', 3070, 3850],
  ['mage_arena', 'Mage Arena', 'wilderness', 3105, 3935],
  ['rogues_castle', "Rogues' Castle", 'wilderness', 3285, 3930],

  ['canifis', 'Canifis', 'morytania', 3494, 3483],
  ['port_phasmatys', 'Port Phasmatys', 'morytania', 3687, 3502],
  ['mort_myre', 'Mort Myre Swamp', 'morytania', 3440, 3400],
  ['barrows', 'Barrows', 'morytania', 3565, 3290],
  ['darkmeyer', 'Darkmeyer', 'morytania', 3600, 3370],
  ['ver_sinhaza', 'Ver Sinhaza', 'morytania', 3655, 3220],

  ['al_kharid', 'Al Kharid', 'desert', 3293, 3180],
  ['kalphite_lair', 'Kalphite Lair', 'desert', 3227, 3108],
  ['pollnivneach', 'Pollnivneach', 'desert', 3359, 2970],
  ['nardah', 'Nardah', 'desert', 3428, 2918],
  ['sophanem', 'Sophanem', 'desert', 3300, 2770],
  ['uzer', 'Uzer', 'desert', 3480, 3090],

  ['musa_point', 'Musa Point', 'karamja', 2920, 3170],
  ['brimhaven', 'Brimhaven', 'karamja', 2760, 3178],
  ['tai_bwo_wannai', 'Tai Bwo Wannai', 'karamja', 2790, 3065],
  ['shilo_village', 'Shilo Village', 'karamja', 2852, 2955],
  ['ape_atoll', 'Ape Atoll', 'karamja', 2755, 2785],

  ['prifddinas', 'Prifddinas', 'tirannwn', 2225, 3340],
  ['lletya', 'Lletya', 'tirannwn', 2340, 3170],
  ['port_tyras', 'Port Tyras', 'tirannwn', 2150, 3120],
  ['zul_andra', 'Zul-Andra', 'tirannwn', 2200, 3055],

  ['kourend_castle', 'Kourend Castle', 'kourend', 1645, 3675],
  ['hosidius', 'Hosidius', 'kourend', 1750, 3570],
  ['port_piscarilius', 'Port Piscarilius', 'kourend', 1800, 3730],
  ['arceuus', 'Arceuus', 'kourend', 1660, 3780],
  ['lovakengj', 'Lovakengj', 'kourend', 1505, 3790],
  ['shayzien', 'Shayzien', 'kourend', 1510, 3580],
  ['wintertodt', 'Wintertodt', 'kourend', 1630, 3990],
  ['chambers_of_xeric', 'Mount Quidamortem', 'kourend', 1240, 3555],

  ['civitas', 'Civitas illa Fortis', 'varlamore', 1655, 3115],
  ['hunter_guild', 'Hunter Guild', 'varlamore', 1560, 3040],
  ['sunset_coast', 'Sunset Coast', 'varlamore', 1515, 2980],
  ['aldarin', 'Aldarin', 'varlamore', 1390, 2925],
  ['ralos_rise', "Ralos' Rise", 'varlamore', 1570, 3235],
  ['tal_teklan', 'Tal Teklan', 'varlamore', 1220, 3100],
];

export const PLACES = RAW.map(([key, name, region, x, y], i) => ({
  key, name, region, x, y, index: i + 1,
}));

// [a, b, kind]. Kind is how it is drawn: land is a solid line, boat and
// travel (quetzal, glider) are dashed. The rules treat every link alike.
export const LINKS = [
  // Misthalin
  ['lumbridge', 'draynor', 'land'],
  ['lumbridge', 'varrock', 'land'],
  ['lumbridge', 'al_kharid', 'land'],
  ['draynor', 'wizards_tower', 'land'],
  ['draynor', 'port_sarim', 'land'],
  ['draynor', 'falador', 'land'],
  ['draynor', 'barbarian_village', 'land'],
  ['varrock', 'barbarian_village', 'land'],
  ['varrock', 'edgeville', 'land'],
  ['barbarian_village', 'edgeville', 'land'],
  ['varrock', 'canifis', 'land'],          // over the Salve at Paterdomus
  ['varrock', 'ferox', 'land'],
  ['edgeville', 'ferox', 'land'],
  ['varrock', 'civitas', 'travel'],        // Regulus Cento's quetzal

  // Asgarnia
  ['falador', 'barbarian_village', 'land'],
  ['falador', 'rimmington', 'land'],
  ['falador', 'port_sarim', 'land'],
  ['port_sarim', 'rimmington', 'land'],
  ['falador', 'taverley', 'land'],
  ['taverley', 'burthorpe', 'land'],
  ['burthorpe', 'trollheim', 'land'],
  ['taverley', 'catherby', 'land'],        // over White Wolf Mountain
  ['burthorpe', 'bandit_camp_wild', 'land'],
  ['port_sarim', 'musa_point', 'boat'],
  ['port_sarim', 'port_piscarilius', 'boat'], // Veos

  // Kandarin
  ['catherby', 'seers', 'land'],
  ['seers', 'barbarian_outpost', 'land'],
  ['barbarian_outpost', 'gnome_stronghold', 'land'],
  ['seers', 'ardougne', 'land'],
  ['ardougne', 'gnome_stronghold', 'land'],
  ['ardougne', 'yanille', 'land'],
  ['yanille', 'feldip_hills', 'land'],
  ['seers', 'rellekka', 'land'],
  ['ardougne', 'prifddinas', 'land'],      // through the Arandar pass
  ['ardougne', 'brimhaven', 'boat'],
  ['gnome_stronghold', 'ape_atoll', 'travel'], // gnome glider

  // Fremennik
  ['rellekka', 'trollheim', 'land'],
  ['trollheim', 'weiss', 'land'],
  ['rellekka', 'waterbirth', 'boat'],
  ['rellekka', 'neitiznot', 'boat'],
  ['rellekka', 'lunar_isle', 'boat'],

  // Wilderness
  ['ferox', 'bandit_camp_wild', 'land'],
  ['ferox', 'lava_maze', 'land'],
  ['bandit_camp_wild', 'lava_maze', 'land'],
  ['lava_maze', 'mage_arena', 'land'],
  ['mage_arena', 'rogues_castle', 'land'],
  ['ferox', 'rogues_castle', 'land'],

  // Morytania
  ['canifis', 'mort_myre', 'land'],
  ['canifis', 'port_phasmatys', 'land'],
  ['mort_myre', 'barrows', 'land'],
  ['mort_myre', 'darkmeyer', 'land'],
  ['barrows', 'ver_sinhaza', 'land'],
  ['darkmeyer', 'ver_sinhaza', 'land'],

  // Kharidian Desert
  ['al_kharid', 'kalphite_lair', 'land'],
  ['kalphite_lair', 'pollnivneach', 'land'],
  ['pollnivneach', 'nardah', 'land'],
  ['pollnivneach', 'sophanem', 'land'],
  ['pollnivneach', 'uzer', 'land'],
  ['nardah', 'uzer', 'land'],

  // Karamja
  ['musa_point', 'brimhaven', 'land'],
  ['musa_point', 'tai_bwo_wannai', 'land'],
  ['brimhaven', 'tai_bwo_wannai', 'land'],
  ['tai_bwo_wannai', 'shilo_village', 'land'],

  // Tirannwn
  ['prifddinas', 'lletya', 'land'],
  ['lletya', 'port_tyras', 'land'],
  ['port_tyras', 'zul_andra', 'land'],

  // Kourend & Kebos
  ['port_piscarilius', 'hosidius', 'land'],
  ['port_piscarilius', 'arceuus', 'land'],
  ['arceuus', 'kourend_castle', 'land'],
  ['hosidius', 'kourend_castle', 'land'],
  ['kourend_castle', 'shayzien', 'land'],
  ['shayzien', 'lovakengj', 'land'],
  ['lovakengj', 'arceuus', 'land'],
  ['arceuus', 'wintertodt', 'land'],
  ['lovakengj', 'wintertodt', 'land'],
  ['shayzien', 'chambers_of_xeric', 'land'],

  // Varlamore
  ['chambers_of_xeric', 'ralos_rise', 'land'], // Custodia Pass
  ['ralos_rise', 'civitas', 'land'],
  ['ralos_rise', 'tal_teklan', 'land'],
  ['civitas', 'hunter_guild', 'land'],
  ['hunter_guild', 'sunset_coast', 'land'],
  ['tal_teklan', 'sunset_coast', 'land'],
  ['sunset_coast', 'aldarin', 'boat'],

  // Areas whose land shares a border on the map, so a player who sees two
  // territories touch can expect to cross between them. Left out on purpose:
  // the River Salve, which Misthalin, the desert and the Wilderness cannot
  // cross into Morytania except at Paterdomus (Varrock - Canifis).
  ['al_kharid', 'pollnivneach', 'land'],
  ['al_kharid', 'uzer', 'land'],
  ['ardougne', 'catherby', 'land'],
  ['ardougne', 'lletya', 'land'],
  ['bandit_camp_wild', 'edgeville', 'land'],
  ['bandit_camp_wild', 'trollheim', 'land'],
  ['barrows', 'darkmeyer', 'land'],
  ['burthorpe', 'catherby', 'land'],
  ['burthorpe', 'edgeville', 'land'],
  ['burthorpe', 'seers', 'land'],
  ['canifis', 'darkmeyer', 'land'],
  ['chambers_of_xeric', 'lovakengj', 'land'],
  ['chambers_of_xeric', 'tal_teklan', 'land'],
  ['darkmeyer', 'port_phasmatys', 'land'],
  ['draynor', 'varrock', 'land'],
  ['feldip_hills', 'lletya', 'land'],
  ['feldip_hills', 'zul_andra', 'land'],
  ['gnome_stronghold', 'lletya', 'land'],
  ['gnome_stronghold', 'prifddinas', 'land'],
  ['gnome_stronghold', 'seers', 'land'],
  ['hosidius', 'shayzien', 'land'],
  ['hunter_guild', 'ralos_rise', 'land'],
  ['hunter_guild', 'tal_teklan', 'land'],
  ['kalphite_lair', 'lumbridge', 'land'],
  ['kalphite_lair', 'sophanem', 'land'],
  ['kalphite_lair', 'wizards_tower', 'land'],
  ['kourend_castle', 'lovakengj', 'land'],
  ['kourend_castle', 'port_piscarilius', 'land'],
  ['lava_maze', 'rogues_castle', 'land'],
  ['lava_maze', 'weiss', 'land'],
  ['lletya', 'yanille', 'land'],
  ['lletya', 'zul_andra', 'land'],
  ['lumbridge', 'wizards_tower', 'land'],
  ['mage_arena', 'weiss', 'land'],
  ['nardah', 'sophanem', 'land'],
  ['port_piscarilius', 'wintertodt', 'land'],
  ['port_tyras', 'prifddinas', 'land'],
  ['rellekka', 'weiss', 'land'],

  // Second ways in. A home can never be taken, so to every other team it is a
  // wall: a place reachable only through one would be lost to them for the
  // whole game if a team started there. These are real routes that give every
  // corner but the Fremennik isles (reached only from Rellekka, as in the
  // game) a way round any single place. lib/territory.js homesProblem() checks
  // the organiser's homes against the rest.
  ['varrock', 'al_kharid', 'land'],             // the path north past the Al Kharid mine
  ['port_phasmatys', 'catherby', 'boat'],      // charter ship
  ['brimhaven', 'shilo_village', 'travel'],    // the Shilo Village cart
  ['ape_atoll', 'tai_bwo_wannai', 'travel'],   // fairy ring CLR - CKR
  ['aldarin', 'civitas', 'travel'],            // quetzal
];

/** Suggested homes, spread across the map, for up to six teams. */
// Not Rellekka: it is the only way to the Fremennik isles, so as a home it
// would wall them off from every other team.
export const DEFAULT_HOMES = ['lumbridge', 'ardougne', 'canifis', 'hosidius', 'civitas', 'trollheim'];

/** Bonus for holding a whole region: about half its places, at least 2. */
export function defaultBonus(regionKey) {
  const n = PLACES.filter((p) => p.region === regionKey).length;
  return Math.max(2, Math.round(n / 2));
}
