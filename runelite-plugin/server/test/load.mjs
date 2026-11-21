// A load test of the intake function on the local stack (Boris, 2026-11-21:
// "tens or sometimes hundreds of items within 1 minute" during an event).
// Not part of `npm test`, and not the live project: it refuses any API that
// is not on this machine.
//
// It builds its own Region Bingo game, made the way stack.test.mjs makes one:
// 40 players in 4 teams, each with a token and an in-game name, every
// captain's first region Misthalin, Dink on. Then it sends Dink notifications
// the way Dink sends them (multipart, payload_json + a PNG), at a fixed rate
// whatever the answers, so a slow answer does not slow the senders down. A
// request that is not answered 200 is sent again as Dink sends it again: up
// to three times, after 2, 4 and 8 seconds.
//
//   warm-up    60 a minute for 30 s
//   steady    300 a minute for 2 minutes   ("hundreds a minute")
//   peak    1,000 a minute for 1 minute
//   burst     200 at the same moment       (a whole clan's kills landing at once)
//
// What a notification holds, chosen at random for each one:
//   94%  1-4 drops nobody's tile wants (the cows, the runes, the bones)
//    5%  a drop one open tile wants: stored and handed in
//    1%  a drop two open tiles want: stored and kept for the team to choose
// and its screenshot:
//   60%  765x503, half of it noise      (~0.6 MB, the fixed-size client)
//   35%  1280x720 noise                 (~2.8 MB, just under the 3 MB limit)
//    5%  1920x1080 noise                (~6.2 MB, over it: a kept one is shrunk)
// Noise compresses about as badly as a PNG can, so these are at the heavy end
// of what Dink sends.
//
// Measured: every answer's status and time, the containers' CPU and memory,
// the function's own log, and the database's time per call
// (pg_stat_statements). Checked afterwards: every drop that was handed in has
// one evidence row and one file, every waiting drop one waiting row and one
// file, and no file is left without its row. The game is ended at the end;
// its files stay on the local stack.
//
//   cd ../local && node prepare.mjs && supabase start
//   node load.mjs                 (SUPABASE_BIN / DOCKER_BIN if not on PATH)
//   node load.mjs --quick         a short run, to try the script itself

import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { dinkUrl } from '../../../web/src/lib/pluginTokens.js';
import { makePng } from './png.mjs';

const J = (v) => JSON.stringify(v);
const QUICK = process.argv.includes('--quick');

// ------------------------------------------------------------- the stack
const LOCAL = fileURLToPath(new URL('../local/', import.meta.url));
const besideRepo = fileURLToPath(new URL('../../../../tools/supabase-cli/supabase.exe', import.meta.url));
const SUPABASE = process.env.SUPABASE_BIN ?? (existsSync(besideRepo) ? besideRepo : 'supabase');
const DOCKER = process.env.DOCKER_BIN ?? 'docker';
const DB = 'supabase_db_hs-events-plugin-local';
const EDGE = 'supabase_edge_runtime_hs-events-plugin-local';
const WATCHED = [EDGE, DB, 'supabase_rest_hs-events-plugin-local', 'supabase_storage_hs-events-plugin-local',
  'supabase_kong_hs-events-plugin-local'];

