/**
 * The player's challenge screen. Open /preview-challenge.html on
 * `npm run preview:evidence`.
 *
 * WHY THIS EXISTS. The evidence half of a challenge -- the start shots, the
 * finish shots and the declared figure -- was the one screen in this repo
 * with no harness at all, so the only way to look at it was to join a real
 * event on a real project and start pasting links. That is why it drifted:
 * nobody saw it.
 *
 * The REAL ChallengeGame against challengeFixtures, so adding a shot and
 * changing the number both stick. State lasts until a reload.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ChallengeGame from '../components/challenge/ChallengeGame.jsx';
import { previewGames, challengeFixtures, accountFixtures } from './stub-supabase.js';
import '../styles.css';

const GAME_ID = 'c1';

// An event scored on the hiscores with a declared figure beside it, which is
// the shape that shows every part of the screen at once: the WOM reading, the
// number the player types, and both sets of shots behind it.
previewGames.rows = [{
  game_id: GAME_ID,
  solo: true,
  ranked_by: 'declared',
  wom_metric: 'zulrah',
  declared_label: 'Loot value',
  declared_unit: 'gp',
  all_accounts: false,
}];

accountFixtures.push(
  { id: 'a1', rsn: 'Zezima', is_primary: true, wom_found: true },
  { id: 'a2', rsn: 'Zezima Alt', is_primary: false, wom_found: true },
);

// Mid-event: a figure already sent in, one start shot up, nothing from the
// finish yet. The lopsided case is the useful one -- it is what the screen
// looks like for most of the week it is open.
challengeFixtures.entry = {
  id: 'e1',
  team_id: null,
  rsn: 'Zezima',
  declared: 2500,
  verified: false,
  altered: false,
  wom_gained: 184,
  evidence: [
    { id: 'shot-0', phase: 'start', url: 'https://i.imgur.com/start.png', note: 'Bank before' },
  ],
};

challengeFixtures.standings = [
  { place: 1, name: 'Hexis', declared: 4100, wom_gained: 301, entry_id: 'e9' },
  { place: 2, name: 'Zezima', declared: 2500, wom_gained: 184, entry_id: 'e1' },
  { place: 3, name: 'Fawkes', declared: 900, wom_gained: 77, entry_id: 'e7' },
];

const GAME = {
  id: GAME_ID,
  name: 'BOTW — Zulrah',
  status: 'active',
  ends_at: new Date(Date.now() + 3 * 86400000).toISOString(),
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <main className="app">
      <ChallengeGame
        game={GAME}
        teams={[]}
        events={[]}
        profileId="00000000-0000-4000-8000-000000000001"
      />
    </main>
  </StrictMode>
);
