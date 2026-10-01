/**
 * Snakes and Ladders harness. Open /preview-snakes.html on `npm run preview:evidence`.
 *
 * Renders the REAL SnakesGame against a hand-written game with four teams, and
 * plugs a small simulation of the server into the stub (snakesHandlers), so
 * Roll and Rollback can be pressed and the markers watched walking. The
 * simulation is close to snakes_move but is NOT it -- the SQL is proven by
 * scripts/snakes-smoke-test.sql, not by anything here.
 */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SnakesGame from '../components/snakes/SnakesGame.jsx';
import Wordmark from '../components/Wordmark.jsx';
import { snakesHandlers } from './stub-supabase.js';
import { DEFAULT_JUMPS, LAST_TILE } from '../lib/snakes.js';
import '../styles.css';

const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();
const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();
const d6 = () => 1 + Math.floor(Math.random() * 6);

const TASKS = [
  ['Zulrah unique', 'zulrah'], ['Vorkath head', 'vorkath'], ['Any Nex unique', 'nex'],
  ['Kraken tentacle', 'kraken'], ['Cerberus crystal', 'cerberus'],
  ['Corp sigil', 'corporeal_beast'], ['Giant Mole pet', 'giant_mole'],
  ['Hespori seed bag', 'hespori'], ['500 Tempoross permits', 'tempoross'], ['Dragon warhammer', 'dragon_warhammer'],
  ['Infernal cape', 'infernal_cape'], ['Twisted bow', 'twisted_bow'], ['Sarachnis cudgel', 'sarachnis'],
  ['Any DT2 axe piece', 'vardorvis'], ['Araxxor fang', 'araxxor'],
  ['Muspah venator shard', 'phantom_muspah'], ['Scurrius spine', 'scurrius'],
  ['Kalphite Queen head', 'kalphite_queen'], ['Hill giant club', 'obor'], ['Tormented synapse', 'tormented_demon'],
  ['Zamorak hilt', 'zamorak_hilt'], ['Skotizo jar', 'skotizo'],
  ['Max a skill', null], ['Full Barrows set', null], ['Mega-rare from a clue', null],
];

// The standard board (lib/snakes.js): ten snakes, eight ladders.
const JUMPS = DEFAULT_JUMPS;
const HEADS = new Map(JUMPS.map((j) => [j.from, j.to]));

const ME = 't-1';

function freshStore(status) {
  const done = new Set([1, 3, 8, 12]);
  return {
    seq: 0,
    game: {
      id: 'g', name: 'Snakes & Ladders — Autumn', mode: 'snakes', status,
      starts_at: status === 'active' ? ago(180) : inHours(3),
      winner_team_id: status === 'finished' ? 't-2' : null,
      ended_reason: status === 'finished' ? 'admin' : null,
    },
    teams: [
      { id: 't-1', name: 'Kandarin', slot: 1, board_tile: 15, rollbacks_available: 1, rollbacks_used: 0, board_moved_at: ago(20) },
      { id: 't-2', name: 'Misthalin', slot: 2, board_tile: 22, rollbacks_available: 0, rollbacks_used: 1, board_moved_at: ago(12) },
      { id: 't-3', name: 'Asgarnia', slot: 3, board_tile: 15, rollbacks_available: 2, rollbacks_used: 0, board_moved_at: ago(30) },
      { id: 't-4', name: 'Morytania', slot: 4, board_tile: 0, rollbacks_available: 0, rollbacks_used: 0, board_moved_at: null },
    ].map((t) => (status === 'placement' ? { ...t, board_tile: 0 } : t)),
    done,                             // tiles my team has completed
    progress: new Map([[15, 1]]),     // tile -> evidence count, mine only
    claims: new Map([[15, 'cl-15']]),
    events: [
      { id: 'e3', type: 'team_moved', team_id: 't-1', created_at: ago(20), team_private: false,
        payload: { mode: 'snakes', kind: 'roll', from: 12, dice: [3], landed: 15, to: 15, jumps: [], skipped: [],
                   tile_name: TASKS[14][0] } },
      { id: 'e2', type: 'tile_completed', team_id: 't-1', created_at: ago(24), team_private: false,
        payload: { mode: 'snakes', position: 12, tile_name: TASKS[11][0] } },
      { id: 'e1', type: 'game_started', team_id: null, created_at: ago(180), team_private: false,
        payload: { mode: 'snakes' } },
    ],
  };
}

