// Offline test of supabase/migrations/20261121120000_plugin_tokens.sql in PGlite (real Postgres, in
// memory). Stand-ins replace what Supabase provides: auth.uid(), the roles,
// profiles, profile_accounts and is_admin(). It proves the token and identity
// mechanics. It does NOT prove the PostgREST + service-role path; that needs a
// spare Supabase project (plan, phase 0).
//
//   node tokens.test.mjs

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';

const db = new PGlite({ extensions: { pgcrypto } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' ' + extra}`);
};
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const raises = async (sql, params) => {
  try { await db.query(sql, params); return null; } catch (e) { return e.message; }
};

// ---- stand-ins for Supabase ----
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema extensions;
  create extension pgcrypto schema extensions;
  -- Supabase's own definition of auth.uid().
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
  create table profiles (id uuid primary key, rsn text, is_admin boolean not null default false);
  create table profile_accounts (
    id uuid primary key default gen_random_uuid(),
    profile_id uuid not null references profiles(id) on delete cascade,
    rsn text not null, is_primary boolean not null default false);
  create function is_admin() returns boolean language sql stable as $$
    select coalesce((select is_admin from profiles where id = auth.uid()), false) $$;
`);
await db.exec(readFileSync(new URL('../../../supabase/migrations/20261121120000_plugin_tokens.sql', import.meta.url), 'utf8'));

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const ORG = '00000000-0000-0000-0000-0000000000ad';
await db.query(`insert into profiles values ($1,'Alice',false),($2,'Bob',false),($3,'Org',true)`, [A, B, ORG]);
await db.query(`insert into profile_accounts (profile_id, rsn, is_primary)
                values ($1,'Alice',true),($1,'Alice Iron',false),($2,'Bob',true)`, [A, B]);

// Sign in as a profile for one transaction, as the site's JWT would.
const as = async (who, fn) => db.transaction(async (tx) => {
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who })]);
  return fn(tx);
});

// The same, for a call that must fail. A failed statement rolls the transaction
// back, so the message is carried out by hand.
const raisesAs = async (who, sql, params) => {
  let msg = null;
  try {
    await as(who, async (tx) => {
      try { await tx.query(sql, params); } catch (e) { msg = e.message; throw e; }
    });
  } catch { /* the rollback */ }
  return msg;
};

// ---- drop_key ----
const keys = [
  ["Dharok's helm", 'dharoks helm'],
  ['Dharok’s  Helm ', 'dharoks helm'],
  ['dharoks helm', 'dharoks helm'],
  ["Black d'hide body (g)", 'black dhide body g'],
  ['Abyssal whip', 'abyssal whip'],
  ['3rd age full helmet', '3rd age full helmet'],
  ['Tumeken\'s shadow (uncharged)', 'tumekens shadow uncharged'],
];
for (const [input, want] of keys) {
  const got = (await one('select drop_key($1) k', [input])).k;
  ok(`drop_key(${JSON.stringify(input)})`, got === want, `got ${JSON.stringify(got)}`);
}
ok('drop_key of nothing is null', (await one(`select drop_key('  ’ ') k`)).k === null);
ok('drop_key(null) is null', (await one(`select drop_key(null) k`)).k === null);

// The tile editor's copy (web/src/lib/itemNames.js) warns when a drop is not
// an item's name, and is only right if it spells names the way this does. So:
// the two, over every item name the editor knows, the ready-made lists, the
// cases above, and the awkward characters.
{
  const { dropKey } = await import('../../../web/src/lib/itemNames.js');
  const { ITEM_NAMES } = await import('../../../web/src/lib/itemNames.data.js');
  const { DROP_LISTS } = await import('../../../web/src/lib/dropLists.js');
  const inputs = [...ITEM_NAMES, ...DROP_LISTS.flatMap((l) => l.drops.map((d) => d.label)),
    ...keys.map(([input]) => input), '  ’ ', '', 'Pokémon', 'a\tb\nc', '«Dragon»  bones++', 'Ölm', '½ anchovy pizza'];
  const rows = (await db.query('select n, drop_key(n) k from unnest($1::text[]) with ordinality u(n, i) order by i', [inputs])).rows;
  const differ = rows.filter((r) => r.k !== dropKey(r.n));
  ok(`the tile editor's dropKey agrees with drop_key on ${rows.length} names`, rows.length === inputs.length && differ.length === 0,
    JSON.stringify(differ.slice(0, 5).map((r) => [r.n, r.k, dropKey(r.n)])));
}

// ---- creating ----
ok('signed out cannot create', /Not signed in/.test(await raises('select plugin_token_create()') ?? ''));
const tokenA = await as(A, async (tx) => (await tx.query(`select plugin_token_create('  laptop ') t`)).rows[0].t);
ok('token has the hse_ shape', /^hse_[0-9a-f]{64}$/.test(tokenA));
const stored = await one('select token_hash, label from plugin_tokens');
ok('the token itself is not stored', stored.token_hash !== tokenA && !stored.token_hash.includes(tokenA.slice(4)));
ok('label is trimmed', stored.label === 'laptop');
const tokenB = await as(B, async (tx) => (await tx.query(`select plugin_token_create() t`)).rows[0].t);

