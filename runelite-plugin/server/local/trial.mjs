// A trial game on the local stack, to try a real Dink client against the
// intake function. Not a test, and not the live project: it builds a Region
// Bingo game around the one real person who signed up on the local site
// (node site.mjs), and leaves it there to be played.
//
//   node trial.mjs              build it; you are captain of "Your team"
//   node trial.mjs report       what came in: the intake's log and the evidence
//   node trial.mjs organiser    make you an organiser, to see the review screen
//
// The board, for drops near Lumbridge. Misthalin (you pick it on the site):
//   Two cowhides       Cowhide, twice   one tile wants it: handed in, then done
//   Raw beef, one      Raw beef         two tiles want it: not handed in ("ask")
//   Raw beef, two      Raw beef
//   Feathers           Feather          from chickens
// Asgarnia, which the other team opens and you do not:
//   Bones              Bones            every cow and chicken drops it, and it
//                                       must never be handed in for you
//
// Everything is made through the doors the site uses, as in stack.test.mjs.
// The two helper accounts (an organiser and the other team's captain) get
// passwords made here and held in memory only.

import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const J = (v) => JSON.stringify(v);
const LOCAL = fileURLToPath(new URL('./', import.meta.url));
const besideRepo = fileURLToPath(new URL('../../../../tools/supabase-cli/supabase.exe', import.meta.url));
const SUPABASE = process.env.SUPABASE_BIN ?? (existsSync(besideRepo) ? besideRepo : 'supabase');
const DOCKER = process.env.DOCKER_BIN ?? 'docker';
const DB = 'supabase_db_hs-events-plugin-local';
const EDGE = 'supabase_edge_runtime_hs-events-plugin-local';
const NAME = 'Dink trial';

