import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  myAccounts, addAccount, setPrimaryAccount, removeAccount,
} from '../lib/supabase.js';
import {
  MAX_ACCOUNTS, MAX_RSN, accountStatus, hasRsn, rsnClean, rsnError,
} from '../lib/accounts.js';

/**
 * My Account: the RuneScape names this player plays under.
 *
 * THE PROBLEM THIS EXISTS FOR. Sign-up copies the platform username into
 * profiles.rsn (Login.jsx), and until this screen there was nowhere to change
 * it. Anyone who did not register under their exact in-game name has had a
 * wrong name on their profile ever since, and Wise Old Man quietly scored them
 * zero for it. Correcting it on a challenge entry fixed that one event and
 * nothing else, because the entry snapshots the name on purpose.
 *
 * A LIST, not a field. Alts are normal. The primary is the one that lands in
 * profiles.rsn and the one a challenge sign-up box starts from; the rest are
 * there so an all-accounts event can score them all, and so an organiser
 * reviewing a screenshot can tell this player's own alt from a stranger.
 *
 * Who sees the list: the player, and organisers. Not the clan — people hide
 * their alts, and a settings screen should not publish them. The primary name
 * is as public as it always was, through profiles.
 */
export default function MyAccount({ profileId, onClose }) {
  const [accounts, setAccounts] = useState(null);
  const [rsn, setRsn] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setAccounts(await myAccounts() ?? []);
      setError(null);
    } catch (err) {
      setError(err.message);
      setAccounts([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Same reasoning as ConfirmDialog and PasswordResetDialog: hand focus back
  // to whatever opened this rather than leaving it on <body>.
  const openerRef = useRef(undefined);
  if (openerRef.current === undefined) openerRef.current = document.activeElement;
  useEffect(() => () => {
    const opener = openerRef.current;
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }, []);

  async function run(fn, message) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await load();
      if (message) setNotice(message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Only once something has been typed: a blank box is not a mistake, it is a
  // box nobody has got to yet, and a red line under it on open would be.
  const typed = rsn.trim().length > 0;
  const problem = typed ? rsnError(rsn) : null;
  const duplicate = typed && !problem && hasRsn(accounts ?? [], rsn);
  const full = (accounts?.length ?? 0) >= MAX_ACCOUNTS;
  const canAdd = typed && !problem && !duplicate && !full && !busy;

  function add() {
    const clean = rsnClean(rsn);
    run(
      () => addAccount(profileId, clean, label.trim() || null),
      `${clean} added.`,
    ).then(() => { setRsn(''); setLabel(''); });
  }

  return createPortal(
    <div
      className="confirm-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="confirm my-account" role="dialog" aria-modal="true" aria-labelledby="my-account-title">
        <h3 id="my-account-title">My accounts</h3>
        <p className="confirm-message">
          The RuneScape names you play under. Wise Old Man matches these exactly,
          so they have to be spelled the way the hiscores spell them — your name
          on this site has nothing to do with it.
        </p>

        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}

        {accounts === null ? (
          <p className="muted">Loading…</p>
        ) : accounts.length === 0 ? (
          <p className="muted">
            No accounts yet. Add the one you play on and it will be used for every
            event you enter.
          </p>
        ) : (
          <ul className="rsn-list">
            {accounts.map((a) => {
              const status = accountStatus(a);
              return (
                <li key={a.id} className="rsn-row">
                  <div className="rsn-name">
                    <strong>{a.rsn}</strong>
                    {a.is_primary && <span className="badge">main</span>}
                    {a.label && <span className="muted"> · {a.label}</span>}
                  </div>
                  <p className={status.tone === 'error' ? 'error' : 'muted'}>{status.text}</p>
                  <div className="row">
                    {!a.is_primary && (
                      <button
                        className="ghost"
                        disabled={busy}
                        onClick={() => run(() => setPrimaryAccount(a.id), `${a.rsn} is now your main.`)}
                      >
                        Make this my main
                      </button>
                    )}
                    {/* Two presses, because a removed account comes off any
                        running all-accounts event with it, and that is not
                        something to do with one stray click. */}
                    {confirming === a.id ? (
                      <>
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() => {
                            setConfirming(null);
                            run(() => removeAccount(a.id), `${a.rsn} removed.`);
                          }}
                        >
                          Really remove {a.rsn}
                        </button>
                        <button className="ghost" disabled={busy} onClick={() => setConfirming(null)}>
                          Keep it
                        </button>
                      </>
                    ) : (
                      <button className="ghost" disabled={busy} onClick={() => setConfirming(a.id)}>
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* The add form. Hidden at the cap rather than left there to be
            refused by the database a press later. */}
        {!full ? (
          <div className="rsn-add">
            <label className="field-name">Add an account
              <input
                ref={inputRef}
                value={rsn}
                maxLength={MAX_RSN}
                placeholder="Exactly as the hiscores spell it"
                disabled={busy}
                onChange={(e) => setRsn(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && canAdd) add(); }}
              />
            </label>
            <label className="field-name">What it is <span className="muted">(optional)</span>
              <input
                value={label}
                maxLength={40}
                placeholder="main, ironman, the slayer alt…"
                disabled={busy}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && canAdd) add(); }}
              />
            </label>
            {problem && <p className="field-error">{problem}</p>}
            {duplicate && <p className="field-error">That one is already on your list.</p>}
            <div className="row">
              <button disabled={!canAdd} onClick={add}>
                {busy ? 'Saving…' : 'Add account'}
              </button>
            </div>
          </div>
        ) : (
          <p className="muted">
            {MAX_ACCOUNTS} accounts is the limit — remove one to add another.
          </p>
        )}

        <div className="confirm-actions">
          <button className="ghost" onClick={onClose} disabled={busy}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
