/**
 * Bingo harness. Open /preview-bingo.html on `npm run preview:evidence`.
 *
 * Renders the REAL bingo screens -- BingoGame for a player, BingoOverview for
 * the organiser -- against a hand-written 5x5 game, so the layout can be looked
 * at without applying the bingo migrations to the live project. Same rules as
 * the evidence harness (see stub-supabase.js): the components and stylesheet
 * are the shipping ones, the data is a fixture, and nothing here proves the
 * SQL right.
 */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import BingoGame from '../components/bingo/BingoGame.jsx';
import BingoOverview from '../components/bingo/BingoOverview.jsx';
import Wordmark from '../components/Wordmark.jsx';
import { rpcFixtures } from './stub-supabase.js';
import { cardCells } from '../lib/bingo.js';
import { coordLabel, fromPosition } from '../lib/board.js';
import '../styles.css';

const SIZE = 5;
const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();
const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();

// Twenty-five tasks; a few without artwork, to show a name-only square.
const TASKS = [
  ['Zulrah unique', 'zulrah'], ['Vorkath head', 'vorkath'], ['Any Nex unique', 'nex'],
  ['Kraken tentacle', 'kraken'], ['Cerberus crystal', 'cerberus'],
  ['Corp sigil or spirit shield', 'corporeal_beast'], ['Giant Mole pet', 'giant_mole'],
  ['Hespori seed bag', 'hespori'], ['500 Tempoross permits', 'tempoross'], ['Dragon warhammer', 'dragon_warhammer'],
  ['Infernal cape', 'infernal_cape'], ['Twisted bow', 'twisted_bow'], ['Sarachnis cudgel', 'sarachnis'],
  ['Any DT2 axe piece', 'vardorvis'], ['Araxxor fang', 'araxxor'],
  ['Phantom Muspah venator shard', 'phantom_muspah'], ['Scurrius spine', 'scurrius'],
  ['Kalphite Queen head', 'kalphite_queen'], ['Hill giant club', 'obor'], ['Tormented synapse', 'tormented_demon'],
  ['Zamorak hilt', 'zamorak_hilt'], ['Skotizo jar', 'skotizo'],
  ['Max a skill from scratch', null], ['Complete a full Barrows set', null], ['Clue scroll mega-rare', null],
];

const TEAMS = [
  { id: 't-1', name: 'Kandarin', slot: 1, game_id: 'g' },
  { id: 't-2', name: 'Misthalin', slot: 2, game_id: 'g' },
  { id: 't-3', name: 'Asgarnia', slot: 3, game_id: 'g' },
  { id: 't-4', name: 'Morytania', slot: 4, game_id: 'g' },
];

// Which squares each team has completed, and which they are part-way through.
const DONE = {
  't-1': [1, 2, 4, 7, 9, 12, 13, 18, 19],
  't-2': [1, 3, 5, 6, 10, 14, 21, 22],
  't-3': [2, 8, 11, 15],
  't-4': [],
};
const PROGRESS = { 't-1': [3, 16, 24], 't-2': [2, 9], 't-3': [1], 't-4': [5] };

const cells = cardCells(SIZE);
const tileId = (i) => `tile-${i + 1}`;

/** One team's tiles, in the shape tiles_for_me returns. Indices are 1-based. */
function tilesFor(teamId) {
  return cells.map((c, i) => {
    const n = i + 1;
    const done = DONE[teamId].includes(n);
    const part = PROGRESS[teamId].includes(n);
    const [name, icon] = TASKS[i];
    return {
      id: tileId(i), position: c.position, name, icon,
      rules: n === 23 ? 'Any skill, from level 1 on a fresh account counts.' : null,
      completion: 'points', options: [], required_evidence: n % 3 === 0 ? 3 : 1,
      claim_id: done || part ? `cl-${teamId}-${n}` : null,
      claim_status: done ? 'completed' : part ? 'active' : null,
      evidence_count: done ? (n % 3 === 0 ? 3 : 1) : part ? 1 : 0,
      evidence_points: 0,
      claimed_by_name: done ? 'Sanchez' : null,
    };
  });
}

