// A drop two open tiles want: the intake keeps it for an hour and anyone on
// the team chooses the tile on the site (Boris, 2026-11-21; draft 002,
// section 6c). Offline, on the replay of every migration plus the drafts,
// through intake/handle.mjs, with storage.objects standing in for the bucket.
//
// The Region Bingo board, threshold 50%:
//   Misthalin   Whips (Abyssal whip; worth 2)   Boots (Dragon boots; worth 2)
//   Asgarnia    Slayer drops (Abyssal whip, Granite maul; worth 2)
//   Kandarin    Kandarin whip (Abyssal whip; worth 2)
//   a filler in each of the other eight regions
//
// Red (Red Cap, Red Mate) picks Misthalin, completes it with the boots, and
// opens Asgarnia with the pick that pays. Blue (Blue Cap) picks Kandarin. A
// whip is then wanted by two of Red's tiles in two regions, and by a third
// that Red cannot see.
//
// Then a Bingo card for the same teams, with a whip on two tiles: for a drop
// two games want (not kept: one game at a time), and for Bingo on its own.
//
// And the cleanup (6d): the screenshots a waiting drop leaves behind are
// removed once it is handed in or its hour is up, and nothing else is.
//
//   node waiting.test.mjs

import { createHash, randomUUID } from 'node:crypto';
import { buildPeople, J } from './fixture.mjs';
import { handleDink, removeLeftovers } from '../intake/handle.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : '  -- ' + extra}`);
};

const { db, ids, tok, site, plugin, trying } = await buildPeople();
const as = (who) => site.bind(null, who);

// ------------------------------------------------------------- the boards
const newGame = async (name, mode) => {
  const id = (await site(ids.org,
    `select admin_new_game($1, $2, array['Red','Blue'], 3::smallint, now() + interval '1 day') id`, [name, mode]))[0].id;
  const teams = {};
  for (const r of (await db.query('select id, name from teams where game_id = $1', [id])).rows) teams[r.name] = r.id;
  await site(ids.org, `select admin_set_member($1, $2, 'captain')`, [teams.Red, ids.red]);
  await site(ids.org, `select admin_set_member($1, $2, 'member')`, [teams.Red, ids.mate]);
  await site(ids.org, `select admin_set_member($1, $2, 'captain')`, [teams.Blue, ids.blue]);
  // Dink is off until switched on (6e). The console only switches it on for
  // Region Bingo for now, so Bingo is switched on by hand.
  if (mode === 'regions') await site(ids.org, 'select admin_set_plugin_drops($1, true)', [id]);
  else await db.query('update games set plugin_drops = true where id = $1', [id]);
  return { id, teams };
};
const setTile = (game, row, col, spec) =>
  site(ids.org, 'select admin_set_tile($1, $2::smallint, $3::smallint, $4::jsonb) id', [game, row, col, J(spec)])
    .then((r) => r[0].id);
const one = (label) => ({ label, points: 1 });
// tile id -> label -> option id. Labels repeat across tiles here.
const optionsOf = async (game) => {
  const out = {};
  for (const r of (await db.query(
    'select o.id, o.label, o.tile_id from tile_options o join tiles t on t.id = o.tile_id where t.game_id = $1', [game])).rows) {
    (out[r.tile_id] ??= {})[r.label] = r.id;
  }
  return out;
};

const { id: g, teams: team } = await newGame('Waiting drops', 'regions');
const regionTile = async (square, worth, spec) => {
  const id = await setTile(g, Math.floor((square - 1) / 10) + 1, ((square - 1) % 10) + 1, spec);
  await site(ids.org, 'select admin_set_tile_worth($1, $2, $3)', [g, square, worth]);
  return id;
};
const T = {
  whips: await regionTile(1, 2, { name: 'Whips', rule: 'points', amount: 1, options: [one('Abyssal whip')] }),
  boots: await regionTile(2, 2, { name: 'Boots', rule: 'points', amount: 1, options: [one('Dragon boots')] }),
  slayer: await regionTile(101, 2, { name: 'Slayer drops', rule: 'points', amount: 1,
    options: [one('Abyssal whip'), one('Granite maul')] }),
  kandarin: await regionTile(201, 2, { name: 'Kandarin whip', rule: 'points', amount: 1, options: [one('Abyssal whip')] }),
};
for (let k = 4; k <= 11; k++) await regionTile((k - 1) * 100 + 1, 1, { name: `Filler ${k}` });
const opt = await optionsOf(g);
await site(ids.org, 'select start_game($1)', [g]);

