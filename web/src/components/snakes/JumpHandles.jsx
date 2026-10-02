import { useEffect, useRef } from 'react';
import { isLadder, tileAt, tileCenter } from '../../lib/snakes.js';

/**
 * The organiser's grips on the snakes and ladders: a round handle on both ends
 * of each, drawn over the board in the board builder before the game starts.
 * Never on a player's board -- SnakesBoard only draws this when given `edit`.
 *
 * Dumb about the rules on purpose. It says which end is being dragged and
 * which square is under the pointer (`onDrag`), then `onDrop`, or `onTap` for
 * a press that never moved; the board builder decides whether the square is
 * allowed and draws the result through `jumps`. `edit.drag.ok` false puts the
 * dragged end where the pointer is, in red, with the snake or ladder still
 * drawn where it last could go.
 *
 * The square under the pointer comes from where it is on this SVG -- the same
 * size as the board -- rather than from what is under it, so nothing about
 * the handles has to get out of the way while they are dragged.
 */
export default function JumpHandles({ jumps, edit }) {
  const svgRef = useRef(null);
  const press = useRef(null);
  const { picked, drag, onDrag, onDrop, onTap, onCancel } = edit;
  const latest = useRef(edit);
  latest.current = edit;

  // A finger on a handle drags it rather than scrolling the page. Not passive,
  // so it can say so, and on the SVG itself because React's own touch
  // listeners are passive.
  useEffect(() => {
    const svg = svgRef.current;
    const hold = (e) => { if (e.target.closest?.('.jump-handle')) e.preventDefault(); };
    svg.addEventListener('touchstart', hold, { passive: false });
    return () => svg.removeEventListener('touchstart', hold);
  }, []);

  // Escape puts a dragged end back where it was.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || !press.current) return;
      e.stopPropagation();
      stop();
      latest.current.onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function stop() {
    press.current = null;
    document.body.classList.remove('dragging-jump');
  }

  function squareAt(e) {
    const r = svgRef.current.getBoundingClientRect();
    return tileAt(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
  }

  function down(e, key, end) {
    if (press.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    // On the grip itself, which stays the same element while it moves: the
    // SVG around it lets presses through, so it is no target to capture on.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    press.current = { id: e.pointerId, key, end, x0: e.clientX, y0: e.clientY, moved: false, n: null };
  }

  function move(e) {
    const p = press.current;
    if (!p || e.pointerId !== p.id) return;
    if (!p.moved) {
      if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 5) return;
      p.moved = true;
      document.body.classList.add('dragging-jump');
    }
    const n = squareAt(e);
    if (n !== p.n) {
      p.n = n;
      onDrag({ key: p.key, end: p.end, n });
    }
  }

  function up(e) {
    const p = press.current;
    if (!p || e.pointerId !== p.id) return;
    stop();
    if (!p.moved) onTap(p.key);
    else if (p.n != null) onDrop({ key: p.key, end: p.end, n: p.n });
    else onCancel();
  }

  function cancel(e) {
    if (!press.current || e.pointerId !== press.current.id) return;
    stop();
    onCancel();
  }

  return (
    <svg
      ref={svgRef}
      className={`snakes-overlay jump-handles${edit.adding ? ' passive' : ''}`}
      viewBox="0 0 100 100"
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
    >
      {jumps.map((j) => {
        const ladder = isLadder(j);
        const kind = ladder ? 'Ladder' : 'Snake';
        return ['from', 'to'].map((end) => {
          const moving = drag?.key === j.key && drag.end === end;
          const n = moving ? drag.n : j[end];
          const c = tileCenter(n);
          const what = end === 'from'
            ? (ladder ? 'its foot' : 'its head')
            : (ladder ? 'its top' : 'its tail');
          return (
            <g
              key={`${j.key ?? j.from}-${end}`}
              className={[
                'jump-handle',
                ladder ? 'ladder' : 'snake',
                end === 'from' ? 'start' : 'end',
                picked === j.key ? 'picked' : '',
                moving ? 'moving' : '',
                moving && !drag.ok ? 'bad' : '',
              ].filter(Boolean).join(' ')}
              transform={`translate(${c.x} ${c.y})`}
              onPointerDown={(e) => down(e, j.key, end)}
            >
              <circle className="hit" r="3.2" />
              <circle className="grip" r={end === 'from' ? 2 : 1.6} />
              <title>{`${kind} from tile ${j.from} to ${j.to}: drag to move ${what}, tap to pick it`}</title>
            </g>
          );
        });
      })}
    </svg>
  );
}
