import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bySoonest, gameUrgency, groupGames, splitFinished } from '../src/lib/homeGames.js';
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

// ---- A board event signed up for, and one merely open ----
//
// The same two fields carry a fourth kind of row now: a bingo or a snakes
// event this player signed up for but has not been put on a team for yet
// (game_signup_list, 20261026160000). groupGames needed no change at all for
// it, which is the part worth pinning -- the rule was always about teamId and
// `joined`, never about the mode.

const signedUpBoard = { gameId: 'e', gameName: 'Autumn bingo', mode: 'bingo', status: 'setup', teamId: null, teamName: null, joined: true, signups: 11, createdAt: '2026-10-04' };
const openBoard = { gameId: 'f', gameName: 'Winter snakes', mode: 'snakes', status: 'setup', teamId: null, teamName: null, joined: false, signups: 3, createdAt: '2026-10-05' };

{
  const { mine, open: invites } = groupGames([rostered, signedUpBoard, openBoard]);
  assert.deepEqual(mine.map((g) => g.gameId), ['a', 'e'], 'a board event signed up for is theirs');
  assert.deepEqual(invites.map((g) => g.gameId), ['f'], 'and one they have not is an invitation');
}

// A rostered board event must never arrive twice -- once through team_members
// and once through game_signup_list, which lists every open event to everybody.
// The drop happens inside listMyGames, where both of the other lists are folded
// against the rostered map, so it is asserted at the source: a duplicate would
// draw two cards for one game, the second of them with no team name on it.
{
  const games = readFileSync(new URL('../src/lib/games.js', import.meta.url), 'utf8');
  assert.ok(games.includes('listOpenEvents()'),
    'listMyGames asks for the open board events at all');
  assert.ok(games.includes('.filter((g) => !byGame.has(g.gameId))'),
    'and drops anything already rostered from both of the other lists');
  assert.ok(games.includes('signups: g.signups ?? 0'),
    'the count reaches the row the waiting screen reads it off');
}

