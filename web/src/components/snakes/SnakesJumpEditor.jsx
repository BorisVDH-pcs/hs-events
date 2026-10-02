import { isLadder } from '../../lib/snakes.js';
import { drawable } from './useJumpDraft.js';

/**
 * Where the snakes and ladders go, for one Snakes and Ladders game.
 *
 * The draft itself lives in Admin (useJumpDraft, passed in as `edit`), because
 * two things change it: this card, and the board builder underneath, where
 * the ends are dragged. This card holds what the board cannot: the standard
 * board, undo, save -- and the same rows as a list of numbers, folded away
 * for the odd exact edit.
 *
 * It has no board of its own. The board builder draws the draft, so the Board
 * tab shows one board, not the same hundred squares twice -- and the tiles a
 * new snake head would strand are seen before saving, not after.
 *
 * Fixed once the game starts -- the server refuses it -- so a running or
 * finished game only shows what was played.
 */
export default function SnakesJumpEditor({ jumps, busy, onSave, edit }) {
  const { editable, rows, draft, dirty, problem } = edit;
  const ladders = draft.filter((j) => drawable(j) && isLadder(j)).length;
  const snakes = draft.filter((j) => drawable(j) && !isLadder(j)).length;
  const saved = editable ? draft : jumps;

  return (
    <section className="card">
      <h2>Snakes and ladders</h2>
      <p className="muted">
        {rows.length === 0 && editable
          ? 'None yet. Start from the standard board, or add your own.'
          : `${ladders} ladder${ladders === 1 ? '' : 's'} and ${snakes} snake${snakes === 1 ? '' : 's'}.`}
        {' '}A ladder goes up, a snake goes down. Their starting squares need no task.
        {editable && ' Drag their ends on the board below, or edit them as a list.'}
        {!editable && ' Fixed now the game has started.'}
      </p>

      {/* Fixed once the game runs: what was played, as a line each. */}
      {!editable && jumps.length > 0 && (
        <ul className="snakes-editor-summary">
          <li>
            <b>🪜 Ladders:</b>{' '}
            {saved.filter(isLadder).map((j) => `${j.from}→${j.to}`).join(', ') || 'none'}
          </li>
          <li>
            <b>🐍 Snakes:</b>{' '}
            {saved.filter((j) => !isLadder(j)).map((j) => `${j.from}→${j.to}`).join(', ') || 'none'}
          </li>
        </ul>
      )}

      {editable && (
        <details className="snakes-editor-list">
          <summary>Edit as a list</summary>
          {rows.length > 0 && (
            <div className="snakes-editor-rows">
              {rows.map((r) => {
                const from = Number(r.from);
                const to = Number(r.to);
                const kind = r.from && r.to && from !== to ? (to > from ? 'ladder' : 'snake') : null;
                return (
                  <div key={r.key} className="snakes-editor-row">
                    <span className={`kind ${kind ?? ''}`}>
                      {kind === 'ladder' ? '🪜 Ladder' : kind === 'snake' ? '🐍 Snake' : '—'}
                    </span>
                    <label>from tile{' '}
                      <input
                        inputMode="numeric" value={r.from}
                        aria-label="Starts on tile"
                        onChange={(e) => edit.setRow(r.key, 'from', e.target.value)}
                      />
                    </label>
                    <label>to tile{' '}
                      <input
                        inputMode="numeric" value={r.to}
                        aria-label="Ends on tile"
                        onChange={(e) => edit.setRow(r.key, 'to', e.target.value)}
                      />
                    </label>
                    <button
                      type="button" className="ghost" aria-label={`Remove the one from tile ${r.from || '?'}`}
                      onClick={() => edit.removeRow(r.key)}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <button type="button" className="ghost" onClick={() => edit.addRow()}>
            + Add a row
          </button>
        </details>
      )}

      {editable && problem && <p className="error">{problem}</p>}

      {editable && (
        <div className="row">
          <button
            type="button" className="ghost"
            onClick={edit.standard}
            title="8 ladders and 10 snakes, roughly where the board game has them"
          >
            Use the standard board
          </button>
          {dirty && (
            <button type="button" className="ghost" onClick={edit.undo}>
              Undo changes
            </button>
          )}
          <button
            type="button"
            disabled={busy || !dirty || Boolean(problem)}
            onClick={() => onSave(draft)}
          >
            Save snakes and ladders
          </button>
        </div>
      )}
      {editable && dirty && !problem && (
        <p className="muted">Not saved yet — the board below shows your changes, players still see the old layout.</p>
      )}
    </section>
  );
}
