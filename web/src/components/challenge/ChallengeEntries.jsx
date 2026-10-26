import { useEffect, useState } from 'react';
import { figureLabel, figureToStored, metricLabel, storedToInput, womLabel } from '../../lib/challenge.js';
import { signedUrls } from '../../lib/evidence.js';

/**
 * The organiser's review list.
 *
 * One row per entrant, with the number they gave, the shots behind it, and the
 * two things only an organiser can do: correct the number, and say it has been
 * checked. The site cannot read a screenshot — that was settled when the mode
 * was designed — so this list is the whole of how a declared figure becomes
 * trustworthy.
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
      // ShotLinks says so where the link would have been.
      .catch(() => { if (live) setUrls({}); });
    return () => { live = false; };
  }, [paths]);

  return (
    <section className="card challenge-entries">
      <h2>Entrants</h2>
      {entries.length === 0 ? (
        <p className="muted">Nobody has signed up yet.</p>
      ) : (
        <>
          <p className="muted">
            {entries.length} {entries.length === 1 ? 'entrant' : 'entrants'}
            {hasDeclared && ` · ${entries.filter((e) => e.verified_at).length} checked`}
            {!solo && ` · ${entries.filter((e) => !e.team_id).length} with no team`}
          </p>
          <ul className="challenge-entry-list">
            {entries.map((e) => (
              <EntryRow
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
        </>
      )}
    </section>
  );
}

function EntryRow({ entry, setup, teams, busy, hasWom, hasDeclared, solo, urls, onSetFigure, onVerify, onSetTeam }) {
  const unit = setup?.declared_unit ?? null;
  const [figure, setFigure] = useState(() => storedToInput(entry.declared, unit));

  // Follows the entry rather than freezing at what it was when the list was
  // drawn: a player can send a new number in while this is on screen.
  useEffect(() => { setFigure(storedToInput(entry.declared, unit)); }, [entry.declared, unit]);

  const typed = figureToStored(figure, unit);
  const unchanged = typed !== null && typed === (entry.declared ?? null);
  const shots = entry.evidence ?? [];
  const startShots = shots.filter((s) => s.phase === 'start');
  const finishShots = shots.filter((s) => s.phase === 'finish');

  return (
    <li className={entry.verified_at ? 'checked' : undefined}>
      <div className="challenge-entry-head">
        <strong>{entry.name}</strong>
        {entry.rsn && entry.rsn !== entry.name && <span className="muted"> · {entry.rsn}</span>}
        {!solo && (
          <label className="field-size">Team
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

      <div className="challenge-entry-figures">
        {hasWom && (
          <span>
            <span className="muted">{metricLabel(setup.wom_metric)}: </span>
            <strong>{womLabel(entry.wom_gained)}</strong>
          </span>
        )}
        {hasDeclared && (
          <span>
            <span className="muted">{setup.declared_label}: </span>
            <strong>{figureLabel(entry.declared, unit)}</strong>
            {entry.altered_by && (
              <span className="muted"> — set by {entry.altered_by_name ?? 'an organiser'}</span>
            )}
          </span>
        )}
      </div>

      {hasDeclared && (
        <>
          <div className="challenge-entry-shots">
            <ShotLinks label="Start" shots={startShots} urls={urls} />
            <ShotLinks label="Finish" shots={finishShots} urls={urls} />
          </div>

          <div className="row challenge-entry-actions">
            <label className="field-size">
              <span>Correct it{unit === 'gp' && <span className="muted"> (millions)</span>}</span>
              <input
                value={figure}
                inputMode="decimal"
                disabled={busy}
                onChange={(ev) => setFigure(ev.target.value)}
              />
            </label>
            <button
              className="ghost"
              disabled={busy || typed === null || unchanged}
              onClick={() => onSetFigure?.(entry.entry_id, typed)}
            >
              Save
            </button>
            <button
              className={entry.verified_at ? 'ghost' : undefined}
              disabled={busy}
              onClick={() => onVerify?.(entry.entry_id, !entry.verified_at)}
            >
              {entry.verified_at ? 'Undo checked' : 'Mark checked'}
            </button>
            {entry.verified_at && (
              <span className="muted">
                Checked — the player cannot change it now.
              </span>
            )}
          </div>
        </>
      )}
    </li>
  );
}

/**
 * One phase's shots.
 *
 * The newest is the one that counts: a player who replaced a picture cropped
 * wrong meant the second one. So that is the link, and the tries before it
 * follow quietly rather than as equal numbered siblings -- which is what they
 * were, leaving an organiser to guess which of "1 2 3" to open.
 */
function ShotLinks({ label, shots, urls }) {
  const current = shots.length ? shots[shots.length - 1] : null;
  const earlier = shots.slice(0, -1);
  return (
    <span>
      <span className="muted">{label}: </span>
      {!current ? <span className="muted">none</span> : (
        <>
          <Shot shot={current} urls={urls} text="open" />
          {earlier.map((s, i) => (
            <Shot key={s.id} shot={s} urls={urls} text={`try ${i + 1}`} quiet />
          ))}
        </>
      )}
    </span>
  );
}

/** One shot, signed if it is a file and plain if it is an older pasted link. */
function Shot({ shot, urls, text, quiet }) {
  const href = shot.storage_path ? urls[shot.storage_path] : shot.url;
  if (!href) return <span className="muted">{text} — signing…</span>;
  return (
    <a
      className={quiet ? 'shot-earlier-link' : undefined}
      href={href} target="_blank" rel="noreferrer"
      title={shot.note ?? undefined}
    >
      {text}
    </a>
  );
}