// ---- listing ----
const listA = await as(A, async (tx) => (await tx.query('select * from plugin_token_list()')).rows);
ok('a player lists only their own', listA.length === 1 && listA[0].label === 'laptop');
ok('the list never carries the token or its hash', !('token_hash' in listA[0]) && !JSON.stringify(listA).includes(tokenA));

// ---- plugin_as ----
const inside = await db.transaction(async (tx) => {
  const before = (await tx.query('select auth.uid() u')).rows[0].u;
  const who = (await tx.query('select plugin_as($1) p', [tokenA])).rows[0].p;
  const after = (await tx.query('select auth.uid() u')).rows[0].u;
  return { before, who, after };
});
ok('before plugin_as nobody is signed in', inside.before === null);
ok('plugin_as answers the token owner', inside.who === A);
ok('after plugin_as, auth.uid() is that player', inside.after === A);
ok('and it ends with the transaction', (await one('select auth.uid() u')).u === null);
ok('last_used_at is stamped', (await one('select last_used_at t from plugin_tokens where profile_id = $1', [A])).t !== null);

const whoB = await db.transaction(async (tx) => {
  await tx.query('select plugin_as($1)', [tokenB]);
  return (await tx.query('select auth.uid() u, is_admin() adm')).rows[0];
});
ok("Bob's token is Bob, never Alice", whoB.u === B && whoB.adm === false);

// An organiser's own site session must not leak into a token request, and a
// forged act-as-team header must not survive plugin_as.
const hdr = await db.transaction(async (tx) => {
  await tx.query(`select set_config('request.headers', '{"x-act-as-team":"some-team"}', true)`);
  await tx.query('select plugin_as($1)', [tokenB]);
  return (await tx.query(`select current_setting('request.headers', true) h`)).rows[0].h;
});
ok('plugin_as clears the request headers', hdr === '{}');

for (const [name, bad] of [
  ['a made-up token', 'hse_' + 'f'.repeat(64)],
  ['a wrong shape', 'not-a-token'],
  ['an empty token', ''],
  ['the hash used as a token', 'hse_' + stored.token_hash],
]) {
  ok(`${name} is refused`, /Unknown or revoked/.test(await raises('select plugin_as($1)', [bad]) ?? ''));
}
ok('a null token is refused', /Unknown or revoked/.test(await raises('select plugin_as(null)') ?? ''));

// ---- revoking ----
const idA = (await one('select id from plugin_tokens where profile_id = $1', [A])).id;
const errB = await raisesAs(B, 'select plugin_token_revoke($1)', [idA]);
ok("Bob cannot revoke Alice's token", /No such plugin token/.test(errB ?? ''), `got ${errB}`);
ok("and Alice's token still works", (await one('select plugin_as($1) p', [tokenA])).p === A);

await as(A, (tx) => tx.query('select plugin_token_revoke($1)', [idA]));
ok('a revoked token is refused', /Unknown or revoked/.test(await raises('select plugin_as($1)', [tokenA]) ?? ''));
ok('a revoked token leaves the list',
   (await as(A, async (tx) => (await tx.query('select * from plugin_token_list()')).rows)).length === 0);

const idB = (await one('select id from plugin_tokens where profile_id = $1', [B])).id;
await as(ORG, (tx) => tx.query('select plugin_token_revoke($1)', [idB]));
ok("an organiser can revoke anybody's", /Unknown or revoked/.test(await raises('select plugin_as($1)', [tokenB]) ?? ''));

// ---- the cap ----
await as(A, async (tx) => { for (let i = 0; i < 5; i++) await tx.query('select plugin_token_create()'); });
const cap = await raisesAs(A, 'select plugin_token_create()');
ok('a sixth live token is refused', /already have 5/.test(cap ?? ''), `got ${cap}`);
ok('and no sixth row was written',
   (await one('select count(*)::int n from plugin_tokens where profile_id = $1 and revoked_at is null', [A])).n === 5);

// ---- grants ----
const grants = (await db.query(`
  select p.proname, r.rolname,
         has_function_privilege(r.rolname, p.oid, 'execute') can
    from pg_proc p cross join (values ('anon'),('authenticated'),('service_role')) r(rolname)
   where p.proname like 'plugin\\_%' and p.pronamespace = 'public'::regnamespace`)).rows;
const can = (fn, role) => grants.find((g) => g.proname === fn && g.rolname === role)?.can;
ok('anon can call nothing', grants.filter((g) => g.rolname === 'anon').every((g) => !g.can));
ok('nobody is granted plugin_as', ['anon', 'authenticated', 'service_role'].every((r) => !can('plugin_as', r)));
// The functions that take a token are in 002 and checked there
// (regions.test.mjs): this file grants the service role nothing.
ok('the service role can call nothing here', grants.filter((g) => g.rolname === 'service_role').every((g) => !g.can));
ok('a signed-in player can manage their tokens',
   can('plugin_token_create', 'authenticated') && can('plugin_token_list', 'authenticated') && can('plugin_token_revoke', 'authenticated'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
