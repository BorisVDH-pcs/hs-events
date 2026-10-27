/**
 * Home harness. Open /preview-home.html on `npm run preview:evidence`.
 *
 * The REAL Home component against a hand-written games list, so the landing
 * screen can be looked at without a live project, a sign-in, or being rostered
 * into five events at once. Same rules as the other harnesses: the component
 * and the stylesheet are the shipping ones, the data is a fixture.
 *
 * Four states, because they are the ones that go wrong and the ones hardest to
 * reach by hand: a player mid-season, a player with a single running game, a
 * brand new player in nothing at all, and an account Wise Old Man has never
 * found -- which is the whole reason the accounts section is on this screen.
 */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Home from '../components/Home.jsx';
import Wordmark from '../components/Wordmark.jsx';
import SideNav from '../components/SideNav.jsx';
import { accountFixtures } from './stub-supabase.js';
import '../styles.css';
import '../seasons.css';
import '../lib/season.js';

const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString();

/*
 * The rows carry what listMyGames really returns now: the start time, and for
 * a challenge the metric, how it is ranked and how many are in. The cards read
 * all of it, so a fixture without it draws a screen nobody will ever see.
 */
const GAMES = {
  season: [
    { gameId: 'g1', gameName: 'Autumn Raid', mode: 'battleships', status: 'active', teamId: 't1', teamName: 'The Crimson Tide', startsAt: ago(2), createdAt: ago(2) },
    { gameId: 'g2', gameName: 'Clan Bingo IX', mode: 'bingo', status: 'active', teamId: 't2', teamName: 'Blue Watch', startsAt: ago(5), createdAt: ago(5) },
    { gameId: 'g3', gameName: 'Serpent Sprint', mode: 'snakes', status: 'setup', teamId: 't3', teamName: 'Blue Watch', startsAt: inDays(3), createdAt: ago(1) },
    { gameId: 'g4', gameName: 'Summer Raid', mode: 'territory', status: 'finished', teamId: 't4', teamName: 'The Crimson Tide', createdAt: ago(40) },
    { gameId: 'g5', gameName: 'Slayer Week 44', mode: 'challenge', status: 'active', teamId: null, teamName: null, joined: true, metric: 'slayer', rankedBy: 'wom', solo: true, signups: 14, startsAt: ago(3), createdAt: ago(3) },
    { gameId: 'g6', gameName: 'Clues Week 45', mode: 'challenge', status: 'setup', teamId: null, teamName: null, joined: false, metric: 'clue_scrolls_master', rankedBy: 'wom', solo: true, signups: 3, startsAt: inDays(2), createdAt: ago(0) },
    { gameId: 'g9', gameName: 'Winter Snakes', mode: 'snakes', status: 'setup', teamId: null, teamName: null, joined: false, signups: 4, startsAt: inDays(9), createdAt: ago(0) },
    { gameId: 'g7', gameName: 'Spring Raid', mode: 'battleships', status: 'finished', teamId: 't1', teamName: 'The Crimson Tide', createdAt: ago(120) },
    { gameId: 'g8', gameName: 'Clan Bingo VIII', mode: 'bingo', status: 'finished', teamId: 't2', teamName: 'Blue Watch', createdAt: ago(75) },
  ],
  // A season behind them and nothing running. The case the single "You are
  // not in anything yet" used to get wrong, and the reason History had to be
  // somewhere findable rather than just out of the way.
  seasonOver: [
    { gameId: 'g4', gameName: 'Summer Raid', mode: 'territory', status: 'finished', teamId: 't4', teamName: 'The Crimson Tide', createdAt: ago(40) },
    { gameId: 'g7', gameName: 'Spring Raid', mode: 'battleships', status: 'finished', teamId: 't1', teamName: 'The Crimson Tide', createdAt: ago(120) },
    { gameId: 'g8', gameName: 'Clan Bingo VIII', mode: 'bingo', status: 'finished', teamId: 't2', teamName: 'Blue Watch', createdAt: ago(75) },
  ],
  one: [
    { gameId: 'g2', gameName: 'Clan Bingo IX', mode: 'bingo', status: 'active', teamId: 't2', teamName: 'Blue Watch', startsAt: ago(5), createdAt: ago(5) },
  ],
  // Nothing at all. The case the old landing handled by showing a stranger's
  // game, and the reason Home exists.
  nothing: [],
  // In nothing, but something is open -- which is the state Home now leads
  // with rather than apologises for. Two of them, so the soonest-first rule
  // has something to decide: the clue week starts first and takes the lead
  // even though the snakes event was created at the same moment.
  invitesOnly: [
    { gameId: 'g9', gameName: 'Winter Snakes', mode: 'snakes', status: 'setup', teamId: null, teamName: null, joined: false, signups: 4, startsAt: inDays(9), createdAt: ago(0) },
    { gameId: 'g6', gameName: 'Clues Week 45', mode: 'challenge', status: 'setup', teamId: null, teamName: null, joined: false, metric: 'clue_scrolls_master', rankedBy: 'wom', solo: true, signups: 3, startsAt: inDays(2), createdAt: ago(0) },
  ],
  // EHP and EHB are Wise Old Man's own arithmetic, so there is no picture in
  // the game to draw and the tile is worded. Two metrics out of 112 take this
  // path, and neither of them is reachable from the other fixtures.
  noArtwork: [
    { gameId: 'g10', gameName: 'Efficiency Month', mode: 'challenge', status: 'setup', teamId: null, teamName: null, joined: false, metric: 'ehp', rankedBy: 'wom', solo: true, signups: 6, startsAt: inDays(5), createdAt: ago(0) },
  ],
  // No start time anywhere, which is the common case for the board modes: a
  // card with no clock and no "starts" line must still look finished rather
  // than broken.
  undated: [
    { gameId: 'g11', gameName: 'Clan Bingo X', mode: 'bingo', status: 'setup', teamId: 't2', teamName: 'Blue Watch', createdAt: ago(1) },
    { gameId: 'g12', gameName: 'Open Territory', mode: 'territory', status: 'setup', teamId: null, teamName: null, joined: false, signups: 0, createdAt: ago(2) },
  ],
};

