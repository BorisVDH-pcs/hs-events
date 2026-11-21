// The plugin migrations (plugin_tokens.sql, plugin_drops.sql) against the real Bingo rules, with a Region
// Bingo game running at the same time: every migration in supabase/migrations
// is replayed into PGlite first, so tiles_for_team, bingo_open_tile,
// regions_open_tile and add_evidence here are the real ones.
//
// Built and called the way regions.test.mjs is: "the site" is a signed-in
// player calling what the site calls, and a plugin call is the service role
// with a token, one transaction per call, as the intake Edge Function makes it.
//
//   node bingo.test.mjs

import { buildGame, addBingo, J } from './fixture.mjs';

const fx = await buildGame();
const { db, ids, g, team, T, opt, tok, site, plugin, trying } = fx;
const { gb, teamB, TB, optB, solo } = await addBingo(fx);
tok.solo = solo.tok;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : '  -- ' + extra}`);
};

const wanted = async (key) => db.transaction(async (tx) => {
  await tx.query('select plugin_as($1)', [tok[key]]);
  return (await tx.query('select * from plugin_wanted() order by game_id, tile_position, label')).rows;
});
const match = async (key, rsn, names) =>
  (await plugin('select plugin_match($1, $2, $3::jsonb) j', [tok[key], rsn, J(names.map((name) => ({ name })))])).j;
const verdicts = (m) => m.items.map((i) => i.verdict).join(',');
const open = (key, rsn, tileId, optionId, item) =>
  plugin('select plugin_open($1, $2, $3, $4, $5) j', [tok[key], rsn, tileId, optionId, item]);
const submit = (key, rsn, tileId, optionId, item, path, detail) =>
  plugin('select plugin_submit($1, $2, $3, $4, $5, $6, null, $7::jsonb) j',
         [tok[key], rsn, tileId, optionId, item, path, J(detail)]);
// Open, then hand in: what the intake function does for a 'one'.
let drops = 0;
const handIn = async (key, rsn, tileId, item, optionId = optB[item]) => {
  const o = (await open(key, rsn, tileId, optionId, item)).j;
  const s = (await submit(key, rsn, tileId, optionId, item, `${o.path_prefix}${++drops}.jpg`,
    { source: 'dink', dedupe: `bingo-drop-${drops}`, item })).j;
  return { o, s };
};
const NOPE = /does not count for an open tile/;
const bingoRows = (w) => w.filter((x) => x.game_id === gb);

ok('the card was built: nine tiles, eleven drops',
   Object.keys(TB).length === 9 && Object.keys(optB).length === 11, J(Object.keys(optB)));

// ------------------------------------------------------- before the start
// The card is hidden from the players until the organiser presses Start.
let w = await wanted('mate');
ok('before the start: nothing on the card can be handed in', bingoRows(w).length === 0, J(w).slice(0, 300));
ok('and no tile name from the card is in what a drop is matched against',
   !/Zulrah|Tanzanite|Granite maul|Bandos/.test(J(w)), J(w).slice(0, 300));
ok('a drop only the card wants matches nothing yet',
   verdicts(await match('mate', 'Mate Iron', ['Tanzanite fang'])) === 'none');
const early = await trying(plugin, 'select plugin_open($1,$2,$3,$4,$5)',
  [tok.mate, 'Mate Iron', TB.zulrah, optB['Tanzanite fang'], 'Tanzanite fang']);
const noSuch = await trying(plugin, 'select plugin_open($1,$2,$3,$4,$5)',
  [tok.mate, 'Mate Iron', '00000000-0000-0000-0000-000000000001', optB['Tanzanite fang'], 'Tanzanite fang']);
ok('a hand-in before the start is refused, in the words for a tile that does not exist',
   NOPE.test(early ?? '') && early === noSuch, J([early, noSuch]));

await site(ids.org, 'select start_game($1)', [gb]);

// ---------------------------------------------------------- after the start
w = bingoRows(await wanted('mate'));
ok('after the start: every drop on the card can be handed in',
   w.length === 11 && new Set(w.map((x) => x.tile_id)).size === 9, J(w.map((x) => x.label)));
ok("each one for Red's Bingo team, with no region",
   w.every((x) => x.team_id === teamB.Red && x.region === null && x.option_id && x.drop), J(w[0]));
const wb = bingoRows(await wanted('blue'));
ok("Blue's players get the same card, for Blue",
   wb.length === 11 && wb.every((x) => x.team_id === teamB.Blue), J(wb[0]));
const ws = await wanted('solo');
ok('a player in the Bingo game only gets the card and nothing of Region Bingo',
   ws.length === 11 && ws.every((x) => x.game_id === gb) && !/Barrows|Misthalin|Locked/.test(J(ws)), J(ws).slice(0, 300));
ok('someone on no team gets nothing', (await wanted('out')).length === 0);

let m = await match('mate', 'Mate Iron', ['Tanzanite fang', 'Abyssal whip', 'Dragon pickaxe', 'Bones']);
ok('a drop on the card: one. No region opened yet, so Whip and Pickaxe are one too. Junk: none',
   m.account_ok && verdicts(m) === 'one,one,one,none', J(m).slice(0, 400));
ok('the match names the Bingo tile', m.items[0].matches[0].game_id === gb && m.items[0].matches[0].tile === 'Zulrah',
   J(m.items[0]));

// ------------------------------------------- two games at once, and the secret
await site(ids.red, `select regions_pick($1, 'misthalin')`, [g]);
await site(ids.blue, `select regions_pick($1, 'asgarnia')`, [g]);

m = await match('mate', 'Mate Iron', ['Abyssal whip']);
ok('a drop two running games want is an ask, naming both (current rule, see README)',
   verdicts(m) === 'ask' && J(m.items[0].matches.map((x) => x.game_id).sort()) === J([g, gb].sort()),
   J(m).slice(0, 400));

// Red has not opened Asgarnia, where Region Bingo's Dragon pickaxe tile is.
m = await match('mate', 'Mate Iron', ['Dragon pickaxe']);
ok("a drop on Red's card and on a tile in a region Red has not opened: one, the card's",
   verdicts(m) === 'one' && m.items[0].matches.length === 1 && m.items[0].matches[0].game_id === gb, J(m));
ok('and nothing of the locked tile is in the answer',
   !/Locked secret/.test(J(m)) && !J(m).includes(T.locked) && !J(m).includes(g), J(m));
// The same question with the Region Bingo game not running at all: the
// answer must not change, or the difference would give the locked tile away.
const withoutRegions = await db.transaction(async (tx) => {
  await tx.query(`update games set status = 'placement' where id = $1`, [g]);
  await tx.query('set local role service_role');
  const r = (await tx.query('select plugin_match($1, $2, $3::jsonb) j',
    [tok.mate, 'Mate Iron', J([{ name: 'Dragon pickaxe' }])])).rows[0].j;
  await tx.rollback();
  return r;
});
ok('the same answer, word for word, as with no Region Bingo game at all', J(m) === J(withoutRegions),
   J([m, withoutRegions]));
ok("Blue, who opened Asgarnia, is asked: the card's tile and the region's",
   verdicts(await match('blue', 'Blue Main', ['Dragon pickaxe'])) === 'ask');
const locked = await trying(plugin, 'select plugin_open($1,$2,$3,$4,$5)',
  [tok.mate, 'Mate Iron', T.locked, opt['Dragon pickaxe'], 'Dragon pickaxe']);
ok("handing in on the locked region tile is still refused, in the same words",
   locked !== null && locked === noSuch, J([locked, noSuch]));

// ------------------------------------------------------------ handing in
const z1 = await handIn('mate', 'Mate Iron', TB.zulrah, 'Tanzanite fang');
ok('plugin_open answers where the screenshot goes, under the Bingo game and team',
   z1.o.path_prefix === `${gb}/${teamB.Red}/${z1.o.claim_id}/` && z1.o.game_id === gb && z1.o.team_id === teamB.Red,
   J(z1.o));
ok('the drop is handed in', z1.s.duplicate === false, J(z1.s));
let ev = (await db.query('select * from tile_evidence where claim_id = $1', [z1.o.claim_id])).rows;
ok("as one piece of evidence, by that player, for Red, marked 'dink'",
   ev.length === 1 && ev[0].uploaded_by === ids.mate && ev[0].team_id === teamB.Red && ev[0].source === 'dink'
   && ev[0].option_id === optB['Tanzanite fang'] && ev[0].detail.item === 'Tanzanite fang', J(ev));
let claim = (await db.query('select status from tile_claims where id = $1', [z1.o.claim_id])).rows[0];
ok('one of two: the tile is not complete yet', claim.status === 'active', J(claim));

const site1 = (await site(ids.red, 'select bingo_open_tile($1) c', [TB.zulrah]))[0].c;
ok("the site opens the same tile for Red and gets the plugin's claim", site1 === z1.o.claim_id, J([site1, z1.o.claim_id]));

const z2 = await handIn('mate', 'Mate Iron', TB.zulrah, 'Magic fang');
claim = (await db.query('select status from tile_claims where id = $1', [z1.o.claim_id])).rows[0];
ok("the second drop completes the tile, by the tile's own rule", claim.status === 'completed', J([claim, z2.s]));
const done = (await db.query(
  `select payload from game_events where game_id = $1 and team_id = $2 and type = 'tile_completed'`,
  [gb, teamB.Red])).rows;
ok('and the game says so, as it does for an upload from the site',
   done.length === 1 && done[0].payload.tile_name === 'Zulrah' && done[0].payload.by === ids.mate, J(done));
ok('a completed tile can no longer be handed in',
   !bingoRows(await wanted('mate')).some((x) => x.tile_id === TB.zulrah)
   && verdicts(await match('mate', 'Mate Iron', ['Serpentine visage'])) === 'none');

// Blue has the same card and its own progress on it.
const zb = await handIn('blue', 'Blue Main', TB.zulrah, 'Serpentine visage');
ok("Blue's drop on the same tile is Blue's own claim",
   zb.o.claim_id !== z1.o.claim_id && zb.o.team_id === teamB.Blue
   && (await db.query('select team_id from tile_claims where id = $1', [zb.o.claim_id])).rows[0].team_id === teamB.Blue);
ok("and Red's finished tile is untouched",
   (await db.query('select count(*)::int n from tile_evidence where claim_id = $1', [z1.o.claim_id])).rows[0].n === 2);
ok('Blue can still hand in Zulrah: one of two',
   verdicts(await match('blue', 'Blue Main', ['Tanzanite fang'])) === 'one');

// -------------------------------------------------------------- refusals
const r = {
  redPath: await trying(plugin, 'select plugin_submit($1,$2,$3,$4,$5,$6,null,$7::jsonb)',
    [tok.blue, 'Blue Main', TB.zulrah, optB['Tanzanite fang'], 'Tanzanite fang',
     `${gb}/${teamB.Red}/${z1.o.claim_id}/sneaky.jpg`, J({ dedupe: 'bingo-drop-x1' })]),
  wrongItem: await trying(plugin, 'select plugin_open($1,$2,$3,$4,$5)',
    [tok.mate, 'Mate Iron', TB.maul, optB['Granite maul'], 'Abyssal whip']),
  wrongName: await trying(plugin, 'select plugin_open($1,$2,$3,$4,$5)',
    [tok.solo, 'Blue Main', TB.maul, optB['Granite maul'], 'Granite maul']),
  outsider: await trying(plugin, 'select plugin_open($1,$2,$3,$4,$5)',
    [tok.out, 'Outsider', TB.maul, optB['Granite maul'], 'Granite maul']),
};
ok("Blue cannot put evidence on Red's claim, even with Red's storage path",
   r.redPath !== null && !NOPE.test(r.redPath), r.redPath);
ok('an item that is not the option is refused', NOPE.test(r.wrongItem ?? ''), r.wrongItem);
ok("another player's in-game name is refused", /not on your account list/.test(r.wrongName ?? ''), r.wrongName);
ok('someone on no team is refused', r.outsider !== null, r.outsider);
ok('none of the refusals left evidence behind',
   (await db.query(`select count(*)::int n from tile_evidence e join tile_claims c on c.id = e.claim_id
                     join tiles t on t.id = c.tile_id where t.game_id = $1`, [gb])).rows[0].n === 3);

// Time up: the rule lives in bingo_open_tile and add_evidence, and the plugin
// gets no way round it.
await db.query(`update games set ends_at = now() - interval '1 minute' where id = $1`, [gb]);
const late = await trying(plugin, 'select plugin_open($1,$2,$3,$4,$5)',
  [tok.mate, 'Mate Iron', TB.maul, optB['Granite maul'], 'Granite maul']);
ok("after Bingo's time has run out, a drop is refused, by the game's own rule",
   /Time is up/.test(late ?? ''), late);
await db.query(`update games set ends_at = now() + interval '1 day' where id = $1`, [gb]);

// ---------------------------------------------------- the card filled in
// Red finishes the card from drops alone. The last one ends the game, as the
// last upload from the site would.
for (const [tile, item] of [[TB.whip, 'Abyssal whip'], [TB.pickaxe, 'Dragon pickaxe'],
                            [TB.bones, 'Dragon bones'], [TB.scimitar, 'Rune scimitar'],
                            [TB.visage, 'Draconic visage'], [TB.bandos, 'Bandos chestplate'],
                            [TB.maul, 'Granite maul'], [TB.medHelm, 'Dragon med helm']]) {
  await handIn('mate', 'Mate Iron', tile, item);
}
const game = (await db.query('select status, ended_reason, winner_team_id from games where id = $1', [gb])).rows[0];
ok('the drop that fills the card ends the game, by the full-card rule, and Red wins',
   game.status === 'finished' && game.ended_reason === 'full_card' && game.winner_team_id === teamB.Red, J(game));
ok('a finished game takes no more drops: nothing of the card is wanted',
   bingoRows(await wanted('blue')).length === 0 && (await wanted('solo')).length === 0);
const after = await trying(plugin, 'select plugin_open($1,$2,$3,$4,$5)',
  [tok.solo, 'Solo Main', TB.maul, optB['Granite maul'], 'Granite maul']);
ok('and a hand-in is refused in the same words as for a tile that does not exist',
   after !== null && after === noSuch, J([after, noSuch]));
ok('Region Bingo carries on: Red can still hand in the whip there',
   verdicts(await match('mate', 'Mate Iron', ['Abyssal whip'])) === 'one');

// ------------------------------------------------------------ the fences
const priv = (await db.query(`
  select r.rolname from pg_roles r
   where r.rolname in ('anon', 'authenticated', 'service_role')
     and has_function_privilege(r.rolname, 'plugin_open_tile(uuid)', 'execute')`)).rows;
ok('the mode switch is internal: nobody outside may call it', priv.length === 0, J(priv));
const fns = (await db.query(`
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'plugin\\_%'
     and has_function_privilege('service_role', p.oid, 'execute') order by 1`)).rows.map((x) => x.proname);
ok('the service role still calls exactly the seven the intake uses',
   J(fns) === J(['plugin_leftover_files', 'plugin_leftovers_removed', 'plugin_match', 'plugin_open', 'plugin_submit', 'plugin_wait', 'plugin_wait_open']), J(fns));
// No second copy of a game rule: the plugin functions open tiles and hand in
// evidence only through the site's functions.
const copies = (await db.query(`
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'plugin\\_%'
     and (p.prosrc ilike '%insert into tile_claims%' or p.prosrc ilike '%insert into tile_evidence%'
          or p.prosrc ilike '%ends_at%' or p.prosrc ilike '%region_unlocks%')`)).rows;
ok('no plugin function opens a tile, writes evidence or reads the time itself', copies.length === 0, J(copies));

console.log('     (the time-up refusal: ' + late + ')');
console.log("     (Blue on Red's path: " + r.redPath + ')');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
