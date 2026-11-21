// A whole Region Bingo game played through Dink, on the real rules: every
// migration is replayed first, so region completion, picks, revokes and the
// five completion rules here are the site's own.
//
// regions.test.mjs proves the pieces (matching, the second secret, the fences)
// on a small board. This plays a game the way the clan will: regions opened by
// picks, completed by drops, tiles with sets, a revoke, and the end.
//
// The board, threshold 50%:
//   Misthalin (12 points, 6 to complete)
//     A Dharok or Karil set   one_set         6   the four pieces of one brother
//     Two whips               points, 2       2   Abyssal whip
//     Most valuable drop      value           2   no drop list: the site's
//     Pet screenshot          no drop list    2   no drop list: the site's
//   Asgarnia (7 points, 4 to complete)
//     A piece from each god   each_set, 1     4   Armadyl x2, Bandos x2
//     Two wildy weapons       points_per_set  3   Dragon pickaxe, Dragon 2h sword; 2 of them
//   a tile with no drop list in each of the other nine regions
//
//   node regions-game.test.mjs

import { buildPeople, J } from './fixture.mjs';

const { db, ids, tok, site, plugin, trying } = await buildPeople();

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : '  -- ' + extra}`);
};

// ------------------------------------------------------------- the game
const g = (await site(ids.org,
  `select admin_new_game('Region Bingo through Dink', 'regions', array['Red','Blue'], 3::smallint,
                         now() + interval '7 days') id`))[0].id;
const team = {};
for (const r of (await db.query('select id, name from teams where game_id = $1', [g])).rows) team[r.name] = r.id;

const tile = async (square, worth, spec) => {
  const id = (await site(ids.org, 'select admin_set_tile($1, $2::smallint, $3::smallint, $4::jsonb) id',
    [g, Math.floor((square - 1) / 10) + 1, ((square - 1) % 10) + 1, J(spec)]))[0].id;
  await site(ids.org, 'select admin_set_tile_worth($1, $2, $3)', [g, square, worth]);
  return id;
};
const pieces = (grp, labels) => labels.map((label) => ({ label, points: 1, grp }));
const T = {
  set: await tile(1, 6, { name: 'A Dharok or Karil set', rule: 'one_set', options: [
    ...pieces('Dharok', ["Dharok's helm", "Dharok's platebody", "Dharok's platelegs", "Dharok's greataxe"]),
    ...pieces('Karil', ["Karil's coif", "Karil's leathertop", "Karil's leatherskirt", "Karil's crossbow"])] }),
  whips: await tile(2, 2, { name: 'Two whips', rule: 'points', amount: 2, options: [{ label: 'Abyssal whip', points: 1 }] }),
  value: await tile(3, 2, { name: 'Most valuable drop', rule: 'value', amount: 50 }),
  pet: await tile(4, 2, { name: 'Pet screenshot' }),
  gods: await tile(101, 4, { name: 'A piece from each god', rule: 'each_set', perSet: 1, options: [
    ...pieces('Armadyl', ['Armadyl helmet', 'Armadyl chestplate']),
    ...pieces('Bandos', ['Bandos chestplate', 'Bandos tassets'])] }),
  wildy: await tile(102, 3, { name: 'Two wildy weapons', rule: 'points_per_set', perSet: 2,
    options: pieces('Wilderness', ['Dragon pickaxe', 'Dragon 2h sword']) }),
};
for (let k = 3; k <= 11; k++) await tile((k - 1) * 100 + 1, 1, { name: `Screenshot ${k}` });
const opt = {};
for (const r of (await db.query(
  'select o.id, o.label from tile_options o join tiles t on t.id = o.tile_id where t.game_id = $1', [g])).rows) {
  opt[r.label] = r.id;
}
await site(ids.org, `select admin_set_member($1, $2, 'captain')`, [team.Red, ids.red]);
await site(ids.org, `select admin_set_member($1, $2, 'member')`, [team.Red, ids.mate]);
await site(ids.org, `select admin_set_member($1, $2, 'captain')`, [team.Blue, ids.blue]);
await site(ids.org, 'select start_game($1)', [g]);

// ------------------------------------------------------------- helpers
const wanted = async (key) => db.transaction(async (tx) => {
  await tx.query('select plugin_as($1)', [tok[key]]);
  return (await tx.query('select * from plugin_wanted() order by tile_position, label')).rows;
});
const rsnOf = { red: 'Red Main', mate: 'Mate Iron', blue: 'Blue Main' };
const match = async (key, names) =>
  (await plugin('select plugin_match($1, $2, $3::jsonb) j', [tok[key], rsnOf[key], J(names.map((name) => ({ name })))])).j;
const verdicts = async (key, names) => (await match(key, names)).items.map((i) => i.verdict).join(',');
let drops = 0;
const handIn = async (key, tileId, item) => {
  const o = (await plugin('select plugin_open($1, $2, $3, $4, $5) j', [tok[key], rsnOf[key], tileId, opt[item], item])).j;
  const s = (await plugin('select plugin_submit($1, $2, $3, $4, $5, $6, null, $7::jsonb) j',
    [tok[key], rsnOf[key], tileId, opt[item], item, `${o.path_prefix}${++drops}.png`,
     J({ source: 'dink', dedupe: `region-game-${drops}`, item })])).j;
  return { o, s };
};
const claimOf = async (teamId, tileId) =>
  (await db.query('select id, status from tile_claims where team_id = $1 and tile_id = $2', [teamId, tileId])).rows[0];
const standing = async (teamId) =>
  (await site(ids.org, 'select * from regions_standings($1) where team_id = $2', [g, teamId]))[0];
const NOPE = /does not count for an open tile/;
const noSuch = await trying(plugin, 'select plugin_open($1,$2,$3,$4,$5)',
  [tok.mate, 'Mate Iron', '00000000-0000-0000-0000-000000000001', opt['Dragon pickaxe'], 'Dragon pickaxe']);

ok('the board was built: two regions with drop lists, every rule the mode has',
   Object.keys(opt).length === 15, J(Object.keys(opt)));

// -------------------------------------------------- the first regions
await site(ids.red, `select regions_pick($1, 'misthalin')`, [g]);
await site(ids.blue, `select regions_pick($1, 'asgarnia')`, [g]);

let w = await wanted('mate');
ok("Red can hand in Misthalin's drop lists: the set's eight pieces and the whip",
   w.length === 9 && w.every((x) => x.region === 'misthalin')
   && new Set(w.map((x) => x.tile_name)).size === 2, J(w.map((x) => x.label)));
ok('never a tile without a drop list: the value tile and the screenshot tile stay on the site',
   !w.some((x) => x.tile_id === T.value || x.tile_id === T.pet));
ok("and nothing of Asgarnia, which only Blue has opened",
   !/Armadyl|Bandos|Dragon pickaxe|god|wildy/i.test(J(w)), J(w).slice(0, 300));
ok("so Red's Dragon pickaxe gets the answer junk gets",
   (await verdicts('mate', ['Dragon pickaxe', 'Bones'])) === 'none,none');

// -------------------------------------------- one_set: four pieces of one brother
for (const piece of ["Dharok's helm", "Dharok's platebody", "Dharok's platelegs"]) {
  await handIn('mate', T.set, piece);
}
ok('three Dharok pieces handed in: the set is not done yet', (await claimOf(team.Red, T.set)).status === 'active');
ok('a piece already in is not wanted again; another brother still is',
   (await verdicts('mate', ["Dharok's helm", "Karil's coif"])) === 'none,one');
const again = await trying(plugin, 'select plugin_open($1,$2,$3,$4,$5)',
  [tok.mate, 'Mate Iron', T.set, opt["Dharok's helm"], "Dharok's helm"]);
ok('and handing it in again is refused, in the words for a tile that does not exist',
   NOPE.test(again ?? '') && again === noSuch, J([again, noSuch]));

await handIn('red', T.set, "Dharok's greataxe");
ok('the fourth piece completes the set, by the tile\'s own rule', (await claimOf(team.Red, T.set)).status === 'completed');
let st = await standing(team.Red);
ok('6 of 12 points: Misthalin is complete, and Red has a pick',
   st.points === 6 && st.picks === 1 && J(st.regions_complete) === J(['misthalin']), J(st));
const events = async (type) => (await db.query(
  'select payload from game_events where game_id = $1 and team_id = $2 and type = $3 order by created_at', [g, team.Red, type])).rows;
ok('the feed says so: the tile completed, and the region',
   (await events('tile_completed')).length === 1 && (await events('region_completed')).length === 1,
   J([await events('tile_completed'), await events('region_completed')]));
ok("Karil's pieces are no longer wanted", (await verdicts('mate', ["Karil's coif"])) === 'none');

// ------------------------------------------ a pick opens a region, drops follow
const tokenPick = (await db.query(
  `select count(*)::int n from pg_proc where proname like 'plugin\\_%' and prosrc ilike '%regions_pick%'`)).rows[0].n;
ok('a token cannot spend the pick: no plugin function picks a region', tokenPick === 0);
await site(ids.mate, `select regions_pick($1, 'asgarnia')`, [g]);
w = await wanted('mate');
ok("once Red's member spends it on the site, Asgarnia's drops are wanted at once",
   w.filter((x) => x.region === 'asgarnia').length === 6, J(w.map((x) => x.label)));
ok("so Red's Dragon pickaxe is a one now", (await verdicts('mate', ['Dragon pickaxe'])) === 'one');

// ---------------------------------------------- each_set: one from each god
await handIn('mate', T.gods, 'Armadyl helmet');
ok('one Armadyl piece is enough: the other is not wanted, Bandos still is',
   (await verdicts('mate', ['Armadyl chestplate', 'Bandos tassets'])) === 'none,one');
await handIn('blue', T.gods, 'Bandos chestplate');
ok("Blue's Bandos piece is Blue's own: Red's tile is still waiting for one",
   (await claimOf(team.Red, T.gods)).status === 'active' && (await claimOf(team.Blue, T.gods)).status === 'active');
await handIn('mate', T.gods, 'Bandos tassets');
ok('a Bandos piece completes it', (await claimOf(team.Red, T.gods)).status === 'completed');

// --------------------------------------- points_per_set: two from the group
await handIn('mate', T.wildy, 'Dragon pickaxe');
ok('one of two weapons: both are still wanted',
   (await verdicts('mate', ['Dragon pickaxe', 'Dragon 2h sword'])) === 'one,one');
await handIn('mate', T.wildy, 'Dragon pickaxe');
ok('a second pickaxe makes two: the tile completes', (await claimOf(team.Red, T.wildy)).status === 'completed');
st = await standing(team.Red);
ok('13 points, Asgarnia complete as well: a second pick',
   st.points === 13 && st.picks === 1 && J([...st.regions_complete].sort()) === J(['asgarnia', 'misthalin']), J(st));

// -------------------------------------------------------- a revoke
const greataxe = (await db.query(
  `select e.id from tile_evidence e join tile_claims c on c.id = e.claim_id
    where c.team_id = $1 and c.tile_id = $2 and e.option_id = $3`, [team.Red, T.set, opt["Dharok's greataxe"]])).rows[0].id;
const rv = (await site(ids.org, 'select admin_revoke_evidence($1, false) r', [greataxe]))[0].r;
st = await standing(team.Red);
ok('an organiser revokes the greataxe: the set is undone, its 6 points go',
   rv.uncompleted === true && (await claimOf(team.Red, T.set)).status === 'active' && st.points === 7, J([rv, st]));
ok('Misthalin is no longer complete, and Asgarnia, which its pick opened, stays open',
   J(st.regions_complete) === J(['asgarnia']) && J([...st.regions_open].sort()) === J(['asgarnia', 'misthalin']), J(st));
ok('the greataxe is wanted again, and only the greataxe of that set',
   (await verdicts('mate', ["Dharok's greataxe", "Dharok's helm"])) === 'one,none');
await handIn('mate', T.set, "Dharok's greataxe");
st = await standing(team.Red);
ok('handed in again: the set is complete, and Misthalin does not pay a second pick',
   (await claimOf(team.Red, T.set)).status === 'completed' && st.points === 13 && st.picks === 1, J(st));

// -------------------------------------------- the rest of Misthalin
await handIn('mate', T.whips, 'Abyssal whip');
ok('one whip of two: still wanted', (await verdicts('mate', ['Abyssal whip'])) === 'one');
await handIn('red', T.whips, 'Abyssal whip');
ok('the second whip completes it', (await claimOf(team.Red, T.whips)).status === 'completed');

// The site's way in is untouched: the value tile takes a typed value.
const cValue = (await site(ids.red, 'select regions_open_tile($1) c', [T.value]))[0].c;
await site(ids.red, 'select add_evidence($1, $2, null, null, $3)', [cValue, `${g}/${team.Red}/${cValue}/big.png`, 80]);
st = await standing(team.Red);
ok('the value tile is handed in on the site as before, and counts', (await claimOf(team.Red, T.value)).status === 'completed'
   && st.points === 17, J(st));
const values = (await db.query('select source from tile_evidence where claim_id = $1', [cValue])).rows;
ok("and it is an upload from the site, not 'dink'", J(values) === J([{ source: 'web' }]), J(values));

const dinkRows = (await db.query(
  `select count(*)::int n from tile_evidence e join tile_claims c on c.id = e.claim_id join tiles t on t.id = c.tile_id
    where t.game_id = $1 and e.source = 'dink'`, [g])).rows[0].n;
const listed = await site(ids.org, 'select * from admin_evidence_sources($1)', [g]);
// Twelve handed in by Dink; the revoked greataxe's row is gone.
ok('the review screen names every drop Dink sent, and only those', listed.length === dinkRows && dinkRows === 11,
   J([listed.length, dinkRows]));

// ------------------------------------------------------- Blue all along
ok("Blue never had a Misthalin drop to hand in",
   (await verdicts('blue', ["Dharok's helm", "Karil's coif", 'Abyssal whip'])) === 'none,none,none');

// ------------------------------------------------------------ the end
await site(ids.org, 'select admin_end_game($1)', [g]);
const ended = (await db.query('select status from games where id = $1', [g])).rows[0];
ok('the organiser ends the game', ended.status === 'finished', J(ended));
ok('a finished game shows every tile, and still takes no drops',
   (await wanted('mate')).length === 0 && (await wanted('blue')).length === 0
   && (await verdicts('blue', ["Dharok's helm", 'Armadyl helmet'])) === 'none,none');
const late = await trying(plugin, 'select plugin_open($1,$2,$3,$4,$5)',
  [tok.blue, 'Blue Main', T.gods, opt['Armadyl helmet'], 'Armadyl helmet']);
ok('and a hand-in after the end is refused, in the words for a tile that does not exist',
   late !== null && late === noSuch, J([late, noSuch]));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
