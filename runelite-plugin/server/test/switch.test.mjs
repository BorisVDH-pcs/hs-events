// Dink on or off, per game (Boris, 2026-11-21; draft 002, section 6e).
//
// A switch on each game in the admin console: off until an organiser turns
// it on, Region Bingo only for now, and changeable while the game runs.
// Uploading on the site works either way. Offline, on the replay of every
// migration plus the drafts, through intake/handle.mjs.
//
// The fixture's Region Bingo, built with Dink left off:
//   Misthalin: Barrows chest (Dharok's helm, Karil's coif; needs 2),
//              Any helmet (Dharoks helm), Whip (Abyssal whip)
//   Asgarnia:  Locked secret tile (Dragon pickaxe)
//
//   node switch.test.mjs

import { createHash } from 'node:crypto';
import { buildGame, J } from './fixture.mjs';
import { handleDink } from '../intake/handle.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : '  -- ' + extra}`);
};

const { db, ids, tok, site, plugin, trying, g, team, T, opt } = await buildGame({ dink: false });
const as = (who) => site.bind(null, who);
const msg = (m) => (m ?? '').replace(/^error: /i, '');

// The intake's deps, as in waiting.test.mjs.
const md5 = (bytes) => createHash('md5').update(bytes).digest('hex');
const deps = {
  async rpc(fn, args) {
    const keys = Object.keys(args);
    const isJson = (v) => v !== null && typeof v === 'object';
    const sql = `select ${fn}(${keys.map((k, i) => `${k} => $${i + 1}${isJson(args[k]) ? '::jsonb' : ''}`).join(', ')}) j`;
    return (await plugin(sql, keys.map((k) => (isJson(args[k]) ? J(args[k]) : args[k])))).j;
  },
  async upload(path, bytes, type) {
    await db.query(`insert into storage.objects (bucket_id, name, metadata) values ('evidence', $1, $2::jsonb)`,
      [path, J({ eTag: `"${md5(bytes)}"`, size: bytes.length, mimetype: type })]);
  },
  async remove(path) {
    await db.query(`delete from storage.objects where bucket_id = 'evidence' and name = $1`, [path]);
  },
};
const loot = (items) => ({
  content: '', type: 'LOOT', playerName: 'Mate Iron', accountType: 'NORMAL', seasonalWorld: false,
  extra: { items: items.map((name, i) => ({ id: 4716 + i, quantity: 1, priceEach: 1000000, name })),
           source: 'Dharok the Wretched', category: 'EVENT' },
  world: 302, regionId: 14131,
});
let seed = 0;
const send = (items) => handleDink({
  token: tok.mate, payloadText: J(loot(items)),
  image: { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, ++seed]), type: 'image/png' },
}, deps);
const match = async (item) =>
  (await deps.rpc('plugin_match', { p_token: tok.mate, p_rsn: 'Mate Iron', p_items: [{ name: item }] })).items[0];
const filesOf = async () => (await db.query(`select count(*)::int n from storage.objects where name like $1 || '%'`, [g])).rows[0].n;
const evidence = async () => (await db.query(
  `select e.source, c.tile_id from tile_evidence e join tile_claims c on c.id = e.claim_id
    join tiles t on t.id = c.tile_id where t.game_id = $1 order by e.created_at`,
  [g])).rows;
const dinkOn = async (game = g) => (await db.query('select plugin_drops from games where id = $1', [game])).rows[0].plugin_drops;
const setDink = (who, on, game = g) => site(who, 'select admin_set_plugin_drops($1, $2) j', [game, on]).then((r) => r[0].j);
const setDinkMsg = (who, on, game = g) => trying(as(who), 'select admin_set_plugin_drops($1, $2)', [game, on]).then(msg);
const NOT_COUNTED = 'That drop does not count for an open tile';

await site(ids.red, `select regions_pick($1, 'misthalin')`, [g]);

// ------------------------------------------------------------ off by default
const fresh = (await site(ids.org,
  `select admin_new_game('Another one', 'regions', array['A','B'], 3::smallint, now() + interval '1 day') id`))[0].id;
ok('a new game starts with Dink off', (await dinkOn(fresh)) === false && (await dinkOn()) === false);

// ------------------------------------------------------- off: nothing counts
// The answer names the item it was asked about; everything else must be the same.
const shape = ({ name, ...rest }) => J(rest);
const junk = await match('Coins');
const locked = await match('Dragon pickaxe');
const whipOff = await match('Abyssal whip');
ok("off: a drop an open tile wants gets the answer junk gets, word for word",
   whipOff.verdict === 'none' && shape(whipOff) === shape(junk), J([whipOff, junk]));
ok("and the answer a locked tile's drop gets: the game gives nothing away", shape(locked) === shape(junk), J(locked));
let res = await send(['Abyssal whip']);
ok('off: Dink is answered 200, and nothing is stored or handed in',
   res.status === 200 && res.outcome === 'nothing_submitted' && (await filesOf()) === 0 && (await evidence()).length === 0, J(res));
const openOff = msg(await trying(plugin, 'select plugin_open($1, $2, $3, $4, $5)',
  [tok.mate, 'Mate Iron', T.whip, opt['Abyssal whip'], 'Abyssal whip']));
const openLocked = msg(await trying(plugin, 'select plugin_open($1, $2, $3, $4, $5)',
  [tok.mate, 'Mate Iron', T.locked, opt['Dragon pickaxe'], 'Dragon pickaxe']));
ok("off: asked for the tile by id, the same refusal as a locked tile's", openOff === NOT_COUNTED && openLocked === openOff, openOff);
res = await send(["Dharok's helm"]);
ok('off: a drop two tiles want does not wait',
   res.outcome === 'nothing_submitted' && (await db.query('select count(*)::int n from plugin_waiting')).rows[0].n === 0, J(res));

