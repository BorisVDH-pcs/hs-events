// What the intake function does with one Dink notification. Everything that
// reaches outside comes in as `deps`, so this file runs unchanged in the Edge
// Function (deps = PostgREST and Storage) and in
// runelite-plugin/server/test/intake.test.mjs (deps = the replayed database
// and a Map).
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
 * @returns {Promise<{status: number, outcome: string, reason?: string, results?: object[], resized?: object,
 *   tokenChecked?: boolean}>}
 *   `status` is what Dink is told. Everything else is for the log only: the
 *   HTTP answer never says what matched (see index.ts). `tokenChecked` is true
 *   once the database has accepted the token; some answers come before it is
 *   asked (a notification that is not a drop, a screenshot of the wrong type).
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
  // Decided by Boris, 2026-11-21: a drop on a Leagues or other seasonal world
  // does not count. Refused before the database is asked, so it costs nothing.
  if (drop.seasonal) return { status: 200, outcome: 'ignored', reason: 'seasonal_world' };
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
      p_token: token, p_rsn: drop.rsn, p_items: drop.items.map(({ name }) => ({ name, from: drop.from })),
    });
  } catch (e) {
    if (/Unknown or revoked plugin token/.test(e.message)) return { status: 401, outcome: 'bad_token' };
    throw e;
  }
  // From here on the database has accepted the token.
  if (!match.account_ok) return { status: 200, outcome: 'ignored', reason: 'unknown_account', tokenChecked: true };

  // The key is made from the screenshot as Dink sent it, so a retry is known
  // whatever the shrinking does.
  const base = await dedupeKey(payloadText, image.bytes);
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  const results = [];

  // The shrinking costs CPU, so only for a drop that will be kept: handed in
  // ('one'), or kept for the team to choose a tile ('ask').
  let stored = image;
  let resized;
  if (tooBig && match.items.some((m) => m.verdict === 'one' || m.verdict === 'ask')) {
    const started = performance.now();
    const small = await (deps.shrink ?? shrinkPng)(image.bytes, MAX_BYTES);
    if (!small) return { status: 200, outcome: 'ignored', reason: 'screenshot_too_large', tokenChecked: true };
    stored = { bytes: small.bytes, type: 'image/png' };
    resized = {
      from: `${small.fromWidth}x${small.fromHeight}`, to: `${small.width}x${small.height}`,
      bytes_in: image.bytes.length, bytes_out: small.bytes.length, ms: Math.round(performance.now() - started),
    };
  }

  // What Dink reported, kept beside the evidence.
  const report = (item, dedupe) => ({
    source: 'dink',
    dedupe,
    rsn: drop.rsn, item: item.name, item_id: item.id, quantity: item.quantity,
    price_each: item.priceEach, from: drop.from, category: drop.category,
    world: drop.world, region_id: drop.regionId, dink_type: drop.type,
    // So a reviewer knows the picture was made smaller here, and from what.
    ...(resized ? { resized_from: resized.from } : {}),
  });

  // Ask where the screenshot goes, store it there, then hand it over. Either
  // way, no screenshot is left behind without its row.
  const store = async (openFn, openArgs, keepFn, keepArgs) => {
    let path = null;
    try {
      const opened = await deps.rpc(openFn, openArgs);
      path = `${opened.path_prefix}${uuid()}.${IMAGE_TYPES[stored.type]}`;
      await deps.upload(path, stored.bytes, stored.type);
      const res = await deps.rpc(keepFn, { ...keepArgs, p_storage_path: path });
      // A retry of a drop already kept: the first screenshot is the one on
      // the row, so this copy is not.
      if (res.duplicate) await deps.remove(path);
      return { res };
    } catch (e) {
      if (path) await deps.remove(path).catch(() => {});
      // P0001 is `raise exception`: a rule said no (the tile filled up a moment
      // ago, time ran out). Final, so not worth a retry. Anything else -- the
      // database or the storage being unreachable -- goes up, becomes a 500,
      // and Dink sends the drop again; the dedupe key keeps that safe.
      if (e.code !== RULE_REFUSAL) throw e;
      return { refused: e.message };
    }
  };

  for (let i = 0; i < match.items.length; i++) {
    const verdict = match.items[i].verdict;
    const item = drop.items[i];

    // 'ask' is two or more tiles wanting the same drop. Dink cannot ask
    // anybody, and the server never guesses: the drop is kept for an hour and
    // anyone on the team chooses the tile on the site (Boris, 2026-11-21;
    // 002, section 6c).
    if (verdict === 'ask') {
      const who = { p_token: token, p_rsn: drop.rsn, p_item: item.name };
      const { res, refused } = await store('plugin_wait_open', who, 'plugin_wait',
        { ...who, p_detail: report(item, `${base}:wait:${i}`) });
      results.push(refused
        ? { item: item.name, verdict, waiting: false, refused }
        : { item: item.name, verdict, waiting: !res.duplicate, duplicate: res.duplicate, choices: res.choices });
      continue;
    }
    if (verdict !== 'one') {
      results.push({ item: item.name, verdict });
      continue;
    }

    const hit = match.items[i].matches[0];
    const args = {
      p_token: token, p_rsn: drop.rsn,
      p_tile_id: hit.tile_id, p_option_id: hit.option_id, p_item: item.name,
    };
    const { res, refused } = await store('plugin_open', args, 'plugin_submit',
      { ...args, p_public_url: null, p_detail: report(item, `${base}:${hit.option_id}`) });
    results.push(refused
      ? { item: item.name, verdict, tile: hit.tile, submitted: false, refused }
      : { item: item.name, verdict, tile: hit.tile, submitted: !res.duplicate, duplicate: res.duplicate });
  }

  return {
    status: 200,
    tokenChecked: true,
    outcome: results.some((r) => r.submitted) ? 'submitted'
      : results.some((r) => r.waiting) ? 'waiting' : 'nothing_submitted',
    results,
    ...(resized ? { resized } : {}),
  };
}

/**
 * Screenshots nobody needs any more (plugin_drops.sql, section 6d; Boris,
 * 2026-11-21): a waiting drop's file once it is handed in or its hour is up,
 * and copies made for a choice that was never handed in. The database says
 * which; Storage removes them; then the database marks them, so a removal
 * that fails is tried again next time. Nothing the database does not list is
 * ever touched.
 *
 * Run by index.ts after a request it understood: the project has no pg_cron,
 * and Dink sends something whenever a player with it gets loot.
 *
 * @param {{rpc: Function, removeAll: (paths: string[]) => Promise<void>}} deps
 * @returns {Promise<number>} how many files were removed
 */
export async function removeLeftovers(deps, limit = 20) {
  const due = (await deps.rpc('plugin_leftover_files', { p_limit: limit })) ?? [];
  const paths = due.map((d) => d.storage_path).filter((p) => typeof p === 'string' && p);
  if (!paths.length) return 0;
  await deps.removeAll(paths);
  return deps.rpc('plugin_leftovers_removed', { p_paths: paths });
}
