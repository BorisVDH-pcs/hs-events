import { useEffect, useMemo, useRef, useState } from 'react';
import { MAP } from '../../lib/territoryWorld.js';
import { tileState } from '../../lib/bingo.js';
import { tileProgressText } from '../../lib/tileProgress.js';
import { REGIONS, regionStatus, tileInitial } from '../../lib/regions.js';
import { markerColor } from '../../lib/snakes.js';
import TileIcon from '../TileIcon.jsx';
import RegionBar from './RegionBar.jsx';
import useAreas from '../territory/useAreas.js';

const IMG = `${import.meta.env.BASE_URL}${MAP.src}`;
const WORLD = { x: 0, y: 0, w: MAP.width, h: MAP.height };
// Shorter names for the map itself, where every letter costs space.
const SHORT = { fremennik: 'Fremennik', kourend: 'Kourend', desert: 'Desert' };
// Where a name sits when the shared label point would put it on top of a
// neighbour's (Fremennik and Asgarnia meet in a corner of the map).
const LABEL_AT = { fremennik: [1630, 468], asgarnia: [1890, 604] };
// On-screen sizes in CSS pixels; the SVG is drawn in map pixels, so each is
// multiplied by the scale `k`.
const NAME = 12.5;
const SUB = 10.5;
const DOT = 4.2;
// Below this width the names would pile into each other; the list under the
// map names the regions instead.
const NAMES_FROM = 560;
// The zoom: how long it takes, and the least of the world it ever shows (a
// small region would otherwise fill the frame with a few blurry pixels).
const ZOOM_MS = 700;
const MIN_VIEW = 760;
const NONE = new Set();
const NOBODY = new Map();

// Each region's own colour, washed over its corner of the map when the team
// steps into it: meadow, stone, wheat, ice, blood, swamp, sand, lava,
// crystal, royal blue, sun-baked clay.
const REGION_TINT = {
  misthalin: '#86b84e',
  asgarnia: '#a9bccf',
  kandarin: '#d2bb5c',
  fremennik: '#93d4ff',
  wilderness: '#d9533d',
  morytania: '#9474c9',
  desert: '#ecb95c',
  karamja: '#ff8a3d',
  tirannwn: '#5fd6bb',
  kourend: '#8494e6',
  varlamore: '#e8875c',
};

/**
 * The world map, cut into the eleven Leagues regions -- Territory's map and
 * outlines, but nothing smaller than a region, so it needs no pan: the whole
 * world is in view and a region is a big target even on a phone.
 *
 * A region my team has not opened lies under fog. One it has opened is lit,
 * with its points towards the line; a complete one turns gold. When the team
 * has a pick to spend, the regions it may open breathe gold. The coloured dots
 * under a name are the teams that have opened it -- public, as the feed says
 * so anyway.
 *
 * STEPPING IN. `focus` names a region whose tasks the team can see (one it
 * opened, or any once the game is over): the map flies into it, darkens the
 * rest of the world, washes the region in its own colour and lays its tasks
 * over it as cards. The frame grows taller when the cards need it (a phone),
 * and the view always fits the frame, so the region is never cut off. Press a
 * neighbour to fly there, or "World map" (or Esc, in RegionsGame) to fly out.
 *
 *   view       fromServer() in lib/regions.js
 *   pickable   Set of region keys my team may open right now
 *   presence   Map region key -> [team], the teams that have opened it
 *   focus      region key to step into, or null for the world
 *   activeTile the task open in the side panel, outlined among the cards
 *
 * The organiser's builder (RegionBuilderMap) draws the same map with its own
 * words and cards:
 *   describe   (region) => { sub, words }: the line under a name, and the
 *              tooltip, in place of a team's progress
 *   renderZoom (region) => what to lay over a region stepped into, in place
 *              of a team's task cards (ZoomHead gives it the same heading)
 */
