import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { adminProfileAccounts } from '../lib/supabase.js';
import { accountStatusShort } from '../lib/accounts.js';

/**
 * The RuneScape names one player plays under, for an organiser.
 *
 * WHAT IT IS FOR. When a score looks wrong the question is always the same:
 * which accounts does this person have, and has Wise Old Man ever found them?
 * Everywhere else in the console shows one name at a time -- the primary on a
 * profile, the one snapshotted on an entry, the one snapshotted on a sign-up
 * -- and none of them answers it. WOM accepts a name whose format is valid
 * whether or not the account exists, so a typo scores zero for a week and
 * looks exactly like bad luck until somebody reads this list.
 *
 * READ ONLY, deliberately. The player owns their list: every insert, update
 * and delete policy on profile_accounts is `profile_id = auth.uid()`, and an
 * organiser quietly renaming somebody's alt would be a worse problem than the
 * one this solves. If a name is wrong, the fix is to tell them -- the screen
 * that changes it is theirs.
 */
export default function PlayerAccountsDialog({ player, onClose }) {
  const [accounts, setAccounts] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    adminProfileAccounts(player.id)
      .then((rows) => { if (live) { setAccounts(rows ?? []); setError(null); } })
      .catch((err) => { if (live) { setError(err.message); setAccounts([]); } });
    return () => { live = false; };
  }, [player.id]);

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

  return createPortal(
    <div
      className="confirm-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="confirm" role="dialog" aria-modal="true" aria-labelledby="player-rsns-title">
        <h3 id="player-rsns-title">{player.display_name}’s RuneScape names</h3>
        <p className="confirm-message">
          What they have told the site they play under. Only they can change it.
        </p>

        {error && <p className="error">{error}</p>}

        {accounts === null ? (
          <p className="muted">Loading…</p>
        ) : accounts.length === 0 ? (
          <p className="muted">
            None on file. Until they add one, nothing they enter can be matched
            on the hiscores.
          </p>
        ) : (
          <ul className="rsn-list">
            {accounts.map((a) => {
              const status = accountStatusShort(a);
              return (
                <li key={a.id} className="rsn-row">
                  <div className="rsn-name">
                    <strong>{a.rsn}</strong>
                    {a.is_primary && <span className="badge">main</span>}
                    {/* Nobody can write one of these any more; shown where it
                        exists, the same as on the player's own screen. */}
                    {a.label && <span className="muted"> · {a.label}</span>}
                  </div>
                  <p className={status.tone === 'error' ? 'error' : 'muted'}>{status.text}</p>
                  {/* Only when there is one. "Never" is already what the line
                      above says, in the words that explain it. */}
                  {a.last_seen && (
                    <p className="muted">
                      Last entered a tracked event on{' '}
                      {new Date(a.last_seen).toLocaleDateString()}.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="confirm-actions">
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