// ---- The roster picker still works without sign-ups ----
//
// Five events were running when sign-ups arrived, every one of them with a
// roster and no sign-ups at all, and an organiser may always fill a team from
// whoever asked in Discord. So an empty shortlist opens on the list the picker
// always showed, rather than on nothing, and the checklist row never gates a
// start.
{
  const admin = readFileSync(new URL('../src/components/Admin.jsx', import.meta.url), 'utf8');
  assert.ok(admin.includes('const everyone = showEveryone || shortlist.length === 0;'),
    'an empty shortlist falls through to every free account');
  assert.ok(admin.includes("key: 'signups', label: 'Sign-ups', required: false,"),
    'and the Sign-ups row is informative, never required');
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
  assert.ok(games.includes('games!teams_game_id_fkey!inner(id, name, mode, status, created_at, starts_at)'),
    'the roster read still asks for mode, and for the start time the cards count down to');
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

// ---- The header on a phone ----
//
// `.top` is `auto 1fr auto` in one row, which needs about 960px. Below that
// the middle column did not squeeze, it collapsed: the two `auto` columns
// kept their content width, the game's name wrapped one word per line into
// the controls beside it, and at 375px the page was 93px wider than the
// screen with the sign-out off the right edge.
//
// Four things keep it fixed, and each one is a trap that has already been
// fallen into on this header.
{
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

  assert.ok(css.includes('grid-template-columns: auto 1fr auto'),
    'the full-width header is still the three-column grid the fix is measured against');

  const PHONE = '@media (max-width: 960px) {';
  const MARK = '@media (max-width: 520px) {\n  .top .wordmark';
  assert.ok(css.includes(PHONE), 'the header stops being one row below a laptop');
  assert.ok(css.includes(MARK), 'and the lockup comes down to its mark on a phone');
  const phone = css.slice(css.indexOf(PHONE), css.indexOf(MARK));

  // Two columns, and a middle one that can reach zero on purpose rather than
  // by collapse. `1fr` is `minmax(auto, 1fr)` and refuses to go under its own
  // content -- the same track behaviour that made .home-game overflow a phone.
  assert.ok(phone.includes('grid-template-columns: auto minmax(0, 1fr);'),
    'below 960 the header is two columns, the second able to shrink');

  // Pinned, not auto-placed. .who has no business being anywhere but the top
  // right, and auto-placement has put it under the wordmark once already.
  const who = phone.slice(phone.indexOf('.who {'));
  assert.ok(who.includes('grid-column: 2;') && who.includes('grid-row: 1;'),
    '.who stays top right rather than being auto-placed');
  assert.ok(who.includes('flex-wrap: wrap;'),
    'and the controls wrap onto a second line instead of running off the edge');

  // THE ONE THAT BIT. `@media` adds no specificity, so this override and the
  // base `.top .header-status { text-align: center }` weigh exactly the same
  // and the later one in the file wins. Written above the base rule it is
  // dead CSS that looks right in the diff.
  const status = phone.indexOf('.top .header-status {');
  assert.ok(status !== -1, 'the game name gets a row of its own on a phone');
  assert.ok(
    css.indexOf('.top .header-status {') < css.indexOf(PHONE),
    'the phone override must come AFTER the base .header-status rule, not before it'
  );

  // The mark alone in the app header on a phone, and the whole lockup
  // everywhere else. Unscoped, this would strip the login screen -- the one
  // page that is nothing but the lockup -- down to a crest.
  const mark = css.slice(css.indexOf(MARK));
  assert.ok(mark.startsWith('@media (max-width: 520px) {\n  .top .wordmark .wordmark-subtitle,\n  .top .wordmark .sub { display: none; }'),
    'the subtitle is dropped only inside .top, so the login lockup keeps it');
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

// ---- Which open event leads ----
//
// `gameUrgency` settles the list of games somebody is already playing, but
// every OPEN event is in the same state, so it cannot separate two of them at
// all. Home leads with the first of them when the player is in nothing, which
// makes this comparator the thing that decides what a new member sees first.

{
  const soon = { gameId: 'soon', startsAt: '2026-11-01T12:00:00Z', createdAt: '2026-10-01' };
  const later = { gameId: 'later', startsAt: '2026-12-01T12:00:00Z', createdAt: '2026-10-01' };
  assert.ok(bySoonest(soon, later) < 0, 'the one starting first comes first');
  assert.ok(bySoonest(later, soon) > 0, 'and the comparator is symmetrical');
  assert.equal(bySoonest(soon, soon), 0, 'the same event ties with itself');
}

// An undated event sorts LAST, not first. `starts_at` is nullable (0013) and
// plenty of events never get one; read as zero, every undated event would
// outrank the one actually starting tomorrow -- which is the whole decision
// this comparator exists to make.
{
  const dated = { gameId: 'dated', startsAt: '2026-11-01T12:00:00Z', createdAt: '2026-01-01' };
  const undated = { gameId: 'undated', startsAt: null, createdAt: '2026-10-01' };
  assert.ok(bySoonest(dated, undated) < 0, 'a dated event beats an undated one');
  assert.ok(bySoonest(undated, dated) > 0);
  assert.deepEqual(
    [undated, dated].sort(bySoonest).map((g) => g.gameId),
    ['dated', 'undated'],
    'and sorting really puts the undated one at the back'
  );
}

// A date the browser cannot read is the same as no date. NaN compares false
// against everything, so an unguarded Date.parse would make the comparator
// inconsistent and the sort order arbitrary.
{
  const junk = { gameId: 'junk', startsAt: 'not a date', createdAt: '2026-10-01' };
  const dated = { gameId: 'dated', startsAt: '2026-11-01T12:00:00Z', createdAt: '2026-01-01' };
  assert.ok(bySoonest(dated, junk) < 0, 'an unreadable date sorts last, like none at all');
  assert.ok(bySoonest(junk, dated) > 0);
}

// Two undated events fall back to newest first, which is the order the lists
// already arrive in.
{
  const older = { gameId: 'older', createdAt: '2026-01-01' };
  const newer = { gameId: 'newer', createdAt: '2026-09-01' };
  assert.ok(bySoonest(newer, older) < 0);
  assert.deepEqual([older, newer].sort(bySoonest).map((g) => g.gameId), ['newer', 'older']);
}

// Nothing in it may throw: the list is whatever the RPCs sent back.
assert.equal(typeof bySoonest(null, undefined), 'number');
assert.equal(typeof bySoonest({}, {}), 'number');

// ---- The cards get the facts they draw ----
//
// Every one of these already came back from challenge_list and
// game_signup_list; games.js mapped the row and dropped them on the floor.
// That is the failure mode worth pinning, because it does not throw -- it just
// draws a card saying "Not started" about an event beginning in two hours,
// which is exactly what Home did before this.
{
  const games = readFileSync(new URL('../src/lib/games.js', import.meta.url), 'utf8');
  for (const field of [
    'startsAt: c.starts_at',
    'metric: c.wom_metric',
    'rankedBy: c.ranked_by',
    'solo: c.solo',
    'signups: c.entrants ?? 0',
  ]) {
    assert.ok(games.includes(field), `a challenge row carries ${field}`);
  }
  assert.ok(games.includes('startsAt: g.starts_at'), 'an open board event carries its start time');
  assert.ok(games.includes('startsAt: game.starts_at'), 'and so does a rostered game');

  // A TEAM challenge arrives through both reads. The duplicate is dropped by
  // game id, and dropping it used to drop the metric with it -- so the one
  // card with a picture to show was the one event the player was actually in.
  assert.ok(games.includes('const more = extra.get(g.gameId);'),
    'a rostered row is merged with whatever the other list knows about it');
  assert.ok(games.includes('return more ? { ...more, ...g } : g;'),
    'and the roster answers win every field the roster has');
}

// ---- The lead card, and the artwork on it ----
{
  const home = readFileSync(new URL('../src/components/Home.jsx', import.meta.url), 'utf8');

  // The lead falls through to an open event. Without it, a player in nothing
  // leads with a sentence apologising while the thing to do sits in a small
  // card below -- which was the state of this screen for its whole first life.
  assert.ok(home.includes('const lead = ordered[0] ?? invites[0] ?? null;'),
    'an open event leads when the player is in nothing of their own');

  // The card opens the sign-up screen; it does not sign anybody up. One press
  // short of what a label promises is a promise broken.
  assert.ok(home.includes("return 'Sign up →';"), 'the invite card says what it does');
  assert.ok(!home.includes('Sign me up'), 'and does not claim to do the signing up itself');

  // The artwork is the metric's, which means Home has to be given the metric.
  assert.ok(home.includes('slug={metricIcon(game.metric)}'), 'a challenge card draws its metric');
  assert.ok(home.includes('MODE_MARKS[game.mode] ?? MODE_MARKS.default'),
    'and a board mode draws a mark of its own game instead');
}

// ---- Small text is readable ----
//
// --label-3 is 32% white, which lands around 2.4:1 on this page: under the
// 4.5:1 small text needs, and the status line is the smallest text on the
// screen. The fix is not a new colour, it is using the one that already
// passes, so this asserts the Home block never reaches for the other.
{
  const sheet = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const home = sheet.slice(
    sheet.indexOf('/* ---- Home (Home.jsx) ----'),
    sheet.indexOf('/* ---- Setup wizard (Admin.jsx -> NewGame) ----')
  );
  assert.ok(home.length > 0, 'the Home block is still where the sheet says it is');
  assert.ok(!home.includes('--label-3'), 'Home puts no small text on --label-3');
}

console.log('home-selftest: ok');
