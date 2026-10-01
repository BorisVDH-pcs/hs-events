import { useEffect, useMemo, useRef, useState } from 'react';
import { settleBingo } from '../../lib/supabase.js';
import { useCountdown, pad } from '../../lib/countdown.js';
import { canSubmit, countLabel, resultText, timeIsUp } from '../../lib/bingo.js';
import EventFeed from '../EventFeed.jsx';
import TeamNameEditor from '../TeamNameEditor.jsx';
import StartTimeBadge from '../StartTimeBadge.jsx';
import BingoCard from './BingoCard.jsx';
import BingoStandings from './BingoStandings.jsx';
import BingoTilePanel from './BingoTilePanel.jsx';

/**
 * The player's view of a bingo game.
 *
 * Same three columns as battleships -- feed on the left, board in the middle,
 * the thing you act on at the right -- so a player moving between the two
 * modes does not have to relearn where anything is.
 *
 * THE TIMER. Nothing on the server ends a game at `ends_at` by itself (there
 * is no scheduler), but nothing needs to: submissions are refused from that
 * moment, which fixes the result. This page then asks the server to record it
 * (bingo_settle) when its countdown reaches zero. Every open page does, the
 * first one wins, and the rest are no-ops.
 */
export default function BingoGame({ game, teams, myTeamId, myRole, tiles, standings, events, evidence, onRefresh }) {
  const [selectedId, setSelectedId] = useState(null);
  const [viewTeamId, setViewTeamId] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const isPreparation = game.status === 'setup' || game.status === 'placement';
  const isActive = game.status === 'active';
  const isFinished = game.status === 'finished';
  const myTeam = teams.find((t) => t.id === myTeamId) ?? null;
  const mine = standings.find((s) => s.team_id === myTeamId) ?? null;
  const viewing = viewTeamId ? standings.find((s) => s.team_id === viewTeamId) : null;
  const doneIds = useMemo(
    () => (viewing ? new Set(viewing.completed_tile_ids ?? []) : null),
    [viewing],
  );

  // Selection is held as an id, and re-read from `tiles` so the panel follows
  // every refresh rather than freezing at what it was when pressed.
  const selected = tiles.find((t) => t.id === selectedId) ?? null;

  // Settle once the timer passes. A timeout to the deadline rather than
  // polling: the page knows exactly when it needs to look.
  const settledFor = useRef(null);
  useEffect(() => {
    if (!isActive || !game.ends_at) return undefined;
    const wait = Date.parse(game.ends_at) - Date.now();
    const settle = () => {
      // Guard before touching `now`: `now` is a dependency of this effect, so
      // setting it on every pass would re-run the effect forever.
      if (settledFor.current === game.id) return;
      settledFor.current = game.id;
      setNow(Date.now());
      settleBingo(game.id)
        .catch(() => { settledFor.current = null; })
        .finally(() => onRefresh?.());
    };
    if (wait <= 0) { settle(); return undefined; }
    // setTimeout clamps anything past ~24.8 days; re-arm instead of firing early.
    const id = setTimeout(() => setNow(Date.now()), Math.min(wait + 500, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [isActive, game.id, game.ends_at, now, onRefresh]);

  const submittable = canSubmit(game, myTeamId, now);
  const closedReason = !myTeamId
    ? 'You are not on a team in this game.'
    : isFinished
      ? 'The game is over.'
      : timeIsUp(game, now)
        ? "Time's up — no more submissions."
        : !isActive
          ? 'Submissions open when the game starts.'
          : null;

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
            A {game.grid_size}×{game.grid_size} bingo. The card is revealed the moment the
            organiser starts the game — every tile is open at once, in any order.
          </p>
        </section>
        <EventFeed events={events} teams={teams} myTeamId={myTeamId} />
      </>
    );
  }

  const result = resultText(game, teams);

  return (
    <>
      {result && <p className="banner">{result}</p>}

      <section className="boards">
        <div className="board-layout">
          <div className="feed-col">
            <BingoStandings
              standings={standings}
              myTeamId={myTeamId}
              viewingTeamId={viewTeamId}
              onView={(id) => { setViewTeamId(id); setSelectedId(null); }}
            />
            <EventFeed events={events} teams={teams} myTeamId={myTeamId} />
          </div>

          <div className="board-col">
            <div className="tabs board-tabs bingo-tabs">
              <button
                className={viewTeamId ? '' : 'on'}
                onClick={() => { setViewTeamId(null); setSelectedId(null); }}
              >
                Your card{mine ? ` · ${countLabel(mine)}` : ''}
              </button>
              {viewing && (
                <button className="on" aria-current="true">
                  {viewing.team_name} · {countLabel(viewing)}
                </button>
              )}
              {isActive && <BingoTimer endsAt={game.ends_at} />}
            </div>

            <BingoCard
              size={game.grid_size}
              tiles={tiles}
              doneIds={doneIds}
              selectedId={selectedId}
              onSelect={(tile) => setSelectedId((id) => (id === tile.id ? null : tile.id))}
            />
          </div>

          <div className="side-col">
            {selected ? (
              <BingoTilePanel
                tile={selected}
                gameId={game.id}
                teamId={myTeamId}
                submittable={submittable}
                closedReason={closedReason}
                readOnly={Boolean(viewTeamId)}
                evidence={evidence}
                onRefresh={onRefresh}
                onClose={() => setSelectedId(null)}
              />
            ) : (
              <section className="bingo-tile-panel bingo-hint">
                <h2>{isFinished ? 'Final card' : 'Pick any tile'}</h2>
                <p className="muted">
                  {isFinished
                    ? 'Press a tile to see what was submitted for it.'
                    : 'Every tile is open. Press one to read its task and submit your screenshots — '
                      + 'work on as many as you like, in any order.'}
                </p>
                <p className="muted">
                  Each completed tile is worth one point. The game ends when a team fills the
                  whole card{game.ends_at ? ', or when the timer runs out' : ''}.
                </p>
              </section>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

/** "Ends in 1d 04:12:09", or nothing when the game has no timer. */
function BingoTimer({ endsAt }) {
  const left = useCountdown(endsAt);
  if (!left.set) return null;
  return (
    <span className="next-move-tab bingo-timer" role="timer">
      {left.started
        ? "Time's up"
        : `Ends in ${left.days > 0 ? `${left.days}d ` : ''}${pad(left.hours)}:${pad(left.minutes)}:${pad(left.seconds)}`}
    </span>
  );
}
