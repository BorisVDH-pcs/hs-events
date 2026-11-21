// The Dink route, end to end and offline: a notification as Dink documents it
// goes through intake/handle.mjs, whose database is the replay of every
// migration plus the plugin drafts, and whose storage is a Map.
//
// Also intake/shrink.mjs, which makes a screenshot over 3 MB smaller, checked
// against png.mjs (a separate PNG writer and reader on Node's zlib) and a PNG
// written by Java's ImageIO, as Dink writes them.
//
// What this does not cover: intake/index.ts (the Deno shell that reads the
// HTTP request; stack.test.mjs runs it), and a message from a real Dink client.
//
//   node intake.test.mjs

import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { buildGame, J } from './fixture.mjs';
import { dedupeKey, parseDink } from '../intake/dink.mjs';
import { handleDink, MAX_BYTES, MAX_SHRINK_INPUT } from '../intake/handle.mjs';
import { canShrink, MAX_PIXELS, pngInfo, shrinkPng } from '../intake/shrink.mjs';
import { chunk, expectedHalf, ihdr, makePng, rawPng, readPng, same } from './png.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : '  -- ' + extra}`);
};

// A loot notification in the shape of Dink's docs/json-examples.md, checked
// against Dink's own classes (NotificationBody, LootNotificationData) at
// commit ae769ad, 2026-11-19.
const loot = (rsn, items, more = {}, extra = {}) => ({
  content: `${rsn} has looted: ...`,
  extra: {
    items: items.map((name, i) => ({ id: 4000 + i, quantity: 1, priceEach: 42069, name, criteria: ['VALUE'], rarity: null })),
    source: 'Abyssal demon', category: 'NPC', killCount: 60, npcId: 415,
    ...extra,
  },
  type: 'LOOT', playerName: rsn, accountType: 'NORMAL', seasonalWorld: false, dinkAccountHash: 'abc123', embeds: [],
  world: 302, regionId: 12850,
  ...more,
});
const png = (seed) => ({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, seed, seed >> 8]), type: 'image/png' });
const padTo = (bytes, n) => { const out = new Uint8Array(n); out.set(bytes); return out; };

// ------------------------------------------------------------- the parser
let p = parseDink(loot('Mate Iron', ['Abyssal whip', 'Bones']));
ok('a loot notification parses',
   p.ok && p.rsn === 'Mate Iron' && p.items.length === 2 && p.items[0].name === 'Abyssal whip'
   && p.items[0].id === 4000 && p.items[0].priceEach === 42069 && p.from === 'Abyssal demon'
   && p.category === 'NPC' && p.world === 302 && p.regionId === 12850 && p.seasonal === false, J(p));
