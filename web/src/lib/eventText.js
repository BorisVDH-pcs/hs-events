import { millionsLabel } from './millions.js';

/**
 * The claim's counter as stamped onto the event by claim_progress()
 * (20260928120000) — the same words tileProgressText() puts on the card, and
 * progress_text() puts in Discord. Null for an event from before the stamp.
 */
export function progressText(progress) {
  if (!progress) return null;
  const { unit, have, need } = progress;
  switch (unit) {
    case 'evidence': return `${have}/${need} submitted`;
    case 'points':   return `${have}/${need} pts`;
    case 'value':    return `${millionsLabel(have)}/${millionsLabel(need)}m`;
    case 'items':    return `${have}/${need} items collected`;
    case 'sets':     return `${have}/${need} sets complete`;
    case 'best_set': return `best set${progress.set ? ` (${progress.set})` : ''} ${have}/${need}`;
    default:         return null;
  }
}

/** Describe a team-private evidence event without treating every rule as points. */
export function evidenceEventText(payload = {}, fallbackWho = 'Someone') {
  const by = payload.uploaded_by_name ?? fallbackWho;
  const tile = payload.tile_name ?? 'a tile';
  const need = payload.required_evidence;
  const rule = payload.completion ?? 'points';
  const progress = progressText(payload.progress);

  // A per-group rule names the drop and then the counter the card shows. An
  // event from before the stamp has no counter it can honestly print, because
  // its payload only carries a running total and the target is per group.
  const perGroup = rule === 'one_set' || rule === 'each_set' || rule === 'points_per_set';

  if (perGroup && payload.option_label) {
    return `${by} submitted ${payload.option_label} for ${tile}${progress ? ` (${progress})` : ''}.`;
  }
  if (rule === 'value') {
    // Every number in a value event is in tenths of a million, including the
    // target — see lib/millions.js.
    return `${by} submitted a drop worth ${millionsLabel(payload.points_awarded)}m for ${tile} ` +
      `(${progress ?? `${millionsLabel(payload.points_total)}/${millionsLabel(need)}m`}).`;
  }
  if (payload.option_label) {
    return `${by} submitted ${payload.option_label} for ${tile} — ` +
      `${payload.points_awarded} points (${progress ?? `${payload.points_total}/${need}`}).`;
  }
  return `${by} submitted proof for ${tile} (${progress ?? `${payload.evidence_count}/${need}`}).`;
}

/** "now 2/5 sets complete" for a withdrawal, or "updated" when it cannot say. */
export function revokedProgressText(payload = {}) {
  const progress = progressText(payload.progress);
  if (progress) return progress;
  // An unstamped withdrawal only knows screenshots left, which is the right
  // counter only on a plain tile.
  const plain = (payload.completion ?? 'points') === 'points' && !payload.option_label;
  return plain ? `${payload.evidence_count}/${payload.required_evidence}` : 'updated';
}
