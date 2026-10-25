import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gameUrgency, groupGames, splitFinished } from '../src/lib/homeGames.js';
import { modeLabel } from '../src/lib/site.js';

// ---- Which list a row belongs in ----
//
// listMyGames returns three kinds of row in one array, and the difference is
// carried by two fields rather than a type: a rostered game has a teamId, an
// entered challenge has `joined`, and an open one has neither. Home shows the
// first two as "yours" and the third as an invitation. Reading those fields
// wrongly does not throw -- it quietly files a game somebody is playing under
// "open to join", which is the bug this is here to catch.

const rostered = { gameId: 'a', gameName: 'Raid', mode: 'battleships', status: 'active', teamId: 't1', teamName: 'Red', createdAt: '2026-10-01' };
const entered = { gameId: 'b', gameName: 'Grind', mode: 'challenge', status: 'active', teamId: null, teamName: null, joined: true, createdAt: '2026-10-02' };
const open = { gameId: 'c', gameName: 'Next week', mode: 'challenge', status: 'setup', teamId: null, teamName: null, joined: false, createdAt: '2026-10-03' };

{
  const { mine, open: invites } = groupGames([rostered, entered, open]);
  assert.deepEqual(mine.map((g) => g.gameId), ['a', 'b']);
  assert.deepEqual(invites.map((g) => g.gameId), ['c']);
}

// An empty read must draw an empty Home, not throw on the way.
assert.deepEqual(groupGames([]), { mine: [], open: [] });
assert.deepEqual(groupGames(null), { mine: [], open: [] });
assert.deepEqual(groupGames(undefined), { mine: [], open: [] });

// `joined` is only ever set by listMyChallenges; a rostered game does not
// carry it, and must not need to.
assert.equal(groupGames([rostered]).mine.length, 1, 'a teamId is enough on its own');
// And a challenge row whose `joined` has not come back yet is an invitation,
// not a game of theirs: the safe failure is the one that still offers the way
// in, rather than hiding a sign-up screen behind a card that promises a board.
assert.equal(groupGames([{ ...open, joined: undefined }]).open.length, 1);

// The order listMyGames settled on has to survive the split, because Home
// leads with mine[0] -- rostered before entered, and nothing resorted by date.
{
  const newerChallenge = { ...entered, gameId: 'd', createdAt: '2026-12-25' };
  const { mine } = groupGames([rostered, newerChallenge]);
  assert.deepEqual(mine.map((g) => g.gameId), ['a', 'd'], 'groupGames filters, it does not sort');
}

// ---- Which one to lead with ----
//
// Home sorts `mine` by this and puts the first card at the top at a larger
// size. Running beats everything; finished is last, because the only thing
// left to do with it is read the ladder.

assert.ok(gameUrgency({ status: 'active' }) < gameUrgency({ status: 'setup' }));
assert.ok(gameUrgency({ status: 'setup' }) < gameUrgency({ status: 'finished' }));
// Every status the schema allows has to land somewhere sensible, and an
// unknown one must not sort below a finished game -- a mode added later would
// otherwise bury itself under last month's results.
for (const status of ['setup', 'prep', 'placement', 'paused', 'whatever']) {
  assert.ok(
    gameUrgency({ status }) < gameUrgency({ status: 'finished' }),
    `${status} outranks finished`
  );
}
assert.equal(gameUrgency(null), 1, 'a missing game is not a finished one');
assert.equal(gameUrgency(undefined), 1);

// The sort has to be stable in practice, which Array#sort guarantees, but the
// comparator must not invent a tie-break of its own.
{
  const a = { gameId: 'a', status: 'active' };
  const b = { gameId: 'b', status: 'active' };
  assert.equal(gameUrgency(a) - gameUrgency(b), 0);
}

// ---- Playing, and played ----
//
// Home splits a player's own games across two tabs. The rule is the status
// alone, which is the part worth pinning: everything not finished is still
// theirs to play, including a game in setup that has not opened yet.

{
  const done = { ...rostered, gameId: 'z', status: 'finished' };
  const { current, finished } = splitFinished([rostered, entered, done]);
  assert.deepEqual(current.map((g) => g.gameId), ['a', 'b']);
  assert.deepEqual(finished.map((g) => g.gameId), ['z']);
}

