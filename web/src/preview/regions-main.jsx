/**
 * Region Bingo harness. Open /preview-regions.html on `npm run preview:evidence`.
 *
 * Renders the REAL RegionsGame against a small simulation of the server, so
 * the screens can be played without a database: pick a region, upload
 * screenshots (any image -- it never leaves the browser), reach the line and
 * spend the pick. The bars on top switch team and role, make a rival move and
 * skip to the end.
 *
 * The simulation follows docs/region-bingo-rules.md and answers in the shapes
 * board_for_me does (tiles + regions_state + regions_standings), so the page
 * goes through the same fromServer as the app. It is NOT the server: that is
 * supabase/migrations/20261116120100_regions_mode.sql and its smoke test.
 */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import RegionsGame from '../components/regions/RegionsGame.jsx';
import Wordmark from '../components/Wordmark.jsx';
import { evidenceHandlers } from './stub-evidence.js';
import { REGIONS, fromServer, needFor, regionAt, squaresOf } from '../lib/regions.js';
import '../styles.css';
import '../seasons.css';
import '../lib/season.js';

const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();
const THRESHOLD = 50;

// region -> [task, worth, screenshots]. Sizes differ on purpose: the
// Wilderness is short of content, as the clan said it would be.
const TASKS = {
  misthalin: [['Kill the Giant Mole', 3, 2], ['Catch 50 shrimps at Draynor', 1, 1],
    ['Varrock easy diary', 2, 1], ['Obor kill', 1, 1], ['Stronghold of Security boots', 2, 1]],
  asgarnia: [['Kill a Black Knight Titan', 2, 1], ['Craft 100 air runes', 1, 1],
    ['Bryophyta kill', 3, 1], ['Win a game in the Burthorpe games room', 1, 1], ['10 dragon bones in Taverley', 2, 2]],
  kandarin: [['20 laps of the Seers rooftop', 2, 1], ['Barbarian Assault: a gamble', 3, 1],
    ['Catch a shark at Catherby', 1, 1], ['Kraken kill', 4, 2], ['Thermonuclear smoke devil kill', 3, 1], ['Make a gnome cocktail', 1, 1]],
  fremennik: [['Dagannoth Rex kill', 3, 1], ['Catch a sapphire glacialis', 1, 1],
    ['Unlock the Lunar spellbook', 2, 1], ['Vorkath kill', 5, 2]],
  wilderness: [['Callisto kill', 4, 1], ['Lap of the Wilderness agility course', 1, 1], ['Mage Arena cape', 2, 1]],
  morytania: [['Barrows chest with an item', 4, 1], ['Hallowed Sepulchre floor 3', 3, 1],
    ['20 gargoyles in the Slayer Tower', 2, 1], ['Theatre of Blood completion', 5, 1], ['30 Mort Myre fungi', 1, 1]],
  desert: [['Kalphite Queen kill', 4, 1], ["Pharaoh's sceptre", 5, 1],
    ['Buy a waterskin in Nardah', 1, 1], ['50 desert lizards', 1, 1]],
  karamja: [['Fire cape', 5, 1], ['20 Brimhaven agility tickets', 2, 1],
    ['Cook a karambwan', 1, 1], ['TzHaar-Ket-Rak challenge 1', 3, 1]],
  tirannwn: [['Zulrah kill', 4, 1], ['Complete the Gauntlet', 4, 1], ['5 crystal shards', 1, 1]],
  kourend: [['Wintertodt crate', 1, 1], ['Chambers of Xeric completion', 5, 1],
    ['Lizardman shaman kill', 2, 1], ['100 Tithe Farm points', 1, 1], ['Sarachnis kill', 3, 1]],
  varlamore: [['Fortis Colosseum wave 3', 3, 1], ['Hunter Guild rumour', 1, 1],
    ['Moons of Peril chest', 3, 1], ['Pickpocket a wealthy citizen', 1, 1]],
};

const TILES = REGIONS.flatMap((r) => (TASKS[r.key] ?? []).slice(0, 9).map(([name, worth, need], i) => ({
  id: `tile-${r.key}-${i}`, position: squaresOf(r.key)[i], name, icon: null, worth,
  completion: 'points', required_evidence: need, options: [],
})));
const tileById = new Map(TILES.map((t) => [t.id, t]));
const regionName = new Map(REGIONS.map((r) => [r.key, r.name]));

const TEAMS = [
  { id: 't-1', name: 'Lumby Lads', slot: 1 },
  { id: 't-2', name: 'Falador Knights', slot: 2 },
  { id: 't-3', name: 'Canifis Howlers', slot: 3 },
  { id: 't-4', name: 'Hosidius Harvest', slot: 4 },
];
const PLAYERS = { 't-1': 'Sanchez', 't-2': 'Nieve', 't-3': 'Duradel', 't-4': 'Vannaka' };

