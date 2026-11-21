// A small Region Bingo game for the plugin tests, built on a replay of every
// migration through the functions the console and the site call.
//
//   Red  (captain Red Cap, member Red Mate)   Blue (captain Blue Cap)
//   Misthalin: Barrows chest (Dharok's helm, Karil's coif; needs 2),
//              Any helmet (Dharoks helm), Whip (Abyssal whip)
//   Asgarnia:  Locked secret tile (Dragon pickaxe)
//   one filler tile in each of the other nine regions
//
// The game is started, Dink is switched on for it (unless `dink: false`),
// and every player has a plugin token. Nobody has picked a region yet.

import { readFileSync } from 'node:fs';
import { replay } from './replay.mjs';

export const J = (v) => JSON.stringify(v);

export async function buildGame({ dink = true } = {}) {
  const base = await buildPeople();
  return { ...base, ...(await addRegionsGame(base, { dink })) };
}

// The database with both drafts, the helpers, and the people with their
// in-game names and plugin tokens: no game yet.
export async function buildPeople() {
  const db = await replay();
  for (const f of ['001_plugin_tokens.sql', '002_plugin_drops.sql']) {
    await db.exec(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
  }

  // The site: one transaction, signed in as `who`, with the authenticated role.
  const site = async (who, sql, params = []) => db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [J({ sub: who, role: 'authenticated' })]);
    await tx.query('set local role authenticated');
    return (await tx.query(sql, params)).rows;
  });
  // The intake function: one transaction, the service role, nobody signed in.
  const plugin = async (sql, params = []) => db.transaction(async (tx) => {
    await tx.query('set local role service_role');
    return (await tx.query(sql, params)).rows[0];
  });
  // The message a call fails with, or null. A failure rolls its transaction back.
  const trying = (fn, sql, params) => {
    let msg = null;
    return fn(sql, params).catch((e) => { msg = e.message; }).then(() => msg);
  };

  // ---------------------------------------------------------------- the people
  const ids = {};
  for (const [key, name] of [['org', 'Organiser'], ['red', 'Red Cap'], ['mate', 'Red Mate'],
                             ['blue', 'Blue Cap'], ['out', 'Outsider']]) {
    ids[key] = (await db.query(
      `insert into auth.users (instance_id, aud, role, email, encrypted_password, raw_user_meta_data)
       values ('00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, '', $2)
       returning id`,
      [`${key}@plugin-test.invalid`, J({ display_name: name })])).rows[0].id;
  }
  await db.query('update profiles set is_admin = true where id = $1', [ids.org]);
  for (const [key, rsn] of [['red', 'Red Main'], ['mate', 'Mate Iron'], ['blue', 'Blue Main']]) {
    await db.query(
      `insert into profile_accounts (profile_id, rsn, is_primary)
       select $1, $2, not exists (select 1 from profile_accounts where profile_id = $1)`, [ids[key], rsn]);
  }

  const tok = {};
  for (const key of ['org', 'red', 'mate', 'blue', 'out']) {
    tok[key] = (await site(ids[key], 'select plugin_token_create($1) t', [key]))[0].t;
  }

  return { db, ids, tok, site, plugin, trying };
}

// The small Region Bingo game of the header, started, nobody's region picked.
async function addRegionsGame({ db, ids, site }, { dink = true } = {}) {
  const g = (await site(ids.org,
    `select admin_new_game('Plugin test', 'regions', array['Red','Blue'], 3::smallint, now() + interval '1 day') id`))[0].id;
  const team = {};
  for (const r of (await db.query('select id, name from teams where game_id = $1', [g])).rows) team[r.name] = r.id;

  const tile = async (square, worth, spec) => {
    const row = Math.floor((square - 1) / 10) + 1, col = ((square - 1) % 10) + 1;
    const id = (await site(ids.org, 'select admin_set_tile($1, $2::smallint, $3::smallint, $4::jsonb) id',
      [g, row, col, J(spec)]))[0].id;
    await site(ids.org, 'select admin_set_tile_worth($1, $2, $3)', [g, square, worth]);
    return id;
  };
  const T = {
    barrows: await tile(1, 5, { name: 'Barrows chest', rule: 'points', amount: 2,
      options: [{ label: "Dharok's helm", points: 1 }, { label: "Karil's coif", points: 1 }] }),
    helmet: await tile(2, 3, { name: 'Any helmet', rule: 'points', amount: 1,
      options: [{ label: 'Dharoks helm', points: 1 }] }),
    whip: await tile(3, 2, { name: 'Whip', rule: 'points', amount: 1,
      options: [{ label: 'Abyssal whip', points: 1 }] }),
    locked: await tile(101, 4, { name: 'Locked secret tile', rule: 'points', amount: 1,
      options: [{ label: 'Dragon pickaxe', points: 1 }] }),
  };
  for (let k = 3; k <= 11; k++) await tile((k - 1) * 100 + 1, 1, { name: `Filler ${k}` });

  const opt = {};
  for (const r of (await db.query(
    'select o.id, o.label from tile_options o join tiles t on t.id = o.tile_id where t.game_id = $1', [g])).rows) {
    opt[r.label] = r.id;
  }

  await site(ids.org, `select admin_set_member($1, $2, 'captain')`, [team.Red, ids.red]);
  await site(ids.org, `select admin_set_member($1, $2, 'member')`, [team.Red, ids.mate]);
  await site(ids.org, `select admin_set_member($1, $2, 'captain')`, [team.Blue, ids.blue]);
  await site(ids.org, 'select start_game($1)', [g]);
  // Through the console's own switch (draft 002, 6e): off until turned on.
  if (dink) await site(ids.org, 'select admin_set_plugin_drops($1, true)', [g]);

  return { g, team, T, opt };
}

