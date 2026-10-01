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
import { rpcFixtures } from './stub-supabase.js';
import '../styles.css';

// The evidence log is the evidence harness's fixture; an empty one here.
rpcFixtures.admin_list_evidence = [];

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <main className="app">
      <Admin />
    </main>
  </StrictMode>
);