function fakeShot(label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">
    <rect width="320" height="200" fill="#2a2a2c"/><text x="160" y="96" fill="#8a8a8f"
    font-family="system-ui" font-size="18" text-anchor="middle">screenshot</text>
    <text x="160" y="124" fill="#f2c14e" font-family="system-ui" font-size="14"
    text-anchor="middle">${label}</text></svg>`;
  return new File([svg], 'shot.svg', { type: 'image/svg+xml' });
}

// ---- the simulated server ----

function freshStore(seeded) {
  const s = {
    seq: 0,
    game: {
      id: 'g-preview', name: 'Region Bingo — preview', mode: 'regions', status: 'active',
      ends_at: inHours(26), region_threshold: THRESHOLD, starts_at: inHours(-5),
    },
    unlocks: new Map(TEAMS.map((t) => [t.id, []])),
    claims: new Map(TEAMS.map((t) => [t.id, new Map()])),
    events: [],
    evidence: [],
  };
  S = s;
  if (seeded) {
    // A few hours in. Lumby Lads finished Misthalin's line and have a pick.
    seed('t-1', 'misthalin', [0, 1, 3]);
    seed('t-2', 'asgarnia', [0, 1]);
    seed('t-3', 'morytania', [0, 1, 4]);
    pick('t-3', 'desert');
    seed('t-3', 'desert', [3]);
    seed('t-4', 'kourend', [0]);
  }
  return s;
}
let S;

function pushEvent(type, teamId, payload, teamPrivate = false) {
  S.events.unshift({
    id: `e-${++S.seq}`, type, team_id: teamId, created_at: new Date().toISOString(),
    team_private: teamPrivate, payload: { mode: 'regions', ...payload },
  });
}

const totals = (key) => {
  const ts = TILES.filter((t) => regionAt(t.position) === key);
  const total = ts.reduce((n, t) => n + t.worth, 0);
  return { tiles: ts.length, total, need: needFor(total, S.game.region_threshold) };
};
const done = (teamId) => TILES.filter((t) => S.claims.get(teamId).get(t.id)?.done);
const pointsIn = (teamId, key) => done(teamId).filter((t) => regionAt(t.position) === key).reduce((n, t) => n + t.worth, 0);
const opened = (teamId, key) => S.unlocks.get(teamId).find((u) => u.region === key);
const funds = (teamId, key) => S.unlocks.get(teamId).some((u) => u.funded_by === key);
const complete = (teamId, key) => totals(key).total > 0 && pointsIn(teamId, key) >= totals(key).need;
const picksOf = (teamId) => REGIONS.filter((r) => complete(teamId, r.key) && !funds(teamId, r.key)).length;

/** regions_pick */
function pick(teamId, key, asCaptain = true) {
  if (S.game.status !== 'active') throw new Error(`The game is ${S.game.status} — regions are picked while it runs`);
  if (opened(teamId, key)) throw new Error(`Your team already has ${regionName.get(key)}`);
  const first = S.unlocks.get(teamId).length === 0;
  let fund = null;
  if (first) {
    if (!asCaptain) throw new Error('Your captain picks your first region');
  } else {
    fund = REGIONS.find((r) => complete(teamId, r.key) && !funds(teamId, r.key))?.key ?? null;
    if (!fund) throw new Error(`No pick yet — reach ${S.game.region_threshold}% of a region's points first`);
  }
  S.unlocks.get(teamId).push({ region: key, funded_by: fund, opened_at: new Date(Date.now() + S.seq).toISOString() });
  pushEvent('region_opened', teamId, { region: key, region_name: regionName.get(key), first, funded_by: fund });
  return { region: key, first, funded_by: fund };
}

/** regions_open_tile */
function openTile(teamId, tileId) {
  const tile = tileById.get(tileId);
  if (!opened(teamId, regionAt(tile.position))) throw new Error('Your team has not opened that region yet');
  const mine = S.claims.get(teamId);
  const claim = mine.get(tileId) ?? { claim_id: `cl-${teamId}-${tileId}`, count: 0, done: false };
  mine.set(tileId, claim);
  return claim.claim_id;
}

