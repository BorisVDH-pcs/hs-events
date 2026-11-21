/**
 * Evidence-review harness. `npm run preview:evidence --prefix web`.
 *
 * Renders the real EvidenceReview against stubbed data so the revoke flow can
 * be looked at without a database. See stub-supabase.js for what is fake: the
 * two RPCs, and nothing else. The component, the confirm dialog, the
 * consequence sentences and the stylesheet are the shipping ones.
 */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import EvidenceReview from '../components/EvidenceReview.jsx';
import EvidencePanel from '../components/EvidencePanel.jsx';
import { resetDemo, evidenceSourceFixtures, PANEL_DEMO } from './stub-supabase.js';
import '../styles.css';
import '../seasons.css';
import '../lib/season.js';

function Harness() {
  const [run, setRun] = useState(0);
  const [sources, setSources] = useState(evidenceSourceFixtures.mode);
  const pickSources = (mode) => {
    evidenceSourceFixtures.mode = mode;
    setSources(mode);
    setRun((n) => n + 1);
  };

  return (
    <div className="wrap" style={{ maxWidth: '54rem', margin: '0 auto', padding: '1.5rem' }}>
      <h1 style={{ marginBottom: '.25rem' }}>Evidence</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Harness — no database. Each row previews a different outcome: 1 in
        progress, 2 still complete without it, 3 un-fires a miss, 4 un-fires a
        hit, 5 refloats a ship, 6 reopens a
        won game.
      </p>
      <p>
        <button
          className="ghost"
          onClick={() => { resetDemo(); setRun((n) => n + 1); }}
        >
          Reset the six rows
        </button>
      </p>
      <p className="muted">
        Rows 4 and 5 came in through Dink.{' '}
        <label>
          Plugin labels:{' '}
          <select value={sources} onChange={(e) => pickSources(e.target.value)} aria-label="Plugin labels">
            <option value="some">from the database</option>
            <option value="missing">database without the plugin (live today)</option>
            <option value="failed">the call fails</option>
          </select>
        </label>
      </p>
      <EvidenceReview key={run} gameId="demo-game" />

      <h2 style={{ marginTop: '2rem' }}>A tile&apos;s panel</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        What a team sees when it opens a tile on its own board (and an
        organiser on theirs). The first picture came in through Dink; the
        second was uploaded on the site. The same switch above applies.
      </p>
      <EvidencePanel
        key={`panel-${run}`}
        title="Bones"
        coord="Asgarnia"
        items={PANEL_DEMO}
        onClose={() => {}}
      />
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Harness />
  </StrictMode>
);
