import { useState } from 'react';
import { Pick, PickSet } from '../Pick.jsx';
import DateTimeField from '../DateTimeField.jsx';
import MetricPicker from './MetricPicker.jsx';

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
 * board, so none of that form's board fields applies to it -- no card size and
 * no grid. Its two times are the whole event, and unlike every other mode's
 * they both decide something: the clock opens it at one and settles it at the
 * other.
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
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [solo, setSolo] = useState(true);
  const [teamNames, setTeamNames] = useState(['', '']);

  const [kind, setKind] = useState('hiscores');
  const [metric, setMetric] = useState('clue_scrolls_all');
  // One account per person unless the organiser says otherwise: that is the
  // rule the weekly events run on, and the one the schema has enforced since
  // the mode existed.
  const [allAccounts, setAllAccounts] = useState(false);

  const loot = kind === 'loot';
  const filled = teamNames.map((n) => n.trim()).filter(Boolean);
  const duplicate = new Set(filled.map((n) => n.toLowerCase())).size !== filled.length;
  // Only once both are given: a half-filled pair is not yet wrong, and an
  // error that appears the moment you pick a start is an error about nothing.
  const ordered = !startsAt || !endsAt || new Date(endsAt) > new Date(startsAt);

  const ready = name.trim()
    && startsAt
    && endsAt
    && ordered
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
        {/* Both required, unlike every other mode's, and both acted on. A
            challenge is a window: the figures are what changed between its two
            ends, so there is nothing to measure without them -- and whoever
            has the page open makes the clock turn, so nobody has to be awake
            on a Monday morning to let an event begin. */}
        <DateTimeField
          label="Start time"
          hint="(it opens itself then)"
          value={startsAt}
          onChange={setStartsAt}
          disabled={busy}
        />
        <DateTimeField
          label="End time"
          hint="(it settles itself then)"
          value={endsAt}
          onChange={setEndsAt}
          disabled={busy}
        />
      </div>
      {!ordered && <p className="error">The end time has to be after the start time.</p>}

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

      <PickSet ask="What decides it?" even>
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
        />
      </PickSet>

      {/* Asked once, under both answers, because both count the same way. A
          fieldset because that is what a group of fields is -- the legend
          names it, and `.pick-ask` is the voice the questions above use.

          Pictures rather than a list: see MetricPicker for why. */}
      <fieldset className="pick-set">
        <legend className="pick-ask">What is counted?</legend>
        <MetricPicker value={metric} disabled={busy} onChange={setMetric} />

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
              startsAt: new Date(startsAt).toISOString(),
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
              setName(''); setStartsAt(''); setEndsAt(''); setTeamNames(['', '']);
              setAllAccounts(false);
            }
          }}
        >
          Create
        </button>
        <span className="muted">
          Sign-ups open the moment it is created and stay open while it runs.
          You can still start or end it by hand.
        </span>
      </div>
    </>
  );
}
