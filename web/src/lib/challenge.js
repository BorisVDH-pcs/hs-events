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
export const WOM_METRICS = [
  { value: 'clue_scrolls_all', label: 'Clues — all tiers' },
  { value: 'clue_scrolls_beginner', label: 'Clues — beginner' },
  { value: 'clue_scrolls_easy', label: 'Clues — easy' },
  { value: 'clue_scrolls_medium', label: 'Clues — medium' },
  { value: 'clue_scrolls_hard', label: 'Clues — hard' },
  { value: 'clue_scrolls_elite', label: 'Clues — elite' },
  { value: 'clue_scrolls_master', label: 'Clues — master' },
  { value: 'chambers_of_xeric', label: 'Raid — Chambers of Xeric' },
  { value: 'theatre_of_blood', label: 'Raid — Theatre of Blood' },
  { value: 'tombs_of_amascut', label: 'Raid — Tombs of Amascut' },
  { value: 'zulrah', label: 'Boss — Zulrah' },
  { value: 'vorkath', label: 'Boss — Vorkath' },
  { value: 'corporeal_beast', label: 'Boss — Corporeal Beast' },
  { value: 'cerberus', label: 'Boss — Cerberus' },
  { value: 'nex', label: 'Boss — Nex' },
  { value: 'phantom_muspah', label: 'Boss — Phantom Muspah' },
  { value: 'slayer', label: 'Skill — Slayer' },
  { value: 'mining', label: 'Skill — Mining' },
  { value: 'fishing', label: 'Skill — Fishing' },
  { value: 'woodcutting', label: 'Skill — Woodcutting' },
  { value: 'runecrafting', label: 'Skill — Runecrafting' },
  { value: 'overall', label: 'Skill — Overall xp' },
  { value: 'ehb', label: 'Efficient hours bossed (EHB)' },
  { value: 'ehp', label: 'Efficient hours played (EHP)' },
];

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
