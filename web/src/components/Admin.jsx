import { useCallback, useEffect, useRef, useState } from 'react';
import {
  supabase, startGame,
  adminCreateGame, adminSetMember, adminRemoveMember,
  adminOpenPlacement, adminSetStartTime, adminSetFeaturedGame, adminListTiles, adminDeleteGame, adminResetGame,
  adminDeleteAccount,
  adminListShipCells, adminListWebhooks,
  adminListLibrary, adminSaveLibraryTile, adminDeleteLibraryTile,
  adminSetTile, adminClearTile, adminSwapTiles, adminAutofillBoard, adminShuffleBoard,
  adminClearBoard, adminGameReadiness, adminResetPassword, adminListPasswordResets,
  adminListAccountDeletions,
  adminListModerators,
  adminSetModeratorModes,
  adminSaveBoardPreset, adminApplyBoardPreset, adminDeleteBoardPreset,
  adminNewGame, adminAddTeam, adminDeleteTeam, adminSetEndTime, adminEndGame,
  listBoardJumps, adminSetSnakes, adminSetTerritoryHomes, snakesStandings, adminSnakesEndGame,
  territoryStandings,
  adminListTileSubmissions, adminAcceptTileSubmission, adminRefuseTileSubmission,
  adminNewChallenge, adminChallengeEntries, adminChallengeSetFigure,
  adminChallengeVerify, adminChallengeSetTeam, adminChallengeWom,
  adminChallengeWomLink, adminChallengeWomRetry,
  challengeStart, challengeList,
  challengeStandings, womPulse,
} from '../lib/supabase.js';
import { LAST_TILE, isLadder } from '../lib/snakes.js';
import { TASK_GRID, homesProblem, placePosition, teamHomes } from '../lib/territory.js';
import TerritoryHomes from './territory/TerritoryHomes.jsx';
import TerritoryAdminTrack from './territory/TerritoryAdminTrack.jsx';
import SnakesJumpEditor from './snakes/SnakesJumpEditor.jsx';
import useJumpDraft from './snakes/useJumpDraft.js';
import SnakesAdminTrack from './snakes/SnakesAdminTrack.jsx';
import ChallengeNewGame from './challenge/ChallengeNewGame.jsx';
import ChallengeEntries from './challenge/ChallengeEntries.jsx';
import ChallengeLadder from './challenge/ChallengeLadder.jsx';
import ChallengeWom from './challenge/ChallengeWom.jsx';
import BoardBuilder from './BoardBuilder.jsx';
import AdminOverview from './AdminOverview.jsx';
import BingoOverview from './bingo/BingoOverview.jsx';
import TeamNameEditor from './TeamNameEditor.jsx';
import EvidenceReview from './EvidenceReview.jsx';
import PetJarReview from './PetJarReview.jsx';
import DiscordWebhooks from './DiscordWebhooks.jsx';
import PasswordResetDialog from './PasswordResetDialog.jsx';
import CardHead from './CardHead.jsx';
import { Pick, PickChip, PickSet } from './Pick.jsx';
import TileSuggestionReview from './TileSuggestionReview.jsx';
import { useConfirm } from './ConfirmDialog.jsx';
import { statusLabel } from '../lib/status.js';

// What to do next, in the order the checklist below lists it. The `setup` line
// used to say only "add the 100 tiles", which is why games reached Start Game
// with no roster: the hint was the whole instruction manual, and it named one
// of the four things that have to happen.
const STEP_HINT = {
  setup:     'Add the tiles and the roster, give each team a captain, then open preparation.',
  // Only a captain can place a fleet from the UI. place_fleet still accepts an
  // admin (0006), but the screen that used it — AdminBoards — is gone, and
  // AdminOverview is read-only. So the way past an absent captain is to hand
  // the role to someone who is there, not to do it for them.
  placement: 'Each team’s captain places their fleet, then start the game. '
           + 'If a captain is unavailable, pass the role to another player in Roster.',
  active:    'The game is running.',
  finished:  'This game is over.',
};

// Bingo has no fleets and no captains to wait on, so it can start straight
// from setup. Preparation still exists for it — it is where players can see
// their team and a countdown before the card is revealed — but it is optional.
const BINGO_STEP_HINT = {
  setup:     'Fill the card and add players to every team, then start — or open '
           + 'preparation first so players can see their team before the card is revealed.',
  placement: 'Players can see their team and the countdown. Start the game to reveal the card.',
  active:    'The bingo is running. It ends when a team fills the card, or when the end time passes.',
  finished:  'This bingo is over.',
};

// Snakes and Ladders starts like bingo -- no fleets, preparation optional --
// and asks for a tile on every square but the snake heads and ladder feet.
const SNAKES_STEP_HINT = {
  setup:     'Place the snakes and ladders, fill the board and add players to every team, then start — '
           + 'or open preparation first so players can see their team before the board is revealed.',
  placement: 'Players can see their team and the countdown. Start the game to reveal the board and open the first roll.',
  active:    'The race is running. It ends when a team completes tile 100, or when you end it.',
  finished:  'This race is over.',
};

// Territory: Risk on the OSRS map. Every place but the homes needs a task, and
// those tasks are an 8x8 card (lib/territory.js), so the board is built, dealt
// and saved exactly as a bingo card is. It starts empty.
const TERRITORY_STEP_HINT = {
  setup:     'Give every place a task — deal them at random, load a saved board or pick them one by one — '
           + 'and add players to every team, then start.',
  placement: 'Players can see their team, their home and the countdown. Start the game to open the map.',
  active:    'The conquest is running. It ends when the end time passes, or when you end it.',
  finished:  'This conquest is over.',
};

// A challenge has no board to fill and no fleet to wait on, so the only thing
// between creating one and starting it is people signing up -- which is theirs
// to do, not the organiser's.
const CHALLENGE_STEP_HINT = {
  setup:     'Sign-ups are open. Share it, wait for entrants, then start — starting closes sign-ups '
           + 'and creates the Wise Old Man competition.',
  placement: 'Sign-ups are open. Start the event when enough people are in.',
  active:    'The event is running. Check the numbers and the screenshots behind them in Track.',
  finished:  'This event is over.',
};

const isBingoGame = (g) => g?.mode === 'bingo';
const isSnakesGame = (g) => g?.mode === 'snakes';
const isTerritoryGame = (g) => g?.mode === 'territory';
const isChallengeGame = (g) => g?.mode === 'challenge';
const NO_JUMPS = [];
// Same reason as NO_JUMPS: a fresh [] every render would be a new
// dependency every render, and loadGames below is keyed on it.
const NO_MODES = [];

/**
 * What `run` resolves to when the action was refused.
 *
 * A symbol rather than false or null: an action that succeeded may resolve to
 * either of those, and confusing the two is how a failed save comes to look
 * like a successful one.
 */
const FAILED = Symbol('admin action failed');
const worked = (result) => result !== FAILED;

/**
 * What `run` re-reads when the caller does not say.
 *
 * Everything, deliberately: a caller that has not thought about it gets the
 * behaviour the console had before scoping existed, so forgetting to name a
 * slice costs a few queries rather than leaving a stale checklist on screen.
 * `tiles` is absent because `detail` already covers it.
 */
const ALL_SLICES = ['games', 'detail', 'library', 'challenge'];

/**
 * What a deal from the catalogue could not do, appended to whatever the caller
 * says it did.
 *
 * Shared by the two deals -- the autofill that fills the gaps and the re-deal
 * that replaces the board -- because both have the same thing to admit. A
 * catalogue too small for the board leaves squares empty, and a shuffle that
 * reports only its successes leaves you to find that out by counting a hundred
 * squares.
 */
/**
 * What still stands between a game and Start, named rather than counted.
 *
 * The same requirements the checklist inside the game enforces, and
 * deliberately a second implementation of them: this one has counts, not rows,
 * because reading every board's tiles to draw a list of games is the shape the
 * console was just taken off. The checklist stays the authority — it can say
 * *which* team has no captain, and this only says that one does not.
 *
 * Empty for a game already running or finished, where there is nothing left to
 * get ready and six ticks would just be noise on a list.
 *
 * Empty too when the counts are missing — a console whose migration has not
 * landed shows no badges rather than accusing every game of having no tiles.
 */
function readinessGaps(game, counts, teams, members, jumps = NO_JUMPS) {
  if (!game || game.status === 'active' || game.status === 'finished') return [];

  const gaps = [];
  const gameTeams = teams.filter((t) => t.game_id === game.id);

  // Snakes: the squares under a snake head or a ladder's foot need no task.
  // A count, not positions, so a task left on one of those squares can make
  // this look one better than it is -- the checklist inside the game counts
  // properly.
  if (isSnakesGame(game)) {
    const need = LAST_TILE - jumps.length;
    if (counts && counts.tile_count < need) gaps.push(`${need - counts.tile_count} more tiles`);
    if (gameTeams.length === 0) gaps.push('a team');
    if (gameTeams.some((t) => !members.some((m) => m.team_id === t.id))) gaps.push('players');
    return gaps;
  }

  if (isTerritoryGame(game)) {
    const need = TASK_GRID * TASK_GRID - gameTeams.length;
    if (counts && counts.tile_count < need) gaps.push(`${need - counts.tile_count} more tasks`);
    if (gameTeams.length && homesProblem(teamHomes(gameTeams))) gaps.push('homes');
    if (gameTeams.length === 0) gaps.push('a team');
    if (gameTeams.some((t) => !members.some((m) => m.team_id === t.id))) gaps.push('players');
    return gaps;
  }

  if (counts && counts.tile_count < counts.tiles_needed) {
    gaps.push(`${counts.tiles_needed - counts.tile_count} more tiles`);
  }
  // Bingo: any number of teams, no captains, no fleets — players are the only
  // other thing start_game insists on.
  if (isBingoGame(game)) {
    if (gameTeams.length === 0) gaps.push('a team');
    if (gameTeams.some((t) => !members.some((m) => m.team_id === t.id))) gaps.push('players');
    return gaps;
  }
  if (gameTeams.length !== 2) gaps.push('two teams');
  if (gameTeams.some((t) => !members.some((m) => m.team_id === t.id && m.role === 'captain'))) {
    gaps.push('a captain');
  }
  if (gameTeams.some((t) => !members.some((m) => m.team_id === t.id))) gaps.push('players');
  // Fleets are only a gap once there is a phase in which to place them; during
  // setup the captains cannot have done it yet, so saying so would be listing
  // the future as a problem.
  if (game.status === 'placement' && counts
      && counts.teams_with_full_fleet < gameTeams.length) {
    gaps.push('fleets');
  }
  return gaps;
}

function dealShortfall(r) {
  const short = r.empty - r.filled;
  return (short > 0
    ? ` ${short} left empty — the catalogue has ${r.pool} tile${r.pool === 1 ? '' : 's'} this board can still use.`
    : '')
    + (r.similar > 0
      ? ` ${r.similar} of them repeat a task already on the board, which is what it took to fill it.`
      : '');
}

