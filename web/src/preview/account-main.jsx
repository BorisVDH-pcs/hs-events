/**
 * My Account harness. Open /preview-account.html on `npm run preview:evidence`.
 *
 * The REAL My Account dialog and stylesheet, with the accounts and the plugin
 * tokens fed from fixtures. Four token states, because each looks different:
 * none yet, a couple in use, the limit, and a database without plugin tokens
 * at all, which is the live project today and must show no section.
 *
 * Making a token here makes a random one and a link to no project; nothing is
 * sent anywhere.
 */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import MyAccount from '../components/MyAccount.jsx';
import { accountFixtures, pluginTokenFixtures } from './stub-supabase.js';
import '../styles.css';
import '../seasons.css';
import '../lib/season.js';

const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();

accountFixtures.push(
  { id: 'a1', rsn: 'Zezima', is_primary: true, wom_found: true },
  { id: 'a2', rsn: 'Zezima Iron', is_primary: false, wom_found: true },
);

const TOKENS = {
  some: [
    { id: 'pt-1', label: 'Main PC', created_at: ago(60 * 24 * 9), last_used_at: ago(2) },
    { id: 'pt-2', label: null, created_at: ago(60 * 3), last_used_at: null },
  ],
  none: [],
  full: Array.from({ length: 5 }, (_, i) => (
    { id: `pt-f${i}`, label: `Computer ${i + 1}`, created_at: ago(60 * 24 * (i + 1)), last_used_at: ago(60 * i) })),
  missing: null,
};

function Harness() {
  const [state, setState] = useState('some');
  const [open, setOpen] = useState(true);
  const [key, setKey] = useState(0);

  function pick(next) {
    setState(next);
    pluginTokenFixtures.list = TOKENS[next] && TOKENS[next].map((t) => ({ ...t }));
    setKey((k) => k + 1);
    setOpen(true);
  }

  return (
    <main className="app">
      <div className="row" style={{ padding: '1rem' }}>
        <select value={state} onChange={(e) => pick(e.target.value)}>
          <option value="some">Two tokens</option>
          <option value="none">No tokens yet</option>
          <option value="full">At the limit</option>
          <option value="missing">Live project today (no plugin tokens)</option>
        </select>
        {!open && <button onClick={() => pick(state)}>Open My Account</button>}
      </div>
      {open && <MyAccount key={key} profileId="preview" onClose={() => setOpen(false)} />}
    </main>
  );
}

pluginTokenFixtures.list = TOKENS.some.map((t) => ({ ...t }));

createRoot(document.getElementById('root')).render(
  <StrictMode><Harness /></StrictMode>,
);