const taskFor = (n) => TASKS[(n - 1) % TASKS.length];

// A real game has no tile on a snake head or a ladder's foot.
function tilesOf(store) {
  return Array.from({ length: LAST_TILE }, (_, i) => i + 1).filter((n) => !HEADS.has(n)).map((n) => {
    const [name, icon] = taskFor(n);
    const done = store.done.has(n);
    const have = store.progress.get(n) ?? 0;
    const prep = store.game.status === 'placement';
    return {
      id: `tile-${n}`, position: n,
      name: prep ? null : n === LAST_TILE ? 'Any pet' : name,
      icon: prep ? null : n === LAST_TILE ? null : icon,
      rules: n === 23 ? 'Any skill, from level 1 on a fresh account counts.' : null,
      completion: 'points', options: [], required_evidence: n % 3 === 0 ? 3 : 1,
      claim_id: store.claims.get(n) ?? null,
      claim_status: done ? 'completed' : store.claims.has(n) ? 'active' : null,
      evidence_count: done ? (n % 3 === 0 ? 3 : 1) : have,
      evidence_points: 0,
      claimed_by_name: done ? 'Sanchez' : null,
    };
  });
}

/**
 * Skip finished tiles and follow snakes and ladders from `pos`, as snakes_move
 * does -- each one at most once per move, passed over after that.
 */
function settle(pos, isDone, cap = LAST_TILE) {
  const jumps = [];
  const skipped = [];
  const used = new Set();
  for (let guard = 0; guard < 300; guard++) {
    if (HEADS.has(pos) && !used.has(pos)) {
      const to = HEADS.get(pos);
      used.add(pos);
      jumps.push({ from: pos, to, then: to });
      pos = to;
      cap = LAST_TILE;
      continue;
    }
    if ((isDone(pos) || used.has(pos)) && pos < cap) {
      skipped.push(pos);
      pos += 1;
      if (jumps.length) jumps[jumps.length - 1].then = pos;
      continue;
    }
    break;
  }
  return { to: pos, jumps, skipped };
}

function move(store, team, kind, steps, dice) {
  const from = team.board_tile;
  const isDone = team.id === ME ? (n) => store.done.has(n) : () => false;
  let landed;
  let bounced = false;
  if (kind === 'rollback') {
    landed = Math.max(1, from - steps);
  } else {
    landed = from + steps;
    if (landed > LAST_TILE) { landed = 2 * LAST_TILE - landed; bounced = true; }
  }
  const s = settle(landed, isDone, kind === 'rollback' ? from : LAST_TILE);
  team.board_tile = s.to;
  team.board_moved_at = new Date().toISOString();
  const payload = {
    mode: 'snakes', kind, from, dice, steps, landed, to: s.to, bounced, long_skip: false,
    skipped: s.skipped, jumps: s.jumps, tile_name: taskFor(s.to)[0],
    rollbacks_available: team.rollbacks_available, rollbacks_used: team.rollbacks_used,
  };
  store.events = [{
    id: `m${++store.seq}`, type: 'team_moved', team_id: team.id,
    created_at: new Date().toISOString(), team_private: false, payload,
  }, ...store.events];
  return payload;
}

function standingsOf(store) {
  const rows = store.teams.map((t) => ({
    team_id: t.id, team_name: t.name, slot: t.slot, board_tile: t.board_tile,
    board_moved_at: t.board_moved_at,
    tiles_completed: t.id === ME ? store.done.size : Math.floor(t.board_tile / 4),
    rollbacks_available: t.rollbacks_available, rollbacks_used: t.rollbacks_used,
  }));
  rows.sort((a, b) => b.board_tile - a.board_tile
    || (a.board_moved_at ?? '').localeCompare(b.board_moved_at ?? ''));
  return rows.map((r, i) => ({ ...r, place: i + 1 }));
}