/** complete_regions_tile */
function finishTile(teamId, tile) {
  const key = regionAt(tile.position);
  const before = pointsIn(teamId, key);
  Object.assign(S.claims.get(teamId).get(tile.id), { done: true, doneAt: ++S.seq });
  const after = pointsIn(teamId, key);
  const { need, total } = totals(key);
  const all = done(teamId).reduce((n, t) => n + t.worth, 0);
  pushEvent('tile_completed', teamId, {
    tile_id: tile.id, region: key, region_name: regionName.get(key), worth: tile.worth,
    region_points: after, region_need: need, points: all,
  });
  if (total > 0 && after >= need && before < need && !funds(teamId, key)) {
    pushEvent('region_completed', teamId, {
      region: key, region_name: regionName.get(key), region_points: after, region_need: need,
      threshold: S.game.region_threshold,
      can_pick: REGIONS.some((r) => !opened(teamId, r.key)),
    });
  }
}

function seed(teamId, key, indexes) {
  if (!opened(teamId, key)) pick(teamId, key);
  for (const i of indexes) {
    const tile = TILES.filter((t) => regionAt(t.position) === key)[i];
    openTile(teamId, tile.id);
    finishTile(teamId, tile);
  }
}

/** add_evidence */
function addEvidence({ claimId, file }) {
  for (const [teamId, mine] of S.claims) {
    for (const [tileId, claim] of mine) {
      if (claim.claim_id !== claimId) continue;
      if (claim.done) throw new Error('This tile is already completed');
      claim.count += 1;
      const path = `g/${teamId}/${claimId}/${++S.seq}`;
      evidenceHandlers.urls[path] = URL.createObjectURL(file);
      S.evidence.unshift({
        id: `ev-${S.seq}`, claim_id: claimId, storage_path: path,
        uploaded_by_name: PLAYERS[teamId], created_at: new Date().toISOString(), points: 1,
      });
      const tile = tileById.get(tileId);
      pushEvent('evidence_submitted', teamId, {
        claim_id: claimId, position: tile.position, tile_name: tile.name,
        uploaded_by_name: PLAYERS[teamId], evidence_count: claim.count, required_evidence: tile.required_evidence,
        progress: { unit: 'evidence', have: claim.count, need: tile.required_evidence },
      }, true);
      if (claim.count >= tile.required_evidence) {
        finishTile(teamId, tile);
        return { completed: true };
      }
      return { completed: false };
    }
  }
  throw new Error('No such claim');
}

/** regions_standings */
function standings() {
  const rows = TEAMS.map((t) => {
    const mine = done(t.id);
    return {
      team_id: t.id, team_name: t.name, slot: t.slot,
      points: mine.reduce((n, x) => n + x.worth, 0),
      tiles_completed: mine.length,
      reached: Math.max(0, ...mine.map((x) => S.claims.get(t.id).get(x.id).doneAt)),
      regions_open: S.unlocks.get(t.id).map((u) => u.region),
      regions_complete: REGIONS.filter((r) => complete(t.id, r.key)).map((r) => r.key),
      picks: picksOf(t.id),
      needs_start: S.unlocks.get(t.id).length === 0,
    };
  // As the server: a tie goes to whoever got there first.
  }).sort((a, b) => b.points - a.points || a.reached - b.reached || a.slot - b.slot);
  return rows.map((r, i) => ({ ...r, place: i + 1 }));
}

/** board_for_me: tiles_for_me and regions_state, for one team. */
function boardFor(teamId, isCaptain) {
  const all = S.game.status === 'finished';
  const visible = TILES.filter((t) => all || opened(teamId, regionAt(t.position)));
  const tiles = visible.map((t) => {
    const c = S.claims.get(teamId).get(t.id);
    return {
      ...t, worth: undefined,
      claim_id: c?.claim_id ?? null,
      claim_status: c?.done ? 'completed' : c ? 'active' : null,
      evidence_count: c?.count ?? 0,
      claimed_by_name: c ? PLAYERS[teamId] : null,
    };
  });
  const regions = {
    threshold: S.game.region_threshold,
    team_id: teamId,
    is_captain: isCaptain,
    needs_start: S.unlocks.get(teamId).length === 0,
    picks: picksOf(teamId),
    regions: REGIONS.map((r) => {
      const u = opened(teamId, r.key);
      if (!u && !all) return { key: r.key, opened: false };
      const tt = totals(r.key);
      return {
        key: r.key, opened: Boolean(u), opened_at: u?.opened_at ?? null, funded_by: u?.funded_by ?? null,
        complete: complete(teamId, r.key), funds: funds(teamId, r.key),
        points: pointsIn(teamId, r.key), need: tt.need, total: tt.total, tiles: tt.tiles,
      };
    }),
    worth: Object.fromEntries(visible.map((t) => [String(t.position), t.worth])),
  };
  return { tiles, regions };
}

function beforeStart(isCaptain) {
  return {
    tiles: [],
    regions: {
      threshold: S.game.region_threshold, is_captain: isCaptain, needs_start: true, picks: 0,
      regions: REGIONS.map((r) => ({ key: r.key, opened: false })), worth: {},
    },
  };
}