const { id: gb, teams: teamB } = await newGame('Waiting bingo', 'bingo');
const TB = {
  whip: await setTile(gb, 1, 1, { name: 'Whip', rule: 'points', amount: 1, options: [one('Abyssal whip')] }),
  slayer: await setTile(gb, 1, 2, { name: 'Slayer', rule: 'points', amount: 1, options: [one('Abyssal whip'), one('Abyssal dagger')] }),
};
for (let i = 2; i < 9; i++) await setTile(gb, Math.floor(i / 3) + 1, (i % 3) + 1, { name: `Bingo filler ${i}` });
const optB = await optionsOf(gb);

// --------------------------------------------------------- the intake's deps
// As intake.test.mjs, except that a screenshot goes into storage.objects with
// the metadata Storage writes (its eTag is the MD5 of the bytes), because the
// site's choice is checked against it.
const md5 = (bytes) => createHash('md5').update(bytes).digest('hex');
const deps = {
  async rpc(fn, args) {
    if (!/^plugin_[a-z_]+$/.test(fn)) throw new Error('unexpected function ' + fn);
    const keys = Object.keys(args);
    const isJson = (v) => v !== null && typeof v === 'object';
    const isTexts = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string');
    const arg = (k, i) => (isTexts(args[k]) ? `array(select jsonb_array_elements_text($${i + 1}::jsonb))`
      : `$${i + 1}${isJson(args[k]) ? '::jsonb' : ''}`);
    const values = keys.map((k) => (isJson(args[k]) ? J(args[k]) : args[k]));
    // A function returning a table answers rows, as PostgREST does; anything
    // else answers its one value.
    if (fn === 'plugin_leftover_files') {
      return db.transaction(async (tx) => {
        await tx.query('set local role service_role');
        return (await tx.query(`select * from ${fn}(${keys.map((k, i) => `${k} => ${arg(k, i)}`).join(', ')})`, values)).rows;
      });
    }
    const sql = `select ${fn}(${keys.map((k, i) => `${k} => ${arg(k, i)}`).join(', ')}) j`;
    return (await plugin(sql, values)).j;
  },
  async upload(path, bytes, type) {
    await db.query(`insert into storage.objects (bucket_id, name, metadata) values ('evidence', $1, $2::jsonb)`,
      [path, J({ eTag: `"${md5(bytes)}"`, size: bytes.length, mimetype: type })]);
  },
  async remove(path) {
    await db.query(`delete from storage.objects where bucket_id = 'evidence' and name = $1`, [path]);
  },
  // What the cleanup asked Storage to remove, every time.
  removed: [],
  async removeAll(paths) {
    deps.removed.push([...paths]);
    if (deps.storageDown) throw new Error('Storage is down');
    await db.query(`delete from storage.objects where bucket_id = 'evidence'
                      and name in (select jsonb_array_elements_text($1::jsonb))`, [J(paths)]);
  },
};
const rsnOf = { red: 'Red Main', mate: 'Mate Iron', blue: 'Blue Main' };
const loot = (key, items) => ({
  content: '', type: 'LOOT', playerName: rsnOf[key], accountType: 'NORMAL', seasonalWorld: false,
  extra: { items: items.map((name, i) => ({ id: 4151 + i, quantity: 1, priceEach: 1500000, name })),
           source: 'Abyssal demon', category: 'NPC' },
  world: 302, regionId: 13648,
});
const png = (seed) => ({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, seed, seed >> 8]), type: 'image/png' });
const send = (key, items, seed) => handleDink({ token: tok[key], payloadText: J(loot(key, items)), image: png(seed) }, deps);

const objects = async (prefix) =>
  (await db.query(`select name, metadata from storage.objects where bucket_id = 'evidence' and name like $1 || '%' order by name`,
    [prefix])).rows;
const waitingRows = async () => (await db.query('select * from plugin_waiting order by received_at, id')).rows;
const claimOf = async (teamId, tileId) =>
  (await db.query('select id, status from tile_claims where team_id = $1 and tile_id = $2', [teamId, tileId])).rows[0];
