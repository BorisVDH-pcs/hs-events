/**
 * The themed tasks the Territory harnesses use: one per place, fitting the
 * place (Barrows at Barrows, the Gauntlet at Prifddinas). The admin harness
 * offers them as a saved board, "OSRS themed (template)", and the player
 * harness falls back to them when no board was built in the admin harness.
 *
 * Data for the harnesses only. In the real console a template is a saved
 * board like any other.
 */

// A task for every place, themed to it. [task, icon, screenshots needed]
export const THEMED_TASKS = {
  lumbridge: ['Cook 500 sharks', 'cooking_skill', 2],
  draynor: ['50 herb runs', 'farming_skill', 2],
  wizards_tower: ['Gain 1M Magic xp', 'magic_skill', 1],
  varrock: ['Obor club or Bryophyta essence', 'obor', 1],
  barbarian_village: ['Gain 1M Firemaking xp', 'firemaking_skill', 1],
  edgeville: ['Gain 1M Prayer xp', 'prayer_skill', 1],
  falador: ['Giant Mole: 50 kills', 'giant_mole', 3],
  port_sarim: ['Dragon salvaging hook', 'dragon_salvaging_hook', 1],
  rimmington: ['Craft 500 gold amulets', 'crafting_skill', 1],
  taverley: ['Any Cerberus crystal', 'cerberus', 1],
  burthorpe: ['Gain 1M Strength xp', 'strength_skill', 1],
  trollheim: ['Any Bandos unique', 'general_graardor', 1],
  catherby: ['Catch 300 sharks', 'big_shark', 2],
  seers: ['Cut 2,000 magic logs', 'woodcutting_skill', 2],
  ardougne: ['Pickpocket 2,000 knights', 'thieving_skill', 2],
  yanille: ['Gain 1M Ranged xp', 'ranged_skill', 1],
  gnome_stronghold: ['500 agility laps', 'agility_skill', 2],
  barbarian_outpost: ['Kill the Penance Queen', 'penance_queen', 1],
  feldip_hills: ['Gain 1M Hunter xp', 'hunter_skill', 1],
  rellekka: ['Vorkath head', 'vorkath', 1],
  neitiznot: ['Kill the Ice Troll King', 'ice_troll_king', 1],
  lunar_isle: ['Craft 1,000 astral runes', 'runecraft_skill', 1],
  waterbirth: ['Any Dagannoth King ring', 'dagannoth_supreme', 1],
  weiss: ['Gain 1M Mining xp', 'mining_skill', 1],
  ferox: ['Any revenant emblem', 'ancient_emblem', 2],
  bandit_camp_wild: ['Chaos Fanatic: 25 kills', 'chaos_fanatic', 1],
  lava_maze: ['King Black Dragon head', 'king_black_dragon', 1],
  mage_arena: ['Scorpia: 25 kills', 'scorpia', 1],
  rogues_castle: ['Any Venenatis unique', 'venenatis', 1],
  canifis: ['500 Slayer Tower kills', 'slayer_skill', 2],
  port_phasmatys: ['Collect 100 ecto-tokens', null, 1],
  mort_myre: ['Gain 1M Herblore xp', 'herblore_skill', 1],
  barrows: ["Any Dharok's piece", 'dharok_the_wretched', 2],
  darkmeyer: ['Any Nightmare unique', 'the_nightmare', 1],
  ver_sinhaza: ['Any Theatre of Blood purple', 'scythe_of_vitur', 1],
  al_kharid: ['Gain 1M Fletching xp', 'fletching_skill', 1],
  kalphite_lair: ['Kalphite Queen head', 'kalphite_queen', 1],
  pollnivneach: ['Smoke devil: 100 kills', 'thermonuclear_smoke_devil', 1],
  nardah: ['Any Tempoross unique', 'tempoross', 1],
  sophanem: ['Any Tombs of Amascut purple', 'tumekens_shadow', 1],
  uzer: ['Kill the Giant Scarab', 'giant_scarab', 1],
  musa_point: ['Gain 1M Fishing xp', 'fishing_skill', 1],
  brimhaven: ['Collect 1,000 agility tickets', null, 1],
  tai_bwo_wannai: ['Fire cape', 'tztok_jad', 1],
  shilo_village: ['Mine 50 gem rocks', 'enchanted_gem', 1],
  ape_atoll: ['Zenyte shard', 'zenyte_shard', 1],
  prifddinas: ['Enhanced crystal weapon seed', 'enhanced_crystal_weapon_seed', 1],
  lletya: ['Crystal tool seed', 'crystal_tool_seed', 1],
  port_tyras: ['Zalcano: 25 kills', 'zalcano', 1],
  zul_andra: ['Any Zulrah unique', 'zulrah', 1],
  kourend_castle: ['Kill Skotizo', 'skotizo', 1],
  hosidius: ['Gain 1M Farming xp', 'farming_skill', 1],
  port_piscarilius: ['Kraken tentacle', 'kraken', 1],
  arceuus: ['Craft 1,000 blood runes', 'runecraft_skill', 1],
  lovakengj: ['Gain 1M Smithing xp', 'smithing_skill', 1],
  shayzien: ['Sarachnis cudgel', 'sarachnis', 1],
  wintertodt: ['Any Wintertodt unique', 'firemaking_skill', 1],
  chambers_of_xeric: ['Any Chambers of Xeric purple', 'twisted_bow', 1],
  civitas: ['Defeat Sol Heredit', 'sol_heredit', 1],
  hunter_guild: ['Complete 50 hunter rumours', 'hunter_skill', 1],
  sunset_coast: ['Any Moons of Peril unique', 'blood_moon', 1],
  aldarin: ['Kill the Hueycoatl', 'the_hueycoatl', 1],
  ralos_rise: ['Kill Amoxliatl', 'amoxliatl', 1],
  tal_teklan: ['Doom of Mokhaiotl: any unique', 'doom_of_mokhaiotl', 1],
};

// The board built in the admin harness, handed to the player harness through
// this browser's storage: { name, savedAt, tiles: [tile] } or null.
export const BOARD_KEY = 'hs-preview-territory-board';

export function readBoard() {
  try { return JSON.parse(localStorage.getItem(BOARD_KEY)); } catch { return null; }
}

export function writeBoard(board) {
  try {
    if (board) localStorage.setItem(BOARD_KEY, JSON.stringify(board));
    else localStorage.removeItem(BOARD_KEY);
  } catch { /* storage off: the player harness keeps its demo tasks */ }
}