export default function RegionMap({
  view, pickable = NONE, presence = NOBODY, selected, onSelect, finished,
  focus = null, activeTile = null, onTile, onBack, describe = null, renderZoom = null,
}) {
  const wrapRef = useRef(null);
  const areas = useAreas();
  const [size, setSize] = useState({ w: 900, h: 456 });
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Each region's bounds, read off its outline. Worked out from the numbers
  // rather than measured (getBBox), which a page still in the background can
  // answer with zeros.
  const boxes = useMemo(() => (areas
    ? Object.fromEntries(Object.entries(areas.regions ?? {}).map(([key, d]) => [key, pathBox(d)]))
    : null), [areas]);

  const zoomed = Boolean(focus && boxes?.[focus]);
  const vb = useFlight(zoomed ? boxes[focus] : null, size);

  const k = vb.w / Math.max(1, size.w); // map px per screen px
  const showNames = size.w >= NAMES_FROM && !focus;
  const veil = areas ? `M0 0H${MAP.width}V${MAP.height}H0Z${areas.all}` : null;

  const regions = useMemo(() => REGIONS.map((r) => {
    const reg = view.regions.get(r.key);
    return { ...reg, status: regionStatus(reg) };
  }), [view]);
  const inFocus = focus ? view.regions.get(focus) : null;

  const keyFrom = (e) => e.target.closest?.('[data-region]')?.getAttribute('data-region') ?? null;

  return (
    <div className="territory-map regions-map">
      <div
        ref={wrapRef}
        className={`territory-map-view regions-map-view${focus ? ' zoomed' : ''}`}
        style={focus ? { '--tint': REGION_TINT[focus] ?? '#f2c14e' } : undefined}
        onPointerMove={(e) => {
          if (e.pointerType !== 'mouse') return;
          const key = keyFrom(e);
          if (key !== hovered) setHovered(key);
        }}
        onPointerLeave={() => setHovered(null)}
      >
        <svg
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet"
          role="group" aria-label={inFocus ? `Map of ${inFocus.name}` : 'Region map'}
        >
          <defs>
            <pattern
              id="regions-hatch" patternUnits="userSpaceOnUse"
              width={9 * k} height={9 * k} patternTransform="rotate(45)"
            >
              <rect width={3 * k} height={9 * k} className="territory-hatch gold" />
            </pattern>
          </defs>

          <rect x={-MAP.width} y={-MAP.height} width={MAP.width * 3} height={MAP.height * 3} className="regions-sea" />
          <image href={IMG} x="0" y="0" width={MAP.width} height={MAP.height} />
          {veil && <path d={veil} className="territory-veil" fillRule="evenodd" />}

          {areas && regions.map((r) => {
            const d = areas.regions[r.key];
            if (!d) return null;
            const label = describe
              ? `${r.name}: ${describe(r).words}`
              : `${r.name}: ${statusWords(r, finished)}${pickable.has(r.key) ? ' — you can open it' : ''}`;
            return (
              <path
                key={r.key}
                d={d}
                data-region={r.key}
                fillRule="evenodd"
                vectorEffect="non-scaling-stroke"
                className={[
                  'regions-area', r.status,
                  pickable.has(r.key) && 'pickable',
                  selected === r.key && 'selected',
                  hovered === r.key && 'hovered',
                  focus === r.key && 'focus',
                ].filter(Boolean).join(' ')}
                role="button"
                tabIndex={focus === r.key ? -1 : 0}
                aria-label={label}
                aria-pressed={selected === r.key}
                onClick={() => { if (focus !== r.key) onSelect(r.key); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r.key); }
                }}
              >
                <title>{label}</title>
              </path>
            );
          })}

          {areas && !focus && regions.filter((r) => pickable.has(r.key)).map((r) => (
            <path
              key={`p-${r.key}`} d={areas.regions[r.key]} fillRule="evenodd"
              vectorEffect="non-scaling-stroke" className="regions-pick-hatch"
            />
          ))}

          {areas && (
            <g className="territory-regions">
              {regions.map((r) => (
                <g key={r.key}>
                  <path d={areas.regions[r.key]} className="territory-region-edge under" vectorEffect="non-scaling-stroke" />
                  <path d={areas.regions[r.key]} className="territory-region-edge" vectorEffect="non-scaling-stroke" />
                </g>
              ))}
            </g>
          )}

          {/* Stepped in: the rest of the world sinks into the dark. */}
          {areas && focus && areas.regions[focus] && (
            <path
              d={`M${-MAP.width} ${-MAP.height}H${MAP.width * 2}V${MAP.height * 2}H${-MAP.width}Z${areas.regions[focus]}`}
              fillRule="evenodd" className="regions-outside"
            />
          )}

          {areas && selected && areas.regions[selected] && (
            <path
              d={areas.regions[selected]} fillRule="evenodd"
              className="territory-outline selected" vectorEffect="non-scaling-stroke"
            />
          )}

          <g className={`regions-labels${focus ? ' hidden' : ''}`}>
            {areas && regions.map((r) => {
              const at = LABEL_AT[r.key] ?? areas.labels?.[r.key];
              if (!at) return null;
              const [x, y] = at;
              const teams = presence.get(r.key) ?? [];
              const sub = describe ? describe(r).sub : subLine(r, pickable.has(r.key), finished);
              const dotsY = y + (showNames ? (sub ? 2.2 : 1.1) * NAME * k : 0);
              return (
                <g key={`l-${r.key}`} className={`territory-region-label regions-label ${r.status}`}>
                  {showNames && (
                    <text x={x} y={y} style={{ fontSize: NAME * k, strokeWidth: 4 * k }}>
                      {(SHORT[r.key] ?? r.name).toUpperCase()}
                    </text>
                  )}
                  {showNames && sub && (
                    <text x={x} y={y + NAME * 1.15 * k} className="bonus" style={{ fontSize: SUB * k, strokeWidth: 3 * k }}>
                      {sub}
                    </text>
                  )}
                  {teams.map((t, i) => (
                    <circle
                      key={t.id}
                      cx={x + (i - (teams.length - 1) / 2) * DOT * 2.6 * k}
                      cy={dotsY}
                      r={DOT * k}
                      className="regions-team-dot"
                      style={{ fill: markerColor(t.slot), strokeWidth: 1.4 * k }}
                    >
                      <title>{`${t.name} has opened ${r.name}`}</title>
                    </circle>
                  ))}
                </g>
              );
            })}
          </g>
        </svg>

        {inFocus && (renderZoom
          ? <div key={focus} className="regions-zoom">{renderZoom(inFocus)}</div>
          : <RegionTiles key={focus} region={inFocus} activeTile={activeTile} onTile={onTile} onBack={onBack} />)}
      </div>
      <p className="territory-credit muted">{MAP.credit}</p>
    </div>
  );
}