const evidenceAt = async (path) =>
  (await db.query(`select e.*, c.tile_id from tile_evidence e join tile_claims c on c.id = e.claim_id
                    where e.storage_path = $1`, [path])).rows[0];

// The site, as WaitingDrops.jsx does it: open the tile, copy the screenshot
// to the place the database gives out, in the claim's folder, as the player
// (Storage's copy: the read policy on the source, the write policy on the
// copy), then hand it in.
const list = (who, game = g) => site(who, 'select * from waiting_drops($1)', [game]);
const open = (who, w, tile, option) => site(who, 'select waiting_drop_open($1, $2, $3) j', [w, tile, option]).then((r) => r[0].j);
const copy = (who, from, to) => site(who,
  `insert into storage.objects (bucket_id, name, owner, metadata)
   select 'evidence', $2, auth.uid(), o.metadata from storage.objects o
    where o.bucket_id = 'evidence' and o.name = $1
   returning name`, [from, to]);
const choose = (who, w, tile, option, path) =>
  site(who, 'select waiting_drop_choose($1, $2, $3, $4) j', [w, tile, option, path]).then((r) => r[0].j);
const handIn = async (who, w, tile, option) => {
  const o = await open(who, w, tile, option);
  const to = o.copy_path;
  await copy(who, o.from_path, to);
  return { o, to, res: await choose(who, w, tile, option, to) };
};

const NOWHERE = 'That drop cannot be handed in there';
const NOBODY = '00000000-0000-0000-0000-0000000000aa';
const msg = (m) => (m ?? '').replace(/^error: /i, '');

// -------------------------------------------------- the regions are opened
await site(ids.red, `select regions_pick($1, 'misthalin')`, [g]);
await site(ids.blue, `select regions_pick($1, 'kandarin')`, [g]);
let res = await send('mate', ['Dragon boots'], 1);
ok('the boots are wanted by one tile: handed in at once, as before',
   res.outcome === 'submitted' && (await claimOf(team.Red, T.boots))?.status === 'completed', J(res));
await site(ids.red, `select regions_pick($1, 'asgarnia')`, [g]);

const match = (await deps.rpc('plugin_match', { p_token: tok.mate, p_rsn: 'Mate Iron', p_items: [{ name: 'Abyssal whip' }] })).items[0];
ok('Misthalin complete, Asgarnia opened: a whip is now wanted by Whips and by Slayer drops',
   match.verdict === 'ask' && J(match.matches.map((m) => m.tile)) === J(['Whips', 'Slayer drops']), J(match));
ok('and never by the Kandarin tile, which only Blue has opened', !J(match).includes(T.kandarin));

// ------------------------------------------------------- the intake keeps it
const claimsBefore = (await db.query('select count(*)::int n from tile_claims')).rows[0].n;
const evidenceBefore = (await db.query('select count(*)::int n from tile_evidence')).rows[0].n;
res = await send('mate', ['Abyssal whip', 'Bones'], 2);
let rows = await waitingRows();
const A = rows[0];
ok("Dink's whip waits: outcome 'waiting', two tiles to choose from",
   res.status === 200 && res.outcome === 'waiting' && res.results[0].verdict === 'ask'
   && res.results[0].waiting === true && res.results[0].choices === 2 && res.results[1].verdict === 'none', J(res));
ok("its screenshot is kept in Red's own folder, under waiting/, where the row says",
   rows.length === 1 && A.storage_path.startsWith(`${g}/${team.Red}/waiting/`) && A.storage_path.endsWith('.png')
   && J((await objects(`${g}/${team.Red}/waiting/`)).map((o) => o.name)) === J([A.storage_path]), J(A));
ok('the row: the player who got it, both tiles, an hour to choose, what Dink reported',
   A.profile_id === ids.mate && A.team_id === team.Red && A.game_id === g && A.item === 'Abyssal whip'
   && J(A.choices.map((c) => c.tile_id).sort()) === J([T.whips, T.slayer].sort())
   && A.expires_at - A.received_at === 3600 * 1000 && A.chosen_at === null
   && A.detail.source === 'dink' && A.detail.world === 302 && A.detail.rsn === 'Mate Iron'
   && A.detail.quantity === 1 && A.detail.from === 'Abyssal demon' && !('dedupe' in A.detail), J(A));