// Not-yet-started is "playing", not history. It is the case most likely to
// be filed wrongly, and filing it wrongly hides an event from the player
// until the moment it starts.
assert.equal(splitFinished([{ gameId: 'p', status: 'setup' }]).current.length, 1);
assert.equal(splitFinished([{ gameId: 'p', status: 'prep' }]).current.length, 1);
assert.equal(splitFinished([{ gameId: 'p', status: 'active' }]).current.length, 1);
assert.equal(splitFinished([{ gameId: 'p', status: 'finished' }]).finished.length, 1);

assert.deepEqual(splitFinished([]), { current: [], finished: [] });
assert.deepEqual(splitFinished(null), { current: [], finished: [] });
// A row with no status at all is still something to play rather than
// something to file away: the tab that shows it is the one somebody is
// looking at, and a game hidden in History is a game nobody finds.
assert.equal(splitFinished([{ gameId: 'p' }]).current.length, 1);

// History reads newest first, which is the opposite of what the rostered-vs-
// challenge ranking in listMyGames would give it.
{
  const { finished } = splitFinished([
    { gameId: 'old', status: 'finished', createdAt: '2026-01-01' },
    { gameId: 'new', status: 'finished', createdAt: '2026-09-01' },
    { gameId: 'mid', status: 'finished', createdAt: '2026-05-01' },
  ]);
  assert.deepEqual(finished.map((g) => g.gameId), ['new', 'mid', 'old']);
}

// And sorting history must not reorder the list it was given -- `mine` is
// rendered from the same array.
{
  const rows = [
    { gameId: 'old', status: 'finished', createdAt: '2026-01-01' },
    { gameId: 'new', status: 'finished', createdAt: '2026-09-01' },
  ];
  splitFinished(rows);
  assert.deepEqual(rows.map((g) => g.gameId), ['old', 'new'], 'splitFinished does not sort in place');
}

// ---- Home says which game each card is ----
//
// The card names the mode, which means listMyGames has to be selecting it.
// It did not before Home existed -- the header dropdown showed names only --
// so this is a real way for the screen to start saying "Event" about
// everything.
{
  const games = readFileSync(new URL('../src/lib/games.js', import.meta.url), 'utf8');
  assert.ok(games.includes('games!teams_game_id_fkey!inner(id, name, mode, status, created_at)'),
    'the roster read still asks for mode');
  assert.ok(games.includes('mode: game.mode'), 'and still puts it on the row');
  assert.ok(games.includes("mode: 'challenge'"), 'challenges name their own mode');
}

assert.equal(modeLabel('battleships'), 'Battleships');
assert.notEqual(modeLabel('challenge'), 'Event', 'a challenge card should not say "Event"');
assert.equal(modeLabel(null), 'Event', 'and an unknown mode says something rather than nothing');

// ---- The picker really is gone ----
//
// Home replaced it, and the stored pick that used to decide the landing went
// with it. Leaving either behind is not a crash: it is a localStorage key
// still being written for nobody to read, and a second game selector that
// disagrees with Home about which game is open.
{
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.ok(!app.includes('GamePicker'), 'App no longer mounts the picker');
  assert.ok(!app.includes('GamePick'), 'and no longer reads or writes the stored pick');
  assert.ok(app.includes('<Home'), 'App mounts Home');
  // The landing is unconditional. If this ever grows an `if` again it will be
  // the same invisible rule Home was built to remove.
  assert.ok(app.includes('const [home, setHome] = useState(true)'), 'home starts true');
}

