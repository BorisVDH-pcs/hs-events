/**
 * Where a piece of evidence came from, for the organiser's review screen.
 *
 * Most evidence is uploaded on the site, and that stays the normal way in. A
 * player who runs Dink (a RuneLite plugin) can also have a drop handed in for
 * them. The database marks those rows 'dink' or 'plugin', and
 * admin_evidence_sources() tells the review screen which rows they are and
 * what the plugin reported (runelite-plugin/server/002_plugin_drops.sql).
 *
 * "SENT BY PLUGIN", NEVER "VERIFIED". The plugin runs on the player's own
 * computer, and everything in `detail` is what that computer said. It saves
 * the player a screenshot and an upload; it proves nothing the picture does
 * not. So the label says how it arrived, and the organiser reads the picture
 * as they read any other.
 *
 * Every string here is the client's, so it is shown as text (React escapes
 * it) and cut to a length that cannot push the row apart.
 */

export const PLUGIN_LABEL = 'Sent by plugin';

export const PLUGIN_TITLE =
  "Handed in by a RuneLite plugin from the player's own game, not uploaded on the site. "
  + 'It is what their client reported, so check the picture as you would any upload.';

const MAX_TEXT = 60;

/** A client's string, or null: trimmed, and cut at MAX_TEXT with an ellipsis. */
function clientText(value) {
  if (typeof value !== 'string') return null;
  const t = value.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t;
}

/** A whole number the client sent, or null. */
function clientInt(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * The label and the lines under it for one evidence row, or null for an
 * upload from the site (or a row the database said nothing about).
 *
 * @param {{source?: string, detail?: object}} row
 * @returns {{label: string, title: string, lines: string[]} | null}
 */
export function evidenceSource(row) {
  const source = row?.source;
  if (!source || source === 'web') return null;

  const d = row.detail !== null && typeof row.detail === 'object' ? row.detail : {};
  const item = clientText(d.item);
  const qty = clientInt(d.quantity);
  const from = clientText(d.from);
  const rsn = clientText(d.rsn);
  const world = clientInt(d.world);
  const pet = d.dink_type === 'PET';

  const lines = [];

  // What the plugin said dropped, and from what.
  let what = item ?? '';
  if (what && qty && qty > 1) what += ` ×${qty.toLocaleString('en-GB')}`;
  if (what && pet) what = `Pet: ${what}`;
  if (what && from && !pet) what += ` from ${from}`;
  if (what) lines.push(what);

  // Which of the player's accounts, and where. The name is the one in game,
  // which is not always the name they use on the site.
  const where = [rsn && `as ${rsn}`, world && `world ${world}`].filter(Boolean).join(' · ');
  if (where) lines.push(where);

  const resizedFrom = clientText(d.resized_from);
  if (resizedFrom && /^\d+x\d+$/.test(resizedFrom)) {
    lines.push(`Picture made smaller from ${resizedFrom.replace('x', '×')}`);
  }

  return { label: PLUGIN_LABEL, title: PLUGIN_TITLE, lines };
}

/**
 * The review screen's rows with source and detail laid on, by id. A row the
 * sources do not name is left exactly as it was: an upload from the site.
 *
 * @param {object[]} rows    admin_list_evidence's rows (and anything else listed)
 * @param {object[]|null} sources admin_evidence_sources's rows, or null when
 *                           the database has no such function yet
 */
export function withSources(rows, sources) {
  if (!sources?.length) return rows;
  const byId = new Map(sources.map((s) => [s.id, s]));
  return rows.map((r) => {
    const s = byId.get(r.id);
    return s ? { ...r, source: s.source, detail: s.detail } : r;
  });
}