// isAdmin and modes come from App: an admin gets the whole console, a
// moderator the games of the modes they run. Hiding a pane is a courtesy,
// not a lock -- the database refuses the call either way.
export default function Admin({ onViewAs, isAdmin = true, modes = NO_MODES } = {}) {
  const [games, setGames] = useState([]);
  const [teams, setTeams] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [members, setMembers] = useState([]);
  const [tiles, setTiles] = useState([]);
  // The tile catalogue. Loaded once for the whole console rather than per game:
  // it belongs to no game, and the builder is the only thing that reads it.
  const [library, setLibrary] = useState([]);
  const [libraryError, setLibraryError] = useState(null);
  // Tiles players have suggested for the catalogue. Like the catalogue, it
  // belongs to no game, and it is loaded on mount so the nav badge can say how
  // many are waiting before anyone opens the pane.
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsError, setSuggestionsError] = useState(null);
  const [shipCells, setShipCells] = useState([]);
  const [webhooks, setWebhooks] = useState([]);
  // Per-game counts for the Games list badges, keyed by game id. Fails soft:
  // the badge is a convenience and the checklist inside each game is the
  // authority, so a missing function leaves the list exactly as it was rather
  // than putting a red line above it.
  const [readiness, setReadiness] = useState({});
  // Every game's snakes and ladders, keyed by game id. board_jumps is a small
  // public table, so one read covers the Games list and the open game alike.
  const [jumpsByGame, setJumpsByGame] = useState({});
  // Every challenge's setup row -- solo or teams, which figures it collects,
  // which one ranks -- keyed by game id. challenge_list is the only call that
  // carries it (challenge_setup has RLS on and no policies at all) and it
  // answers for every event this organiser runs, so one read covers the Games
  // list and the open event alike.
  const [challengeSetups, setChallengeSetups] = useState({});
  // The open event's entrants, with their figures and the shots behind them,
  // and the ladder those figures make.
  const [challengeEntries, setChallengeEntries] = useState([]);
  const [challengeWom, setChallengeWom] = useState(null);
  const [challengeLadder, setChallengeLadder] = useState([]);
  // Loaded only once the Accounts pane is opened: nobody else on the console
  // needs to know who has ever had their password reset or account deleted.
  const [passwordResets, setPasswordResets] = useState([]);
  const [accountDeletions, setAccountDeletions] = useState([]);
  const [moderators, setModerators] = useState([]);
  const [gameId, setGameId] = useState(null);
  // Which section is on screen. The console used to be one long scroll of eight
  // cards, so finding Roster meant paging past the whole board overview.
  const [pane, setPane] = useState('games');
  // Configure's sub-tab per game id (see CONFIG_TABS), so coming back to a
  // game opens where you were working on it.
  const [configTabs, setConfigTabs] = useState(() => readTabMemory(CONFIG_TABS_KEY));
  const [trackTabs, setTrackTabs] = useState(() => readTabMemory(TRACK_TABS_KEY));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirm, confirmDialog] = useConfirm();
  const errorRef = useRef(null);

  // Scrolled to whenever a new one arrives, not merely when one is on screen —
  // two refusals in a row should still take you to the message.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [error]);

  const game = games.find((g) => g.id === gameId) ?? null;
  const gameTeams = teams.filter((t) => t.game_id === gameId);
  const jumps = jumpsByGame[gameId] ?? NO_JUMPS;
  // The unsaved snakes and ladders, shared by the Snakes and ladders card
  // (typed as a list) and the board builder (dragged on the board).
  const jumpEdit = useJumpDraft(isSnakesGame(game) ? game : null, jumps);

  const loadGames = useCallback(async () => {
    const [{ data: g }, { data: t }, { data: p }, { data: m }] = await Promise.all([
      supabase.from('games').select('*').order('created_at', { ascending: false }),
      // Creation slot: team one (the first name typed into New game) is always
      // the left board, team two always the right, and a rename never moves
      // either. See 0044 for why neither created_at nor id could answer this -
      // both teams are inserted in one statement and share a timestamp, so
      // ordering by it was ordering by a tie. This query had no order at all
      // before, which left the boards, the roster columns and the "A vs B"
      // line to whatever Postgres happened to return.
      supabase.from('teams').select('*').order('slot'),
      supabase.from('profiles').select('id, display_name, is_admin').order('display_name'),
      supabase.from('team_members').select('team_id, profile_id, role'),
    ]);
    // A moderator sees only the modes they run. Hidden rather than greyed
    // out, so the Games list is the list of games they can work on.
    setGames((g ?? []).filter((x) => isAdmin || modes.includes(x.mode)));
    setTeams(t ?? []);
    setProfiles(p ?? []);
    setMembers(m ?? []);

    // Alongside, not before: the list must not wait on the badges, and a
    // console that has not had the migration cannot be a console that refuses
    // to draw. The checklist inside each game is the authority either way.
    try {
      const counts = await adminGameReadiness();
      setReadiness(Object.fromEntries((counts ?? []).map((r) => [r.game_id, r])));
    } catch {
      setReadiness({});
    }

    try {
      const byGame = {};
      for (const j of await listBoardJumps()) {
        (byGame[j.game_id] ??= []).push({ from: j.from_tile, to: j.to_tile });
      }
      setJumpsByGame(byGame);
    } catch {
      setJumpsByGame({});
    }

    // Fails soft like the rest: a console ahead of its migration draws the
    // Games list it drew yesterday rather than a red line above it.
    try {
      const list = await challengeList();
      setChallengeSetups(Object.fromEntries((list ?? []).map((c) => [c.game_id, c])));
    } catch {
      setChallengeSetups({});
    }
    // Keyed on the role: App resolves is_admin and the moderator modes in two
    // separate calls, so whichever lands second must re-filter the list.
  }, [isAdmin, modes]);

  /**
   * The tiles alone.
   *
   * Split out of loadGameDetail because the board builder writes one square
   * per click, and a hundred squares is an evening: every one of those clicks
   * used to refetch the games list, the teams, every profile, the roster, the
   * tiles, both fleets, the webhooks and the whole catalogue — nine queries to
   * learn one square changed. Fleets and webhooks cannot change by placing a
   * tile, so this is the whole of what a placement needs to re-read.
   */
  const loadTiles = useCallback(async (id) => {
    if (!id) { setTiles([]); return; }
    try {
      setTiles((await adminListTiles(id)) ?? []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  /**
   * The open event's entrants and ladder, when it is a challenge.
   *
   * Its own read rather than another branch of loadGameDetail: that function
   * fetches tiles, fleets and webhooks, and a challenge has none of the first
   * two. The mode is passed in rather than looked up so this stays keyed on
   * nothing -- it is called from `run`, which must not be rebuilt every time
   * the games list changes.
   */
  const loadChallenge = useCallback(async (id, mode) => {
    if (!id || mode !== 'challenge') {
      setChallengeEntries([]); setChallengeLadder([]); setChallengeWom(null); return;
    }
    try {
      // Without the reveal flag, so the verification code is not in this
      // payload at all -- the card asks for it on a click.
      const [entries, rows, wom] = await Promise.all([
        adminChallengeEntries(id),
        challengeStandings(id),
        adminChallengeWom(id),
      ]);
      setChallengeEntries(entries ?? []);
      setChallengeLadder(rows ?? []);
      setChallengeWom(wom ?? null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const loadGameDetail = useCallback(async (id) => {
    if (!id) { setTiles([]); setShipCells([]); setWebhooks([]); return; }
    try {
      // Fleets and webhooks are fetched here, not left to the panels that show
      // them, because the checklist has to answer "is this ready to start"
      // before the organiser has scrolled as far as either panel.
      const [t, ships, hooks] = await Promise.all([
        adminListTiles(id),
        adminListShipCells(id),
        adminListWebhooks(id),
      ]);
      setTiles(t ?? []);
      setShipCells(ships ?? []);
      setWebhooks(hooks ?? []);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  /**
   * The catalogue, reported into the builder rather than across the console.
   *
   * It loads on mount, before a game is even open, so a failure here used to
   * greet every admin with a red line above the Games list — about a panel that
   * is three sections further down and has nothing to do with what they came to
   * do. Worse, the most likely failure is the one that says nothing useful to
   * anyone but a developer: `admin_list_library` not existing yet, because the
   * migration that creates it has not been pushed.
   *
   * So it fails soft. Everything else on the console keeps working, and the
   * builder says what is wrong in the place the answer matters.
   */
  const loadLibrary = useCallback(async () => {
    try {
      setLibrary((await adminListLibrary()) ?? []);
      setLibraryError(null);
    } catch (err) {
      setLibrary([]);
      setLibraryError(err.message);
    }
  }, []);

  // Fails soft, for the same reason as the catalogue: a console whose database
  // has not had the migration yet must still draw, and says so in the pane.
  const loadSuggestions = useCallback(async () => {
    try {
      setSuggestions((await adminListTileSubmissions()) ?? []);
      setSuggestionsError(null);
    } catch (err) {
      setSuggestions([]);
      setSuggestionsError(err.message);
    }
  }, []);

  const loadPasswordResets = useCallback(async () => {
    try {
      setPasswordResets((await adminListPasswordResets()) ?? []);
    } catch {
      // Not loaded yet, or the migration hasn't landed — the disclosure below
      // just stays empty rather than putting a red line above the account list.
      setPasswordResets([]);
    }
  }, []);

  const loadAccountDeletions = useCallback(async () => {
    try {
      setAccountDeletions((await adminListAccountDeletions()) ?? []);
    } catch {
      setAccountDeletions([]);
    }
  }, []);

  const loadModerators = useCallback(async () => {
    try {
      setModerators((await adminListModerators()) ?? []);
    } catch {
      setModerators([]);
    }
  }, []);

  useEffect(() => { loadGames(); }, [loadGames]);
  useEffect(() => { loadGameDetail(gameId); }, [gameId, loadGameDetail]);
  useEffect(() => { loadChallenge(gameId, game?.mode); }, [gameId, game?.mode, loadChallenge]);
  useEffect(() => { loadLibrary(); }, [loadLibrary]);
  useEffect(() => { loadSuggestions(); }, [loadSuggestions]);
  useEffect(() => { if (isAdmin) loadModerators(); }, [isAdmin, loadModerators]);

  // Suggestions write no game_event, so nothing pushes them here. Re-reading
  // when the tab comes back is how a new one reaches the badge.
  useEffect(() => {
    const recheck = () => { if (!document.hidden) loadSuggestions(); };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [loadSuggestions]);

  // Team renames can originate from a captain's screen. They emit an event so
  // the organiser's labels update without a manual refresh.
  useEffect(() => {
    if (!gameId) return;
    const channel = supabase
      .channel(`admin-game:${gameId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'game_events', filter: `game_id=eq.${gameId}` },
        () => { loadGames(); loadGameDetail(gameId); }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [gameId, loadGames, loadGameDetail]);

  // The subscription above only hears game_events. Roster changes and tile
  // edits write none, so a second organiser working in another browser leaves
  // this checklist showing a game that is more ready than it looks. Re-reading
  // when the tab comes back covers it, the same way the player board does.
  useEffect(() => {
    const recheck = () => {
      if (document.hidden) return;
      loadGames();
      loadGameDetail(gameId);
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [gameId, loadGames, loadGameDetail]);

  /**
   * Run one admin action, refresh what it could have changed, and report.
   *
   * Returns FAILED — not `undefined` — when the action threw. Several actions
   * legitimately resolve to nothing, so `undefined` cannot mean "it did not
   * work", and every caller that closes a form or moves on afterwards has to be
   * able to tell the two apart. It used to swallow the error and resolve, which
   * meant a refused save looked exactly like a successful one: the form closed,
   * the builder advanced to the next square, and the only sign of trouble was a
   * red line at the top of a pane you had scrolled a long way down.
   */
  async function run(fn, okMessage, { refresh = ALL_SLICES } = {}) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await fn();
      const want = new Set(refresh);
      // In parallel, and only what the action could have changed. These were
      // three sequential awaits of everything, which was the honest thing to
      // write when the console was a handful of presses per event: working
      // out which action invalidated what is exactly the reasoning that goes
      // stale and starts showing an organiser a game more ready than it is.
      //
      // The board builder is what made it untenable — one write per square,
      // a hundred squares, nine queries each. So the choice is now the call
      // site's, and the default is still everything: a caller that says
      // nothing gets the old behaviour, which keeps the failure mode
      // "refreshed more than it needed" rather than "quietly out of date".
      await Promise.all([
        want.has('games') ? loadGames() : null,
        want.has('detail') ? loadGameDetail(gameId) : null,
        // 'detail' already re-reads the tiles; asking for both is a duplicate
        // query, not a second opinion.
        want.has('tiles') && !want.has('detail') ? loadTiles(gameId) : null,
        want.has('challenge') ? loadChallenge(gameId, game?.mode) : null,
        want.has('library') ? loadLibrary() : null,
        want.has('suggestions') ? loadSuggestions() : null,
      ].filter(Boolean));
      if (okMessage) setNotice(typeof okMessage === 'function' ? okMessage(result) : okMessage);
      return result;
    } catch (err) {
      setError(err.message);
      return FAILED;
    } finally {
      setBusy(false);
    }
  }

  // What still has to happen before this game can run.
  //
  // Every `required` row here restates a guard that start_game already enforces
  // in the database (0026, and captains in 0043). The duplication is the point:
  // the database refuses a broken game, but it refuses it at the last click,
  // in the words of a Postgres exception. This says the same thing up front,
  // while there is still something obvious to do about it.
  const needTiles = game ? game.grid_size * game.grid_size : 0;
  const fleetSize = game?.fleet?.length ?? 0;
  const teamsWithoutCaptain = gameTeams.filter(
    (t) => !members.some((m) => m.team_id === t.id && m.role === 'captain')
  );
  const teamsWithoutFleet = gameTeams.filter(
    (t) => new Set(shipCells.filter((c) => c.team_id === t.id).map((c) => c.ship_id)).size !== fleetSize
  );
  const rosterCount = members.filter((m) => gameTeams.some((t) => t.id === m.team_id)).length;
  const bingo = isBingoGame(game);
  const snakesMode = isSnakesGame(game);
  const territoryMode = isTerritoryGame(game);
  const challengeMode = isChallengeGame(game);
  const challengeSetup = game ? challengeSetups[game.id] ?? null : null;
  // Each team's home: the one the organiser picked, or the suggestion for its
  // slot until they do. A home needs no task, like a snake's head.
  const homes = territoryMode ? teamHomes(gameTeams) : null;
  const homesIssue = homes ? homesProblem(homes, (id) => gameTeams.find((t) => t.id === id)?.name) : null;
  const saveJumps = (draft) => run(
    () => adminSetSnakes(game.id, draft),
    (n) => `${n} snake${n === 1 ? '' : 's'} and ladder${n === 1 ? '' : 's'} saved.`,
    { refresh: ['games'] }
  );
  // Bingo and snakes share everything about teams and starting: any number of
  // teams, no captains or fleets to wait on, preparation optional.
  const cardLike = bingo || snakesMode || territoryMode;
  const teamsWithoutPlayers = gameTeams.filter((t) => !members.some((m) => m.team_id === t.id));

  // Bingo's list is shorter because start_game asks less of it: a full card,
  // at least one team, and somebody on every team. Captains are still useful
  // (they can rename their team) but nothing waits on them.
  const cardChecks = game ? [
    {
      key: 'tiles', label: 'Tiles', required: true,
      ok: tiles.length === needTiles,
      detail: `${tiles.length} of ${needTiles}`,
      fix: tiles.length === 0
        ? 'Nothing on the card yet.'
        : `${needTiles - tiles.length} still empty.`,
    },
    {
      key: 'teams', label: 'Teams', required: true,
      ok: gameTeams.length > 0,
      detail: `${gameTeams.length}`,
      fix: 'This game needs at least one team.',
    },
    {
      key: 'roster', label: 'Players', required: true,
      ok: gameTeams.length > 0 && teamsWithoutPlayers.length === 0,
      detail: `${rosterCount} assigned`,
      fix: teamsWithoutPlayers.length
        ? `Nobody yet on ${teamsWithoutPlayers.map((t) => t.name).join(', ')}.`
        : 'Nobody assigned yet.',
    },
    {
      key: 'discord', label: 'Discord', required: false,
      ok: webhooks.length > 0,
      detail: webhooks.length ? `${webhooks.length} configured` : 'none',
      fix: 'With none set, this game posts nothing to Discord.',
    },
  ] : null;

  // Snakes: a tile on every square but the snake heads and ladder feet --
  // start_game's own rule -- and the same teams and players as bingo.
  const jumpStarts = new Set(jumps.map((j) => Number(j.from)));
  const snakesNeed = LAST_TILE - jumpStarts.size;
  const snakesFilled = tiles.filter((t) => !jumpStarts.has(t.position)).length;
  const ladderCount = jumps.filter(isLadder).length;
  const snakesChecks = game && snakesMode ? [
    {
      key: 'jumps', label: 'Snakes and ladders', required: false,
      ok: jumps.length > 0,
      detail: jumps.length
        ? `${ladderCount} ladder${ladderCount === 1 ? '' : 's'}, ${jumps.length - ladderCount} snake${jumps.length - ladderCount === 1 ? '' : 's'}`
        : 'none',
      fix: 'Place these before filling the board — their squares need no task.',
    },
    {
      key: 'tiles', label: 'Tiles', required: true,
      ok: snakesFilled === snakesNeed,
      detail: `${snakesFilled} of ${snakesNeed}`,
      fix: snakesFilled === 0
        ? 'Nothing on the board yet.'
        : `${snakesNeed - snakesFilled} still empty.`,
    },
    ...cardChecks.filter((c) => c.key !== 'tiles'),
  ] : null;

  const bingoChecks = bingo ? cardChecks : null;

  // Territory: a task on every place but the homes, and teams and players as
  // bingo. A task left on a home square is not counted, as with snakes.
  const homeSquares = new Set(homes ? [...homes.values()].map(placePosition) : []);
  const territoryNeed = TASK_GRID * TASK_GRID - homeSquares.size;
  const territoryFilled = tiles.filter((t) => !homeSquares.has(t.position)).length;
  const territoryChecks = game && territoryMode ? [
    {
      key: 'tiles', label: 'Tasks', required: true,
      ok: territoryFilled === territoryNeed,
      detail: `${territoryFilled} of ${territoryNeed}`,
      fix: territoryFilled === 0
        ? 'No tasks set yet: at random, from a saved board, or one by one.'
        : `${territoryNeed - territoryFilled} places still have no task.`,
    },
    {
      key: 'homes', label: 'Homes', required: true,
      ok: gameTeams.length > 0 && !homesIssue,
      detail: gameTeams.length ? `${gameTeams.length} set` : 'no teams',
      fix: homesIssue ?? 'Add teams first; each one then gets a home.',
    },
    ...cardChecks.filter((c) => c.key !== 'tiles'),
  ] : null;

  // Challenge: no board, no captains, no fleets. What stands between it and
  // starting is people signing up, which is theirs to do and not the
  // organiser's -- so this list is shorter than every other mode's and most of
  // it is waiting.
  const challengeUnassigned = challengeEntries.filter((e) => !e.team_id).length;
  const challengeChecks = game && challengeMode ? [
    {
      key: 'entrants', label: 'Entrants', required: true,
      ok: challengeEntries.length > 0,
      detail: `${challengeEntries.length} signed up`,
      fix: 'Players sign themselves up from their own screen. Tell the clan it is open.',
    },
    // Only when there are teams to be on. A solo event ranks people, so there
    // is nothing here to get wrong.
    ...(challengeSetup?.solo === false ? [{
      key: 'challenge_teams', label: 'Teams', required: true,
      ok: challengeEntries.length > 0 && challengeUnassigned === 0,
      detail: challengeUnassigned
        ? `${challengeUnassigned} with no team`
        : `${gameTeams.length} team${gameTeams.length === 1 ? '' : 's'}`,
      fix: 'Put every entrant on a team in Track — the event will not start until they are all on one.',
    }] : []),
    {
      // Enforced, and the one thing a challenge cannot do without: the figures
      // are what changed between the start and this moment, so an event with
      // no end has nothing to measure and challenge_start refuses it.
      key: 'ends', label: 'End time', required: true,
      ok: Boolean(game.ends_at) && Date.parse(game.ends_at) > Date.now(),
      detail: game.ends_at ? new Date(game.ends_at).toLocaleString() : 'not set',
      fix: game.ends_at
        ? 'It has already passed — move it before starting.'
        : 'Set one below.',
    },
    {
      key: 'discord', label: 'Discord', required: false,
      ok: webhooks.length > 0,
      detail: webhooks.length ? `${webhooks.length} configured` : 'none',
      fix: 'With none set, this event posts nothing to Discord.',
    },
  ] : null;

  const checks = !game ? [] : challengeChecks ?? bingoChecks ?? snakesChecks ?? territoryChecks ?? [
    {
      key: 'tiles', label: 'Tiles', required: true,
      ok: tiles.length === needTiles,
      detail: `${tiles.length} of ${needTiles}`,
      fix: tiles.length === 0
        ? 'Nothing on the board yet.'
        : `${needTiles - tiles.length} still empty.`,
    },
    {
      key: 'teams', label: 'Teams', required: true,
      ok: gameTeams.length === 2,
      detail: `${gameTeams.length} of 2`,
      fix: 'A game needs exactly two teams. Create it again if this is wrong.',
    },
    {
      key: 'captains', label: 'Captains', required: true,
      ok: gameTeams.length === 2 && teamsWithoutCaptain.length === 0,
      detail: `${gameTeams.length - teamsWithoutCaptain.length} of ${gameTeams.length || 2}`,
      // The one that used to fail silently: no captain means no player can
      // place that team's fleet, and nothing anywhere said so.
      fix: teamsWithoutCaptain.length
        ? `${teamsWithoutCaptain.map((t) => t.name).join(' and ')} — without a captain, `
          + 'nobody on that team can place its fleet.'
        : '',
    },
    {
      // Membership only. Captaincy is the row above, and failing both for one
      // missing captain would read as two separate problems.
      key: 'roster', label: 'Players', required: true,
      ok: gameTeams.length === 2 && gameTeams.every((t) => members.some((m) => m.team_id === t.id)),
      detail: `${rosterCount} assigned`,
      fix: `Both teams need at least one player${
        gameTeams.filter((t) => !members.some((m) => m.team_id === t.id)).map((t) => t.name).join(' and ')
          ? ` — nobody yet on ${gameTeams.filter((t) => !members.some((m) => m.team_id === t.id)).map((t) => t.name).join(' and ')}`
          : ''
      }.`,
    },
    {
      key: 'fleets', label: 'Fleets placed', required: true,
      ok: gameTeams.length === 2 && teamsWithoutFleet.length === 0,
      detail: `${gameTeams.length - teamsWithoutFleet.length} of ${gameTeams.length || 2}`,
      fix: game.status === 'setup'
        ? 'Captains do this themselves once preparation is open.'
        : `Waiting on ${teamsWithoutFleet.map((t) => t.name).join(' and ') || 'the captains'}. `
          + 'Only a captain can place a fleet — if theirs is away, pass the role on in Roster.',
    },
    {
      key: 'discord', label: 'Discord', required: false,
      ok: webhooks.length > 0,
      detail: webhooks.length ? `${webhooks.length} configured` : 'none',
      // Optional, and worth saying so loudly: since 0042 a game with no webhook
      // posts nothing at all, and silence is easy to mistake for a fault.
      fix: 'With none set, this game posts nothing to Discord.',
    },
  ];

  const blocking = checks.filter((c) => c.required && !c.ok);
  // Bingo needs nothing before preparation: the card stays hidden until Start,
  // so opening it early only shows players their team and a countdown.
  const canOpenPreparation = cardLike || (checks.every((c) => c.key !== 'tiles' || c.ok)
    && teamsWithoutCaptain.length === 0 && gameTeams.length === 2 && rosterCount > 0);
  const canStart = blocking.length === 0;
  // Battleships starts only from placement; bingo from either side of it. A
  // challenge has no preparation at all -- starting it is what closes
  // sign-ups -- so it starts from setup and nowhere else.
  const startableStatus = challengeMode
    ? game?.status === 'setup'
    : cardLike
      ? game.status === 'setup' || game.status === 'placement'
      : game?.status === 'placement';

  const stillNeeded = (missing) => (missing.length === 0
    ? undefined
    : 'Still needed: ' + missing.map((c) => c.label.toLowerCase()).join(', '));

  // Tooltip for Open preparation: everything but fleets, which captains can
  // only place once it is open. Bingo has nothing to wait for here.
  const openBlockedReason = !game || game.status !== 'setup' || cardLike
    ? undefined
    : stillNeeded(blocking.filter((c) => c.key !== 'fleets'));
  const startBlockedReason = startableStatus ? stillNeeded(blocking) : undefined;

  // Keep this badge in sync with the setup overview: it represents everything
  // still blocking the game, including fleets that captains place later.
  const configureBadge = blocking.length;

  // Configure and Track are both about a chosen game, so with none chosen there
  // is nothing for them to show. Derived rather than corrected in an effect, so
  // deleting the open game cannot leave the console pointing at a blank pane.
  // Accounts is the third exception, alongside Games itself: resetting a
  // password has nothing to do with which game is open.
  const GAME_INDEPENDENT_PANES = ['games', 'suggestions', 'accounts'];
  // Both of these reach past one game: the suggestion queue is site-wide and
  // Accounts is every player. A moderator gets neither, and a pane remembered
  // from an admin session on the same browser falls back to Games.
  const ADMIN_ONLY_PANES = ['suggestions', 'accounts'];
  const allowedPane = isAdmin || !ADMIN_ONLY_PANES.includes(pane) ? pane : 'games';
  const activePane = !game && !GAME_INDEPENDENT_PANES.includes(allowedPane) ? 'games' : allowedPane;

  const storedConfigTab = (game && configTabs[game.id]) || 'game';
  // A remembered tab can name one this mode does not have — the same browser
  // was on Board for the last game it opened.
  const configTab = challengeMode && !CHALLENGE_CONFIG_TABS.some((t) => t.key === storedConfigTab)
    ? 'game'
    : storedConfigTab;
  const openConfigTab = (key) => {
    if (!game) return;
    setConfigTabs((prev) => {
      const next = { ...prev, [game.id]: key };
      writeTabMemory(CONFIG_TABS_KEY, next);
      return next;
    });
  };
  // What still blocks the start, counted on the sub-tab where it gets fixed.
  const configTabBadge = (key) => blocking.filter((c) => (CHECK_TAB[c.key] ?? 'game') === key).length;

  // Track's own tabs, remembered per game the same way Configure's are.
  const trackTabList = game
    ? trackTabsFor(game, {
      hasWom: Boolean(challengeSetup?.wom_metric),
      hasScreens: Boolean(onViewAs) && gameTeams.length > 0,
    })
    : [];
  const storedTrackTab = game ? trackTabs[game.id] : null;
  // A remembered tab can name one this game has not got -- another mode, or a
  // challenge that was never linked to a competition.
  const trackTab = trackTabList.some((t) => t.key === storedTrackTab)
    ? storedTrackTab
    : trackTabList[0]?.key;
  const openTrackTab = (key) => {
    if (!game) return;
    setTrackTabs((prev) => {
      const next = { ...prev, [game.id]: key };
      writeTabMemory(TRACK_TABS_KEY, next);
      return next;
    });
  };

  const sections = [
    {
      key: 'games', label: 'Games', badge: 0, enabled: true,
      hint: 'Create one, or pick one to work on',
    },
    {
      key: 'configure', label: 'Configure', badge: configureBadge, enabled: Boolean(game),
      hint: game ? 'Game, board, teams, Discord' : 'Pick a game first',
    },
    {
      key: 'track', label: 'Track', badge: 0, enabled: Boolean(game),
      hint: game ? 'Boards and evidence' : 'Pick a game first',
    },
    {
      key: 'suggestions', label: 'Suggestions',
      badge: suggestions.filter((s) => s.status === 'pending').length, enabled: true,
      hint: 'Tiles players want in the catalogue',
    },
    {
      key: 'accounts', label: 'Accounts', badge: 0, enabled: true,
      hint: 'Reset a player’s password',
    },
  ].filter((s) => isAdmin || !ADMIN_ONLY_PANES.includes(s.key));

  return (
    <div className="admin-split">
      {/* Which section is on screen, and — once a game is open — which game every
          section is talking about. Sticky, so that answer travels with you down
          a long pane instead of scrolling off the top. */}
      <nav className="admin-nav" aria-label="Admin sections">
        {game && (
          <div className="admin-nav-game">
            <span className="admin-nav-game-name">{game.name}</span>
            <span className={`pill ${game.status}`}>{statusLabel(game.status)}</span>
          </div>
        )}
        <ul>
          {sections.map((s) => (
            <li key={s.key}>
              <button
                className={`admin-nav-item${activePane === s.key ? ' on' : ''}`}
                aria-current={activePane === s.key ? 'page' : undefined}
                disabled={!s.enabled}
                onClick={() => setPane(s.key)}
              >
                <span className="admin-nav-label">
                  {s.label}
                  {s.badge > 0 && <span className="admin-nav-badge">{s.badge}</span>}
                </span>
                <span className="admin-nav-hint">{s.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="admin">
      {/* Brought into view rather than left where it renders. The console is a
          long pane and the error line lives at the top of it, so a refusal
          raised from the board builder — most of a page further down — used to
          be announced somewhere the organiser was not looking. */}
      {/* A tick and a cross, because these two were the same shape in the same
          place and differed only in colour — so "23 tiles saved" and
          "permission denied" read alike at a glance, which is the glance most
          of them get. */}
      {error && (
        <p className="error" ref={errorRef} role="alert">
          <span aria-hidden="true">✗ </span>{error}
        </p>
      )}
      {notice && (
        <p className="muted notice" role="status">
          <span aria-hidden="true">✓ </span>{notice}
        </p>
      )}

      {activePane === 'games' && <>
      <NewGame
        busy={busy}
        modeChoices={isAdmin ? MODES : MODES.filter((m) => modes.includes(m.key))}
        onCreate={(payload) => {
          const { name, mode, teams: teamList, gridSize, startsAt, endsAt } = payload;
          return run(async () => {
            // A challenge has its own creating call: admin_new_game refuses
            // the mode and says so, because it has no room for a metric, a
            // label, a unit or a ranking.
            if (mode === 'challenge') return adminNewChallenge(payload);
            // Battleships still goes through the call it always has; the new one
            // delegates to it anyway, and this keeps a console ahead of its
            // migration able to create the game it could create yesterday.
            const id = mode === 'battleships'
              ? await adminCreateGame(name, teamList[0], teamList[1])
              : await adminNewGame({ name, mode, teams: teamList, gridSize, endsAt });
            if (id && startsAt) await adminSetStartTime(id, startsAt);
            return id;
          }, mode === 'challenge' ? 'Event created — sign-ups are open. Start it when enough people are in.'
            : mode === 'bingo' ? 'Bingo created. Fill its card next.'
              : mode === 'snakes' ? 'Snakes and Ladders created. Place the snakes and ladders, then fill the board.'
                : mode === 'territory' ? 'Territory created. Its places have no tasks yet — fill them on the Board tab.'
                  : 'Game created. Add its tiles next.')
            .then((id) => {
              if (worked(id) && id) { setGameId(id); setPane('configure'); }
              return id;
            });
        }}
      />

      <section className="card">
        <h2>Games</h2>
        {games.length === 0 && <p className="muted">No games yet.</p>}
        <ul className="game-list">
          {games.map((g) => {
            const names = teams.filter((t) => t.game_id === g.id).map((t) => t.name);
            const outstanding = readinessGaps(g, readiness[g.id], teams, members, jumpsByGame[g.id]);
            return (
              <li key={g.id} className={g.id === gameId ? 'on' : ''}>
                <div>
                  <strong>{g.name}</strong>{' '}
                  <span className={`pill ${g.status}`}>{statusLabel(g.status)}</span>
                  {isBingoGame(g) && (
                    <span className="pill mode-pill">Bingo · {g.grid_size}×{g.grid_size}</span>
                  )}
                  {isSnakesGame(g) && <span className="pill mode-pill">Snakes &amp; Ladders</span>}
                  {isTerritoryGame(g) && <span className="pill mode-pill">Territory</span>}
                  {isChallengeGame(g) && <span className="pill mode-pill">Challenge</span>}
                  {g.is_featured && (
                    <span className="pill" title="Unassigned players see this game's countdown">
                      ★ Featured
                    </span>
                  )}
                  <div className="meta">
                    {names.join(g.mode === 'battleships' ? ' vs ' : ', ') || 'no teams'}
                    {/* Named, not counted. "3" would send you into the game to
                        find out which three; the words are what stop the badge
                        being another thing to open. Only while a game can
                        still be got ready — once it is running the list has
                        served its purpose. */}
                    {outstanding.length > 0 && (
                      <span className="game-gaps"> · needs {outstanding.join(', ')}</span>
                    )}
                  </div>
                </div>
                <div className="row">
                  {/* Managing a game is the same gesture as opening it, so it
                      lands you in Configure rather than leaving you to find the
                      sidebar entry that just became available. */}
                  <button
                    className="ghost"
                    onClick={() => {
                      if (g.id === gameId) { setGameId(null); setPane('games'); }
                      else { setGameId(g.id); setPane('configure'); }
                    }}
                  >
                    {g.id === gameId ? 'Close' : 'Manage'}
                  </button>
                  {/* The one thing an unassigned signup ever sees, so toggling
                      it is a plain on/off here rather than another confirm
                      dialog -- there is nothing destructive to walk back. */}
                  <button
                    className="ghost"
                    disabled={busy}
                    onClick={() => run(
                      () => adminSetFeaturedGame(g.is_featured ? null : g.id),
                      g.is_featured ? 'No game is featured now.' : `"${g.name}" is now featured.`
                    )}
                  >
                    {g.is_featured ? 'Unfeature' : 'Feature'}
                  </button>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={async () => {
                      // Deleting cascades to tiles, locked-in tiles and the event feed, so
                      // make the caller name the game rather than trusting a click.
                      // The dialog holds its confirm button disabled until the
                      // name matches, so there is no mismatch to report anymore.
                      if (!(await confirm(
                        `Delete "${g.name}" and everything in it — the ${g.grid_size * g.grid_size} tiles, `
                        + 'every submission and claim, the roster and the feed.',
                        {
                          title: 'Delete this game?',
                          confirmLabel: 'Delete it',
                          danger: true,
                          requireText: g.name,
                        }
                      ))) return;
                      await run(() => adminDeleteGame(g.id), 'Game deleted.');
                      if (gameId === g.id) { setGameId(null); setPane('games'); }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      </>}

      {activePane === 'suggestions' && (
        <TileSuggestionReview
          rows={suggestions}
          error={suggestionsError}
          library={library}
          busy={busy}
          confirm={confirm}
          onAccept={async (id, tile, note) => ({
            ok: worked(await run(
              () => adminAcceptTileSubmission(id, tile, note),
              `"${tile.name}" is in the catalogue now.`,
              { refresh: ['suggestions', 'library'] }
            )),
          })}
          onRefuse={async (id, reason) => ({
            ok: worked(await run(
              () => adminRefuseTileSubmission(id, reason),
              'Suggestion refused.',
              { refresh: ['suggestions'] }
            )),
          })}
        />
      )}

      {activePane === 'accounts' && (
        <Accounts
          profiles={profiles}
          busy={busy}
          confirm={confirm}
          resets={passwordResets}
          deletions={accountDeletions}
          onOpenLog={() => { loadPasswordResets(); loadAccountDeletions(); }}
          onReset={async (profileId, password) => {
            const result = await run(
              () => adminResetPassword(profileId, password),
              'Password updated.',
              { refresh: [] }
            );
            if (worked(result)) loadPasswordResets();
            return result;
          }}
          onDelete={async (profileId, name) => {
            const result = await run(
              () => adminDeleteAccount(profileId),
              `${name} was deleted.`,
              { refresh: ['games'] }
            );
            if (worked(result)) loadAccountDeletions();
            return result;
          }}
        />
      )}

      {activePane === 'accounts' && (
        <ModeratorRoles
          profiles={profiles}
          moderators={moderators}
          busy={busy}
          confirm={confirm}
          onSave={async (profileId, picked, name) => {
            const result = await run(
              () => adminSetModeratorModes(profileId, picked),
              picked.length
                ? `${name} runs ${picked.map(labelOfMode).join(', ')}.`
                : `${name} is an ordinary player again.`,
              { refresh: [] }
            );
            if (worked(result)) loadModerators();
            return result;
          }}
        />
      )}

      {activePane === 'configure' && game && (
        <>
          <ConfigTabs
            tab={configTab}
            onPick={openConfigTab}
            badge={configTabBadge}
            tabs={challengeMode ? CHALLENGE_CONFIG_TABS : CONFIG_TABS}
          />

          {/* All four stay mounted and only the open one shows, so a half-typed
              tile, a snakes draft or a set of ticked players survives a look at
              another tab. */}
          <div className="config-pane" hidden={configTab !== 'game'}>
          <section className="card">
            <h2>{game.name} — {statusLabel(game.status)}</h2>
            <p className="muted">
              {bingo && <span className="pill mode-pill">Bingo · {game.grid_size}×{game.grid_size}</span>}
              {snakesMode && <span className="pill mode-pill">Snakes &amp; Ladders</span>}
              {territoryMode && <span className="pill mode-pill">Territory</span>}
              {challengeMode && <span className="pill mode-pill">Challenge</span>}{' '}
              {(challengeMode ? CHALLENGE_STEP_HINT : bingo ? BINGO_STEP_HINT
                : snakesMode ? SNAKES_STEP_HINT
                : territoryMode ? TERRITORY_STEP_HINT : STEP_HINT)[game.status]}
            </p>

            <SetupChecklist
              checks={checks}
              status={game.status}
              onGo={(key) => CHECK_TAB[key] && openConfigTab(CHECK_TAB[key])}
            />

            <div className="row">
              {/* A challenge has no preparation phase: there is no board to
                  hide and no fleet to place, and starting it is the thing
                  that closes sign-ups. */}
              {!challengeMode && (
                <button
                  disabled={busy || game.status !== 'setup' || !canOpenPreparation}
                  title={openBlockedReason}
                  onClick={() => run(() => adminOpenPlacement(game.id), 'Preparation is open.')}
                >
                  Open preparation
                </button>
              )}
              <button
                disabled={busy || !startableStatus || !canStart}
                title={startBlockedReason}
                onClick={() => (challengeMode
                  // Its own call: start_game refuses a challenge and says so.
                  // Creating the Wise Old Man competition is part of starting,
                  // and that belongs with the rest of the mode's own rules.
                  ? run(() => challengeStart(game.id),
                    'The event has started — sign-ups are closed.')
                  : run(() => startGame(game.id), bingo
                    ? 'Bingo started — the card is open to every team.'
                    : snakesMode
                      ? 'The race has started — every team can roll.'
                      : territoryMode
                        ? 'The conquest has begun — every team marches out from home.'
                        : 'Game started — fleets are now frozen.'))}
              >
                {challengeMode ? 'Start event' : 'Start game'}
              </button>
              {/* Bingo only. The timer ends a game on its own, but an organiser
                  may need to call it early — a full card is not the only way an
                  evening runs out. */}
              {bingo && game.status === 'active' && (
                <button
                  className="danger"
                  disabled={busy}
                  onClick={async () => {
                    if (!(await confirm(
                      'Submissions close now and the team with the most completed tiles wins. '
                      + 'Ties go to whoever reached their total first.',
                      { title: `End "${game.name}" now?`, confirmLabel: 'End the game', danger: true }
                    ))) return;
                    run(() => adminEndGame(game.id), 'The bingo is over.');
                  }}
                >
                  End game now
                </button>
              )}
              {/* Snakes: whoever is furthest along wins, and the dialog names
                  them. The server checks the name is still right when it
                  ends the game, so a roll landing in between is refused
                  rather than handing the win to someone the organiser did not
                  see. */}
              {snakesMode && game.status === 'active' && (
                <button
                  className="danger"
                  disabled={busy}
                  onClick={async () => {
                    let leader;
                    try {
                      leader = ((await snakesStandings(game.id)) ?? []).find((s) => s.board_tile > 0);
                    } catch (err) {
                      setError(err.message);
                      return;
                    }
                    if (!leader) {
                      setError('Nobody has left Start yet, so there is no one to declare the winner.');
                      return;
                    }
                    if (!(await confirm(
                      `${leader.team_name} is furthest along — on tile ${leader.board_tile}, with `
                      + `${leader.tiles_completed} tile${leader.tiles_completed === 1 ? '' : 's'} done — and wins.\n`
                      + 'The race ends now for every team.',
                      {
                        title: `End "${game.name}" now?`,
                        confirmLabel: `End it — ${leader.team_name} wins`,
                        danger: true,
                      }
                    ))) return;
                    run(() => adminSnakesEndGame(game.id, leader.team_id),
                      `The race is over — ${leader.team_name} wins.`);
                  }}
                >
                  End game now
                </button>
              )}
              {/* Territory: the highest score wins, and the dialog names the
                  team on top now. A capture landing in between can change
                  that; the server scores again when it ends the game, and the
                  feed names whoever it finds. */}
              {territoryMode && game.status === 'active' && (
                <button
                  className="danger"
                  disabled={busy}
                  onClick={async () => {
                    let rows;
                    try {
                      rows = (await territoryStandings(game.id)) ?? [];
                    } catch (err) {
                      setError(err.message);
                      return;
                    }
                    const leader = rows[0];
                    const anyCapture = rows.some((r) => r.last_capture_at);
                    const message = anyCapture && leader
                      ? `${leader.team_name} leads with ${leader.score} point${leader.score === 1 ? '' : 's'} and wins `
                        + 'unless a capture lands before you confirm.\nThe map closes now for every team.'
                      : 'No place has changed hands yet, so nobody wins.\nThe map closes now for every team.';
                    if (!(await confirm(message, {
                      title: `End "${game.name}" now?`,
                      confirmLabel: 'End the game',
                      danger: true,
                    }))) return;
                    run(() => adminEndGame(game.id), 'The conquest is over.');
                  }}
                >
                  End game now
                </button>
              )}
              {/* Challenge: the same button, and deliberately the same one —
                  admin_end_game hands a challenge to challenge_end, because
                  ending a game is one button whatever the mode. A ladder
                  scored off the hiscores is refused while its figures are
                  stale, which is a refusal worth reading rather than a check
                  to repeat here. */}
              {challengeMode && game.status === 'active' && (
                <button
                  className="danger"
                  disabled={busy}
                  onClick={async () => {
                    const leader = challengeLadder[0] ?? null;
                    const message = (leader
                      ? `${leader.name} is on top and wins unless something lands before you confirm.\n`
                      : 'Nobody has a figure yet.\n')
                      + 'Submissions close now for everyone.'
                      + (challengeSetup?.ranked_by === 'wom'
                        ? '\n\nScored off the hiscores: refresh the figures in Track first, '
                          + 'or this will be refused.'
                        : '');
                    if (!(await confirm(message, {
                      title: `End "${game.name}" now?`,
                      confirmLabel: 'End the event',
                      danger: true,
                    }))) return;
                    run(() => adminEndGame(game.id), 'The event is over.');
                  }}
                >
                  End event now
                </button>
              )}
            </div>

            {/* Display-only: nothing here gates Start game, which stays
                available the moment its own checklist is met — earlier than
                this if you're ready, later if you're not. It just gives
                players rostered ahead of time something to count down to. */}
            {!challengeMode && game.status !== 'active' && game.status !== 'finished' && (
              <StartTimeEditor
                game={game}
                busy={busy}
                onSave={(iso) => run(() => adminSetStartTime(game.id, iso),
                  iso ? 'Start time saved.' : 'Start time cleared.')}
              />
            )}

            {/* Unlike the start time, this one is enforced: from this moment the
                server refuses every submission, and the standings at that point
                are the result. Editable while running, so an evening can be
                extended — but never into the past, which would end it by stealth. */}
            {(bingo || territoryMode || challengeMode) && game.status !== 'finished' && (
              <TimeEditor
                label="End time"
                hint={challengeMode
                  ? '(the figures are what changed by this moment)'
                  : '(submissions close at this moment)'}
                value={game.ends_at}
                resetKey={game.id}
                busy={busy}
                onSave={(iso) => run(() => adminSetEndTime(game.id, iso),
                  iso ? 'End time saved.' : 'End time cleared — the game now runs until a card is full.')}
              />
            )}

            {bingo && (game.status === 'active' || game.status === 'finished') && (
              <div className="row" style={{ marginTop: '.8rem' }}>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={async () => {
                    if (!(await confirm(
                      'Cleared: every completed tile and submission, the activity feed, and the winner.\n'
                      + `Kept: the ${needTiles} tiles, the teams and the roster.\n\n`
                      + (game.ends_at && Date.parse(game.ends_at) <= Date.now()
                        ? 'The end time has already passed — set a new one before starting again.\n\n'
                        : '')
                      + 'This cannot be undone.',
                      { title: `Reset "${game.name}" to preparation?`, confirmLabel: 'Reset it', danger: true }
                    ))) return;
                    run(() => adminResetGame(game.id, true), 'Bingo reset — every tile is open again once you start.');
                  }}
                >
                  Reset to preparation
                </button>
              </div>
            )}

            {snakesMode && (game.status === 'active' || game.status === 'finished') && (
              <div className="row" style={{ marginTop: '.8rem' }}>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={async () => {
                    if (!(await confirm(
                      'Cleared: every completed tile and submission, every move and rollback, '
                      + 'the activity feed, and the winner. Every team goes back to Start.\n'
                      + 'Kept: the tiles, the snakes and ladders, the teams and the roster.\n\n'
                      + 'This cannot be undone.',
                      { title: `Reset "${game.name}" to preparation?`, confirmLabel: 'Reset it', danger: true }
                    ))) return;
                    run(() => adminResetGame(game.id, true), 'Race reset — every team is back at Start.');
                  }}
                >
                  Reset to preparation
                </button>
              </div>
            )}

            {/* The way back out of a started game. Without it the only undo was
                Delete, which takes the 100 tiles and the roster with it. */}
            {!cardLike && !challengeMode && (game.status === 'active' || game.status === 'finished') && (
              <div className="row" style={{ marginTop: '.8rem' }}>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={async () => {
                    if (!(await confirm(
                      'Cleared: every locked-in tile and shot, the activity feed, manual score ' +
                      'adjustments, the winner, and both fleets.\n' +
                      'Kept: the 100 tiles and the roster.\n\n' +
                      'This cannot be undone.',
                      {
                        title: `Reset "${game.name}" to preparation?`,
                        confirmLabel: 'Reset it',
                        danger: true,
                      }
                    ))) return;
                    run(() => adminResetGame(game.id, true),
                        'Game reset. Fleets need placing again.');
                  }}
                >
                  Reset to preparation
                </button>
                {/* Weighted the same as its neighbour, because it does the
                    same thing to everything anybody played: a ghost button
                    beside a red one says one of the two is the safe choice,
                    and neither is. What it keeps is in the dialog, which is
                    where that distinction can actually be read. */}
                <button
                  className="danger"
                  disabled={busy}
                  onClick={async () => {
                    if (!(await confirm(
                      'Cleared: every locked-in tile and shot, the activity feed, manual score ' +
                      'adjustments, and the winner.\n' +
                      'Kept: the 100 tiles, the roster, and both fleets as placed.\n\n' +
                      'This cannot be undone.',
                      {
                        title: `Replay "${game.name}" with the same fleets?`,
                        confirmLabel: 'Reset, keep fleets',
                        danger: true,
                      }
                    ))) return;
                    run(() => adminResetGame(game.id, false),
                        'Game reset with fleets intact — press Start game when ready.');
                  }}
                >
                  Reset, keep fleets
                </button>
              </div>
            )}
          </section>
          </div>

          <div className="config-pane" hidden={configTab !== 'board'}>
          {/* The whole of how a board gets built. The paste box that used to
              sit below this is gone: it existed for boards that already existed
              as spreadsheet text, and everything it could do -- including
              filing a tile it did not recognise in the catalogue -- the builder
              now does one square at a time, against a catalogue it can search. */}
          {snakesMode && (
            <SnakesJumpEditor
              jumps={jumps}
              busy={busy}
              edit={jumpEdit}
              onSave={saveJumps}
            />
          )}

          {territoryMode && (
            <TerritoryHomes
              // Keyed on what is saved, so a save (or another organiser's)
              // starts the picker again from the stored homes.
              key={`${game.id}:${[...homes].join()}`}
              teams={gameTeams}
              homes={homes}
              editable={game.status === 'setup' || game.status === 'placement'}
              busy={busy}
              onSave={(picked) => run(() => adminSetTerritoryHomes(game.id, picked), 'Homes saved.',
                { refresh: ['games'] })}
            />
          )}

          <BoardBuilder
            game={game}
            tiles={tiles}
            jumps={snakesMode ? jumpEdit.shown : jumps}
            jumpEdit={snakesMode ? jumpEdit : null}
            onSaveJumps={saveJumps}
            homes={homes && new Map([...homes].map(([id, key]) => [key, gameTeams.find((t) => t.id === id)?.name]))}
            library={library}
            libraryError={libraryError}
            busy={busy}
            // Each of the three writes below answers "did it actually save",
            // because the builder closes a form and moves to the next square on
            // the strength of it.
            // The hot pair: one press per square, a hundred of them. Only the
            // tiles can have moved — not the roster, not the fleets, not the
            // webhooks, and not the catalogue, whose use count is no longer
            // shown on a row.
            onSetTile={(row, col, tile) =>
              run(() => adminSetTile(game.id, row, col, tile), null, { refresh: ['tiles'] })
                .then(worked)
            }
            onClearTile={(row, col) =>
              run(() => adminClearTile(game.id, row, col), 'Square cleared.', { refresh: ['tiles'] })
                .then(worked)
            }
            // A tile dragged onto another square: the two trade places, or the
            // tile just moves if the square was empty. The builder's undo bar
            // says what happened, so no notice on top of it.
            onSwapTiles={(from, to) =>
              run(() => adminSwapTiles(game.id, from, to), null, { refresh: ['tiles'] })
                .then(worked)
            }
            // The way back to an empty board. Asked for by name rather than by
            // count, because a board is an evening's work and "100 squares" is
            // true of every board -- the name is the only part of the question
            // that tells you whether you are about to empty the right one.
            onClearBoard={() =>
              confirm(
                `All ${tiles.length} square${tiles.length === 1 ? '' : 's'} on this `
                + 'board are removed. The catalogue is untouched, so anything that '
                + 'came from it can be placed again — but a one-off tile typed '
                + 'straight onto a square is gone.'
                + '\n\nThis cannot be undone.',
                {
                  title: `Remove every tile from "${game.name}"?`,
                  confirmLabel: 'Remove them all',
                  danger: true,
                  requireText: game.name,
                }
              ).then((ok) => ok && run(
                () => adminClearBoard(game.id),
                (n) => `${n} square${n === 1 ? '' : 's'} cleared — the board is empty.`,
                { refresh: ['tiles'] }
              ))
            }
            // A whole board, kept under a name. Saving over one asks first —
            // not because it is destructive to the board on screen, but because
            // the thing it overwrites is somebody else's saved evening.
            onSaveBoard={(name, existing) =>
              (existing
                ? confirm(
                    `"${existing.name}" already holds a board of ${existing.squares} `
                    + 'square' + (existing.squares === 1 ? '' : 's')
                    + '. Saving replaces it with the board on screen.',
                    { title: `Replace the saved board "${existing.name}"?`,
                      confirmLabel: 'Replace it' }
                  )
                : Promise.resolve(true)
              ).then((ok) => ok && run(
                () => adminSaveBoardPreset(game.id, name),
                (r) => `Saved "${r.name}" — ${r.squares} square${r.squares === 1 ? '' : 's'}.`,
                { refresh: [] }
              ).then(worked))
            }
            // Loading REPLACES the board, so it asks in the same shape the
            // clear does — by name, typed out. The database refuses once a game
            // is past placement or any tile has been claimed; this is the part
            // that stops an organiser doing it to the right game by accident.
            onLoadBoard={(preset) =>
              confirm(
                `Every square on "${game.name}" is replaced by the ${preset.squares} `
                + `square${preset.squares === 1 ? '' : 's'} saved as "${preset.name}".`
                + (tiles.length
                    ? `\n\nThe ${tiles.length} tile${tiles.length === 1 ? '' : 's'} `
                      + 'on the board now are removed. Save them first if you want them back.'
                    : '')
                + '\n\nThis cannot be undone.',
                {
                  title: `Load "${preset.name}" onto ${game.name}?`,
                  confirmLabel: 'Load the board',
                  danger: true,
                  requireText: game.name,
                }
              ).then((ok) => ok && run(
                () => adminApplyBoardPreset(game.id, preset.id),
                (r) => `"${r.name}" loaded — ${r.placed} square${r.placed === 1 ? '' : 's'}.`,
                { refresh: ['tiles'] }
              ).then(worked))
            }
            onDeleteBoard={(preset) =>
              confirm(
                `The saved board "${preset.name}" is deleted. Any game already `
                + 'built from it keeps its tiles — this only removes the saved copy.'
                + '\n\nThis cannot be undone.',
                {
                  title: `Delete the saved board "${preset.name}"?`,
                  confirmLabel: 'Delete it',
                  danger: true,
                }
              ).then((ok) => ok && run(
                () => adminDeleteBoardPreset(preset.id),
                `"${preset.name}" deleted.`,
                { refresh: [] }
              ).then(worked))
            }
            // Resolves to the entry's id, or null if the save was refused. The
            // builder needs the id rather than just a yes: after saving it puts
            // the tile on the square you were filling, and the square records
            // which catalogue entry it came from.
            onSaveLibraryTile={(id, tile) =>
              run(() => adminSaveLibraryTile(id, tile),
                  id ? 'Catalogue tile updated.' : 'Added to the catalogue.',
                  { refresh: ['library'] })
                .then((result) => (worked(result) ? result : null))
            }
            onDeleteLibraryTile={!isAdmin ? undefined : (entry) =>
              confirm(
                entry.times_used > 0
                  ? `It is on ${entry.times_used} square${entry.times_used === 1 ? '' : 's'} across past boards.\n`
                    + 'Those boards keep their own copy — only the catalogue entry goes, '
                    + 'so nothing that has been played changes.'
                  : 'It is not on any board yet.',
                {
                  title: `Remove "${entry.name}" from the catalogue?`,
                  confirmLabel: 'Remove it',
                  danger: true,
                }
              ).then((ok) => ok && run(
                () => adminDeleteLibraryTile(entry.id), 'Removed from the catalogue.',
                { refresh: ['library'] }
              ).then(worked))
            }
            onAutofillBoard={() =>
              run(() => adminAutofillBoard(game.id),
                  (r) => `${r.filled} square${r.filled === 1 ? '' : 's'} filled.`
                         + dealShortfall(r),
                  { refresh: ['tiles', 'library'] })
            }
            // Re-arrange what is on the board rather than drawing a new one.
            //
            // No dialog, and that is the point of it rather than an oversight:
            // it adds nothing, removes nothing and asks the catalogue nothing,
            // so the hundred tiles that come out are the hundred that went in.
            // The only thing a stray press costs is the arrangement, which is
            // the one thing the button says it changes. Its neighbour below,
            // which can cost the board, keeps its dialog.
            onShuffleBoard={() =>
              run(() => adminShuffleBoard(game.id),
                  (r) => `Board shuffled — ${r.moved} of ${r.tiles} tile`
                         + `${r.tiles === 1 ? '' : 's'} moved to a new square.`,
                  { refresh: ['tiles'] })
            }
            // Deal a board, read it, dislike it, roll again. The autofill
            // above cannot do this on its own: it only ever fills empty
            // squares, so on a board that is already full it is not offered,
            // and the only way to a different board was the red "remove every
            // tile" and then a second press.
            //
            // It asks first, and it has to. A square does not record whether it
            // was dealt or chosen -- `library_id` is set either way -- so this
            // cannot spare the tiles an organiser placed deliberately, and that
            // is the one thing they would not expect. No type-the-name guard
            // though: that belongs to "remove every tile", where what makes it
            // frightening is that nothing comes back. Here a board does.
            onReshuffleBoard={() => {
              // What the deal can actually produce, said before it happens
              // rather than counted afterwards. `admin_autofill_board` deals
              // each catalogue entry at most once, so a catalogue smaller than
              // the board comes back with holes in it — which is exactly the
              // surprise this dialog exists to prevent, and the reason Shuffle
              // sits next to this button.
              const pool = library.length;
              const short = tiles.length - pool;
              return confirm(
                `All ${tiles.length} square${tiles.length === 1 ? '' : 's'} are cleared and filled `
                + 'again at random from the catalogue, so the board comes back different.'
                + '\n\nThe deal never uses a catalogue tile twice'
                + (short > 0
                  ? `, and there ${pool === 1 ? 'is' : 'are'} only ${pool} tile`
                    + `${pool === 1 ? '' : 's'} it can draw from — so about ${short} square`
                    + `${short === 1 ? '' : 's'} will come back empty. To keep these tiles `
                    + 'and only move them around, use the shuffle button beside this one.'
                  : ', so any task this board holds more than once comes back only once.')
                + '\n\nSquares placed by hand go with them — a square does not '
                + 'record whether it was dealt or chosen — and a one-off tile '
                + 'typed straight onto the board cannot come back, because it '
                + 'was never in the catalogue.'
                + '\n\nThis cannot be undone.',
                {
                  // Named for the button that opened it, not for what it does
                  // under the hood -- a dialog whose title uses a word that is
                  // nowhere on screen reads as a different action. The body
                  // below still spells out the clearing and the re-drawing,
                  // which is the part worth knowing before pressing.
                  title: `Randomize the board for "${game.name}"?`,
                  confirmLabel: 'Randomize it',
                  danger: true,
                }
              ).then((ok) => ok && run(
                async () => {
                  // Two RPCs rather than one that does both, which leaves a
                  // window where the board is empty. That window is a real
                  // state of this screen with its own button on it, so the
                  // honest thing when the deal fails is to name it -- an empty
                  // board under a bare Postgres message reads as a bug.
                  const cleared = await adminClearBoard(game.id);
                  try {
                    return { cleared, deal: await adminAutofillBoard(game.id) };
                  } catch (err) {
                    throw new Error(
                      `The board was cleared, but dealing the new one failed: ${err.message} `
                      + 'Nothing was dealt — press "Fill the empty squares at '
                      + 'random" to deal again.'
                    );
                  }
                },
                ({ cleared, deal }) =>
                  `Board randomized — ${cleared} square${cleared === 1 ? '' : 's'} cleared, `
                  + `${deal.filled} filled at random.` + dealShortfall(deal),
                { refresh: ['tiles', 'library'] }
              ));
            }}
          />
          </div>

          <div className="config-pane" hidden={configTab !== 'teams'}>
          <section className="card">
            <h2>{cardLike ? 'Teams' : 'Team names'}</h2>
            <div className="columns">
              {gameTeams.map((team) => (
                <div key={team.id}>
                  <h3>{team.name}</h3>
                  <TeamNameEditor team={team} onRenamed={() => loadGames()} />
                  {/* Only before the start: once tiles are being completed a
                      team is part of the standings, and deleting it would
                      rewrite a result rather than fix a setup mistake. */}
                  {cardLike && (game.status === 'setup' || game.status === 'placement') && (
                    <button
                      className="danger"
                      style={{ marginTop: '.5rem' }}
                      disabled={busy}
                      onClick={async () => {
                        if (!(await confirm(
                          `${team.name} is removed from this game, and its players go back to the free list.`,
                          { title: `Delete the team "${team.name}"?`, confirmLabel: 'Delete it', danger: true }
                        ))) return;
                        run(() => adminDeleteTeam(team.id), `${team.name} deleted.`);
                      }}
                    >
                      Delete team
                    </button>
                  )}
                </div>
              ))}
            </div>
            {cardLike && game.status !== 'finished' && (
              <AddTeam busy={busy} onAdd={(name) => run(() => adminAddTeam(game.id, name), `${name} added.`)} />
            )}
          </section>

          <Roster
            bingo={cardLike}
            snakes={snakesMode}
            gameTeams={gameTeams}
            profiles={profiles}
            members={members}
            busy={busy}
            onSet={(teamId, profileId, role) =>
              run(() => adminSetMember(teamId, profileId, role), 'Roster updated.')
            }
            onRemove={(teamId, profileId) =>
              run(() => adminRemoveMember(teamId, profileId), 'Player removed.')
            }
            onAddMany={(teamId, profileIds) =>
              run(
                () => Promise.all(profileIds.map((id) => adminSetMember(teamId, id, 'member'))),
                `${profileIds.length} player${profileIds.length === 1 ? '' : 's'} added.`
              )
            }
          />
          </div>

          <div className="config-pane" hidden={configTab !== 'discord'}>
          {/* Setting up, not running: it belongs with Tiles and Roster rather
              than between Score and Evidence, where it sat before. Since 0042 a
              game with no webhook posts nothing, so this is now a step someone
              has to actively decide to skip, not one they can fail to notice. */}
          <DiscordWebhooks
            gameId={game.id}
            gameTeams={gameTeams}
            onChanged={() => loadGameDetail(game.id)}
          />
          </div>
        </>
      )}

      {/* Watching a game that is already set up. Both of these fetch on mount,
          so keeping them in their own pane also means a game you only came in to
          configure no longer loads every board and every screenshot first. */}
      {/* Not for a challenge: "view as team" opens that team's board, and a
          challenge has not got one. What an organiser needs to see of it is
          the entrants and their numbers, which is the whole of the pane
          below. */}
      {activePane === 'track' && game && trackTabList.length > 0 && (
        <>
          <ConfigTabs tab={trackTab} onPick={openTrackTab} tabs={trackTabList} label="Track" />

          {/* Every tab stays mounted and only the open one shows, as on
              Configure. Nothing refetches when you switch -- which is what the
              one-long-scroll gave you for free, and would have been the price
              of tabs otherwise. */}
          {challengeMode ? (
            <>
              <div className="config-pane" hidden={trackTab !== 'ladder'}>
                <ChallengeLadder
                  standings={challengeLadder}
                  setup={challengeSetup}
                  title={game.status === 'finished' ? 'Final ladder' : 'If it ended now'}
                />
              </div>

              <div className="config-pane" hidden={trackTab !== 'entries'}>
                <ChallengeEntries
                  entries={challengeEntries}
                  setup={challengeSetup}
                  teams={gameTeams}
                  busy={busy}
                  onSetFigure={(entryId, amount) => run(
                    () => adminChallengeSetFigure(entryId, amount),
                    'Number corrected — the ladder and the feed both say who changed it.',
                    { refresh: ['challenge'] },
                  )}
                  onVerify={(entryId, ok) => run(
                    () => adminChallengeVerify(entryId, ok),
                    ok ? 'Checked. The player cannot change it now.' : 'Unchecked — the player can change it again.',
                    { refresh: ['challenge'] },
                  )}
                  onSetTeam={(entryId, teamId) => run(
                    () => adminChallengeSetTeam(entryId, teamId),
                    'Team set.',
                    { refresh: ['challenge'] },
                  )}
                />
              </div>

              {challengeSetup?.wom_metric && (
                <div className="config-pane" hidden={trackTab !== 'wom'}>
                  <section className="card">
                    <CardHead
                      title="Wise Old Man"
                      lead="Read the hiscores again now, instead of waiting for the next pass."
                      more={'There is no scheduler on this project, so nothing fetches on its own: an open '
                        + 'player screen asks every minute, and this is the same ask by hand. Reading WOM is '
                        + 'two steps — the request goes out, the reply lands a moment later — so a first press '
                        + 'that changes nothing is normal. Press it again.'}
                    />
                    <div className="row">
                      <button
                        className="ghost"
                        disabled={busy}
                        onClick={() => run(
                          () => womPulse(game.id),
                          (handled) => (handled > 0
                            ? 'The figures are up to date.'
                            : 'Asked Wise Old Man. The reply lands in a moment — press again to read it.'),
                          { refresh: ['challenge'] },
                        )}
                      >
                        Refresh the figures
                      </button>
                      {challengeSetup?.ranked_by === 'wom' && game.status === 'active' && (
                        <span className="muted">
                          This event is scored on them, so it cannot be ended while they are stale.
                        </span>
                      )}
                    </div>
                  </section>

                  <ChallengeWom
                    wom={challengeWom}
                    setup={challengeSetup}
                    busy={busy}
                    onReveal={async () => (await adminChallengeWom(game.id, true))?.verification_code}
                    onLink={(competitionId, code) => run(
                      () => adminChallengeWomLink(game.id, competitionId, code),
                      code
                        ? 'Linked. The standings are read on the next pass.'
                        : 'Linked without a code — the standings are read, but the competition cannot be edited from here.',
                      { refresh: ['challenge'] },
                    )}
                    onRetry={() => run(
                      () => adminChallengeWomRetry(game.id),
                      'Asked Wise Old Man again. The answer lands within a minute or two.',
                      { refresh: ['challenge'] },
                    )}
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <div className="config-pane" hidden={trackTab !== 'board'}>
                {bingo && (
                  <section className="card">
                    <CardHead
                      title="Cards"
                      lead="Every team’s card, with what it has completed and what it is part-way through."
                      more="Pick a team to see its card; a tile in progress shows its evidence count."
                    />
                    <BingoOverview game={game} teams={gameTeams} />
                  </section>
                )}
                {snakesMode && (
                  <SnakesAdminTrack
                    game={game}
                    tiles={tiles}
                    jumps={jumps}
                    busy={busy}
                    run={run}
                    confirm={confirm}
                  />
                )}
                {territoryMode && <TerritoryAdminTrack game={game} />}
                {!cardLike && (
                  <section className="card">
                    <CardHead
                      title="Boards"
                      lead="One board per team, showing the game from that team’s side."
                      more={'The opponent’s ships they are hunting, and their own locked-in tiles and shots on '
                        + 'top. A locked-in square shows its evidence count — 1/3 is a team mid-task — and '
                        + 'clicking one opens what they have submitted for it.'}
                    />
                    <AdminOverview gameId={game.id} teams={gameTeams} />
                  </section>
                )}
              </div>

              <div className="config-pane" hidden={trackTab !== 'evidence'}>
                <EvidenceCard gameId={game.id} mode={game.mode} />
              </div>

              {!cardLike && (
                <div className="config-pane" hidden={trackTab !== 'pets'}>
                  <section className="card">
                    <CardHead
                      title="Pets and jars"
                      lead="Every pet or jar screenshot, newest first."
                      more={'Each one earned its team a tile preview. Revoking one takes that preview back. '
                        + 'If the team has already spent it, their latest preview is hidden again.'}
                    />
                    <PetJarReview gameId={game.id} />
                  </section>
                </div>
              )}

              <div className="config-pane" hidden={trackTab !== 'screens'}>
                <TeamScreens game={game} teams={gameTeams} onViewAs={onViewAs} />
              </div>
            </>
          )}
        </>
      )}

      {confirmDialog}
      </div>
    </div>
  );
}

/**
 * The way into each team's own screen, read only (App.jsx, lib/viewOnly.js).
 *
 * Not a reconstruction: it is the players' screen itself -- board, buttons,
 * waiting room and all -- fed by admin_board_for_team, which answers exactly
 * what board_for_me answers a member of that team. So what is wrong there is
 * wrong for them, and what looks right does.
 *
 * Its own tab on Track, for every mode and status: before the start it shows
 * the waiting room a team is looking at, which is worth checking too.
 */
function TeamScreens({ game, teams, onViewAs }) {
  if (!onViewAs || teams.length === 0) return null;
  const sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section className="card team-screens">
      <h2>Team screens</h2>
      <p className="muted">
        Open the game exactly as a team sees it, without signing in as one of
        its players. It opens read only; to press the team&rsquo;s buttons for
        them, choose &ldquo;Act for&rdquo; on that screen.
      </p>
      <div className="row">
        {sorted.map((t) => (
          <button
            key={t.id}
            className="ghost"
            onClick={() => onViewAs({ gameId: game.id, teamId: t.id, teamName: t.name, role: 'member' })}
          >
            👁 View as {t.name}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * Configure, split four ways. It was one scroll -- start buttons, the board,
 * the whole catalogue, teams, a roster listing every free player once per
 * team, Discord -- so reaching Discord meant paging past all of it.
 */
const CONFIG_TABS = [
  { key: 'game', label: 'Game' },
  { key: 'board', label: 'Board' },
  { key: 'teams', label: 'Teams' },
  { key: 'discord', label: 'Discord' },
];

// A challenge has no board and no roster -- entrants sign themselves up and an
// organiser puts them on teams in Track -- so both of those tabs would be about
// a board it has not got.
const CHALLENGE_CONFIG_TABS = CONFIG_TABS.filter((t) => t.key === 'game' || t.key === 'discord');

// Which tab fixes each setup check (SetupChecklist keys). Fleets are placed by
// captains, so that one stays on Game.
const CHECK_TAB = {
  tiles: 'board', jumps: 'board', homes: 'board', teams: 'teams', captains: 'teams', roster: 'teams', discord: 'discord',
};

// Which sub-tab each game was last left on, per pane. Track keeps its own
// map: the tab you want on Configure and the one you want on Track are
// different answers about the same game.
const CONFIG_TABS_KEY = 'hs-admin-config-tabs';
const TRACK_TABS_KEY = 'hs-admin-track-tabs';

function readTabMemory(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}
function writeTabMemory(key, tabs) {
  try { localStorage.setItem(key, JSON.stringify(tabs)); } catch { /* private window: in-session only */ }
}

/**
 * Track's tabs for one game.
 *
 * Track used to be every job at once in one scroll -- for battleships that is
 * the boards, every screenshot in the game, the pet and jar queue and the four
 * team screens, stacked. Four separate questions, and no way to ask only one.
 * Configure has had tabs since it was built; this is the same answer.
 *
 * The board tab keeps one key across modes so the remembered tab survives
 * moving between games, and only its label changes.
 */
const TRACK_BOARD_LABEL = {
  battleships: 'Boards', bingo: 'Cards', snakes: 'Board', territory: 'Map',
};

function trackTabsFor(game, { hasWom, hasScreens }) {
  if (isChallengeGame(game)) {
    return [
      { key: 'ladder', label: 'Ladder' },
      { key: 'entries', label: 'Entries' },
      // Nothing to show for an event scored only on what players send in.
      ...(hasWom ? [{ key: 'wom', label: 'Wise Old Man' }] : []),
    ];
  }
  return [
    { key: 'board', label: TRACK_BOARD_LABEL[game.mode] ?? 'Board' },
    { key: 'evidence', label: 'Evidence' },
    ...(game.mode === 'battleships' ? [{ key: 'pets', label: 'Pets and jars' }] : []),
    // TeamScreens renders nothing without teams, and a tab onto nothing is
    // worse than no tab.
    ...(hasScreens ? [{ key: 'screens', label: 'Team screens' }] : []),
  ];
}

/**
 * What revoking a screenshot does, which is the one thing about this screen
 * nobody would guess. One sentence per mode, because the consequence differs:
 * a bingo tile comes back off a count, a territory place changes hands.
 */
const EVIDENCE_RULE = {
  battleships: 'There is nothing to approve — attaching the required number is what lets a team fire. '
    + 'This is for settling a dispute, or catching one.',
  bingo: 'There is nothing to approve — attaching the required number is what completes a tile. '
    + 'Revoking one can take a tile back off a team’s count.',
  snakes: 'There is nothing to approve — attaching what the tile asks for is what completes it. '
    + 'Revoking one can take a tile back off a team.',
  territory: 'There is nothing to approve — the screenshot that meets a task is what captures the place. '
    + 'Revoking one can hand a place back.',
};

function ConfigTabs({ tab, onPick, badge, tabs = CONFIG_TABS, label = 'Configure' }) {
  return (
    <div className="tabs config-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => {
        const n = badge ? badge(t.key) : 0;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'on' : ''}
            onClick={() => onPick(t.key)}
          >
            {t.label}
            {n > 0 && <span className="admin-nav-badge" title={`${n} still to do`}>{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Every screenshot in one game.
 *
 * One component for what used to be four near-identical copies, one per mode,
 * differing only in the sentence about what revoking does.
 */
function EvidenceCard({ gameId, mode }) {
  return (
    <section className="card">
      <CardHead
        title="Evidence"
        lead="Every screenshot submitted, newest first, with who submitted it."
        more={EVIDENCE_RULE[mode]}
      />
      <EvidenceReview gameId={gameId} mode={mode} />
    </section>
  );
}

/**
 * What is left before an event can start.
 *
 * WHAT IT REPLACES. A flat run of six rows, each a tick, a label, a count and
 * a line of prose -- and five red crosses on a freshly created event, which
 * reads as five things gone wrong rather than five things not done yet. The
 * count of what was outstanding came last, under the list, so the one fact an
 * organiser opens this pane for was the last thing they reached.
 *
 * So: the score leads, the steps are grouped by whether they are work or
 * reference, and every line whose prose used to say "on the Board tab" now
 * carries a button that goes there. A step not taken is a hollow circle, not
 * a cross; nothing here has failed.
 */
function SetupChecklist({ checks, status, onGo }) {
  if (status !== 'setup' && status !== 'placement') return null;

  const required = checks.filter((c) => c.required);
  const done = required.filter((c) => c.ok);
  const todo = required.filter((c) => !c.ok);
  const optional = checks.filter((c) => !c.required);
  // Guard the empty case rather than dividing by it: a mode could define no
  // required checks at all, and a NaN width is an invisible bar.
  const pct = required.length ? Math.round((done.length / required.length) * 100) : 100;

  return (
    <div className="checklist">
      <header className="checklist-head">
        <p className="checklist-score">
          <strong>{done.length}</strong> of {required.length} done
        </p>
        <div
          className="checklist-bar"
          role="img"
          aria-label={`${done.length} of ${required.length} steps done`}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="checklist-say">
          {todo.length === 0
            ? 'Everything needed is in place.'
            : `${todo.length} thing${todo.length === 1 ? '' : 's'} still to do before this game can start.`}
        </p>
      </header>

      {todo.length > 0 && <CheckGroup title="Still to do" items={todo} onGo={onGo} />}
      {done.length > 0 && <CheckGroup title="Done" items={done} onGo={onGo} quiet />}
      {optional.length > 0 && <CheckGroup title="Optional" items={optional} onGo={onGo} />}
    </div>
  );
}

/**
 * One group of steps.
 *
 * `quiet` is the finished group: still worth showing, because an organiser
 * wants to know the roster really is in, but it is reference rather than work
 * and should not compete with the group that is.
 */
function CheckGroup({ title, items, onGo, quiet = false }) {
  return (
    <section className={`check-group${quiet ? ' quiet' : ''}`}>
      <h4>{title}</h4>
      <ul>
        {items.map((c) => {
          // Fleets have no tab -- captains place them on their own screens --
          // so that row gets prose and no button, which is the honest answer.
          const where = CONFIG_TABS.find((t) => t.key === CHECK_TAB[c.key])?.label ?? null;
          return (
            <li key={c.key} className={c.ok ? 'ok' : (c.required ? 'todo' : 'optional')}>
              <span className="tick" aria-hidden="true">{c.ok ? '✓' : (c.required ? '○' : '–')}</span>
              <span className="what">{c.label}</span>
              <span className="detail">{c.detail}</span>
              {where && onGo && !c.ok ? (
                <button type="button" className="ghost check-go" onClick={() => onGo(c.key)}>
                  {where} →
                </button>
              ) : <span />}
              {!c.ok && c.fix && <span className="fix">{c.fix}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/*
 * One line each, and near enough the same length.
 *
 * These ran from eight words to thirty-three, so the five boxes came out at
 * five different heights -- which is what you see first, before you have read
 * a word of any of them. The job here is to tell five modes apart, not to
 * teach one: whichever you pick, the step after it explains itself, and
 * Configure explains it again.
 */
const MODES = [
  { key: 'battleships', label: 'Battleships', blurb: 'Two teams, hidden fleets, one shot per tile.' },
  { key: 'bingo', label: 'Bingo', blurb: 'Any number of teams on one card. Most tiles wins.' },
  { key: 'snakes', label: 'Snakes & Ladders', blurb: 'Teams race up a 100-tile board, snakes and all.' },
  { key: 'territory', label: 'Territory', blurb: 'Teams take ground on the OSRS map. Biggest empire wins.' },
  { key: 'challenge', label: 'Challenge', blurb: 'No board. Boss, raid or skill of the week.' },
];

/** The screen name of a mode, for a sentence that has only its key. */
const labelOfMode = (key) => MODES.find((m) => m.key === key)?.label ?? key;

/**
 * Create a game of either mode.
 *
 * Battleships keeps its fixed two team fields. Bingo grows a row per team,
 * because "how many teams" is exactly the question a bingo organiser is
 * answering here, and a count field followed by N names is two steps for one.
 */
function ModePicker({ modeChoices, mode, onPick }) {
  return (
    /* The step has already asked "What kind of event is this?" above it, so
       the legend names the group without saying it a second time. */
    <PickSet label="Game mode" even>
      {modeChoices.map((m) => (
        <Pick
          key={m.key}
          name="game-mode"
          checked={mode === m.key}
          onChange={() => onPick(m.key)}
          title={m.label}
          blurb={m.blurb}
        />
      ))}
    </PickSet>
  );
}

/**
 * Where you are in the wizard, and how much of it is left.
 *
 * A step you have finished is a button, because going back to change the name
 * should not mean pressing Back twice. A step you have not reached is not,
 * because its questions depend on answers you have not given yet.
 */
function WizardSteps({ steps, at, onGo }) {
  return (
    <ol className="wizard-steps">
      {steps.map((s, i) => {
        const mark = (
          <>
            <span className="wizard-step-mark" aria-hidden="true">{i < at ? '\u2713' : i + 1}</span>
            <span className="wizard-step-label">{s.label}</span>
          </>
        );
        return (
          <li key={s.key} className={i === at ? 'on' : i < at ? 'done' : ''}>
            {i < at
              ? <button type="button" onClick={() => onGo(i)}>{mark}</button>
              : <span aria-current={i === at ? 'step' : undefined}>{mark}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Creating an event, one question at a time.
 *
 * WHY A WIZARD. This was a single card asking for the mode, the name, the
 * card size, every team name and both times at once. The trouble is that the
 * first of those answers decides which of the others even apply -- a bingo
 * wants a card size and any number of teams, battleships wants exactly two
 * and no size at all -- so fields appeared and vanished underneath the
 * organiser as they filled it in, and they were naming teams before the kind
 * of event had settled.
 *
 * Three steps, because three is what the questions genuinely divide into:
 * what kind of event this is, what it is called and when it runs, and who is
 * playing. Each step asks one thing, and nothing on screen belongs to a
 * question that has not been reached.
 */
function NewGame({ busy, onCreate, modeChoices = MODES }) {
  // Battleships unless the organiser cannot run it, in which case the first
  // mode they can: a radio group with nothing selected has no sensible save.
  const [mode, setMode] = useState(
    modeChoices.some((m) => m.key === 'battleships') ? 'battleships' : modeChoices[0]?.key,
  );
  const [name, setName] = useState('');
  const [teamNames, setTeamNames] = useState(['', '']);
  const [gridSize, setGridSize] = useState(5);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [at, setAt] = useState(0);

  const bingo = mode === 'bingo';
  const snakes = mode === 'snakes';
  const territory = mode === 'territory';
  const challenge = mode === 'challenge';
  // Every mode but battleships takes any number of teams.
  const multi = bingo || snakes || territory;
  const names = multi ? teamNames : teamNames.slice(0, 2);
  const filled = names.map((n) => n.trim()).filter(Boolean);
  // Case-insensitive, like the server: "Alpha" and "alpha" read as one team in
  // the standings, so they are refused here before they are refused there.
  const duplicate = new Set(filled.map((n) => n.toLowerCase())).size !== filled.length;
  const teamsReady = !duplicate
    && (multi ? filled.length >= 1 : filled.length === 2 && names.every((n) => n.trim()));
  const ready = name.trim() && teamsReady;

  const setTeam = (i, value) => setTeamNames((prev) => prev.map((n, j) => (j === i ? value : n)));

  // A challenge asks an entirely different second question -- what it is
  // scored on, rather than how big the board is -- so it keeps its own body
  // and its own Create button. It still sits inside the wizard, as step two
  // of two, rather than replacing the screen the moment the mode changes.
  const steps = challenge
    ? [{ key: 'kind', label: 'Kind' }, { key: 'details', label: 'Details' }]
    : [{ key: 'kind', label: 'Kind' },
       { key: 'details', label: 'Details' },
       { key: 'teams', label: 'Teams' }];
  const here = Math.min(at, steps.length - 1);
  const step = steps[here].key;

  // What has to be true before the next step is worth showing. A mode is
  // always selected, so the first step is never a dead end.
  const canGoOn = step === 'kind' || (step === 'details' && Boolean(name.trim()));
  const go = (next) => setAt(Math.max(0, Math.min(next, steps.length - 1)));

  return (
    <section className="card wizard">
      <h2>New event</h2>

      <WizardSteps steps={steps} at={here} onGo={go} />

      <div className="wizard-body">
        {step === 'kind' && (
          <>
            <p className="wizard-ask">What kind of event is this?</p>
            <ModePicker modeChoices={modeChoices} mode={mode} onPick={setMode} />
          </>
        )}

        {step === 'details' && challenge && (
          <ChallengeNewGame
            busy={busy}
            onCreate={async (payload) => worked(await onCreate(payload))}
          />
        )}

        {step === 'details' && !challenge && (
          <>
            <p className="wizard-ask">What is it called, and when does it run?</p>

            {/* One grid, not a row per kind of field: what a mode asks for
                differs, and two fixed rows left whichever field a mode did not
                want as a gap in the middle of the form. */}
            <div className="wizard-fields">
              <label className="field-wide">Event name
                <input value={name} onChange={(e) => setName(e.target.value)}
                       placeholder={bingo ? 'Clan Bingo' : snakes ? 'Snakes and Ladders' : territory ? 'Conquest of Gielinor' : 'Battleships V4'} />
              </label>
              {bingo && (
                <label>Card size
                  <select value={gridSize} onChange={(e) => setGridSize(Number(e.target.value))}>
                    {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                      <option key={n} value={n}>{n}×{n} — {n * n} tiles</option>
                    ))}
                  </select>
                </label>
              )}
              {/* Optional: teams can be rostered and fleets placed well before
                  this moment. Left blank, players just see "time to be
                  announced" until one is set from Configure. */}
              <label><span>Start time <span className="muted">(optional)</span></span>
                <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              </label>
              {(bingo || territory) && (
                <label
                  title={territory
                    ? 'The biggest empire at this moment wins.'
                    : 'Without an end time, the game runs until a team fills the card.'}
                >
                  <span>End time <span className="muted">(optional)</span></span>
                  <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
                </label>
              )}
            </div>

            {/* These say what happens if a time is left blank, so they belong
                beside the times rather than at the foot of the whole form. */}
            {bingo && (
              <p className="muted new-game-note">
                Without an end time, the game runs until a team fills the card.
              </p>
            )}
            {territory && (
              <p className="muted new-game-note">
                The whole OSRS map: 64 places, one task each, starting empty. Up to six
                teams, each with its own home. The biggest empire at the end time wins.
              </p>
            )}
            {snakes && (
              <p className="muted new-game-note">
                Always the 100-tile board. It ends when a team completes tile 100, or
                when you end it from Configure.
              </p>
            )}
          </>
        )}

        {step === 'teams' && (
          <>
            <p className="wizard-ask">
              {multi
                ? 'Who is playing? Add as many teams as you need.'
                : 'Battleships is played by exactly two teams.'}
            </p>

            {/* .new-game-fields: every field keeps its own width rather than
                stretching across the card, so adding a team adds one more
                field beside the others instead of widening them all. */}
            <div className="row new-game-fields">
              {names.map((n, i) => (
                <label key={i} className="field-team">
                  {`Team ${i + 1}`}
                  <span className="team-name-field">
                    <input
                      value={n}
                      onChange={(e) => setTeam(i, e.target.value)}
                      placeholder={`Team ${['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'][i] ?? i + 1}`}
                    />
                    {multi && names.length > 1 && (
                      <button
                        type="button" className="ghost" aria-label={`Remove team ${i + 1}`}
                        onClick={() => setTeamNames((prev) => prev.filter((_, j) => j !== i))}
                      >
                        {'\u2715'}
                      </button>
                    )}
                  </span>
                </label>
              ))}
              {multi && (
                <button type="button" className="ghost" onClick={() => setTeamNames((prev) => [...prev, ''])}>
                  + Another team
                </button>
              )}
            </div>
            {duplicate && <p className="error">Two teams have the same name.</p>}
          </>
        )}
      </div>

      <div className="wizard-foot">
        <button type="button" className="ghost" disabled={here === 0} onClick={() => go(here - 1)}>
          Back
        </button>
        {/* The challenge body carries its own Create button, so the wizard
            does not put a second one beside it. Back stays either way --
            changing your mind about the kind of event should not mean
            noticing that the step pills are clickable. */}
        {challenge && step === 'details' ? null : step === 'teams' ? (
          <button
            disabled={busy || !ready}
            onClick={async () => {
              const result = await onCreate({
                name: name.trim(),
                mode,
                teams: filled,
                gridSize: bingo ? gridSize : territory ? TASK_GRID : 10,
                startsAt: startsAt ? new Date(startsAt).toISOString() : null,
                endsAt: (bingo || territory) && endsAt ? new Date(endsAt).toISOString() : null,
              });
              if (worked(result)) {
                setName(''); setTeamNames(['', '']); setStartsAt(''); setEndsAt(''); setAt(0);
              }
            }}
          >
            Create event
          </button>
        ) : (
          <button type="button" disabled={!canGoOn} onClick={() => go(here + 1)}>
            Next
          </button>
        )}
      </div>
    </section>
  );
}

/** Configure-pane counterpart to the "Start time" field on New game — sets or
 * clears `starts_at` on a game that already exists. Reports through the
 * console's own error/notice banner rather than a local receipt, same as
 * every other button on this pane. */
function StartTimeEditor({ game, busy, onSave }) {
  return (
    <TimeEditor
      label="Start time"
      hint="(shown to players as a countdown)"
      value={game.starts_at}
      resetKey={game.id}
      busy={busy}
      onSave={onSave}
    />
  );
}

/**
 * datetime-local wants "YYYY-MM-DDTHH:mm" in the input's own timezone, which
 * toISOString (UTC) does not give — build it from local fields.
 */
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** One timestamp on a game, set or cleared. Shared by the start and end time. */
function TimeEditor({ label, hint, value: saved, resetKey, busy, onSave }) {
  const [value, setValue] = useState(() => toLocalInput(saved));

  useEffect(() => { setValue(toLocalInput(saved)); }, [resetKey, saved]);

  const nextIso = value ? new Date(value).toISOString() : null;
  // Compared at minute precision: the input cannot hold seconds, so a saved
  // value with any would otherwise look edited the moment the form loads.
  const changed = value !== toLocalInput(saved);

  return (
    <div className="row start-time-editor">
      <label>{label} <span className="muted">{hint}</span>
        <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <button disabled={busy || !changed} onClick={() => onSave(nextIso)}>
        Save {label.toLowerCase()}
      </button>
      {saved && (
        <button className="ghost" disabled={busy} onClick={() => { setValue(''); onSave(null); }}>
          Clear
        </button>
      )}
    </div>
  );
}

/**
 * The free-player list for one team: a search field over a checkbox list,
 * so drafting ten people onto a team is ten ticks and one press rather than
 * ten repeats of "open the picker, find the name, press Add". Selection is
 * local to this component and keyed by team, not lifted to Roster — once a
 * batch lands the picker forgets it, same as the old single-select did.
 */
/**
 * Every player not on a team in this game, listed once, with the team to add
 * the ticked ones to picked at the bottom. It used to be one copy of this list
 * under each team -- the same 46 names twice in a two-team game, and eight
 * times in an eight-team bingo.
 */
function FreePlayerPicker({ teams, free, busy, onAddMany }) {
  const [query, setQuery] = useState('');
  const [checked, setChecked] = useState(() => new Set());
  const [teamId, setTeamId] = useState('');
  // The chosen team, or the first one while none is chosen -- or the chosen
  // one has just been deleted.
  const team = teams.find((t) => t.id === teamId) ?? teams[0] ?? null;

  const q = query.trim().toLowerCase();
  const matches = q
    ? free.filter((p) => p.display_name.toLowerCase().includes(q))
    : free;
  // Stale ids (picked, then filtered out by a new search, or added by someone
  // else in another tab) never make it into the batch below — this is
  // recomputed against the live `free` list every render, not trusted from
  // whenever the tick happened.
  const selected = matches.filter((p) => checked.has(p.id));
  const allMatchesChecked = matches.length > 0 && selected.length === matches.length;

  function toggle(id) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllMatches() {
    setChecked((prev) => {
      const next = new Set(prev);
      if (allMatchesChecked) matches.forEach((p) => next.delete(p.id));
      else matches.forEach((p) => next.add(p.id));
      return next;
    });
  }

  return (
    <div className="team-add free-players">
      <h3>Players without a team <span className="team-count">{free.length}</span></h3>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${free.length} player${free.length === 1 ? '' : 's'}…`}
        disabled={free.length === 0}
      />
      {free.length === 0 ? (
        <p className="muted">Everyone available is already on a team.</p>
      ) : (
        <>
          <ul className="team-add-list">
            {matches.map((p) => (
              <li key={p.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={checked.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                  {p.display_name}
                </label>
              </li>
            ))}
            {matches.length === 0 && (
              <li className="muted">Nothing matches “{query}”.</li>
            )}
          </ul>
          <div className="team-add-footer">
            <label className="team-add-all">
              <input
                type="checkbox"
                checked={allMatchesChecked}
                onChange={toggleAllMatches}
                disabled={matches.length === 0}
              />
              Select all{q && ' matching'}
            </label>
            {team ? (
              <span className="row">
                <label className="team-add-to">
                  Add to
                  <select value={team.id} onChange={(e) => setTeamId(e.target.value)} aria-label="Team to add them to">
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
                <button
                  disabled={busy || selected.length === 0}
                  onClick={() => {
                    onAddMany(team.id, selected.map((p) => p.id));
                    setChecked(new Set());
                  }}
                >
                  Add {selected.length > 0 ? `${selected.length} ` : ''}to {team.name}
                </button>
              </span>
            ) : (
              <span className="muted">Add a team first.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Set a player's password directly — the only account-recovery path in an app
 * with no real mailbox to send a reset link to. Deliberately its own section
 * rather than folded into Roster: it has nothing to do with any one game, and
 * everyone who plays across every game is a candidate, not just this game's
 * two teams.
 */
function Accounts({ profiles, busy, confirm, onReset, onDelete, resets, deletions, onOpenLog }) {
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState(null);

  // One feed rather than two disclosures — the whole point of the log is a
  // quick "did I actually do that", and reset vs delete is one word to add,
  // not a reason to make an admin open two panels to find an entry.
  const activity = [
    ...resets.map((r) => ({ ...r, kind: 'reset' })),
    ...deletions.map((d) => ({ ...d, kind: 'delete' })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // Same reasoning as the roster picker: an admin account is not a player.
  const players = profiles.filter((p) => !p.is_admin);
  const q = query.trim().toLowerCase();
  const matches = q ? players.filter((p) => p.display_name.toLowerCase().includes(q)) : players;

  return (
    <section className="card">
      <CardHead
        title="Accounts"
        lead="Reset a player’s password, or remove an account entirely."
        more={'Deleting takes their profile, their team membership and any locked-in tiles with it, and it '
          + 'cannot be undone — which is what it is for: a troll signup with no place in a game. The confirm '
          + 'asks you to type the name before it will go through.'}
      />

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${players.length} player${players.length === 1 ? '' : 's'}…`}
        disabled={players.length === 0}
      />
      <ul className="account-list">
        {matches.map((p) => (
          <li key={p.id}>
            <span>{p.display_name}</span>
            <span className="account-actions">
              <button className="ghost" disabled={busy} onClick={() => setTarget(p)}>
                Reset password
              </button>
              <button
                className="danger ghost"
                disabled={busy}
                onClick={async () => {
                  // Same guard as deleting a game: hold the confirm button
                  // disabled until the name is typed, so a stray click can
                  // never wipe a real player's account.
                  if (!(await confirm(
                    `Delete ${p.display_name}'s account — their profile, team membership and any locked-in tiles.`,
                    { title: 'Delete this account?', confirmLabel: 'Delete it', danger: true, requireText: p.display_name }
                  ))) return;
                  onDelete(p.id, p.display_name);
                }}
              >
                Delete
              </button>
            </span>
          </li>
        ))}
        {matches.length === 0 && <li className="muted">Nothing matches “{query}”.</li>}
      </ul>

      {/* Closed by default: opening Accounts to reset one password should not
          also hand back a scrollable history every single time. */}
      <details className="account-log" onToggle={(e) => { if (e.target.open) onOpenLog(); }}>
        <summary>Recent activity</summary>
        {activity.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <ul>
            {activity.map((a) => (
              <li key={`${a.kind}-${a.id}`}>
                <span>
                  {a.kind === 'delete' ? 'Deleted ' : 'Reset password for '}
                  <strong>{a.target_display_name}</strong>
                </span>
                <span>{new Date(a.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </details>

      {target && (
        <PasswordResetDialog
          player={target}
          busy={busy}
          onCancel={() => setTarget(null)}
          onSave={async (password) => {
            const result = await onReset(target.id, password);
            if (worked(result)) setTarget(null);
          }}
        />
      )}
    </section>
  );
}

/**
 * Hand an account the modes it may run.
 *
 * A moderator holds modes, not games: tick Challenge and they run every
 * challenge on the site, including ones another organiser set up. There is no
 * narrower grant to offer — `may_manage_game` joins `moderator_modes` to the
 * game's mode and stops there — so the screen says so rather than implying a
 * per-event permission that does not exist.
 *
 * Admins are not listed. `admin_set_moderator_modes` refuses them, because
 * `is_admin()` already covers every mode and unticking a box for one would
 * read as taking something away while taking nothing away.
 */
function ModeratorRoles({ profiles, moderators, busy, confirm, onSave }) {
  // Rows the admin has touched but not saved. A player picked from the list
  // below starts here with nothing ticked; an existing moderator's row lands
  // here the moment a box changes, and leaves again once Save goes through.
  const [draft, setDraft] = useState({});

  const saved = new Map(moderators.map((m) => [m.profile_id, m.modes ?? []]));
  const nameOf = (id) => profiles.find((p) => p.id === id)?.display_name
    ?? moderators.find((m) => m.profile_id === id)?.display_name
    ?? 'unknown';

  const rows = [...new Set([...saved.keys(), ...Object.keys(draft)])]
    .map((id) => ({
      id,
      name: nameOf(id),
      was: saved.get(id) ?? [],
      now: draft[id] ?? saved.get(id) ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // An admin has nothing to be granted, and anyone already on screen is not a
  // candidate twice over.
  const candidates = profiles
    .filter((p) => !p.is_admin && !saved.has(p.id) && !draft[p.id])
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  const toggle = (row, key, on) => setDraft((d) => ({
    ...d,
    [row.id]: on ? [...row.now, key] : row.now.filter((k) => k !== key),
  }));

  const forget = (id) => setDraft(({ [id]: _dropped, ...rest }) => rest);

  const changed = (row) => row.now.length !== row.was.length
    || row.now.some((k) => !row.was.includes(k));

  return (
    <section className="card">
      <CardHead
        title="Who runs what"
        lead="A moderator runs events of the modes you tick, with the same console you are looking at."
        more={(
          <>
            Making them, starting them, judging the evidence and ending them. They
            hold the <em>mode</em> rather than one event, so ticking Challenge hands
            them every challenge on the site, including ones somebody else set up.
            Wiping a game’s progress, the suggestion queue and this screen stay yours.
          </>
        )}
      />

      <ul className="role-list">
        {rows.map((row) => (
          <li key={row.id}>
            <span className="role-name">{row.name}</span>
            <span className="role-modes">
              {/* Chips, not boxes: one row per moderator with five modes on
                  it, where a column of boxes would be the wrong shape. Same
                  marks and same gold, so it still reads as the one way of
                  picking something. */}
              {MODES.map((m) => (
                <PickChip
                  key={m.key}
                  checked={row.now.includes(m.key)}
                  disabled={busy}
                  onChange={(e) => toggle(row, m.key, e.target.checked)}
                  label={m.label}
                />
              ))}
            </span>
            {row.was.length === 0 && row.now.length === 0 ? (
              // Picked by mistake. Nothing has been sent, so this is a way off
              // the screen rather than an action.
              <button className="ghost" disabled={busy} onClick={() => forget(row.id)}>
                Remove
              </button>
            ) : (
              <button
                disabled={busy || !changed(row)}
                onClick={async () => {
                  // Unticking the last box demotes them, and the row then
                  // vanishes — worth asking first, because nothing left on
                  // screen would say what had happened.
                  if (row.now.length === 0 && !(await confirm(
                    `${row.name} goes back to being an ordinary player and loses the console.`,
                    { title: `Take every mode from ${row.name}?`, confirmLabel: 'Take them', danger: true }
                  ))) return;
                  const result = await onSave(row.id, row.now, row.name);
                  if (worked(result)) forget(row.id);
                }}
              >
                Save
              </button>
            )}
          </li>
        ))}
        {rows.length === 0 && (
          <li className="muted">Nobody runs anything yet — every event is an admin’s to run.</li>
        )}
      </ul>

      <label className="role-add">
        Add a moderator
        <select
          value=""
          disabled={busy || candidates.length === 0}
          onChange={(e) => { if (e.target.value) setDraft((d) => ({ ...d, [e.target.value]: [] })); }}
        >
          <option value="">Pick an account…</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>{p.display_name}</option>
          ))}
        </select>
      </label>
    </section>
  );
}

/** Add one more team to a bingo. Battleships is always exactly two. */
function AddTeam({ busy, onAdd }) {
  const [name, setName] = useState('');
  return (
    <div className="row" style={{ marginTop: '.8rem' }}>
      <label>New team<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Team Charlie" /></label>
      <button
        disabled={busy || !name.trim()}
        onClick={async () => {
          const result = await onAdd(name.trim());
          if (worked(result)) setName('');
        }}
      >
        Add team
      </button>
    </div>
  );
}

function Roster({ bingo, snakes = false, gameTeams, profiles, members, busy, onSet, onRemove, onAddMany }) {
  const taken = new Set(
    members
      .filter((m) => gameTeams.some((g) => g.id === m.team_id))
      .map((m) => m.profile_id)
  );
  // Admin accounts are run-the-event accounts, not players — keep them
  // out of the picker so nobody drafts the organiser onto a team.
  const free = profiles.filter((p) => !taken.has(p.id) && !p.is_admin);
  return (
    <section className="card">
      <h2>Roster</h2>
      <div className="columns">
        {gameTeams.map((t) => {
          // Captains first: they're who an organiser is scanning for when
          // something needs fixing mid-event, and a long roster shouldn't
          // make them hunt. Sort is stable, so within each group (captain,
          // then everyone else) members stay in the order they joined.
          const mine = members
            .filter((m) => m.team_id === t.id)
            .sort((a, b) => (b.role === 'captain') - (a.role === 'captain'));
          return (
            <div key={t.id}>
              <h3>{t.name} <span className="team-count">{mine.length}</span></h3>
              <ul className="roster">
                {mine.map((m) => {
                  const p = profiles.find((x) => x.id === m.profile_id);
                  return (
                    <li key={m.profile_id}>
                      <span className={m.role === 'captain' ? 'captain' : ''}>
                        {p?.display_name ?? 'unknown'}{m.role === 'captain' && ' · captain'}
                      </span>
                      <span className="row">
                        <button
                          className="ghost" disabled={busy}
                          onClick={() => onSet(t.id, m.profile_id, m.role === 'captain' ? 'member' : 'captain')}
                        >
                          {m.role === 'captain' ? 'Demote' : 'Make captain'}
                        </button>
                        <button className="danger" disabled={busy} onClick={() => onRemove(t.id, m.profile_id)}>
                          Remove
                        </button>
                      </span>
                    </li>
                  );
                })}
                {mine.length === 0 && <li className="muted">Nobody yet.</li>}
              </ul>
            </div>
          );
        })}
      </div>
      <FreePlayerPicker teams={gameTeams} free={free} busy={busy} onAddMany={onAddMany} />
      <p className="muted" style={{ marginTop: '.8rem' }}>
        Players appear here once they have signed up on the login screen.
        {snakes
          ? ' A captain can rename their team; anyone on a team can roll and complete its tiles.'
          : bingo
          ? ' A captain can rename their team; anyone on a team can complete its tiles.'
          : ' Only a captain (or you) can place that team’s fleet.'}
      </p>
    </section>
  );
}
