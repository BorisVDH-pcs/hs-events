import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_JUMPS, LAST_TILE, checkJumps } from '../../lib/snakes.js';

let nextKey = 1;
const toRows = (jumps) => [...jumps]
  .sort((a, b) => Number(a.from) - Number(b.from))
  .map((j) => ({ key: nextKey++, from: String(j.from), to: String(j.to) }));

const asJumps = (rows) => rows.map((r) => ({ from: Number(r.from), to: Number(r.to) }));

// A row worth drawing while it is still being typed: two whole numbers on the
// board that go somewhere. Anything else waits for the typing.
export const drawable = (j) => Number.isInteger(j.from) && Number.isInteger(j.to)
  && j.from >= 1 && j.from <= 99 && j.to >= 1 && j.to <= LAST_TILE && j.from !== j.to;

const sameJumps = (a, b) => {
  const key = (list) => list.map((j) => `${Number(j.from)}>${Number(j.to)}`).sort().join(',');
  return key(a) === key(b);
};

const NONE = [];

/**
 * The organiser's unsaved snakes and ladders for one game, shared by the two
 * ways of editing them: the list in the Snakes and ladders card (typed) and
 * the board builder's player view (dragged). Both change the same rows, so a
 * snake dragged on the board shows up in the list, and the other way round.
 *
 * A draft, saved as a whole: admin_set_snakes replaces the full set, so a
 * half-edited layout never reaches the players' board one row at a time. The
 * same checks the server makes run on every change (checkJumps).
 *
 * `preview` is the draft minus the rows still being typed, each with its row
 * key so the board can say which one it is moving. `shown` is what the board
 * draws: the preview while it can still change, otherwise what is saved.
 *
 * `game` may be null (no game picked yet); the hook is then idle.
 */
export default function useJumpDraft(game, jumps = NONE) {
  const editable = Boolean(game) && (game.status === 'setup' || game.status === 'placement');
  const [rows, setRows] = useState(() => toRows(jumps));

  // A save, another organiser, or a different game: start again from what is
  // saved. Keyed on the layout rather than the array, which is a new one on
  // every refresh of the console -- and a refresh must not wipe a draft.
  const savedKey = jumps.map((j) => `${j.from}>${j.to}`).sort().join(',');
  useEffect(() => { setRows(toRows(jumps)); }, [savedKey, game?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const draft = useMemo(() => asJumps(rows), [rows]);
  const dirty = editable && !sameJumps(draft, jumps);
  const problem = rows.length ? checkJumps(draft) : null;
  const preview = useMemo(
    () => rows
      .map((r) => ({ key: r.key, from: Number(r.from), to: Number(r.to) }))
      .filter(drawable),
    [rows]
  );

  const setRow = useCallback((key, field, value) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: String(value).replace(/[^0-9]/g, '') } : r))), []);
  // Answers the new row's key, so the board can keep the one it just added
  // picked.
  const addRow = useCallback((from = '', to = '') => {
    const key = nextKey++;
    setRows((prev) => [...prev, { key, from: String(from), to: String(to) }]);
    return key;
  }, []);
  const removeRow = useCallback((key) => setRows((prev) => prev.filter((r) => r.key !== key)), []);
  const undo = useCallback(() => setRows(toRows(jumps)), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const standard = useCallback(() => setRows(toRows(DEFAULT_JUMPS)), []);

  return {
    editable, rows, draft, dirty, problem, preview,
    shown: editable ? preview : jumps,
    setRow, addRow, removeRow, undo, standard,
  };
}