// A Bingo game beside the Region Bingo one, 3 by 3, for bingo.test.mjs. Same
// people, plus Solo, who plays in this game only.
//
//   Red  (Red Cap, Red Mate)   Blue (Blue Cap, Solo)
//   Whip (Abyssal whip)   Pickaxe (Dragon pickaxe)   Zulrah (three uniques; needs 2)
//   Dragon bones          Rune scimitar              Draconic visage
//   Bandos chestplate     Granite maul               Dragon med helm
//
// Whip is also on Region Bingo's Misthalin, and Pickaxe on its Asgarnia, so a
// drop can be wanted in both games at once. Left in preparation: the test
// starts it. Dink is switched on for it by hand: the console only lets an
// organiser switch it on for Region Bingo for now (Boris, 2026-11-21), and
// these tests keep proving Bingo works for when he says so.
export async function addBingo({ db, ids, site }) {
  const userId = (await db.query(
    `insert into auth.users (instance_id, aud, role, email, encrypted_password, raw_user_meta_data)
     values ('00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1, '', $2)
     returning id`,
    ['solo@plugin-test.invalid', J({ display_name: 'Solo' })])).rows[0].id;
  await db.query(`insert into profile_accounts (profile_id, rsn, is_primary) values ($1, 'Solo Main', true)`, [userId]);

  const gb = (await site(ids.org,
    `select admin_new_game('Plugin bingo', 'bingo', array['Red','Blue'], 3::smallint, now() + interval '1 day') id`))[0].id;
  const teamB = {};
  for (const r of (await db.query('select id, name from teams where game_id = $1', [gb])).rows) teamB[r.name] = r.id;

  const card = [
    ['whip', 'Whip', 1, ['Abyssal whip']],
    ['pickaxe', 'Pickaxe', 1, ['Dragon pickaxe']],
    ['zulrah', 'Zulrah', 2, ['Tanzanite fang', 'Magic fang', 'Serpentine visage']],
    ['bones', 'Dragon bones', 1, ['Dragon bones']],
    ['scimitar', 'Rune scimitar', 1, ['Rune scimitar']],
    ['visage', 'Draconic visage', 1, ['Draconic visage']],
    ['bandos', 'Bandos chestplate', 1, ['Bandos chestplate']],
    ['maul', 'Granite maul', 1, ['Granite maul']],
    ['medHelm', 'Dragon med helm', 1, ['Dragon med helm']],
  ];
  const TB = {};
  for (const [i, [key, name, amount, labels]] of card.entries()) {
    TB[key] = (await site(ids.org, 'select admin_set_tile($1, $2::smallint, $3::smallint, $4::jsonb) id',
      [gb, Math.floor(i / 3) + 1, (i % 3) + 1,
       J({ name, rule: 'points', amount, options: labels.map((label) => ({ label, points: 1 })) })]))[0].id;
  }
  const optB = {};
  for (const r of (await db.query(
    'select o.id, o.label from tile_options o join tiles t on t.id = o.tile_id where t.game_id = $1', [gb])).rows) {
    optB[r.label] = r.id;
  }

  await site(ids.org, `select admin_set_member($1, $2, 'captain')`, [teamB.Red, ids.red]);
  await site(ids.org, `select admin_set_member($1, $2, 'member')`, [teamB.Red, ids.mate]);
  await site(ids.org, `select admin_set_member($1, $2, 'captain')`, [teamB.Blue, ids.blue]);
  await site(ids.org, `select admin_set_member($1, $2, 'member')`, [teamB.Blue, userId]);

  await db.query('update games set plugin_drops = true where id = $1', [gb]);

  const solo = { id: userId, tok: (await site(userId, `select plugin_token_create('solo') t`))[0].t };
  return { gb, teamB, TB, optB, solo };
}