const VIEWS = {
  active: 'Player — running',
  placement: 'Player — preparation',
  finished: 'Player — finished',
};

function Harness() {
  const [view, setView] = useState('active');
  const [store, setStore] = useState(() => freshStore('active'));
  const [, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);

  const me = store.teams.find((t) => t.id === ME);

  snakesHandlers.roll = async () => {
    const d = d6();
    return move(store, me, 'roll', d, [d]);
  };
  snakesHandlers.rollback = async () => {
    if (me.rollbacks_available < 1) throw new Error('No rollbacks left.');
    const used = me.rollbacks_used;
    const steps = used === 0 ? 1 + Math.floor(Math.random() * 3) : used === 1 ? d6() : Math.max(d6(), d6());
    me.rollbacks_available -= 1;
    me.rollbacks_used += 1;
    return move(store, me, 'rollback', steps, [steps]);
  };
  snakesHandlers.open = async () => {
    const n = me.board_tile;
    if (!store.claims.has(n)) store.claims.set(n, `cl-${n}`);
    return store.claims.get(n);
  };

  // Rebuilt every render from the mutable store, as fresh arrays, so the
  // components see changes the way they would after a real refetch.
  const tiles = tilesOf(store);
  const teams = store.teams.map((t) => ({ ...t }));
  const events = [...store.events];
  const standings = standingsOf(store);

  function completeMine() {
    const n = me.board_tile;
    if (!n || store.done.has(n)) return;
    store.done.add(n);
    store.claims.set(n, store.claims.get(n) ?? `cl-${n}`);
    store.events = [{
      id: `c${++store.seq}`, type: 'tile_completed', team_id: ME, created_at: new Date().toISOString(),
      team_private: false, payload: { mode: 'snakes', position: n, tile_name: taskFor(n)[0] },
    }, ...store.events];
    if (n === LAST_TILE) {
      store.game = { ...store.game, status: 'finished', winner_team_id: ME, ended_reason: 'won' };
    }
    bump();
  }

  function otherRolls() {
    const others = store.teams.filter((t) => t.id !== ME);
    const t = others[Math.floor(Math.random() * others.length)];
    const d = d6();
    move(store, t, 'roll', d, [d]);
    bump();
  }

  function snakeMe() {
    // Put my team two short of a snake head and roll a 2 into it.
    me.board_tile = 52;
    store.done.add(52);
    move(store, me, 'roll', 2, [2]);
    bump();
  }

  function ladderMe() {
    // Two short of the ladder at 51 (49 is a snake head, so start from 48).
    me.board_tile = 48;
    store.done.add(48);
    move(store, me, 'roll', 3, [3]);
    bump();
  }

  function pick(k) {
    setView(k);
    setStore(freshStore(k));
  }

  return (
    <main className="app game-app">
      <header className="top"><Wordmark mode="snakes" /></header>
      <p className="muted" style={{ marginTop: 0 }}>
        Harness — no database. Kandarin&rsquo;s view, four teams. Roll and Rollback run a local
        simulation; uploads are refused, so use &ldquo;Complete my tile&rdquo; to finish one.
      </p>
      <div className="tabs">
        {Object.entries(VIEWS).map(([k, label]) => (
          <button key={k} className={view === k ? 'on' : ''} onClick={() => pick(k)}>{label}</button>
        ))}
      </div>
      {view === 'active' && (
        <div className="tabs">
          <button onClick={completeMine}>Complete my tile</button>
          <button onClick={otherRolls}>Another team rolls</button>
          <button onClick={snakeMe}>Land me on a snake</button>
          <button onClick={ladderMe}>Land me on a ladder</button>
        </div>
      )}
      <SnakesGame
        key={view}
        game={store.game}
        teams={teams}
        myTeamId={ME}
        myRole="captain"
        tiles={tiles}
        standings={standings}
        jumps={JUMPS}
        events={events}
        evidence={[]}
        onRefresh={async () => bump()}
      />
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Harness />
  </StrictMode>
);