function rivalMove(me) {
  const rivals = TEAMS.filter((t) => t.id !== me);
  const t = rivals[Math.floor(Math.random() * rivals.length)];
  if (S.unlocks.get(t.id).length === 0 || picksOf(t.id) > 0) {
    const free = REGIONS.filter((r) => !opened(t.id, r.key));
    if (free.length) { pick(t.id, free[Math.floor(Math.random() * free.length)].key); return; }
  }
  const options = TILES.filter((x) => opened(t.id, regionAt(x.position)) && !S.claims.get(t.id).get(x.id)?.done);
  if (!options.length) return;
  const tile = options[Math.floor(Math.random() * options.length)];
  openTile(t.id, tile.id);
  finishTile(t.id, tile);
}

function endGame() {
  const top = standings().find((r) => r.points > 0);
  S.game = { ...S.game, status: 'finished', winner_team_id: top?.team_id ?? null, ended_reason: 'time_up', ends_at: new Date().toISOString() };
  pushEvent('game_ended', top?.team_id ?? null, { reason: 'time_up', points: top?.points ?? 0 });
}

freshStore(true);

function Harness() {
  const [, setVersion] = useState(0);
  const [me, setMe] = useState(TEAMS[0].id);
  const [captain, setCaptain] = useState(true);
  const [prep, setPrep] = useState(false);
  const [error, setError] = useState(null);
  const bump = () => setVersion((v) => v + 1);
  const run = (fn) => async (...args) => {
    setError(null);
    try { const out = await fn(...args); bump(); return out; } catch (e) { setError(e.message); bump(); throw e; }
  };

  evidenceHandlers.upload = async (args) => {
    await new Promise((r) => setTimeout(r, 250));
    const out = addEvidence(args);
    bump();
    return out;
  };

  // "Before start" is what the server sends then: no region opened, no
  // points, nothing in the feed -- not the running game with another status.
  const board = prep ? beforeStart(captain) : boardFor(me, captain);
  const view = fromServer(board);
  const myClaimIds = new Set([...S.claims.get(me).values()].map((c) => c.claim_id));
  const game = prep ? { ...S.game, status: 'placement', starts_at: inHours(3) } : S.game;
  const rows = prep
    ? standings().map((r) => ({ ...r, points: 0, tiles_completed: 0, regions_open: [], regions_complete: [], picks: 0, needs_start: true }))
    : standings();

  const actions = {
    pick: run(async (key) => pick(me, key, captain)),
    openTile: run(async (tileId) => openTile(me, tileId)),
  };

  const tileTools = (tile) => {
    if (S.game.status !== 'active' || tile.claim_status === 'completed') return null;
    return (
      <div className="harness-tools">
        <button onClick={run(async () => addEvidence({ claimId: openTile(me, tile.id), file: fakeShot(tile.name) }))}>
          Simulate a screenshot
        </button>
        <span className="muted"> harness only</span>
      </div>
    );
  };

  return (
    <main className="app game-app">
      <header className="top"><Wordmark mode="regions" /></header>
      <p className="muted" style={{ marginTop: 0 }}>
        Harness — no database. Play as any team; uploads stay in this browser tab. Use
        &ldquo;Simulate a screenshot&rdquo; under a task for speed, or upload a real image.
      </p>
      <div className="tabs">
        {TEAMS.map((t) => (
          <button key={t.id} className={me === t.id ? 'on' : ''} onClick={() => setMe(t.id)}>
            Play as {t.name}
          </button>
        ))}
      </div>
      <div className="tabs">
        <button className={captain ? 'on' : ''} onClick={() => setCaptain((c) => !c)}>
          {captain ? 'As the captain' : 'As a member'}
        </button>
        <button onClick={run(() => rivalMove(me))} disabled={S.game.status !== 'active'}>Rival move</button>
        <button onClick={run(endGame)} disabled={S.game.status !== 'active'}>Skip to end</button>
        <button onClick={() => setPrep((p) => !p)}>{prep ? 'Show running game' : 'Show before start'}</button>
        <button onClick={() => { freshStore(false); setError(null); bump(); }}>Fresh start</button>
        <button onClick={() => { freshStore(true); setError(null); bump(); }}>Reset demo</button>
      </div>
      {error && <p className="error">{error}</p>}
      <RegionsGame
        game={game}
        teams={TEAMS}
        myTeamId={me}
        myRole={captain ? 'captain' : 'member'}
        view={view}
        standings={rows}
        events={prep ? [] : S.events.filter((e) => !e.team_private || e.team_id === me)}
        evidence={S.evidence.filter((e) => myClaimIds.has(e.claim_id))}
        actions={actions}
        onRefresh={bump}
        tileTools={tileTools}
      />
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
