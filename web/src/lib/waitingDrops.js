/**
 * A drop two tiles want, waiting for the team to choose (Boris, 2026-11-21).
 *
 * Dink knows nothing of the board, and the server never guesses. When a drop
 * Dink sends is wanted by more than one of the team's open tiles, the
 * screenshot is kept for an hour with the tiles that wanted it then
 * (supabase/migrations/20261121120100_plugin_drops.sql, section 6c), and anyone on
 * the team picks the tile on the site (components/WaitingDrops.jsx).
 *
 * The pure parts of that box, so scripts/waiting-drops-selftest.mjs can run
 * them without a browser.
 */

import { regionByKey } from './regions.js';

/** How long a drop waits. The database's own figure (plugin_waiting.expires_at). */
export const WAIT_MINUTES = 60;

/**
 * What a choice's button says: "Whips · Misthalin" in Region Bingo, where the
 * same item can sit on tiles in two regions; just "Whips" on a Bingo card.
 */
export function choiceLabel(choice) {
  const tile = typeof choice?.tile === 'string' && choice.tile.trim() ? choice.tile.trim() : 'A tile';
  const region = choice?.region ? regionByKey.get(choice.region)?.name ?? null : null;
  return region ? `${tile} · ${region}` : tile;
}

/** Whole minutes left before `expiresAt`, rounded up, never below 0. */
export function minutesLeft(expiresAt, now = Date.now()) {
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - now) / 60000));
}

/** "17:42", in the viewer's own time. */
export function clock(at, seconds = false) {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleTimeString('en-GB', seconds
    ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' });
}

/** "Waits until 17:42 (23 min left)", or null once the hour is up. */
export function waitsUntil(expiresAt, now = Date.now()) {
  const left = minutesLeft(expiresAt, now);
  if (left <= 0) return null;
  return `Waits until ${clock(expiresAt)} (${left} min left)`;
}
