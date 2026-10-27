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
import { evidenceHandlers } from './stub-evidence.js';
import '../styles.css';
import '../seasons.css';
import '../lib/season.js';

const GAME_ID = 'c1';

// An event scored on the hiscores with a declared figure beside it, which is
// the shape that shows every part of the screen at once: the WOM reading, the
// number the player types, and both sets of shots behind it.
previewGames.rows = [{
  game_id: GAME_ID,
  solo: false,
  ranked_by: 'declared',
  wom_metric: 'zulrah',
  declared_label: 'Loot value',
  declared_unit: 'gp',
  all_accounts: false,
}];

// A competition behind it, which is the normal case for a hiscores event and
// the one the harness never drew: with this left null the link to Wise Old Man
// never rendered here, so nobody ever saw how it was presented.
challengeFixtures.womId = 162883;

accountFixtures.push(
  { id: 'a1', rsn: 'Zezima', is_primary: true, wom_found: true },
  { id: 'a2', rsn: 'Zezima Alt', is_primary: false, wom_found: true },
);

// Mid-event: a figure already sent in, one start shot up, nothing from the
// finish yet. The lopsided case is the useful one -- it is what the screen
// looks like for most of the week it is open.
challengeFixtures.entry = {
  id: 'e1',
  // What ChallengeGame builds the upload path from, so the harness exercises
  // the same `challenge/{game}/{entry}/` shape the bucket policy checks.
  entry_id: 'e1',
  team_id: 't1',
  rsn: 'Zezima',
  declared: 2500,
  verified: false,
  altered: false,
  wom_gained: 184,
  evidence: [
    { id: 'shot-0', phase: 'start', url: 'https://i.imgur.com/start.png', note: 'Bank before' },
  ],
};

// This event runs in teams, so challenge_standings answers a team ladder: one
// row per team, with the entrants behind each number. These rows were people
// with entry ids -- the solo shape -- which is why the ladder in this harness
// could never draw the row that is yours, the one thing a player looks for.
// The Crimson Tide is in the middle on purpose: first and yours are two
// different marks and they should be seen apart.
challengeFixtures.standings = [
  { place: 1, name: 'Wise Old Men', team_id: 't2', declared: 4100, wom_gained: 301, entrants: 1 },
  { place: 2, name: 'The Crimson Tide', team_id: 't1', declared: 2500, wom_gained: 184, entrants: 2 },
  { place: 3, name: 'Varrock Vanguard', team_id: 't3', declared: 900, wom_gained: 77, entrants: 3 },
];

/*
 * A dropped picture lands here.
 *
 * The stub's uploadChallengeShot has already made an object URL for the file
 * under the path the real one would have used; this is the row that points at
 * it. Shot zero stays a pasted link on purpose, so the screen is drawn with
 * one of each -- which is exactly what a half-finished event will hold.
 */
let shots = 1;
evidenceHandlers.addChallengeShot = ({ phase, storage_path, note }) => {
  const entry = challengeFixtures.entry;
  challengeFixtures.entry = {
    ...entry,
    evidence: [...(entry.evidence ?? []),
               { id: `shot-${shots++}`, phase, storage_path, note }],
  };
};

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
        teams={[{ id: 't1', name: 'The Crimson Tide' }]}
        events={[]}
        profileId="00000000-0000-4000-8000-000000000001"
      />
    </main>
  </StrictMode>
);