ok('nothing is opened or handed in while it waits: no claim, no evidence',
   (await db.query('select count(*)::int n from tile_claims')).rows[0].n === claimsBefore
   && (await db.query('select count(*)::int n from tile_evidence')).rows[0].n === evidenceBefore);
const log = (await db.query(`select profile_id, source, tile_id, evidence_id from plugin_intake_log where result ->> 'waiting_id' = $1`,
  [A.id])).rows;
ok('the intake log has it once, as a drop that waits (no tile, no evidence yet)',
   log.length === 1 && log[0].profile_id === ids.mate && log[0].source === 'dink' && log[0].tile_id === null && log[0].evidence_id === null, J(log));

res = await send('mate', ['Abyssal whip', 'Bones'], 2);
ok("Dink's retry: known, kept once, its second copy not stored",
   res.outcome === 'nothing_submitted' && res.results[0].duplicate === true && res.results[0].waiting === false
   && (await waitingRows()).length === 1 && (await objects(`${g}/${team.Red}/waiting/`)).length === 1, J(res));

// Two more whips, for later: one to run out of time, one to go stale.
await send('red', ['Abyssal whip'], 3);
await send('mate', ['Abyssal whip'], 4);
rows = await waitingRows();
const B = rows[1], C = rows[2];
ok('two more whips wait beside it, one of them Red Cap\'s', rows.length === 3 && B.profile_id === ids.red && C.profile_id === ids.mate);

// ------------------------------------------------------------- who sees it
let seen = await list(ids.mate);
const a = seen.find((r) => r.id === A.id);
ok('Red Mate sees the three, oldest first, each with its two tiles in board order',
   seen.length === 3 && seen[0].id === A.id
   && J(a.choices.map((c) => [c.tile, c.region, c.label])) === J([['Whips', 'misthalin', 'Abyssal whip'], ['Slayer drops', 'asgarnia', 'Abyssal whip']])
   && a.dropped_by === 'Red Mate' && a.item === 'Abyssal whip' && a.storage_path === A.storage_path && a.detail.world === 302, J(seen));
ok('and so does Red Cap: anyone on the team', J((await list(ids.red)).map((r) => r.id)) === J(seen.map((r) => r.id)));
ok('never the Kandarin tile, which Red has not opened', !J(seen).includes(T.kandarin) && !/kandarin/i.test(J(seen)));
for (const [name, who] of [['Blue', ids.blue], ['someone on no team', ids.out], ['the organiser, not acting for a team', ids.org]]) {
  ok(`${name} sees none of them`, (await list(who)).length === 0);
}
ok('the table itself is shut to the site',
   /permission denied/.test(await trying(as(ids.mate), 'select * from plugin_waiting') ?? ''));
const readAs = async (who, path) => (await site(who, `select name from storage.objects where name = $1`, [path])).length;
ok("Red's screenshot is readable by Red, not by Blue",
   (await readAs(ids.red, A.storage_path)) === 1 && (await readAs(ids.blue, A.storage_path)) === 0);

// ----------------------------------- the same answer for nothing at all (the second secret)
const openMsg = (who, w, tile, option) => trying(as(who), 'select waiting_drop_open($1, $2, $3)', [w, tile, option]).then(msg);
const chooseMsg = (who, w, tile, option, path) =>
  trying(as(who), 'select waiting_drop_choose($1, $2, $3, $4)', [w, tile, option, path]).then(msg);
const nothing = await openMsg(ids.blue, NOBODY, T.whips, opt[T.whips]['Abyssal whip']);
ok('a drop that does not exist: "cannot be handed in there"', nothing === NOWHERE, nothing);
ok("Blue with Red's drop gets those same words, opening or choosing",
   (await openMsg(ids.blue, A.id, T.whips, opt[T.whips]['Abyssal whip'])) === nothing
   && (await chooseMsg(ids.blue, A.id, T.whips, opt[T.whips]['Abyssal whip'], A.storage_path)) === nothing);
ok('and so does someone on no team', (await openMsg(ids.out, A.id, T.whips, opt[T.whips]['Abyssal whip'])) === nothing);
const locked = await openMsg(ids.mate, A.id, T.kandarin, opt[T.kandarin]['Abyssal whip']);
ok("Red choosing the Kandarin tile: the words a tile that does not exist gets",
   locked === nothing && (await openMsg(ids.mate, A.id, NOBODY, NOBODY)) === nothing, locked);
