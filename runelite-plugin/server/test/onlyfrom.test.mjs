// "Only from" (Boris, 2026-11-21): a tile's drops count only when Dink says
// they came from one of these monsters. Per tile, on catalogue tiles too;
// empty is "from any monster", as before. 20261121160000_only_from.sql,
// replayed with every other migration, so admin_set_tile, the presets,
// autofill and add_evidence here are the real ones.
//
// What a locked tile gives away is checked in regions.test.mjs, with the
// rest of the second secret.
//
//   node onlyfrom.test.mjs

import { buildGame, J } from './fixture.mjs';

const { db, ids, g, team, T, opt, tok, site, plugin, trying } = await buildGame();

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : '  -- ' + extra}`);
};
const asOrg = site.bind(null, ids.org);
const asRed = site.bind(null, ids.red);

// ----------------------------------------------------------- the catalogue
const pickaxe = (extra = {}) => ({
  name: 'KQ pickaxe', rule: 'points', amount: 1, options: [{ label: 'Dragon pickaxe', points: 1 }], ...extra });
const saveLib = async (id, spec) =>
  (await asOrg('select admin_save_library_tile_with_from($1, $2::jsonb) id', [id, J(spec)]))[0].id;
const libFrom = async (id) => (await db.query('select drop_from, name from tile_library where id = $1', [id])).rows[0];

const kq = await saveLib(null, pickaxe({ dropFrom: ['Kalphite Queen', '  kalphite   QUEEN ', '', 'Kalphite Queen'] }));
ok('a catalogue tile keeps its "Only from": trimmed, blanks dropped, one of each',
   J((await libFrom(kq)).drop_from) === J(['Kalphite Queen']), J(await libFrom(kq)));

let read = await asOrg('select * from admin_library_drop_from()');
ok('the organiser reads it back', read.some((x) => x.library_id === kq && J(x.drop_from) === J(['Kalphite Queen'])), J(read));
ok('only entries that have a list are listed', read.every((x) => x.drop_from.length > 0), J(read));

await saveLib(kq, pickaxe());
ok('saved again without "dropFrom": the list is left as it is', J((await libFrom(kq)).drop_from) === J(['Kalphite Queen']));
await asOrg('select admin_save_library_tile($1, $2::jsonb)', [kq, J(pickaxe({ description: 'Old save' }))]);
ok('and the old save, as the site sends it today, leaves it too', J((await libFrom(kq)).drop_from) === J(['Kalphite Queen']));
await saveLib(kq, pickaxe({ dropFrom: [] }));
ok('an empty list is "from any monster" again', J((await libFrom(kq)).drop_from) === '[]');
await saveLib(kq, pickaxe({ dropFrom: ['Kalphite Queen'] }));

const bad = (dropFrom) => trying(asOrg, 'select admin_save_library_tile_with_from($1, $2::jsonb)',
  [kq, J(pickaxe({ name: 'Renamed', dropFrom }))]);
ok('a list that is not a list is refused', /must be a list of monster names/.test(await bad('Kalphite Queen') ?? ''));
ok('a list of numbers is refused', /must be a list of monster names/.test(await bad([12]) ?? ''));
ok('21 monsters are too many', /at most 20/.test(await bad(Array.from({ length: 21 }, (_, i) => `Monster ${i}`)) ?? ''));
ok('a name of 81 letters is too long', /too long/.test(await bad(['x'.repeat(81)]) ?? ''));
ok('signs alone are not a name', /not a monster name/.test(await bad(['!!!']) ?? ''));
const after = await libFrom(kq);
ok('a refusal changes nothing: not the list, not the rest of the tile',
   J(after.drop_from) === J(['Kalphite Queen']) && after.name === 'KQ pickaxe', J(after));

const playerSaves = await trying(asRed, 'select admin_save_library_tile_with_from($1, $2::jsonb)', [kq, J(pickaxe({ dropFrom: [] }))]);
ok('a player cannot save one, refused by the catalogue\'s own save', /Organisers only/.test(playerSaves ?? ''), playerSaves);
const playerReads = await trying(asRed, 'select * from admin_library_drop_from()');
ok('nor read the lists, in the words the catalogue list uses',
   /Organisers only/.test(playerReads ?? '') && playerReads === await trying(asRed, 'select * from admin_list_library()'), playerReads);

// ------------------------------------------------------------ on a board
// A second Region Bingo game, still in preparation.
const g2 = (await asOrg(
  `select admin_new_game('Only from board', 'regions', array['A','B'], 3::smallint, now() + interval '1 day') id`))[0].id;
const setTile = async (square, spec, fn = 'admin_set_tile', game = g2) => {
  const row = Math.floor((square - 1) / 10) + 1, col = ((square - 1) % 10) + 1;
  return (await asOrg(`select ${fn}($1, $2::smallint, $3::smallint, $4::jsonb) id`, [game, row, col, J(spec)]))[0].id;
};
const tileFrom = async (id) => (await db.query('select drop_from from tiles where id = $1', [id])).rows[0]?.drop_from;

const t1 = await setTile(1, pickaxe({ libraryId: kq }));
ok("a catalogue tile placed on a board brings its list, even through the old save",
   J(await tileFrom(t1)) === J(['Kalphite Queen']), J(await tileFrom(t1)));
await setTile(1, pickaxe({ libraryId: kq, name: 'KQ pickaxe (edited)' }));
ok('editing it with the old save leaves its list alone', J(await tileFrom(t1)) === J(['Kalphite Queen']));
await setTile(1, pickaxe({ libraryId: kq, dropFrom: ['Callisto'] }), 'admin_set_tile_with_from');
ok("the new save gives a board tile its own list", J(await tileFrom(t1)) === J(['Callisto']));
ok('and the catalogue entry keeps its own', J((await libFrom(kq)).drop_from) === J(['Kalphite Queen']));
await setTile(1, pickaxe({ libraryId: kq, dropFrom: [] }), 'admin_set_tile_with_from');
ok('an empty list on the board is "from any monster"', J(await tileFrom(t1)) === '[]');

const t2 = await setTile(2, { name: 'Typed here', rule: 'points', amount: 1, options: [{ label: 'Abyssal whip', points: 1 }] });
ok('a tile typed on the board has no list', (await tileFrom(t2)) === null);

const calli = await saveLib(null, pickaxe({ name: 'Wildy pickaxe', dropFrom: ['Callisto', 'Artio'] }));
await setTile(1, pickaxe({ libraryId: calli, name: 'Wildy pickaxe' }));
ok('another catalogue entry on the same square brings its own list',
   J(await tileFrom(t1)) === J(['Callisto', 'Artio']), J(await tileFrom(t1)));

const t3 = await setTile(3, pickaxe({ libraryId: kq, dropFrom: ['Chaos Elemental'] }), 'admin_set_tile_with_from');
read = await asOrg('select * from admin_tiles_drop_from($1) order by tile_id', [g2]);
ok("the organiser reads the board's lists: only tiles that have one",
   read.length === 2 && read.every((x) => [t1, t3].includes(x.tile_id)), J(read));
const pr = await trying(asRed, 'select * from admin_tiles_drop_from($1)', [g2]);
ok("a player is refused, in the words the board's own list uses",
   /Not your game/.test(pr ?? '') && pr === await trying(asRed, 'select * from admin_list_tiles($1)', [g2]), pr);
ok('a game that does not exist gets the same answer',
   pr === await trying(asRed, 'select * from admin_tiles_drop_from($1)', ['00000000-0000-0000-0000-000000000001']));
const outsider = await trying(asRed, 'select admin_set_tile_with_from($1, 1::smallint, 4::smallint, $2::jsonb)',
  [g2, J(pickaxe({ dropFrom: ['Zulrah'] }))]);
ok("a player cannot save a board tile, refused by the board's own save", /Not your game/.test(outsider ?? ''), outsider);

// Moved: a swap moves the rows, and a list moves with its tile.
await asOrg('select admin_swap_tiles($1, 1, 1, 1, 2)', [g2]);
const at = async (game, row, col) => (await db.query(
  'select id, drop_from from tiles where game_id = $1 and "row" = $2 and col = $3', [game, row, col])).rows[0];
ok('a swap moves the list with its tile',
   (await at(g2, 1, 2)).id === t1 && J((await at(g2, 1, 2)).drop_from) === J(['Callisto', 'Artio'])
   && (await at(g2, 1, 1)).drop_from === null);

// A preset keeps each square's catalogue entry. Applied to a new board, a
// square takes its entry's list, as a placed tile does; a list changed on the
// board alone is not in the preset.
const preset = (await asOrg('select admin_save_board_preset($1, $2) j', [g2, 'Only from preset']))[0].j;
const g3 = (await asOrg(
  `select admin_new_game('Only from preset', 'regions', array['A','B'], 3::smallint, now() + interval '1 day') id`))[0].id;
await asOrg('select admin_apply_board_preset($1, $2)', [g3, preset.id]);
ok("a preset's squares take their catalogue entry's list",
   J((await at(g3, 1, 2)).drop_from) === J(['Callisto', 'Artio']), J(await at(g3, 1, 2)));
ok("a list changed on the board alone is not in a preset: the entry's is used",
   J((await at(g3, 1, 3)).drop_from) === J(['Kalphite Queen']), J(await at(g3, 1, 3)));
ok('a square typed on the board still has none', (await at(g3, 1, 1)).drop_from === null);

// Autofill (not Region Bingo's: it fills a Bingo card) places catalogue
// tiles the same way.
const g4 = (await asOrg(
  `select admin_new_game('Only from card', 'bingo', array['A'], 3::smallint, now() + interval '1 day') id`))[0].id;
await asOrg('select admin_autofill_board($1)', [g4]);
const filled = (await db.query(`
  select t.drop_from as tile, l.drop_from as entry from tiles t join tile_library l on l.id = t.library_id
   where t.game_id = $1`, [g4])).rows;
ok('autofill gives every tile its catalogue entry\'s list',
   filled.length > 0 && filled.every((x) => J(x.tile) === J(x.entry))
   && filled.some((x) => x.tile.length > 0), J(filled));

// ------------------------------------------------- in a game that is running
// Red opens Misthalin. Whip wants an Abyssal whip; Barrows chest and Any
// helmet both want Dharok's helm.
await site(ids.red, `select regions_pick($1, 'misthalin')`, [g]);
const match = async (items) =>
  (await plugin('select plugin_match($1, $2, $3::jsonb) j', [tok.mate, 'Mate Iron', J(items)])).j;
const verdicts = (m) => m.items.map((i) => i.verdict).join(',');
const setFrom = (tile, list) => db.query('update tiles set drop_from = $2 where id = $1', [tile, list]);

ok('with no list, a drop counts from any monster, as before',
   verdicts(await match([{ name: 'Abyssal whip', from: 'Cow' }])) === 'one');
await setFrom(T.whip, ['Abyssal demon']);
let m = await match([
  { name: 'Abyssal whip', from: 'Abyssal demon' }, { name: 'Abyssal whip', from: "ABYSSAL  demon" },
  { name: 'Abyssal whip', from: 'Cow' }, { name: 'Abyssal whip' }, { name: 'Bones', from: 'Cow' }]);
ok('from a monster on the list: counts. Spelt another way: counts. Another monster: none',
   verdicts(m).startsWith('one,one,none'), J(m.items.map((i) => i.verdict)));
ok('a drop with no monster named (a pet) counts, as before', m.items[3].verdict === 'one');
ok("a drop from the wrong monster gets the answer junk gets: nothing about the tile",
   J({ ...m.items[2], name: 0 }) === J({ ...m.items[4], name: 0 }), J(m.items.slice(2)));

await setFrom(T.whip, ['Tombs of Amascut']);
m = await match([
  { name: 'Abyssal whip', from: 'Tombs of Amascut: Expert Mode' }, { name: 'Abyssal whip', from: 'Tombs of Amascutx' },
  { name: 'Abyssal whip', from: 'Tombs' }]);
ok('a name covers what starts with it in whole words: a raid\'s modes, nothing more',
   verdicts(m) === 'one,none,none', verdicts(m));
await setFrom(T.whip, null);

// Two tiles want Dharok's helm. With a list on one, a drop from elsewhere
// is no longer a question.
await setFrom(T.barrows, ['Barrows']);
ok("from the monster on Barrows chest's list: both tiles, so the team chooses",
   verdicts(await match([{ name: "Dharok's helm", from: 'Barrows' }])) === 'ask');
m = await match([{ name: "Dharok's helm", from: 'Cow' }]);
ok('from anywhere else: only the tile without a list',
   verdicts(m) === 'one' && m.items[0].matches[0].tile_id === T.helmet, J(m));

// Three tiles: the list's tile is never offered when the drop waits.
const helm2 = await setTile(4, { name: 'Helm two', rule: 'points', amount: 1, options: [{ label: "Dharok's helm", points: 1 }] },
  'admin_set_tile', g);
m = await match([{ name: "Dharok's helm", from: 'Cow' }]);
ok('with a third tile, a drop from elsewhere waits for the two without a list',
   verdicts(m) === 'ask' && J(m.items[0].matches.map((x) => x.tile_id).sort()) === J([T.helmet, helm2].sort()), J(m));
const wo = (await plugin('select plugin_wait_open($1, $2, $3) j', [tok.mate, 'Mate Iron', "Dharok's helm"])).j;
const wt = (await plugin('select plugin_wait($1, $2, $3, $4, $5::jsonb) j', [tok.mate, 'Mate Iron', "Dharok's helm",
  wo.path_prefix + 'w1.png', J({ source: 'dink', dedupe: 'only-from-wait-1', item: "Dharok's helm", from: 'Cow' })])).j;
const kept = (await db.query('select choices from plugin_waiting where id = $1', [wt.waiting_id])).rows[0];
ok('and only those two are its choices on the site',
   wt.choices === 2 && J(kept.choices.map((c) => c.tile_id).sort()) === J([T.helmet, helm2].sort()), J([wt, kept]));
const shown = await site(ids.mate, 'select * from waiting_drops($1)', [g]);
ok('the box on the site offers those two', !J(shown).includes(T.barrows) && J(shown).includes(helm2), J(shown).slice(0, 400));

// Handing in: the second lock on the same door.
const NOPE = /does not count for an open tile/;
const before = (await db.query('select count(*)::int n from tile_evidence')).rows[0].n;
const wrong = await trying(plugin, 'select plugin_submit($1,$2,$3,$4,$5,$6,null,$7::jsonb)',
  [tok.mate, 'Mate Iron', T.barrows, opt["Dharok's helm"], "Dharok's helm", 'x/y.png',
   J({ source: 'dink', dedupe: 'only-from-1', from: 'Cow' })]);
const locked = await trying(plugin, 'select plugin_submit($1,$2,$3,$4,$5,$6,null,$7::jsonb)',
  [tok.mate, 'Mate Iron', T.locked, opt['Dragon pickaxe'], 'Dragon pickaxe', 'x/z.png',
   J({ source: 'dink', dedupe: 'only-from-2', from: 'Cow' })]);
ok('a hand-in from a monster the list leaves out is refused', NOPE.test(wrong ?? ''), wrong);
ok('in the words a tile in a locked region gets', wrong === locked, J([wrong, locked]));
ok('and nothing was written',
   (await db.query('select count(*)::int n from tile_evidence')).rows[0].n === before
   && (await db.query(`select count(*)::int n from plugin_intake_log where dedupe_key like 'only-from-_'`)).rows[0].n === 0);
const o = (await plugin('select plugin_open($1, $2, $3, $4, $5) j',
  [tok.mate, 'Mate Iron', T.barrows, opt["Dharok's helm"], "Dharok's helm"])).j;
const right = (await plugin('select plugin_submit($1,$2,$3,$4,$5,$6,null,$7::jsonb) j',
  [tok.mate, 'Mate Iron', T.barrows, opt["Dharok's helm"], "Dharok's helm", o.path_prefix + 'ok.png',
   J({ source: 'dink', dedupe: 'only-from-3', item: "Dharok's helm", from: 'Barrows' })])).j;
ok('from the monster on the list it is handed in', right.duplicate === false, J(right));

// A claimed square cannot be changed mid-game: admin_set_tile's rule, so
// the list stays as it was.
const claimed = await trying(asOrg, 'select admin_set_tile_with_from($1, 1::smallint, 1::smallint, $2::jsonb)',
  [g, J({ name: 'Barrows chest', rule: 'points', amount: 2, dropFrom: [],
          options: [{ label: "Dharok's helm", points: 1 }, { label: "Karil's coif", points: 1 }] })]);
ok("a square a team has started cannot get another list mid-game, by admin_set_tile's own rule",
   /locked that square in/.test(claimed ?? '') && J(await tileFrom(T.barrows)) === J(['Barrows']), claimed);

// ------------------------------------------------------------ the fences
const callers = async (sig) => (await db.query(`
  select r.rolname from pg_roles r where r.rolname in ('anon', 'service_role', 'authenticated')
     and has_function_privilege(r.rolname, $1, 'execute') order by 1`, [sig])).rows.map((x) => x.rolname);
for (const sig of ['admin_set_tile_with_from(uuid, smallint, smallint, jsonb)', 'admin_save_library_tile_with_from(uuid, jsonb)',
                   'admin_tiles_drop_from(uuid)', 'admin_library_drop_from()']) {
  ok(`${sig.split('(')[0]}: a signed-in caller only`, J(await callers(sig)) === J(['authenticated']), J(await callers(sig)));
}
for (const sig of ['plugin_from_ok(uuid, text)', 'plugin_wait_choices(text, text)', 'drop_from_clean(jsonb)']) {
  ok(`${sig.split('(')[0]}: nobody from outside`, J(await callers(sig)) === '[]', J(await callers(sig)));
}
ok('the old plugin_wait_choices is gone, so nothing calls it by mistake',
   (await db.query(`select count(*)::int n from pg_proc where proname = 'plugin_wait_choices'`)).rows[0].n === 1);
ok('add_evidence and tiles_for_team were not touched by this migration',
   !/function\s+(add_evidence|tiles_for_team)\b/i.test(
     (await import('node:fs')).readFileSync(new URL('../../../supabase/migrations/20261121160000_only_from.sql', import.meta.url), 'utf8')
       .replace(/^--.*$/gm, '')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
