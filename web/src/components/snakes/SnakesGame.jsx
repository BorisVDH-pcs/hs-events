import { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion.js';
import { isLadder, jumpFrom, movePath, resultText, LAST_TILE } from '../../lib/snakes.js';
import { tileProgressText } from '../../lib/tileProgress.js';
import EventFeed from '../EventFeed.jsx';
import TeamNameEditor from '../TeamNameEditor.jsx';
import StartTimeBadge from '../StartTimeBadge.jsx';
import TileIcon from '../TileIcon.jsx';
import TileInfo from '../TileInfo.jsx';
import SnakesBoard from './SnakesBoard.jsx';
import SnakesStandings from './SnakesStandings.jsx';
import SnakesTurnPanel from './SnakesTurnPanel.jsx';

// How long a marker rests on each square it walks over, and how long it takes
// to slide down a snake. Kept in step with the transitions in styles.css.
const STEP_MS = 190;
const SLIDE_MS = 700;

/**
 * The player's view of a Snakes and Ladders game.
 *
 * Same three columns as the other modes: standings and feed on the left, the
 * board in the middle, and on the right the one thing my team can do next --
 * roll, or finish the tile it is standing on.
 *
 * Every move is the server's (snakes_roll and friends); this page only shows
 * it. The marker is walked there square by square from the move's
 * `team_moved` event, so a roll reads as a roll and a snake as a snake.
 */
export default function SnakesGame({
  game, teams, myTeamId, myRole, tiles, standings, jumps, events, evidence, onRefresh,
}) {
  const [selected, setSelected] = useState(null);  // a tile number pressed on the board
  const reduced = usePrefersReducedMotion();
  const { shown, sliding } = useMarkerWalk(teams, events, reduced);

  const isPreparation = game.status === 'setup' || game.status === 'placement';
  const isFinished = game.status === 'finished';
  const myTeam = teams.find((t) => t.id === myTeamId) ?? null;
  const lastMove = events.find((e) => e.type === 'team_moved' && e.team_id === myTeamId) ?? null;
  const onSelect = (n) => setSelected((s) => (s === n ? null : n));

  const board = (revealed) => (
    <SnakesBoard
      tiles={tiles}
      teams={teams}
      myTeamId={myTeamId}
      jumps={jumps}
      shown={shown}
      sliding={sliding}
      selected={selected}
      onSelect={onSelect}
      revealed={revealed}
    />
  );

  if (isPreparation) {
    return (
      <>
        {myTeamId && <StartTimeBadge startsAt={game.starts_at} />}
        {myRole === 'captain' && myTeam && (
          <section className="card">
            <h2>Your team</h2>
            <TeamNameEditor team={myTeam} onRenamed={() => onRefresh?.()} />
          </section>
        )}
        <section className="card">
          <h2>{game.name}</h2>
          <p className="muted">
            Snakes and Ladders: 100 tiles along a winding path. Roll the die, do the tile you
            land on, roll again. Land at the foot of a ladder and you climb it; land on a
            snake&rsquo;s head and you slide down to its tail. The tasks are revealed when the
            organiser starts the game.
          </p>
        </section>
        <section className="boards snakes-prep">{board(false)}</section>
        <EventFeed events={events} teams={teams} myTeamId={myTeamId} />
      </>
    );
  }

  const result = resultText(game, teams);
  const browsing = selected != null && selected !== myTeam?.board_tile;

  return (
    <>
      {result && <p className="banner">{result}</p>}

      <section className="boards">
        <div className="board-layout">
          <div className="feed-col">
            <SnakesStandings standings={standings} myTeamId={myTeamId} onFind={setSelected} />
            <EventFeed events={events} teams={teams} myTeamId={myTeamId} />
          </div>

          <div className="board-col">
            <div className="tabs board-tabs snakes-tabs">
              <button className="on" aria-current="true">
                Board{myTeam ? ` · ${myTeam.board_tile ? `tile ${myTeam.board_tile}` : 'at Start'}` : ''}
              </button>
              {myTeam?.board_tile > 0 && (
                <button onClick={() => setSelected(myTeam.board_tile)}>Find my team</button>
              )}
            </div>
            {board(true)}
          </div>

          <div className="side-col">
            {browsing ? (
              <SnakesTilePanel
                position={selected}
                tile={tiles.find((t) => t.position === selected) ?? null}
                jumps={jumps}
                teams={teams}
                myTeamId={myTeamId}
                onClose={() => setSelected(null)}
              />
            ) : (
              <SnakesTurnPanel
                game={game}
                team={myTeam}
                tiles={tiles}
                evidence={evidence}
                lastMove={lastMove}
                onRefresh={onRefresh}
              />
            )}
            {!isFinished && <HowItWorks />}
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * A square someone pressed to read, that is not where my team stands. The
 * whole board is open to read; only the square you are on takes screenshots.
 *
 * A snake's head or a ladder's foot has no task, so it gets a few words about
 * where it leads instead.
 */
function SnakesTilePanel({ position, tile, jumps, teams, myTeamId, onClose }) {
  const jump = jumpFrom(jumps, position);
  if (jump || !tile) {
    const up = jump && isLadder(jump);
    return (
      <section className="bingo-tile-panel" aria-labelledby="snakes-tile-title">
        <div className="bingo-tile-head snakes-jump-head">
          <div className="slot-art snakes-jump-art" aria-hidden="true">{jump ? (up ? '🪜' : '🐍') : position}</div>
          <div>
            <h2 id="snakes-tile-title">
              {jump ? (up ? 'Bottom of a ladder' : 'A snake’s head') : `Tile ${position}`}
            </h2>
            <p className="muted">Tile {position}</p>
          </div>
          <button className="ghost" onClick={onClose} aria-label="Close tile">Close</button>
        </div>
        {jump ? (
          <p className={up ? 'snakes-ladder-note' : 'snakes-head-note'}>
            {up
              ? `Land here and you climb straight up to tile ${jump.to}.`
              : `Land here and you slide straight down to tile ${jump.to}.`}
            {' '}There is no task on this tile — nobody ever stops on it.
          </p>
        ) : (
          <p className="muted">This tile has no task yet.</p>
        )}
      </section>
    );
  }

  const here = teams.filter((t) => t.board_tile === tile.position);
  const done = tile.claim_status === 'completed';
  return (
    <section className="bingo-tile-panel" aria-labelledby="snakes-tile-title">
      <div className="bingo-tile-head">
        <div className="slot-art">
          <TileIcon slug={tile.icon} fallback={<span className="slot-art-coord">{tile.position}</span>} />
        </div>
        <div>
          <h2 id="snakes-tile-title">
            {tile.name}
            <TileInfo tile={tile} />
          </h2>
          <p className="muted">
            Tile {tile.position}
            {done ? ' · Your team completed it ✓' : tile.evidence_count > 0 ? ` · ${tileProgressText(tile)}` : ''}
          </p>
        </div>
        <button className="ghost" onClick={onClose} aria-label="Close tile">Close</button>
      </div>
      {tile.position === LAST_TILE && (
        <p className="snakes-finish-note">The finish. The first team to complete it wins.</p>
      )}
      {here.length > 0 && (
        <p className="muted">
          On this tile now: {here.map((t) => t.name + (t.id === myTeamId ? ' (you)' : '')).join(', ')}.
        </p>
      )}
      <p className="muted">
        You can read any tile. Screenshots go on the tile your team is standing on.
      </p>
    </section>
  );
}

function HowItWorks() {
  return (
    <details className="bingo-tile-panel snakes-how">
      <summary>How it works</summary>
      <ul>
        <li>Roll the die and move that many tiles. Anyone on the team can roll.</li>
        <li>Complete the tile you land on before you roll again.</li>
        <li>Land at the foot of a ladder and you climb to its top.</li>
        <li>Land on a snake&rsquo;s head and you slide down to its tail.</li>
        <li>Ladders and snakes only work when you land on them — passing over does nothing.</li>
        <li>Tiles your team has already completed are skipped.</li>
        <li>Overshoot 100 and you bounce back by the extra.</li>
        <li>A rollback moves you back a few tiles, to get off a tile you would rather not do.</li>
        <li>The first team to complete tile 100 wins.</li>
      </ul>
    </details>
  );
}

/**
 * Where to draw each team's marker right now.
 *
 * The server answers a roll with the square the team ends on, but a marker
 * that jumps there tells nobody what happened. So when a team's newest
 * `team_moved` event changes, its marker is walked along movePath(payload):
 * a square at a time for the die, a slide down each snake. Every other change
 * -- the first load, a missed event, reduced motion -- puts it straight where
 * the server says.
 *
 * Returns { shown, sliding }: tile per team id, and which markers are on a
 * slide (SnakesBoard gives those a longer transition).
 */
function useMarkerWalk(teams, events, reduced) {
  const [shown, setShown] = useState(
    () => Object.fromEntries(teams.map((t) => [t.id, t.board_tile ?? 0])),
  );
  const [sliding, setSliding] = useState({});
  const seen = useRef(null);       // team id -> id of the move last seen
  const target = useRef({});       // team id -> where the server has it
  const timers = useRef(new Map()); // team id -> the walk's pending timeout

  useEffect(() => () => {
    for (const id of timers.current.values()) clearTimeout(id);
  }, []);

  useEffect(() => {
    const latest = new Map();
    for (const e of events) {
      if (e.type === 'team_moved' && e.team_id && !latest.has(e.team_id)) latest.set(e.team_id, e);
    }
    const first = seen.current === null;
    const before = seen.current ?? new Map();
    seen.current = new Map([...latest].map(([team, e]) => [team, e.id]));

    const put = (id, tile, slide = false) => {
      setShown((s) => (s[id] === tile ? s : { ...s, [id]: tile }));
      setSliding((s) => (Boolean(s[id]) === slide ? s : { ...s, [id]: slide }));
    };

    const walk = (id, steps) => {
      clearTimeout(timers.current.get(id));
      let i = 0;
      const next = () => {
        if (i >= steps.length) {
          timers.current.delete(id);
          put(id, target.current[id]);
          return;
        }
        const step = steps[i++];
        put(id, step.tile, step.kind === 'slide');
        timers.current.set(id, setTimeout(next, step.kind === 'slide' ? SLIDE_MS : STEP_MS));
      };
      next();
    };

    for (const t of teams) {
      const to = t.board_tile ?? 0;
      target.current[t.id] = to;
      const e = latest.get(t.id);
      const fresh = !first && e && before.get(t.id) !== e.id && Number(e.payload?.to) === to;
      if (fresh && !reduced) walk(t.id, movePath(e.payload));
      else if (!timers.current.has(t.id)) put(t.id, to);
    }
  }, [teams, events, reduced]);

  return { shown, sliding };
}