const status = JSON.parse(execFileSync(SUPABASE, ['status', '-o', 'json'],
  { cwd: LOCAL, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const { API_URL: API, ANON_KEY: ANON, SERVICE_ROLE_KEY: SERVICE } = status;
if (!API || !ANON || !SERVICE) throw new Error('supabase status gave no API URL or keys: is the stack running?');
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(API)) throw new Error('Refusing to run against anything but a local stack');

const sql = (q) => execFileSync(DOCKER,
  ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'],
  { input: q, encoding: 'utf8' }).trim();
const sqlJson = (q) => JSON.parse(sql(`select coalesce(json_agg(t), '[]') from (${q}) t`));

async function rpc(fn, args, as) {
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: as === SERVICE ? SERVICE : ANON, Authorization: `Bearer ${as}`, 'Content-Type': 'application/json' },
    body: J(args),
  });
  const text = await res.text();
  if (res.status >= 300) throw new Error(`${fn}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// ------------------------------------------------------------- the screenshots
let seed = 0x9e3779b9;
const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2 ** 32; };
const noise = () => (rand() * 256) | 0;
console.log('Making the screenshots ...');
const SHOTS = [
  { name: 'small', share: 0.60, png: makePng(765, 503, (x) => (x < 383 ? noise() : 40), { channels: 3 }).bytes },
  { name: 'medium', share: 0.35, png: makePng(1280, 720, noise, { channels: 3 }).bytes },
  { name: 'large', share: 0.05, png: makePng(1920, 1080, noise, { channels: 3 }).bytes },
];
for (const s of SHOTS) console.log(`  ${s.name}: ${(s.png.length / 1e6).toFixed(2)} MB`);
const pickShot = () => { let r = rand(); for (const s of SHOTS) { if ((r -= s.share) < 0) return s; } return SHOTS[0]; };

// ------------------------------------------------------------- the people
const run = Date.now().toString(36);
const PLAYERS = QUICK ? 8 : 40;
const TEAMS = 4;
console.log(`Load test ${run} against ${API}: ${PLAYERS} players in ${TEAMS} teams${QUICK ? ' (quick)' : ''}`);

async function person(key, name) {
  const email = `${key}-${run}@plugin-load-test.invalid`;
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
  return { id, jwt: (await signedIn.json()).access_token };
}

const org = await person('org', 'Load organiser');
sql(`update profiles set is_admin = true where id = '${org.id}'`);
const players = [];
for (let i = 0; i < PLAYERS; i++) {
  const p = await person(`p${i}`, `Load player ${i}`);
  p.rsn = `L${run.slice(-5)} ${i}`; // RuneScape names are at most 12 characters
  const res = await fetch(`${API}/rest/v1/profile_accounts`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${p.jwt}`, 'Content-Type': 'application/json' },
    body: J({ profile_id: p.id, rsn: p.rsn }),
  });
  if (!res.ok) throw new Error(`adding p${i}'s account: ${res.status} ${await res.text()}`);
  p.token = await rpc('plugin_token_create', { p_label: 'load test' }, p.jwt);
  players.push(p);
}

// ------------------------------------------------------------- the game
const teamNames = Array.from({ length: TEAMS }, (_, i) => `Team ${i + 1}`);
const g = await rpc('admin_new_game', { p_name: `Load test ${run}`, p_mode: 'regions', p_teams: teamNames,
  p_grid_size: 3, p_ends_at: new Date(Date.now() + 86400e3).toISOString() }, org.jwt);
const teamId = Object.fromEntries(sqlJson(`select name, id from teams where game_id = '${g}'`).map((r) => [r.name, r.id]));
const tile = (square, spec) => rpc('admin_set_tile', { p_game_id: g, p_row: Math.floor((square - 1) / 10) + 1,
  p_col: ((square - 1) % 10) + 1, p_tile: spec }, org.jwt);
// Misthalin, every team's first region. Thirty each, so none fills up during
// the run and every wanted drop is handed in rather than refused.
const ONE = ['Abyssal whip', 'Dragon chainbody', 'Dragon pickaxe'];
for (const [i, name] of ONE.entries()) {
  await tile(i + 1, { name, rule: 'points', amount: 30, options: [{ label: name, points: 1 }] });
}
await tile(4, { name: 'Dragon bones, one', rule: 'points', amount: 30, options: [{ label: 'Dragon bones', points: 1 }] });
await tile(5, { name: 'Dragon bones, two', rule: 'points', amount: 30, options: [{ label: 'Dragon bones', points: 1 }] });
for (let k = 2; k <= 11; k++) await tile((k - 1) * 100 + 1, { name: `Filler ${k}` });

players.forEach((p, i) => { p.team = teamNames[i % TEAMS]; });
for (const name of teamNames) {
  const members = players.filter((p) => p.team === name);
  for (const [j, p] of members.entries()) {
    await rpc('admin_set_member', { p_team_id: teamId[name], p_profile_id: p.id, p_role: j === 0 ? 'captain' : 'member' }, org.jwt);
  }
}
await rpc('start_game', { p_game_id: g }, org.jwt);
for (const name of teamNames) {
  await rpc('regions_pick', { p_game_id: g, p_region: 'misthalin' }, players.find((p) => p.team === name).jwt);
}
await rpc('admin_set_plugin_drops', { p_game_id: g, p_on: true }, org.jwt);
console.log(`Game ${g} built and started, Dink on; every team has Misthalin open.`);


const JUNK = ['Bones', 'Big bones', 'Coins', 'Rune med helm', 'Nature rune', 'Law rune', 'Grimy ranarr weed',
  'Raw shark', 'Adamant platelegs', 'Uncut sapphire', 'Cowhide', 'Raw beef', 'Feather', 'Death rune', 'Steel arrow'];
