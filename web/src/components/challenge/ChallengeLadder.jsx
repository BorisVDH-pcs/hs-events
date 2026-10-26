import { figureLabel, metricLabel, rankedLabel, womLabel } from '../../lib/challenge.js';

/**
 * The ladder.
 *
 * One row per entrant, or per team when the event runs in teams — the server
 * decides which (challenge_standings) and answers the same shape either way,
 * so this draws what it is given rather than knowing the rules.
 *
 * The same rows bingo, snakes and territory use: a place, a name, the figure,
 * and a bar against the leader. It was a bare table until 2026-10-26, which is
 * the one thing a ladder cannot afford to be — it is the screen the whole
 * event is read off.
 *
 * WHERE THE SECOND FIGURE WENT. A challenge can collect two at once: Boss of
 * the Week is the kills on Wise Old Man and the loot the player typed. Both
 * used to get a column of their own, equal in weight, with the deciding one
 * marked in gold. Now the deciding figure is the number on the row and the
 * other sits on the line under the name — still there, still a glance apart
 * for an organiser checking one against the other, but no longer asking which
 * of two numbers the ladder is sorted on.
 */
export default function ChallengeLadder({
  standings = [], setup, myProfileId = null, myTeamId = null, title = 'Ladder',
}) {
  const hasWom = Boolean(setup?.wom_metric);
  const hasDeclared = Boolean(setup?.declared_label);
  const solo = setup?.solo !== false;
  const unit = setup?.declared_unit ?? null;

  // `ranked_by` is the event's, but a figure it does not collect cannot settle
  // anything: fall back rather than draw a column of dashes as the winner.
  const byWom = setup?.ranked_by === 'wom' ? hasWom : !hasDeclared;

  const figure = (s) => (byWom ? s.wom_gained : s.declared) ?? 0;

  /*
   * The bar is a share of the leader, not of everyone's total.
   *
   * A ladder is read as "how far behind am I", which is a question about the
   * top of it. Against a sum, every bar on a twenty-strong event is a sliver
   * and the shape says nothing.
   */
  const top = standings.reduce((m, s) => Math.max(m, figure(s)), 0);

  return (
    <section className="card challenge-ladder" aria-labelledby="challenge-ladder-title">
      <div className="challenge-ladder-head">
        <h2 id="challenge-ladder-title">{title}</h2>
        {(hasWom || hasDeclared) && (
          <p className="muted">Ranked by {rankedLabel(setup)}</p>
        )}
      </div>

      {standings.length === 0 ? (
        <p className="muted">
          Nothing to show yet — the ladder opens when the event starts.
        </p>
      ) : (
        <ol>
          {standings.map((s) => {
            // A solo ladder is people and a team ladder is teams, so which
            // row is "yours" is a different question in each.
            const mine = solo
              ? Boolean(myProfileId) && s.profile_id === myProfileId
              : Boolean(myTeamId) && s.team_id === myTeamId;

            const value = figure(s);
            const pct = top > 0 ? Math.round((value / top) * 100) : 0;

            // The figure that is not deciding it, and — in teams — how many
            // people are behind the number. Both are asides, so both go on
            // the one quiet line rather than taking a column each.
            const aside = [
              byWom && hasDeclared
                && `${setup.declared_label} ${figureLabel(s.declared, unit)}`,
              !byWom && hasWom
                && `${metricLabel(setup.wom_metric)} ${womLabel(s.wom_gained)}`,
              // A count only when there is one: a row the server answered
              // without it is not a row with nobody in it.
              !solo && Number.isFinite(s.entrants)
                && `${s.entrants} ${s.entrants === 1 ? 'entrant' : 'entrants'}`,
            ].filter(Boolean).join(' · ');

            return (
              <li key={s.profile_id ?? s.team_id ?? s.place} className={mine ? 'mine' : undefined}>
                <div className="standings-row">
                  {/* Nobody is first on nothing: a place is only a place once
                      there is a figure under it, as in the other modes. */}
                  <span className="place">{value > 0 ? s.place : '–'}</span>
                  {/* The name truncates, the mark does not: on a phone a
                      long team name ate "(you)" whole, which is the one word
                      on the row a player is looking for. */}
                  <span className="team">
                    <span className="name">{s.name}</span>
                    {mine && <span className="muted you">(you)</span>}
                  </span>
                  <span className="count">
                    {byWom ? womLabel(s.wom_gained) : figureLabel(s.declared, unit)}
                  </span>
                  {aside && <span className="sub muted">{aside}</span>}
                  <span className="bar" aria-hidden="true">
                    <span style={{ width: `${pct}%` }} />
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
