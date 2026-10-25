import { useState } from 'react';
import { WOM_METRICS } from '../../lib/challenge.js';

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
  const [useDeclared, setUseDeclared] = useState(false);
  const [declaredLabel, setDeclaredLabel] = useState('');
  const [declaredUnit, setDeclaredUnit] = useState('gp');
  const [rankedBy, setRankedBy] = useState('wom');

  const filled = teamNames.map((n) => n.trim()).filter(Boolean);
  const duplicate = new Set(filled.map((n) => n.toLowerCase())).size !== filled.length;
  const both = useWom && useDeclared;

  const ready = name.trim()
    && endsAt
    && (useWom || useDeclared)
    && (!useWom || metric.trim())
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

      <div className="row new-game-fields" role="radiogroup" aria-label="Who competes">
        <label className="field-size">
          <input
            type="radio" name="challenge-solo" checked={solo}
            onChange={() => setSolo(true)} disabled={busy}
          />
          {' '}Everyone for themselves
        </label>
        <label className="field-size">
          <input
            type="radio" name="challenge-solo" checked={!solo}
            onChange={() => setSolo(false)} disabled={busy}
          />
          {' '}Teams <span className="muted">(a team scores its members added together)</span>
        </label>
      </div>

      {!solo && (
        <div className="row new-game-fields">
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

      <h3>What it is scored on</h3>

      <div className="row new-game-fields">
        <label className="field-size">
          <input
            type="checkbox" checked={useWom} disabled={busy}
            onChange={(e) => {
              setUseWom(e.target.checked);
              if (!e.target.checked) setRankedBy('declared');
              else if (!useDeclared) setRankedBy('wom');
            }}
          />
          {' '}From the hiscores
        </label>
        {useWom && (
          <label className="field-name">Wise Old Man metric
            <input
              list="challenge-metrics"
              value={metric}
              onChange={(e) => setMetric(e.target.value.trim())}
              placeholder="zulrah"
              disabled={busy}
            />
          </label>
        )}
        {/* A list, not a closed set: WOM adds bosses faster than this file gets
            edited, and an event refused for a metric that exists would be our
            fault, not the organiser's. */}
        <datalist id="challenge-metrics">
          {WOM_METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </datalist>
      </div>

      <div className="row new-game-fields">
        <label className="field-size">
          <input
            type="checkbox" checked={useDeclared} disabled={busy}
            onChange={(e) => {
              setUseDeclared(e.target.checked);
              if (!e.target.checked) setRankedBy('wom');
              else if (!useWom) setRankedBy('declared');
            }}
          />
          {' '}A number players give
        </label>
        {useDeclared && (
          <>
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
          </>
        )}
      </div>

      {useDeclared && (
        <p className="muted new-game-note">
          Players type this themselves and hang a start and a finish screenshot
          behind it. The site cannot read a screenshot, so an organiser checks
          the two against each other in Track and can correct the number.
        </p>
      )}

      {both && (
        <div className="row new-game-fields" role="radiogroup" aria-label="Which figure wins">
          <span className="field-size">Which one wins it</span>
          <label className="field-size">
            <input
              type="radio" name="challenge-ranked" checked={rankedBy === 'wom'}
              onChange={() => setRankedBy('wom')} disabled={busy}
            />
            {' '}The hiscores figure
          </label>
          <label className="field-size">
            <input
              type="radio" name="challenge-ranked" checked={rankedBy === 'declared'}
              onChange={() => setRankedBy('declared')} disabled={busy}
            />
            {' '}{declaredLabel.trim() || 'The number they give'}
          </label>
        </div>
      )}

      <div className="row new-game-fields">
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
            });
            if (result) {
              setName(''); setEndsAt(''); setTeamNames(['', '']);
              setDeclaredLabel('');
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