ok('a tile that was not a choice, or another option on a choice, the same',
   (await openMsg(ids.mate, A.id, T.boots, opt[T.boots]['Dragon boots'])) === nothing
   && (await openMsg(ids.mate, A.id, T.slayer, opt[T.slayer]['Granite maul'])) === nothing);
ok('no claim was opened by any of that',
   (await claimOf(team.Red, T.whips)) === undefined && (await claimOf(team.Red, T.slayer)) === undefined
   && (await claimOf(team.Red, T.kandarin)) === undefined);
ok("Blue cannot copy Red's screenshot into its own folder: Blue cannot read it",
   (await copy(ids.blue, A.storage_path, `${g}/${team.Blue}/x/${randomUUID()}.png`)).length === 0);

// ------------------------------------------------------------ an hour is up
await db.query(`update plugin_waiting set received_at = received_at - interval '61 minutes',
                expires_at = expires_at - interval '61 minutes' where id = $1`, [C.id]);
ok('after an hour it is not listed any more', !(await list(ids.mate)).some((r) => r.id === C.id));
const late = await openMsg(ids.mate, C.id, T.whips, opt[T.whips]['Abyssal whip']);
ok('and is refused: it no longer counts', late === 'That drop waited more than an hour, so it no longer counts', late);
ok("for Blue, an expired drop of Red's still reads as nothing at all",
   (await openMsg(ids.blue, C.id, T.whips, opt[T.whips]['Abyssal whip'])) === nothing);

// ------------------------------------------------------------- choosing
const oA = await open(ids.red, A.id, T.whips, opt[T.whips]['Abyssal whip']);
const claimA = await claimOf(team.Red, T.whips);
ok('Red Cap chooses Whips: the tile is opened, as the first screenshot on the site opens it',
   oA.claim_id === claimA?.id && oA.from_path === A.storage_path && oA.path_prefix === `${g}/${team.Red}/${claimA.id}/`, J(oA));
ok('and the database says where the copy goes: in that folder, a new name, the type Dink sent',
   /^[0-9a-f-]{36}\.png$/.test(oA.copy_path?.slice(oA.path_prefix.length) ?? '') && oA.copy_path.startsWith(oA.path_prefix), J(oA));
const oA2 = await open(ids.red, A.id, T.whips, opt[T.whips]['Abyssal whip']);
ok('opening it twice is harmless: the same claim, another place for the copy',
   oA2.claim_id === claimA.id && oA2.copy_path !== oA.copy_path);
const givenOut = async () => (await db.query('select storage_path from plugin_waiting_copies where waiting_id = $1',
  [A.id])).rows.map((r) => r.storage_path).sort();
ok('both places are written down for the cleanup', J(await givenOut()) === J([oA.copy_path, oA2.copy_path].sort()));

const NOT_DINKS = 'That is not the screenshot Dink sent for this drop';
const forged = oA.copy_path;
await site(ids.red, `insert into storage.objects (bucket_id, name, owner, metadata) values ('evidence', $1, auth.uid(), $2::jsonb)`,
  [forged, J({ eTag: `"${md5(new Uint8Array([1, 2, 3, 4, 5, 6]))}"`, size: 6, mimetype: 'image/png' })]);
let m = await chooseMsg(ids.red, A.id, T.whips, opt[T.whips]['Abyssal whip'], forged);
ok("a picture of Red Cap's own, put where the copy should go, is refused", m === NOT_DINKS, m);
m = await chooseMsg(ids.red, A.id, T.whips, opt[T.whips]['Abyssal whip'], A.storage_path);
ok('so is the waiting file itself (it is not in the claim\'s folder)', m === NOT_DINKS, m);
const bootsClaim = (await claimOf(team.Red, T.boots)).id;
const elsewhere = `${g}/${team.Red}/${bootsClaim}/${randomUUID()}.png`;
await copy(ids.red, A.storage_path, elsewhere);
m = await chooseMsg(ids.red, A.id, T.whips, opt[T.whips]['Abyssal whip'], elsewhere);
ok("and Dink's own picture copied into another tile's folder", m === NOT_DINKS, m);
m = await chooseMsg(ids.red, A.id, T.whips, opt[T.whips]['Abyssal whip'], oA2.copy_path);
ok('and a place given out where nothing was ever copied', m === NOT_DINKS, m);
const unlisted = `${oA.path_prefix}${randomUUID()}.png`;
await copy(ids.red, A.storage_path, unlisted);
m = await chooseMsg(ids.red, A.id, T.whips, opt[T.whips]['Abyssal whip'], unlisted);
ok("and Dink's own picture in the right folder, at a place the database never gave out", m === NOT_DINKS, m);
ok('none of that handed anything in', (await db.query('select count(*)::int n from tile_evidence where claim_id = $1', [claimA.id])).rows[0].n === 0);