p = parseDink(loot('Mate Iron', ['Abyssal whip'], { seasonalWorld: true }));
ok('a drop on a seasonal world says so', p.ok && p.seasonal === true, J(p));
p = parseDink(loot('Mate Iron', ['Abyssal whip']));
ok("the game's non-breaking space in a name becomes a space", p.ok && p.rsn === 'Mate Iron', J(p));
p = parseDink({ type: 'PET', playerName: 'A', extra: { petName: 'Ikkle hydra', milestone: '5,000 killcount', duplicate: false } });
ok('a pet is one item', p.ok && p.items[0].name === 'Ikkle hydra' && p.items[0].quantity === 1, J(p));
// A clue casket comes as LOOT too (Dink's "include clue scrolls", on by default).
p = parseDink(loot('A', ['Ranger boots'], {}, { source: 'Clue Scroll (Hard)', category: 'EVENT', killCount: null, npcId: null }));
ok('a clue reward arrives as loot, from the casket', p.ok && p.items[0].name === 'Ranger boots' && p.from === 'Clue Scroll (Hard)', J(p));
// The same drop a second time, as another kind of notification. Dink sends both.
for (const [name, payload] of [
  ['a new collection log slot', { type: 'COLLECTION', playerName: 'A', extra: {
    itemName: 'Zamorak chaps', itemId: 10372, price: 500812, completedEntries: 420, totalEntries: 1443,
    dropperName: 'Clue Scroll (Hard)', dropperType: 'EVENT', dropperKillCount: 1500 } }],
  ['a clue notification', { type: 'CLUE', playerName: 'A', extra: {
    clueType: 'Hard', numberCompleted: 123, items: [{ id: 1, quantity: 2, priceEach: 5, name: 'Ranger boots' }] } }],
]) {
  const r = parseDink(payload);
  ok(`${name} is ignored: the same drop also comes as loot (covered_by_loot)`,
     r.ok === false && r.reason === 'covered_by_loot', J(r));
}
for (const [name, payload, reason] of [
  ['a death', { type: 'DEATH', playerName: 'A', extra: {} }, 'not_a_drop'],
  ['a level-up', { type: 'LEVEL', playerName: 'A', extra: {} }, 'not_a_drop'],
  ['no player name', { type: 'LOOT', extra: { items: [{ name: 'X' }] } }, 'no_player'],
  ['no type', { playerName: 'A' }, 'no_type'],
  ['a pet the game did not name', { type: 'PET', playerName: 'A', extra: {} }, 'no_items'],
  ['an empty loot', { type: 'LOOT', playerName: 'A', extra: { items: [] } }, 'no_items'],
  ['junk where the items should be', { type: 'LOOT', playerName: 'A', extra: { items: 'nope' } }, 'no_items'],
  ['an array', [], 'not_an_object'],
  ['null', null, 'not_an_object'],
  ['far too many items', loot('A', Array.from({ length: 61 }, (_, i) => `Item ${i}`)), 'too_many_items'],
]) {
  const r = parseDink(payload);
  ok(`${name} is ignored (${reason})`, r.ok === false && r.reason === reason, J(r));
}
p = parseDink({ type: 'LOOT', playerName: ' A ', extra: { items: [null, 7, { name: '  ' }, { name: 'Whip', quantity: -3, id: 'x' }] } });
ok('bad entries are skipped, bad numbers do not get through',
   p.ok && p.rsn === 'A' && p.items.length === 1 && p.items[0].quantity === 1 && p.items[0].id === null, J(p));

const k1 = await dedupeKey('{"a":1}', png(1).bytes);
ok('a dedupe key is 64 hex characters', /^[0-9a-f]{64}$/.test(k1));
ok('the same message and screenshot give the same key', k1 === await dedupeKey('{"a":1}', png(1).bytes));
ok('another screenshot gives another key', k1 !== await dedupeKey('{"a":1}', png(2).bytes));
ok('another message gives another key', k1 !== await dedupeKey('{"a":2}', png(1).bytes));

// ------------------------------------------------- making a screenshot smaller
// shrink.mjs against png.mjs, a separate writer and reader on Node's zlib.
const opaque = (x, y, k) => (k === 3 ? 255 : (x * 7 + y * 13 + k * 50 + ((x * y) % 11)) & 255);
let src = makePng(64, 48, opaque);
let small = await shrinkPng(src.bytes, 1e6);
let back = small && readPng(small.bytes);
ok('a 64 x 48 RGBA PNG, every row filter, data over several chunks: half the size',
   small && small.width === 32 && small.height === 24 && small.fromWidth === 64 && back.width === 32, J(small && { ...small, bytes: small.bytes.length }));
ok('each pixel the average of its 2 x 2 block, and the opaque alpha left out (RGB)',
   back?.colourType === 2 && same(back.data, expectedHalf(src.data, 64, 48, 4, 3)));

src = makePng(50, 30, (x, y, k) => (x * 5 + y * 3 + k * 90) & 255, { channels: 3 });
back = readPng((await shrinkPng(src.bytes, 1e6)).bytes);
ok('an RGB PNG too', back.width === 25 && back.colourType === 2 && same(back.data, expectedHalf(src.data, 50, 30, 3)));

src = makePng(40, 40, (x, y, k) => (k === 3 ? (x * 6) & 255 : (x + y + k) & 255));
back = readPng((await shrinkPng(src.bytes, 1e6)).bytes);
ok('see-through pixels keep their alpha (RGBA)', back.colourType === 6 && same(back.data, expectedHalf(src.data, 40, 40, 4)));

// Written by Java's ImageIO, as Dink writes its screenshots, with an odd size.
const imageio = new Uint8Array(readFileSync(new URL('./fixtures/imageio-121x81.png', import.meta.url)));
const orig = readPng(imageio);
back = readPng((await shrinkPng(imageio, 1e6)).bytes);
ok('a PNG written by ImageIO, 121 x 81: 60 x 40, the odd row and column dropped',
   pngInfo(imageio)?.colourType === 6 && back.width === 60 && back.height === 40
   && same(back.data, expectedHalf(orig.data, 121, 81, 4, 3)));

