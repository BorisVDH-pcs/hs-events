import { useCallback, useEffect, useState } from 'react';
import {
  myTileSubmissions, submitTile, updateTileSubmission, withdrawTileSubmission,
} from '../lib/supabase.js';
import { draftFromRow, newDraft, payloadFromDraft, ruleSummary } from '../lib/tileDraft.js';
import { SUGGESTION_STATUS, nameTakenMessage, useNameStatus } from '../lib/tileSuggestions.js';
import TileForm from './TileForm.jsx';
import TileIcon from './TileIcon.jsx';
import { useConfirm } from './ConfirmDialog.jsx';

/**
 * A player's way into the catalogue: suggest a tile, and see what became of it.
 *
 * The form is the organiser's own TileForm, so a suggestion arrives in exactly
 * the shape a catalogue entry has and the review is an edit, not a retype.
 *
 * Players never see the catalogue itself — it is the pool boards are drawn
 * from (see 20261004120000_tile_submissions). So duplicates are caught by name:
 * the form asks the server whether the name is taken as typing pauses.
 *
 * Nothing here deletes. A pending suggestion can be edited or withdrawn, and a
 * withdrawn one stays in the list, marked as such.
 */
export default function TileSuggestions({ onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  // { id, draft, note } while the form is open; id null for a new suggestion.
  const [editing, setEditing] = useState(null);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(async () => {
    try {
      setRows((await myTileSubmissions()) ?? []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // An organiser may answer while this is open in a background tab.
  useEffect(() => {
    const recheck = () => { if (!document.hidden) load(); };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [load]);

  const nameStatus = useNameStatus(editing?.draft.name ?? '', editing?.id ?? null);
  const nameError = editing ? nameTakenMessage(nameStatus, editing.draft.name) : null;

  const pendingCount = rows.filter((r) => r.status === 'pending').length;

  async function save() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const payload = payloadFromDraft(editing.draft);
      if (editing.id) {
        await updateTileSubmission(editing.id, payload, editing.note);
        setNotice('Suggestion updated.');
      } else {
        await submitTile(payload, editing.note);
        setNotice('Thanks! Your tile is waiting for an organiser to review it.');
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(row) {
    if (!(await confirm(
      `Withdraw "${row.name}"? It stays in your list as withdrawn, and you can suggest it again later.`,
      { title: 'Withdraw this suggestion', confirmLabel: 'Withdraw it' }
    ))) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await withdrawTileSubmission(row.id);
      if (editing?.id === row.id) setEditing(null);
      setNotice('Suggestion withdrawn.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card suggestions">
      <div className="row suggestions-head">
        <h2>Suggest a tile</h2>
        {onClose && <button className="ghost" onClick={onClose}>← Back to the game</button>}
      </div>
      <p className="muted">
        Got an idea for a tile? Describe it here and an organiser will review it.
        If it is accepted it goes into the tile catalogue, and future boards can use it.
      </p>

      {error && <p className="error" role="alert"><span aria-hidden="true">✗ </span>{error}</p>}
      {notice && <p className="muted notice" role="status"><span aria-hidden="true">✓ </span>{notice}</p>}

      {editing ? (
        <div className="suggestion-editor">
          <h3>{editing.id ? 'Edit your suggestion' : 'New suggestion'}</h3>
          <TileForm
            draft={editing.draft}
            onChange={(draft) => setEditing((e) => ({ ...e, draft }))}
            busy={busy}
            saveLabel={editing.id ? 'Save changes' : 'Send for review'}
            onSave={save}
            onCancel={() => setEditing(null)}
            extraErrors={nameError ? [nameError] : []}
            extraFields={(
              <label className="field">
                <span>Note to the organisers <em className="muted">optional</em></span>
                <textarea
                  className="tile-form-note"
                  value={editing.note}
                  onChange={(e) => setEditing((s) => ({ ...s, note: e.target.value }))}
                  placeholder="Anything they should know: why it is fun, who it suits, where the drops come from."
                  maxLength={500}
                />
              </label>
            )}
          />
        </div>
      ) : (
        <div className="row">
          <button
            onClick={() => { setNotice(null); setEditing({ id: null, draft: newDraft(), note: '' }); }}
            disabled={busy || pendingCount >= 10}
            title={pendingCount >= 10 ? 'You have 10 tiles waiting for review already' : undefined}
          >
            Suggest a new tile
          </button>
          {pendingCount >= 10 && (
            <span className="muted">You have 10 waiting for review. Wait for those first, or withdraw one.</span>
          )}
        </div>
      )}

      <h3>Your suggestions</h3>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <ul className="suggestion-list">
          {rows.map((row) => {
            const status = SUGGESTION_STATUS[row.status] ?? SUGGESTION_STATUS.pending;
            return (
              <li key={row.id} className={`suggestion ${row.status}`}>
                <span className="suggestion-icon">
                  <TileIcon slug={row.icon || null} fallback={<span aria-hidden="true">?</span>} />
                </span>
                <div className="suggestion-body">
                  <div className="suggestion-title">
                    <strong>{row.name}</strong>{' '}
                    <span className={`pill ${status.pill}`}>{status.label}</span>
                  </div>
                  <div className="muted">
                    {ruleSummary(row)} · sent {new Date(row.created_at).toLocaleDateString()}
                  </div>
                  {row.review_note && (
                    <p className="suggestion-reply">
                      <span className="muted">Organiser: </span>{row.review_note}
                    </p>
                  )}
                </div>
                {row.status === 'pending' && (
                  <div className="suggestion-actions">
                    <button
                      className="ghost"
                      disabled={busy}
                      onClick={() => {
                        setNotice(null);
                        setEditing({ id: row.id, draft: draftFromRow(row), note: row.player_note ?? '' });
                      }}
                    >
                      Edit
                    </button>
                    <button className="ghost" disabled={busy} onClick={() => withdraw(row)}>
                      Withdraw
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {confirmDialog}
    </section>
  );
}