const status = JSON.parse(execFileSync(SUPABASE, ['status', '-o', 'json'],
  { cwd: LOCAL, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const { API_URL: API, ANON_KEY: ANON, SERVICE_ROLE_KEY: SERVICE } = status;
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(API ?? '') || !ANON || !SERVICE) {
  throw new Error('No local stack: run `supabase start` in runelite-plugin/server/local first');
}

const sql = (q) => execFileSync(DOCKER,
  ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'],
  { input: q, encoding: 'utf8' }).trim();
const sqlJson = (q) => JSON.parse(sql(`select coalesce(json_agg(t), '[]') from (${q}) t`));
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function must(fn, args, jwt) {
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: J(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// The one person who signed up on the site, which makes every address in its
// own domain (web/src/lib/auth.js). The tests and this script use others.
const real = sqlJson(`select p.id, p.display_name from profiles p join auth.users u on u.id = p.id
                       where u.email like '%@players.hs-battleships.invalid'`);
if (real.length !== 1) {
  throw new Error(real.length === 0
    ? 'Nobody has signed up on the local site yet: node site.mjs, then sign up at http://localhost:5177'
    : `More than one real account on the local stack (${real.map((r) => r.display_name).join(', ')}); this expects one`);
}
const me = real[0];
const game = sqlJson(`select id, created_at from games where name = ${lit(NAME)} order by created_at desc limit 1`)[0];

const mode = process.argv[2] ?? 'build';

if (mode === 'build') {
  if (game) throw new Error(`"${NAME}" is already built. \`supabase db reset\` starts over.`);
  const run = Date.now().toString(36);
  const person = async (key, name) => {
    const email = `${key}-${run}@plugin-trial.invalid`;
    const password = randomUUID();
    const made = await fetch(`${API}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
      body: J({ email, password, email_confirm: true, user_metadata: { display_name: name } }),
    });
    if (!made.ok) throw new Error(`creating ${key}: ${made.status} ${await made.text()}`);
    const id = (await made.json()).id;
    const signedIn = await fetch(`${API}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: J({ email, password }),
    });
    if (!signedIn.ok) throw new Error(`signing in ${key}: ${signedIn.status}`);
    return { id, jwt: (await signedIn.json()).access_token };
  };
  const org = await person('organiser', 'Trial organiser');
  const rival = await person('rival', 'Rival captain');
  // As on the live project: an organiser is made by SQL, never by the site.
  sql(`update profiles set is_admin = true where id = ${lit(org.id)}`);

  const g = await must('admin_new_game', { p_name: NAME, p_mode: 'regions', p_teams: ['Your team', 'Rivals'],
    p_grid_size: 3, p_ends_at: new Date(Date.now() + 7 * 86400e3).toISOString() }, org.jwt);
  const tile = async (square, worth, spec) => {
    await must('admin_set_tile', { p_game_id: g, p_row: Math.floor((square - 1) / 10) + 1,
      p_col: ((square - 1) % 10) + 1, p_tile: spec }, org.jwt);
    await must('admin_set_tile_worth', { p_game_id: g, p_position: square, p_worth: worth }, org.jwt);
  };
  const one = (label, name, amount = 1) => ({ name, rule: 'points', amount, options: [{ label, points: 1 }] });
  await tile(1, 5, one('Cowhide', 'Two cowhides', 2));
  await tile(2, 2, one('Raw beef', 'Raw beef, one'));
  await tile(3, 2, one('Raw beef', 'Raw beef, two'));
  await tile(4, 2, one('Feather', 'Feathers'));
  await tile(101, 4, one('Bones', 'Bones'));
  // Every other region needs a tile for the board to be whole.
  for (let k = 3; k <= 11; k++) await tile((k - 1) * 100 + 1, 1, { name: `Filler ${k}` });

  const team = Object.fromEntries(sqlJson(`select name, id from teams where game_id = ${lit(g)}`).map((r) => [r.name, r.id]));
  await must('admin_set_member', { p_team_id: team['Your team'], p_profile_id: me.id, p_role: 'captain' }, org.jwt);
  await must('admin_set_member', { p_team_id: team.Rivals, p_profile_id: rival.id, p_role: 'captain' }, org.jwt);
  await must('start_game', { p_game_id: g }, org.jwt);
  await must('regions_pick', { p_game_id: g, p_region: 'asgarnia' }, rival.jwt);

  console.log(`"${NAME}" is built and started. ${me.display_name} is captain of "Your team".`);
  console.log('The Rivals have opened Asgarnia, so its Bones tile is locked for you.');
  console.log('Next, on http://localhost:5177: add your in-game name under My Account, make a plugin token,');
  console.log('put its link in Dink, then open the game and pick Misthalin.');
} else if (mode === 'report') {
  if (!game) throw new Error(`No "${NAME}" yet: node trial.mjs`);
  const logs = spawnSync(DOCKER, ['logs', '--since', new Date(game.created_at).toISOString(), EDGE], { encoding: 'utf8' });
  const lines = ((logs.stdout ?? '') + (logs.stderr ?? '')).split('\n').filter((l) => l.includes('{"outcome"'));
  console.log(`The intake function, since the game was built: ${lines.length} request(s)`);
  for (const l of lines) console.log('  ' + l.slice(l.indexOf('{"outcome"')));
  // Never a token in this log; stack.test.mjs checks that. Said here as well.
  if (lines.some((l) => /hse_[0-9a-f]{8}/.test(l))) console.log('  !! a token appeared in the log');

  const ev = sqlJson(`select tm.name team, t.name tile, e.source, e.detail, e.created_at
      from tile_evidence e join tile_claims c on c.id = e.claim_id join tiles t on t.id = c.tile_id
      join teams tm on tm.id = e.team_id where t.game_id = ${lit(game.id)} order by e.created_at`);
  console.log(`\nEvidence in "${NAME}": ${ev.length}`);
  for (const e of ev) {
    const d = e.detail ?? {};
    console.log(`  ${e.created_at.slice(11, 19)}  ${e.team} / ${e.tile}  ${e.source}`
      + (e.source === 'web' ? '' : `  ${d.item} x${d.quantity} from ${d.from} (${d.category}), ${d.rsn}, world ${d.world}, region ${d.region_id}, ${d.dink_type}`
        + (d.resized_from ? `, made smaller from ${d.resized_from}` : '')));
  }
  const claims = sqlJson(`select t.name tile, c.status from tile_claims c join tiles t on t.id = c.tile_id
      join teams tm on tm.id = c.team_id where t.game_id = ${lit(game.id)} and tm.name = 'Your team' order by t.position`);
  console.log(`\nYour team's opened tiles: ${claims.map((c) => `${c.tile} (${c.status})`).join(', ') || 'none'}`);
  const bones = ev.filter((e) => e.team === 'Your team' && e.tile === 'Bones').length;
  console.log(`Bones handed in for you (the locked tile; must be 0): ${bones}`);
} else if (mode === 'organiser') {
  sql(`update profiles set is_admin = true where id = ${lit(me.id)}`);
  console.log(`${me.display_name} is an organiser on the local stack now: the console shows "${NAME}" and its evidence.`);
} else {
  throw new Error('node trial.mjs [build | report | organiser]');
}
