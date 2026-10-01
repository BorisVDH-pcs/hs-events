import { Fragment } from 'react';
import { colLetter } from '../../lib/board.js';
import { cardCells, tileState } from '../../lib/bingo.js';
import TileIcon from '../TileIcon.jsx';

/**
 * The bingo card: every tile visible from the start, any of them workable at
 * any time. Same grid vocabulary as the battleships boards (axis rails, the
 * `.cell` material) so the two modes read as one app.
 *
 * `doneIds` switches the card to someone else's: a Set of the tile ids that
 * team has completed, taken from the standings. Their in-progress tiles are
 * not shown -- evidence is team-private, and only "completed" is public.
 *
 * A square names its task. On a big card the names would be unreadable
 * slivers, so from 8x8 up only the artwork shows and the name is in the
 * tooltip and the panel. A tile with no artwork shows its name at any size --
 * a stand-in picture would make every undrawn tile look like the same task.
 */
export default function BingoCard({ size, tiles, doneIds = null, selectedId, onSelect }) {
  const byPosition = new Map(tiles.map((t) => [t.position, t]));
  const compact = size >= 8;

  return (
    <div className="board bingo-board">
      <div
        className={`board-grid bingo-grid${compact ? ' compact' : ''}`}
        style={{ gridTemplateColumns: `1.4rem repeat(${size}, 1fr)` }}
      >
        <div className="corner" />
        {Array.from({ length: size }, (_, i) => (
          <div key={`h${i}`} className="axis">{colLetter(i + 1)}</div>
        ))}

        {Array.from({ length: size }, (_, r) => (
          <Fragment key={`row${r}`}>
            <div className="axis">{r + 1}</div>
            {cardCells(size).slice(r * size, (r + 1) * size).map(({ position, label }) => {
              const tile = byPosition.get(position);
              if (!tile) return <div key={position} className="cell empty" />;

              const state = doneIds
                ? (doneIds.has(tile.id) ? 'done' : 'open')
                : tileState(tile);

              const cls = [
                'cell', 'bingo-cell', 'clickable',
                state === 'done' ? 'done' : '',
                state === 'progress' ? 'progress' : '',
                selectedId === tile.id ? 'picked' : '',
              ].filter(Boolean).join(' ');

              return (
                <button
                  key={position}
                  className={cls}
                  title={`${label} — ${tile.name ?? 'tile'}${
                    state === 'done' ? ' · completed' : state === 'progress' ? ' · in progress' : ''}`}
                  aria-pressed={selectedId === tile.id}
                  onClick={() => onSelect?.(tile)}
                >
                  {tile.icon
                    ? <TileIcon slug={tile.icon} fallback={<span className="bingo-name">{tile.name}</span>} />
                    : <span className="bingo-name">{compact ? label : tile.name}</span>}
                  {tile.icon && !compact && <span className="bingo-caption">{tile.name}</span>}
                  {state === 'done' && <span className="mark" aria-hidden="true">✓</span>}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
