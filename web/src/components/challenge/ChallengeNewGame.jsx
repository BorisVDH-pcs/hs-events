import { useState } from 'react';
import { METRIC_GROUPS, WOM_METRICS } from '../../lib/challenge.js';

/** The list box's escape hatch. Not a metric, so it can never be one. */
const OTHER = '\u0000other';

/**
 * The New game form, for a challenge.
 *
 * Its own body rather than more branches inside NewGame: a challenge has no
 * board, so not one of that form's fields applies to it — no card size, no
 * grid, and a start time that decides nothing. What it asks instead is what
 * the event is scored on, which is the one question none of the other modes
 * has.
 *
 * The two figures are both optional on their own and at least one is required
 * together, which is `admin_new_challenge`'s own rule. With both of them, the
 * ranking has to be answered here, because an event that collects a kill count
 * and a loot total and will not say which one wins is not a finished event.
 *
 * `onCreate` answers true when the event was made, false when it was refused —
 * NewGame resolves the console's own FAILED symbol before it gets here, so
 * this form never has to know about it.
 */
export default function ChallengeNewGame({ busy, onCreate }) {
  const [name, setName] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [solo, setSolo] = useState(true);
  const [teamNames, setTeamNames] = useState(['', '']);

  const [useWom, setUseWom] = useState(true);
  const [metric, setMetric] = useState('clue_scrolls_all');
  // One account per person unless the organiser says otherwise: that is the
  // rule the weekly events run on, and the one the schema has enforced since
  // the mode existed.
  const [allAccounts, setAllAccounts] = useState(false);
  // Typing one by hand is a deliberate choice, so it survives a metric the
  // list does happen to know being typed into the box.
  const [typed, setTyped] = useState(false);
  const [useDeclared, setUseDeclared] = useState(false);
  const [declaredLabel, setDeclaredLabel] = useState('');
  const [declaredUnit, setDeclaredUnit] = useState('gp');
  const [rankedBy, setRankedBy] = useState('wom');

  const filled = teamNames.map((n) => n.trim()).filter(Boolean);
  const duplicate = new Set(filled.map((n) => n.toLowerCase())).size !== filled.length;
  const both = useWom && useDeclared;
  // The shape every WOM metric has. Checked only for one typed by hand; the
  // list box cannot produce anything else.
  const metricOk = /^[a-z0-9_]+$/.test(metric);

  const ready = name.trim()
    && endsAt
    && (useWom || useDeclared)
    && (!useWom || metricOk)
    && (!useDeclared || declaredLabel.trim())
    && (solo || (filled.length >= 1 && !duplicate));

  const setTeam = (i, value) => setTeamNames((prev) => prev.map((n, j) => (j === i ? value : n)));

  return (
    <>
      <div className="row new-game-fields">
        <label className="field-name">Event name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Boss of the Week"
            disabled={busy}
          />
        </label>
        {/* Required, unlike every other mode's end time. A challenge is a
            window: the figures are what changed between the start and this
            moment, so there is nothing to measure without it. */}
        <label className="field-time"><span>End time</span>
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            disabled={busy}
          />
        </label>
      </div>

      <section className="cnew-question">
        <h4>Who competes</h4>
        <div className="choice-row" role="radiogroup" aria-label="Who competes">
          <label className="choice">
            <input
              type="radio" name="challenge-solo" checked={solo}
              onChange={() => setSolo(true)} disabled={busy}
            />
            <span>Everyone for themselves</span>
          </label>
          <label className="choice">
            <input
              type="radio" name="challenge-solo" checked={!solo}
              onChange={() => setSolo(false)} disabled={busy}
            />
            <span>Teams <span className="muted">(a team scores its members added together)</span></span>
          </label>
        </div>

      {!solo && (
        <div className="row new-game-fields choice-detail">
          {teamNames.map((n, i) => (
            <label key={i} className="field-team">
              {`Team ${i + 1}`}
              <span className="team-name-field">
                <input
                  value={n}
                  onChange={(e) => setTeam(i, e.target.value)}
                  placeholder={`Team ${['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'][i] ?? i + 1}`}
                  disabled={busy}
                />
                {teamNames.length > 1 && (
                  <button
                    type="button" className="ghost" aria-label={`Remove team ${i + 1}`}
                    onClick={() => setTeamNames((prev) => prev.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                )}
              </span>
            </label>
          ))}
          <button
            type="button" className="ghost" disabled={busy}
            onClick={() => setTeamNames((prev) => [...prev, ''])}
          >
            + Another team
          </button>
        </div>
      )}
      {!solo && duplicate && <p className="error">Two teams have the same name.</p>}
      </section>

      {/* Each figure is a tick with its own settings folded in underneath, so
          the fields that only matter when it is on are plainly attached to it
          rather than floating in the row beside it. */}
      <section className="cnew-question">
        <h4>What it is scored on</h4>

        <label className="choice">
          <input
            type="checkbox" checked={useWom} disabled={busy}
            onChange={(e) => {
              setUseWom(e.target.checked);
              if (!e.target.checked) setRankedBy('declared');
              else if (!useDeclared) setRankedBy('wom');
            }}
          />
          <span>From the hiscores <span className="muted">(Wise Old Man counts it)</span></span>
        </label>
        {useWom && (
          <div className="choice-detail">
            <div className="row new-game-fields">
              {/* A list box, not an `input list=`. A datalist filters its
                  suggestions against whatever is already typed, so a field
                  arriving with a complete metric in it offered that metric
                  and nothing else -- 113 of them were unreachable without
                  clearing the box first, which nothing on screen said to do. */}
              <label className="field-metric">Which metric
                <select
                  value={typed ? OTHER : metric}
                  disabled={busy}
                  onChange={(e) => {
                    if (e.target.value === OTHER) { setTyped(true); return; }
                    setTyped(false);
                    setMetric(e.target.value);
                  }}
                >
                  {METRIC_GROUPS.map((g) => (
                    <optgroup key={g} label={g}>
                      {WOM_METRICS.filter((m) => m.group === g).map((m) => (
                        <option key={m.value} value={m.value}>{m.name}</option>
                      ))}
                    </optgroup>
                  ))}
                  {/* Still an open set: WOM adds bosses faster than this file
                      is regenerated, and an event refused for a metric that
                      exists would be our fault, not the organiser's. */}
                  <option value={OTHER}>Something else — type it</option>
                </select>
              </label>
              {typed && (
                <label className="field-name">Its Wise Old Man name
                  <input
                    value={metric}
                    onChange={(e) => setMetric(e.target.value.trim())}
                    placeholder="araxxor"
                    disabled={busy}
                    autoFocus
                  />
                </label>
              )}
            </div>
            {typed && (
              <p className="muted new-game-note">
                Spelled the way Wise Old Man spells it, in lower case with
                underscores. Their competition is created from this, so a name
                they do not know is refused when the event starts.
              </p>
            )}

            {/* HOW MANY ACCOUNTS COUNT PER PERSON. Off is the rule a weekly
                XP or kill-count event wants: one account each, or somebody
                with two can grind both and the ladder stops meaning anything.
                On is for a bingo, where switching to an alt mid-event is
                normal and should not cost the drop.

                Under the metric rather than beside the name, because it only
                means anything for a hiscores figure — admin_new_challenge
                refuses it without one rather than quietly ignoring it. */}
            <label className="choice">
              <input
                type="checkbox" checked={allAccounts} disabled={busy}
                onChange={(e) => setAllAccounts(e.target.checked)}
              />
              <span>
                Count every account a player has{' '}
                <span className="muted">(their whole My accounts list, added together)</span>
              </span>
            </label>
            <p className="muted new-game-note">
              {allAccounts
                ? 'Every account on an entrant’s list goes on the competition and their '
                  + 'figures are added up. For a bingo, where people play alts.'
                : 'One account each — the one they pick when they sign up. For a weekly '
                  + 'event, where two accounts would be two chances at the same ladder.'}
            </p>
          </div>
        )}

        <label className="choice">
          <input
            type="checkbox" checked={useDeclared} disabled={busy}
            onChange={(e) => {
              setUseDeclared(e.target.checked);
              if (!e.target.checked) setRankedBy('wom');
              else if (!useWom) setRankedBy('declared');
            }}
          />
          <span>A number players give <span className="muted">(with screenshots behind it)</span></span>
        </label>
        {useDeclared && (
          <div className="choice-detail">
            <div className="row new-game-fields">
              <label className="field-name">What they are giving
                <input
                  value={declaredLabel}
                  onChange={(e) => setDeclaredLabel(e.target.value)}
                  placeholder="Total loot"
                  disabled={busy}
                />
              </label>
              <label className="field-size">In
                <select
                  value={declaredUnit}
                  onChange={(e) => setDeclaredUnit(e.target.value)}
                  disabled={busy}
                >
                  <option value="gp">Millions of gp</option>
                  <option value="count">A count</option>
                </select>
              </label>
            </div>
            <p className="muted new-game-note">
              Players type this themselves and hang a start and a finish
              screenshot behind it. The site cannot read a screenshot, so an
              organiser checks the two against each other in Track and can
              correct the number.
            </p>
          </div>
        )}

        {!useWom && !useDeclared && (
          <p className="error">Pick at least one, or there is nothing to score.</p>
        )}
      </section>

      {both && (
        <section className="cnew-question">
          <h4>Which one wins it</h4>
          <div className="choice-row" role="radiogroup" aria-label="Which figure wins">
            <label className="choice">
              <input
                type="radio" name="challenge-ranked" checked={rankedBy === 'wom'}
                onChange={() => setRankedBy('wom')} disabled={busy}
              />
              <span>The hiscores figure</span>
            </label>
            <label className="choice">
              <input
                type="radio" name="challenge-ranked" checked={rankedBy === 'declared'}
                onChange={() => setRankedBy('declared')} disabled={busy}
              />
              <span>{declaredLabel.trim() || 'The number they give'}</span>
            </label>
          </div>
        </section>
      )}

      <div className="row new-game-fields cnew-create">
        <button
          disabled={busy || !ready}
          onClick={async () => {
            const result = await onCreate({
              mode: 'challenge',
              name: name.trim(),
              endsAt: new Date(endsAt).toISOString(),
              solo,
              womMetric: useWom ? metric.trim() : null,
              declaredLabel: useDeclared ? declaredLabel.trim() : null,
              declaredUnit: useDeclared ? declaredUnit : null,
              rankedBy: both ? rankedBy : (useWom ? 'wom' : 'declared'),
              teams: solo ? [] : filled,
              // Only ever true alongside a metric: the server refuses the
              // combination rather than ignoring it, so it is cleared here
              // instead of being sent to be rejected.
              allAccounts: useWom && allAccounts,
            });
            if (result) {
              setName(''); setEndsAt(''); setTeamNames(['', '']);
              setDeclaredLabel(''); setAllAccounts(false);
            }
          }}
        >
          Create
        </button>
        <span className="muted">
          Sign-ups open the moment it is created, and close when you start it.
        </span>
      </div>
    </>
  );
}
