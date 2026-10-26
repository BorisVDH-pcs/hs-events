import { useEffect, useMemo, useState } from 'react';
import { figureLabel, figureToStored, metricLabel, storedToInput, womLabel } from '../../lib/challenge.js';
import { signedUrls } from '../../lib/evidence.js';

/**
 * The organiser's review list.
 *
 * One card per entrant, with the number they gave, the shots behind it, and the
 * two things only an organiser can do: correct the number, and say it has been
 * checked. The site cannot read a screenshot — that was settled when the mode
 * was designed — so this list is the whole of how a declared figure becomes
 * trustworthy.
 *
 * WHICH IS WHY THE PICTURES ARE THE CARD. They used to be two 13px links
 * reading "open", underneath a full-width correction box that was the largest
 * thing on every card whether or not anything needed correcting. The job here
 * is to hold one number against two screenshots, so the screenshots are now
 * thumbnails in the middle of the card, the figures read as figures rather
 * than as a sentence with colons in it, and the correction box is folded away
 * behind a quiet button until an organiser asks for it (see EntryCard).
 *
 * Correcting a figure records who corrected it and shows it on every screen
 * afterwards, here and on the player's own. A number quietly changed behind
 * someone's back is worse than a wrong one.
 */
export default function ChallengeEntries({
  entries = [], setup, teams = [], busy = false,
  onSetFigure, onVerify, onSetTeam,
}) {
  const hasWom = Boolean(setup?.wom_metric);
  const hasDeclared = Boolean(setup?.declared_label);
  const solo = setup?.solo !== false;

  /*
   * One signing pass for the whole list, not one per row.
   *
   * The bucket is private, so a stored shot has no address until it is signed,
   * and signing is a round trip -- forty entrants each asking for their own
   * would be forty. Rows made while pasting a link was the only way in carry a
   * plain `url` instead and need none of this.
   */
  const [urls, setUrls] = useState({});
  const paths = entries
    .flatMap((e) => e.evidence ?? [])
    .map((s) => s.storage_path).filter(Boolean).join('|');
  useEffect(() => {
    if (!paths) { setUrls({}); return undefined; }
    let live = true;
    signedUrls(paths.split('|'))
      .then((map) => { if (live) setUrls(map); })
      // One picture that will not sign must not take the review list with it:
      // ShotFrame says so where the picture would have been.
      .catch(() => { if (live) setUrls({}); });
    return () => { live = false; };
  }, [paths]);

  const checked = entries.filter((e) => e.verified_at).length;
  const noTeam = entries.filter((e) => !e.team_id).length;

  /*
   * Which entrants are shown.
   *
   * A weekly event runs to forty-odd of them, and the question an organiser has
   * while working down the list is always "what is left?". That is a filter and
   * not a sort: re-ordering the list under somebody mid-check moves the card
   * they were reading.
   *
   * Only offered where there is something to check -- on a hiscores-only event
   * every card is the same kind of card.
   */
  const [show, setShow] = useState('all');
  const shown = useMemo(() => {
    if (!hasDeclared || show === 'all') return entries;
    return entries.filter((e) => (show === 'checked' ? e.verified_at : !e.verified_at));
  }, [entries, hasDeclared, show]);

  return (
    <section className="card challenge-entries">
      <div className="challenge-entries-head">
        <h2>Entrants</h2>
        <p className="muted">
          {entries.length} {entries.length === 1 ? 'entrant' : 'entrants'}
          {hasDeclared && ` · ${checked} checked`}
          {!solo && noTeam > 0 && ` · ${noTeam} with no team`}
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="muted">Nobody has signed up yet.</p>
      ) : (
        <>
          {hasDeclared && entries.length > 1 && (
            <div className="tabs entries-tabs" role="tablist" aria-label="Which entrants to show">
              {[
                ['all', 'All', entries.length],
                ['todo', 'To check', entries.length - checked],
                ['checked', 'Checked', checked],
              ].map(([key, label, n]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={show === key}
                  className={show === key ? 'on' : undefined}
                  onClick={() => setShow(key)}
                >
                  {label} <span className="team-count">{n}</span>
                </button>
              ))}
            </div>
          )}

          {shown.length === 0 ? (
            <p className="muted">
              {show === 'todo' ? 'Every number has been checked.' : 'None checked yet.'}
            </p>
          ) : (
            <ul className="challenge-entry-list">
              {shown.map((e) => (
                <EntryCard
                  key={e.entry_id}
                  entry={e}
                  setup={setup}
                  teams={teams}
                  busy={busy}
                  hasWom={hasWom}
                  hasDeclared={hasDeclared}
                  solo={solo}
                  urls={urls}
                  onSetFigure={onSetFigure}
                  onVerify={onVerify}
                  onSetTeam={onSetTeam}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function EntryCard({ entry, setup, teams, busy, hasWom, hasDeclared, solo, urls, onSetFigure, onVerify, onSetTeam }) {
  const unit = setup?.declared_unit ?? null;
  const [figure, setFigure] = useState(() => storedToInput(entry.declared, unit));
  // Folded away until asked for: on most cards the number is right, and a box
  // standing open on all forty of them is forty invitations to change one.
  const [correcting, setCorrecting] = useState(false);

  // Follows the entry rather than freezing at what it was when the list was
  // drawn: a player can send a new number in while this is on screen.
  useEffect(() => { setFigure(storedToInput(entry.declared, unit)); }, [entry.declared, unit]);

  const typed = figureToStored(figure, unit);
  const unchanged = typed !== null && typed === (entry.declared ?? null);
  const shots = entry.evidence ?? [];
  const startShots = shots.filter((s) => s.phase === 'start');
  const finishShots = shots.filter((s) => s.phase === 'finish');
  const nothing = entry.declared === null || entry.declared === undefined;

  return (
    <li className={entry.verified_at ? 'checked' : undefined}>
      <div className="challenge-entry-head">
        <div className="challenge-entry-who">
          <strong>{entry.name}</strong>
          {entry.rsn && entry.rsn !== entry.name && (
            <span className="muted">{entry.rsn} in game</span>
          )}
        </div>
        {hasDeclared && (
          <span className={entry.verified_at ? 'pill active' : 'pill'}>
            {entry.verified_at ? 'Checked' : 'To check'}
          </span>
        )}
      </div>

      {/* Label over value, so two figures read as two figures. */}
      <div className="challenge-entry-figures">
        {hasWom && (
          <div className="challenge-figure">
            <span className="challenge-figure-label">{metricLabel(setup.wom_metric)}</span>
            <strong>{womLabel(entry.wom_gained)}</strong>
          </div>
        )}
        {hasDeclared && (
          <div className="challenge-figure">
            <span className="challenge-figure-label">{setup.declared_label}</span>
            <strong>{figureLabel(entry.declared, unit)}</strong>
            {entry.altered_by && (
              <span className="muted">set by {entry.altered_by_name ?? 'an organiser'}</span>
            )}
          </div>
        )}
        {!solo && (
          <label className="challenge-figure challenge-entry-team">
            <span className="challenge-figure-label">Team</span>
            <select
              value={entry.team_id ?? ''}
              disabled={busy}
              onChange={(ev) => onSetTeam?.(entry.entry_id, ev.target.value || null)}
            >
              <option value="">— none —</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
      </div>

      {hasDeclared && (
        <>
          {/* Somebody who has sent nothing at all gets a line, not a pair of
              empty frames: there is nothing to compare yet. A number with no
              pictures behind it is a different thing, and keeps the frames --
              that is the case an organiser has to see. */}
          {nothing && shots.length === 0 ? (
            <p className="muted challenge-entry-note">
              Nothing sent yet — no number, no screenshots.
            </p>
          ) : (
            <div className="challenge-entry-shots">
              <ShotFrame label="Start" shots={startShots} urls={urls} who={entry.name} />
              <ShotFrame label="Finish" shots={finishShots} urls={urls} who={entry.name} />
            </div>
          )}

          <div className="challenge-entry-actions">
            {correcting ? (
              <div className="row challenge-correct">
                <label className="field-size">
                  <span>
                    {nothing ? 'The number' : 'Correct it'}
                    {unit === 'gp' && <span className="muted"> (millions)</span>}
                  </span>
                  <input
                    value={figure}
                    inputMode="decimal"
                    disabled={busy}
                    autoFocus
                    onChange={(ev) => setFigure(ev.target.value)}
                  />
                </label>
                <button
                  disabled={busy || typed === null || unchanged}
                  onClick={async () => {
                    await onSetFigure?.(entry.entry_id, typed);
                    setCorrecting(false);
                  }}
                >
                  Save
                </button>
                <button
                  className="link"
                  disabled={busy}
                  onClick={() => { setFigure(storedToInput(entry.declared, unit)); setCorrecting(false); }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                {/* The one action the screen is for keeps the filled button.
                    Correcting a number is the rarer of the two and reads as a
                    link, so forty cards are not forty gold pairs. */}
                <button
                  className={entry.verified_at ? 'ghost' : undefined}
                  disabled={busy}
                  onClick={() => onVerify?.(entry.entry_id, !entry.verified_at)}
                >
                  {entry.verified_at ? 'Undo checked' : 'Mark checked'}
                </button>
                <button className="link" disabled={busy} onClick={() => setCorrecting(true)}>
                  {nothing ? 'Enter the number' : 'Correct the number'}
                </button>
              </>
            )}
          </div>

          {entry.verified_at && !correcting && (
            <p className="muted challenge-entry-note">
              Checked — the player cannot change it now.
            </p>
          )}
        </>
      )}
    </li>
  );
}

/**
 * One phase's shots, as the picture itself.
 *
 * The newest is the one that counts: a player who replaced a picture cropped
 * wrong meant the second one. So that is the thumbnail, and the tries before it
 * follow quietly underneath rather than as equal numbered siblings -- which is
 * what they were, leaving an organiser to guess which of "1 2 3" to open.
 *
 * A phase with nothing in it draws an empty frame rather than the word "none"
 * in grey: half a pair of screenshots is what this screen most needs to show at
 * a glance, and an outline says it without having to be read.
 */
function ShotFrame({ label, shots, urls, who }) {
  const current = shots.length ? shots[shots.length - 1] : null;
  const earlier = shots.slice(0, -1);
  const href = current && (current.storage_path ? urls[current.storage_path] : current.url);

  return (
    <div className="challenge-shot">
      <span className="challenge-figure-label">{label}</span>
      {!current ? (
        <span className="challenge-shot-empty">Not sent</span>
      ) : !href ? (
        <span className="challenge-shot-empty">Signing…</span>
      ) : (
        <a href={href} target="_blank" rel="noreferrer" title={current.note ?? undefined}>
          <img src={href} alt={`${label} screenshot from ${who}`} loading="lazy" />
        </a>
      )}
      {earlier.length > 0 && (
        <span className="challenge-shot-earlier">
          {earlier.map((s, i) => (
            <Shot key={s.id} shot={s} urls={urls} text={`try ${i + 1}`} />
          ))}
        </span>
      )}
    </div>
  );
}

/** An earlier try, signed if it is a file and plain if it is an older pasted link. */
function Shot({ shot, urls, text }) {
  const href = shot.storage_path ? urls[shot.storage_path] : shot.url;
  if (!href) return <span className="muted">{text} — signing…</span>;
  return (
    <a
      className="shot-earlier-link"
      href={href} target="_blank" rel="noreferrer"
      title={shot.note ?? undefined}
    >
      {text}
    </a>
  );
}
