import { useState } from 'react';
import { METRIC_GROUPS, WOM_METRICS } from '../../lib/challenge.js';
import { Pick, PickSet } from '../Pick.jsx';
import DateTimeField from '../DateTimeField.jsx';

/** The list box's escape hatch. Not a metric, so it can never be one. */
const OTHER = '\u0000other';

/*
 * What a loot event's second figure is called, everywhere it is shown.
 *
 * Fixed rather than typed. An event is either won on what the hiscores count
 * or won on the loot that came out of doing it, and there is no third thing a
 * player hands in -- so a free-text box here only ever collected a different
 * spelling of the same word.
 */
const LOOT_LABEL = 'Loot value';

/**
 * The New game form, for a challenge.
 *
 * Its own body rather than more branches inside NewGame: a challenge has no
 * board, so not one of that form's fields applies to it -- no card size, no
 * grid, and a start time that decides nothing.
 *
 * WHAT IT ASKS, and why it is one question rather than three. The event has
 * always been able to carry two figures -- one off Wise Old Man, one the
 * player declares -- with `ranked_by` saying which wins. This form used to
 * hand that model over whole: tick the hiscores, tick a declared number, name
 * the number, pick its unit, then say which one wins. Five answers to describe
 * one of two events anybody actually runs.
 *
 * The two are:
 *
 *   Hiscores  -- most of whatever is counted. Clue, Raid and Skill of the
 *                Week are all this. Nothing to hand in.
 *   Loot      -- the same count still runs and is still shown, but the loot
 *                that came out of it wins. Boss of the Week is this.
 *
 * Both count a metric, so the metric is asked once, below, instead of inside
 * whichever box happened to be ticked.
 *
 * This narrows the FORM, not the model: a declared-only event, a figure called
 * something else, a plain count and a hiscores-ranked event that also collects
 * a number are all still valid `challenge_setup` rows and still score, draw
 * and end exactly as they did. They just are not among the things this form
 * makes. Nothing was migrated away, so widening it again is this file.
 *
 * `onCreate` answers true when the event was made, false when it was refused --
 * NewGame resolves the console's own FAILED symbol before it gets here, so
 * this form never has to know about it.
 */
export default function ChallengeNewGame({ busy, onCreate }) {
  const [name, setName] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [solo, setSolo] = useState(true);
  const [teamNames, setTeamNames] = useState(['', '']);

  const [kind, setKind] = useState('hiscores');
  const [metric, setMetric] = useState('clue_scrolls_all');
  // One account per person unless the organiser says otherwise: that is the
  // rule the weekly events run on, and the one the schema has enforced since
  // the mode existed.
  const [allAccounts, setAllAccounts] = useState(false);
  // Typing one by hand is a deliberate choice, so it survives a metric the
  // list does happen to know being typed into the box.
  const [typed, setTyped] = useState(false);

  const loot = kind === 'loot';
  const filled = teamNames.map((n) => n.trim()).filter(Boolean);
  const duplicate = new Set(filled.map((n) => n.toLowerCase())).size !== filled.length;
  // The shape every WOM metric has. Checked only for one typed by hand; the
  // list box cannot produce anything else.
  const metricOk = /^[a-z0-9_]+$/.test(metric);

  const ready = name.trim()
    && endsAt
    && metricOk
    && (solo || (filled.length >= 1 && !duplicate));

  const setTeam = (i, value) => setTeamNames((prev) => prev.map((n, j) => (j === i ? value : n)));

  return (
    <>
      <div className="wizard-fields">
        <label className="field-wide">Event name
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
        <DateTimeField
          label="End time"
          value={endsAt}
          onChange={setEndsAt}
          disabled={busy}
        />
      </div>

      <PickSet ask="Who competes?">
        <Pick
          name="challenge-solo" checked={solo} disabled={busy}
          onChange={() => setSolo(true)}
          title="Everyone for themselves"
          blurb="One ladder, with every entrant on it."
        />
        <Pick
          name="challenge-solo" checked={!solo} disabled={busy}
          onChange={() => setSolo(false)}
          title="Teams"
          blurb="A team scores its members added together."
        >
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
          {duplicate && <p className="error">Two teams have the same name.</p>}
        </Pick>
      </PickSet>

      {/* One column: the loot answer has something to say that does not fit on
          a blurb's line, and side by side it would set the height of a box
          with nothing in it. */}
      <PickSet ask="What decides it?" wide>
        <Pick
          name="challenge-kind" checked={!loot} disabled={busy}
          onChange={() => setKind('hiscores')}
          title="Most of what the hiscores count"
          blurb="Kills, raids, clues or experience. Wise Old Man counts it, and there is nothing to hand in."
        />
        <Pick
          name="challenge-kind" checked={loot} disabled={busy}
          onChange={() => setKind('loot')}
          title="Most loot from doing it"
          blurb="The count still runs and is still shown, but the loot wins it."
        >
          <p className="muted new-game-note">
            Players give the figure themselves, in millions, and hang a
            screenshot either side of it. The site cannot read a screenshot, so
            an organiser checks the two against each other in Track and can
            correct the number.
          </p>
          {/* The reason the loot wins rather than the count, said where the
              decision is made. An organiser comparing loot against kills will
              otherwise read the mismatch as a broken figure. */}
          <p className="muted new-game-note">
            The count keeps climbing after someone hands their screenshots in,
            so a player who carries on afterwards will show more than their
            loot covers. That is why the loot decides it and the count is only
            shown.
          </p>
        </Pick>
      </PickSet>

      {/* Asked once, under both answers, because both count the same way. A
          fieldset because that is what a group of fields is -- the legend
          names it, and `.pick-ask` is the voice the questions above use. */}
      <fieldset className="pick-set">
        <legend className="pick-ask">What is counted?</legend>
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

            A switch rather than another box: the boxes above are answers
            to a question, and this is one setting that is on or off. The
            stylesheet already keeps those apart -- a switch goes green,
            every gold thing in here means picked. */}
        <div className="switch-row">
          <span className="switch-label">
            Count every account a player has
            <span className="muted">
              {allAccounts
                ? 'Every account on an entrant’s list goes on the competition and '
                  + 'their figures are added up. For a bingo, where people play alts.'
                : 'One account each — the one they pick when they sign up. For a '
                  + 'weekly event, where two accounts would be two chances at the same ladder.'}
            </span>
          </span>
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              checked={allAccounts}
              disabled={busy}
              aria-label="Count every account a player has"
              onChange={(e) => setAllAccounts(e.target.checked)}
            />
            <span className="switch-track" aria-hidden="true" />
          </label>
        </div>
      </fieldset>

      <div className="row new-game-fields cnew-create">
        <button
          disabled={busy || !ready}
          onClick={async () => {
            const result = await onCreate({
              mode: 'challenge',
              name: name.trim(),
              endsAt: new Date(endsAt).toISOString(),
              solo,
              womMetric: metric.trim(),
              // Both halves of the loot figure, or neither. `gp` is the unit
              // millions.js already formats everywhere else.
              declaredLabel: loot ? LOOT_LABEL : null,
              declaredUnit: loot ? 'gp' : null,
              rankedBy: loot ? 'declared' : 'wom',
              teams: solo ? [] : filled,
              allAccounts,
            });
            if (result) {
              setName(''); setEndsAt(''); setTeamNames(['', '']);
              setAllAccounts(false);
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
