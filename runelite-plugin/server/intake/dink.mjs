// Reads a Dink notification (github.com/pajlads/DinkPlugin). Pure functions,
// no I/O, so they run the same in the Edge Function (Deno) and under Node.
//
// Dink posts JSON, or multipart/form-data with the JSON in a part called
// `payload_json` and the screenshot in a part called `file`. The field names
// below are from Dink's docs/json-examples.md as read on 2026-11-20. They have
// NOT yet been checked against a message from a real client: that is phase 0
// of the plan. The parser is forgiving for that reason, and anything it does
// not recognise is ignored, never guessed at.

/** The notification types that can carry a drop a tile might list. */
const DROP_TYPES = new Set(['LOOT', 'COLLECTION', 'PET', 'CLUE']);

const text = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const int = (v) => (Number.isInteger(v) ? v : null);

/**
 * @param {unknown} payload the parsed payload_json
 * @returns {{ok: false, reason: string} | {
 *   ok: true, type: string, rsn: string, world: number|null, regionId: number|null,
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
  if (!DROP_TYPES.has(type)) return { ok: false, reason: 'not_a_drop' };

  const rsn = text(payload.playerName);
  if (!rsn) return { ok: false, reason: 'no_player' };

  const extra = payload.extra !== null && typeof payload.extra === 'object' ? payload.extra : {};
  let raw = [];
  if (type === 'LOOT' || type === 'CLUE') {
    raw = Array.isArray(extra.items) ? extra.items : [];
  } else if (type === 'COLLECTION') {
    raw = [{ name: extra.itemName, id: extra.itemId, quantity: 1, priceEach: extra.price }];
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
