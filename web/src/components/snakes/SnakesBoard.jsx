import {
  boardOrder, isLadder, ladderShape, markerColor, snakePath, tileCell, tileCenter, LAST_TILE,
} from '../../lib/snakes.js';
import TileIcon from '../TileIcon.jsx';

/**
 * The 100-tile board, drawn along the snake path: tile 1 bottom-left, rows
 * turning back on themselves, 100 at the top-left.
 *
 * Four layers, bottom to top, all the same size:
 *
 *   1. the squares' colours (checkerboard, done, snake head, ladder foot) --
 *      a grid of plain divs;
 *   2. one SVG with the ladders and the snakes;
 *   3. the squares themselves, a grid of buttons with no background of their
 *      own -- the number, the artwork or name, the tick and the rings -- so a
 *      snake runs under a tile's picture instead of across it;
 *   4. one SVG with the team markers, which stay on top of everything.
 *
 * Both SVGs let every click fall through to the buttons.
 *
 * A snake's head or a ladder's foot has no task (nobody ever stands there),
 * so its square shows only its number and the colour of what it does.
 *
 * `shown` is where each marker is drawn right now, which during a move is a
 * step behind the server (SnakesGame walks it there). `sliding` marks markers
 * on a long move -- down a snake -- so they glide instead of hop.
 *
 * Squares are coloured for the team looking at the board: green once done,
 * the gold ring on the one it stands on. Other teams' progress is on the
 * standings, not here, the same way bingo keeps your card your own.
 */