// ------------------------------------------------ uploading on the site, off
const cWhip = (await site(ids.red, 'select regions_open_tile($1) c', [T.whip]))[0].c;
const sitePath = `${g}/${team.Red}/${cWhip}/site.webp`;
await site(ids.red, `insert into storage.objects (bucket_id, name, owner, metadata) values ('evidence', $1, auth.uid(), '{}'::jsonb)`,
  [sitePath]);
await site(ids.red, 'select add_evidence($1, $2, null, $3, null)', [cWhip, sitePath, opt['Abyssal whip']]);
let ev = await evidence();
ok('off: an upload on the site works as it always did, and completes the tile',
   ev.length === 1 && ev[0].source === 'web' && ev[0].tile_id === T.whip
   && (await db.query('select status from tile_claims where id = $1', [cWhip])).rows[0].status === 'completed', J(ev));

// ---------------------------------------------------------- who may switch
ok('a player cannot switch it, not even a captain', (await setDinkMsg(ids.red, true)) === 'Not your game');
ok('nor someone on no team', (await setDinkMsg(ids.out, true)) === 'Not your game');
await site(ids.org, `select admin_set_moderator_modes($1, array['bingo']::game_mode[])`, [ids.out]);
ok("nor a moderator of another mode", (await setDinkMsg(ids.out, true)) === 'Not your game');
ok('still off after all that', (await dinkOn()) === false);
ok('the organiser must say on or off', (await setDinkMsg(ids.org, null)) === 'Say on or off');

// ------------------------------------------------------------------ on
ok('the organiser switches it on', (await setDink(ids.org, true)) === true && (await dinkOn()) === true);
const coifOn = await match("Karil's coif");
ok('on: the drops of the open tiles are wanted', coifOn.verdict === 'one', J(coifOn));
ok("and a locked tile's drop still gets the junk answer", shape(await match('Dragon pickaxe')) === shape(junk));
res = await send(["Karil's coif"]);
ev = await evidence();
ok('on: a drop one tile wants is handed in by Dink',
   res.outcome === 'submitted' && ev.length === 2 && ev[1].source === 'dink' && ev[1].tile_id === T.barrows, J(res));
res = await send(["Dharok's helm"]);
const waiting = (await site(ids.red, 'select * from waiting_drops($1)', [g]));
ok('on: a drop two tiles want waits for the team', res.outcome === 'waiting' && waiting.length === 1, J(res));

// -------------------------------------------------------- off again, mid-game
await site(ids.org, `select admin_set_moderator_modes($1, array['regions']::game_mode[])`, [ids.out]);
ok("a moderator of Region Bingo may switch it too: off, mid-game",
   (await setDink(ids.out, false)) === false && (await dinkOn()) === false);
ok('off: the waiting drop is no longer offered', (await site(ids.red, 'select * from waiting_drops($1)', [g])).length === 0);
const helmOpts = (await db.query(`select o.id from tile_options o where o.tile_id = $1`, [T.helmet])).rows;
const openWaiting = msg(await trying(as(ids.red), 'select waiting_drop_open($1, $2, $3)', [waiting[0].id, T.helmet, helmOpts[0].id]));
ok('and choosing a tile for it is refused, as for a tile that is no choice', openWaiting === 'That drop cannot be handed in there', openWaiting);
const before = (await evidence()).length;
res = await send(["Karil's coif"]);
ok('off: a drop the open tile wants is not handed in',
   res.outcome === 'nothing_submitted' && (await evidence()).length === before, J(res));
const cHelm = (await site(ids.red, 'select regions_open_tile($1) c', [T.helmet]))[0].c;
const helmPath = `${g}/${team.Red}/${cHelm}/site.webp`;
await site(ids.red, `insert into storage.objects (bucket_id, name, owner, metadata) values ('evidence', $1, auth.uid(), '{}'::jsonb)`,
  [helmPath]);
await site(ids.red, 'select add_evidence($1, $2, null, $3, null)', [cHelm, helmPath, helmOpts[0].id]);
ok('off again: the site still takes the upload', (await evidence()).length === before + 1 && (await evidence()).at(-1).source === 'web');

ok('on again: the drop that waited is back, its hour not yet up',
   (await setDink(ids.org, true)) === true
   && (await site(ids.red, 'select * from waiting_drops($1)', [g])).some((w) => w.id === waiting[0].id
     && J(w.choices.map((c) => c.tile)) === J(['Barrows chest'])));

// -------------------------------------------------- Region Bingo only, for now
const gb = (await site(ids.org,
  `select admin_new_game('A bingo', 'bingo', array['A','B'], 3::smallint, now() + interval '1 day') id`))[0].id;
ok('Bingo cannot be switched on from the console yet',
   (await setDinkMsg(ids.org, true, gb)) === 'Drops from Dink are for Region Bingo only, for now' && (await dinkOn(gb)) === false);
ok('switching it off works in any mode', (await setDink(ids.org, false, gb)) === false);

// ------------------------------------------------------------- the fences
const can = async (fn) => (await db.query(`
  select r.rolname from pg_roles r
   where r.rolname in ('anon', 'authenticated', 'service_role')
     and has_function_privilege(r.rolname, $1, 'execute') order by 1`, [fn])).rows.map((x) => x.rolname);
ok('only a signed-in caller may ask; the function itself refuses everyone but organisers and moderators',
   J(await can('admin_set_plugin_drops(uuid, boolean)')) === J(['authenticated']));
const rules = (await db.query(`select prosrc from pg_proc where proname = 'add_evidence'`)).rows.map((r) => r.prosrc).join('');
ok('add_evidence, the site\'s way in, does not read the switch', rules.length > 0 && !/plugin_drops/.test(rules));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