const oA3 = await open(ids.red, A.id, T.whips, opt[T.whips]['Abyssal whip']);
const realCopy = oA3.copy_path;
ok("the real copy: Red Cap may read Dink's file and write into the claim's folder",
   (await copy(ids.red, A.storage_path, realCopy)).length === 1);
// One transaction, to see what the caller is afterwards.
const after = await db.transaction(async (tx) => {
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [J({ sub: ids.red, role: 'authenticated' })]);
  await tx.query('set local role authenticated');
  const r = (await tx.query('select waiting_drop_choose($1, $2, $3, $4) j',
    [A.id, T.whips, opt[T.whips]['Abyssal whip'], realCopy])).rows[0].j;
  const s = (await tx.query(`select auth.uid() uid, current_setting('hs.evidence_source', true) src,
                                    current_setting('request.headers', true) hdr`)).rows[0];
  return { r, s };
});
const evA = await evidenceAt(realCopy);
ok('handed in: Whips completes', after.r && (await claimOf(team.Red, T.whips)).status === 'completed', J(after.r));
ok("the evidence is Red Mate's, who got the drop, 'dink', with what Dink reported",
   evA?.uploaded_by === ids.mate && evA.source === 'dink' && evA.tile_id === T.whips
   && evA.detail.item === 'Abyssal whip' && evA.detail.world === 302 && !('dedupe' in evA.detail), J(evA));
ok('and says who chose, and when the drop arrived',
   evA.detail.waited?.chosen_by === 'Red Cap' && new Date(evA.detail.waited.arrived_at).getTime() === A.received_at.getTime(),
   J(evA.detail.waited));
ok('afterwards the caller is Red Cap again, and no source is left set',
   after.s.uid === ids.red && !after.s.src, J(after.s));
const doneA = (await waitingRows()).find((r) => r.id === A.id);
ok('the waiting row says it was chosen, by whom, which evidence it became, and its file',
   doneA.chosen_at !== null && doneA.chosen_by === ids.red && doneA.evidence_id === evA.id && doneA.chosen_path === realCopy,
   J(doneA));
ok('it is no longer listed', !(await list(ids.mate)).some((r) => r.id === A.id));
m = await chooseMsg(ids.mate, A.id, T.slayer, opt[T.slayer]['Abyssal whip'], realCopy);
ok('choosing it a second time: already handed in', m === 'That drop has already been handed in', m);
ok('for Blue, a handed-in drop of Red\'s still reads as nothing at all',
   (await openMsg(ids.blue, A.id, T.whips, opt[T.whips]['Abyssal whip'])) === nothing);

// --------------------------------------------- a choice that stopped being one
seen = (await list(ids.mate)).find((r) => r.id === B.id);
ok("Whips is full now: Red Cap's whip can only go to Slayer drops",
   J(seen?.choices.map((c) => c.tile)) === J(['Slayer drops']), J(seen));
m = await openMsg(ids.mate, B.id, T.whips, opt[T.whips]['Abyssal whip']);
ok('and choosing Whips for it is refused', m === NOWHERE, m);

// ------------------------------------------- screenshots nobody needs (6d)
// Now: A was handed in (its waiting file, the forged picture and the empty
// place are not needed; the chosen copy is the evidence). B still waits. C
// ran out of time a minute ago. `unlisted` and `elsewhere` were never given
// out by the database, so the cleanup does not know them.
const exists = async (path) => (await db.query(`select 1 from storage.objects where name = $1`, [path])).rows.length === 1;
const leftovers = async () => (await deps.rpc('plugin_leftover_files', { p_limit: 100 })).map((r) => r.storage_path).sort();
const dueNow = [A.storage_path, oA.copy_path, oA2.copy_path].sort();
ok('the leftovers of the handed-in drop: its waiting file, the forged picture and the empty place',
   J(await leftovers()) === J(dueNow), J(await leftovers()));
