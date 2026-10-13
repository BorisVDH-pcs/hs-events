import { REGIONS } from '../../lib/territoryWorld.js';
import { scoreLabel } from '../../lib/territory.js';
import { markerColor } from '../../lib/snakes.js';
import TeamCrest from './TeamCrest.jsx';

const regionName = new Map(REGIONS.map((r) => [r.key, r.name]));

/**
 * Every team, highest score first -- the order that decides the winner when
 * the timer runs out. A row shows the score, how it is made up, and the regions
 * the team holds whole, since those are what a rival most wants to break.
 *
 * Pressing a row centres the map on that team's home.
 */
export default function TerritoryStandings({ rows, teams, myTeamId, onFind }) {
  const teamOf = (id) => teams.find((t) => t.id === id);
  const top = Math.max(1, ...rows.map((r) => r.score));
  return (
    <section className="bingo-standings territory-standings stats-panel" id="territory-standings-section" aria-labelledby="standings-title">
      <h2 id="standings-title">Standings</h2>
      <ol>
        {rows.map((r, i) => {
          const team = teamOf(r.team_id);
          const mine = r.team_id === myTeamId;
          return (
            <li key={r.team_id} className={mine ? 'mine' : ''}>
              <button
                className="standings-row"
                title={onFind ? `Show ${team?.name}'s home on the map` : undefined}
                onClick={() => onFind?.(r.team_id)}
              >
                <span className="place">{i === 0 && r.score > 0 ? '♛' : i + 1}</span>
                <span className="team">
                  <TeamCrest slot={team?.slot} label={team?.initial} size={17} />
                  <span className="name">{team?.name}</span>
                  {mine && <span className="muted you">you</span>}
                </span>
                <span className="count">{r.score}</span>
                <span className="sub muted">{scoreLabel(r)}</span>
                {r.regions.length > 0 && (
                  <span className="regions">
                    {r.regions.map((k) => <span key={k} className="territory-region-chip">{regionName.get(k)}</span>)}
                  </span>
                )}
                <span className="bar" aria-hidden="true">
                  <span style={{ width: `${(r.score / top) * 100}%`, background: markerColor(team?.slot) }} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
