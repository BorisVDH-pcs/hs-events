/**
 * Admin console harness. Open /preview-admin.html on `npm run preview:evidence`.
 *
 * The REAL Admin component against an in-memory database (stub-admin.js), so
 * creating a bingo, building its card and filling its roster can be clicked
 * through without touching the live project. State lasts until a reload.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Admin from '../components/Admin.jsx';
import { challengeFixtures, previewGames, rpcFixtures } from './stub-supabase.js';
import { previewChallenge } from './stub-admin.js';
import '../styles.css';

// The evidence log is the evidence harness's fixture; an empty one here.
rpcFixtures.admin_list_evidence = [];

// ---- the challenge seeded in stub-admin.js ------------------------------
//
// Track's challenge tabs -- the ladder, the entrants and the Wise Old Man
// link -- were the one path in this console with nothing to render against,
// so the only way to look at them was a real event on a real project. That is
// how the evidence screen drifted, and it is why this is here.
//
// Scored on the hiscores with a declared figure beside it: the shape that
// puts every part of the screen on at once.
const [tide, wise] = previewChallenge.teams;

previewGames.rows = [{
  game_id: previewChallenge.gameId,
  solo: false,
  ranked_by: 'wom',
  wom_metric: 'zulrah',
  declared_label: 'Loot value',
  declared_unit: 'gp',
  all_accounts: false,
}];

// Mid-event, and deliberately uneven: one entrant checked, one whose number an
// organiser corrected, one still on no team at all. A tidy fixture would hide
// exactly the states this screen exists to handle.
challengeFixtures.entries = [
  {
    entry_id: 'e1', name: 'Zezima', rsn: 'Zezima', team_id: tide.id,
    declared: 2500, wom_gained: 184, verified_at: null,
    altered_by: null, altered_by_name: null,
    evidence: [
      { id: 's1', phase: 'start', url: 'https://example.invalid/start.png', note: 'Bank before' },
      { id: 's2', phase: 'finish', url: 'https://example.invalid/finish.png', note: null },
    ],
  },
  {
    entry_id: 'e2', name: 'Hexis', rsn: 'Hexis', team_id: wise.id,
    declared: 4100, wom_gained: 301, verified_at: new Date().toISOString(),
    altered_by: null, altered_by_name: null,
    evidence: [{ id: 's3', phase: 'finish', url: 'https://example.invalid/hexis.png', note: null }],
  },
  {
    entry_id: 'e3', name: 'Fawkes', rsn: 'Fawkes Alt', team_id: tide.id,
    declared: 900, wom_gained: 77, verified_at: null,
    altered_by: 'u1', altered_by_name: 'Boris',
    evidence: [],
  },
  {
    entry_id: 'e4', name: 'Nexling', rsn: 'Nexling', team_id: null,
    declared: null, wom_gained: 12, verified_at: null,
    altered_by: null, altered_by_name: null,
    evidence: [],
  },
];

challengeFixtures.standings = [
  { place: 1, name: wise.name, team_id: wise.id, declared: 4100, wom_gained: 301, entrants: 1 },
  { place: 2, name: tide.name, team_id: tide.id, declared: 3400, wom_gained: 261, entrants: 2 },
];

challengeFixtures.wom = {
  competition_id: 85123,
  fetched_at: new Date(Date.now() - 4 * 60000).toISOString(),
  has_code: true,
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <main className="app">
      <Admin />
    </main>
  </StrictMode>
);
