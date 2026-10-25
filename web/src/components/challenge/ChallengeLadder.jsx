import { figureLabel, metricLabel, womLabel } from '../../lib/challenge.js';

/**
 * The ladder.
 *
 * One row per entrant, or per team when the event runs in teams — the server
 * decides which (challenge_standings) and answers the same shape either way,
 * so this draws what it is given rather than knowing the rules.
 *
 * Both figures get a column whenever the event collects both, and the one that
 * decides the winner is marked. Showing only the deciding figure would hide
 * half of what Boss of the Week is about: the kills are on Wise Old Man and
 * the loot is the number the player gave, and an organiser checking one
 * against the other needs them side by side.
 */
export default function ChallengeLadder({
  standings = [], setup, myProfileId = null, myTeamId = null, title = 'Ladder',
}) {
  const hasWom = Boolean(setup?.wom_metric);
  const hasDeclared = Boolean(setup?.declared_label);
  const rankWom = setup?.ranked_by === 'wom';
  const solo = setup?.solo !== false;

  const womHead = metricLabel(setup?.wom_metric) ?? 'Hiscores';
  const declaredHead = setup?.declared_label ?? 'Declared';

  return (
    <section className="stats-panel challenge-ladder" aria-labelledby="challenge-ladder-title">
      <h2 id="challenge-ladder-title">{title}</h2>
      {standings.length === 0 ? (
        <p className="muted">
          Nothing to show yet — the ladder opens when the event starts.
        </p>
      ) : (
        <table className="stats-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{solo ? 'Player' : 'Team'}</th>
              {hasWom && (
                <th scope="col" className={rankWom ? 'ranked' : undefined}
                    title={rankWom ? 'This decides the winner' : undefined}>
                  {womHead}
                </th>
              )}
              {hasDeclared && (
                <th scope="col" className={!rankWom ? 'ranked' : undefined}
                    title={!rankWom ? 'This decides the winner' : undefined}>
                  {declaredHead}
                </th>
              )}
              {!solo && <th scope="col">In</th>}
            </tr>
          </thead>
          <tbody>
            {standings.map((s) => {
              // A solo ladder is people and a team ladder is teams, so which
              // row is "yours" is a different question in each.
              const mine = solo
                ? Boolean(myProfileId) && s.profile_id === myProfileId
                : Boolean(myTeamId) && s.team_id === myTeamId;
              return (
                <tr key={s.profile_id ?? s.team_id ?? s.place} className={mine ? 'mine' : undefined}>
                  <td>{s.place}</td>
                  <th scope="row">
                    {s.name}
                    {mine && <span className="muted"> (you)</span>}
                  </th>
                  {hasWom && (
                    <td className={rankWom ? 'ranked' : undefined}>{womLabel(s.wom_gained)}</td>
                  )}
                  {hasDeclared && (
                    <td className={!rankWom ? 'ranked' : undefined}>
                      {figureLabel(s.declared, setup?.declared_unit)}
                    </td>
                  )}
                  {!solo && <td>{s.entrants}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
