/**
 * Territory harness. Open /preview-territory.html on `npm run preview:evidence`.
 *
 * Renders the REAL TerritoryGame against a small simulation of the server, so
 * the mode can be PLAYED before any of it exists in the database: open a
 * place, upload screenshots (any image -- it never leaves the browser), watch
 * it change hands. The bar on top switches which team you are, makes a rival
 * move, and skips to the end.
 *
 * The simulation follows lib/territory.js, the same rules the map draws with.
 * It is NOT the server: phase 2 writes the SQL and proves it with a smoke test.
 */
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import TerritoryGame from '../components/territory/TerritoryGame.jsx';
import Wordmark from '../components/Wordmark.jsx';
import { evidenceHandlers } from './stub-evidence.js';
import { DEFAULT_HOMES, PLACES } from '../lib/territoryWorld.js';
import {
  capture, defaultBonuses, isHome, openRefusal, placeAtPosition, placeByKey, placePosition, standings,
} from '../lib/territory.js';
import { THEMED_TASKS, readBoard } from './territory-tasks.js';
import '../styles.css';

const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();
const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();

// The tasks: the board built in the admin harness (/preview-admin.html) when
// there is one, the themed demo set otherwise. placeKey -> [task, icon, need].
// The simulation counts screenshots only, so every completion rule plays as
// "this many screenshots" here.
const BOARD = readBoard();
const TASKS = BOARD
  ? Object.fromEntries(BOARD.tiles
    .map((t) => [placeAtPosition(t.position)?.key, [t.name, t.icon, Math.max(1, t.required_evidence ?? 1)]])
    .filter(([key]) => key))
  : THEMED_TASKS;

// The teams and their homes: the admin preview's, when its board came with
// them (a fresh game, nobody has moved yet), or the demo four a few hours in.
const BUILT = BOARD?.teams?.length ? BOARD.teams : null;
const TEAMS = BUILT
  ? BUILT.map((t) => ({ id: `t-${t.slot}`, name: t.name, slot: t.slot }))
  : [
    { id: 't-1', name: 'Lumby Lads', slot: 1 },
    { id: 't-2', name: 'Ardy Knights', slot: 2 },
    { id: 't-3', name: 'Canifis Howlers', slot: 3 },
    { id: 't-4', name: 'Hosidius Harvest', slot: 4 },
  ];
const HOMES = BUILT
  ? new Map(BUILT.map((t) => [`t-${t.slot}`, t.home]))
  : new Map(TEAMS.map((t, i) => [t.id, DEFAULT_HOMES[i]]));
const SLAYER_MASTERS = ['Sanchez', 'Nieve', 'Duradel', 'Vannaka', 'Konar', 'Chaeldar'];
const PLAYERS = Object.fromEntries(TEAMS.map((t, i) => [t.id, SLAYER_MASTERS[i % SLAYER_MASTERS.length]]));

