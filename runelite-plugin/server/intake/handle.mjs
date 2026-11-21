// What the intake function does with one Dink notification. Everything that
// reaches outside comes in as `deps`, so this file runs unchanged in the Edge
// Function (deps = PostgREST and Storage) and in server/test/intake.test.mjs
// (deps = the replayed database and a Map).
//
// It decides nothing about the game. The database says what a drop matches
// (plugin_match), whether it may be handed in (plugin_open), and what it is
// worth (plugin_submit, which is add_evidence).

import { dedupeKey, parseDink } from './dink.mjs';
import { canShrink, shrinkPng } from './shrink.mjs';

/** The evidence bucket's own limits (0021_evidence.sql). */
export const MAX_BYTES = 3 * 1024 * 1024;
export const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
/** Dink never sends more: over 8,000,000 bytes it turns the PNG into a smaller JPEG itself. */
export const MAX_SHRINK_INPUT = 8_000_000;

const TOKEN = /^hse_[0-9a-f]{64}$/;
/** Postgres' code for `raise exception`. deps.rpc must pass it on as `error.code`. */
const RULE_REFUSAL = 'P0001';

/**
 * @param {{token: string|null, payloadText: string, image: {bytes: Uint8Array, type: string}|null}} req
 * @param {{
 *   rpc: (fn: string, args: object) => Promise<any>,   // throws with .code set to the Postgres error code
 *   upload: (path: string, bytes: Uint8Array, type: string) => Promise<void>,
 *   remove: (path: string) => Promise<void>,
 *   uuid?: () => string,
 *   shrink?: typeof shrinkPng,   // only the tests replace it
 * }} deps
 * @returns {Promise<{status: number, outcome: string, reason?: string, results?: object[], resized?: object}>}
 *   `status` is what Dink is told. Everything else is for the log only: the
 *   HTTP answer never says what matched (see index.ts).
 */
export async function handleDink({ token, payloadText, image }, deps) {
  if (!TOKEN.test(token ?? '')) return { status: 401, outcome: 'bad_token' };

  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    return { status: 400, outcome: 'bad_json' };
  }

  const drop = parseDink(payload);
  // 200 for everything that is not worth a retry. Dink retries any answer that
  // is not a 2xx, three times by default, after 2, 4 and 8 seconds
  // (DiscordMessageHandler), so a 401 or 400 is retried too; that only costs
  // three calls.
  if (!drop.ok) return { status: 200, outcome: 'ignored', reason: drop.reason };
  if (!image) return { status: 200, outcome: 'ignored', reason: 'no_screenshot' };
  if (!(image.type in IMAGE_TYPES)) return { status: 200, outcome: 'ignored', reason: 'screenshot_type' };
  // Over the bucket's limit: only a PNG as Dink writes it can be made smaller
  // (shrink.mjs). Checked from its header alone, before anything is asked.
  const tooBig = image.bytes.length > MAX_BYTES;
  if (tooBig && (image.type !== 'image/png' || image.bytes.length > MAX_SHRINK_INPUT || !canShrink(image.bytes))) {
    return { status: 200, outcome: 'ignored', reason: 'screenshot_too_large' };
  }

  let match;
  try {
    match = await deps.rpc('plugin_match', {
      p_token: token, p_rsn: drop.rsn, p_items: drop.items.map(({ name }) => ({ name })),
    });
  } catch (e) {
    if (/Unknown or revoked plugin token/.test(e.message)) return { status: 401, outcome: 'bad_token' };
    throw e;
  }
  if (!match.account_ok) return { status: 200, outcome: 'ignored', reason: 'unknown_account' };

  // The key is made from the screenshot as Dink sent it, so a retry is known
  // whatever the shrinking does.
  const base = await dedupeKey(payloadText, image.bytes);
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  const results = [];

  // The shrinking costs CPU, so only for a drop that will be handed in.
  let stored = image;
  let resized;
  if (tooBig && match.items.some((m) => m.verdict === 'one')) {
    const started = performance.now();
    const small = await (deps.shrink ?? shrinkPng)(image.bytes, MAX_BYTES);
    if (!small) return { status: 200, outcome: 'ignored', reason: 'screenshot_too_large' };
    stored = { bytes: small.bytes, type: 'image/png' };
    resized = {
      from: `${small.fromWidth}x${small.fromHeight}`, to: `${small.width}x${small.height}`,
      bytes_in: image.bytes.length, bytes_out: small.bytes.length, ms: Math.round(performance.now() - started),
    };
  }

  for (let i = 0; i < match.items.length; i++) {
    const verdict = match.items[i].verdict;
    const item = drop.items[i];
    // 'ask' is two tiles wanting the same drop. Dink cannot ask anybody, so the
    // player hands that one in on the site. Never a guess.
    if (verdict !== 'one') {
      results.push({ item: item.name, verdict });
      continue;
    }
    const hit = match.items[i].matches[0];
    const args = {
      p_token: token, p_rsn: drop.rsn,
      p_tile_id: hit.tile_id, p_option_id: hit.option_id, p_item: item.name,
    };
    let path = null;
    try {
      const opened = await deps.rpc('plugin_open', args);
      path = `${opened.path_prefix}${uuid()}.${IMAGE_TYPES[stored.type]}`;
      await deps.upload(path, stored.bytes, stored.type);
      const res = await deps.rpc('plugin_submit', {
        ...args,
        p_storage_path: path,
        p_public_url: null,
        p_detail: {
          source: 'dink',
          dedupe: `${base}:${hit.option_id}`,
          rsn: drop.rsn, item: item.name, item_id: item.id, quantity: item.quantity,
          price_each: item.priceEach, from: drop.from, category: drop.category,
          world: drop.world, region_id: drop.regionId, seasonal: drop.seasonal, dink_type: drop.type,
          // So a reviewer knows the picture was made smaller here, and from what.
          ...(resized ? { resized_from: resized.from } : {}),
        },
      });
      // A retry of a drop already counted: the first screenshot is the one on
      // the evidence row, so this copy is not kept.
      if (res.duplicate) await deps.remove(path);
      results.push({ item: item.name, verdict, tile: hit.tile, submitted: !res.duplicate, duplicate: res.duplicate });
    } catch (e) {
      // Either way, no screenshot is left behind without its row.
      if (path) await deps.remove(path).catch(() => {});
      // P0001 is `raise exception`: a rule said no (the tile filled up a moment
      // ago, time ran out). Final, so not worth a retry. Anything else -- the
      // database or the storage being unreachable -- goes up, becomes a 500,
      // and Dink sends the drop again; the dedupe key keeps that safe.
      if (e.code !== RULE_REFUSAL) throw e;
      results.push({ item: item.name, verdict, tile: hit.tile, submitted: false, refused: e.message });
    }
  }

  return {
    status: 200,
    outcome: results.some((r) => r.submitted) ? 'submitted' : 'nothing_submitted',
    results,
    ...(resized ? { resized } : {}),
  };
}
