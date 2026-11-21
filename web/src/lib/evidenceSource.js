/**
 * Where a piece of evidence came from, for the organiser's review screen and
 * for a tile's panel (EvidencePanel), which a team opens on its own board.
 *
 * Most evidence is uploaded on the site, and that stays the normal way in. A
 * player who runs Dink (a RuneLite plugin) can also have a drop handed in for
 * them. The database marks those rows 'dink' or 'plugin', and tells the
 * screens which rows they are and what the plugin reported: the review screen
 * through admin_evidence_sources(), the panel through evidence_sources()
 * (runelite-plugin/server/002_plugin_drops.sql).
 *
 * WHY THE PANEL SHOWS IT TOO (Boris, 2026-11-21). Dink's screenshot does not
 * always show the drop: the chat box may be closed, and a small item on the
 * ground is a few pixels, or hidden. So the drop line ("Bones ×1 from Woman")
 * goes beside every Dink picture, for the team as well as the organiser. The
 * time is the row's own, shown beside it: our server's clock when the drop
 * arrived, seconds after the kill, not the player's.
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
 * The label, the drop, and the lines under it for one evidence row, or null
 * for an upload from the site (or a row the database said nothing about).
 *
 * `drop` is what the plugin said dropped, how many, and from what: "Bones ×1
 * from Woman". It is the line that says what the picture is for, so the
 * screens show it first and plainest. Null when the plugin named no item.
 * `lines` is the rest: which account and world, and a resize.
 *
 * @param {{source?: string, detail?: object}} row
 * @returns {{label: string, title: string, drop: string|null, lines: string[]} | null}
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

  // What the plugin said dropped, how many (a single one too, so the line
  // always says), and from what.
  let drop = item;
  if (drop && pet) drop = `Pet: ${drop}`;
  else if (drop && qty) drop += ` ×${qty.toLocaleString('en-GB')}`;
  if (drop && from && !pet) drop += ` from ${from}`;

  const lines = [];

  // Which world, and which of the player's accounts. The name is the one in
  // game, which is not always the name they use on the site.
  const where = [world && `World ${world}`, rsn && `as ${rsn}`].filter(Boolean).join(' · ');
  if (where) lines.push(where);

  const resizedFrom = clientText(d.resized_from);
  if (resizedFrom && /^\d+x\d+$/.test(resizedFrom)) {
    lines.push(`Picture made smaller from ${resizedFrom.replace('x', '×')}`);
  }

  return { label: PLUGIN_LABEL, title: PLUGIN_TITLE, drop: drop ?? null, lines };
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