function notification(p, n) {
  const r = rand();
  const kind = r < 0.01 ? 'ask' : r < 0.06 ? 'one' : 'none';
  const items = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => JUNK[Math.floor(rand() * JUNK.length)]);
  if (kind === 'one') items[0] = ONE[Math.floor(rand() * ONE.length)];
  if (kind === 'ask') items[0] = 'Dragon bones';
  return {
    kind,
    payload: {
      content: '%USERNAME% has looted:', type: 'LOOT', playerName: p.rsn, accountType: 'NORMAL', seasonalWorld: false,
      dinkAccountHash: `load-${run}-${p.rsn}`, world: 302 + (n % 40), regionId: 12850, embeds: [],
      // killCount makes every notification its own, so none is taken for a retry.
      extra: { items: items.map((name, k) => ({ id: 526 + k, quantity: 1, priceEach: 100, name, criteria: [] })),
               source: 'Cow', category: 'NPC', killCount: n },
    },
  };
}
function multipart(payload, image) {
  const b = randomUUID();
  const json = Buffer.from(J(payload), 'utf8');
  return {
    type: `multipart/form-data; boundary=${b}`,
    body: Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Length: ${json.length}\r\n\r\n`), json,
      Buffer.from(`\r\n--${b}\r\nContent-Disposition: form-data; name="file"; filename="lootImage.png"\r\n`
        + `Content-Type: image/png\r\nContent-Length: ${image.length}\r\n\r\n`), Buffer.from(image),
      Buffer.from(`\r\n--${b}--\r\n`),
    ]),
  };
}

// Whatever happens from here, the game is ended at the end: one game at a time.
let allOk = false;
try {
  // ------------------------------------------------------------- watching
  const docker = promisify(execFile);
  const samples = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      try {
        const { stdout } = await docker(DOCKER, ['stats', '--no-stream', '--format', '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}', ...WATCHED]);
        const at = Date.now();
        for (const line of stdout.trim().split('\n')) {
          const [name, cpu, mem] = line.split('\t');
          samples.push({ at, name, cpu: parseFloat(cpu), mem: mem.split('/')[0].trim() });
        }
      } catch { /* a missed sample is only a gap */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
  })();
  const memMiB = (s) => { const m = /([\d.]+)\s*([KMG]i?B)/.exec(s); if (!m) return NaN;
    return Number(m[1]) * ({ KiB: 1 / 1024, MiB: 1, GiB: 1024, KB: 1 / 1000, MB: 1, GB: 1000 }[m[2]] ?? 1); };

  const logStart = spawnSync(DOCKER, ['logs', EDGE], { encoding: 'utf8' });
  const logOffset = ((logStart.stdout ?? '') + (logStart.stderr ?? '')).length;
  const stmtsBefore = sqlJson(`select queryid::text, calls, total_exec_time from pg_stat_statements where query ~* 'plugin_'`);

  // ------------------------------------------------------------- sending
  let n = 0;
  const sent = [];
  async function send(p, phase) {
    const k = ++n;
    const { kind, payload } = notification(p, k);
    const shot = pickShot();
    const { body, type } = multipart(payload, shot.png);
    const rec = { phase, kind, shot: shot.name, bytes: body.length, tries: 0 };
    sent.push(rec);
    // As Dink does (DiscordMessageHandler): an answer that is not a 2xx, or
    // no answer, is sent again, up to three times, after 2, 4 and 8 seconds.
    for (const pause of [0, 2000, 4000, 8000]) {
      if (pause) await new Promise((r) => setTimeout(r, pause));
      const started = performance.now();
      rec.tries++;
      try {
        const res = await fetch(dinkUrl(API, p.token), { method: 'POST', headers: { 'Content-Type': type }, body });
        await res.text();
        rec.status = res.status;
      } catch (e) {
        rec.status = 'network';
        rec.error = e.message;
      }
      if (rec.tries === 1) { rec.first = rec.status; rec.ms = performance.now() - started; }
      if (rec.status >= 200 && rec.status < 300) break;
    }
  }
  const randomPlayer = () => players[Math.floor(rand() * players.length)];

  async function steady(phase, perMinute, seconds) {
    const gap = 60000 / perMinute;
    const total = Math.round(perMinute * seconds / 60);
    const t0 = performance.now();
    const inFlight = [];
    for (let i = 0; i < total; i++) {
      const due = t0 + i * gap;
      const wait = due - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      inFlight.push(send(randomPlayer(), phase));
    }
    await Promise.all(inFlight);
    return (performance.now() - t0) / 1000;
  }
  async function burst(phase, count) {
    const t0 = performance.now();
    await Promise.all(Array.from({ length: count }, () => send(randomPlayer(), phase)));
    return (performance.now() - t0) / 1000;
  }

  const PHASES = QUICK
    ? [['warm-up', () => steady('warm-up', 60, 10)], ['steady', () => steady('steady', 300, 20)], ['burst', () => burst('burst', 30)]]
    : [['warm-up', () => steady('warm-up', 60, 30)], ['steady', () => steady('steady', 300, 120)],
       ['peak', () => steady('peak', 1000, 60)], ['burst', () => burst('burst', 200)]];
  const took = {};
  const phaseWindow = {};
  for (const [name, go] of PHASES) {
    console.log(`Phase ${name} ...`);
    const from = Date.now();
    took[name] = await go();
    phaseWindow[name] = [from, Date.now()];
    await new Promise((r) => setTimeout(r, 3000));
  }
  sampling = false;
  await sampler;

  // ------------------------------------------------------------- what happened
  const pct = (xs, q) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  const f0 = (x) => (Number.isFinite(x) ? Math.round(x).toLocaleString('en-GB') : '-');
  console.log('\nAnswers, per phase. "1st ok": 200 the first time; "resent": sent again, as Dink would;');
  console.log('"lost": still not 200 after three resends. Times in ms, of the first try, from sending to the full answer:');
  console.log('phase      sent   rate/min  1st ok  resent  lost    p50    p90    p99    max   MB sent');
  for (const [name] of PHASES) {
    const rows = sent.filter((r) => r.phase === name);
    const ms = rows.map((r) => r.ms);
    const firstOk = rows.filter((r) => r.first === 200).length;
    const resent = rows.filter((r) => r.tries > 1).length;
    const lost = rows.filter((r) => r.status !== 200).length;
    const rate = rows.length / took[name] * 60;
    const mb = rows.reduce((a, r) => a + r.bytes, 0) / 1e6;
    console.log(`${name.padEnd(9)} ${String(rows.length).padStart(5)} ${f0(rate).padStart(9)} ${String(firstOk).padStart(7)} ${String(resent).padStart(7)} ${String(lost).padStart(5)}`
      + ` ${f0(pct(ms, 0.5)).padStart(6)} ${f0(pct(ms, 0.9)).padStart(6)} ${f0(pct(ms, 0.99)).padStart(6)} ${f0(Math.max(...ms)).padStart(6)} ${mb.toFixed(0).padStart(8)}`);
  }
  const firstNot = sent.filter((r) => r.first !== 200);
  if (firstNot.length) {
    const byStatus = {};
    for (const r of firstNot) byStatus[r.first] = (byStatus[r.first] ?? 0) + 1;
    const tries = {};
    for (const r of firstNot) tries[r.tries] = (tries[r.tries] ?? 0) + 1;
    console.log(`First tries not 200: ${J(byStatus)}; tries it took them (incl. the first): ${J(tries)}; `
      + `first error: ${firstNot.find((r) => r.error)?.error ?? '-'}`);
  }
  const others = sent.filter((r) => r.status !== 200);
  console.log('\nBy kind of drop, all phases (ms, first tries that were answered 200):');
  for (const kind of ['none', 'one', 'ask']) {
    const ms = sent.filter((r) => r.kind === kind && r.first === 200).map((r) => r.ms);
    console.log(`  ${kind.padEnd(5)} ${String(ms.length).padStart(5)} answered   p50 ${f0(pct(ms, 0.5))}   p90 ${f0(pct(ms, 0.9))}   max ${f0(Math.max(...ms))}`);
  }

  console.log('\nContainers, per phase (CPU % of one core, peak; memory peak):');
  for (const [name] of PHASES) {
    const [a, b] = phaseWindow[name];
    const line = WATCHED.map((c) => {
      const s = samples.filter((x) => x.name === c && x.at >= a && x.at <= b + 1500);
      const short = c.replace('supabase_', '').replace('_hs-events-plugin-local', '');
      return `${short} ${f0(Math.max(...s.map((x) => x.cpu)))}% ${f0(Math.max(...s.map((x) => memMiB(x.mem))))} MiB`;
    }).join(' | ');
    console.log(`  ${name.padEnd(8)} ${line}`);
  }

  // The function's own log for this run: one line per request it understood.
  const logAll = spawnSync(DOCKER, ['logs', EDGE], { encoding: 'utf8' });
  const log = ((logAll.stdout ?? '') + (logAll.stderr ?? '')).slice(logOffset);
  const outcomes = {};
  let submitted = 0, waiting = 0, resizedCount = 0, repeats = 0;
  for (const m of log.matchAll(/\{"outcome":"([a-z_]+)".*$/gm)) {
    outcomes[m[1]] = (outcomes[m[1]] ?? 0) + 1;
    try {
      const o = JSON.parse(m[0]);
      for (const r of o.results ?? []) { if (r.submitted) submitted++; if (r.waiting) waiting++; if (r.duplicate) repeats++; }
      if (o.resized) resizedCount++;
    } catch { /* a line cut by the log */ }
  }
  // Counted by kind: ids, addresses and tokens taken out, so alike lines meet.
  const trouble = {};
  for (const l of log.split('\n')) {
    if (!/intake failed|cleanup failed|memory|worker.*(error|exit|kill|termin|retired|cancelled)|wall ?clock|cpu time|early drop|early termination/i.test(l)) continue;
    const kind = l.replace(/hse_[0-9a-f]{64}/g, 'hse_<token>')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')
      .replace(/\d+\.\d+\.\d+\.\d+:\d+/g, '<addr>').replace(/^\s*\[\w+\]\s*/, '').replace(/\u001b\[\d+m/g, '')
      .trim().slice(0, 160);
    trouble[kind] = (trouble[kind] ?? 0) + 1;
  }
  const troubleKinds = Object.entries(trouble).sort((a, b) => b[1] - a[1]);
  console.log(`\nThe function's log: ${J(outcomes)}; drops handed in ${submitted}, kept waiting ${waiting}, `
    + `resends of a drop already kept ${repeats}, screenshots shrunk ${resizedCount}`);
  console.log(`Lines about failures or limits, by kind (an "intake failed" would be the function's own 500):`
    + (troubleKinds.length ? troubleKinds.map(([k, n]) => `\n  ${String(n).padStart(5)}  ${k}`).join('') : ' none'));

  // The database's time per call, for the plugin's functions, during the run.
  const before = new Map(stmtsBefore.map((s) => [s.queryid, s]));
  const stmts = sqlJson(`select queryid::text, calls, total_exec_time,
    coalesce(substring(query from '"public"\\."([a-z_]+)"'), left(regexp_replace(query, '\\s+', ' ', 'g'), 60)) q
    from pg_stat_statements where query ~* 'plugin_'`)
    .map((s) => ({ ...s, calls: s.calls - (before.get(s.queryid)?.calls ?? 0),
                   total: s.total_exec_time - (before.get(s.queryid)?.total_exec_time ?? 0) }))
    .filter((s) => s.calls > 0).sort((a, b) => b.total - a.total).slice(0, 6);
  console.log('\nDatabase time for the plugin calls during the run:');
  for (const s of stmts) console.log(`  ${String(s.calls).padStart(6)} calls, ${(s.total / s.calls).toFixed(2).padStart(7)} ms each  ${s.q}`);

  // ------------------------------------------------------------- consistency
  const evidence = Number(sql(`select count(*) from tile_evidence e join tile_claims c on c.id = e.claim_id
    join tiles t on t.id = c.tile_id where t.game_id = '${g}' and e.source = 'dink'`));
  const waits = Number(sql(`select count(*) from plugin_waiting where game_id = '${g}'`));
  const files = Number(sql(`select count(*) from storage.objects where bucket_id = 'evidence' and name like '${g}/%'`));
  const orphans = Number(sql(`select count(*) from storage.objects o where o.bucket_id = 'evidence' and o.name like '${g}/%'
    and not exists (select 1 from tile_evidence e where e.storage_path = o.name)
    and not exists (select 1 from plugin_waiting w where w.storage_path = o.name)`));
  const stored = Number(sql(`select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects
    where bucket_id = 'evidence' and name like '${g}/%'`));
  const sentOne = sent.filter((r) => r.kind === 'one').length;
  const sentAsk = sent.filter((r) => r.kind === 'ask').length;
  console.log('\nChecks:');
  const checks = [
    ['every request was answered 200 in the end, with Dink\'s resends', others.length === 0, `${others.length} were not`],
    ['every wanted drop was handed in, exactly once', evidence === sentOne && submitted === sentOne, J({ evidence, submitted, sentOne })],
    ['every drop two tiles want is waiting, exactly once', waits === sentAsk && waiting === sentAsk, J({ waits, waiting, sentAsk })],
    ['one file per kept drop, and none without its row', files === evidence + waits && orphans === 0, J({ files, orphans })],
  ];
  for (const [name, okay, extra] of checks) console.log(`${okay ? 'ok  ' : 'FAIL'} ${name}${okay ? '' : '  -- ' + extra}`);
  console.log(`(Kept screenshots for this game take ${(stored / 1e6).toFixed(0)} MB on the local stack.)`);

  allOk = checks.every(([, okay]) => okay);
} finally {
  await rpc('admin_end_game', { p_game_id: g }, org.jwt);
  console.log(`Game ${g} ended.`);
}
process.exit(allOk ? 0 : 1);
