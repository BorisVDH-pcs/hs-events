// A drop in several sets counts for the set of the monster it came from
// (Boris, 2026-11-22): on "Two Uniques From Each DT2 Boss", a Chromium ingot
// from Duke Sucellus fills Duke's set and no other, by itself.
// 20261122120000_set_from_monster.sql, replayed with every other migration,
// so admin_set_tile, the set rules and add_evidence here are the real ones.
//
// What a locked tile gives away is checked in regions.test.mjs, with the
// rest of the second secret.
//
//   node setfrom.test.mjs

import { buildGame, J } from './fixture.mjs';

const { db, ids, g, team, T, opt, tok, site, plugin, trying } = await buildGame();

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : '  -- ' + extra}`);
};

// ------------------------------------------------------------ the board
// Two more tiles in Misthalin, set on the running game as the console does.
const setTile = async (square, spec) => {
  const row = Math.floor((square - 1) / 10) + 1, col = ((square - 1) % 10) + 1;
  return (await site(ids.org, 'select admin_set_tile($1, $2::smallint, $3::smallint, $4::jsonb) id',
    [g, row, col, J(spec)]))[0].id;
};
const pieces = (grp, labels) => labels.map((label) => ({ label, points: 1, grp }));
const SHARED = ['Chromium ingot', 'Virtus mask'];

// The four DT2 bosses, two each, the shared drops in every set.
const dt2 = await setTile(5, { name: 'Two Uniques From Each DT2 Boss', rule: 'points_per_set', perSet: 2, options: [
  ...pieces('Duke Sucellus', ['Eye of the duke', ...SHARED, 'Baron']),
  ...pieces('The Leviathan', ["Leviathan's lure", ...SHARED, "Lil'viathan"]),
  ...pieces('The Whisperer', ["Siren's staff", ...SHARED]),
  ...pieces('Vardorvis', ["Executioner's axe head", ...SHARED])] });
// Two sets named after no monster, a drop in both: nothing changes there.
const styles = await setTile(6, { name: 'Claws either way', rule: 'each_set', perSet: 1, options: [
  ...pieces('Melee', ['Dragon claws', 'Abyssal tentacle']),
  ...pieces('Magic', ['Dragon claws', 'Kodai insignia'])] });
// Sets named after raids: a name covers the raid's modes.
const raids = await setTile(7, { name: 'A purple from each raid', rule: 'each_set', perSet: 1, options: [
  ...pieces('Chambers of Xeric', ['Twisted buckler', 'Dexterous prayer scroll']),
  ...pieces('Tombs of Amascut', ['Twisted buckler', "Osmumten's fang"])] });

const optOf = async (tile, grp, label) => (await db.query(
  'select id from tile_options where tile_id = $1 and grp = $2 and label = $3', [tile, grp, label])).rows[0].id;
const ingot = {};
for (const boss of ['Duke Sucellus', 'The Leviathan', 'The Whisperer', 'Vardorvis']) {
  ingot[boss] = await optOf(dt2, boss, 'Chromium ingot');
}
ok('the board was built: the ingot is in all four sets', new Set(Object.values(ingot)).size === 4, J(ingot));

await site(ids.red, `select regions_pick($1, 'misthalin')`, [g]);

const match = async (items) =>
  (await plugin('select plugin_match($1, $2, $3::jsonb) j', [tok.mate, 'Mate Iron', J(items)])).j;
const verdicts = (m) => m.items.map((i) => i.verdict).join(',');
const onlyOption = (item) => item.verdict === 'one' ? item.matches[0].option_id : null;

// --------------------------------------------------- one boss, one set
let m = await match([
  { name: 'Chromium ingot', from: 'Duke Sucellus' },
  { name: 'Chromium ingot', from: 'The Leviathan' },
  { name: 'Chromium ingot', from: 'THE  leviathan' },
  { name: 'Virtus mask', from: 'Vardorvis' },
  { name: 'Virtus mask', from: 'The Whisperer' }]);
ok('an ingot from Duke counts for one set only, so it is handed in, not asked', verdicts(m) === 'one,one,one,one,one', verdicts(m));
ok("and that set is Duke Sucellus's", onlyOption(m.items[0]) === ingot['Duke Sucellus'], J(m.items[0]));
ok("from The Leviathan, The Leviathan's, however it is spelt",
   onlyOption(m.items[1]) === ingot['The Leviathan'] && onlyOption(m.items[2]) === ingot['The Leviathan'], J(m.items.slice(1, 3)));
ok('a Virtus piece too: Vardorvis to Vardorvis, The Whisperer to The Whisperer',
   onlyOption(m.items[3]) === await optOf(dt2, 'Vardorvis', 'Virtus mask')
   && onlyOption(m.items[4]) === await optOf(dt2, 'The Whisperer', 'Virtus mask'), J(m.items.slice(3)));

m = await match([
  { name: 'Eye of the duke', from: 'Duke Sucellus' },
  { name: 'Eye of the duke', from: 'Vardorvis' },
  { name: 'Bones', from: 'Vardorvis' }]);
ok("a boss's own drop from another of the bosses: none", verdicts(m) === 'one,none,none', verdicts(m));
ok('in the answer junk gets: nothing about the tile',
   J({ ...m.items[1], name: 0 }) === J({ ...m.items[2], name: 0 }), J(m.items.slice(1)));

m = await match([{ name: 'Baron' }, { name: 'Chromium ingot' }]);
ok('a drop with no monster named (a pet) counts as before: Baron one, an ingot in four sets asks',
   verdicts(m) === 'one,ask' && m.items[1].matches.length === 4, J(m).slice(0, 300));
m = await match([{ name: 'Chromium ingot', from: 'Cow' }]);
ok('from a monster no set is named after: as before, all four, and the team chooses',
   verdicts(m) === 'ask' && m.items[0].matches.length === 4, J(m).slice(0, 300));

// ------------------------------------- sets that are not monsters' names
m = await match([{ name: 'Dragon claws', from: 'Chambers of Xeric' }, { name: 'Dragon claws' }]);
ok('a tile whose sets are named after no monster is as before: both sets, the team chooses',
   verdicts(m) === 'ask,ask' && m.items.every((i) => i.matches.every((x) => x.tile_id === styles)), J(m).slice(0, 300));

m = await match([
  { name: 'Twisted buckler', from: 'Tombs of Amascut: Expert Mode' },
  { name: 'Twisted buckler', from: 'Chambers of Xeric' },
  { name: 'Twisted buckler', from: 'Tombs' }]);
ok("a raid's set takes its modes, and a name that is only the start of a word does not count",
   onlyOption(m.items[0]) === await optOf(raids, 'Tombs of Amascut', 'Twisted buckler')
   && onlyOption(m.items[1]) === await optOf(raids, 'Chambers of Xeric', 'Twisted buckler')
   && m.items[2].verdict === 'ask', J(m.items.map((i) => [i.verdict, i.matches.length])));

// ------------------------------------------------ handing in, sets filling
let drops = 0;
const handIn = async (option, item, from) => {
  const o = (await plugin('select plugin_open($1, $2, $3, $4, $5) j', [tok.mate, 'Mate Iron', dt2, option, item])).j;
  return (await plugin('select plugin_submit($1, $2, $3, $4, $5, $6, null, $7::jsonb) j',
    [tok.mate, 'Mate Iron', dt2, option, item, `${o.path_prefix}${++drops}.png`,
     J({ source: 'dink', dedupe: `set-from-${drops}`, item, from })])).j;
};
const points = async (grp) => (await db.query(`
  select coalesce(sum(o.points), 0)::int n from tile_evidence e
    join tile_claims c on c.id = e.claim_id join tile_options o on o.id = e.option_id
   where c.tile_id = $1 and c.team_id = $2 and o.grp = $3`, [dt2, team.Red, grp])).rows[0].n;

await handIn(await optOf(dt2, 'Duke Sucellus', 'Eye of the duke'), 'Eye of the duke', 'Duke Sucellus');
await handIn(ingot['Duke Sucellus'], 'Chromium ingot', 'Duke Sucellus');
ok("Duke's two are in: Duke's set has 2, the others none",
   await points('Duke Sucellus') === 2 && await points('The Leviathan') === 0 && await points('Vardorvis') === 0);

m = await match([
  { name: 'Chromium ingot', from: 'Duke Sucellus' },
  { name: 'Chromium ingot', from: 'The Leviathan' },
  { name: 'Bones', from: 'Duke Sucellus' }]);
ok("with Duke's set full, an ingot from Duke counts for no other boss: none",
   verdicts(m) === 'none,one,none', verdicts(m));
ok('in the answer junk gets', J({ ...m.items[0], name: 0 }) === J({ ...m.items[2], name: 0 }), J(m.items));
ok("and an ingot from The Leviathan still goes to The Leviathan's set", onlyOption(m.items[1]) === ingot['The Leviathan']);

// The second lock on the same door: an ingot from Duke handed in for
// Vardorvis's set, as a request made by hand.
const NOPE = /does not count for an open tile/;
const before = (await db.query('select count(*)::int n from tile_evidence')).rows[0].n;
const o = (await plugin('select plugin_open($1, $2, $3, $4, $5) j',
  [tok.mate, 'Mate Iron', dt2, ingot.Vardorvis, 'Chromium ingot'])).j;
const wrong = await trying(plugin, 'select plugin_submit($1,$2,$3,$4,$5,$6,null,$7::jsonb)',
  [tok.mate, 'Mate Iron', dt2, ingot.Vardorvis, 'Chromium ingot', o.path_prefix + 'wrong.png',
   J({ source: 'dink', dedupe: 'set-from-wrong', item: 'Chromium ingot', from: 'Duke Sucellus' })]);
const locked = await trying(plugin, 'select plugin_submit($1,$2,$3,$4,$5,$6,null,$7::jsonb)',
  [tok.mate, 'Mate Iron', T.locked, opt['Dragon pickaxe'], 'Dragon pickaxe', 'x/z.png',
   J({ source: 'dink', dedupe: 'set-from-locked', from: 'Duke Sucellus' })]);
ok("an ingot from Duke handed in for Vardorvis's set is refused", NOPE.test(wrong ?? ''), wrong);
ok('in the words a tile in a locked region gets', wrong === locked, J([wrong, locked]));
ok('and nothing was written',
   (await db.query('select count(*)::int n from tile_evidence')).rows[0].n === before
   && (await db.query(`select count(*)::int n from plugin_intake_log where dedupe_key in ('set-from-wrong', 'set-from-locked')`)).rows[0].n === 0);
const right = await handIn(ingot.Vardorvis, 'Chromium ingot', 'Vardorvis');
ok('the same ingot from Vardorvis is handed in', right.duplicate === false && await points('Vardorvis') === 1, J(right));

// ------------------------------------------------ a drop that waits
// plugin_wait keeps a drop only when two choices are left; from a boss
// with a set of its own there is one at most, so it is never kept.
const wait = async (item, from, n) => {
  const wo = (await plugin('select plugin_wait_open($1, $2, $3) j', [tok.mate, 'Mate Iron', item])).j;
  return trying(plugin, 'select plugin_wait($1, $2, $3, $4, $5::jsonb) j', [tok.mate, 'Mate Iron', item,
    wo.path_prefix + `w${n}.png`, J({ source: 'dink', dedupe: `set-from-wait-${n}`, item, ...(from ? { from } : {}) })]);
};
const keptFrom = await wait('Virtus mask', 'The Whisperer', 1);
ok('a Virtus mask from The Whisperer is not kept for the team to choose', NOPE.test(keptFrom ?? ''), keptFrom);
const keptStyles = await wait('Dragon claws', 'Chambers of Xeric', 2);
const shown = await site(ids.mate, 'select * from waiting_drops($1)', [g]);
ok('on a tile whose sets are named after no monster, a drop still waits with both sets',
   keptStyles === null && shown.length === 1 && shown[0].choices.length === 2
   && shown[0].choices.every((c) => c.tile_id === styles), J(shown).slice(0, 400));

// ------------------------------------------------- with "Only from" too
await db.query('update tiles set drop_from = $2 where id = $1', [dt2, ['Duke Sucellus', 'The Whisperer']]);
m = await match([{ name: 'Virtus mask', from: 'The Whisperer' }, { name: 'Virtus mask', from: 'The Leviathan' }]);
ok('"Only from" still holds beside it: The Whisperer one, The Leviathan none', verdicts(m) === 'one,none', verdicts(m));
await db.query('update tiles set drop_from = null where id = $1', [dt2]);

// ------------------------------------------------------------ the fences
const callers = async (sig) => (await db.query(`
  select r.rolname from pg_roles r where r.rolname in ('anon', 'service_role', 'authenticated')
     and has_function_privilege(r.rolname, $1, 'execute') order by 1`, [sig])).rows.map((x) => x.rolname);
for (const sig of ['plugin_set_ok(uuid, text)', 'plugin_name_is_monster(text, text)', 'plugin_wait_choices(text, text)']) {
  ok(`${sig.split('(')[0]}: nobody from outside`, J(await callers(sig)) === '[]', J(await callers(sig)));
}
for (const sig of ['plugin_match(text, text, jsonb)', 'plugin_submit(text, text, uuid, uuid, text, text, text, jsonb)']) {
  ok(`${sig.split('(')[0]}: the service role only, as before`, J(await callers(sig)) === J(['service_role']), J(await callers(sig)));
}
const src = (await import('node:fs')).readFileSync(
  new URL('../../../supabase/migrations/20261122120000_set_from_monster.sql', import.meta.url), 'utf8').replace(/^--.*$/gm, '');
ok('add_evidence, tiles_for_team and the set rules were not touched by this migration',
   !/function\s+(add_evidence|tiles_for_team|evidence_refusal|claim_is_complete|plugin_wanted|plugin_check)\b/i.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
