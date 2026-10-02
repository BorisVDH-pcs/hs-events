// Tile suggestions, as both sides of the review read them.
//
// The player's list and the organiser's queue say the same four things about a
// suggestion, so the words live here once rather than drifting apart in two
// components.

import { useEffect, useState } from 'react';
import { tileNameStatus } from './supabase.js';
import { nameKey } from './tileDraft.js';

export const SUGGESTION_STATUS = {
  pending:   { label: 'Waiting for review', pill: 'pending' },
  accepted:  { label: 'Accepted',           pill: 'active' },
  refused:   { label: 'Refused',            pill: 'refused' },
  withdrawn: { label: 'Withdrawn',          pill: 'finished' },
};

/** The message a taken name earns, or null. Same words as the server's refusal. */
export function nameTakenMessage(status, name) {
  if (status === 'catalogue') return `There is already a tile called "${name.trim()}" in the catalogue.`;
  if (status === 'pending') return `Someone has already suggested a tile called "${name.trim()}" and it is waiting for review.`;
  return null;
}

/**
 * Whether a name is free, asked of the server once typing pauses.
 *
 * A player cannot read the catalogue (see 20261004120000_tile_submissions), so
 * this is the only way the form can say "already taken" before the save rather
 * than after it. The server checks again on save; this only says it sooner.
 *
 * Returns 'catalogue', 'pending' or null. Failures read as null: the save is
 * still checked, so a lost lookup costs an error message later, never a
 * duplicate.
 */
export function useNameStatus(name, exceptId) {
  const [result, setResult] = useState({ key: '', status: null });
  const key = nameKey(name);

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      tileNameStatus(name, exceptId)
        .then((status) => { if (!cancelled) setResult({ key, status: status ?? null }); })
        .catch(() => { if (!cancelled) setResult({ key, status: null }); });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
    // `name` is read through `key`: a change of spacing or case is the same name.
  }, [key, exceptId]);

  // Keyed, so the answer for the previous name never shows against the new one.
  return result.key === key ? result.status : null;
}
