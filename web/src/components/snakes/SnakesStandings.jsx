import { teamInitials, LAST_TILE } from '../../lib/snakes.js';
import TeamDot from './TeamDot.jsx';

/**
 * Every team, furthest along first -- the server's order (snakes_standings),
 * which is also who would win if an organiser ended the game now.
 *
 * Pressing a row shows that team's square on the board, which is the quickest
 * way to find a marker among four others on a busy row.
 */
export default function SnakesStandings({ standings, myTeamId, onFind }) {
  const initials = teamInitials(standings);
  return (
    <section className="bingo-standings snakes-standings stats-panel" aria-labelledby="standings-title">
      <h2 id="standings-title">Standings</h2>
      {standings.length === 0 ? (
        <p className="muted">No teams yet.</p>
      ) : (
        <ol>
          {standings.map((s) => {
            const mine = s.team_id === myTeamId;
            const tile = s.board_tile ?? 0;
            const rollbacks = s.rollbacks_available ?? 0;
            return (
              <li key={s.team_id} className={mine ? 'mine' : ''}>
                <button
                  className="standings-row"
                  title={tile ? `Show ${s.team_name} on the board` : `${s.team_name} is still at Start`}
                  onClick={() => tile && onFind?.(tile)}
                >
                  <span className="place">{tile ? s.place : '–'}</span>
                  <span className="team">
                    <TeamDot slot={s.slot} label={initials.get(s.team_id)} />
                    {s.team_name}
                    {mine && <span className="muted"> (you)</span>}
                  </span>
                  <span className="count">{tile ? `Tile ${tile}` : 'Start'}</span>
                  <span className="sub muted">
                    {s.tiles_completed ?? 0} done
                    {rollbacks > 0 && <> · {rollbacks} rollback{rollbacks === 1 ? '' : 's'}</>}
                  </span>
                  <span className="bar" aria-hidden="true">
                    <span style={{ width: `${(tile / LAST_TILE) * 100}%` }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
