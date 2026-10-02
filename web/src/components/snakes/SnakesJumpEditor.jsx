import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_JUMPS, LAST_TILE, checkJumps, isLadder } from '../../lib/snakes.js';

let nextKey = 1;
const toRows = (jumps) => [...jumps]
  .sort((a, b) => Number(a.from) - Number(b.from))
  .map((j) => ({ key: nextKey++, from: String(j.from), to: String(j.to) }));

const asJumps = (rows) => rows.map((r) => ({ from: Number(r.from), to: Number(r.to) }));

// A row worth drawing on the preview while it is still being typed: two whole
// numbers on the board that go somewhere. Anything else waits for the typing.
const drawable = (j) => Number.isInteger(j.from) && Number.isInteger(j.to)
  && j.from >= 1 && j.from <= 99 && j.to >= 1 && j.to <= LAST_TILE && j.from !== j.to;

const sameJumps = (a, b) => {
  const key = (list) => list.map((j) => `${Number(j.from)}>${Number(j.to)}`).sort().join(',');
  return key(a) === key(b);
};

/**
 * Where the snakes and ladders go, for one Snakes and Ladders game.
 *
 * A draft, saved as a whole: admin_set_snakes replaces the full set, so a
 * half-edited layout never reaches the players' board one row at a time. The
 * same checks the server makes run as you type (checkJumps).
 *
 * It has no board of its own any more. The draft goes up through `onDraft`
 * (null when nothing is changed) and the board builder underneath draws it,
 * so the Board tab shows one board, not the same hundred squares twice -- and
 * the tiles a new snake head would strand are seen before saving, not after.
 *
 * Fixed once the game starts -- the server refuses it -- so a running or
 * finished game only shows what was played.
 */
export default function SnakesJumpEditor({ game, jumps, busy, onSave, onDraft }) {
  const editable = game.status === 'setup' || game.status === 'placement';
  const [rows, setRows] = useState(() => toRows(jumps));

  // A save, another organiser, or a different game: start again from what is
  // saved. Keyed on the layout rather than the array, which is a new one on
  // every refresh of the console -- and a refresh must not wipe a draft.
  const savedKey = jumps.map((j) => `${j.from}>${j.to}`).sort().join(',');
  useEffect(() => { setRows(toRows(jumps)); }, [savedKey, game.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const draft = asJumps(rows);
  const dirty = !sameJumps(draft, jumps);
  const problem = rows.length ? checkJumps(draft) : null;
  const ladders = draft.filter((j) => drawable(j) && isLadder(j)).length;
  const snakes = draft.filter((j) => drawable(j) && !isLadder(j)).length;
  const preview = useMemo(() => draft.filter(drawable), [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only what can be drawn: a row still being typed would put a snake on a
  // square that is about to change again.
  useEffect(() => { onDraft?.(editable && dirty ? preview : null); }, [editable, dirty, preview]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDraft?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const setRow = (key, field, value) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value.replace(/[^0-9]/g, '') } : r)));

  return (
    <section className="card">
      <h2>Snakes and ladders</h2>
      <p className="muted">
        {rows.length === 0
          ? 'None yet. Start from the standard board, or add your own.'
          : `${ladders} ladder${ladders === 1 ? '' : 's'} and ${snakes} snake${snakes === 1 ? '' : 's'}.`}
        {' '}A ladder goes up, a snake goes down. Their starting squares need no task.
        {editable && ' The board below shows them as you type.'}
        {!editable && ' Fixed now the game has started.'}
      </p>

      <div className="snakes-editor-layout">
        <div>
          {/* Fixed once the game runs: what was played, as a line each. */}
          {!editable && jumps.length > 0 && (
            <ul className="snakes-editor-summary">
              <li>
                <b>🪜 Ladders:</b>{' '}
                {draft.filter(isLadder).map((j) => `${j.from}→${j.to}`).join(', ') || 'none'}
              </li>
              <li>
                <b>🐍 Snakes:</b>{' '}
                {draft.filter((j) => !isLadder(j)).map((j) => `${j.from}→${j.to}`).join(', ') || 'none'}
              </li>
            </ul>
          )}

          {editable && rows.length > 0 && (
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
                        inputMode="numeric" value={r.from} disabled={!editable}
                        aria-label="Starts on tile"
                        onChange={(e) => setRow(r.key, 'from', e.target.value)}
                      />
                    </label>
                    <label>to tile{' '}
                      <input
                        inputMode="numeric" value={r.to} disabled={!editable}
                        aria-label="Ends on tile"
                        onChange={(e) => setRow(r.key, 'to', e.target.value)}
                      />
                    </label>
                    {editable && (
                      <button
                        type="button" className="ghost" aria-label={`Remove the one from tile ${r.from || '?'}`}
                        onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {problem && <p className="error">{problem}</p>}

          {editable && (
            <div className="row">
              <button
                type="button" className="ghost"
                onClick={() => setRows((prev) => [...prev, { key: nextKey++, from: '', to: '' }])}
              >
                + Add a snake or ladder
              </button>
              <button
                type="button" className="ghost"
                onClick={() => setRows(toRows(DEFAULT_JUMPS))}
                title="8 ladders and 10 snakes, roughly where the board game has them"
              >
                Use the standard board
              </button>
              {dirty && (
                <button type="button" className="ghost" onClick={() => setRows(toRows(jumps))}>
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
        </div>
      </div>
    </section>
  );
}
