// The plugin drafts (001, 002) against the real Region Bingo rules: every
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

const watch = async (key) => (await plugin('select plugin_watchlist($1) j', [tok[key]])).j;
const match = async (key, rsn, names) =>
  (await plugin('select plugin_match($1, $2, $3::jsonb) j', [tok[key], rsn, J(names.map((name) => ({ name })))])).j;
const verdicts = (m) => m.items.map((i) => i.verdict).join(',');

// ------------------------------------------------- before the first region
let w = await watch('mate');
ok('before the first pick: the game is listed, with nothing to hand in',
   w.length === 1 && w[0].game_id === g && w[0].wanted.length === 0, J(w).slice(0, 300));
ok('and no tile name has reached the plugin',
   !/Barrows|helmet|Whip|Locked|Dragon/.test(J(w)), J(w).slice(0, 300));
ok('a drop matches nothing yet',
   verdicts(await match('mate', 'Mate Iron', ["Dharok's helm"])) === 'none');

// Picking a region stays on the site.
await site(ids.red, `select regions_pick($1, 'misthalin')`, [g]);
await site(ids.blue, `select regions_pick($1, 'asgarnia')`, [g]);

// --------------------------------------------------------- the watch list
w = await watch('mate');
const labels = w[0].wanted.map((x) => x.label).sort();
ok("Red's watch list is Misthalin's drops",
   J(labels) === J(['Abyssal whip', "Dharok's helm", 'Dharoks helm', "Karil's coif"]), J(labels));
ok('each one carries its tile, option and key',
   w[0].wanted.every((x) => x.tile_id && x.option_id && x.drop && x.region === 'misthalin'), J(w[0].wanted[0]));
ok("a region Red has not opened is not in it: no tile name, no drop",
   !/Locked secret|Dragon pickaxe/.test(J(w)), J(w).slice(0, 400));
ok('it carries the region standings for the side panel', w[0].regions && typeof w[0].regions === 'object');

const wb = await watch('blue');
ok("Blue's watch list is Asgarnia's, and none of Red's",
   J(wb[0].wanted.map((x) => x.label)) === J(['Dragon pickaxe']) && !/Barrows|Whip|helmet/.test(J(wb)), J(wb).slice(0, 300));
ok('someone on no team gets an empty list', J(await watch('out')) === '[]');
ok("an organiser's token carries no organiser's view", J(await watch('org')) === '[]');

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
w = await watch('mate');
ok('a completed tile leaves the watch list',
   !w[0].wanted.some((x) => x.tile_id === T.barrows), J(w[0].wanted.map((x) => x.tile)));
ok("so Dharok's helm is no longer a question: one tile wants it",
   verdicts(await match('mate', 'Mate Iron', ["Dharok's helm"])) === 'one');
ok('the region standings moved', J(w[0].regions) !== '{}' && /misthalin/.test(J(w[0].regions)));

// ------------------------------------------------------------ the fences
const direct = await trying(site.bind(null, ids.mate), 'select plugin_watchlist($1)', [tok.mate]);
ok('a signed-in player cannot call a token function directly', /permission denied/.test(direct ?? ''), direct);
const asPlayer = await trying(site.bind(null, ids.mate), 'select * from plugin_wanted()');
ok('nor the internal ones', /permission denied/.test(asPlayer ?? ''), asPlayer);
const asService = await trying(plugin, 'select plugin_as($1)', [tok.mate]);
ok('the service role cannot call plugin_as on its own', /permission denied/.test(asService ?? ''), asService);
const fns = (await db.query(`
  select p.proname from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'plugin\\_%'
     and has_function_privilege('service_role', p.oid, 'execute') order by 1`)).rows.map((x) => x.proname);
ok('the service role can call exactly the five token functions',
   J(fns) === J(['plugin_match', 'plugin_open', 'plugin_submit', 'plugin_watchlist', 'plugin_whoami']), J(fns));
ok('a token cannot spend a pick: no plugin function touches regions_pick',
   (await db.query(`select count(*)::int n from pg_proc where proname like 'plugin\\_%' and prosrc ilike '%regions_pick%'`)).rows[0].n === 0);

const idMate = (await db.query('select id from plugin_tokens where profile_id = $1', [ids.mate])).rows[0].id;
await site(ids.mate, 'select plugin_token_revoke($1)', [idMate]);
const revoked = await trying(plugin, 'select plugin_watchlist($1)', [tok.mate]);
ok('a revoked token reads nothing', /Unknown or revoked/.test(revoked ?? ''), revoked);

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
