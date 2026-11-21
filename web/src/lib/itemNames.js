/**
 * Is a tile's drop the name of an item in the game?
 *
 * Drops reach a tile by name. A screenshot uploaded by hand is matched by the
 * player, who picks the drop from the list, so any wording works there. Dink
 * is matched by the server, which compares the drop's name to the item's name
 * the game sends, after both go through `dropKey`: capitals, apostrophes and
 * spacing are forgiven, nothing else is. "Thamarons sceptre" never meets
 * "Thammaron's sceptre (u)". So the tile editor checks each drop against the
 * names of real items while the board is being built, and offers the nearest
 * real names when it is not one.
 *
 * It only warns. "Any Barrows piece" is a perfectly good drop for a tile that
 * is uploaded by hand.
 *
 * The names (itemNames.data.js, ~100 KB) are loaded the first time a tile
 * form opens, never with the rest of the site.
 */

/**
 * The server's `drop_key` (runelite-plugin/server/001_plugin_tokens.sql), here
 * so the editor's answer is the server's answer. Lowercase; apostrophes of
 * every kind removed; anything else that is not a letter or digit becomes a
 * space; spacing collapsed. Null when nothing is left.
 *
 * The plugin's tests compare this with the SQL over every item name
 * (server/test/tokens.test.mjs). They must never disagree.
 */
export function dropKey(text) {
  const key = String(text ?? '')
    .toLowerCase()
    .replace(/['’‘`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return key === '' ? null : key;
}

// "Thammaron's sceptre (u)" -> "Thammaron's sceptre". The bracket is where the
// game keeps a charge, a dose or a trim, and it is the part people leave out.
const withoutBracket = (name) => name.replace(/\s*\([^()]*\)\s*$/, '');

/**
 * Edit distance with swapped neighbours counting as one edit (so "scepter"
 * is one away from "sceptre"). Gives up past `limit`, which keeps a pass over
 * every item name cheap.
 */
function distance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, prev2[j - 2] + 1);
      }
      row.push(d);
      if (d < best) best = d;
    }
    if (best > limit) return limit + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

/**
 * An index over a list of item names.
 *
 *   known(label)     true when Dink could match it: its key is an item's key
 *   suggest(label)   up to three real names close to it, best first
 *
 * Blank labels are neither known nor wrong: `check` leaves them alone.
 */
export function makeItemIndex(names) {
  const byKey = new Map();   // key -> the item's name
  const byBase = new Map();  // key without the bracket -> names that have one
  for (const name of names) {
    const key = dropKey(name);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, name);
    const base = dropKey(withoutBracket(name));
    if (base && base !== key) byBase.set(base, [...(byBase.get(base) ?? []), name]);
  }
  const keys = [...byKey.keys()];
  const bases = [...byBase.keys()];
  const cache = new Map();

  function suggest(label) {
    const key = dropKey(label);
    if (!key) return [];
    if (cache.has(key)) return cache.get(key);
    // Score per name: 0 for the same words without the bracket, else the
    // number of typing slips. Lower is better.
    const scores = new Map();
    const offer = (name, score) => {
      if (!scores.has(name) || scores.get(name) > score) scores.set(name, score);
    };
    const typedBase = dropKey(withoutBracket(String(label)));
    for (const lookup of new Set([key, typedBase])) {
      for (const name of byBase.get(lookup) ?? []) offer(name, 0);
      if (lookup !== key && byKey.has(lookup)) offer(byKey.get(lookup), 0);
    }
    // Short names are too easy to be near by accident: "bones" is one slip
    // from "bonds". No guessing below five letters, one slip up to eight.
    const limit = key.length < 5 ? 0 : key.length <= 8 ? 1 : 2;
    if (limit > 0) {
      for (const k of keys) {
        const d = distance(key, k, limit);
        if (d <= limit) offer(byKey.get(k), d);
      }
      for (const b of bases) {
        const d = distance(key, b, limit);
        if (d <= limit) for (const name of byBase.get(b)) offer(name, d);
      }
    }
    const best = [...scores]
      .sort(([a, sa], [b, sb]) => sa - sb || a.length - b.length || a.localeCompare(b))
      .slice(0, 3)
      .map(([name]) => name);
    cache.set(key, best);
    return best;
  }

  return {
    size: byKey.size,
    known: (label) => byKey.has(dropKey(label)),
    suggest,
    /** Null when there is nothing to say: blank, or a real item's name. */
    check(label) {
      if (!dropKey(label) || byKey.has(dropKey(label))) return null;
      return { suggestions: suggest(label) };
    },
  };
}

let loading = null;

/**
 * The index over every item name, loaded once. Rejects if the names cannot be
 * loaded (offline, a stale page after a deploy); the next call tries again,
 * and the form simply shows no warnings meanwhile.
 */
export function loadItemNames() {
  loading ??= import('./itemNames.data.js')
    .then((m) => makeItemIndex(m.ITEM_NAMES))
    .catch((e) => { loading = null; throw e; });
  return loading;
}