/** A grey stand-in screenshot, for the "simulate" button. */
function fakeShot(label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">
    <rect width="320" height="200" fill="#2a2a2c"/><text x="160" y="96" fill="#8a8a8f"
    font-family="system-ui" font-size="18" text-anchor="middle">screenshot</text>
    <text x="160" y="124" fill="#f2c14e" font-family="system-ui" font-size="14"
    text-anchor="middle">${label}</text></svg>`;
  return new File([svg], 'shot.svg', { type: 'image/svg+xml' });
}

function freshStore() {
  const homes = new Map(HOMES);
  let owners = new Map([...homes].map(([team, key]) => [key, team]));
  const captures = [];
  // A game a few hours in, so the map has some shape to it.
  const seed = BUILT ? [] : [
    ['t-1', 'draynor', 230], ['t-1', 'wizards_tower', 200], ['t-1', 'port_sarim', 150],
    ['t-2', 'seers', 220], ['t-2', 'yanille', 190], ['t-2', 'catherby', 120],
    ['t-3', 'mort_myre', 210], ['t-3', 'barrows', 160],
    ['t-4', 'kourend_castle', 205], ['t-4', 'port_piscarilius', 170], ['t-4', 'arceuus', 90],
  ];
  const events = [];
  let seq = 0;
  for (const [team, key, mins] of seed) {
    const step = capture(owners, homes, key, team, ago(mins));
    owners = step.owners;
    captures.push(step.record);
    events.unshift({
      id: `e-${++seq}`, type: 'tile_captured', team_id: team, created_at: step.record.at,
      team_private: false, payload: { place: key },
    });
  }
  events.push({
    id: `e-${++seq}`, type: 'game_started', team_id: null, created_at: ago(240),
    team_private: false, payload: { mode: 'territory' },
  });

  const store = {
    seq,
    game: {
      id: 'g', name: 'Conquest of Gielinor', mode: 'territory', status: 'active',
      starts_at: ago(240), ends_at: inHours(44), winner_team_id: null, ended_reason: null,
    },
    homes,
    owners,
    captures,
    // team -> Map(place -> { claim_id, count, open })
    claims: new Map(TEAMS.map((t) => [t.id, new Map()])),
    evidence: [],
    events,
  };
  // Lumby Lads are partway through Falador; Hosidius Harvest is going for
  // Port Sarim across the sea, so it shows as under attack.
  if (!BUILT) {
    store.claims.get('t-1').set('falador', { claim_id: 'cl-t-1-falador', count: 1, open: true });
    store.claims.get('t-4').set('port_sarim', { claim_id: 'cl-t-4-port_sarim', count: 0, open: true });
  }
  return store;
}

let S = freshStore();

function pushEvent(type, team_id, payload, team_private = false) {
  S.events.unshift({
    id: `e-${++S.seq}`, type, team_id, created_at: new Date().toISOString(), team_private, payload,
  });
}

const openSet = (teamId) => new Set(
  [...(S.claims.get(teamId) ?? new Map())].filter(([, c]) => c.open).map(([k]) => k),
);
const teamName = (id) => TEAMS.find((t) => t.id === id)?.name;

/** territory_open_tile: the claim id, after the same checks the map draws. */
function openPlace(teamId, key) {
  const refusal = openRefusal({
    teamId, key, owners: S.owners, homes: S.homes, open: openSet(teamId), status: S.game.status,
  });
  if (refusal) throw new Error(refusal);
  const mine = S.claims.get(teamId);
  const claim = mine.get(key) ?? { claim_id: `cl-${teamId}-${key}`, count: 0, open: false };
  claim.open = true;
  mine.set(key, claim);
  return claim.claim_id;
}

/** complete_territory_tile: the place changes hands. */
function finishPlace(teamId, key) {
  const from = S.owners.get(key) ?? null;
  const step = capture(S.owners, S.homes, key, teamId);
  S.owners = step.owners;
  S.captures.push(step.record);
  const claim = S.claims.get(teamId).get(key);
  if (claim) { claim.open = false; claim.count = 0; }
  // The loser starts from nothing if it wants the place back.
  if (from) {
    const lost = S.claims.get(from).get(key);
    if (lost) { lost.open = false; lost.count = 0; }
  }
  pushEvent('tile_captured', teamId, { place: key, from_team_id: from, from_team_name: teamName(from) });
}

/** add_evidence, for whichever team owns the claim. */
function addEvidence({ claimId, file }) {
  for (const [teamId, mine] of S.claims) {
    for (const [key, claim] of mine) {
      if (claim.claim_id !== claimId) continue;
      if (!claim.open) throw new Error('Open the place again before adding screenshots.');
      claim.count += 1;
      const path = `g/${teamId}/${claimId}/${++S.seq}`;
      evidenceHandlers.urls[path] = URL.createObjectURL(file);
      S.evidence.unshift({
        id: `ev-${S.seq}`, claim_id: claimId, storage_path: path,
        uploaded_by_name: PLAYERS[teamId], created_at: new Date().toISOString(), points: 1,
      });
      const owner = S.owners.get(key);
      if (claim.count === 1 && owner && owner !== teamId) {
        pushEvent('tile_attacked', teamId, { place: key, owner_team_name: teamName(owner) });
      }
      const need = TASKS[key]?.[2] ?? 1;
      if (claim.count >= need) {
        finishPlace(teamId, key);
        return { completed: true };
      }
      return { completed: false };
    }
  }
  throw new Error('No such claim');
}

function rivalMove(me) {
  const rivals = TEAMS.filter((t) => t.id !== me);
  for (let tries = 0; tries < 40; tries++) {
    const t = rivals[Math.floor(Math.random() * rivals.length)];
    const options = PLACES.filter((p) => TASKS[p.key] && openRefusal({
      teamId: t.id, key: p.key, owners: S.owners, homes: S.homes, open: new Set(), status: 'active',
    }) === null);
    if (!options.length) continue;
    // A third of the time, go for the player's land if any of it is in reach.
    const yours = options.filter((p) => S.owners.get(p.key) === me);
    const pool = yours.length && Math.random() < 0.34 ? yours : options;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    finishPlace(t.id, pick.key);
    return;
  }
}

function endGame() {
  const top = standings(TEAMS, S.owners, S.captures, defaultBonuses())[0];
  S.game = { ...S.game, status: 'finished', winner_team_id: top.team_id, ended_reason: 'time_up', ends_at: new Date().toISOString() };
  pushEvent('game_ended', top.team_id, { mode: 'territory', reason: 'time_up', score: top.score });
}

function Harness() {
  const [, setVersion] = useState(0);
  const [me, setMe] = useState(TEAMS[0].id);
  const [prep, setPrep] = useState(false);
  const [error, setError] = useState(null);
  const bonuses = useMemo(defaultBonuses, []);
  const bump = () => setVersion((v) => v + 1);
  const run = (fn) => async (...args) => {
    setError(null);
    try { const out = await fn(...args); bump(); return out; } catch (e) { setError(e.message); bump(); throw e; }
  };

  evidenceHandlers.upload = async (args) => {
    await new Promise((r) => setTimeout(r, 250)); // a beat, so "Capturing…" shows
    const out = addEvidence(args);
    bump();
    return out;
  };

  const mine = S.claims.get(me);
  const open = openSet(me);
  const attacked = new Set();
  for (const [teamId, claims] of S.claims) {
    if (teamId === me) continue;
    for (const [key, c] of claims) if (c.open && c.count > 0 && S.owners.get(key) === me) attacked.add(key);
  }
  // A task on every place that is not someone's home, numbered by the place.
  // A place with no task cannot be worked; on the map it is just land.
  const tiles = PLACES.filter((p) => !isHome(p.key, S.homes) && TASKS[p.key]).map((p) => {
    const [name, icon, need] = TASKS[p.key];
    const claim = mine.get(p.key);
    return {
      id: `tile-${p.key}`, position: placePosition(p), name, icon, completion: 'points',
      required_evidence: need, options: [],
      evidence_count: claim?.count ?? 0,
      claim_id: claim?.open ? claim.claim_id : null,
      own_claim_id: claim?.claim_id ?? null,
    };
  });
  const myClaimIds = new Set([...mine.values()].map((c) => c.claim_id));
  const game = prep ? { ...S.game, status: 'placement', starts_at: inHours(3) } : S.game;

  const actions = {
    open: run(async (key) => openPlace(me, key)),
    drop: run(async (key) => {
      const c = mine.get(key);
      if (c) c.open = false;
      pushEvent('tile_dropped', me, { place: key }, true);
    }),
  };

  const placeTools = (key) => {
    if (S.game.status !== 'active') return null;
    const refusal = openRefusal({ teamId: me, key, owners: S.owners, homes: S.homes, open, status: 'active' });
    if (refusal) return null;
    return (
      <div className="harness-tools">
        <button onClick={run(async () => {
          const id = mine.get(key)?.open ? mine.get(key).claim_id : openPlace(me, key);
          addEvidence({ claimId: id, file: fakeShot(placeByKey.get(key).name) });
        })}
        >
          Simulate a screenshot
        </button>
        <span className="muted"> harness only</span>
      </div>
    );
  };

  return (
    <main className="app game-app">
      <header className="top"><Wordmark /></header>
      <p className="muted" style={{ marginTop: 0 }}>
        Harness — no database. Play as any team; uploads stay in this browser tab. Use
        &ldquo;Simulate a screenshot&rdquo; under a place for speed, or upload a real image.
        {' '}
        {BOARD
          ? <>Tasks{BUILT ? ', teams and homes' : ''}: <strong>{BOARD.name}</strong>, built in the <a href="preview-admin.html">admin preview</a>.</>
          : <>Tasks: the themed demo set. Build your own in the <a href="preview-admin.html">admin preview</a> and reload.</>}
      </p>
      <div className="tabs">
        {TEAMS.map((t) => (
          <button key={t.id} className={me === t.id ? 'on' : ''} onClick={() => setMe(t.id)}>
            Play as {t.name}
          </button>
        ))}
      </div>
      <div className="tabs">
        <button onClick={run(() => rivalMove(me))} disabled={S.game.status !== 'active'}>Rival move</button>
        <button onClick={run(endGame)} disabled={S.game.status !== 'active'}>Skip to end</button>
        <button onClick={() => setPrep((p) => !p)}>{prep ? 'Show running game' : 'Show before start'}</button>
        <button onClick={() => { S = freshStore(); setError(null); bump(); }}>Reset</button>
      </div>
      {error && <p className="error">{error}</p>}
      <TerritoryGame
        game={game}
        teams={TEAMS}
        myTeamId={me}
        myRole="captain"
        tiles={tiles}
        owners={S.owners}
        homes={S.homes}
        open={open}
        attacked={attacked}
        captures={S.captures}
        bonuses={bonuses}
        events={S.events.filter((e) => !e.team_private || e.team_id === me)}
        evidence={S.evidence.filter((e) => myClaimIds.has(e.claim_id))}
        actions={actions}
        onRefresh={bump}
        placeTools={placeTools}
      />
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
