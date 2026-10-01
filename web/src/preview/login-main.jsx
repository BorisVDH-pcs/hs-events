/**
 * Login harness. Open /preview-login.html on `npm run preview:evidence`.
 *
 * The REAL login page and stylesheet, with the "Now running" list fed from
 * canned games instead of the live project: one bingo running, one battleships
 * coming up, and a finished game that must not appear. Signing in goes nowhere
 * here -- the stub has no auth.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Login from '../components/Login.jsx';
import { tableFixtures } from './stub-admin.js';
import '../styles.css';

const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();

tableFixtures.games = [
  { id: 'g-1', name: 'Clan Bingo — Autumn', mode: 'bingo', status: 'active',
    starts_at: inHours(-30), ends_at: inHours(26.5) },
  { id: 'g-2', name: 'Battleships V5', mode: 'battleships', status: 'placement',
    starts_at: inHours(74), ends_at: null },
  { id: 'g-3', name: 'Battleships V4', mode: 'battleships', status: 'finished',
    starts_at: null, ends_at: null },
];

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <main className="app"><Login /></main>
  </StrictMode>
);
