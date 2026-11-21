// Reads a Dink notification (github.com/pajlads/DinkPlugin). Pure functions,
// no I/O, so they run the same in the Edge Function (Deno) and under Node.
//
// Dink posts JSON, or multipart/form-data with the JSON in a part called
// `payload_json` and the screenshot in a part called `file`. The field names
// below were checked on 2026-11-21 against Dink's docs/json-examples.md and
// against the classes that write them (NotificationBody, LootNotificationData,
// PetNotificationData, SerializedItemStack) at commit ae769ad. They have NOT
// yet been checked against a message from a real client. The parser is
// forgiving for that reason, and anything it does not recognise is ignored,
// never guessed at.

// One drop is one piece of evidence, and Dink can report one drop more than
// once: a LOOT notification, then a COLLECTION one when the item fills a new
// log slot, or a CLUE one beside the casket's LOOT. Each comes with its own
// screenshot, so the dedupe key cannot tell them apart. LOOT alone covers
// drops (with Dink's defaults it includes clue caskets and has no minimum
// value) and PET covers pets, which are never loot. The other two are the
// same drop again.
const DROP_TYPES = new Set(['LOOT', 'PET']);
const COVERED_BY_LOOT = new Set(['COLLECTION', 'CLUE']);

const text = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
// Dink writes ids as ints and prices as Java longs.
const int = (v) => (Number.isSafeInteger(v) ? v : null);

/**
 * @param {unknown} payload the parsed payload_json
 * @returns {{ok: false, reason: string} | {
 *   ok: true, type: string, rsn: string, seasonal: boolean, world: number|null, regionId: number|null,
 *   from: string|null, category: string|null,
 *   items: {name: string, id: number|null, quantity: number, priceEach: number|null}[]
 * }}
 */
export function parseDink(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'not_an_object' };
  }
  const type = text(payload.type);
  if (!type) return { ok: false, reason: 'no_type' };
  if (COVERED_BY_LOOT.has(type)) return { ok: false, reason: 'covered_by_loot' };
  if (!DROP_TYPES.has(type)) return { ok: false, reason: 'not_a_drop' };

  // Dink sends the name as the game gives it, which puts a non-breaking space
  // between words. RuneLite's own Text.sanitize does the same replace.
  const rsn = text(typeof payload.playerName === 'string' ? payload.playerName.replace(/ /g, ' ') : null);
  if (!rsn) return { ok: false, reason: 'no_player' };

  const extra = payload.extra !== null && typeof payload.extra === 'object' ? payload.extra : {};
  // Only what is needed to match and to show the organiser. `extra.party`
  // names other players and is never read.
  let raw = [];
  if (type === 'LOOT') {
    raw = Array.isArray(extra.items) ? extra.items : [];
  } else if (type === 'PET') {
    raw = [{ name: extra.petName, quantity: 1 }];
  }

  const items = [];
  for (const it of raw) {
    if (it === null || typeof it !== 'object') continue;
    const name = text(it.name);
    if (!name) continue;
    items.push({
      name,
      id: int(it.id),
      quantity: int(it.quantity) !== null && it.quantity > 0 ? it.quantity : 1,
      priceEach: int(it.priceEach),
    });
  }
  // A cap, so one request cannot become a thousand lookups.
  if (items.length === 0) return { ok: false, reason: 'no_items' };
  if (items.length > 60) return { ok: false, reason: 'too_many_items' };

  return {
    ok: true,
    type,
    rsn,
    // A boolean in Dink's NotificationBody. True on Leagues and other seasonal worlds.
    seasonal: payload.seasonalWorld === true,
    world: int(payload.world),
    regionId: int(payload.regionId),
    from: text(extra.source),
    category: text(extra.category),
    items,
  };
}

/**
 * The same for a retry, different for another drop. Dink resends the identical
 * body and the identical screenshot when a send fails; two drops of the same
 * item never share a screenshot. So: a hash of both.
 *
 * @param {string} payloadText payload_json exactly as received
 * @param {Uint8Array} imageBytes
 */
export async function dedupeKey(payloadText, imageBytes) {
  const head = new TextEncoder().encode(payloadText + '\n');
  const all = new Uint8Array(head.length + imageBytes.length);
  all.set(head, 0);
  all.set(imageBytes, head.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}
