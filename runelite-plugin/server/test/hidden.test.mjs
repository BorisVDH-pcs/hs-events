// Hidden games (Boris, 2026-11-21; supabase/migrations/20261121140000_hidden_games.sql).
//
// A switch on each board game: hidden, it is left off the sign-up list for
// everyone but its organisers, its roster and the people who signed up, and
// only an organiser can sign up for it. Nothing about playing it changes,
// Drops from Dink included. Offline, on the replay of every migration.
//
// The login page's "Now running" reads `games` itself and filters on the
// column; that half is checked on the local stack (stack.test.mjs) and in
// the browser, not here.
//
//   node hidden.test.mjs

import { buildGame, J } from './fixture.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : '  -- ' + extra}`);
};

const { db, ids, tok, site, plugin, trying, g, team } = await buildGame();
const as = (who) => site.bind(null, who);
const msg = (m) => (m ?? '').replace(/^error: /i, '');

const newGame = async (name, mode = 'regions') => (await site(ids.org,
  `select admin_new_game($1, $2, array['A','B'], 3::smallint, now() + interval '1 day') id`, [name, mode]))[0].id;
const hiddenOf = async (game) => (await db.query('select hidden from games where id = $1', [game])).rows[0].hidden;
const hide = (who, game, on) => site(who, 'select admin_set_game_hidden($1, $2) j', [game, on]).then((r) => r[0].j);
const hideMsg = (who, game, on) => trying(as(who), 'select admin_set_game_hidden($1, $2)', [game, on]).then(msg);
const listed = async (who, game) =>
  (await site(who, 'select game_signup_list() j'))[0].j.some((r) => r.game_id === game);
const join = (who, game) => trying(as(who), 'select game_signup_join($1)', [game]).then(msg);

// ------------------------------------------------------------ off by default
const open = await newGame('Open event');
const test = await newGame('Test, please ignore');
ok('a new game is not hidden', (await hiddenOf(open)) === false && (await hiddenOf(test)) === false);
ok('every game made before the switch is not hidden', (await hiddenOf(g)) === false);

// ----------------------------------------------------------------- the switch
ok('an organiser hides a game', (await hide(ids.org, test, true)) === true && (await hiddenOf(test)) === true);
ok('a player cannot', (await hideMsg(ids.red, test, false)) === 'Not your game' && (await hiddenOf(test)) === true);
ok('nor somebody in no game at all', (await hideMsg(ids.out, open, true)) === 'Not your game'
   && (await hiddenOf(open)) === false);
ok('hidden or not has to be said', (await hideMsg(ids.org, test, null)) === 'Say hidden or not');
const ghost = await hideMsg(ids.org, '00000000-0000-0000-0000-000000000001', true);
ok('a game that does not exist is refused', ghost === 'No such game', ghost);

const anonMsg = await db.transaction(async (tx) => {
  await tx.query('set local role anon');
  await tx.query('select admin_set_game_hidden($1, true)', [open]);
}).then(() => null, (e) => e.message);
ok('signed out, the switch cannot be called at all', /permission denied/i.test(anonMsg ?? ''), anonMsg);

// ----------------------------------------------------------- the sign-up list
ok('an open game in preparation is on everyone’s list',
   (await listed(ids.out, open)) && (await listed(ids.red, open)));
ok('a hidden one is on nobody’s list who is not in it', !(await listed(ids.out, test)) && !(await listed(ids.red, test)));
ok('it is on the organiser’s', await listed(ids.org, test));

await site(ids.org, 'select game_signup_join($1)', [test]);
ok('an organiser can sign up for a hidden game', (await listed(ids.org, test)));

const testTeam = (await db.query(`select id from teams where game_id = $1 and name = 'A'`, [test])).rows[0].id;
await site(ids.org, `select admin_set_member($1, $2, 'captain')`, [testTeam, ids.mate]);
ok('a player put on its roster by hand sees it', await listed(ids.mate, test));
ok('the others still do not', !(await listed(ids.out, test)) && !(await listed(ids.blue, test)));

// Signed up while it was open, then hidden: still theirs.
const later = await newGame('Hidden later');
await site(ids.blue, 'select game_signup_join($1)', [later]);
await hide(ids.org, later, true);
ok('somebody who signed up before it was hidden still sees it', await listed(ids.blue, later));
ok('and somebody who did not, does not', !(await listed(ids.out, later)));

// --------------------------------------------------------- signing up for one
const nowhere = await join(ids.out, '00000000-0000-0000-0000-000000000002');
const hiddenJoin = await join(ids.out, test);
ok('a player cannot sign up for a hidden game, with the answer a game that does not exist gets',
   hiddenJoin === 'No such event' && hiddenJoin === nowhere, J([hiddenJoin, nowhere]));
ok('so nothing was written',
   (await db.query('select count(*)::int n from game_signups where game_id = $1 and profile_id = $2', [test, ids.out]))
     .rows[0].n === 0);

// ------------------------------------------------------------------ unhiding
ok('an organiser can show it again', (await hide(ids.org, test, false)) === false);
ok('and then it is on everyone’s list, and open to sign-ups',
   (await listed(ids.out, test)) && (await join(ids.out, test)) === '');

// ------------------------------------------------------------ challenges
const challenge = await trying(as(ids.org),
  `select admin_new_challenge(p_name => 'Challenge', p_starts_at => now() + interval '1 day',
     p_ends_at => now() + interval '2 days', p_solo => true, p_declared_label => 'Kills',
     p_declared_unit => 'count')`, []).then(msg);
const ch = (await db.query(`select id from games where mode = 'challenge' order by created_at desc limit 1`)).rows[0]?.id;
ok('a challenge cannot be hidden: its list is the only way in',
   ch && (await hideMsg(ids.org, ch, true)) === 'A challenge cannot be hidden: its list is the only way in',
   challenge);
ok('though saying "not hidden" to one is fine', ch && (await hide(ids.org, ch, false)) === false);

// ------------------------------------------------ playing it does not change
// The fixture's own Region Bingo, started, Dink on: hidden, a drop still counts.
await site(ids.red, `select regions_pick($1, 'misthalin')`, [g]);
await hide(ids.org, g, true);
const whip = (await plugin('select plugin_match($1, $2, $3::jsonb) j',
  [tok.red, 'Red Main', J([{ name: 'Abyssal whip' }])])).j.items[0];
ok('a hidden game still takes Drops from Dink, as before', whip.verdict === 'one', J(whip));
const board = (await site(ids.red, 'select board_for_me($1) j', [g]))[0].j ?? {};
const boardTiles = Array.isArray(board.tiles) ? board.tiles.length : 0;
ok('and its players still get their board', boardTiles > 0, J(Object.keys(board)));

// Nothing else reads the column: the switch and the two sign-up functions only.
const readers = (await db.query(
  `select string_agg(proname, ',' order by proname) s from pg_proc
    where pronamespace = 'public'::regnamespace and prosrc ~ '\\mhidden\\M'`)).rows[0].s;
ok('only the switch and the two sign-up functions read it',
   readers === 'admin_set_game_hidden,game_signup_join,game_signup_list', readers);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
