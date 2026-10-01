import { useCallback, useEffect, useState } from 'react';
import {
  supabase, snakesStandings,
  adminSnakesPunish, adminSnakesMove, adminSnakesGiveRollback,
  adminSnakesCompleteTile, adminSnakesUncompleteTile,
} from '../../lib/supabase.js';
import { LAST_TILE, markerColor, tileWord } from '../../lib/snakes.js';
import SnakesBoard from './SnakesBoard.jsx';

/**
 * The organiser's view of a running race: every marker on one board, the
 * standings, and the controls the rules give an organiser -- punish, move,
 * rollbacks, complete a tile now, undo a completion.
 *
 * Every control goes through the console's `run`, so a refusal lands in the
 * same red line as everything else, and every one that changes where a team
 * stands asks first: the players see it happen.
 *
 * The standings re-read on every game event, which every one of these
 * controls -- and every roll, on any team's screen -- writes.
 */
export default function SnakesAdminTrack({ game, tiles, jumps, busy, run, confirm }) {
  const [standings, setStandings] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    try {
      setStandings((await snakesStandings(game.id)) ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    }
  }, [game.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`admin-snakes:${game.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'game_events', filter: `game_id=eq.${game.id}` },
        () => load()
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [game.id, load]);

  const running = game.status === 'active';
  const over = game.status === 'finished';
  const byPosition = new Map(tiles.map((t) => [t.position, t]));
  const taskName = (n) => byPosition.get(n)?.name;

  const act = async (fn, message) => {
    const result = await run(fn, message, { refresh: ['games'] });
    await load();
    return result;
  };

  const moved = (name) => (r) => (r && r.to != null
    ? `${name} is now on ${tileWord(Number(r.to))}.`
    : `${name} moved.`);

  const teams = standings.map((s) => ({
    id: s.team_id, name: s.team_name, slot: s.slot, board_tile: s.board_tile ?? 0,
  }));
  const shown = Object.fromEntries(standings.map((s) => [s.team_id, s.board_tile ?? 0]));
  const here = selected ? standings.filter((s) => s.board_tile === selected) : [];

  return (
    <>
      <section className="card">
        <h2>The race</h2>
        <p className="muted">
          Every team’s marker on one board, furthest along first in the table.
          {!running && !over && ' Everyone starts at Start once you press Start game.'}
        </p>
        {loadError && <p className="error">{loadError}</p>}

        <div className="snakes-track-layout">
          <div>
            <SnakesBoard
              tiles={tiles}
              teams={teams}
              myTeamId={null}
              jumps={jumps}
              shown={shown}
              selected={selected}
              onSelect={(n) => setSelected((s) => (s === n ? null : n))}
            />
            {selected && (
              <p className="muted">
                <b>Tile {selected}</b>{taskName(selected) ? ` — ${taskName(selected)}` : ''}
                {here.length > 0 && <> · here: {here.map((s) => s.team_name).join(', ')}</>}
              </p>
            )}
          </div>

          <div className="table-scroll">
            <table className="snakes-control-table">
              <thead>
                <tr><th>#</th><th>Team</th><th>Tile</th><th>Done</th><th>Rollbacks</th></tr>
              </thead>
              <tbody>
                {standings.map((s) => (
                  <tr key={s.team_id}>
                    <td>{s.board_tile ? s.place : '–'}</td>
                    <td>
                      <span className="dot" style={{ background: markerColor(s.slot) }} aria-hidden="true" />{' '}
                      {s.team_name}
                    </td>
                    <td>
                      <button
                        className="ghost" disabled={!s.board_tile}
                        onClick={() => setSelected(s.board_tile)}
                        title={s.board_tile ? 'Show on the board' : undefined}
                      >
                        {s.board_tile ? `Tile ${s.board_tile}` : 'Start'}
                      </button>
                    </td>
                    <td>{s.tiles_completed ?? 0}</td>
                    <td>{s.rollbacks_available ?? 0}{s.rollbacks_used ? ` (${s.rollbacks_used} used)` : ''}</td>
                  </tr>
                ))}
                {standings.length === 0 && !loadError && (
                  <tr><td colSpan={5} className="muted">No teams yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {(running || over) && (
        <section className="card">
          <h2>Organiser controls</h2>
          <p className="muted">
            One row per team. Moving, punishing and completing work while the
            game runs; rollbacks and undoing a completion work until it is over
            (undoing one after the finish can reopen the game).
          </p>
          <div className="columns">
            {standings.map((s) => (
              <TeamControls
                key={s.team_id}
                s={s}
                running={running}
                over={over}
                busy={busy}
                taskName={taskName}
                jumps={jumps}
                onComplete={async () => {
                  const n = s.board_tile;
                  if (!(await confirm(
                    `Tile ${n}${taskName(n) ? ` (${taskName(n)})` : ''} counts as done for ${s.team_name}, `
                    + 'whatever its screenshots say. They can roll next.',
                    { title: `Complete tile ${n} for ${s.team_name}?`, confirmLabel: 'Complete it' }
                  ))) return;
                  act(() => adminSnakesCompleteTile(s.team_id), `Tile ${n} completed for ${s.team_name}.`);
                }}
                onPunish={async () => {
                  if (!(await confirm(
                    `${s.team_name} is sent back by a roll of the die (1 to 6), from ${tileWord(s.board_tile)}.`,
                    { title: `Punish ${s.team_name}?`, confirmLabel: 'Send them back', danger: true }
                  ))) return;
                  act(() => adminSnakesPunish(s.team_id), moved(s.team_name));
                }}
                onMove={async (tile) => {
                  if (!(await confirm(
                    `${s.team_name} goes from ${tileWord(s.board_tile)} to tile ${tile}`
                    + `${taskName(tile) ? ` (${taskName(tile)})` : ''}.`,
                    { title: `Move ${s.team_name}?`, confirmLabel: 'Move them' }
                  ))) return false;
                  const r = await act(() => adminSnakesMove(s.team_id, tile), moved(s.team_name));
                  return r;
                }}
                onRollback={(amount) => act(
                  () => adminSnakesGiveRollback(s.team_id, amount),
                  (left) => `${s.team_name} now has ${left} rollback${left === 1 ? '' : 's'}.`
                )}
                onUncomplete={async (tile) => {
                  if (!(await confirm(
                    `Tile ${tile}${taskName(tile) ? ` (${taskName(tile)})` : ''} is open again for `
                    + `${s.team_name}. Its screenshots are kept.`
                    + (over ? '\n\nThe game is over — if this was the winning tile, the game reopens.' : ''),
                    { title: `Undo tile ${tile} for ${s.team_name}?`, confirmLabel: 'Undo it', danger: true }
                  ))) return false;
                  return act(() => adminSnakesUncompleteTile(s.team_id, tile),
                    (r) => `Tile ${tile} is open again for ${s.team_name}.`
                      + (r?.game_reopened ? ' The game is running again.' : ''));
                }}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function TeamControls({
  s, running, over, busy, taskName, jumps, onComplete, onPunish, onMove, onRollback, onUncomplete,
}) {
  const [moveTo, setMoveTo] = useState('');
  const [undoTile, setUndoTile] = useState('');
  const done = s.completed_tiles ?? [];
  const onTile = s.board_tile ?? 0;
  const currentDone = onTile > 0 && done.includes(onTile);
  const target = Number(moveTo);
  // The server refuses these too; said here so the confirm never offers one.
  const jumpHere = jumps.find((j) => Number(j.from) === target);
  const targetProblem = !moveTo ? null
    : target < 1 || target > LAST_TILE ? 'Pick a tile from 1 to 100.'
      : jumpHere ? `Tile ${target} is ${Number(jumpHere.to) > target ? 'the bottom of a ladder' : 'a snake head'} — pick another tile.`
        : target === onTile ? `${s.team_name} is already there.`
          : null;
  const validTarget = Boolean(moveTo) && !targetProblem;

  return (
    <div className="snakes-team-controls">
      <h3>
        <span className="dot" style={{ background: markerColor(s.slot) }} aria-hidden="true" />{' '}
        {s.team_name}
      </h3>
      <p className="muted">
        {onTile ? `On tile ${onTile}${taskName(onTile) ? ` — ${taskName(onTile)}` : ''}` : 'At Start'}
        {currentDone && ' (done, can roll)'}
      </p>

      {running && (
        <div className="row">
          <button
            disabled={busy || !onTile || currentDone}
            title={!onTile ? 'Still at Start' : currentDone ? 'Already done' : undefined}
            onClick={onComplete}
          >
            Complete tile now
          </button>
          <button className="danger" disabled={busy || !onTile} onClick={onPunish}>
            Punish (back 1–6)
          </button>
        </div>
      )}

      {running && (
        <div className="row">
          <label>Move to tile{' '}
            <input
              inputMode="numeric" value={moveTo}
              onChange={(e) => setMoveTo(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </label>
          <button
            className="ghost" disabled={busy || !validTarget}
            onClick={async () => { const r = await onMove(target); if (r && r.to != null) setMoveTo(''); }}
          >
            Move
          </button>
          {targetProblem && <span className="muted">{targetProblem}</span>}
        </div>
      )}

      <div className="row">
        <span>Rollbacks: <b>{s.rollbacks_available ?? 0}</b></span>
        <button className="ghost" disabled={busy || over} onClick={() => onRollback(1)}>Give 1</button>
        <button
          className="ghost" disabled={busy || over || !(s.rollbacks_available > 0)}
          onClick={() => onRollback(-1)}
        >
          Take 1
        </button>
      </div>

      {done.length > 0 && (
        <div className="row">
          <label>Undo a completion{' '}
            <select value={undoTile} onChange={(e) => setUndoTile(e.target.value)}>
              <option value="">Pick a tile…</option>
              {[...done].sort((a, b) => b - a).map((n) => (
                <option key={n} value={n}>Tile {n}{taskName(n) ? ` — ${taskName(n)}` : ''}</option>
              ))}
            </select>
          </label>
          <button
            className="ghost danger" disabled={busy || !undoTile}
            onClick={async () => {
              const r = await onUncomplete(Number(undoTile));
              if (r && typeof r === 'object') setUndoTile('');
            }}
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