ok('never the copy that was handed in, nor the drop still waiting',
   !(await leftovers()).includes(realCopy) && !(await leftovers()).includes(B.storage_path));
ok('a drop whose hour ran out a minute ago is kept for five more, so a last-second choice reads "waited more than an hour"',
   !(await leftovers()).includes(C.storage_path));
await db.query(`update plugin_waiting set expires_at = expires_at - interval '5 minutes' where id = $1`, [C.id]);
ok('after that it is a leftover too', (await leftovers()).includes(C.storage_path));

deps.storageDown = true;
let cleanErr = null;
try { await removeLeftovers(deps); } catch (e) { cleanErr = e.message; }
ok('Storage down: the cleanup fails, and nothing is marked removed',
   cleanErr === 'Storage is down' && J(await leftovers()) === J([...dueNow, C.storage_path].sort())
   && (await exists(A.storage_path)) && (await exists(C.storage_path)), cleanErr);
deps.storageDown = false;
deps.removed.length = 0;
const cleaned = await removeLeftovers(deps);
ok('next time: all four are removed, through Storage, in one call',
   cleaned === 4 && deps.removed.length === 1 && J([...deps.removed[0]].sort()) === J([...dueNow, C.storage_path].sort()),
   J([cleaned, deps.removed]));
ok("gone from the bucket; Dink's copy, now the evidence, is still there",
   !(await exists(A.storage_path)) && !(await exists(oA.copy_path)) && !(await exists(C.storage_path))
   && (await exists(realCopy)) && (await evidenceAt(realCopy))?.id === evA.id);
ok('the drop still waiting keeps its file, and the files never given out are not touched',
   (await exists(B.storage_path)) && (await exists(unlisted)) && (await exists(elsewhere)));
ok('nothing left to remove; asked again, nothing is', (await leftovers()).length === 0 && (await removeLeftovers(deps)) === 0);
const marked = (await db.query(`select (select count(*)::int from plugin_waiting where file_removed_at is not null) w,
                                        (select count(*)::int from plugin_waiting_copies where removed_at is not null) c`)).rows[0];
ok('the database marks what was removed: two waiting files, two places', marked.w === 2 && marked.c === 2, J(marked));
ok('marking a file that is not a leftover changes nothing',
   (await deps.rpc('plugin_leftovers_removed', { p_paths: [realCopy, B.storage_path, unlisted] })) === 0
   && (await waitingRows()).find((r) => r.id === B.id).file_removed_at === null);
ok('removing them changed nothing else: A is still handed in, B still waits',
   (await claimOf(team.Red, T.whips)).status === 'completed' && (await list(ids.mate)).some((r) => r.id === B.id));

// ---------------------------------------------------- two games want a drop
await site(ids.org, 'select start_game($1)', [gb]);
const both = (await deps.rpc('plugin_match', { p_token: tok.mate, p_rsn: 'Mate Iron', p_items: [{ name: 'Abyssal whip' }] })).items[0];
const waitingFiles = (await objects(`${g}/${team.Red}/waiting/`)).length;
const rowsBefore = (await waitingRows()).length;
res = await send('mate', ['Abyssal whip'], 5);
ok('with the Bingo card started too, a whip is wanted in two games: not kept (one game at a time)',
   both.verdict === 'ask' && new Set(both.matches.map((x) => x.game_id)).size === 2
   && res.outcome === 'nothing_submitted' && res.results[0].waiting === false && /does not count/.test(res.results[0].refused ?? '')
   && (await waitingRows()).length === rowsBefore && (await objects(`${g}/${team.Red}/waiting/`)).length === waitingFiles
   && (await objects(`${gb}/`)).length === 0, J(res));

// -------------------------------------------------------- the game's own rules
await db.query(`update games set ends_at = now() - interval '1 minute' where id = $1`, [g]);
let lateChoice = null;
try { await handIn(ids.red, B.id, T.slayer, opt[T.slayer]['Abyssal whip']); } catch (e) { lateChoice = msg(e.message); }
ok("after the game's time is up, the choice is refused by the game's own rule",
   lateChoice !== null && ![NOWHERE, NOT_DINKS, 'That drop has already been handed in'].includes(lateChoice)
   && !/waited more than an hour/.test(lateChoice), lateChoice);
