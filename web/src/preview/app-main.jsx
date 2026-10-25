/**
 * The whole App, against stubs. Open /preview-app.html on
 * `npm run preview:evidence`.
 *
 * WHY THIS EXISTS. Every other harness renders one component. Nothing
 * rendered App itself, so nothing in this repo ever executed its body -- and
 * on 2026-10-25 a `const` read twelve lines above its own declaration went to
 * production as "Cannot access 'V' before initialization", which is a
 * temporal dead zone error that a build cannot catch and a unit test on a
 * helper cannot reach. It took the whole site down, signed-out visitors
 * included, because the line sat above App's `if (!session)` return.
 *
 * So this is the smoke test: does App render at all. It is not a test of the
 * app's behaviour -- the data is canned and most actions refuse -- and it
 * proves nothing about the database. It answers the one question none of the
 * other harnesses could: does the component body run.
 */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App.jsx';
import { preview, previewGames } from './stub-supabase.js';
import { tableFixtures } from './stub-admin.js';
import '../styles.css';

const SESSION = {
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    user_metadata: { display_name: 'Zezima' },
  },
};

const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();

previewGames.rows = [
  { game_id: 'g5', name: 'Slayer Week 44', status: 'active', created_at: ago(3), joined: true },
  { game_id: 'g6', name: 'Clues Week 45', status: 'setup', created_at: ago(0), joined: false },
  { game_id: 'g9', name: 'Clues Week 40', status: 'finished', created_at: ago(35), joined: true },
];

function Harness() {
  const [signedIn, setSignedIn] = useState(true);
  // An organiser lands on the console, which is the screen with NO rail --
  // and therefore the one that breaks differently from every other. It was
  // squeezed into the rail's 210px column for a day because nothing here
  // could render it.
  const [admin, setAdmin] = useState(true);

  preview.session = signedIn ? SESSION : null;
  tableFixtures.profiles = [{ id: SESSION.user.id, is_admin: admin }];

  return (
    <>
      <div className="harness-bar">
        <button className="link" onClick={() => setSignedIn((v) => !v)}>
          {signedIn ? 'Signed in — sign out' : 'Signed out — sign in'}
        </button>
        <button className="link" onClick={() => setAdmin((v) => !v)}>
          {admin ? 'As organiser' : 'As player'}
        </button>
      </div>
      <App key={`${signedIn}-${admin}`} />
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode><Harness /></StrictMode>
);
