// A small Region Bingo game for the plugin tests, built on a replay of every
// migration through the functions the console and the site call.
//
//   Red  (captain Red Cap, member Red Mate)   Blue (captain Blue Cap)
//   Misthalin: Barrows chest (Dharok's helm, Karil's coif; needs 2),
//              Any helmet (Dharoks helm), Whip (Abyssal whip)
//   Asgarnia:  Locked secret tile (Dragon pickaxe)
//   one filler tile in each of the other nine regions
//
// The game is started and every player has a plugin token. Nobody has picked
// a region yet.

import { readFileSync } from 'node:fs';
import { replay } from './replay.mjs';

export const J = (v) => JSON.stringify(v);

export async function buildGame() {
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

  // ------------------------------------------------------------------ the game
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

  const tok = {};
  for (const key of ['org', 'red', 'mate', 'blue', 'out']) {
    tok[key] = (await site(ids[key], 'select plugin_token_create($1) t', [key]))[0].t;
  }

  return { db, ids, g, team, T, opt, tok, site, plugin, trying };
}