await site(ids.org, 'select admin_end_game($1)', [g]);
ok('once the game has ended, its waiting drop is not listed', (await list(ids.red)).length === 0);

// ------------------------------------------------------------- Bingo alone
res = await send('mate', ['Abyssal whip'], 6);
const Bg = (await waitingRows()).find((r) => r.game_id === gb);
ok('a Bingo card with a whip on two tiles: it waits too',
   res.outcome === 'waiting' && Bg && Bg.storage_path.startsWith(`${gb}/${teamB.Red}/waiting/`), J(res));
seen = await list(ids.red, gb);
ok('listed for Red in the Bingo game, with no region',
   seen.length === 1 && J(seen[0].choices.map((c) => [c.tile, c.region])) === J([['Whip', null], ['Slayer', null]]), J(seen));
ok('and not for Blue', (await list(ids.blue, gb)).length === 0);
const { to: bingoCopy } = await handIn(ids.mate, Bg.id, TB.slayer, optB[TB.slayer]['Abyssal whip']);
const evB = await evidenceAt(bingoCopy);
ok('Red Mate chooses Slayer: handed in there, as Dink would have',
   evB?.tile_id === TB.slayer && evB.uploaded_by === ids.mate && evB.source === 'dink'
   && evB.detail.waited?.chosen_by === 'Red Mate' && (await claimOf(teamB.Red, TB.slayer)).status === 'completed', J(evB));
ok('the Whip tile still wants a whip', (await claimOf(teamB.Red, TB.whip)) === undefined);

// ------------------------------------------------------------ the fences
const can = async (fn) => (await db.query(`
  select r.rolname from pg_roles r
   where r.rolname in ('anon', 'authenticated', 'service_role')
     and has_function_privilege(r.rolname, $1, 'execute') order by 1`, [fn])).rows.map((x) => x.rolname);
ok('the intake may call plugin_wait_open and plugin_wait; the site may not',
   J(await can('plugin_wait_open(text, text, text)')) === J(['service_role'])
   && J(await can('plugin_wait(text, text, text, text, jsonb)')) === J(['service_role']));
ok('the site may call the three waiting_drop functions; anon and the intake may not',
   J(await can('waiting_drops(uuid)')) === J(['authenticated'])
   && J(await can('waiting_drop_open(uuid, uuid, uuid)')) === J(['authenticated'])
   && J(await can('waiting_drop_choose(uuid, uuid, uuid, text)')) === J(['authenticated']));
ok('the three internal ones: nobody',
   (await can('plugin_wait_choices(text)')).length === 0 && (await can('waiting_drop_check(uuid, uuid, uuid)')).length === 0
   && (await can('plugin_leftovers()')).length === 0);
ok('the cleanup: the intake only',
   J(await can('plugin_leftover_files(integer)')) === J(['service_role'])
   && J(await can('plugin_leftovers_removed(text[])')) === J(['service_role']));
ok('the table of copies is shut to the site, like the waiting table',
   /permission denied/.test(await trying(as(ids.mate), 'select * from plugin_waiting_copies') ?? ''));
const direct = await trying(as(ids.mate), 'select plugin_wait($1, $2, $3, $4, $5::jsonb)',
  [tok.mate, 'Mate Iron', 'Abyssal whip', `${gb}/${teamB.Red}/waiting/x.png`, J({ dedupe: 'by-hand-0001' })]);
ok('a signed-in player cannot call the intake\'s function directly', /permission denied/.test(direct ?? ''), direct);
// No second copy of a game rule: tiles are opened and evidence handed in only
// through the site's own functions, and nothing here spends a pick.
const copies = (await db.query(`
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname like 'waiting\\_%' or p.proname like 'plugin\\_wait%')
     and (p.prosrc ilike '%insert into tile_claims%' or p.prosrc ilike '%insert into tile_evidence%'
          or p.prosrc ilike '%ends_at%' or p.prosrc ilike '%region_unlocks%' or p.prosrc ilike '%regions_pick%')`)).rows;
ok('no waiting function opens a tile, writes evidence, reads the time or spends a pick itself', copies.length === 0, J(copies));

console.log('     (the time-up refusal: ' + lateChoice + ')');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
