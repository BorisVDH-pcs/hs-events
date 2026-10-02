import { useMemo, useState } from 'react';
import { draftFromRow, nameKey, payloadFromDraft, ruleSummary } from '../lib/tileDraft.js';
import { SUGGESTION_STATUS } from '../lib/tileSuggestions.js';
import TileForm from './TileForm.jsx';
import TileIcon from './TileIcon.jsx';

/**
 * The organiser's side of tile suggestions: the queue, and the history.
 *
 * Reviewing is editing. A suggestion opens in the same TileForm the catalogue
 * uses, already filled in, so fixing a typo or a price on the way in is one
 * change and a save — and what goes into the catalogue is what is on screen,
 * not what the player first typed.
 *
 * Players cannot see the catalogue, so they can only be stopped from repeating
 * a name exactly. The near-misses — "Barrows set" against "Full barrows set" —
 * are caught here instead, where the catalogue is already loaded.
 */

// Words that say nothing about which task a tile is.
const STOP = new Set(['a', 'an', 'the', 'of', 'any', 'from', 'and', 'or', 'in', 'at', 'to', 'for', 'x']);

const words = (name) => nameKey(name).split(/[^a-z0-9']+/).filter((w) => w.length > 1 && !STOP.has(w));

/**
 * Catalogue entries whose names look like this one, closest first.
 *
 * Deliberately crude — shared words, or one name inside the other — because
 * its job is to put a likely duplicate in front of a human, not to decide.
 */
export function similarEntries(name, library, limit = 5) {
  const key = nameKey(name);
  const mine = new Set(words(name));
  if (!key) return [];
  return library
    .map((entry) => {
      const other = nameKey(entry.name);
      if (other === key) return { entry, score: 100 };
      let score = words(entry.name).filter((w) => mine.has(w)).length;
      if (other.includes(key) || key.includes(other)) score += 2;
      return { entry, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, limit)
    .map((m) => m.entry);
}

export default function TileSuggestionReview({
  rows, error, library, busy, confirm, onAccept, onRefuse,
}) {
  // { id, draft, note } while one is open.
  const [open, setOpen] = useState(null);

  const pending = rows.filter((r) => r.status === 'pending');
  const history = rows.filter((r) => r.status !== 'pending');
  const openRow = open ? rows.find((r) => r.id === open.id) : null;

  // The catalogue's unique index, said before the save rather than after it.
  const clash = useMemo(() => {
    if (!open) return null;
    const key = nameKey(open.draft.name);
    return key ? library.find((e) => nameKey(e.name) === key) ?? null : null;
  }, [open, library]);

  async function accept() {
    const result = await onAccept(open.id, payloadFromDraft(open.draft), open.note);
    if (result?.ok) setOpen(null);
  }

  async function refuse() {
    const reason = open.note.trim();
    if (!(await confirm(
      reason
        ? `Refuse "${openRow.name}"? ${openRow.submitted_by_name} will see your note: “${reason}”`
        : `Refuse "${openRow.name}" without a note? ${openRow.submitted_by_name} will only see that it was refused.`,
      { title: 'Refuse this suggestion', confirmLabel: 'Refuse it', danger: true }
    ))) return;
    const result = await onRefuse(open.id, reason);
    if (result?.ok) setOpen(null);
  }

  return (
    <section className="card suggestions">
      <h2>Tile suggestions</h2>
      <p className="muted">
        Tiles players have suggested. Accepting copies the tile — as you have
        edited it — into the catalogue, credited to the player. Refusing keeps
        it on record with your note, which the player can read.
      </p>

      {error && <p className="error">{error}</p>}

      {open && openRow ? (
        <div className="suggestion-editor">
          <h3>Reviewing “{openRow.name}”</h3>
          <p className="muted">
            From <strong>{openRow.submitted_by_name}</strong>,{' '}
            {new Date(openRow.created_at).toLocaleString()}.
          </p>
          {openRow.player_note && (
            <p className="suggestion-reply">
              <span className="muted">Their note: </span>{openRow.player_note}
            </p>
          )}
          <SimilarList name={open.draft.name} library={library} />
          <TileForm
            draft={open.draft}
            onChange={(draft) => setOpen((o) => ({ ...o, draft }))}
            busy={busy}
            saveLabel="Accept into catalogue"
            onSave={accept}
            onCancel={() => setOpen(null)}
            extraErrors={clash
              ? [`The catalogue already has a tile called "${clash.name}". Rename this one, or refuse it as a duplicate.`]
              : []}
            extraActions={(
              <button className="danger" onClick={refuse} disabled={busy}>Refuse</button>
            )}
            extraFields={(
              <label className="field">
                <span>Note to {openRow.submitted_by_name} <em className="muted">optional, shown to them either way</em></span>
                <textarea
                  className="tile-form-note"
                  value={open.note}
                  onChange={(e) => setOpen((o) => ({ ...o, note: e.target.value }))}
                  placeholder="Why it was refused, or what you changed on the way in."
                  maxLength={500}
                />
              </label>
            )}
          />
        </div>
      ) : pending.length === 0 ? (
        <p className="muted">Nothing waiting for review.</p>
      ) : (
        <ul className="suggestion-list">
          {pending.map((row) => (
            <li key={row.id} className="suggestion pending">
              <span className="suggestion-icon">
                <TileIcon slug={row.icon || null} fallback={<span aria-hidden="true">?</span>} />
              </span>
              <div className="suggestion-body">
                <div className="suggestion-title"><strong>{row.name}</strong></div>
                <div className="muted">
                  {ruleSummary(row)} · from {row.submitted_by_name} ·{' '}
                  {new Date(row.created_at).toLocaleDateString()}
                </div>
                {row.player_note && <p className="suggestion-reply">{row.player_note}</p>}
                <SimilarList name={row.name} library={library} compact />
              </div>
              <div className="suggestion-actions">
                <button
                  disabled={busy}
                  onClick={() => setOpen({ id: row.id, draft: draftFromRow(row), note: '' })}
                >
                  Review
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {history.length > 0 && (
        <details className="suggestion-history">
          <summary>History ({history.length})</summary>
          <ul className="suggestion-list">
            {history.map((row) => {
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
                      from {row.submitted_by_name}
                      {row.reviewed_by_name && ` · ${status.label.toLowerCase()} by ${row.reviewed_by_name}`}
                      {' · '}{new Date(row.reviewed_at ?? row.updated_at).toLocaleDateString()}
                    </div>
                    {row.review_note && (
                      <p className="suggestion-reply"><span className="muted">Note: </span>{row.review_note}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}

function SimilarList({ name, library, compact = false }) {
  const similar = similarEntries(name, library);
  if (similar.length === 0) {
    return compact ? null : <p className="muted suggestion-similar">Nothing similar in the catalogue.</p>;
  }
  return (
    <p className="suggestion-similar">
      <span className="muted">Similar in the catalogue: </span>
      {similar.map((e, i) => (
        <span key={e.id}>
          {i > 0 && ', '}
          {e.name} <span className="muted">({ruleSummary(e)})</span>
        </span>
      ))}
    </p>
  );
}
