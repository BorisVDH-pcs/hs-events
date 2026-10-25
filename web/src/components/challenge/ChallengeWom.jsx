import { useEffect, useState } from 'react';
import { metricLabel, womCompetitionUrl } from '../../lib/challenge.js';

/**
 * The competition behind the event, for whoever is running it.
 *
 * An organiser could already reach the standings by joining their own event as
 * a player, which is a silly thing to have to do. What they could not reach at
 * all was the verification code — the credential WOM asks for before it will
 * let anybody edit or delete the competition. Without it an event with a
 * mistake in it can only be abandoned.
 *
 * So the code is here, but behind a click. A console is the screen most likely
 * to be screenshotted for a bug report or shared over a call, and WOM has no
 * way to issue a new code once one is out. It is not fetched until the click
 * either: `adminChallengeWom` only sends it when asked.
 */
export default function ChallengeWom({
  wom, setup, busy = false, onReveal, onLink, onRetry,
}) {
  const [code, setCode] = useState(null);
  const [compId, setCompId] = useState('');
  const [linkCode, setLinkCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const id = wom?.competition_id ?? null;

  // A different event is a different competition. Never leave one event's
  // code on screen while another one's links are under it.
  useEffect(() => {
    setCode(null);
    setCopied(false);
    setCompId('');
    setLinkCode('');
    setError('');
  }, [id]);

  if (!setup?.wom_metric) return null;

  const reveal = async () => {
    setLoading(true);
    setError('');
    try {
      setCode(await onReveal());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard access is refused often enough — over plain http, or with
      // the window out of focus — that failing silently would look like a
      // dead button. The code is on screen; say so.
      setError('Could not copy it. Select it and copy it by hand.');
    }
  };

  return (
    <section className="card challenge-wom">
      <h2>Wise Old Man</h2>
      <p className="muted">
        {metricLabel(setup.wom_metric)} is counted by the competition this event
        made on Wise Old Man.
      </p>

      {id ? (
        <>
          <div className="challenge-wom-link">
            <a href={womCompetitionUrl(id)} target="_blank" rel="noreferrer noopener">
              The competition ↗
            </a>
            <a href={womCompetitionUrl(id, 'participants')} target="_blank" rel="noreferrer noopener">
              Who is in it ↗
            </a>
          </div>

          <dl className="challenge-wom-facts">
            <dt>Competition</dt>
            <dd>{id}</dd>
            <dt>Standings last read</dt>
            <dd>{wom.fetched_at ? new Date(wom.fetched_at).toLocaleString() : 'not yet'}</dd>
          </dl>

          {wom.has_code === false ? (
            <p className="muted">
              Wise Old Man sent no verification code back when this competition
              was made, so it cannot be edited from here.
            </p>
          ) : code === null ? (
            <div className="row">
              <button className="ghost" disabled={busy || loading} onClick={reveal}>
                {loading ? 'Fetching…' : 'Show the verification code'}
              </button>
            </div>
          ) : (
            <>
              <p className="challenge-wom-code"><code>{code}</code></p>
              <div className="row">
                <button className="ghost" disabled={busy} onClick={copy}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button className="ghost" onClick={() => { setCode(null); setCopied(false); }}>
                  Hide it
                </button>
              </div>
            </>
          )}

          <p className="muted challenge-wom-caution">
            The code lets anyone edit or delete the competition on Wise Old Man,
            and it cannot be replaced — treat it like a password. Taking a
            participant off by hand is safe. Changing the metric or the dates is
            not: nothing here reads those back, so the event and the competition
            would be counting different things.
          </p>
        </>
      ) : wom?.pending ? (
        <p className="muted">
          Wise Old Man has been asked for a competition and has not answered
          yet. It is tried again every minute.
        </p>
      ) : wom?.tried ? (
        <>
          <p className="error">
            Wise Old Man was asked for a competition and the reply never came
            back. It has very likely made one anyway — look for this event by
            name on Wise Old Man before you make a second.
          </p>

          <label className="field-name">The competition number on Wise Old Man
            <input
              value={compId}
              onChange={(e) => setCompId(e.target.value)}
              placeholder="162883"
              inputMode="numeric"
              disabled={busy}
            />
          </label>
          <label className="field-name">Verification code, if you have it
            <input
              value={linkCode}
              onChange={(e) => setLinkCode(e.target.value)}
              placeholder="Leave this empty if you do not"
              disabled={busy}
            />
          </label>

          <div className="row">
            <button
              className="ghost"
              disabled={busy || !/^[0-9]+$/.test(compId.trim())}
              onClick={() => onLink(Number(compId.trim()), linkCode.trim())}
            >
              Link that competition
            </button>
            <button className="ghost" disabled={busy} onClick={onRetry}>
              Make a new one instead
            </button>
          </div>

          <p className="muted challenge-wom-caution">
            Without the code the standings are still read — that part of Wise
            Old Man is public — but nobody can be added to or taken off the
            competition afterwards. The code is only ever shown in the reply to
            the request that made the competition, so a lost reply loses it for
            good.
          </p>
        </>
      ) : (
        <p className="muted">
          No competition yet — one is made when the event starts.
        </p>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}