function standings(total) {
  const rows = TEAMS.map((t, k) => ({
    team_id: t.id, team_name: t.name, slot: t.slot,
    tiles_completed: DONE[t.id].length, tiles_total: total,
    last_completed_at: DONE[t.id].length ? ago(10 + k * 7) : null,
    completed_tile_ids: DONE[t.id].map((n) => tileId(n - 1)),
  }));
  rows.sort((a, b) => b.tiles_completed - a.tiles_completed
    || (a.last_completed_at ?? '').localeCompare(b.last_completed_at ?? ''));
  return rows.map((r, i) => ({ ...r, place: i + 1 }));
}

const STANDINGS = standings(SIZE * SIZE);

const at = (n) => {
  const { row, col } = fromPosition(cells[n - 1].position);
  return coordLabel(row, col);
};

const EVENTS = [
  { id: 'e5', type: 'tile_completed', team_id: 't-1', created_at: ago(4), team_private: false,
    payload: { tile_name: TASKS[18][0], position: cells[18].position, tiles_completed: 9, tiles_total: 25 } },
  { id: 'e4', type: 'evidence_submitted', team_id: 't-1', created_at: ago(9), team_private: true,
    payload: { tile_name: TASKS[2][0], position: cells[2].position, uploaded_by_name: 'Thammaron',
               evidence_count: 1, required_evidence: 3, completion: 'points' } },
  { id: 'e3', type: 'tile_completed', team_id: 't-2', created_at: ago(14), team_private: false,
    payload: { tile_name: TASKS[21][0], position: cells[21].position, tiles_completed: 8, tiles_total: 25 } },
  { id: 'e2', type: 'tile_completed', team_id: 't-3', created_at: ago(31), team_private: false,
    payload: { tile_name: TASKS[14][0], position: cells[14].position, tiles_completed: 4, tiles_total: 25 } },
  { id: 'e1', type: 'game_started', team_id: null, created_at: ago(240), team_private: false,
    payload: { mode: 'bingo' } },
];

// The organiser view reads these through the stubbed `supabase.rpc`.
rpcFixtures.bingo_standings = STANDINGS;
rpcFixtures.admin_list_evidence = [];
rpcFixtures.admin_tile_progress = TEAMS.flatMap((t) => tilesFor(t.id).map((tile) => ({
  team_id: t.id, team_name: t.name, tile_id: tile.id, position: tile.position,
  tile_name: tile.name, required_evidence: tile.required_evidence,
  claim_id: tile.claim_id, status: tile.claim_status, result: null,
  evidence_count: tile.evidence_count, evidence_points: 0, option_count: 0, completion: 'points',
})));

const GAME = {
  id: 'g', name: 'Clan Bingo — Autumn', mode: 'bingo', grid_size: SIZE,
  status: 'active', starts_at: ago(240), ends_at: inHours(26.5), winner_team_id: null, ended_reason: null,
};

const VIEWS = {
  running:  { label: 'Player — running', game: GAME },
  finished: { label: 'Player — time is up',
              game: { ...GAME, status: 'finished', ends_at: ago(5), winner_team_id: 't-1', ended_reason: 'time_up' } },
  prep:     { label: 'Player — preparation', game: { ...GAME, status: 'placement', starts_at: inHours(3) } },
  admin:    { label: 'Organiser — Track', game: GAME },
};

function Harness() {
  const [view, setView] = useState('running');
  const v = VIEWS[view];
  return (
    <main className="app game-app">
      <header className="top"><Wordmark mode="bingo" /></header>
      <p className="muted" style={{ marginTop: 0 }}>
        Harness — no database. Kandarin&rsquo;s view of a 5×5 bingo with four teams. {at(3)},
        {' '}{at(16)} and {at(24)} are part-done; uploads are refused here.
      </p>
      <div className="tabs">
        {Object.entries(VIEWS).map(([k, x]) => (
          <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{x.label}</button>
        ))}
      </div>
      {view === 'admin' ? (
        <section className="card">
          <h2>Cards</h2>
          <BingoOverview game={v.game} teams={TEAMS} />
        </section>
      ) : (
        <BingoGame
          key={view}
          game={v.game}
          teams={TEAMS}
          myTeamId="t-1"
          myRole="captain"
          tiles={tilesFor('t-1')}
          standings={STANDINGS}
          events={EVENTS}
          evidence={[]}
          onRefresh={() => {}}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Harness />
  </StrictMode>
);
