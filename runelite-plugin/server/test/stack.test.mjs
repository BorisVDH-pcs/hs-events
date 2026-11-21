// The plugin drafts on a real Supabase stack: the CLI's local one, started
// from server/local (see that folder's prepare.mjs). Not the live project.
//
// Everything goes through the doors the site and the intake function use:
// users through Supabase Auth, the game through PostgREST with real sign-ins,
// screenshots through Storage, and the plugin_* functions through PostgREST
// with the service role. Only two things use SQL directly, as on the live
// project: making the organiser an admin, and reading what was stored.
//
// The stack's keys are read from `supabase status` while this runs. They are
// the local stack's own development keys, held in memory and never printed.
//
//   cd ../local && node prepare.mjs && supabase start
//   node stack.test.mjs            (SUPABASE_BIN / DOCKER_BIN if not on PATH)
//
// Not part of `npm test`, which needs nothing running.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const J = (v) => JSON.stringify(v);
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : '  -- ' + String(extra).slice(0, 400)}`);
};

// ------------------------------------------------------------- the stack
const LOCAL = fileURLToPath(new URL('../local/', import.meta.url));
const SUPABASE = process.env.SUPABASE_BIN ?? 'supabase';
const DOCKER = process.env.DOCKER_BIN ?? 'docker';
const DB_CONTAINER = 'supabase_db_hs-events-plugin-local';

const status = JSON.parse(execFileSync(SUPABASE, ['status', '-o', 'json'],
  { cwd: LOCAL, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const API = status.API_URL;
const ANON = status.ANON_KEY;
const SERVICE = status.SERVICE_ROLE_KEY;
if (!API || !ANON || !SERVICE) throw new Error('supabase status gave no API URL or keys: is the stack running?');
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(API)) throw new Error('Refusing to run against anything but a local stack');

/** SQL as the database owner, through psql in the stack's own container. */
const sql = (q) => execFileSync(DOCKER,
  ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'],
  { input: q, encoding: 'utf8' }).trim();
const sqlJson = (q) => JSON.parse(sql(`select coalesce(json_agg(t), '[]') from (${q}) t`));

/** A PostgREST call. `as` is a user's access token, or SERVICE. Never throws on a refusal. */
async function rpc(fn, args, as, headers = {}) {
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: as === SERVICE ? SERVICE : ANON,
      Authorization: `Bearer ${as}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: J(args),
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
const must = async (fn, args, as, headers) => {
  const r = await rpc(fn, args, as, headers);
  if (r.status >= 300) throw new Error(`${fn}: ${r.status} ${J(r.body)}`);
  return r.body;
};

async function upload(path, bytes, type, as) {
  const res = await fetch(`${API}/storage/v1/object/evidence/${path}`, {
    method: 'POST',
    headers: { apikey: as === SERVICE ? SERVICE : ANON, Authorization: `Bearer ${as}`, 'Content-Type': type },
    body: bytes,
  });
  return { status: res.status, body: await res.text() };
}
async function download(path) {
  const res = await fetch(`${API}/storage/v1/object/authenticated/evidence/${path}`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  return { status: res.status, bytes: res.ok ? new Uint8Array(await res.arrayBuffer()) : null };
}

// A real 1x1 PNG.
const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

// ------------------------------------------------------- the database itself
const applied = sql(`select count(*) || ' ' || max(version) from supabase_migrations.schema_migrations`).split(' ');
ok('every migration and both drafts were applied by the CLI', Number(applied[0]) === 131 && applied[1] === '99990101000002', J(applied));
const pg = sql(`select current_setting('server_version') || ' | ' || datcollate from pg_database where datname = current_database()`);
console.log(`     (Postgres ${pg})`);
const nbsp = sql(`select rsn_key(E'Mate\\u00a0Iron') = rsn_key('Mate Iron')`);
console.log(`     (rsn_key folds the game's non-breaking space on this locale: ${nbsp === 't'})`);

// ------------------------------------------------------ people, through Auth
const run = Date.now().toString(36);
const people = {};
for (const [key, name, rsn] of [['org', 'Organiser'], ['red', 'Red Cap', 'Red Main'], ['mate', 'Red Mate', 'Mate Iron'],
                                ['blue', 'Blue Cap', 'Blue Main'], ['out', 'Outsider']]) {
  const email = `${key}-${run}@plugin-stack-test.invalid`;
  const password = randomUUID();
  const made = await fetch(`${API}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: J({ email, password, email_confirm: true, user_metadata: { display_name: `${name} ${run}` } }),
  });
  if (!made.ok) throw new Error(`creating ${key}: ${made.status} ${await made.text()}`);
  const id = (await made.json()).id;
  const signedIn = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: J({ email, password }),
  });
  if (!signedIn.ok) throw new Error(`signing in ${key}: ${signedIn.status}`);
  people[key] = { id, jwt: (await signedIn.json()).access_token, rsn };
}
// As on the live project: an organiser is made by SQL, never by the site.
sql(`update profiles set is_admin = true where id = '${people.org.id}'`);
ok('a new user gets a profile through the signup trigger',
   Number(sql(`select count(*) from profiles where id in (${Object.values(people).map((p) => `'${p.id}'`).join(',')})`)) === 5);

// Their in-game names, the way the site's My Account adds them.
for (const key of ['red', 'mate', 'blue']) {
  const res = await fetch(`${API}/rest/v1/profile_accounts`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${people[key].jwt}`, 'Content-Type': 'application/json' },
    body: J({ profile_id: people[key].id, rsn: people[key].rsn }),
  });
  if (!res.ok) throw new Error(`adding ${key}'s account: ${res.status} ${await res.text()}`);
}

