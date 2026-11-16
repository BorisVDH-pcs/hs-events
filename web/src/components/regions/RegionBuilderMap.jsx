import { useEffect, useMemo, useState } from 'react';
import { fromPosition, toPosition } from '../../lib/board.js';
import {
  PER_REGION, REGIONS, nextSquareIn, regionAt, tileInitial, tilesIn,
} from '../../lib/regions.js';
import TileIcon from '../TileIcon.jsx';
import RegionMap, { ZoomHead } from './RegionMap.jsx';
import './regions.css';

/**
 * The organiser's Region Bingo board: the world map the players will play on,
 * built region by region instead of square by square.
 *
 * The world shows every region with how many tasks it holds; one still empty
 * stays under the fog, which is what is left to do. Pressing a region flies
 * into it, the way it will for a team, and lays its tasks over it as cards,
 * with one more card at the end to add a task. A card opens in the builder's
 * own panel beside the map (BoardBuilder), so the catalogue, a new task's form,
 * Edit, Move and Remove all work exactly as they do on a card: this component
 * only decides WHICH square the panel is about.
 *
 * Squares stay out of sight. A region owns a block of PER_REGION of them
 * (lib/regions.js), and "Add a task" takes the next free one, so tasks keep
 * the order they were added in and a region can hold as many as anyone wants.
 *
 *   tiles     admin_list_tiles rows
 *   at        the square open in the panel, { row, col }, or null
 *   onPick    (row, col): open that square in the panel -- or, with a tile
 *             in hand or one being moved, put it there (BoardBuilder's pick)
 *   onClose   close the panel
 *   hand      null, or what "Add" does instead of opening the panel:
 *             { kind: 'held', name } puts a catalogue tile down,
 *             { kind: 'moving', name } moves the task being moved
 *   live      the game is running: tasks can be fixed, none added
 */
export default function RegionBuilderMap({ tiles, at, onPick, onClose, hand = null, live = false }) {
  const atRegion = at ? regionAt(toPosition(at.row, at.col)) : null;
  const [focus, setFocus] = useState(atRegion);

  // The panel opened on a task somewhere else (Undo, a move landing): go there.
  useEffect(() => {
    if (atRegion) setFocus(atRegion);
  }, [atRegion]);

  const view = useMemo(() => ({
    regions: new Map(REGIONS.map((r) => {
      const list = tilesIn(tiles, r.key);
      return [r.key, { ...r, opened: list.length > 0, tiles: list, count: list.length }];
    })),
  }), [tiles]);

  function go(key) {
    // A panel about a task elsewhere would be about something off screen.
    if (atRegion && atRegion !== key && !hand) onClose();
    setFocus(key);
  }

  function back() {
    if (!hand) onClose();
    setFocus(null);
  }

  // Esc: close the panel first, then leave the region. Not while a tile is in
  // hand -- BoardBuilder's own Esc puts that down -- nor while typing.
  useEffect(() => {
    if (!focus || hand) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable], dialog')) return;
      if (at) onClose(); else setFocus(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus, hand, at, onClose]);

  const describe = (r) => {
    const n = r.count ?? 0;
    const words = n === 0 ? 'No tasks yet' : `${n} task${n === 1 ? '' : 's'}`;
    return { sub: words, words: `${words}. Press to ${n ? 'see and add' : 'add'} tasks.` };
  };

  return (
    <div className="regions-builder">
      <RegionMap
        view={view}
        selected={focus}
        onSelect={go}
        finished={false}
        focus={focus}
        onBack={back}
        describe={describe}
        renderZoom={(region) => (
          <RegionCards region={region} at={at} onPick={onPick} onBack={back} hand={hand} live={live} />
        )}
      />
      {!focus && (
        <ul className="regions-builder-list" aria-label="Regions">
          {REGIONS.map((r) => {
            const n = view.regions.get(r.key).count;
            return (
              <li key={r.key}>
                <button type="button" className={n ? '' : 'empty'} onClick={() => go(r.key)}>
                  <span>{r.name}</span>
                  <span className="muted">{n || 'No'} task{n === 1 ? '' : 's'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** One region's tasks as cards, and the card that adds the next one. */
function RegionCards({ region, at, onPick, onBack, hand, live }) {
  const atPosition = at ? toPosition(at.row, at.col) : null;
  const next = nextSquareIn(region.tiles, region.key);
  const adding = atPosition != null && regionAt(atPosition) === region.key
    && !region.tiles.some((t) => t.position === atPosition);
  const n = region.tiles.length;

  const add = () => {
    if (next == null) return;
    const { row, col } = fromPosition(next);
    onPick(row, col);
  };

  return (
    <>
      <ZoomHead title={region.name} onBack={onBack}>
        <p>
          {n === 0 ? 'No tasks yet' : <><strong>{n}</strong> task{n === 1 ? '' : 's'}</>}
          <span className="muted"> · points are set on the Points tab</span>
        </p>
      </ZoomHead>
      <ul className="regions-zoom-tiles">
        {region.tiles.map((t, i) => {
          const active = t.position === atPosition;
          return (
            <li key={t.id} style={{ '--i': i }}>
              <button
                type="button"
                className={`regions-zoom-tile regions-builder-task${active ? ' active' : ''}${t.claimed ? ' claimed' : ''}`}
                aria-pressed={active}
                onClick={() => { const s = fromPosition(t.position); onPick(s.row, s.col); }}
              >
                <span className="regions-tile-art">
                  <TileIcon slug={t.icon} fallback={<span>{tileInitial(t.name)}</span>} />
                </span>
                <span className="regions-zoom-tile-name">{t.name}</span>
                <span className="regions-zoom-tile-foot">
                  <span className="regions-zoom-tile-state">
                    {t.claimed ? 'Being played — locked' : `Task ${i + 1}`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {!live && (
          <li style={{ '--i': n }}>
            <button
              type="button"
              className={`regions-zoom-tile regions-zoom-add${adding ? ' active' : ''}${hand ? ' hand' : ''}`}
              aria-pressed={adding}
              disabled={next == null}
              onClick={add}
            >
              <span className="regions-tile-art" aria-hidden="true">+</span>
              <span className="regions-zoom-tile-name">
                {next == null ? `Full — ${PER_REGION} tasks`
                  : hand?.kind === 'held' ? `Put “${hand.name}” here`
                    : hand?.kind === 'moving' ? `Move “${hand.name}” here`
                      : n === 0 ? 'Add the first task' : 'Add a task'}
              </span>
              <span className="regions-zoom-tile-foot">
                <span className="regions-zoom-tile-state">
                  {hand ? 'Press to place it' : 'From the catalogue, or a new one'}
                </span>
              </span>
            </button>
          </li>
        )}
      </ul>
    </>
  );
}
