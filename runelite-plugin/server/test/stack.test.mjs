// The plugin drafts on a real Supabase stack: the CLI's local one, started
// from server/local (see that folder's prepare.mjs). Not the live project.
//
// Everything goes through the doors the site and the intake function use:
// users through Supabase Auth, the game through PostgREST with real sign-ins,
// screenshots through Storage, the plugin_* functions through PostgREST with
// the service role, and at the end the intake Edge Function itself, called the
// way Dink calls it. Only two things use SQL directly, as on the live project:
// making the organiser an admin, and reading what was stored.
//
// local/supabase/config.toml serves `intake` without JWT checks, as it will be
// deployed, so `supabase start` alone is enough.
//
// The stack's keys are read from `supabase status` while this runs. They are
// the local stack's own development keys, held in memory and never printed.
//
//   cd ../local && node prepare.mjs && supabase start
//   node stack.test.mjs            (SUPABASE_BIN / DOCKER_BIN if not on PATH)
//
// Not part of `npm test`, which needs nothing running.

import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pngInfo } from '../intake/shrink.mjs';
// The site's own helper for the My Account section: every Dink request below
// goes to a link it built, the link a player is shown.
import { dinkUrl, isMissingFunction } from '../../../web/src/lib/pluginTokens.js';
// And the review screen's: what it would show for the rows handed in below.
import { evidenceSource, withSources } from '../../../web/src/lib/evidenceSource.js';
import { expectedHalf, makePng, readPng, same } from './png.mjs';

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
for (const [key, name, rsn] of [['org', 'Organiser', 'Org Main'], ['red', 'Red Cap', 'Red Main'], ['mate', 'Red Mate', 'Mate Iron'],
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
for (const key of ['org', 'red', 'mate', 'blue']) {
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
  chain: await tile(4, 2, { name: 'Chainbody', rule: 'points', amount: 1, options: [{ label: 'Dragon chainbody', points: 1 }] }),
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

// What the My Account section asks (web/src/lib/supabase.js), as the player.
let r = await rpc('plugin_token_list', {}, people.mate.jwt);
ok("My Account's list: the player's own token, by its name, with neither the token nor its hash",
   r.status === 200 && r.body.length === 1 && r.body[0].label === 'mate'
   && !J(r.body).includes('hse_') && !('token_hash' in r.body[0]), J(r));
r = await rpc('plugin_token_not_there', {}, people.mate.jwt);
ok('a function the database does not have answers PGRST202, which is what the section hides on',
   r.status === 404 && isMissingFunction(r.body), J(r));

// plugin_match is the intake's first call: its account check reads the
// token's player's own in-game names, so "yes" means the token became that
// player.
const items = (names) => names.map((name) => ({ name }));
const matchWith = (token, rsn, names, as = SERVICE, headers) =>
  rpc('plugin_match', { p_token: token, p_rsn: rsn, p_items: items(names) }, as, headers);
r = await matchWith(tok.mate, 'Mate Iron', ['Abyssal whip']);
ok("the service role turns a token into its player: the player's own in-game name is recognised",
   r.status === 200 && r.body.account_ok === true, J(r));
r = await matchWith(tok.mate, 'Blue Main', ['Abyssal whip']);
ok("and somebody else's is not", r.status === 200 && r.body.account_ok === false, J(r));

for (const [who, as] of [['anon', ANON], ['a signed-in player', people.mate.jwt]]) {
  r = await matchWith(tok.mate, 'Mate Iron', ['Abyssal whip'], as);
  ok(`${who} cannot call plugin_match`, r.status >= 400 && !J(r.body).includes('account_ok'), J(r));
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
  const who = await matchWith(tok.org, 'Org Main', ['Abyssal whip']);
  if (who.body?.account_ok === true) held++;
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
const match = (key, rsn, names) => must('plugin_match', { p_token: tok[key], p_rsn: rsn, p_items: items(names) }, SERVICE);
const verdicts = (m) => m.items.map((i) => i.verdict).join(',');
const asRed = await must('plugin_match', { p_token: tok.org, p_rsn: 'Org Main', p_items: items(['Abyssal whip']) },
  SERVICE, { 'x-act-as-team': team.Red });
ok("an organiser's token with the act-as-team header still matches nothing of Red's",
   asRed.account_ok && verdicts(asRed) === 'none' && !/Barrows|Whip|helmet/i.test(J(asRed.items[0].matches)), J(asRed).slice(0, 200));

// ------------------------------------------------- the second secret, for real
const mRed = await match('mate', 'Mate Iron', ['Abyssal whip', 'Dragon pickaxe']);
const mBlue = await match('blue', 'Blue Main', ['Abyssal whip', 'Dragon pickaxe']);
ok("Red's drops match Misthalin's tiles and nothing of Asgarnia's",
   verdicts(mRed) === 'one,none' && !/Dragon pickaxe|Locked secret/.test(J(mRed.items.map((i) => i.matches))), J(mRed).slice(0, 300));
ok("Blue's match Asgarnia's and nothing of Misthalin's",
   verdicts(mBlue) === 'none,one' && !/Barrows|Whip|helmet/.test(J(mBlue.items.map((i) => i.matches))), J(mBlue).slice(0, 300));
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

// ------------------------------------- the intake Edge Function, as Dink calls it
// The request is built the way Dink's OkHttp MultipartBody writes it: a
// payload_json part with no content type, then a file part whose name ends in
// .png, each with its own Content-Length. It goes to dinkUrl(API, token): the
// same link the site's My Account section shows a player.
const EDGE = 'supabase_edge_runtime_hs-events-plugin-local';
const fnLog = () => { const l = spawnSync(DOCKER, ['logs', EDGE], { encoding: 'utf8' }); return (l.stdout ?? '') + (l.stderr ?? ''); };
const logBefore = fnLog().length;

function multipart(payload, image, type = 'image/png') {
  const b = `${randomUUID()}`;
  const json = Buffer.from(J(payload), 'utf8');
  const parts = [Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Length: ${json.length}\r\n\r\n`), json, Buffer.from('\r\n')];
  if (image) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="lootImage.png"\r\n`
    + `Content-Type: ${type}\r\nContent-Length: ${image.length}\r\n\r\n`), Buffer.from(image), Buffer.from('\r\n'));
  parts.push(Buffer.from(`--${b}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${b}` };
}
async function dink(token, payload, image, type) {
  const { body, type: ct } = multipart(payload, image, type);
  const res = await fetch(dinkUrl(API, token), { method: 'POST', headers: { 'Content-Type': ct }, body });
  return { status: res.status, body: await res.text() };
}
const lootFrom = (rsn, items, more = {}) => ({
  content: '%USERNAME% has looted:', type: 'LOOT', playerName: rsn, accountType: 'NORMAL', seasonalWorld: false,
  dinkAccountHash: `stack-${run}`, world: 302, regionId: 12850, embeds: [],
  extra: { items: items.map(([name, id, priceEach]) => ({ id, quantity: 1, priceEach, name, criteria: ['VALUE'] })),
           source: 'Chaos Elemental', category: 'NPC', killCount: 7 },
  ...more,
});
const blueRows = () => sqlJson(`select e.source, e.detail, e.uploaded_by, e.team_id, e.storage_path
  from tile_evidence e join tile_claims c on c.id = e.claim_id where c.tile_id = '${T.locked}' and e.team_id = '${team.Blue}'`);
const blueObjects = () => Number(sql(`select count(*) from storage.objects where bucket_id = 'evidence' and name like '${g}/${team.Blue}/%'`));

let d = await dink(`hse_${'0'.repeat(64)}`, lootFrom('Blue Main', [['Dragon pickaxe', 11920, 5_000_000]]), PNG);
if (/UNAUTHORIZED_NO_AUTH_HEADER/.test(d.body)) {
  throw new Error('intake is served with JWT checks on: run `supabase functions serve intake --no-verify-jwt` from server/local');
}
ok('the function runs without a sign-in, as Dink calls it, and refuses an unknown token: 401', d.status === 401 && d.body === '{"ok":false}', J(d));
const got404 = await fetch(dinkUrl(API, tok.blue));
ok('anything but a POST to /dink is a 404', got404.status === 404 && (await got404.text()) === '{"ok":false}');
d = await fetch(dinkUrl(API, tok.blue), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json' });
ok('a body that is not JSON is a 400', d.status === 400);

const pick = lootFrom('Blue Main', [['Dragon pickaxe', 11920, 5_000_000], ['Bones', 526, 100]], { world: 330 });
d = await dink(tok.blue, pick, PNG);
ok("Blue's drop, sent the way Dink sends it, is answered 200 {ok:true}", d.status === 200 && d.body === '{"ok":true}', J(d));
let rows = blueRows();
ok('and is one evidence row: by that player, for Blue, source dink',
   rows.length === 1 && rows[0].uploaded_by === people.blue.id && rows[0].source === 'dink', J(rows));
ok("with what Dink reported, and the player's name as the site spells it",
   rows[0]?.detail?.rsn === 'Blue Main' && rows[0]?.detail?.world === 330 && rows[0]?.detail?.dink_type === 'LOOT'
   && rows[0]?.detail?.item_id === 11920, J(rows[0]?.detail));
const stored = rows[0] ? await download(rows[0].storage_path) : { status: 0 };
ok('the screenshot went through supabase-js into Storage byte for byte',
   stored.status === 200 && Buffer.compare(Buffer.from(stored.bytes), Buffer.from(PNG)) === 0, stored.status);
d = await dink(tok.blue, pick, PNG);
ok("Dink's retry of the same request: 200, still one row", d.status === 200 && blueRows().length === 1, J(d));
ok("and the retry's copy of the screenshot was removed again: one file in Blue's folder", blueObjects() === 1, blueObjects());

// The second secret, through the function: the reply never says what matched.
const replies = [];
for (const items of [[['Dragon pickaxe', 11920, 5_000_000]], [['Bones', 526, 100]], [['Twisted bow', 20997, 1_000_000_000]]]) {
  replies.push(await dink(tok.mate, lootFrom('Mate Iron', items), PNG));
}
ok("Red's drop for a tile in Blue's region gets the same reply as junk and as an item no tile has",
   replies.every((x) => J(x) === J({ status: 200, body: '{"ok":true}' })), J(replies));
ok('and hands nothing in for Red', sqlJson(`select 1 from tile_evidence e join tile_claims c on c.id = e.claim_id
   where c.tile_id = '${T.locked}' and e.team_id = '${team.Red}'`).length === 0);

d = await dink(tok.blue, { ...pick, type: 'COLLECTION', extra: { itemName: 'Dragon pickaxe', itemId: 11920, price: 5_000_000 } }, PNG);
ok('a collection-log notification for the same drop: 200, nothing new', d.status === 200 && blueRows().length === 1, J(d));

// The worst screenshot Dink sends as a PNG: the most pixels shrink.mjs takes
// (3840 x 2400), about 7 MB, so the bucket refuses it as it is. It must be made
// smaller inside the runtime's 2 s of CPU and 256 MB.
let lcg = 7;
const rnd = () => (lcg = (lcg * 1103515245 + 12345) & 0x7fffffff) >> 16;
const worst = makePng(3840, 2400, (x, y, k) => (k === 3 ? 255
  : (((x >> 3) * 5 + (y >> 2) * 3 + k * 70) & 255) ^ ((rnd() & 31) < 3 ? rnd() & 3 : 0)), { filters: [0], idatChunk: 1 << 16 });
if (!(worst.bytes.length > 3 * 1024 * 1024 && worst.bytes.length < 8_000_000)) throw new Error('worst-case screenshot is the wrong size');
// Boris, 2026-11-21: a drop on a Leagues (seasonal) world does not count. The
// chainbody tile is open for Red, and is handed in for real just below.
d = await dink(tok.mate, lootFrom('Mate Iron', [['Dragon chainbody', 3140, 4_000_000]], { seasonalWorld: true }), worst.bytes);
ok('the same chainbody from a seasonal (Leagues) world: 200 {ok:true}, and nothing handed in',
   d.status === 200 && d.body === '{"ok":true}'
   && sqlJson(`select 1 from tile_evidence e join tile_claims c on c.id = e.claim_id where c.tile_id = '${T.chain}'`).length === 0, J(d));
d = await dink(tok.mate, lootFrom('Mate Iron', [['Dragon chainbody', 3140, 4_000_000]]), worst.bytes);
const chain = sqlJson(`select e.detail, e.storage_path from tile_evidence e join tile_claims c on c.id = e.claim_id where c.tile_id = '${T.chain}'`);
const chainFile = chain[0] ? await download(chain[0].storage_path) : { status: 0 };
const chainInfo = chainFile.bytes && pngInfo(chainFile.bytes);
ok(`a ${(worst.bytes.length / 1048576).toFixed(1)} MB, 3840 x 2400 screenshot: 200, and handed in`,
   d.status === 200 && d.body === '{"ok":true}' && chain.length === 1, J(d));
ok('kept in Storage at 1920 x 1200, under 3 MB, the same picture at half the size',
   chainFile.status === 200 && chainFile.bytes.length <= 3 * 1024 * 1024 && chainInfo?.width === 1920 && chainInfo?.height === 1200
   && same(readPng(chainFile.bytes).data, expectedHalf(worst.data, 3840, 2400, 4, 3)), J([chainFile.status, chainFile.bytes?.length, chainInfo]));
ok("and its evidence says resized_from '3840x2400'", chain[0]?.detail?.resized_from === '3840x2400', J(chain[0]?.detail));

// ----------------------------------- the review screen's "Sent by plugin"
// What the organiser's screen asks, through PostgREST with their sign-in, and
// what the site's own formatter makes of the answer.
const sentRows = sqlJson(`select e.id from tile_evidence e join tile_claims c on c.id = e.claim_id
  join tiles t on t.id = c.tile_id where t.game_id = '${g}' and e.source <> 'web' order by e.id`).map((x) => x.id);
r = await rpc('admin_evidence_sources', { p_game_id: g }, org);
const srcIds = Array.isArray(r.body) ? r.body.map((x) => x.id).sort() : [];
ok('the organiser is told which evidence a plugin sent: every such row, and only those',
   r.status === 200 && sentRows.length >= 3 && J(srcIds) === J([...sentRows].sort())
   && r.body.every((x) => x.source !== 'web'), J([r.status, srcIds.length, sentRows.length]));
const listedEv = await must('admin_list_evidence', { p_game_id: g }, org);
const onScreen = withSources(listedEv, r.body);
const chainRow = onScreen.find((x) => x.storage_path === chain[0]?.storage_path);
const chainSent = evidenceSource(chainRow);
ok('the review screen labels the chainbody "Sent by plugin", with what Dink reported',
   chainSent?.label === 'Sent by plugin'
   && chainSent.drop === 'Dragon chainbody ×1 from Chaos Elemental'
   && chainSent.lines.includes('World 302 · as Mate Iron')
   && chainSent.lines.includes('Picture made smaller from 3840×2400'), J(chainSent));
ok("and the site's own upload has no label",
   evidenceSource(onScreen.find((x) => x.storage_path === sitePath)) === null
   && onScreen.filter((x) => evidenceSource(x)).length === sentRows.length, J(onScreen.map((x) => x.source ?? 'upload')));
// The second secret: Blue reading this would learn Red's items, and through
// them tiles in regions Blue has not opened.
const blueSees = await rpc('admin_evidence_sources', { p_game_id: g }, people.blue.jwt);
const blueList = await rpc('admin_list_evidence', { p_game_id: g }, people.blue.jwt);
ok("a player is refused, in the evidence list's own words, and learns nothing",
   blueSees.status === 400 && blueSees.body?.message === 'Not your game' && blueList.body?.message === 'Not your game'
   && !/Chaos Elemental|chainbody|pickaxe/.test(J(blueSees)), J([blueSees, blueList.body?.message]));
for (const [who, as] of [['anon', ANON], ['the service role', SERVICE]]) {
  r = await rpc('admin_evidence_sources', { p_game_id: g }, as);
  ok(`${who} cannot call it at all`, r.status >= 400 && !/Chaos Elemental|chainbody/.test(J(r)), J(r));
}

// ------------------------------------- the same lines in a tile's panel
// evidence_sources, as a team's own board asks it: by evidence id, with the
// player's sign-in. Asked here for every row in the game, so the answer shows
// exactly what the gate lets through.
const everyEv = sqlJson(`select e.id from tile_evidence e join tile_claims c on c.id = e.claim_id
  join tiles t on t.id = c.tile_id where t.game_id = '${g}'`).map((x) => x.id);
const sentBy = (teamId) => sqlJson(`select e.id from tile_evidence e join tile_claims c on c.id = e.claim_id
  join tiles t on t.id = c.tile_id where t.game_id = '${g}' and e.source <> 'web' and e.team_id = '${teamId}'`)
  .map((x) => x.id).sort();
r = await rpc('evidence_sources', { p_ids: everyEv }, people.mate.jwt);
ok("a player's board is told what Dink reported for their own team's drops, and only those",
   r.status === 200 && sentBy(team.Red).length >= 2 && J(r.body.map((x) => x.id).sort()) === J(sentBy(team.Red)),
   J([r.status, r.body?.length, sentBy(team.Red).length]));
const mine = await must('my_evidence', { p_game_id: g }, people.mate.jwt);
const panelChain = evidenceSource(withSources(mine, r.body).find((x) => x.storage_path === chain[0]?.storage_path));
ok('the panel draws the chainbody as the review screen does: the drop, the world, the account',
   panelChain?.drop === 'Dragon chainbody ×1 from Chaos Elemental' && panelChain.lines.includes('World 302 · as Mate Iron'),
   J(panelChain));
r = await rpc('evidence_sources', { p_ids: everyEv }, people.blue.jwt);
ok("Blue asking for every row of the game is told about Blue's own, and nothing of Red's",
   r.status === 200 && J(r.body.map((x) => x.id).sort()) === J(sentBy(team.Blue)) && !/chainbody/.test(J(r.body)),
   J([r.status, r.body?.length]));
for (const [who, as] of [['anon', ANON], ['the service role', SERVICE]]) {
  r = await rpc('evidence_sources', { p_ids: everyEv }, as);
  ok(`${who} cannot ask for the panel's lines`, r.status >= 400 && !/Chaos Elemental|chainbody/.test(J(r)), J(r));
}

await new Promise((res) => setTimeout(res, 800));
const log = fnLog().slice(logBefore);
const outcomes = [...log.matchAll(/\{"outcome":"([a-z_]+)"(?:,"reason":"([a-z_]+)")?/g)].map((x) => x[2] ?? x[1]);
ok("the function's log has one line per request, with the outcome",
   J(outcomes) === J(['bad_token', 'bad_json', 'submitted', 'nothing_submitted', 'nothing_submitted', 'nothing_submitted',
                      'nothing_submitted', 'covered_by_loot', 'seasonal_world', 'submitted']), J(outcomes));
const resizedLog = log.match(/"resized":(\{[^}]*\})/);
console.log(`     (in the edge runtime: ${resizedLog ? resizedLog[1] : 'no resize logged'})`);
ok('and never a token', !/hse_/.test(log) && !Object.values(tok).some((t) => log.includes(t)));

// ------------------------------------------- a drop two tiles want waits
// Boris, 2026-11-21 (draft 002, section 6c). Barrows chest and Any helmet both
// still want a Dharok's helm. Dink sends it; the team chooses on the site,
// whose three steps are taken here as WaitingDrops.jsx takes them: open the
// tile, copy the screenshot with Storage's own copy (supabase-js's
// storage.copy) under the player's sign-in, hand it in.
const logBeforeWait = fnLog().length;
async function copyObject(from, to, as) {
  const res = await fetch(`${API}/storage/v1/object/copy`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${as}`, 'Content-Type': 'application/json' },
    body: J({ bucketId: 'evidence', sourceKey: from, destinationKey: to }),
  });
  return { status: res.status, body: await res.text() };
}
async function readAs(path, as) {
  const res = await fetch(`${API}/storage/v1/object/authenticated/evidence/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${as}` },
  });
  return res.status;
}
const meta = (path) => sqlJson(`select metadata ->> 'eTag' etag, metadata ->> 'size' size
  from storage.objects where bucket_id = 'evidence' and name = '${path}'`)[0];

// Its own picture, so the copy can be told from every other file.
const helmShot = makePng(16, 12, (x, y, k) => (k === 3 ? 255 : (x * 13 + y * 7 + k * 40) & 255)).bytes;
const helm = lootFrom('Mate Iron', [["Dharok's helm", 4716, 1_200_000]], { world: 420 });
d = await dink(tok.mate, helm, helmShot);
let waits = sqlJson(`select * from plugin_waiting where game_id = '${g}'`);
const W = waits[0];
ok("Dink's helm, wanted by two of Red's tiles: 200 {ok:true}, and it waits for the team",
   d.status === 200 && d.body === '{"ok":true}' && waits.length === 1 && W.profile_id === people.mate.id
   && W.team_id === team.Red && W.choices.length === 2 && W.chosen_at === null, J([d, waits]));
const waitFile = W ? await download(W.storage_path) : { status: 0 };
ok("its screenshot is in Red's folder under waiting/, byte for byte",
   W?.storage_path.startsWith(`${g}/${team.Red}/waiting/`) && waitFile.status === 200
   && Buffer.compare(Buffer.from(waitFile.bytes), Buffer.from(helmShot)) === 0, J([W?.storage_path, waitFile.status]));
ok('nothing was handed in for it yet',
   sqlJson(`select 1 from tile_evidence e join tile_claims c on c.id = e.claim_id
             where c.tile_id in ('${T.barrows}', '${T.helmet}') and e.source <> 'web'`).length === 0);
d = await dink(tok.mate, helm, helmShot);
ok("Dink's retry: 200, still one waiting drop and one file",
   d.status === 200 && sqlJson(`select 1 from plugin_waiting where game_id = '${g}'`).length === 1
   && Number(sql(`select count(*) from storage.objects where name like '${g}/${team.Red}/waiting/%'`)) === 1, J(d));

r = await rpc('waiting_drops', { p_game_id: g }, people.red.jwt);
ok("Red Cap's site lists it, with both tiles in board order and who got it",
   r.status === 200 && r.body.length === 1 && r.body[0].id === W.id && r.body[0].dropped_by === `Red Mate ${run}`
   && J(r.body[0].choices.map((c) => [c.tile, c.region])) === J([['Barrows chest', 'misthalin'], ['Any helmet', 'misthalin']]), J(r));
r = await rpc('waiting_drops', { p_game_id: g }, people.blue.jwt);
ok('Blue\'s lists nothing', r.status === 200 && J(r.body) === '[]', J(r));
for (const [who, as] of [['anon', ANON], ['the service role', SERVICE]]) {
  r = await rpc('waiting_drops', { p_game_id: g }, as);
  ok(`${who} cannot ask`, r.status >= 400 && !/helm/i.test(J(r)), J(r));
}
const openW = (as, id, tileId, optionId) =>
  rpc('waiting_drop_open', { p_waiting_id: id, p_tile_id: tileId, p_option_id: optionId }, as);
const shape = (x) => J([x.status, x.body?.code, x.body?.message, x.body?.details, x.body?.hint]);
const blueTry = await openW(people.blue.jwt, W.id, T.helmet, opt['Dharoks helm']);
const blueNone = await openW(people.blue.jwt, randomUUID(), T.helmet, opt['Dharoks helm']);
ok("Blue with Red's drop gets the same status, code and words as for a drop that does not exist",
   blueTry.status === 400 && blueTry.body?.message === 'That drop cannot be handed in there' && shape(blueTry) === shape(blueNone),
   J([blueTry, blueNone]));
const redLocked = await openW(people.red.jwt, W.id, T.locked, opt['Dragon pickaxe']);
const redNone = await openW(people.red.jwt, W.id, randomUUID(), randomUUID());
ok("Red choosing the tile in Blue's region: the answer a tile that does not exist gets", shape(redLocked) === shape(redNone),
   J([redLocked, redNone]));
ok("Blue cannot read Red's waiting screenshot; Red Cap can",
   (await readAs(W.storage_path, people.blue.jwt)) >= 400 && (await readAs(W.storage_path, people.red.jwt)) === 200);

const oW = await must('waiting_drop_open', { p_waiting_id: W.id, p_tile_id: T.helmet, p_option_id: opt['Dharoks helm'] }, people.red.jwt);
const claimW = sql(`select id from tile_claims where team_id = '${team.Red}' and tile_id = '${T.helmet}'`);
ok('Red Cap chooses Any helmet: the tile is opened, and the copy goes in its claim\'s folder',
   oW.claim_id === claimW && oW.from_path === W.storage_path && oW.path_prefix === `${g}/${team.Red}/${claimW}/`, J(oW));
let cp = await copyObject(W.storage_path, `${g}/${team.Blue}/${randomUUID()}/${randomUUID()}.png`, people.blue.jwt);
ok("Blue cannot copy Red's screenshot with Storage's copy", cp.status >= 400, J(cp));
cp = await copyObject(W.storage_path, `${oW.path_prefix}${randomUUID()}.png`, people.blue.jwt);
ok("nor into Red's claim", cp.status >= 400, J(cp));

const forgedPath = `${oW.path_prefix}${randomUUID()}.png`;
up = await upload(forgedPath, PNG, 'image/png', people.red.jwt);
const chooseW = (as, p) => rpc('waiting_drop_choose',
  { p_waiting_id: W.id, p_tile_id: T.helmet, p_option_id: opt['Dharoks helm'], p_storage_path: p }, as);
r = await chooseW(people.red.jwt, forgedPath);
ok("Red Cap's own picture, uploaded into the claim's folder, is refused as not Dink's",
   up.status === 200 && r.status === 400 && r.body?.message === 'That is not the screenshot Dink sent for this drop', J([up, r]));

const copyPath = `${oW.path_prefix}${randomUUID()}.png`;
cp = await copyObject(W.storage_path, copyPath, people.red.jwt);
const mFrom = meta(W.storage_path), mTo = meta(copyPath);
ok("Red Cap copies Dink's picture with Storage's copy, under their own sign-in", cp.status === 200, J(cp));
ok("Storage gives the copy the same eTag and size, which is what the hand-in checks",
   mFrom?.etag && mFrom.etag === mTo?.etag && mFrom.size === mTo?.size && Number(mTo.size) === helmShot.length, J([mFrom, mTo]));
r = await chooseW(people.red.jwt, copyPath);
ev = sqlJson(`select e.source, e.detail, e.uploaded_by, e.team_id, e.storage_path, c.status
                from tile_evidence e join tile_claims c on c.id = e.claim_id where e.storage_path = '${copyPath}'`);
ok('handed in: Any helmet completes, by its own rule', r.status === 200 && ev[0]?.status === 'completed', J([r, ev]));
ok("the evidence is Red Mate's, who got the drop, 'dink', and says Red Cap chose",
   ev[0]?.uploaded_by === people.mate.id && ev[0].source === 'dink' && ev[0].detail?.world === 420
   && ev[0].detail?.waited?.chosen_by === `Red Cap ${run}` && !!ev[0].detail?.waited?.arrived_at, J(ev));
const copied = await download(copyPath);
ok('and its file is Dink\'s screenshot, byte for byte',
   copied.status === 200 && Buffer.compare(Buffer.from(copied.bytes), Buffer.from(helmShot)) === 0, copied.status);
r = await chooseW(people.mate.jwt, copyPath);
ok('choosing it again: already handed in', r.status === 400 && r.body?.message === 'That drop has already been handed in', J(r));
r = await rpc('waiting_drops', { p_game_id: g }, people.mate.jwt);
ok('and the list is empty again', r.status === 200 && J(r.body) === '[]', J(r));

await new Promise((res) => setTimeout(res, 800));
const waitOutcomes = [...fnLog().slice(logBeforeWait).matchAll(/\{"outcome":"([a-z_]+)"(?:,"reason":"([a-z_]+)")?/g)].map((x) => x[2] ?? x[1]);
ok("the function's log: 'waiting', then the retry", J(waitOutcomes) === J(['waiting', 'nothing_submitted']), J(waitOutcomes));

// --------------------------------------- Bingo, through the same doors
// A Bingo game beside the Region Bingo one, with the same people. Dragon
// pickaxe is on the card and on the Region Bingo tile in Asgarnia, which Red
// has not opened.
const logBeforeBingo = fnLog().length;
const gb = await must('admin_new_game', { p_name: `Plugin stack bingo ${run}`, p_mode: 'bingo', p_teams: ['Red', 'Blue'],
  p_grid_size: 3, p_ends_at: new Date(Date.now() + 86400e3).toISOString() }, org);
const teamB = Object.fromEntries(sqlJson(`select name, id from teams where game_id = '${gb}'`).map((r) => [r.name, r.id]));
const card = ['Tanzanite fang', 'Dragon pickaxe', 'Granite maul', 'Rune scimitar', 'Dragon bones',
              'Draconic visage', 'Bandos chestplate', 'Dragon med helm', 'Magic fang'];
const TB = {};
for (const [i, label] of card.entries()) {
  TB[label] = await must('admin_set_tile', { p_game_id: gb, p_row: Math.floor(i / 3) + 1, p_col: (i % 3) + 1,
    p_tile: { name: label, rule: 'points', amount: 1, options: [{ label, points: 1 }] } }, org);
}
await must('admin_set_member', { p_team_id: teamB.Red, p_profile_id: people.red.id, p_role: 'captain' }, org);
await must('admin_set_member', { p_team_id: teamB.Red, p_profile_id: people.mate.id, p_role: 'member' }, org);
await must('admin_set_member', { p_team_id: teamB.Blue, p_profile_id: people.blue.id, p_role: 'captain' }, org);
const onCard = (label) => sqlJson(`select e.source, e.detail, e.uploaded_by, e.team_id, e.storage_path, c.status
  from tile_evidence e join tile_claims c on c.id = e.claim_id where c.tile_id = '${TB[label]}' order by e.created_at`);
const fang = lootFrom('Mate Iron', [['Tanzanite fang', 12922, 3_000_000]], { world: 416 });

d = await dink(tok.mate, fang, PNG);
ok('Bingo before the start: a drop on the card is answered 200 {ok:true}, and nothing is handed in',
   d.status === 200 && d.body === '{"ok":true}' && onCard('Tanzanite fang').length === 0, J(d));

await must('start_game', { p_game_id: gb }, org);
ok('a Bingo game was built and started through PostgREST',
   sql(`select status || ' ' || mode from games where id = '${gb}'`) === 'active bingo');
d = await dink(tok.mate, fang, PNG);
rows = onCard('Tanzanite fang');
ok("after the start the same drop is handed in: one row, by that player, for Red's Bingo team, source dink",
   d.status === 200 && rows.length === 1 && rows[0].uploaded_by === people.mate.id && rows[0].team_id === teamB.Red
   && rows[0].source === 'dink' && rows[0].detail?.world === 416, J([d, rows]));
ok("in the Bingo game's folder, and the tile completed by its own rule",
   rows[0]?.storage_path.startsWith(`${gb}/${teamB.Red}/`) && rows[0]?.status === 'completed', J(rows[0]));
const fangFile = rows[0] ? await download(rows[0].storage_path) : { status: 0 };
ok('the screenshot is in Storage, byte for byte',
   fangFile.status === 200 && Buffer.compare(Buffer.from(fangFile.bytes), Buffer.from(PNG)) === 0, fangFile.status);

d = await dink(tok.blue, lootFrom('Blue Main', [['Tanzanite fang', 12922, 3_000_000]]), PNG);
rows = onCard('Tanzanite fang');
ok("Blue's drop on the same tile is Blue's own, and Red's is untouched",
   d.status === 200 && rows.length === 2 && rows.filter((x) => x.team_id === teamB.Blue).length === 1
   && rows.filter((x) => x.team_id === teamB.Red).length === 1, J(rows));

// The second secret across two games: Red's pickaxe counts for the card, and
// nothing about the locked region tile changes.
d = await dink(tok.mate, lootFrom('Mate Iron', [['Dragon pickaxe', 11920, 5_000_000]], { world: 417 }), PNG);
rows = onCard('Dragon pickaxe');
ok("Red's Dragon pickaxe is handed in on the card, not on the tile in the region Red has not opened",
   d.status === 200 && rows.length === 1 && rows[0].team_id === teamB.Red
   && sqlJson(`select 1 from tile_evidence e join tile_claims c on c.id = e.claim_id
               where c.tile_id = '${T.locked}' and e.team_id = '${team.Red}'`).length === 0, J([d, rows]));

r = await rpc('admin_evidence_sources', { p_game_id: gb }, org);
ok('the review screen of the Bingo game labels all three as sent by plugin',
   r.status === 200 && r.body.length === 3 && r.body.every((x) => x.source === 'dink'), J(r).slice(0, 300));

await new Promise((res) => setTimeout(res, 800));
const bingoLog = fnLog().slice(logBeforeBingo);
const bingoOutcomes = [...bingoLog.matchAll(/\{"outcome":"([a-z_]+)"(?:,"reason":"([a-z_]+)")?/g)].map((x) => x[2] ?? x[1]);
ok("the function's log for the Bingo requests: nothing before the start, then three handed in",
   J(bingoOutcomes) === J(['nothing_submitted', 'submitted', 'submitted', 'submitted']), J(bingoOutcomes));

// ------------------------------------------------------------- revoking
const list = await must('plugin_token_list', {}, people.mate.jwt);
await must('plugin_token_revoke', { p_id: list[0].id }, people.mate.jwt);
r = await matchWith(tok.mate, 'Mate Iron', ['Abyssal whip']);
ok('a revoked token is refused', r.status === 400 && /Unknown or revoked plugin token/.test(r.body?.message), J(r));
r = await submit(`${opened.body.path_prefix}${randomUUID()}.png`, `stack-${run}-2`);
ok('and can hand nothing in', r.status === 400 && /Unknown or revoked/.test(r.body?.message), J(r));
r = await matchWith('hse_' + '0'.repeat(64), 'Mate Iron', ['Abyssal whip']);
ok('a token nobody was given gets the same refusal', r.status === 400 && /Unknown or revoked plugin token/.test(r.body?.message), J(r));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