let seed = 1;
const noise = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16 & 255;
src = makePng(64, 64, () => noise(), { channels: 3, filters: [0] });
small = await shrinkPng(src.bytes, 1500);
ok('when half is not small enough, it halves again', small && small.width < 32 && small.bytes.length <= 1500, J(small && { w: small.width, n: small.bytes.length }));
ok('and gives up rather than send a file that is too big', (await shrinkPng(src.bytes, 10)) === null);

const zeros = new Uint8Array(4096);
const refused = [
  ['not a PNG', new Uint8Array(4000)],
  ['interlaced', rawPng(ihdr(8, 8, { interlace: 1 }), chunk('IDAT', deflateSync(zeros)), chunk('IEND', zeros.subarray(0, 0)))],
  ['16 bits a channel', rawPng(ihdr(8, 8, { depth: 16 }), chunk('IDAT', deflateSync(zeros)), chunk('IEND', zeros.subarray(0, 0)))],
  ['a palette PNG', rawPng(ihdr(8, 8, { colourType: 3 }), chunk('IDAT', deflateSync(zeros)), chunk('IEND', zeros.subarray(0, 0)))],
  ['no image data', rawPng(ihdr(8, 8), chunk('IEND', zeros.subarray(0, 0)))],
  ['image data that is not zlib', rawPng(ihdr(8, 8), chunk('IDAT', zeros.subarray(0, 100)), chunk('IEND', zeros.subarray(0, 0)))],
  ['image data that unpacks to more than the header says', rawPng(ihdr(8, 8), chunk('IDAT', deflateSync(new Uint8Array(1 << 20))), chunk('IEND', zeros.subarray(0, 0)))],
  ['a file cut short', makePng(64, 48, opaque).bytes.subarray(0, 900)],
];
const nulls = [];
for (const [, bytes] of refused) nulls.push(await shrinkPng(bytes, 1e6));
ok('anything else gives null, never a guess: ' + refused.map(([n]) => n).join('; '), nulls.every((x) => x === null), J(nulls.map((x) => x && 'made one')));
const huge = rawPng(ihdr(3841, 2400), chunk('IEND', zeros.subarray(0, 0)));
ok(`more pixels than was measured (${MAX_PIXELS}) is not tried; a 3840 x 2400 header is`,
   !canShrink(huge) && (await shrinkPng(huge, 1e6)) === null && canShrink(rawPng(ihdr(3840, 2400), chunk('IEND', zeros.subarray(0, 0)))));

// A screenshot over the bucket limit and under Dink's 8 MB: 1200 x 900,
// stored without compression, about 4.3 MB.
const big = makePng(1200, 900, opaque, { filters: [0], level: 0, idatChunk: 1 << 16 });
const bigShot = { bytes: big.bytes, type: 'image/png' };
if (!(big.bytes.length > MAX_BYTES && big.bytes.length <= MAX_SHRINK_INPUT)) throw new Error('test screenshot is the wrong size');
let shrinkCalls = 0;
const countShrinks = { shrink: (...a) => { shrinkCalls++; return shrinkPng(...a); } };

// --------------------------------------------------------------- the game
const { db, ids, g, team, T, opt, tok, site, plugin } = await buildGame();
await site(ids.red, `select regions_pick($1, 'misthalin')`, [g]);
await site(ids.blue, `select regions_pick($1, 'asgarnia')`, [g]);

