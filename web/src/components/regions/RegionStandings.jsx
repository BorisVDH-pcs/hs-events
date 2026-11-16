import { regionByKey } from '../../lib/regions.js';
import { markerColor } from '../../lib/snakes.js';
import './regions.css';

/**
 * Every team, most points first; a tie goes to whoever got there first --
 * the server's order (regions_standings), so the top row is always who would
 * win if the game ended now.
 *
 * Under each team: the regions it has opened, a tick on the complete ones.
 * Which regions a team holds is public (the feed announces every one); what
 * is in them is not, so no tile names here.
 *
 *   rows      regions_standings rows
 *   onFind    optional: press a region chip to look at it on the map
 */
export default function RegionStandings({ rows, myTeamId, onFind, title = 'Standings' }) {
  const top = Math.max(1, ...rows.map((r) => r.points ?? 0));
  return (
    <section className="bingo-standings stats-panel regions-standings" aria-labelledby="regions-standings-title">
      <h2 id="regions-standings-title">{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">No teams yet.</p>
      ) : (
        <ol>
          {rows.map((s) => {
            const mine = s.team_id === myTeamId;
            const complete = new Set(s.regions_complete ?? []);
            return (
              <li key={s.team_id} className={mine ? 'mine' : ''}>
                <div className="standings-row">
                  <span className="place">{s.points > 0 ? s.place : '–'}</span>
                  <span className="team">
                    <i className="regions-team-swatch" style={{ background: markerColor(s.slot) }} aria-hidden="true" />
                    {s.team_name}
                    {mine && <span className="muted"> (you)</span>}
                  </span>
                  <span className="count">{s.points} {s.points === 1 ? 'pt' : 'pts'}</span>
                  <span className="bar" aria-hidden="true">
                    <span style={{ width: `${((s.points ?? 0) / top) * 100}%` }} />
                  </span>
                </div>
                <p className="regions-standings-regions">
                  {(s.regions_open ?? []).length === 0 ? (
                    <span className="muted">{s.needs_start ? 'No region yet' : ''}</span>
                  ) : (
                    s.regions_open.map((key) => {
                      const name = regionByKey.get(key)?.name ?? key;
                      const label = complete.has(key) ? `${name} ✓` : name;
                      return onFind ? (
                        <button
                          key={key} type="button"
                          className={`regions-chip${complete.has(key) ? ' complete' : ''}`}
                          onClick={() => onFind(key)}
                        >
                          {label}
                        </button>
                      ) : (
                        <span key={key} className={`regions-chip${complete.has(key) ? ' complete' : ''}`}>{label}</span>
                      );
                    })
                  )}
                  {s.picks > 0 && <span className="regions-chip pick">{s.picks === 1 ? '1 pick' : `${s.picks} picks`} to spend</span>}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