export default function SnakesBoard({
  tiles, teams, myTeamId, jumps, shown, sliding = {}, selected, onSelect, revealed = true,
  showStart = true,
}) {
  const byPosition = new Map(tiles.map((t) => [t.position, t]));
  const starts = new Map(jumps.map((j) => [Number(j.from), Number(j.to)]));
  const ladders = jumps.filter(isLadder);
  const snakes = jumps.filter((j) => !isLadder(j));
  const myTile = shown[myTeamId] ?? 0;
  const me = teams.find((t) => t.id === myTeamId);
  const myRealTile = me?.board_tile ?? 0;

  // Markers sharing a square fan out around its middle, in slot order, so
  // four teams on tile 1 are four tokens rather than one.
  const onBoard = teams
    .filter((t) => (shown[t.id] ?? 0) >= 1)
    .sort((a, b) => a.slot - b.slot);
  const crowd = new Map();
  for (const t of onBoard) {
    const n = shown[t.id];
    crowd.set(n, [...(crowd.get(n) ?? []), t.id]);
  }
  const atStart = teams.filter((t) => (shown[t.id] ?? 0) < 1).sort((a, b) => a.slot - b.slot);

  const squares = boardOrder().map((n) => {
    const jumpTo = starts.get(n);
    const tile = jumpTo ? null : byPosition.get(n);
    const done = tile?.claim_status === 'completed';
    return {
      n, jumpTo, tile, done,
      progress: !done && (tile?.evidence_count ?? 0) > 0,
      head: jumpTo != null && jumpTo < n,
      foot: jumpTo != null && jumpTo > n,
      alt: (tileCell(n).row + tileCell(n).col) % 2 === 0,
    };
  });

  return (
    <div className="board snakes-board">
      <div className="snakes-stage">
        <div className="snakes-grid snakes-under" aria-hidden="true">
          {squares.map(({ n, done, head, foot, alt }) => (
            <div
              key={n}
              className={[
                'snakes-square',
                alt ? 'alt' : '',
                done ? 'done' : '',
                head ? 'head' : '',
                foot ? 'foot' : '',
                n === LAST_TILE ? 'finish' : '',
              ].filter(Boolean).join(' ')}
            />
          ))}
        </div>

        <svg className="snakes-overlay snakes-jumps" viewBox="0 0 100 100" aria-hidden="true">
          {ladders.map((j) => {
            const { rails, rungs } = ladderShape(Number(j.from), Number(j.to));
            return (
              <g key={`l${j.from}`} className="ladder">
                <path className="ladder-edge" d={`${rails} ${rungs}`} />
                <path className="ladder-rung" d={rungs} />
                <path className="ladder-rail" d={rails} />
              </g>
            );
          })}

          {snakes.map((j) => {
            const d = snakePath(Number(j.from), Number(j.to));
            const h = tileCenter(Number(j.from));
            return (
              <g key={`s${j.from}`} className="snake">
                <path className="snake-edge" d={d} />
                <path className="snake-body" d={d} />
                <path className="snake-scales" d={d} />
                <circle className="snake-head" cx={h.x} cy={h.y} r="1.8" />
                <circle className="snake-eye" cx={h.x - 0.65} cy={h.y - 0.5} r="0.34" />
                <circle className="snake-eye" cx={h.x + 0.65} cy={h.y - 0.5} r="0.34" />
              </g>
            );
          })}
        </svg>

        <div className="snakes-grid snakes-top">
          {squares.map(({ n, jumpTo, tile, done, progress, head, foot }) => {
            const cls = [
              'cell', 'snakes-cell',
              done ? 'done' : '',
              progress ? 'progress' : '',
              n === myRealTile ? 'here' : '',
              n === LAST_TILE ? 'finish' : '',
              selected === n ? 'picked' : '',
            ].filter(Boolean).join(' ');
            const name = revealed ? tile?.name : null;

            return (
              <button
                key={n}
                className={cls}
                title={[
                  `Tile ${n}`,
                  name,
                  head ? `snake — down to ${jumpTo}` : null,
                  foot ? `ladder — up to ${jumpTo}` : null,
                  done ? 'done' : progress ? 'in progress' : null,
                ].filter(Boolean).join(' · ')}
                aria-pressed={selected === n}
                // The square's number, for the board builder's drag and drop.
                data-pos={n}
                onClick={() => onSelect?.(n)}
              >
                <span className="snakes-num">{n}</span>
                {name && (tile.icon
                  ? <TileIcon slug={tile.icon} fallback={<span className="snakes-name">{name}</span>} />
                  : <span className="snakes-name">{name}</span>)}
                {done && <span className="mark" aria-hidden="true">✓</span>}
              </button>
            );
          })}
        </div>

        <svg className="snakes-overlay snakes-markers" viewBox="0 0 100 100" aria-hidden="true">
          {onBoard.map((t) => {
            const n = shown[t.id];
            const c = tileCenter(n);
            const group = crowd.get(n);
            const k = group.indexOf(t.id);
            const crowded = group.length > 1;
            const spread = crowded ? 2.4 : 0;
            const angle = (k / group.length) * Math.PI * 2 - Math.PI / 2;
            const x = c.x + Math.cos(angle) * spread;
            const y = c.y + Math.sin(angle) * spread;
            const mine = t.id === myTeamId;
            return (
              <g
                key={t.id}
                className={`marker${mine ? ' mine' : ''}${sliding[t.id] ? ' sliding' : ''}`}
                style={{ transform: `translate(${x}px, ${y}px)` }}
              >
                <circle r={crowded ? 1.9 : mine ? 2.6 : 2.2} fill={markerColor(t.slot)} />
                <text y={crowded ? 0.65 : 0.85} textAnchor="middle" className={crowded ? 'small' : undefined}>{(t.name ?? '?').slice(0, 1).toUpperCase()}</text>
                <title>{t.name}{mine ? ' (you)' : ''} — tile {n}</title>
              </g>
            );
          })}
        </svg>
      </div>

      {showStart && <div className="snakes-start" aria-label="Teams at Start">
        <span className="snakes-start-label">Start</span>
        {atStart.length === 0
          ? <span className="muted">Everyone is on the board.</span>
          : atStart.map((t) => (
            <span key={t.id} className={`start-chip${t.id === myTeamId ? ' mine' : ''}`}>
              <span className="dot" style={{ background: markerColor(t.slot) }} />
              {t.name}
            </span>
          ))}
        {myTile !== myRealTile && <span className="muted snakes-moving">moving…</span>}
      </div>}
    </div>
  );
}
