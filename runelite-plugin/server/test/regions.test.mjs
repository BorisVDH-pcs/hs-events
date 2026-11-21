// The plugin migrations (plugin_tokens.sql, plugin_drops.sql) against the real Region Bingo rules: every
// migration in supabase/migrations is replayed into PGlite first, so
// tiles_for_team, regions_open_tile and add_evidence here are the real ones.
//
// The game is built through the functions the console calls, and "the site"
// below means a signed-in player calling the functions the site calls. A
// plugin call is made as the service role with a token, one transaction per
// call, which is how the intake Edge Function will reach PostgREST.
//
//   node regions.test.mjs

import { buildGame, J } from './fixture.mjs';

const { db, ids, g, team, T, opt, tok, site, plugin, trying } = await buildGame();

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : '  -- ' + extra}`);
};

ok('the board was built with its drops', Object.keys(opt).length === 5, J(Object.keys(opt)));

// What a token's team can hand in right now: plugin_wanted, the list every
// match is made against, read as that token's player. Internal, so it is read
// here as the database owner after plugin_as, in one transaction, which is
// exactly how plugin_match reaches it.
const wanted = async (key) => db.transaction(async (tx) => {
  await tx.query('select plugin_as($1)', [tok[key]]);
  return (await tx.query('select * from plugin_wanted() order by tile_position, label')).rows;
});
const match = async (key, rsn, names) =>
  (await plugin('select plugin_match($1, $2, $3::jsonb) j', [tok[key], rsn, J(names.map((name) => ({ name })))])).j;
const verdicts = (m) => m.items.map((i) => i.verdict).join(',');

// ------------------------------------------------- before the first region
let w = await wanted('mate');
ok('before the first pick: nothing to hand in', w.length === 0, J(w).slice(0, 300));
ok('and no tile name is in what a drop is matched against',
   !/Barrows|helmet|Whip|Locked|Dragon/.test(J(w)), J(w).slice(0, 300));
ok('a drop matches nothing yet',
   verdicts(await match('mate', 'Mate Iron', ["Dharok's helm"])) === 'none');

// Picking a region stays on the site.
await site(ids.red, `select regions_pick($1, 'misthalin')`, [g]);
await site(ids.blue, `select regions_pick($1, 'asgarnia')`, [g]);

// ------------------------------------------------ what a drop can match
w = await wanted('mate');
const labels = w.map((x) => x.label).sort();
ok("Red can hand in Misthalin's drops, and only those",
   J(labels) === J(['Abyssal whip', "Dharok's helm", 'Dharoks helm', "Karil's coif"]), J(labels));
ok('each one carries its tile, option and key',
   w.every((x) => x.tile_id && x.option_id && x.drop && x.region === 'misthalin' && x.game_id === g), J(w[0]));
ok("a region Red has not opened is not in it: no tile name, no drop",
   !/Locked secret|Dragon pickaxe/.test(J(w)), J(w).slice(0, 400));

const wb = await wanted('blue');
ok("Blue can hand in Asgarnia's, and none of Red's",
   J(wb.map((x) => x.label)) === J(['Dragon pickaxe']) && !/Barrows|Whip|helmet/.test(J(wb)), J(wb).slice(0, 300));
ok('someone on no team can hand in nothing', (await wanted('out')).length === 0);
ok("an organiser's token carries no organiser's view", (await wanted('org')).length === 0);

// --------------------------------------------------------------- matching
let m = await match('mate', 'Mate Iron', ['Abyssal whip', "Dharok's helm", 'Dragon pickaxe', 'Bones']);
ok('one tile wants it: one. Two tiles: ask. Locked region: none. Junk: none',
   m.account_ok && verdicts(m) === 'one,ask,none,none', J(m).slice(0, 300));
ok('a locked tile and no tile give the same answer',
   J({ ...m.items[2], name: 0 }) === J({ ...m.items[3], name: 0 }), J(m.items.slice(2)));
ok('an ask names both tiles, so the player can choose',
   m.items[1].matches.length === 2 && m.items[1].matches.some((x) => x.tile === 'Any helmet'));
ok('spelling does not matter', verdicts(await match('mate', 'mate_iron', ['ABYSSAL  WHIP'])) === 'one');
// The game puts a non-breaking space between the words of a name, and Dink
// sends the name as the game gives it. rsn_key does not fold that space.
ok("the game's non-breaking space in a name is a space",
   verdicts(await match('mate', 'Mate Iron', ['Abyssal whip'])) === 'one');
m = await match('mate', 'Blue Main', ['Abyssal whip']);
ok("somebody else's in-game name is not accepted", m.account_ok === false && m.items.length === 0, J(m));

// ------------------------------------------------------------ handing in
const open = (key, rsn, tileId, optionId, item) =>
  plugin('select plugin_open($1, $2, $3, $4, $5) j', [tok[key], rsn, tileId, optionId, item]);
const submit = (key, rsn, tileId, optionId, item, path, detail) =>
  plugin('select plugin_submit($1, $2, $3, $4, $5, $6, null, $7::jsonb) j',
         [tok[key], rsn, tileId, optionId, item, path, J(detail)]);

const o1 = (await open('mate', 'Mate Iron', T.barrows, opt["Karil's coif"], "Karil's coif")).j;
ok('plugin_open answers where the screenshot goes',
   o1.path_prefix === `${g}/${team.Red}/${o1.claim_id}/` && o1.team_id === team.Red, J(o1));

const s1 = (await submit('mate', 'Mate Iron', T.barrows, opt["Karil's coif"], "Karil's coif",
  o1.path_prefix + 'a.jpg', { source: 'dink', dedupe: 'drop-0001', item: "Karil's coif", world: 302 })).j;
ok('the drop is handed in', s1.duplicate === false, J(s1));

let ev = (await db.query('select * from tile_evidence where claim_id = $1', [o1.claim_id])).rows;
ok('as one piece of evidence, by that player, for their team',
   ev.length === 1 && ev[0].uploaded_by === ids.mate && ev[0].team_id === team.Red, J(ev));
ok('the points come from the option, not from the plugin', ev[0].points === 1 && ev[0].option_id === opt["Karil's coif"]);
ok("it says where it came from: 'dink', with what was reported",
   ev[0].source === 'dink' && ev[0].detail.item === "Karil's coif" && ev[0].detail.world === 302 && !('dedupe' in ev[0].detail),
   J([ev[0].source, ev[0].detail]));
const evt = (await db.query(
  `select payload from game_events where game_id = $1 and type = 'evidence_submitted' order by created_at desc limit 1`, [g])).rows[0];
ok('the team gets its usual private feed line', evt && /Barrows chest/.test(J(evt.payload)), J(evt));

const s1b = (await submit('mate', 'Mate Iron', T.barrows, opt["Karil's coif"], "Karil's coif",
  o1.path_prefix + 'a-again.jpg', { source: 'dink', dedupe: 'drop-0001' })).j;
ok('the same drop sent twice counts once',
   s1b.duplicate === true
   && (await db.query('select count(*)::int n from tile_evidence where claim_id = $1', [o1.claim_id])).rows[0].n === 1, J(s1b));

// The site's own upload is what it was.
const cWhip = (await site(ids.red, 'select regions_open_tile($1) c', [T.whip]))[0].c;
await site(ids.red, 'select add_evidence($1, $2, null, $3, null)',
  [cWhip, `${g}/${team.Red}/${cWhip}/site.webp`, opt['Abyssal whip']]);
ev = (await db.query('select source, detail from tile_evidence where claim_id = $1', [cWhip])).rows;
ok("an upload from the site is still 'web', with no detail", ev.length === 1 && ev[0].source === 'web' && ev[0].detail === null, J(ev));

// -------------------------------------------------------------- refusals
const NOPE = /does not count for an open tile/;
const r = {
  wrongItem: await trying(plugin, 'select plugin_submit($1,$2,$3,$4,$5,$6,null,$7::jsonb)',
    [tok.mate, 'Mate Iron', T.barrows, opt["Dharok's helm"], 'Abyssal whip', o1.path_prefix + 'b.jpg', J({ dedupe: 'drop-0002' })]),
  locked: await trying(plugin, 'select plugin_open($1,$2,$3,$4,$5)',
    [tok.mate, 'Mate Iron', T.locked, opt['Dragon pickaxe'], 'Dragon pickaxe']),
  noSuch: await trying(plugin, 'select plugin_open($1,$2,$3,$4,$5)',
    [tok.mate, 'Mate Iron', '00000000-0000-0000-0000-000000000001', opt['Dragon pickaxe'], 'Dragon pickaxe']),
  blueOnRed: await trying(plugin, 'select plugin_open($1,$2,$3,$4,$5)',
    [tok.blue, 'Blue Main', T.barrows, opt["Dharok's helm"], "Dharok's helm"]),
  wrongName: await trying(plugin, 'select plugin_open($1,$2,$3,$4,$5)',
    [tok.mate, 'Blue Main', T.barrows, opt["Dharok's helm"], "Dharok's helm"]),
  otherPath: await trying(plugin, 'select plugin_submit($1,$2,$3,$4,$5,$6,null,$7::jsonb)',
    [tok.mate, 'Mate Iron', T.barrows, opt["Dharok's helm"], "Dharok's helm",
     `${g}/${team.Blue}/${o1.claim_id}/x.jpg`, J({ dedupe: 'drop-0003' })]),
  noDedupe: await trying(plugin, 'select plugin_submit($1,$2,$3,$4,$5,$6,null,$7::jsonb)',
    [tok.mate, 'Mate Iron', T.barrows, opt["Dharok's helm"], "Dharok's helm", o1.path_prefix + 'c.jpg', J({})]),
};
ok('an item that is not that option is refused', NOPE.test(r.wrongItem ?? ''), r.wrongItem);
ok('a tile in a locked region is refused', NOPE.test(r.locked ?? ''), r.locked);
ok('in the very words used for a tile that does not exist', r.locked !== null && r.locked === r.noSuch, J([r.locked, r.noSuch]));
ok("Blue's token cannot hand in on Red's tile", NOPE.test(r.blueOnRed ?? ''), r.blueOnRed);
ok("another player's in-game name is refused", /not on your account list/.test(r.wrongName ?? ''), r.wrongName);
ok("a path under another team is refused by add_evidence itself", r.otherPath !== null && !NOPE.test(r.otherPath), r.otherPath);
ok('a submission without a dedupe key is refused', /dedupe/.test(r.noDedupe ?? ''), r.noDedupe);
ok('none of the refusals left evidence behind',
   (await db.query('select count(*)::int n from tile_evidence where team_id = $1', [team.Red])).rows[0].n === 2);
ok('or a line in the intake log',
   (await db.query('select count(*)::int n from plugin_intake_log')).rows[0].n === 1);

// ------------------------------------------------------ completing a tile
const s2 = (await submit('mate', 'Mate Iron', T.barrows, opt["Dharok's helm"], "Dharok's helm",
  o1.path_prefix + 'd.jpg', { source: 'plugin', dedupe: 'drop-0004', item: "Dharok's helm" })).j;
const claim = (await db.query('select status from tile_claims where id = $1', [o1.claim_id])).rows[0];
ok('the second drop completes the tile, by the tile\'s own rule', claim.status === 'completed', J([claim, s2]));
ok('and the game says so, as it does for an upload from the site',
   (await db.query(`select count(*)::int n from game_events where game_id = $1 and team_id = $2 and type = 'tile_completed'`,
     [g, team.Red])).rows[0].n >= 1);
w = await wanted('mate');
ok('a completed tile can no longer be handed in',
   !w.some((x) => x.tile_id === T.barrows), J(w.map((x) => x.tile_name)));
ok("so Dharok's helm is no longer a question: one tile wants it",
   verdicts(await match('mate', 'Mate Iron', ["Dharok's helm"])) === 'one');

// ------------------------------------------- the review screen's label
// Red now has three pieces of evidence: Karil's coif from Dink, the whip
// uploaded on the site, and Dharok's helm from the plugin.
const sources = async (who, game = g) =>
  site(who, 'select * from admin_evidence_sources($1) order by source', [game]);
let src = await sources(ids.org);
ok("an organiser is told which evidence a plugin sent: 'dink' and 'plugin'",
   J(src.map((x) => x.source)) === J(['dink', 'plugin']), J(src));
ok('with what was reported', src[0].detail.item === "Karil's coif" && src[0].detail.world === 302, J(src[0]));
const siteUpload = (await db.query('select id from tile_evidence where claim_id = $1', [cWhip])).rows[0].id;
ok('the upload from the site is not among them',
   !src.some((x) => x.id === siteUpload) && src.length === 2, J(src));
const listed = (await site(ids.org, 'select id, storage_path from admin_list_evidence($1)', [g]));
ok('every row is one the review screen already lists, by its id',
   src.every((x) => listed.some((l) => l.id === x.id)) && listed.length === 3, J(listed));
ok("the site's upload is the one row with no label",
   listed.filter((l) => !src.some((x) => x.id === l.id)).map((l) => l.storage_path).join() === `${g}/${team.Red}/${cWhip}/site.webp`,
   J(listed));

// A moderator of this mode runs this game, so sees the same.
await site(ids.org, `select admin_set_moderator_modes($1, array['regions']::game_mode[])`, [ids.out]);
ok("a moderator of Region Bingo is told the same", J((await sources(ids.out)).map((x) => x.source)) === J(['dink', 'plugin']));
await site(ids.org, `select admin_set_moderator_modes($1, array['battleships']::game_mode[])`, [ids.out]);
const otherMode = await trying(site.bind(null, ids.out), 'select * from admin_evidence_sources($1)', [g]);
ok('a moderator of another mode is not', /Not your game/.test(otherMode ?? ''), otherMode);
await site(ids.org, `select admin_set_moderator_modes($1, array[]::game_mode[])`, [ids.out]);

// The second secret. A player who could read this would learn the item names
// on the other team's tiles, and through them tiles in regions they have not
// opened. Refused in the words admin_list_evidence uses.
const blueAsks = await trying(site.bind(null, ids.blue), 'select * from admin_evidence_sources($1)', [g]);
const blueList = await trying(site.bind(null, ids.blue), 'select * from admin_list_evidence($1)', [g]);
ok("a player on the other team is refused", /Not your game/.test(blueAsks ?? ''), blueAsks);
ok('in the same words as the evidence list itself', blueAsks === blueList, J([blueAsks, blueList]));
const mateAsks = await trying(site.bind(null, ids.mate), 'select * from admin_evidence_sources($1)', [g]);
ok('and so is a player on the team that sent it', /Not your game/.test(mateAsks ?? ''), mateAsks);
const noGame = await trying(site.bind(null, ids.blue), 'select * from admin_evidence_sources($1)',
  ['00000000-0000-0000-0000-000000000001']);
ok('a game that does not exist gets the same answer as a game that is not yours', noGame === blueAsks, J([noGame, blueAsks]));
const fromOutside = await db.query(`
  select r.rolname from pg_roles r
   where r.rolname in ('anon', 'service_role', 'authenticated')
     and has_function_privilege(r.rolname, 'admin_evidence_sources(uuid)', 'execute') order by 1`);
ok('only a signed-in caller may ask at all: not anon, not the service role',
   J(fromOutside.rows.map((x) => x.rolname)) === J(['authenticated']), J(fromOutside.rows));

// ------------------------------------- under the picture, in a tile's panel
// evidence_sources: the same lines for the panel a team opens on its own
// board, asked by evidence id. Blue hands in a Dink drop on the tile in
// Asgarnia, which Blue opened and Red has not.
const oBlue = (await open('blue', 'Blue Main', T.locked, opt['Dragon pickaxe'], 'Dragon pickaxe')).j;
await submit('blue', 'Blue Main', T.locked, opt['Dragon pickaxe'], 'Dragon pickaxe', oBlue.path_prefix + 'p.jpg',
  { source: 'dink', dedupe: 'drop-blue-1', item: 'Dragon pickaxe', quantity: 1, from: 'Chaos Elemental', world: 330 });
const allIds = (await db.query(
  'select e.id from tile_evidence e join tile_claims c on c.id = e.claim_id join tiles t on t.id = c.tile_id where t.game_id = $1',
  [g])).rows.map((x) => x.id);
const blueDrop = (await db.query('select id from tile_evidence where claim_id = $1', [oBlue.claim_id])).rows[0].id;
const NOBODY = '00000000-0000-0000-0000-000000000002';
const panel = (who, list) => site(who, 'select * from evidence_sources($1::uuid[]) order by source', [list]);

src = await panel(ids.mate, allIds);
ok("a player is told what Dink reported for their own team's drops, and only those",
   J(src.map((x) => x.source)) === J(['dink', 'plugin']) && src[0].detail.item === "Karil's coif"
   && !src.some((x) => x.id === blueDrop), J(src));
ok('the same for everyone on that team', J(await panel(ids.red, allIds)) === J(src));
ok('the upload from the site has no lines: nothing comes back for it',
   (await panel(ids.mate, [siteUpload])).length === 0);
ok("Red asking for Blue's drop, on a tile in a region Red has not opened, gets nothing",
   J(await panel(ids.mate, [blueDrop])) === '[]');
ok('the same answer as for evidence that does not exist: no error, no difference',
   J(await panel(ids.mate, [blueDrop])) === J(await panel(ids.mate, [NOBODY]))
   && (await trying(site.bind(null, ids.mate), 'select * from evidence_sources($1::uuid[])', [[blueDrop]])) === null);
ok("Blue is told about Blue's drop, and nothing of Red's",
   J((await panel(ids.blue, allIds)).map((x) => x.detail.item)) === J(['Dragon pickaxe']));
ok('someone on no team gets nothing', (await panel(ids.out, allIds)).length === 0);
ok("the organiser running the game is told about both teams' drops",
   (await panel(ids.org, allIds)).length === 3);
ok('nothing comes back for no ids at all', (await panel(ids.mate, [])).length === 0);
const panelFromOutside = await db.query(`
  select r.rolname from pg_roles r
   where r.rolname in ('anon', 'service_role', 'authenticated')
     and has_function_privilege(r.rolname, 'evidence_sources(uuid[])', 'execute') order by 1`);
ok('a signed-in caller may ask, not anon, not the service role',
   J(panelFromOutside.rows.map((x) => x.rolname)) === J(['authenticated']), J(panelFromOutside.rows));

// ------------------------------------------------------------ the fences
const direct = await trying(site.bind(null, ids.mate), 'select plugin_match($1, $2, $3::jsonb)',
  [tok.mate, 'Mate Iron', J([{ name: "Dharok's helm" }])]);
ok('a signed-in player cannot call a token function directly', /permission denied/.test(direct ?? ''), direct);
const asPlayer = await trying(site.bind(null, ids.mate), 'select * from plugin_wanted()');
ok('nor the internal ones', /permission denied/.test(asPlayer ?? ''), asPlayer);
const asService = await trying(plugin, 'select plugin_as($1)', [tok.mate]);
ok('the service role cannot call plugin_as on its own', /permission denied/.test(asService ?? ''), asService);
const fns = (await db.query(`
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'plugin\\_%'
     and has_function_privilege('service_role', p.oid, 'execute') order by 1`)).rows.map((x) => x.proname);
// plugin_wait_open and plugin_wait keep a drop two tiles want (waiting.test.mjs).
ok('the service role can call exactly the seven the intake uses',
   J(fns) === J(['plugin_leftover_files', 'plugin_leftovers_removed', 'plugin_match', 'plugin_open', 'plugin_submit', 'plugin_wait', 'plugin_wait_open']), J(fns));
ok('a token cannot spend a pick: no plugin function touches regions_pick',
   (await db.query(`select count(*)::int n from pg_proc where proname like 'plugin\\_%' and prosrc ilike '%regions_pick%'`)).rows[0].n === 0);

const idMate = (await db.query('select id from plugin_tokens where profile_id = $1', [ids.mate])).rows[0].id;
await site(ids.mate, 'select plugin_token_revoke($1)', [idMate]);
const revoked = await trying(plugin, 'select plugin_match($1, $2, $3::jsonb)',
  [tok.mate, 'Mate Iron', J([{ name: "Dharok's helm" }])]);
ok('a revoked token matches nothing: refused', /Unknown or revoked/.test(revoked ?? ''), revoked);

// Time up: the rule lives in add_evidence, and the plugin gets no way round it.
const oLate = (await open('red', 'Red Main', T.helmet, opt['Dharoks helm'], "Dharok's helm")).j;
await db.query(`update games set ends_at = now() - interval '1 minute' where id = $1`, [g]);
const late = await trying(plugin, 'select plugin_submit($1,$2,$3,$4,$5,$6,null,$7::jsonb)',
  [tok.red, 'Red Main', T.helmet, opt['Dharoks helm'], "Dharok's helm",
   oLate.path_prefix + 'late.jpg', J({ dedupe: 'drop-0005' })]);
ok('after the game has run out, a drop is refused, by the game\'s own rule',
   late !== null && !/does not count|dedupe|account list/.test(late), late);
console.log('     (the path refusal: ' + r.otherPath + ')');
console.log('     (the time-up refusal: ' + late + ')');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