// ------------------------------------------- the game, through the console's calls
const org = people.org.jwt;
const g = await must('admin_new_game', { p_name: `Plugin stack ${run}`, p_mode: 'regions', p_teams: ['Red', 'Blue'],
  p_grid_size: 3, p_ends_at: new Date(Date.now() + 86400e3).toISOString() }, org);
const team = Object.fromEntries(sqlJson(`select name, id from teams where game_id = '${g}'`).map((r) => [r.name, r.id]));
const tile = async (square, worth, spec) => {
  const id = await must('admin_set_tile', { p_game_id: g, p_row: Math.floor((square - 1) / 10) + 1,
    p_col: ((square - 1) % 10) + 1, p_tile: spec }, org);
  await must('admin_set_tile_worth', { p_game_id: g, p_position: square, p_worth: worth }, org);
  return id;
};
const T = {
  barrows: await tile(1, 5, { name: 'Barrows chest', rule: 'points', amount: 2,
    options: [{ label: "Dharok's helm", points: 1 }, { label: "Karil's coif", points: 1 }] }),
  helmet: await tile(2, 3, { name: 'Any helmet', rule: 'points', amount: 1, options: [{ label: 'Dharoks helm', points: 1 }] }),
  whip: await tile(3, 2, { name: 'Whip', rule: 'points', amount: 1, options: [{ label: 'Abyssal whip', points: 1 }] }),
  locked: await tile(101, 4, { name: 'Locked secret tile', rule: 'points', amount: 1,
    options: [{ label: 'Dragon pickaxe', points: 1 }] }),
};
for (let k = 3; k <= 11; k++) await tile((k - 1) * 100 + 1, 1, { name: `Filler ${k}` });
const opt = Object.fromEntries(sqlJson(
  `select o.label, o.id from tile_options o join tiles t on t.id = o.tile_id where t.game_id = '${g}'`).map((r) => [r.label, r.id]));
await must('admin_set_member', { p_team_id: team.Red, p_profile_id: people.red.id, p_role: 'captain' }, org);
await must('admin_set_member', { p_team_id: team.Red, p_profile_id: people.mate.id, p_role: 'member' }, org);
await must('admin_set_member', { p_team_id: team.Blue, p_profile_id: people.blue.id, p_role: 'captain' }, org);
await must('start_game', { p_game_id: g }, org);
ok('a Region Bingo game was built and started through PostgREST',
   sql(`select status || ' ' || mode from games where id = '${g}'`) === 'active regions');

// ------------------------------------------------------------------ tokens
const tok = {};
for (const key of ['org', 'red', 'mate', 'blue', 'out']) {
  tok[key] = await must('plugin_token_create', { p_label: key }, people[key].jwt);
}
ok('a player makes a token on the site, and sees it once', /^hse_[0-9a-f]{64}$/.test(tok.mate));
ok('only its hash is stored',
   sql(`select count(*) from plugin_tokens where profile_id = '${people.mate.id}' and token_hash <> '${tok.mate}'`) === '1');

let r = await rpc('plugin_whoami', { p_token: tok.mate }, SERVICE);
ok('the service role turns a token into its player (plugin_whoami)',
   r.status === 200 && r.body.profile_id === people.mate.id && r.body.accounts[0]?.rsn === 'Mate Iron', J(r));

for (const [who, as] of [['anon', ANON], ['a signed-in player', people.mate.jwt]]) {
  for (const fn of ['plugin_whoami', 'plugin_watchlist']) {
    r = await rpc(fn, { p_token: tok.mate }, as);
    ok(`${who} cannot call ${fn}`, r.status >= 400 && !J(r.body).includes(people.mate.id), J(r));
  }
}
r = await rpc('plugin_as', { p_token: tok.mate }, SERVICE);
ok('nobody can call plugin_as, not even the service role', r.status >= 400, J(r));

