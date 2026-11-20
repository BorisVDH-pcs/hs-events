// The Dink route, end to end and offline: a notification as Dink documents it
// goes through intake/handle.mjs, whose database is the replay of every
// migration plus the plugin drafts, and whose storage is a Map.
//
// What this does not cover: intake/index.ts (the Deno shell that reads the
// HTTP request), and a message from a real Dink client.
//
//   node intake.test.mjs

import { buildGame, J } from './fixture.mjs';
import { dedupeKey, parseDink } from '../intake/dink.mjs';
import { handleDink, MAX_BYTES } from '../intake/handle.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : '  -- ' + extra}`);
};

// A loot notification in the shape of Dink's docs/json-examples.md.
const loot = (rsn, items, more = {}) => ({
  content: `${rsn} has looted: ...`,
  extra: {
    items: items.map((name, i) => ({ id: 4000 + i, quantity: 1, priceEach: 42069, name, criteria: ['VALUE'], rarity: null })),
    source: 'Abyssal demon', category: 'NPC', killCount: 60, npcId: 415,
  },
  type: 'LOOT', playerName: rsn, accountType: 'NORMAL', dinkAccountHash: 'abc123', embeds: [],
  world: 302, regionId: 12850,
  ...more,
});
const png = (seed) => ({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, seed, seed >> 8]), type: 'image/png' });

// ------------------------------------------------------------- the parser
let p = parseDink(loot('Mate Iron', ['Abyssal whip', 'Bones']));
ok('a loot notification parses',
   p.ok && p.rsn === 'Mate Iron' && p.items.length === 2 && p.items[0].name === 'Abyssal whip'
   && p.items[0].id === 4000 && p.items[0].priceEach === 42069 && p.from === 'Abyssal demon'
   && p.category === 'NPC' && p.world === 302 && p.regionId === 12850, J(p));
p = parseDink({ type: 'COLLECTION', playerName: 'A', extra: { itemName: 'Zamorak chaps', itemId: 10372, price: 500 } });
ok('a collection log slot is one item', p.ok && p.items.length === 1 && p.items[0].name === 'Zamorak chaps' && p.items[0].id === 10372, J(p));
p = parseDink({ type: 'PET', playerName: 'A', extra: { petName: 'Ikkle hydra' } });
ok('a pet is one item', p.ok && p.items[0].name === 'Ikkle hydra' && p.items[0].quantity === 1, J(p));
p = parseDink({ type: 'CLUE', playerName: 'A', extra: { clueType: 'Hard', items: [{ id: 1, quantity: 2, priceEach: 5, name: 'Ranger boots' }] } });
ok('a clue reward lists its items', p.ok && p.items[0].name === 'Ranger boots' && p.items[0].quantity === 2, J(p));
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
let res = await send('mate', loot('Mate Iron', ["Karil's coif", 'Bones']), png(10));
let ev = await evidence(team.Red);
ok('a wanted drop is handed in', res.status === 200 && res.outcome === 'submitted' && ev.length === 1 && ev[0].tile === 'Barrows chest', J(res));
ok("with source 'dink' and what Dink reported",
   ev[0].source === 'dink' && ev[0].detail.item === "Karil's coif" && ev[0].detail.from === 'Abyssal demon'
   && ev[0].detail.world === 302 && ev[0].detail.rsn === 'Mate Iron' && ev[0].uploaded_by === ids.mate, J(ev[0].detail));
ok('its screenshot is stored once, under the claim, where the row says',
   store.size === 1 && store.has(ev[0].storage_path)
   && ev[0].storage_path.startsWith(`${g}/${team.Red}/${ev[0].claim_id}/`) && ev[0].storage_path.endsWith('.png'), ev[0].storage_path);
ok('the junk beside it was not', res.results.find((r) => r.item === 'Bones').verdict === 'none');

res = await send('mate', loot('Mate Iron', ["Karil's coif", 'Bones']), png(10));
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

res = await send('blue', loot('Blue Main', ['Dragon pickaxe']), png(14));
ok("the same drop counts for Blue, who has opened that region",
   res.outcome === 'submitted' && (await evidence(team.Blue)).length === 1 && (await evidence(team.Red)).length === 1, J(res));

before = store.size;
for (const [name, run, want] of [
  ['no screenshot', () => send('mate', loot('Mate Iron', ['Abyssal whip']), null), 'no_screenshot'],
  ['a screenshot over the bucket limit', () => send('mate', loot('Mate Iron', ['Abyssal whip']), { bytes: new Uint8Array(MAX_BYTES + 1), type: 'image/png' }), 'screenshot_too_large'],
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
