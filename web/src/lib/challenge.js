/**
 * Challenge mode, on the client side.
 *
 * A challenge has no board, so none of the tile helpers apply to it. What it
 * has instead is up to two figures per entrant — one read from Wise Old Man,
 * one the player types — and this module is where both are turned into
 * something a screen can show, and back again.
 */

import { PER_MILLION, millionsLabel } from './millions.js';

/**
 * A number the player gives, as stored.
 *
 * `gp` is kept in TENTHS OF A MILLION, the unit lib/millions.js already uses
 * for value tiles, so 0.5m is 5 and 250m is 2500. Everything else is a plain
 * count. Both separators are accepted for the same reason millions.js accepts
 * them: the people typing this write 0,5 as often as 0.5, and parseFloat
 * turns the first into 0 without complaining.
 *
 * Returns null for anything that is not a number, rather than a zero — a
 * figure that would not parse must not be submitted as nothing.
 */
export function figureToStored(text, unit) {
  const cleaned = String(text ?? '').trim().replace(',', '.');
  if (unit === 'gp') {
    // One decimal place: a tenth is the whole precision of the stored unit, so
    // 0.55 is refused rather than quietly rounded into a different number.
    if (!/^\d{1,8}(\.\d)?$/.test(cleaned)) return null;
    const tenths = Math.round(parseFloat(cleaned) * PER_MILLION);
    return Number.isFinite(tenths) ? tenths : null;
  }
  if (!/^\d{1,9}$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Stored -> what the player typed, for putting back in the box. */
export function storedToInput(value, unit) {
  if (value === null || value === undefined) return '';
  return unit === 'gp' ? millionsLabel(value) : String(value);
}

/** Stored -> a figure on screen: `250m`, or `1,284`. */
export function figureLabel(value, unit) {
  if (value === null || value === undefined) return '—';
  return unit === 'gp' ? `${millionsLabel(value)}m` : Number(value).toLocaleString();
}

/** A figure from Wise Old Man. Always a count — kills, levels, clues, xp. */
export const womLabel = (value) =>
  (value === null || value === undefined ? '—' : Number(value).toLocaleString());

/** The server's own ceiling (challenge_max_figure), so the box refuses first. */
export const MAX_FIGURE = 1000000000;

/** At most this many screenshots per phase, matching challenge_max_evidence. */
export const MAX_EVIDENCE = 5;

/**
 * A Wise Old Man metric, as WOM spells it.
 *
 * Not a closed list: the field takes anything, because WOM adds bosses faster
 * than this file will be edited and an event refused for a metric that exists
 * would be this list's fault. These are the ones the proposed events use, in
 * the order an organiser is likely to want them.
 */
/**
 * Every metric the Wise Old Man API actually serves, grouped for the picker.
 *
 * Generated from the live API rather than typed by hand: `metric.enum.ts` on
 * their master lists metrics the deployed server does not know yet, and the
 * old hand-written list had six bosses and six skills in it, so a Boss of the
 * Week could not name three quarters of the bosses and Skill of the Week
 * could not name most skills.
 *
 * `name` is what the option says under its group heading, `label` is the same
 * metric in prose -- "Boss — Zulrah" -- for the ladder column and the feed,
 * where there is no heading to lean on. Both are WOM's own spellings.
 */
export const WOM_METRICS = [
  // Skills
  { value: 'overall', name: 'Overall', group: 'Skills', label: 'Skill — Overall' },
  { value: 'attack', name: 'Attack', group: 'Skills', label: 'Skill — Attack' },
  { value: 'defence', name: 'Defence', group: 'Skills', label: 'Skill — Defence' },
  { value: 'strength', name: 'Strength', group: 'Skills', label: 'Skill — Strength' },
  { value: 'hitpoints', name: 'Hitpoints', group: 'Skills', label: 'Skill — Hitpoints' },
  { value: 'ranged', name: 'Ranged', group: 'Skills', label: 'Skill — Ranged' },
  { value: 'prayer', name: 'Prayer', group: 'Skills', label: 'Skill — Prayer' },
  { value: 'magic', name: 'Magic', group: 'Skills', label: 'Skill — Magic' },
  { value: 'cooking', name: 'Cooking', group: 'Skills', label: 'Skill — Cooking' },
  { value: 'woodcutting', name: 'Woodcutting', group: 'Skills', label: 'Skill — Woodcutting' },
  { value: 'fletching', name: 'Fletching', group: 'Skills', label: 'Skill — Fletching' },
  { value: 'fishing', name: 'Fishing', group: 'Skills', label: 'Skill — Fishing' },
  { value: 'firemaking', name: 'Firemaking', group: 'Skills', label: 'Skill — Firemaking' },
  { value: 'crafting', name: 'Crafting', group: 'Skills', label: 'Skill — Crafting' },
  { value: 'smithing', name: 'Smithing', group: 'Skills', label: 'Skill — Smithing' },
  { value: 'mining', name: 'Mining', group: 'Skills', label: 'Skill — Mining' },
  { value: 'herblore', name: 'Herblore', group: 'Skills', label: 'Skill — Herblore' },
  { value: 'agility', name: 'Agility', group: 'Skills', label: 'Skill — Agility' },
  { value: 'thieving', name: 'Thieving', group: 'Skills', label: 'Skill — Thieving' },
  { value: 'slayer', name: 'Slayer', group: 'Skills', label: 'Skill — Slayer' },
  { value: 'farming', name: 'Farming', group: 'Skills', label: 'Skill — Farming' },
  { value: 'runecrafting', name: 'Runecrafting', group: 'Skills', label: 'Skill — Runecrafting' },
  { value: 'hunter', name: 'Hunter', group: 'Skills', label: 'Skill — Hunter' },
  { value: 'construction', name: 'Construction', group: 'Skills', label: 'Skill — Construction' },
  { value: 'sailing', name: 'Sailing', group: 'Skills', label: 'Skill — Sailing' },
  // Raids
  { value: 'chambers_of_xeric', name: 'Chambers Of Xeric', group: 'Raids', label: 'Raid — Chambers Of Xeric' },
  { value: 'chambers_of_xeric_challenge_mode', name: 'Chambers Of Xeric (CM)', group: 'Raids', label: 'Raid — Chambers Of Xeric (CM)' },
  { value: 'theatre_of_blood', name: 'Theatre Of Blood', group: 'Raids', label: 'Raid — Theatre Of Blood' },
  { value: 'theatre_of_blood_hard_mode', name: 'Theatre Of Blood (HM)', group: 'Raids', label: 'Raid — Theatre Of Blood (HM)' },
  { value: 'tombs_of_amascut', name: 'Tombs of Amascut', group: 'Raids', label: 'Raid — Tombs of Amascut' },
  { value: 'tombs_of_amascut_expert', name: 'Tombs of Amascut (Expert Mode)', group: 'Raids', label: 'Raid — Tombs of Amascut (Expert Mode)' },
  { value: 'the_fractured_archive', name: 'The Fractured Archive', group: 'Raids', label: 'Raid — The Fractured Archive' },
  // Bosses
  { value: 'abyssal_sire', name: 'Abyssal Sire', group: 'Bosses', label: 'Boss — Abyssal Sire' },
  { value: 'alchemical_hydra', name: 'Alchemical Hydra', group: 'Bosses', label: 'Boss — Alchemical Hydra' },
  { value: 'amoxliatl', name: 'Amoxliatl', group: 'Bosses', label: 'Boss — Amoxliatl' },
  { value: 'araxxor', name: 'Araxxor', group: 'Bosses', label: 'Boss — Araxxor' },
  { value: 'artio', name: 'Artio', group: 'Bosses', label: 'Boss — Artio' },
  { value: 'barrows_chests', name: 'Barrows Chests', group: 'Bosses', label: 'Boss — Barrows Chests' },
  { value: 'brutus', name: 'Brutus', group: 'Bosses', label: 'Boss — Brutus' },
  { value: 'bryophyta', name: 'Bryophyta', group: 'Bosses', label: 'Boss — Bryophyta' },
  { value: 'callisto', name: 'Callisto', group: 'Bosses', label: 'Boss — Callisto' },
  { value: 'calvarion', name: 'Calvar\'ion', group: 'Bosses', label: 'Boss — Calvar\'ion' },
  { value: 'cerberus', name: 'Cerberus', group: 'Bosses', label: 'Boss — Cerberus' },
  { value: 'chaos_elemental', name: 'Chaos Elemental', group: 'Bosses', label: 'Boss — Chaos Elemental' },
  { value: 'chaos_fanatic', name: 'Chaos Fanatic', group: 'Bosses', label: 'Boss — Chaos Fanatic' },
  { value: 'commander_zilyana', name: 'Commander Zilyana', group: 'Bosses', label: 'Boss — Commander Zilyana' },
  { value: 'corporeal_beast', name: 'Corporeal Beast', group: 'Bosses', label: 'Boss — Corporeal Beast' },
  { value: 'crazy_archaeologist', name: 'Crazy Archaeologist', group: 'Bosses', label: 'Boss — Crazy Archaeologist' },
  { value: 'dagannoth_prime', name: 'Dagannoth Prime', group: 'Bosses', label: 'Boss — Dagannoth Prime' },
  { value: 'dagannoth_rex', name: 'Dagannoth Rex', group: 'Bosses', label: 'Boss — Dagannoth Rex' },
  { value: 'dagannoth_supreme', name: 'Dagannoth Supreme', group: 'Bosses', label: 'Boss — Dagannoth Supreme' },
  { value: 'deranged_archaeologist', name: 'Deranged Archaeologist', group: 'Bosses', label: 'Boss — Deranged Archaeologist' },
  { value: 'doom_of_mokhaiotl', name: 'Doom of Mokhaiotl', group: 'Bosses', label: 'Boss — Doom of Mokhaiotl' },
  { value: 'duke_sucellus', name: 'Duke Sucellus', group: 'Bosses', label: 'Boss — Duke Sucellus' },
  { value: 'general_graardor', name: 'General Graardor', group: 'Bosses', label: 'Boss — General Graardor' },
  { value: 'giant_mole', name: 'Giant Mole', group: 'Bosses', label: 'Boss — Giant Mole' },
  { value: 'grotesque_guardians', name: 'Grotesque Guardians', group: 'Bosses', label: 'Boss — Grotesque Guardians' },
  { value: 'hespori', name: 'Hespori', group: 'Bosses', label: 'Boss — Hespori' },
  { value: 'kril_tsutsaroth', name: 'K\'ril Tsutsaroth', group: 'Bosses', label: 'Boss — K\'ril Tsutsaroth' },
  { value: 'kalphite_queen', name: 'Kalphite Queen', group: 'Bosses', label: 'Boss — Kalphite Queen' },
  { value: 'king_black_dragon', name: 'King Black Dragon', group: 'Bosses', label: 'Boss — King Black Dragon' },
  { value: 'kraken', name: 'Kraken', group: 'Bosses', label: 'Boss — Kraken' },
  { value: 'kreearra', name: 'Kree\'Arra', group: 'Bosses', label: 'Boss — Kree\'Arra' },
  { value: 'lunar_chests', name: 'Lunar Chests', group: 'Bosses', label: 'Boss — Lunar Chests' },
  { value: 'mad_angel', name: 'Mad Angel', group: 'Bosses', label: 'Boss — Mad Angel' },
  { value: 'maggot_king', name: 'Maggot King', group: 'Bosses', label: 'Boss — Maggot King' },
  { value: 'mimic', name: 'Mimic', group: 'Bosses', label: 'Boss — Mimic' },
  { value: 'nex', name: 'Nex', group: 'Bosses', label: 'Boss — Nex' },
  { value: 'nightmare', name: 'Nightmare', group: 'Bosses', label: 'Boss — Nightmare' },
  { value: 'obor', name: 'Obor', group: 'Bosses', label: 'Boss — Obor' },
  { value: 'phantom_muspah', name: 'Phantom Muspah', group: 'Bosses', label: 'Boss — Phantom Muspah' },
  { value: 'phosanis_nightmare', name: 'Phosani\'s Nightmare', group: 'Bosses', label: 'Boss — Phosani\'s Nightmare' },
  { value: 'sarachnis', name: 'Sarachnis', group: 'Bosses', label: 'Boss — Sarachnis' },
  { value: 'scorpia', name: 'Scorpia', group: 'Bosses', label: 'Boss — Scorpia' },
  { value: 'scurrius', name: 'Scurrius', group: 'Bosses', label: 'Boss — Scurrius' },
  { value: 'shellbane_gryphon', name: 'Shellbane Gryphon', group: 'Bosses', label: 'Boss — Shellbane Gryphon' },
  { value: 'skotizo', name: 'Skotizo', group: 'Bosses', label: 'Boss — Skotizo' },
  { value: 'sol_heredit', name: 'Sol Heredit', group: 'Bosses', label: 'Boss — Sol Heredit' },
  { value: 'spindel', name: 'Spindel', group: 'Bosses', label: 'Boss — Spindel' },
  { value: 'tempoross', name: 'Tempoross', group: 'Bosses', label: 'Boss — Tempoross' },
  { value: 'the_corrupted_gauntlet', name: 'The Corrupted Gauntlet', group: 'Bosses', label: 'Boss — The Corrupted Gauntlet' },
  { value: 'the_gauntlet', name: 'The Gauntlet', group: 'Bosses', label: 'Boss — The Gauntlet' },
  { value: 'the_hueycoatl', name: 'The Hueycoatl', group: 'Bosses', label: 'Boss — The Hueycoatl' },
  { value: 'the_leviathan', name: 'The Leviathan', group: 'Bosses', label: 'Boss — The Leviathan' },
  { value: 'the_royal_titans', name: 'The Royal Titans', group: 'Bosses', label: 'Boss — The Royal Titans' },
  { value: 'the_whisperer', name: 'The Whisperer', group: 'Bosses', label: 'Boss — The Whisperer' },
  { value: 'thermonuclear_smoke_devil', name: 'Thermonuclear Smoke Devil', group: 'Bosses', label: 'Boss — Thermonuclear Smoke Devil' },
  { value: 'tzkal_zuk', name: 'TzKal-Zuk', group: 'Bosses', label: 'Boss — TzKal-Zuk' },
  { value: 'tztok_jad', name: 'TzTok-Jad', group: 'Bosses', label: 'Boss — TzTok-Jad' },
  { value: 'vardorvis', name: 'Vardorvis', group: 'Bosses', label: 'Boss — Vardorvis' },
  { value: 'venenatis', name: 'Venenatis', group: 'Bosses', label: 'Boss — Venenatis' },
  { value: 'vetion', name: 'Vet\'ion', group: 'Bosses', label: 'Boss — Vet\'ion' },
  { value: 'vorkath', name: 'Vorkath', group: 'Bosses', label: 'Boss — Vorkath' },
  { value: 'wintertodt', name: 'Wintertodt', group: 'Bosses', label: 'Boss — Wintertodt' },
  { value: 'yama', name: 'Yama', group: 'Bosses', label: 'Boss — Yama' },
  { value: 'zalcano', name: 'Zalcano', group: 'Bosses', label: 'Boss — Zalcano' },
  { value: 'zulrah', name: 'Zulrah', group: 'Bosses', label: 'Boss — Zulrah' },
  // Clues
  { value: 'clue_scrolls_all', name: 'All tiers', group: 'Clues', label: 'Clues — all tiers' },
  { value: 'clue_scrolls_beginner', name: 'Beginner', group: 'Clues', label: 'Clues — beginner' },
  { value: 'clue_scrolls_easy', name: 'Easy', group: 'Clues', label: 'Clues — easy' },
  { value: 'clue_scrolls_medium', name: 'Medium', group: 'Clues', label: 'Clues — medium' },
  { value: 'clue_scrolls_hard', name: 'Hard', group: 'Clues', label: 'Clues — hard' },
  { value: 'clue_scrolls_elite', name: 'Elite', group: 'Clues', label: 'Clues — elite' },
  { value: 'clue_scrolls_master', name: 'Master', group: 'Clues', label: 'Clues — master' },
  // Activities
  { value: 'bounty_hunter_hunter', name: 'Bounty Hunter (Hunter)', group: 'Activities', label: 'Activity — Bounty Hunter (Hunter)' },
  { value: 'bounty_hunter_rogue', name: 'Bounty Hunter (Rogue)', group: 'Activities', label: 'Activity — Bounty Hunter (Rogue)' },
  { value: 'last_man_standing', name: 'Last Man Standing', group: 'Activities', label: 'Activity — Last Man Standing' },
  { value: 'pvp_arena', name: 'PvP Arena', group: 'Activities', label: 'Activity — PvP Arena' },
  { value: 'soul_wars_zeal', name: 'Soul Wars Zeal', group: 'Activities', label: 'Activity — Soul Wars Zeal' },
  { value: 'guardians_of_the_rift', name: 'Guardians of the Rift', group: 'Activities', label: 'Activity — Guardians of the Rift' },
  { value: 'colosseum_glory', name: 'Colosseum Glory', group: 'Activities', label: 'Activity — Colosseum Glory' },
  { value: 'collections_logged', name: 'Collection Logs', group: 'Activities', label: 'Activity — Collection Logs' },
  // Other
  { value: 'ehp', name: 'Efficient hours played (EHP)', group: 'Other', label: 'Efficient hours played (EHP)' },
  { value: 'ehb', name: 'Efficient hours bossed (EHB)', group: 'Other', label: 'Efficient hours bossed (EHB)' },
];

/** The picker's group headings, in order. */
/**
 * Which of WOM's bosses are raids.
 *
 * WOM has no notion of a raid -- it files all seven of these under bosses --
 * but an organiser running Raid of the Week does, so the split is ours, and
 * this is the one line in the file that is a judgement rather than their data.
 * The Fractured Archive landed here five days after release, in a group of
 * sixty-odd bosses where nobody would have found it.
 *
 * So: this is the list to add the next raid to. The selftest holds it and
 * WOM_METRICS to each other, so a value in one and not the other fails rather
 * than quietly misfiles a raid again.
 */
export const RAIDS = [
  'chambers_of_xeric', 'chambers_of_xeric_challenge_mode',
  'theatre_of_blood', 'theatre_of_blood_hard_mode',
  'tombs_of_amascut', 'tombs_of_amascut_expert',
  'the_fractured_archive',
];

export const METRIC_GROUPS = ['Skills', 'Raids', 'Bosses', 'Clues', 'Activities', 'Other'];

/** True when WOM has never heard of this metric, so it was typed by hand. */
export function isKnownMetric(metric) {
  return WOM_METRICS.some((m) => m.value === metric);
}

/** `clue_scrolls_all` -> `Clues — all tiers`, or the raw value if it is not ours. */
export function metricLabel(metric) {
  if (!metric) return null;
  const known = WOM_METRICS.find((m) => m.value === metric);
  return known ? known.label : metric.replace(/_/g, ' ');
}

/** What the ladder is sorted on, in words. */
export function rankedLabel(setup) {
  if (!setup) return '';
  return setup.ranked_by === 'wom'
    ? (metricLabel(setup.wom_metric) ?? 'the hiscores')
    : (setup.declared_label ?? 'the declared number');
}

/**
 * How often an open page takes a turn of the Wise Old Man loop while an event
 * is running. The loop itself is `womPulse` in lib/supabase.js, next to the
 * two calls it makes; this module stays free of the client so it can be run
 * and tested on its own.
 */
export const WOM_PULSE_MS = 60000;

/**
 * The feed lines a challenge writes, worded here rather than in EventFeed.
 *
 * Same hand-off snakes and territory use: answer null for anything that is not
 * ours and the shared switch has it. `game_started` is shared, so it is ours
 * only when the payload says the mode is a challenge — otherwise this would
 * tell a battleships game its fleets were not locked.
 */
export function challengeEventText(e, who) {
  const p = e?.payload ?? {};

  switch (e?.type) {
    case 'game_started': {
      if (p.mode !== 'challenge') return null;
      const n = Number(p.entrants ?? 0);
      return `The event has begun — ${n} ${n === 1 ? 'entrant' : 'entrants'}, and sign-ups are closed.`;
    }

    case 'challenge_declared': {
      const amount = figureLabel(p.amount, p.unit);
      const label = (p.label ?? 'their number').toLowerCase();
      const name = p.by_name ?? who;
      // An organiser correcting a figure writes the same event with its own
      // name on it, because a ladder has to be able to say whose number it is
      // showing. Saying so here is the only place a player sees it happen.
      return p.altered_by
        ? `${p.altered_by_name ?? 'An organiser'} set ${name}'s ${label} to ${amount}.`
        : `${name} put in ${amount} for ${label}.`;
    }

    case 'challenge_ended': {
      const score = p.ranked_by === 'wom'
        ? `${womLabel(p.score)}${p.label ? ` ${metricLabel(p.label)}` : ''}`
        : figureLabel(p.score, p.unit);
      const winner = p.winner_name ?? 'Nobody';
      const how = p.reason === 'time_up' ? 'Time is up' : 'The organiser called it';
      return `${how} — ${winner} wins with ${score}.`;
    }

    default:
      return null;
  }
}