// -------------------------------- plugin_as under PostgREST: this request only
// PostgREST sets request.jwt.claims to the service role for every request.
// plugin_as overwrites it for the rest of that transaction. Proven by what
// is_admin() -- which reads auth.uid() -- says on the very next request,
// many times over, so the pool hands out the same connections again.
let leaked = 0, held = 0;
for (let i = 0; i < 24; i++) {
  const who = await rpc('plugin_whoami', { p_token: tok.org }, SERVICE);
  if (who.body?.profile_id === people.org.id) held++;
  const after = await rpc('is_admin', {}, SERVICE);
  if (after.body !== false) leaked++;
}
ok("inside the request, the token's player is auth.uid()", held === 24, held);
ok('the next request is the service role again, every time (nothing carries over)', leaked === 0, leaked);

// The organiser's console acts as a team through a request header. A token
// must not: plugin_as empties request.headers.
await must('regions_pick', { p_game_id: g, p_region: 'misthalin' }, people.red.jwt);
await must('regions_pick', { p_game_id: g, p_region: 'asgarnia' }, people.blue.jwt);
const viaSite = await must('my_team_in_game', { p_game_id: g }, org, { 'x-act-as-team': team.Red });
ok("(control) the header does make the organiser's own sign-in act as Red", viaSite === team.Red, J(viaSite));
const asRed = await must('plugin_watchlist', { p_token: tok.org }, SERVICE, { 'x-act-as-team': team.Red });
ok("an organiser's token with the act-as-team header still sees nothing", J(asRed) === '[]', J(asRed).slice(0, 200));

// ------------------------------------------------- the second secret, for real
const wRed = await must('plugin_watchlist', { p_token: tok.mate }, SERVICE);
const wBlue = await must('plugin_watchlist', { p_token: tok.blue }, SERVICE);
ok("Red's watch list holds Misthalin's drops and nothing of Asgarnia's",
   wRed.length === 1 && wRed[0].wanted.some((x) => x.label === 'Abyssal whip')
   && !/Dragon pickaxe|Locked secret/.test(J(wRed)), J(wRed).slice(0, 300));
ok("Blue's holds Asgarnia's and nothing of Misthalin's",
   wBlue.length === 1 && J(wBlue[0].wanted.map((x) => x.label)) === J(['Dragon pickaxe'])
   && !/Barrows|Whip|helmet/.test(J(wBlue)), J(wBlue).slice(0, 300));

const match = (key, rsn, names) => must('plugin_match', { p_token: tok[key], p_rsn: rsn, p_items: names.map((name) => ({ name })) }, SERVICE);
const verdicts = (m) => m.items.map((i) => i.verdict).join(',');
let m = await match('mate', 'Mate Iron', ['Abyssal whip', "Dharok's helm", 'Dragon pickaxe', 'Bones']);
ok('matching: one, ask, a locked tile none, junk none', m.account_ok && verdicts(m) === 'one,ask,none,none', J(m).slice(0, 300));
ok('a locked tile and no tile give the same answer', J({ ...m.items[2], name: 0 }) === J({ ...m.items[3], name: 0 }));
m = await match('mate', 'Mate Iron', ['Abyssal whip']);
ok("a name with the game's non-breaking space is the player's own", m.account_ok && verdicts(m) === 'one', J(m));

const open = (key, rsn, tileId, optionId, item) =>
  rpc('plugin_open', { p_token: tok[key], p_rsn: rsn, p_tile_id: tileId, p_option_id: optionId, p_item: item }, SERVICE);
const locked = await open('mate', 'Mate Iron', T.locked, opt['Dragon pickaxe'], 'Dragon pickaxe');
const noSuch = await open('mate', 'Mate Iron', randomUUID(), randomUUID(), 'Dragon pickaxe');
ok('opening a locked tile is refused', locked.status === 400 && /does not count for an open tile/.test(locked.body?.message), J(locked));
ok('with the same status, code and words as a tile that does not exist',
   J([locked.status, locked.body?.code, locked.body?.message, locked.body?.details, locked.body?.hint])
   === J([noSuch.status, noSuch.body?.code, noSuch.body?.message, noSuch.body?.details, noSuch.body?.hint]),
   J([locked, noSuch]));

// ------------------------------------------- a drop handed in, with real Storage
const opened = await open('mate', 'Mate Iron', T.whip, opt['Abyssal whip'], 'Abyssal whip');
ok('plugin_open answers where the screenshot goes',
   opened.status === 200 && opened.body.path_prefix.startsWith(`${g}/${team.Red}/`), J(opened));
