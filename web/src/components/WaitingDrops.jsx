import { useCallback, useEffect, useState } from 'react';
import { waitingDrops } from '../lib/supabase.js';
import { handInWaitingDrop, signedUrls } from '../lib/evidence.js';
import { evidenceSource } from '../lib/evidenceSource.js';
import { choiceLabel, clock, waitsUntil, WAIT_MINUTES } from '../lib/waitingDrops.js';
import { useConfirm } from './ConfirmDialog.jsx';

/**
 * Drops waiting for a tile: Dink sent a drop that more than one of the team's
 * open tiles wants, and anyone on the team chooses where it counts (Boris,
 * 2026-11-21). Region Bingo and Bingo, the modes a plugin hands drops in for.
 *
 * The database decides everything: which drops are listed (the caller's own
 * team's, for an hour), which tiles each can still go to (only ones that
 * wanted it when it dropped and still do), and the hand-in itself
 * (supabase/migrations/20261121120100_plugin_drops.sql, section 6c). This only shows
 * the list and passes on the choice.
 *
 * Hidden while there is nothing waiting, and on a database without the
 * functions (the live project today).
 *
 * A drop arrives without anything in the feed, so the list is asked again
 * every half minute while the page is in view, and whenever the feed moves (a
 * teammate chose, a tile filled up).
 */
const POLL_MS = 30_000;
const DONE_MS = 8_000;

export default function WaitingDrops({ gameId, events, onHandedIn }) {
  const [drops, setDrops] = useState(null);
  const [urls, setUrls] = useState({});
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(async () => {
    try {
      setDrops(await waitingDrops(gameId));
    } catch (e) {
      setMessage({ error: true, text: `Could not load the drops waiting for a tile: ${e.message}` });
    }
  }, [gameId]);

  const feedKey = events?.length ?? 0;
  useEffect(() => { load(); }, [load, feedKey]);
  useEffect(() => {
    const poll = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [load]);

  // Thumbnails: signed links for files not asked for yet.
  useEffect(() => {
    const missing = (drops ?? []).map((d) => d.storage_path).filter((p) => p && !(p in urls));
    if (!missing.length) return undefined;
    let live = true;
    signedUrls(missing)
      .then((got) => { if (live) setUrls((u) => ({ ...u, ...got })); })
      .catch(() => {});
    return () => { live = false; };
    // `urls` is left out on purpose: it is what this fills in.
  }, [drops]);

  // "Handed in" goes away on its own; a refusal stays until the next press.
  useEffect(() => {
    if (!message || message.error) return undefined;
    const t = setTimeout(() => setMessage(null), DONE_MS);
    return () => clearTimeout(t);
  }, [message]);

  async function choose(drop, choice) {
    const where = choiceLabel(choice);
    const yes = await confirm(
      `${drop.item} counts for ${where}, and for no other tile. Only an organiser can take it back.`,
      { title: `Hand it in for ${where}?`, confirmLabel: 'Hand it in' },
    );
    if (!yes) return;
    setBusy(`${drop.id}:${choice.tile_id}:${choice.option_id}`);
    setMessage(null);
    try {
      await handInWaitingDrop({ waitingId: drop.id, tileId: choice.tile_id, optionId: choice.option_id });
      setMessage({ error: false, text: `Handed in: ${drop.item} for ${where}.` });
      onHandedIn?.();
    } catch (e) {
      // A teammate may have chosen first, or the hour run out: the list says.
      setMessage({ error: true, text: e.message });
    } finally {
      setBusy(null);
      load();
    }
  }

  const shown = (drops ?? []).filter((d) => Date.parse(d.expires_at) > now && d.choices?.length);
  if (!shown.length && !message) return confirmDialog;

  return (
    <section className="waiting-drops" aria-labelledby="waiting-drops-title">
      {shown.length > 0 && (
        <>
          <h2 id="waiting-drops-title">
            {shown.length === 1 ? 'A drop is waiting for a tile' : `${shown.length} drops are waiting for a tile`}
          </h2>
          <p className="muted waiting-drops-intro">
            Dink sent a drop that more than one of your tiles wants. Anyone on the team can choose
            where it counts, within {WAIT_MINUTES} minutes of the drop. After that it no longer counts.
          </p>
        </>
      )}
      {message && (
        <p className={message.error ? 'error' : 'waiting-drops-done'} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
      {shown.length > 0 && (
        <ul className="waiting-drops-list">
          {shown.map((d) => {
            const sent = evidenceSource({ source: d.detail?.source === 'plugin' ? 'plugin' : 'dink', detail: d.detail });
            const url = urls[d.storage_path];
            const meta = [d.dropped_by, clock(d.received_at), ...(sent?.lines ?? [])].filter(Boolean).join(' · ');
            return (
              <li key={d.id} className="waiting-drop">
                {url ? (
                  <a className="waiting-drop-shot" href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt={`Dink's screenshot of ${d.item}`} loading="lazy" />
                  </a>
                ) : (
                  <span className="waiting-drop-shot waiting-drop-pending" aria-hidden="true" />
                )}
                <div className="waiting-drop-meta">
                  <span className="waiting-drop-what">{sent?.drop ?? d.item}</span>
                  {meta && <span className="muted">{meta}</span>}
                  <span className="waiting-drop-clock">{waitsUntil(d.expires_at, now)}</span>
                </div>
                <div className="waiting-drop-choices" role="group" aria-label={`Where ${d.item} counts`}>
                  <span>Count it for</span>
                  {d.choices.map((c) => (
                    <button
                      key={`${c.tile_id}:${c.option_id}`}
                      type="button"
                      className="ghost"
                      disabled={busy !== null}
                      onClick={() => choose(d, c)}
                    >
                      {busy === `${d.id}:${c.tile_id}:${c.option_id}` ? 'Handing in…' : choiceLabel(c)}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {confirmDialog}
    </section>
  );
}
