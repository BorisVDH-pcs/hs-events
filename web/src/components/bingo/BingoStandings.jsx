import { countLabel } from '../../lib/bingo.js';

/**
 * Every team, most tiles first. Ties go to whoever got there first, which is
 * the same ordering the server uses to pick the winner (bingo_standings), so
 * the top row here is always the team that would win if the game ended now.
 *
 * A row is also how you look at another team's card: press it and the card
 * shows what they have completed. Pressing your own row (or the active one)
 * goes back to your own card.
 */
export default function BingoStandings({ standings, myTeamId, viewingTeamId, onView }) {
  return (
    <section className="bingo-standings stats-panel" aria-labelledby="standings-title">
      <h2 id="standings-title">Standings</h2>
      {standings.length === 0 ? (
        <p className="muted">No teams yet.</p>
      ) : (
        <ol>
          {standings.map((s) => {
            const mine = s.team_id === myTeamId;
            const viewing = s.team_id === viewingTeamId;
            const pct = s.tiles_total ? (s.tiles_completed / s.tiles_total) * 100 : 0;
            return (
              <li key={s.team_id} className={`${mine ? 'mine' : ''}${viewing ? ' viewing' : ''}`}>
                <button
                  className="standings-row"
                  aria-pressed={viewing}
                  title={mine ? 'Your card' : `See ${s.team_name}'s card`}
                  onClick={() => onView?.(mine || viewing ? null : s.team_id)}
                >
                  <span className="place">{s.tiles_completed > 0 ? s.place : '–'}</span>
                  <span className="team">
                    {s.team_name}
                    {mine && <span className="muted"> (you)</span>}
                  </span>
                  <span className="count">{countLabel(s)}</span>
                  <span className="bar" aria-hidden="true">
                    <span style={{ width: `${pct}%` }} />
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