// ---- The rail, and the room it takes ----
//
// SideNav is hidden below 1400px and the page is what it always was. The
// number is not a taste call: .board-layout goes to three columns above
// 1100px and measures the WINDOW rather than the space it was given, so a
// rail shown at 1100 would keep the strip in three columns and take its
// 234px (210 rail + 1.5rem gap) out of the board instead. 1400 is the width
// at which the rail comes out and the strip still has its 1100.
{
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

  assert.ok(app.includes('<SideNav'), 'App mounts the rail');
  assert.ok(app.includes('!consoleScreen && ('),
    'and stands it down for the console, which has a sidebar of its own');

  assert.ok(css.includes('.app-split { display: contents; }'),
    'the wrapper leaves the layout entirely when there is no rail');
  assert.ok(css.includes('.side-nav { display: none; }'), 'and the rail is hidden by default');

  // The grid is applied ONLY when a rail is actually in the wrapper. Without
  // the `:has`, the organiser's console -- which renders no rail, having
  // .admin-nav of its own -- put its single child in the first column, the
  // 210px one meant for the rail, and the whole console was squeezed into it.
  assert.ok(css.includes('.app-split:has(> .side-nav) {'),
    'the two-column grid is conditional on a rail being there');
  // And it is a grid ONLY inside that rule: an unconditional
  // `.app-split { display: grid }` is what caused the squeeze.
  assert.ok(
    css.indexOf('display: grid', css.indexOf('.app-split:has(> .side-nav) {'))
      - css.indexOf('.app-split:has(> .side-nav) {') < 80,
    'the grid sits inside the :has rule, not on .app-split itself'
  );

  const RAIL_BREAKPOINT = 1400;
  assert.ok(css.includes(`@media (min-width: ${RAIL_BREAKPOINT}px) {`),
    `the rail appears at ${RAIL_BREAKPOINT}px`);

  // The arithmetic the breakpoint rests on, asserted rather than trusted to
  // a comment: page padding is 1.5rem each side, the rail is at most 210px,
  // and the gap is 1.5rem.
  const PADDING = 24 * 2;
  const RAIL = 210;
  const GAP = 24;
  assert.ok(
    RAIL_BREAKPOINT - PADDING - RAIL - GAP >= 1100,
    'a rail at this width still leaves .board-layout the 1100px it wants'
  );
  assert.ok(css.includes('minmax(170px, 210px)'), `the rail is still ${RAIL}px at its widest`);
}

// ---- The rail's game is read AFTER `game` exists ----
//
// `inGame` reads `game`, which is a const declared by useGame further down
// App's body. Putting the derivation up with the other flags reads tidily and
// throws: a const read above its own declaration in the same scope is a
// temporal dead zone error. It shipped once, as "Cannot access 'V' before
// initialization" after minification, and it took the whole site down --
// including for signed-out visitors, because App derives all of this above
// its own `if (!session)` return.
//
// A build does not catch it and no helper test can reach it, so the order is
// asserted here and the App harness (preview-app.html) renders the real
// component body, which is the only thing that would have caught it.
{
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const declared = app.indexOf('const game = useGame(');
  const used = app.indexOf('const inGame = game.game');
  assert.ok(declared !== -1, 'App still gets its game from useGame');
  assert.ok(used !== -1, "App still derives the rail's game");
  assert.ok(declared < used, '`inGame` must be derived below `const game`, not above it');

  const harness = readFileSync(new URL('../src/preview/app-main.jsx', import.meta.url), 'utf8');
  assert.ok(harness.includes("import App from '../App.jsx'"),
    'the App harness renders the real App, not a stand-in');
}

// ---- Home's cards can actually shrink ----
//
// `grid-template-columns: 1fr auto` is really `minmax(auto, 1fr) auto`, and an
// `auto` minimum refuses to go below its own content width. With a nowrap
// status label in the second column, that made the card wider than a phone
// viewport: the label sat off the right edge and the whole page scrolled
// sideways, while every test passed and the desktop width looked perfect.
// `minmax(0, 1fr)` is what lets the first column give way.
//
// That is the third grid track to misbehave on this screen -- the header's
// `.who` block and the organiser console were both auto-placement -- so it is
// asserted here rather than remembered.
{
  const sheet = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const fromCard = sheet.slice(sheet.indexOf('.home-game {'));
  const cardRule = fromCard.slice(0, fromCard.indexOf('}'));
  assert.ok(
    cardRule.includes('minmax(0, 1fr)'),
    '.home-game needs minmax(0, 1fr) so the name column can shrink on a phone'
  );

  // The scales exist, and Home is built on them rather than on hand-picked
  // values. 107 distinct padding values is what this guards against returning.
  for (const token of ['--s-4:', '--t-body:', '--tr-large:', '--lh-tight:']) {
    assert.ok(sheet.includes(token), `the design scales still define ${token}`);
  }
  const home = sheet.slice(sheet.indexOf('/* ---- Home (Home.jsx) ----'));
  assert.ok(home.includes('var(--s-'), 'Home draws its spacing from the scale');
  assert.ok(home.includes('var(--t-'), 'Home draws its type sizes from the scale');
}

console.log('home-selftest: ok');