/**
 * The tasks of the region the map stepped into, as cards over its own
 * landscape. Pressing one opens it in the side panel.
 */
function RegionTiles({ region, activeTile, onTile, onBack }) {
  return (
    <div className="regions-zoom">
      <ZoomHead title={region.name} onBack={onBack}>
        {region.total != null && (
          <>
            <p><strong>{region.points ?? 0}</strong> / {region.total} pts</p>
            <RegionBar region={region} className="regions-zoom-bar" />
          </>
        )}
      </ZoomHead>
      {region.tiles.length === 0 ? (
        <p className="regions-zoom-empty">No tasks in this region.</p>
      ) : (
        <ul className="regions-zoom-tiles">
          {region.tiles.map((t, i) => {
            const s = tileState(t);
            return (
              <li key={t.id} style={{ '--i': i }}>
                <button
                  type="button"
                  className={`regions-zoom-tile ${s}${activeTile === t.id ? ' active' : ''}`}
                  aria-pressed={activeTile === t.id}
                  onClick={() => onTile?.(t.id)}
                >
                  <span className="regions-tile-art">
                    <TileIcon slug={t.icon} fallback={<span>{tileInitial(t.name)}</span>} />
                  </span>
                  <span className="regions-zoom-tile-name">{t.name}</span>
                  <span className="regions-zoom-tile-foot">
                    <span className="regions-tile-worth">{s === 'done' ? '✓ ' : ''}{t.worth} {t.worth === 1 ? 'pt' : 'pts'}</span>
                    {s === 'progress' && <span className="regions-zoom-tile-state">{tileProgressText(t)}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The heading over a region stepped into: the way out, its name, and a line or two. */
export function ZoomHead({ title, onBack, children }) {
  return (
    <div className="regions-zoom-head">
      <button type="button" className="regions-zoom-back" onClick={onBack}>‹ World map</button>
      <div className="regions-zoom-title">
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

/**
 * The view box, flown towards the region `box` (or the whole world) and
 * always widened to the frame's own shape, so nothing is cut off whatever the
 * frame's size. A new target mid-flight starts from where the view is, so a
 * quick second press never jumps; reduced motion lands at once.
 */
function useFlight(box, size) {
  const aspect = size.w / Math.max(1, size.h);
  const target = useMemo(() => (box ? fitBox(box, aspect, 0.08) : fitBox(WORLD, aspect, 0)),
    [box, aspect]);
  const [vb, setVb] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    const from = current.current;
    const still = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still || sameBox(from, target)) {
      current.current = target;
      setVb(target);
      return undefined;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ZOOM_MS);
      const e = 1 - (1 - t) ** 4; // quick start, long soft landing
      // Width and height move on a log scale, so the zoom feels even rather
      // than rushing the last bit; the centre glides in a straight line.
      const w = from.w * (target.w / from.w) ** e;
      const h = from.h * (target.h / from.h) ** e;
      const cx = from.x + from.w / 2 + (target.x + target.w / 2 - from.x - from.w / 2) * e;
      const cy = from.y + from.h / 2 + (target.y + target.h / 2 - from.y - from.h / 2) * e;
      const next = { x: cx - w / 2, y: cy - h / 2, w, h };
      current.current = next;
      setVb(next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // A tab in the background gets no frames: land on time regardless, so
    // the view is right when the player comes back to it.
    const landing = setTimeout(() => {
      cancelAnimationFrame(raf);
      current.current = target;
      setVb(target);
    }, ZOOM_MS + 120);
    return () => { cancelAnimationFrame(raf); clearTimeout(landing); };
  }, [target]);

  return vb;
}

/** The bounds of an outline drawn in absolute M/L/Z steps, as areas.json is. */
function pathBox(d) {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (let i = 0; i + 1 < n.length; i += 2) {
    x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i]);
    y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1]);
  }
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** `b` with a margin, no smaller than MIN_VIEW, stretched to `aspect`. */
function fitBox(b, aspect, margin) {
  let w = b.w * (1 + margin * 2);
  let h = b.h * (1 + margin * 2);
  if (margin > 0 && Math.max(w, h * aspect) < MIN_VIEW) w = MIN_VIEW;
  if (w / h < aspect) w = h * aspect; else h = w / aspect;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

const sameBox = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
  && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;

/** The small line under a region's name. */
function subLine(r, pickable, finished) {
  if (r.opened || finished) {
    if (r.total == null) return null;
    // Out of all its points, as the bar shows it; the tick says the line
    // (and so a pick) has been reached.
    const mark = r.status === 'complete' || r.status === 'spent' ? ' ✓' : '';
    return `${r.points ?? 0} / ${r.total} pts${mark}`;
  }
  return pickable ? 'Open me' : null;
}

/** The same, in words, for a screen reader and the tooltip. */
function statusWords(r, finished) {
  switch (r.status) {
    case 'locked': return finished && r.total != null ? `not opened, ${r.total} points in all` : 'not opened';
    case 'open': return `opened, ${r.points ?? 0} of ${r.total} points, ${r.need} earns a new region`;
    case 'complete': return `complete (${r.points} points) — its pick is ready`;
    case 'spent': return `complete (${r.points ?? 0} points), its pick spent`;
    default: return '';
  }
}