const path = `${opened.body.path_prefix}${randomUUID()}.png`;
let up = await upload(path, PNG, 'image/png', SERVICE);
ok('the service role uploads the screenshot into the evidence bucket', up.status === 200, J(up));
const submit = (p, dedupe) => rpc('plugin_submit', {
  p_token: tok.mate, p_rsn: 'Mate Iron', p_tile_id: T.whip, p_option_id: opt['Abyssal whip'], p_item: 'Abyssal whip',
  p_storage_path: p, p_public_url: null,
  p_detail: { source: 'dink', dedupe, rsn: 'Mate Iron', item: 'Abyssal whip', world: 302, seasonal: false },
}, SERVICE);
r = await submit(path, `stack-${run}-1`);
ok('plugin_submit hands it in', r.status === 200 && r.body.duplicate === false, J(r));
let ev = sqlJson(`select e.source, e.detail, e.uploaded_by, e.team_id, e.points, e.storage_path, c.status
                    from tile_evidence e join tile_claims c on c.id = e.claim_id where c.tile_id = '${T.whip}'`);
ok('as one piece of evidence, by that player, for their team, worth what the option says',
   ev.length === 1 && ev[0].uploaded_by === people.mate.id && ev[0].team_id === team.Red && ev[0].points === 1, J(ev));
ok("labelled 'dink', with what was reported", ev[0]?.source === 'dink' && ev[0]?.detail?.world === 302 && !('dedupe' in (ev[0]?.detail ?? {})), J(ev));
ok('and the tile completed by its own rule', ev[0]?.status === 'completed', J(ev));
const got = await download(path);
ok('the screenshot is in Storage where the row says', got.status === 200 && got.bytes?.length === PNG.length, got.status);
r = await submit(`${opened.body.path_prefix}${randomUUID()}.png`, `stack-${run}-1`);
ok('sent twice, counted once', r.status === 200 && r.body.duplicate === true
   && sqlJson(`select 1 from tile_evidence e join tile_claims c on c.id = e.claim_id where c.tile_id = '${T.whip}'`).length === 1, J(r));

// The bucket's own limits, which item 4 has to live with.
up = await upload(`${opened.body.path_prefix}${randomUUID()}.png`, new Uint8Array(3 * 1024 * 1024 + 1), 'image/png', SERVICE);
ok('Storage refuses a screenshot over 3 MB, even from the service role', up.status >= 400 && /EntityTooLarge/.test(up.body), J(up));
up = await upload(`${opened.body.path_prefix}${randomUUID()}.png`, new Uint8Array(3 * 1024 * 1024), 'image/png', SERVICE);
ok('and takes one of exactly 3 MB (3,145,728 bytes)', up.status === 200, J(up));
up = await upload(`${opened.body.path_prefix}${randomUUID()}.gif`, PNG, 'image/gif', SERVICE);
ok('and refuses a type the bucket does not take', up.status >= 400 && /InvalidMimeType/.test(up.body), J(up));

// ------------------------------------------------- the site's own upload is unchanged
const claim = await must('regions_open_tile', { p_tile_id: T.barrows }, people.red.jwt);
const sitePath = `${g}/${team.Red}/${claim}/${randomUUID()}.png`;
up = await upload(sitePath, PNG, 'image/png', people.red.jwt);
ok("a player uploads to their own team's folder with their own sign-in", up.status === 200, J(up));
r = await rpc('add_evidence', { p_claim_id: claim, p_storage_path: sitePath, p_public_url: null,
  p_option_id: opt["Karil's coif"], p_amount: null }, people.red.jwt);
ev = sqlJson(`select source, detail from tile_evidence where storage_path = '${sitePath}'`);
ok("an upload from the site is still 'web', with no detail", r.status === 200 && ev.length === 1 && ev[0].source === 'web' && ev[0].detail === null, J([r, ev]));
up = await upload(`${g}/${team.Blue}/${claim}/${randomUUID()}.png`, PNG, 'image/png', people.red.jwt);
ok("and cannot upload into the other team's folder", up.status >= 400 && /row-level security/i.test(up.body), J(up));

// ------------------------------------------------------------- revoking
const list = await must('plugin_token_list', {}, people.mate.jwt);
await must('plugin_token_revoke', { p_id: list[0].id }, people.mate.jwt);
r = await rpc('plugin_whoami', { p_token: tok.mate }, SERVICE);
ok('a revoked token is refused', r.status === 400 && /Unknown or revoked plugin token/.test(r.body?.message), J(r));
r = await submit(`${opened.body.path_prefix}${randomUUID()}.png`, `stack-${run}-2`);
ok('and can hand nothing in', r.status === 400 && /Unknown or revoked/.test(r.body?.message), J(r));
r = await rpc('plugin_whoami', { p_token: 'hse_' + '0'.repeat(64) }, SERVICE);
ok('a token nobody was given gets the same refusal', r.status === 400 && /Unknown or revoked plugin token/.test(r.body?.message), J(r));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
