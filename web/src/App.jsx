import { useCallback, useEffect, useRef, useState } from 'react';
import Guide from './components/Guide.jsx';
import NextMove from './components/NextMove.jsx';
import {
  supabase, isSupabaseConfigured, claimTile, spendPetJar, myModeratorModes,
} from './lib/supabase.js';
import { useGame } from './hooks/useGame.js';
import { subscribeToGameEvents } from './lib/gameEvents.js';
import { coordLabel, fromPosition } from './lib/board.js';
import Login from './components/Login.jsx';
import EnemyGrid from './components/EnemyGrid.jsx';
import MyFleet from './components/MyFleet.jsx';
import ActiveTiles from './components/ActiveTiles.jsx';
import FireEffect from './components/FireEffect.jsx';
import EventFeed from './components/EventFeed.jsx';
import CaptainPlacement from './components/CaptainPlacement.jsx';
import StartTimeBadge from './components/StartTimeBadge.jsx';
import Admin from './components/Admin.jsx';
import TeamNameEditor from './components/TeamNameEditor.jsx';
import MyAccount from './components/MyAccount.jsx';
import Wordmark from './components/Wordmark.jsx';
import { REPO_URL, pageTitle } from './lib/site.js';
import EvidencePanel from './components/EvidencePanel.jsx';
import BoardLegend from './components/BoardLegend.jsx';
import PetJar from './components/PetJar.jsx';
import StatsPanel from './components/StatsPanel.jsx';
import NoTeamWaiting from './components/NoTeamWaiting.jsx';
import TileSuggestions from './components/TileSuggestions.jsx';
import { useConfirm } from './components/ConfirmDialog.jsx';
import Home from './components/Home.jsx';
import SideNav from './components/SideNav.jsx';
import BingoGame from './components/bingo/BingoGame.jsx';
import SnakesGame from './components/snakes/SnakesGame.jsx';
import TerritoryLive from './components/territory/TerritoryLive.jsx';
import ChallengeGame from './components/challenge/ChallengeGame.jsx';
import { listMyGames } from './lib/games.js';
import { readMuted, writeMuted } from './lib/sound.js';
import { REVEAL_DELAY_MS, SHOT_RESULT_DURATION_MS } from './lib/fireEffect.js';
import { tileProgressText } from './lib/tileProgress.js';
import { ACTING_ENABLED, setViewOnly } from './lib/viewOnly.js';
import useUnseenEvents from './hooks/useUnseenEvents.js';