const store = new Map();
let failUploads = 0;
const rpcCalls = [];
const deps = {
  async rpc(fn, args) {
    if (!/^plugin_[a-z_]+$/.test(fn)) throw new Error('unexpected function ' + fn);
    rpcCalls.push(fn);
    const keys = Object.keys(args);
    const isJson = (v) => v !== null && typeof v === 'object';
    const sql = `select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}${isJson(args[k]) ? '::jsonb' : ''}`).join(', ')}) j`;
    return (await plugin(sql, keys.map((k) => (isJson(args[k]) ? J(args[k]) : args[k])))).j;
  },
  async upload(path, bytes, type) {
    if (failUploads > 0) { failUploads--; throw new Error('storage is unreachable'); }
    if (store.has(path)) throw new Error('object exists');
    store.set(path, { bytes, type });
  },
  async remove(path) { store.delete(path); },
};
const send = (key, payload, image = png(1), extraDeps = {}) =>
  handleDink({ token: tok[key], payloadText: J(payload), image }, { ...deps, ...extraDeps });
const evidence = async (teamId) =>
  (await db.query('select e.*, t.name tile from tile_evidence e join tile_claims c on c.id = e.claim_id join tiles t on t.id = c.tile_id where e.team_id = $1 order by e.created_at', [teamId])).rows;

// ------------------------------------------------------------ a drop counts
const first = loot('Mate Iron', ["Karil's coif", 'Bones'], {}, { party: ['Mate Iron', 'Raid Friend'] });
let res = await send('mate', first, png(10));
let ev = await evidence(team.Red);
ok('a wanted drop is handed in', res.status === 200 && res.outcome === 'submitted' && ev.length === 1 && ev[0].tile === 'Barrows chest', J(res));
ok("with source 'dink' and what Dink reported",
   ev[0].source === 'dink' && ev[0].detail.item === "Karil's coif" && ev[0].detail.from === 'Abyssal demon'
   && ev[0].detail.world === 302 && ev[0].detail.rsn === 'Mate Iron'
   && ev[0].uploaded_by === ids.mate, J(ev[0].detail));
ok("and nothing about anybody else: a raid partner's name is not kept", !J(ev[0]).includes('Raid Friend'), J(ev[0].detail));
ok('its screenshot is stored once, under the claim, where the row says',
   store.size === 1 && store.has(ev[0].storage_path)
   && ev[0].storage_path.startsWith(`${g}/${team.Red}/${ev[0].claim_id}/`) && ev[0].storage_path.endsWith('.png'), ev[0].storage_path);
ok('the junk beside it was not', res.results.find((r) => r.item === 'Bones').verdict === 'none');

// The same coif fills a new collection log slot, so Dink sends a second
// notification for it, with a screenshot of its own.
res = await send('mate', { type: 'COLLECTION', playerName: 'Mate Iron', accountType: 'NORMAL', seasonalWorld: false,
  extra: { itemName: "Karil's coif", itemId: 4732, price: 50000, dropperName: 'Barrows', dropperType: 'EVENT' } }, png(30));
ok('the collection log notification for that drop does not count it again',
   res.outcome === 'ignored' && res.reason === 'covered_by_loot' && (await evidence(team.Red)).length === 1 && store.size === 1, J(res));

res = await send('mate', first, png(10));
ok('Dink retrying the same drop: counted once, and no second screenshot kept',
   res.status === 200 && res.results[0].duplicate === true && (await evidence(team.Red)).length === 1 && store.size === 1, J(res));

// ------------------------------------------------------ what is not handed in
let before = store.size;
res = await send('mate', loot('Mate Iron', ["Dharok's helm"]), png(11));
ok('two tiles want it: Dink does not choose, nothing is stored',
   res.outcome === 'nothing_submitted' && res.results[0].verdict === 'ask' && store.size === before, J(res));
const resLocked = await send('mate', loot('Mate Iron', ['Dragon pickaxe']), png(12));
const resJunk = await send('mate', loot('Mate Iron', ['Bones']), png(13));
ok('a drop for a locked region: nothing stored, nothing counted',
   resLocked.outcome === 'nothing_submitted' && store.size === before && (await evidence(team.Red)).length === 1);
ok('and the same outcome as a drop nobody wants',
   J({ ...resLocked, results: resLocked.results.map((r) => r.verdict) }) === J({ ...resJunk, results: resJunk.results.map((r) => r.verdict) }));

res = await send('mate', loot('Mate Iron', ['Bones']), bigShot, countShrinks);
const resBigLocked = await send('mate', loot('Mate Iron', ['Dragon pickaxe']), bigShot, countShrinks);
ok('a big screenshot of a drop nobody wants, or of a locked tile, is never made smaller (no CPU spent on it)',
   res.outcome === 'nothing_submitted' && resBigLocked.outcome === 'nothing_submitted' && shrinkCalls === 0 && store.size === before, J(res));

// Blue's screenshot is the big one: over the bucket limit, under Dink's 8 MB.
const bluePick = loot('Blue\u00a0Main', ['Dragon pickaxe']);
let submittedKey = null;
res = await send('blue', bluePick, bigShot, { ...countShrinks,
  rpc: (fn, args) => { if (fn === 'plugin_submit') submittedKey = args.p_detail.dedupe; return deps.rpc(fn, args); } });
ok("the same drop counts for Blue, who has opened that region",
   res.outcome === 'submitted' && (await evidence(team.Blue)).length === 1 && (await evidence(team.Red)).length === 1, J(res));
ok("Blue's name came with the game's non-breaking space, and is kept with a plain one",
   (await evidence(team.Blue))[0].detail.rsn === 'Blue Main');
const blueEv = (await evidence(team.Blue))[0];
const kept = store.get(blueEv.storage_path);
const keptPng = kept && readPng(kept.bytes);
ok(`its ${(big.bytes.length / 1048576).toFixed(1)} MB screenshot was made smaller, once, and kept as a PNG under 3 MB`,
   shrinkCalls === 1 && kept.type === 'image/png' && blueEv.storage_path.endsWith('.png') && kept.bytes.length <= MAX_BYTES
   && keptPng.width === 600 && keptPng.height === 450 && same(keptPng.data, expectedHalf(big.data, 1200, 900, 4, 3)),
   J({ calls: shrinkCalls, type: kept?.type, n: kept?.bytes.length }));
ok("the evidence says so: resized_from '1200x900', and the log line has the sizes and the time",
   blueEv.detail.resized_from === '1200x900' && res.resized?.to === '600x450' && res.resized.bytes_in === big.bytes.length
   && res.resized.bytes_out === kept.bytes.length && Number.isInteger(res.resized.ms), J([blueEv.detail, res.resized]));
ok("the dedupe key is made from the screenshot as Dink sent it, so a retry is known whatever the shrinking gives",
   submittedKey === `${await dedupeKey(J(bluePick), big.bytes)}:${opt['Dragon pickaxe']}`, submittedKey);
before = store.size;
res = await send('blue', bluePick, bigShot, countShrinks);
ok("Dink's retry once that filled the tile: nothing counted, nothing stored, nothing made smaller",
   res.outcome === 'nothing_submitted' && (await evidence(team.Blue)).length === 1 && store.size === before && shrinkCalls === 1, J(res));

before = store.size;
// Boris, 2026-11-21: a drop on a Leagues (seasonal) world does not count. The
// whip tile is open for Red, so this drop would count anywhere else.
const whip = await deps.rpc('plugin_match', { p_token: tok.mate, p_rsn: 'Mate Iron', p_items: [{ name: 'Abyssal whip' }] });
const callsAt = rpcCalls.length;
res = await send('mate', loot('Mate Iron', ['Abyssal whip'], { seasonalWorld: true }), bigShot, countShrinks);
ok('a wanted drop from a seasonal (Leagues) world: ignored, the database never asked, its screenshot not made smaller',
   whip.items[0].verdict === 'one' && res.status === 200 && res.outcome === 'ignored' && res.reason === 'seasonal_world'
   && rpcCalls.length === callsAt && shrinkCalls === 1, J([whip.items[0].verdict, res]));

for (const [name, run, want] of [
  ['no screenshot', () => send('mate', loot('Mate Iron', ['Abyssal whip']), null), 'no_screenshot'],
  ['a screenshot over the bucket limit that is not a PNG this can read', () => send('mate', loot('Mate Iron', ['Abyssal whip']), { bytes: new Uint8Array(MAX_BYTES + 1), type: 'image/png' }), 'screenshot_too_large'],
  ['a JPEG over the bucket limit (not made smaller here)', () => send('mate', loot('Mate Iron', ['Abyssal whip']), { bytes: big.bytes, type: 'image/jpeg' }), 'screenshot_too_large'],
  ["a PNG over Dink's 8 MB", () => send('mate', loot('Mate Iron', ['Abyssal whip']), { bytes: padTo(big.bytes, MAX_SHRINK_INPUT + 1), type: 'image/png' }), 'screenshot_too_large'],
  ['a PNG with more pixels than was measured', () => send('mate', loot('Mate Iron', ['Abyssal whip']), { bytes: padTo(rawPng(ihdr(3841, 2400)), MAX_BYTES + 1), type: 'image/png' }), 'screenshot_too_large'],
  // The whip tile wants this drop, so this one really is decoded, and fails.
  ['a PNG over the bucket limit whose data is broken', () => send('mate', loot('Mate Iron', ['Abyssal whip']), { bytes: padTo(rawPng(ihdr(1200, 900), chunk('IDAT', new Uint8Array(500))), MAX_BYTES + 1), type: 'image/png' }), 'screenshot_too_large'],
  ['a file that is not an image the bucket takes', () => send('mate', loot('Mate Iron', ['Abyssal whip']), { bytes: new Uint8Array(4), type: 'image/gif' }), 'screenshot_type'],
  ["an in-game name that is not the player's", () => send('mate', loot('Zezima', ['Abyssal whip']), png(15)), 'unknown_account'],
  ['a notification that is not a drop', () => send('mate', { type: 'DEATH', playerName: 'Mate Iron', extra: {} }, png(16)), 'not_a_drop'],
]) {
  const r = await run();
  ok(`${name}: ignored, and Dink is not asked to retry`, r.status === 200 && r.outcome === 'ignored' && r.reason === want, J(r));
}
ok('none of those stored or counted anything', store.size === before && (await evidence(team.Red)).length === 1);

// ----------------------------------------------------------------- tokens
const callsBefore = rpcCalls.length;
res = await handleDink({ token: 'nope', payloadText: J(loot('Mate Iron', ['Abyssal whip'])), image: png(17) }, deps);
ok('a malformed token: 401, and the database is never asked', res.status === 401 && rpcCalls.length === callsBefore);
res = await handleDink({ token: null, payloadText: '{}', image: null }, deps);
ok('no token at all: 401, and the database is never asked', res.status === 401 && rpcCalls.length === callsBefore);
res = await handleDink({ token: 'hse_' + 'a'.repeat(64), payloadText: J(loot('Mate Iron', ['Abyssal whip'])), image: png(18) }, deps);
ok('a token nobody was given: 401', res.status === 401, J(res));
res = await handleDink({ token: tok.mate, payloadText: '{not json', image: png(19) }, deps);
ok('a body that is not JSON: 400', res.status === 400, J(res));

// -------------------------------------------------- failures part-way through
failUploads = 1;
before = store.size;
let threw = null;
try { await send('mate', loot('Mate Iron', ['Abyssal whip']), png(20)); } catch (e) { threw = e.message; }
ok('storage down: the error goes up (a 500, so Dink retries)', threw === 'storage is unreachable', threw);
ok('and nothing was counted or left behind', store.size === before && (await evidence(team.Red)).length === 1);
res = await send('mate', loot('Mate Iron', ['Abyssal whip']), png(20));
ev = await evidence(team.Red);
ok('the retry then counts, once', res.outcome === 'submitted' && ev.length === 2 && ev[1].tile === 'Whip' && store.size === before + 1, J(res));

// A match that has gone stale by the time the tile is opened: the whip tile is
// complete now, but this answer still points at it.
const stale = {
  rpc: (fn, args) => fn === 'plugin_match'
    ? Promise.resolve({ account_ok: true, items: [{ name: 'Abyssal whip', verdict: 'one',
        matches: [{ game_id: g, tile_id: T.whip, tile: 'Whip', option_id: opt['Abyssal whip'], label: 'Abyssal whip' }] }] })
    : deps.rpc(fn, args),
};
before = store.size;
res = await send('mate', loot('Mate Iron', ['Abyssal whip']), png(21), stale);
ok('a rule saying no part-way: 200, refused, nothing stored',
   res.status === 200 && res.outcome === 'nothing_submitted' && /does not count/.test(res.results[0].refused ?? '')
   && store.size === before && (await evidence(team.Red)).length === 2, J(res));

// ------------------------------------------- another player, another spelling
// Barrows chest still wants Dharok's helm and so does Any helmet: still an ask,
// whoever on the team gets it and however the label spells it.
res = await send('red', loot('Red Main', ['Dharoks helm', 'Bones']), png(22));
ok('still an ask while two tiles want it', res.results[0].verdict === 'ask', J(res));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