const ACCOUNTS = {
  typical: [
    { id: 'a1', rsn: 'Zezima', is_primary: true, wom_found: true },
    { id: 'a2', rsn: 'Zezima Alt', is_primary: false, wom_found: true },
  ],
  broken: [
    { id: 'a1', rsn: 'Zezima', is_primary: true, wom_found: true },
    { id: 'a2', rsn: 'Zezimah Alt', is_primary: false, wom_found: false },
    { id: 'a3', rsn: 'Brand New', is_primary: false, wom_found: null },
  ],
  none: [],
};

function Harness() {
  const [games, setGames] = useState('season');
  const [accounts, setAccounts] = useState('typical');
  const [rail, setRail] = useState(true);
  // Home reads its accounts once, on mount, so the switch has to remount it.
  accountFixtures.length = 0;
  accountFixtures.push(...ACCOUNTS[accounts]);

  return (
    <main className="app game-app">
      <header className="top" id="app-header">
        <Wordmark mode={null} />
        <div className="who">
          <span className="name">Zezima</span>
          <select value={games} onChange={(e) => setGames(e.target.value)}>
            <option value="season">Mid-season</option>
            <option value="one">One running game</option>
            <option value="seasonOver">Season over, nothing running</option>
            <option value="invitesOnly">Invitations only</option>
            <option value="noArtwork">A metric with no artwork</option>
            <option value="undated">No start times</option>
            <option value="nothing">In nothing at all</option>
          </select>
          <button className="link" onClick={() => setRail((v) => !v)}>
            {rail ? 'Rail: in a game' : 'Rail: no game'}
          </button>
          <select value={accounts} onChange={(e) => setAccounts(e.target.value)}>
            <option value="typical">Accounts: found</option>
            <option value="broken">Accounts: one never found</option>
            <option value="none">Accounts: none saved</option>
          </select>
        </div>
      </header>
      <div className="app-split">
        <SideNav
          atHome
          gameName={rail ? 'Clan Bingo IX' : null}
          gameMode="bingo"
          onHome={() => {}}
          onGame={() => window.alert('Would open the game')}
          onAccounts={() => window.alert('Would open My accounts')}
          onConsole={() => window.alert('Would open the console')}
          isOrganiser
        />
        <div className="app-body">
      <Home
        key={`${games}-${accounts}`}
        games={GAMES[games]}
        onPick={(id) => window.alert(`Would open ${id}`)}
        displayName="Zezima"
        isOrganiser
        onConsole={() => window.alert('Would open the console')}
        onOpenAccounts={() => window.alert('Would open My accounts')}
      />
        </div>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode><Harness /></StrictMode>
);