export default function App() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [gameId, setGameId] = useState(null);
  // Every game this player is rostered into. Empty for an admin, and for a
  // signup no captain has picked yet -- both fall back below.
  const [myGames, setMyGames] = useState([]);
  const [notice, setNotice] = useState(null);
  const [shot, setShot] = useState(null);
  const [shotResult, setShotResult] = useState(null);
  const [busyTileId, setBusyTileId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  // The modes a moderator runs. Empty for a player, and for an admin, whose
  // is_admin already covers every mode.
  const [modModes, setModModes] = useState([]);
  // "View as team": the console's way into a team's player screen, read only
  // unless the organiser chooses to act for the team.
  // { gameId, teamId, teamName, role, acting } while one is open, otherwise null.
  const [viewAs, setViewAs] = useState(null);
  // An organiser who has stepped out of the console into their own game.
  // Not persisted: a reload puts them back in the console, which is the
  // job, and is what an organiser who never touches this still gets.
  const [playing, setPlaying] = useState(false);
  // The View-as bar's secondary buttons, folded behind "More" on a phone.
  const [viewMore, setViewMore] = useState(false);
  // Which board is on screen. The two used to sit side by side, which cost
  // each of them half the page and left the cells too small to read the tile
  // art in. One at a time, full width.
  const [boardTab, setBoardTab] = useState('enemy');
  // A locked-in square the team has pressed to re-read its evidence. Held as an
  // id rather than the row, so it survives a refresh of the tile list.
  const [openTileId, setOpenTileId] = useState(null);
  // Spending a pet-jar preview: the board becomes the picker, so the mode and
  // its result live here rather than inside the card that starts it.
  const [petPick, setPetPick] = useState(false);
  const [petPreview, setPetPreview] = useState(null);
  // Lazily initialised so the stored answer is read once, not on every render.
  const [muted, setMuted] = useState(readMuted);
  // The "Suggest a tile" screen, in place of the board. A screen of its own
  // rather than a popup: the tile form is long, and on a phone a popup that
  // scrolls inside a page that scrolls is two scrollbars to lose a button in.
  const [suggesting, setSuggesting] = useState(false);
  // Above the early returns below, with the rest of the hooks — useConfirm
  // holds state of its own.
  const [confirm, confirmDialog] = useConfirm();
  const guideRef = useRef(null);
  const resultRevealTimerRef = useRef(null);
  const resultHideTimerRef = useRef(null);

  useEffect(() => () => {
    clearTimeout(resultRevealTimerRef.current);
    clearTimeout(resultHideTimerRef.current);
  }, []);

  useEffect(() => {
    if (!supabase) { setReady(true); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    // Handing setSession a new object only when the session actually changed.
    //
    // supabase-js re-emits SIGNED_IN for the *same* session every few seconds --
    // same access token, same expires_at, a fresh object each time. `session` is
    // a dependency of `load` in useGame, so every one of those rebuilt `load`,
    // which rebuilt the Realtime channel effect keyed on it, which resubscribed,
    // which drew another emit: a loop throttled only by how long ten queries take.
    // Idle, that cost ~19 requests a second per player. Comparing the token and
    // the user id keeps the previous object when nothing moved, so the effects
    // downstream stay still. A real sign-in, sign-out or token refresh changes one
    // of the two and still propagates.
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSession((prev) =>
        prev?.access_token === s?.access_token && prev?.user?.id === s?.user?.id
          ? prev
          : s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // The address behind a player's username is synthetic and must never be shown
  // (see lib/auth.js). The username is already in the session's user metadata —
  // set at sign-up, and by the admin snippet — so no extra query is needed.
  const displayName = session?.user?.user_metadata?.display_name ?? '';

  const uid = session?.user?.id ?? null;

  // My Account, open over whatever is on screen. Not a tab: it belongs to the
  // player rather than to the game they happen to be looking at, and a tab
  // would have to live somewhere different on five different screens.
  const [accountsOpen, setAccountsOpen] = useState(false);

  // Home, and the landing. True on sign-in, always: landing used to depend on
  // a localStorage pick nobody could see, so the same player got a different
  // screen on their phone and their PC. One screen, every time, and the game
  // is a press away from it.
  const [home, setHome] = useState(true);

  // The chosen game, mirrored so the roster refresh can read it without taking
  // it as a dependency -- which would rebuild the refresh on every switch.
  const gameIdRef = useRef(null);
  gameIdRef.current = gameId;
  // Bumped per roster read, so an alt-tab storm cannot let a slow earlier reply
  // land on top of a newer one.
  const gamesSeq = useRef(0);
  // Returning to the tab fires `focus` and `visibilitychange` together, and
  // both need to stay: only `visibilitychange` covers a phone unlocking, only
  // `focus` covers a desktop alt-tab, where the page never became hidden.
  // Collapsing the overlap here is cheaper than dropping either one.
  const gamesAt = useRef(0);

  // Which game to show.
  //
  // Rostered players get their own games, newest first, with their last pick
  // restored. Everyone else -- a fresh signup on no roster anywhere, or an
  // admin with no team of their own -- gets whichever game the admin has
  // flagged `is_featured`, and that fallback is load-bearing twice over:
  //
  //   * an admin has no team, and `gameId` also drives the shot-sound channel
  //     below, which sits outside the isAdmin split on purpose so the organiser
  //     hears cannons land. Filtering it to "my games" would silence them;
  //   * `waitingForTeam` needs a game to be loaded before it will show the
  //     waiting room. With no gameId a fresh signup gets "No game yet. An admin
  //     needs to create one." instead -- true of nobody, and alarming.
  //
  // Falls back to newest-by-created_at when nothing is featured yet, so an
  // admin who has never touched the new toggle sees the same thing as before.
  const loadGames = useCallback(async ({ throttle = false } = {}) => {
    if (!supabase || !uid) return;
    if (throttle && Date.now() - gamesAt.current < 1500) return;
    gamesAt.current = Date.now();
    const seq = ++gamesSeq.current;

    let mine = [];
    try {
      mine = await listMyGames(uid);
    } catch {
      // A failed roster read should not black out the screen. Home draws fine
      // with an empty list -- it says so in words -- which is a better answer
      // than the board this used to fall through to.
      mine = [];
    }
    if (seq !== gamesSeq.current) return;
    setMyGames(mine);

    // NOTHING IS AUTO-SELECTED ANY MORE. This used to pick a game here: a
    // stored localStorage pick, else a ranked mine[0], else the featured game,
    // else the newest game in the whole database -- which meant a player who
    // was in nothing at all was shown a stranger's game, with nothing on
    // screen to say so. Landing is Home now, and a game is something the
    // player chooses off it. The stored pick went with it: it existed only to
    // decide this, and a value written for nobody to read is worse than no
    // value at all.
    //
    // What is still needed is the other half of the old guard: a player whose
    // game has been deleted under them must not be left pointing at it.
    if (gameIdRef.current && !mine.some((g) => g.gameId === gameIdRef.current)) {
      setGameId(null);
      setHome(true);
    }
  }, [uid]);

  useEffect(() => {
    // Signed out, or swapped for another player on a shared phone: drop the
    // previous roster rather than briefly offering it to whoever is next.
    if (!uid) {
      setMyGames([]); setGameId(null); setViewAs(null); setPlaying(false); setHome(true);
      return;
    }
    loadGames();
  }, [uid, loadGames]);

  // Nothing writes a game_event when a captain adds a player, renames a game or
  // deletes one, so the Realtime subscription never hears about any of it. A
  // player coming back to the tab is the cheap moment to re-check: it catches
  // the game they were just added to, and moves them off one that has been
  // deleted under them.
  useEffect(() => {
    if (!uid) return undefined;
    const recheck = () => { if (!document.hidden) loadGames({ throttle: true }); };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [uid, loadGames]);

  // Whether to offer the console, and for which modes. Cosmetic only — every
  // admin RPC re-checks is_admin() or may_manage_game() server-side, so faking
  // either of these buys nothing.
  useEffect(() => {
    if (!supabase || !session) { setIsAdmin(false); setModModes([]); return; }
    supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setIsAdmin(Boolean(data?.is_admin)));
    // Fails soft to no modes: a console that cannot read them shows the player
    // screen, which is the safe way round.
    myModeratorModes()
      .then((modes) => setModModes(modes ?? []))
      .catch(() => setModModes([]));
  }, [session]);

  // An organiser is an admin, or a moderator of at least one mode.
  const isOrganiser = isAdmin || modModes.length > 0;

  // Only ever for an organiser -- the server refuses admin_board_for_team to
  // anyone else -- and checked here too, so a value left over from an
  // organiser's session can never put a player's screen into it.
  const viewing = isOrganiser && Boolean(viewAs);
  // An organiser is also a person who plays. Running the bingo should not cost
  // them their own board in the raid, so they can step out of the console into
  // the games they are rostered on -- their own screen, their own team, no
  // view-only guard and no x-act-as-team header, because they are not acting
  // for anyone. Only offered when they are actually on a roster somewhere.
  const canPlay = isOrganiser && myGames.length > 0;
  const playingOwn = canPlay && playing && !viewing;
  // The player screen: for players, for an organiser viewing a team, and for
  // an organiser who has stepped into their own game.
  const playerScreen = !isOrganiser || viewing || playingOwn;
  // The board itself. `playerScreen` stays a statement about WHO this is --
  // the unseen-event counter in the tab title still wants it while somebody
  // sits on Home, because they are still in the event. This is a statement
  // about WHAT is on screen, and on Home the answer is no board, no waiting
  // countdown and no guide.
  const showBoard = playerScreen && !home;
  // The organiser's console: not Home, and not a player screen. It brings its
  // own sidebar (.admin-nav), so the rail stands down for it rather than
  // asking which of two sidebars moves you.
  const consoleScreen = isOrganiser && !home && !viewing && !playingOwn;

  // The game the rail offers a way back into. Normally the loaded one. On
  // Home it is usually loaded too -- goHome keeps gameId on purpose -- but on
  // a cold open it is not yet, and the roster row already has the name, so
  // the rail can say which game it means before the board has arrived.
  const picked = gameId ? myGames.find((g) => g.gameId === gameId) ?? null : null;
  const inGame = game.game
    ? { name: game.game.name, mode: game.game.mode }
    : picked ? { name: picked.gameName, mode: picked.mode } : null;
  // The game on that screen. A team being viewed brings its own; otherwise it
  // is whatever loadGames settled on, which is one of their own games when
  // they are rostered and the featured one when they are not -- so an
  // organiser who plays steps straight into their game, not the featured one.
  const boardGameId = viewing ? viewAs.gameId : gameId;

  // Set while rendering rather than in an effect, so the guard is up before
  // the first click on the screen it protects can land (lib/viewOnly.js).
  // Acting lifts it, and names the team on every request, for that team only.
  const acting = viewing && ACTING_ENABLED && viewAs.acting === true;
  setViewOnly(viewing ? viewAs.teamName : null, acting ? viewAs.teamId : null);

  const game = useGame(boardGameId, session, viewing ? viewAs : null);

  // A cannon fire is not a private event — every `shot_fired` row is
  // world-readable (see 0039's `events_read` policy), so anyone with the
  // page open, admins and teamless spectators included, should hear it the
  // moment it lands rather than only the team that pulled the trigger.
  useEffect(() => {
    if (!supabase || !boardGameId) return undefined;
    // Shares one channel with useGame and useGameStats -- see lib/gameEvents.js.
    return subscribeToGameEvents(boardGameId, (row) => {
      if (row.type !== 'shot_fired') return;
      setShot({ nonce: Date.now(), result: row.payload?.result });
    });
  }, [boardGameId]);

  // Signed up, but no captain has picked them yet. Showing the board here would
  // be a game they cannot touch, with the reason buried in a grey clause — so
  // they get a waiting room instead.
  // A challenge is the exception, and the reason the mode is checked here
  // rather than below with the others: nobody is picked for one. Players sign
  // themselves up, a solo event has no teams at all, and the screen that lets
  // them do it is the one this would replace with "please await orders".
  const waitingForTeam =
    playerScreen && !game.loading && Boolean(game.game)
    && game.game.mode !== 'challenge' && !game.myTeamId;

  // Rostered ahead of time, but nothing to do yet: preparation may not even
  // be open, or it is open but placing the fleet is the captain's job, not
  // this player's. Either way the alternative is a placement screen that
  // says "nothing for you to do", which is the same waiting room by another
  // name — so it gets the waiting room, and stays there until the battle
  // itself opens. Only a captain gets in earlier, to actually place ships.
  const notYetOpen =
    playerScreen && !game.loading && Boolean(game.game) && Boolean(game.myTeamId) &&
    game.game.status !== 'active' && game.game.status !== 'finished' &&
    game.myRole !== 'captain';
  const waitingScreen = waitingForTeam || notYetOpen;

  // The tab names the game a player is in, or just the platform. Organisers
  // move between games in the console, so theirs stays on the platform name.
  const titleGame = session && (!isOrganiser || playingOwn) ? game.game?.name ?? null : null;
  // And how much happened while the tab was in the background: "(2) Game".
  // A player's own feed only -- not an organiser looking in on a team.
  const unseen = useUnseenEvents(
    playerScreen && !viewing ? game.events : null,
    !game.loading && Boolean(game.game)
  );
  useEffect(() => {
    const count = unseen > 99 ? '99+' : unseen;
    document.title = `${unseen ? `(${count}) ` : ''}${pageTitle(titleGame)}`;
  }, [titleGame, unseen]);

  // Being added to a team writes no game_event, so the Realtime subscription
  // never fires for it. Poll while waiting so the page lets them in by itself
  // rather than needing to be told to refresh. Must sit above the early returns
  // below — a hook after a conditional return is a hook that sometimes vanishes.
  //
  // The roster read goes with it: a captain may well add this player to an
  // older game rather than the newest one on screen, and refreshing only the
  // game being watched would leave them in the waiting room staring at a game
  // they were never going to be in.
  const refreshRef = useRef(game.refresh);
  refreshRef.current = game.refresh;
  useEffect(() => {
    if (!waitingForTeam) return undefined;
    const id = setInterval(() => {
      refreshRef.current?.();
      loadGames();
    }, 10000);
    return () => clearInterval(id);
  }, [waitingForTeam, loadGames]);

  if (!isSupabaseConfigured) {
    return (
      <main className="app">
        <Wordmark />
        <p className="error">
          Supabase is not configured. Copy <code>.env.example</code> to{' '}
          <code>web/.env</code> and fill in the project URL and anon key.
        </p>
      </main>
    );
  }

  if (!ready) return <main className="app"><p>Loading…</p></main>;
  if (!session) return <main className="app"><Login /></main>;

  async function onClaim(tile) {
    // A grid cell is a small target, especially on a phone, and locking a tile
    // in is not free: it takes one of the team's active slots until the tile is
    // fired. Firing already confirms in ActiveTiles; locking in should too.
    const { row, col } = fromPosition(tile.position);
    if (!(await confirm(
      `Lock in ${coordLabel(row, col)}? It takes one of your active slots.`,
      { title: `Lock in ${coordLabel(row, col)}`, confirmLabel: 'Lock it in' }
    ))) return;

    setBusyTileId(tile.id);
    setNotice(null);
    try {
      await claimTile(tile.id);
      await game.refresh();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusyTileId(null);
    }
  }

  /**
   * Spend one pet-jar preview on the square just pressed.
   *
   * Asked for first, because a preview is earned one screenshot at a time and
   * the board is a hundred small targets — a mis-press used to spend a charge
   * on a square nobody chose, with nothing to undo it. The coordinate is in
   * the question so the answer is against the square the player meant.
   */
  async function onPetPick(tile) {
    const { row, col } = fromPosition(tile.position);
    const label = coordLabel(row, col);
    if (!(await confirm(
      `Spend a preview on ${label}? It shows the task, not whether a ship is there.`,
      { title: `Preview ${label}`, confirmLabel: 'Spend it' }
    ))) return;

    setBusyTileId(tile.id);
    setNotice(null);
    try {
      const result = await spendPetJar(tile.id);
      setPetPreview({ ...result, coord: label });
      setPetPick(false);
      await game.refresh();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusyTileId(null);
    }
  }

  // Moving to another game. Four pieces of state below are keyed to the board
  // being left, and none of them survive the move meaningfully:
  //
  //   shot        -- would fire a cannon and a hit sound for the other game;
  //   openTileId  -- a tile id from the old board, so the evidence panel would
  //                  open on a square that is not there;
  //   busyTileId  -- leaves a square spinning forever, nothing will clear it;
  //   notice      -- an error about a game no longer on screen.
  //
  // petPick/petPreview go the same way: the picking mode would be armed over
  // another game's board, and the preview names a tile that is not on it.
  //
  // useGame needs no help: `load` is keyed on gameId and the channel cleanup
  // clears its pending reveal timers.
  function switchGame(nextId) {
    if (!nextId) return;
    // A card on Home promises that game, and for an organiser the default
    // screen is the console -- so picking one has to step them into it the
    // way the "Play my game" button does, or the press lands on the console
    // with nothing to say why. Leaving a team's view goes with it: a card is
    // their own screen, not somebody else's.
    setPlaying(true);
    setViewAs(null);
    // Picking the game already loaded still has to leave Home -- that is the
    // commonest press on the screen, somebody going back into the event they
    // were already in.
    if (nextId === gameId) { setHome(false); window.scrollTo({ top: 0 }); return; }
    resetBoardState();
    setGameId(nextId);
    setHome(false);
    window.scrollTo({ top: 0 });
  }

  /**
   * Back to Home, from anywhere.
   *
   * The game is left exactly as it was -- `gameId` is not cleared -- so the
   * card for it is still on Home and going back in costs one press and no
   * reload. Only the per-board transients go, because they describe a board
   * nobody is looking at: the same reasoning as a game switch.
   */
  function goHome() {
    resetBoardState();
    setViewAs(null);
    setHome(true);
    window.scrollTo({ top: 0 });
  }

  // Into a team's screen from the console, and back out. The same per-board
  // state as a game switch is dropped, for the same reasons: none of it
  // belongs to the board being moved to.
  // Always in read only: acting is chosen on the team's screen, every time.
  function enterView(next) {
    resetBoardState();
    setPlaying(false);
    setViewAs({ ...next, acting: false });
    window.scrollTo({ top: 0 });
  }

  async function startActing() {
    if (!(await confirm(
      `Everything you press on ${viewAs.teamName}’s screen will really happen for that team: ` +
        'rolls, claims, shots, uploads and previews. It is recorded and announced under your ' +
        'own name, and it cannot be undone from here.',
      { title: `Act for ${viewAs.teamName}?`, confirmLabel: 'Act for this team', danger: true }
    ))) return;
    setViewAs((v) => (v ? { ...v, acting: true } : v));
  }

  function exitView() {
    resetBoardState();
    setViewAs(null);
  }

  function resetBoardState() {
    clearTimeout(resultRevealTimerRef.current);
    clearTimeout(resultHideTimerRef.current);
    setShot(null);
    setShotResult(null);
    setOpenTileId(null);
    setBusyTileId(null);
    setNotice(null);
    setPetPick(false);
    setPetPreview(null);
    setBoardTab('enemy');
  }

  const { loading, error, teams, myTeamId, myRole, tiles, myShipCells, myFleet, enemyShots, events, evidence, live } = game;
  // Which game this is. Everything below the waiting room is battleships unless
  // it says otherwise; a bingo hands the whole board area to BingoGame.
  const isBingo = game.game?.mode === 'bingo';
  const isSnakes = game.game?.mode === 'snakes';
  const isTerritory = game.game?.mode === 'territory';
  const isChallenge = game.game?.mode === 'challenge';
  // Everything written for battleships alone: the guide, its board, its slots.
  const isBattleships = Boolean(game.game)
    && !isBingo && !isSnakes && !isTerritory && !isChallenge;
  const guideMode = isSnakes ? 'snakes' : isTerritory ? 'territory' : 'battleships';
  // Matches the column's own default, set to 3 by migration 0031. It was 2
  // here long after the database moved, which is the kind of disagreement that
  // stays invisible until the one game whose column is somehow null renders a
  // board with a slot missing.
  const maxActive = game.game?.max_active_tiles ?? 3;
  // A parked tile is active but holds no slot: an organiser revoked the
  // submission that finished it, so the claim and its evidence survive and the
  // team has to lock it in again. Counting it here would say a team of three
  // was full when the database would happily give them a fourth.
  const activeCount = tiles.filter(
    (t) => t.claim_status === 'active' && !t.paused,
  ).length;
  const isActive = game.game?.status === 'active';
  // The database enum still calls this phase `placement`; the players call it
  // preparation. Renaming the value itself would break every guard that
  // compares against the string, so the rename is in the words, not the schema.
  const isPreparation = game.game?.status === 'placement';
  const isFinished = game.game?.status === 'finished';
  const canClaim = isActive && Boolean(myTeamId) && activeCount < maxActive;
  // PROTOTYPE: the short form of NextMove's title, for the tab-row label —
  // same three states, same wording, kept in sync with components/NextMove.jsx
  // by hand since the inline spot only ever wants the title, never the eyebrow
  // or the longer detail sentence.
  const nextMoveTitle = activeCount >= maxActive
    ? 'Finish an active tile'
    : activeCount > 0
      ? 'Continue an active tile, or claim another'
      : 'Claim a square in enemy waters';
  const myTeam = teams.find((t) => t.id === myTeamId) ?? null;
  // Derived rather than trusted: the last charge can be spent in another tab,
  // or the game can finish, while the mode is armed. Reading it from the count
  // means the board cannot be left offering a preview there is nothing to pay
  // for, without a second effect to switch it off.
  const petPicking = petPick && !isFinished && (myTeam?.pet_jar_count ?? 0) > 0;
  // Re-read from `tiles` so the panel's counts follow a refresh rather than
  // freezing at whatever they were when the square was pressed.
  const openTile = tiles.find((t) => t.id === openTileId && t.revealed) ?? null;

  return (
    <main className={`app game-app${!home && waitingScreen ? ' waiting-app' : ''}`}>
      <header className="top" id="app-header">
        {/* The wordmark is the way home, which is the web's own convention and
            costs no chrome. A real button, not a clickable <h1>, so it is
            reachable by keyboard and announced as what it is -- and never on
            Home itself, where it would lead nowhere.

            The subtitle still follows the game on screen; the console is every
            game, and Home is none of them. */}
        {home ? (
          <Wordmark mode={null} />
        ) : (
          <button type="button" className="home-link" onClick={goHome} aria-label="Home">
            <Wordmark mode={showBoard ? game.game?.mode ?? null : null} />
          </button>
        )}
        {/* THE GAME PICKER HAS MOVED. It used to live here as a <select>, and
            its job is Home's now, where there is room to say which game is
            running, which is finished, and which is an invitation rather than
            a game at all. What is left here is the name of the game you are
            in, and the one thing a header has to be able to shout. */}
        {(!isOrganiser || playingOwn) && !home && game.game && (
          <p className="status header-status">
            <strong>{game.game.name}</strong>
            {myTeamId && (
              ` — you play for ${teams.find((t) => t.id === myTeamId)?.name}`
            )}
            {/* Only when something is wrong. A board that is working says so by
                working, and a permanent green "live" badge is a light nobody
                reads until the day it matters — by which time it has been
                furniture for a week. */}
            {live === 'offline' && (
              <span className="live-warning" role="status">
                ⚠ Reconnecting — the board may be out of date
              </span>
            )}
          </p>
        )}
        <div className="who">
          <span className="name">{displayName || 'Signed in'}</span>
          {/* Beside the wordmark's silent version of the same thing: a
              clickable logo is a convention, not an instruction, and nobody
              should have to know it to find their way back. */}
          {!home && (
            <button className="link" onClick={goHome}>🏠 Home</button>
          )}
          {/* Only with a roster to go to, and never while a team is open --
              that has its own way out, and two ways back would be two. */}
          {canPlay && !viewing && (
            <button
              className="link"
              onClick={() => { resetBoardState(); setPlaying((v) => !v); window.scrollTo({ top: 0 }); }}
              aria-pressed={playingOwn}
            >
              {playingOwn ? '🛠 Back to the console' : '🎮 Play my game'}
            </button>
          )}
          {/* Beside the sign-out, not buried in the guide: the moment someone
              wants this is the moment a cannon has just gone off in an office,
              and it has to be reachable without reading anything. Outside the
              admin split — an organiser watching shots land has the same
              room to worry about. */}
          <button
            className="link sound-toggle"
            onClick={() => { const next = !muted; setMuted(next); writeMuted(next); }}
            aria-pressed={muted}
            title={muted ? 'Sound off — turn it on' : 'Sound on — turn it off'}
          >
            {muted ? '🔇' : '🔊'}
            <span className="sound-toggle-label">{muted ? 'Sound off' : 'Sound on'}</span>
          </button>
          {/* Battleships, Snakes and Territory have a guide; bingo and
              challenge have no written rules yet. */}
          {showBoard && !isBingo && !isChallenge && (
            <button className="link" onClick={() => guideRef.current?.openWelcome()}>
              📖 How to Play
            </button>
          )}
          {/* Players only: an organiser adds to the catalogue directly, and
              reviews these in the console's Suggestions pane. */}
          {!isOrganiser && (
            <button
              className="link"
              aria-pressed={suggesting}
              onClick={() => setSuggesting((on) => !on)}
            >
              {suggesting ? '← Back to the game' : '💡 Suggest a tile'}
            </button>
          )}
          {/* NO "My accounts" BUTTON. It sat here, beside Sign out, while the
              only way to the list was a button on the chrome. Home carries it
              now, and so does the challenge sign-up field -- which is the
              better of the two, because it stands next to the warning that
              says the name is not being found, rather than standing neutrally
              on four modes that never look a name up at all. */}
          <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>

      {accountsOpen && (
        <MyAccount profileId={uid} onClose={() => setAccountsOpen(false)} />
      )}

      {/* The rail and everything it points at, in one wrapper so the two can
          be a grid on a wide screen. Below 1100px the wrapper is
          `display: contents` and the page is exactly what it was. */}
      <div className="app-split">
      {!consoleScreen && (
        <SideNav
          atHome={home}
          gameName={inGame?.name ?? null}
          gameMode={inGame?.mode ?? null}
          onHome={goHome}
          // From Home, into the game. From the game, it is already the page
          // you are on, so it does what pressing the current item anywhere
          // does: takes you to the top of it.
          onGame={() => (home ? switchGame(gameId) : window.scrollTo({ top: 0 }))}
          onAccounts={() => setAccountsOpen(true)}
          onConsole={() => { setPlaying(false); setViewAs(null); setHome(false); window.scrollTo({ top: 0 }); }}
          isOrganiser={isOrganiser}
        />
      )}
      <div className="app-body">

      {home && (
        <Home
          games={myGames}
          onPick={switchGame}
          displayName={displayName}
          isOrganiser={isOrganiser}
          // The console is the screen Home replaced for an organiser, so it
          // needs a way back that is not a game card.
          onConsole={() => { setPlaying(false); setHome(false); window.scrollTo({ top: 0 }); }}
          onOpenAccounts={() => setAccountsOpen(true)}
        />
      )}

      {showBoard && !isBingo && !isChallenge && (
        <Guide
          ref={guideRef}
          // Re-mounted per mode, so a game switch never shows the other's steps.
          key={guideMode}
          mode={guideMode}
          // The countdown screen has no board to point at: show every step.
          waiting={waitingScreen}
          // Not over an organiser looking in: How to Play is one press away.
          autoShow={!viewing && !loading && Boolean(game.game) && !waitingScreen}
          onTabNeed={setBoardTab}
          // So the guide states this game's rules rather than the ones that
          // were true when it was written.
          maxActive={maxActive}
          status={game.game?.status}
        />
      )}

      {/* An admin has no team, so the player view would show them an empty
          board and a lock-in button that cannot work. They get the organiser's
          console instead -- and from it, any team's own screen, read only
          ("View as team"). The console stays mounted while one is open, only
          hidden, so coming back finds it on the game and pane it was left on. */}
      {isOrganiser && (
        <div hidden={viewing || playingOwn || home}>
          <Admin onViewAs={enterView} isAdmin={isAdmin} modes={modModes} />
        </div>
      )}

      {/* Outside the admin/player split on purpose: an admin has no team but
          still has the page open, and should hear a shot land same as
          anyone else. */}
      <FireEffect shot={shot} muted={muted} />

      {!home && !isOrganiser && suggesting && <TileSuggestions onClose={() => setSuggesting(false)} />}

      {/* Hidden, not unmounted, while suggesting: the game hooks above keep
          running either way, and the board should be exactly where it was —
          same tab, same open tile — when the player comes back to it. Only a
          real player can be suggesting; an organiser viewing a team has no
          button for it, so `suggesting` never hides their view. */}
      {showBoard && <div hidden={!isOrganiser && suggesting} className="game-body">
      {loading && <p>Loading game…</p>}
      {error && <p className="error">{error}</p>}
      {notice && <p className="error">{notice}</p>}

      {!loading && !game.game && <p>No game yet. An admin needs to create one.</p>}

      {waitingScreen && (
        <NoTeamWaiting
          gameName={game.game?.name}
          mode={game.game?.mode}
          startsAt={game.game?.starts_at}
          assigned={notYetOpen}
          teamName={myTeam?.name}
        />
      )}

      {game.game && !waitingScreen && isBingo && (
        <BingoGame
          game={game.game}
          teams={teams}
          myTeamId={myTeamId}
          myRole={myRole}
          tiles={tiles}
          standings={game.standings}
          events={events}
          evidence={evidence}
          onRefresh={game.refresh}
        />
      )}

      {game.game && !waitingScreen && isSnakes && (
        <SnakesGame
          game={game.game}
          teams={teams}
          myTeamId={myTeamId}
          myRole={myRole}
          tiles={tiles}
          standings={game.standings}
          jumps={game.jumps}
          events={events}
          evidence={evidence}
          onRefresh={game.refresh}
        />
      )}

      {game.game && !waitingScreen && isTerritory && (
        <TerritoryLive
          game={game.game}
          teams={teams}
          myTeamId={myTeamId}
          myRole={myRole}
          tiles={tiles}
          territory={game.territory}
          events={events}
          evidence={evidence}
          onRefresh={game.refresh}
        />
      )}

      {game.game && !waitingScreen && isChallenge && (
        <ChallengeGame
          game={game.game}
          teams={teams}
          events={events}
          profileId={session?.user?.id ?? null}
          onRefresh={game.refresh}
          // The sign-up card's way into My accounts: the moment a player
          // discovers the hiscores are not finding them is the moment they
          // want to fix the name for good, not just for this event.
          onOpenAccounts={() => setAccountsOpen(true)}
        />
      )}

      {game.game && !waitingScreen && isBattleships && (
        <>
          {/* The name/status/team line and its "reconnecting" warning moved up
              into the sticky header (#app-header). */}

          {game.game.status === 'finished' && (
            <p className="banner">
              {teams.find((t) => t.id === game.game.winner_team_id)?.name} wins.
            </p>
          )}

          {/* Placement can happen well ahead of the scheduled time, but the
              time itself is still worth a captain keeping an eye on while
              arranging ships — it says nothing changes if it runs out. */}
          {isPreparation && myTeamId && (
            <StartTimeBadge startsAt={game.game.starts_at} mode={game.game.mode} />
          )}

          {/* Prep only, and first: naming the team is the opening move, and
              once the game starts the name is settled. An admin can still
              rename either team from the console if one has to be fixed
              mid-event — rename_team itself has no phase guard. */}
          {isPreparation && myRole === 'captain' && myTeam && (
            <section className="card">
              <h2>Your team</h2>
              <TeamNameEditor team={myTeam} onRenamed={() => game.refresh()} />
            </section>
          )}

          {isPreparation && myTeamId && (
            <CaptainPlacement
              isCaptain={myRole === 'captain'}
              teamId={myTeamId}
              teamName={myTeam?.name ?? 'your'}
              fleet={game.game.fleet}
              shipsPlaced={myFleet.length}
              onPlaced={() => game.refresh()}
            />
          )}

          {/* No board layout to sit beside yet, so full width same as always.
              Once the boards appear the feed moves into the left column. */}
          {isPreparation && <EventFeed events={events} teams={teams} myTeamId={myTeamId} />}

          {/* Nothing here means anything until the game starts: there is no
              enemy to shoot at, your own fleet is the thing you are still
              arranging above, and no tile can be locked in yet. Showing all
              three during preparation left the placement board sharing the
              screen with two boards that could only say "not yet", and pushed
              the one thing a captain has to do off the top. */}
          {!isPreparation && (
          <>
          {/* PROTOTYPE: the live prompt (claim / continue / finish) moved into
              the tab row below as a one-line label — see .next-move-tab. The
              full card stays only for "finished", which the tab-row label
              doesn't cover and which already reads as an event, not an
              ongoing prompt. */}
          {isFinished && (
            <NextMove
              activeCount={activeCount}
              maxActive={maxActive}
              canClaim={canClaim}
              isFinished={isFinished}
            />
          )}
          <section className="boards">
            <div className="board-layout">
              {/* Stats sit above the activity feed in the same left-hand
                  column: read-only context first, then the scrolling log
                  underneath it, height-capped so a long game doesn't grow
                  the page underneath it. */}
              <div className="feed-col">
                <StatsPanel gameId={gameId} teams={teams} myTeamId={myTeamId} />
                <EventFeed events={events} teams={teams} myTeamId={myTeamId} />
              </div>

              <div className="board-col">
                {/* The same tab strip the admin console uses, so this reads as
                    part of the app rather than a second idea about tabs. */}
                <div className="tabs board-tabs" id="board-tabs-row">
                  <button
                    className={boardTab === 'enemy' ? 'on' : ''}
                    onClick={() => setBoardTab('enemy')}
                  >
                    Enemy waters
                  </button>
                  <button
                    className={boardTab === 'fleet' ? 'on' : ''}
                    onClick={() => setBoardTab('fleet')}
                  >
                    Your fleet
                  </button>
                  {!isFinished && (
                    <span className="next-move-tab">{nextMoveTitle}</span>
                  )}
                </div>

                {boardTab === 'enemy' ? (
                  <div id="enemy-board-section">
                    <EnemyGrid
                      tiles={tiles}
                      onClaim={onClaim}
                      onInspect={(tile) =>
                        setOpenTileId((id) => (id === tile.id ? null : tile.id))}
                      openTileId={openTileId}
                      canClaim={canClaim}
                      busyTileId={busyTileId}
                      shotResult={shotResult}
                      petPick={petPicking}
                      onPetPick={onPetPick}
                    />
                    <BoardLegend view="enemy" />
                    {openTile && (
                      <EvidencePanel
                        title={openTile.name}
                        coord={coordLabel(
                          fromPosition(openTile.position).row,
                          fromPosition(openTile.position).col
                        )}
                        meta={
                          tileProgressText(openTile) +
                          (openTile.claim_status === 'fired'
                            ? ` · fired, ${openTile.claim_result}` +
                              (openTile.ship_sunk ? ' — ship sunk!' : '')
                            : openTile.paused
                              ? ' · unlocked by an organiser — lock it in again'
                              : ' · not yet fired')
                        }
                        items={evidence.filter((e) => e.claim_id === openTile.claim_id)}
                        onClose={() => setOpenTileId(null)}
                      />
                    )}
                  </div>
                ) : (
                  <div id="fleet-board-section">
                    <MyFleet
                      myShipCells={myShipCells}
                      enemyShots={enemyShots}
                      tiles={tiles}
                    />
                    <BoardLegend view="fleet" />
                  </div>
                )}
              </div>

              {/* The two slots are what a player checks and acts on most
                  often mid-game, so they sit at the very top of the column
                  beside the board rather than under the score. */}
              <div className="side-col">
                {/* Hidden once the game is finished. The slots carry working
                    upload controls, and a submit that completes a tile fires
                    the shot — so leaving them on screen after a result
                    invited a team to finish a tile it was still working on
                    and fire into a match that was already decided. 0027
                    refuses that server-side; this stops the page offering it
                    in the first place. */}
                {!isFinished && (
                  <ActiveTiles
                    tiles={tiles}
                    maxActive={maxActive}
                    gameId={gameId}
                    teamId={myTeamId}
                    onRefresh={() => game.refresh()}
                    onFired={(tile, result) => {
                      // Sound/animation come from the realtime subscription
                      // above, not from here — but this client already knows
                      // the result, so an un-delayed refresh would color the
                      // tile and show its result before its own gif/sound had
                      // even started. Wait out the same beat everyone else's
                      // realtime-triggered reveal does.
                      clearTimeout(resultRevealTimerRef.current);
                      clearTimeout(resultHideTimerRef.current);
                      setShotResult(null);
                      resultRevealTimerRef.current = setTimeout(() => {
                        // A shot can be submitted while "Your fleet" is open.
                        // Bring its destination into view so the local result
                        // is never hidden on the other board tab.
                        setBoardTab('enemy');
                        setShotResult({ tileId: tile.id, result, nonce: Date.now() });
                        game.refresh();
                        resultHideTimerRef.current = setTimeout(
                          () => setShotResult(null),
                          SHOT_RESULT_DURATION_MS
                        );
                      }, REVEAL_DELAY_MS);
                    }}
                  />
                )}

                {!isFinished && myTeamId && (
                  <PetJar
                    gameId={gameId}
                    teamId={myTeamId}
                    count={myTeam?.pet_jar_count ?? 0}
                    tiles={tiles}
                    onRefresh={() => game.refresh()}
                    pickMode={petPicking}
                    // Turning the mode on brings the board it applies to into
                    // view: the button is in the side column, which is on
                    // screen next to either board tab.
                    onPickMode={(on) => { setPetPick(on); if (on) setBoardTab('enemy'); }}
                    preview={petPreview}
                    onDismissPreview={() => setPetPreview(null)}
                  />
                )}
              </div>
            </div>
          </section>
          </>
          )}
        </>
      )}
      {game.game && !waitingScreen && (
        <footer className="player-credits">
          <span>
            High Society platform created by{' '}
            <span className="credit-creator">BludgenMaker</span>{' '}
            and{' '}
            <span className="credit-creator">Soft Papi</span>
          </span>
          <a className="credit-star" href={REPO_URL} target="_blank" rel="noreferrer">
            <span aria-hidden="true">★</span>
            Star on GitHub
          </a>
        </footer>
      )}
      {/* Last, so it can ride along the bottom of the window (styles.css). */}
      {/* On a phone it is one line -- who, read only or acting, More, Back --
          with the other buttons behind More, so it does not cover a third of
          the screen it is there to show (styles.css, .view-as-banner). */}
      {viewing && (
        <div
          className={`view-as-banner${acting ? ' acting' : ''}${viewMore ? ' more-open' : ''}`}
          role="status"
        >
          <p className="view-as-text">
            {acting ? (
              <>
                <span aria-hidden="true">⚠ </span>
                <span className="view-as-long">
                  Acting for <b>{viewAs.teamName}</b> as {viewAs.role === 'captain' ? 'their captain' : 'a player'}.
                  {' '}Everything you press here really happens, under your name.
                </span>
                <span className="view-as-short">
                  Acting for <b>{viewAs.teamName}</b> — presses are real
                </span>
              </>
            ) : (
              <>
                <span aria-hidden="true">👁 </span>
                <span className="view-as-long">
                  Viewing <b>{viewAs.teamName}</b>’s screen as {viewAs.role === 'captain' ? 'their captain' : 'a player'}.
                  {' '}Read only: nothing you press here changes the game.
                </span>
                <span className="view-as-short">
                  <b>{viewAs.teamName}</b> as {viewAs.role === 'captain' ? 'captain' : 'player'} · read only
                </span>
              </>
            )}
            {live === 'offline' && <span className="live-warning"> ⚠ Reconnecting</span>}
          </p>
          <div className="view-as-actions">
            <div className="view-as-secondary">
              <button
                className="ghost"
                onClick={() => setViewAs((v) => ({ ...v, role: v.role === 'captain' ? 'member' : 'captain' }))}
              >
                {viewAs.role === 'captain' ? 'See it as a player' : 'See it as the captain'}
              </button>
              {ACTING_ENABLED && (acting ? (
                <button className="ghost" onClick={() => setViewAs((v) => ({ ...v, acting: false }))}>
                  Stop acting
                </button>
              ) : (
                <button className="danger" onClick={startActing}>Act for {viewAs.teamName}</button>
              ))}
            </div>
            <button
              className="ghost view-as-more"
              aria-expanded={viewMore}
              onClick={() => setViewMore((open) => !open)}
            >
              {viewMore ? 'Less' : 'More'}
            </button>
            <button className="primary" onClick={() => { setViewMore(false); exitView(); }}>
              <span className="view-as-long">Back to the console</span>
              <span className="view-as-short">Back</span>
            </button>
          </div>
        </div>
      )}
      </div>}

      {/* Last in the tree and fixed-position, so it sits over whichever view is
          on screen — the admin console included. */}
      </div>
      </div>

      {confirmDialog}
    </main>
  );
}
