import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LINKS, MAP, PLACES, REGIONS, toPixel } from '../../lib/territoryWorld.js';
import { defaultBonuses, placeByKey, placeState, regionHolders } from '../../lib/territory.js';
import { markerColor } from '../../lib/snakes.js';

// How big things are ON SCREEN, in CSS pixels, whatever the zoom. The SVG is
// drawn in map pixels, so each is multiplied by the current scale `k`. Lines
// use vector-effect: non-scaling-stroke instead, which does the same for free.
const MARKER = 5.5;
const HOME = 11;
const LABEL = 11.5;
const REGION_LABEL = 11.5;
// Below this many map pixels per screen pixel the place names fit; above it
// they would pile into each other, so the region names take over.
const NAMES_AT = 1.9;
const MAX_ZOOM = 5;   // map px per screen px at the closest: 1 / MAX_ZOOM
const IMG = `${import.meta.env.BASE_URL}${MAP.src}`;
const AREAS = `${import.meta.env.BASE_URL}territory/areas.json`;

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const pixel = new Map(PLACES.map((p) => [p.key, toPixel(p.x, p.y)]));
const regionName = new Map(REGIONS.map((r) => [r.key, r.name]));
// Shorter names for the map itself, where every letter costs space.
const SHORT = { fremennik: 'Fremennik', kourend: 'Kourend', desert: 'Desert' };

// Until areas.json arrives (or if it never does) region names sit at the
// middle of their places.
const fallbackLabels = Object.fromEntries(REGIONS.map((r) => {
  const ps = PLACES.filter((p) => p.region === r.key).map((p) => pixel.get(p.key));
  return [r.key, [ps.reduce((s, p) => s + p.px, 0) / ps.length, ps.reduce((s, p) => s + p.py, 0) / ps.length]];
}));

// The land each place owns, as SVG paths, generated once from the map image
// (see docs/territory-rules.md, "The map"). Fetched rather than imported so
// the 65 KB stays out of the app bundle for the modes that never draw it.
let areasRequest;
function useAreas() {
  const [areas, setAreas] = useState(null);
  useEffect(() => {
    let live = true;
    areasRequest ??= fetch(AREAS).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    areasRequest.then((a) => { if (live) setAreas(a); });
    return () => { live = false; };
  }, []);
  return areas;
}

// A route longer than this (map px) crosses half the world -- the quetzal to
// Civitas, the boat to Kourend -- and would scrawl over everything between,
// so it is drawn faint until one of its ends is pressed or pointed at.
const FAR = 520;
const routeLength = (a, b) => Math.hypot(pixel.get(a).px - pixel.get(b).px, pixel.get(a).py - pixel.get(b).py);

// A sea or travel route, bowed so it reads as a voyage rather than a border.
function routePath(a, b) {
  const A = pixel.get(a);
  const B = pixel.get(b);
  const dx = B.px - A.px;
  const dy = B.py - A.py;
  const len = Math.hypot(dx, dy) || 1;
  // Bow to the north of the line, whichever way round it was written.
  let nx = -dy / len;
  let ny = dx / len;
  if (ny > 0) { nx = -nx; ny = -ny; }
  const bow = Math.min(90, len * 0.16);
  const cx = (A.px + B.px) / 2 + nx * bow;
  const cy = (A.py + B.py) / 2 + ny * bow;
  return `M${A.px} ${A.py}Q${cx} ${cy} ${B.px} ${B.py}`;
}

// A heraldic shield, centred on 0,0 and `r` wide each side.
function shieldPath(r) {
  return `M${-r} ${-r * 1.05}H${r}V${r * 0.15}Q${r} ${r * 0.95} 0 ${r * 1.35}Q${-r} ${r * 0.95} ${-r} ${r * 0.15}Z`;
}

/**
 * The world map, Risk-style: every place a piece of real land coloured by
 * the team that holds it, the Leagues regions outlined in gold, and the sea
 * and travel routes drawn as arcs between ports.
 *
 * ONE SVG holds the image and everything on it, and zoom/pan is nothing but
 * its viewBox. So the map never blurs from a CSS scale, and the markers can be
 * held at a constant on-screen size by multiplying by the scale.
 *
 * The land layer does not depend on the view at all (its lines are
 * non-scaling), so it is memoised and a drag only moves the viewBox and the
 * markers -- 64 detailed outlines are not re-diffed sixty times a second.
 *
 * Drag to pan, wheel or pinch to zoom, and a press that did not move is a
 * press on whatever is under it: the land itself or its marker.
 */
export default function TerritoryMap({
  teams, myTeamId, owners, homes, open, attacked, status, selected, onSelect, focus,
  bonuses = defaultBonuses(),
}) {
  const wrapRef = useRef(null);
  const areas = useAreas();
  const [box, setBox] = useState({ w: 900, h: 456 });
  const [view, setView] = useState(null); // { x, y, w } in map px; h follows the box
  const [hovered, setHovered] = useState(null);

  const aspect = box.w / box.h;
  // The widest view that still shows nothing but map.
  const maxW = Math.min(MAP.width, MAP.height * aspect);
  const minW = box.w / MAX_ZOOM;

  const clamp = useCallback((v) => {
    const w = Math.max(minW, Math.min(maxW, v.w));
    const h = w / aspect;
    return {
      w,
      x: Math.max(0, Math.min(MAP.width - w, v.x)),
      y: Math.max(0, Math.min(MAP.height - h, v.y)),
    };
  }, [aspect, maxW, minW]);

  // Size from the element, so the viewBox always matches its shape.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setBox({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => setView(clamp({ x: 0, y: 0, w: maxW })), [clamp, maxW]);

  // Centre on a place, zoomed in enough to read the names around it.
  const centreOn = useCallback((key, zoomTo) => {
    const p = pixel.get(key);
    if (!p) return;
    setView((v) => {
      const w = zoomTo ?? Math.min(v?.w ?? maxW, box.w * 1.6);
      const h = w / aspect;
      return clamp({ x: p.px - w / 2, y: p.py - h / 2, w });
    });
  }, [aspect, box.w, clamp, maxW]);

  // First view: the whole world on a wide screen; on a narrow one, home.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || box.w === 900) return;
    started.current = true;
    const home = homes.get(myTeamId);
    if (box.w < 700 && home) centreOn(home, box.w * 1.4);
    else fit();
  }, [box.w, centreOn, fit, homes, myTeamId]);

  // Keep the view legal when the element changes shape.
  useEffect(() => { setView((v) => (v ? clamp(v) : v)); }, [clamp]);

  // A caller asking to look at something (standings row, "My home").
  useEffect(() => {
    if (focus?.key) centreOn(focus.key);
  }, [focus, centreOn]);

  const v = view ?? { x: 0, y: 0, w: maxW };
  const h = v.w / aspect;
  const k = v.w / box.w; // map px per screen px

  // ---- pointer handling: drag, pinch, press, hover ----
  const pointers = useRef(new Map());
  const gesture = useRef(null);

  function zoomAt(clientX, clientY, factor) {
    const r = wrapRef.current.getBoundingClientRect();
    const fx = (clientX - r.left) / r.width;
    const fy = (clientY - r.top) / r.height;
    setView((cur) => {
      const c = cur ?? v;
      const ch = c.w / aspect;
      const mx = c.x + fx * c.w;
      const my = c.y + fy * ch;
      const w = Math.max(minW, Math.min(maxW, c.w * factor));
      return clamp({ x: mx - fx * w, y: my - fy * (w / aspect), w });
    });
  }

  function onPointerDown(e) {
    // Capture keeps a drag alive when the pointer leaves the map. It can throw
    // for a pointer the browser no longer tracks; the drag works without it.
    try { wrapRef.current.setPointerCapture?.(e.pointerId); } catch { /* fine */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 1) {
      gesture.current = { kind: 'pan', start: pts[0], view: v, moved: false, target: e.target };
    } else if (pts.length === 2) {
      const [a, b] = pts;
      gesture.current = {
        kind: 'pinch', view: v, moved: true,
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    }
  }

  function onPointerMove(e) {
    if (!pointers.current.has(e.pointerId)) {
      // Just a mouse passing over: which piece of land is under it? Pointer
      // capture retargets events during a drag, so this only runs between them.
      if (e.pointerType === 'mouse') {
        const key = e.target.closest?.('[data-place]')?.getAttribute('data-place') ?? null;
        if (key !== hovered) setHovered(key);
      }
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const r = wrapRef.current.getBoundingClientRect();
    if (g.kind === 'pan') {
      const dx = e.clientX - g.start.x;
      const dy = e.clientY - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) < 5) return;
      if (!g.moved && hovered) setHovered(null);
      g.moved = true;
      const scale = g.view.w / r.width;
      setView(clamp({ x: g.view.x - dx * scale, y: g.view.y - dy * scale, w: g.view.w }));
    } else if (g.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (!b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const w = Math.max(minW, Math.min(maxW, g.view.w * (g.dist / dist)));
      const fx = (g.mid.x - r.left) / r.width;
      const fy = (g.mid.y - r.top) / r.height;
      const mx = g.view.x + fx * g.view.w;
      const my = g.view.y + fy * (g.view.w / aspect);
      setView(clamp({ x: mx - fx * w, y: my - fy * (w / aspect), w }));
    }
  }

  function onPointerUp(e) {
    pointers.current.delete(e.pointerId);
    try { wrapRef.current.releasePointerCapture?.(e.pointerId); } catch { /* fine */ }
    const g = gesture.current;
    if (pointers.current.size === 0) {
      if (g?.kind === 'pan' && !g.moved) {
        const key = g.target?.closest?.('[data-place]')?.getAttribute('data-place');
        if (key) onSelect(key);
      }
      gesture.current = null;
    } else if (pointers.current.size === 1) {
      // One finger left after a pinch: carry on as a pan from here, but never
      // as a press -- lifting a finger is not choosing a place.
      const [p] = [...pointers.current.values()];
      gesture.current = { kind: 'pan', start: p, view: view ?? v, moved: true };
    }
  }

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  function onKeyDown(e) {
    const step = v.w * 0.15;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      setView(clamp({ ...v, x: v.x + moves[e.key][0], y: v.y + moves[e.key][1] }));
    } else if (e.key === '+' || e.key === '=') {
      zoomCentre(0.75);
    } else if (e.key === '-') {
      zoomCentre(1 / 0.75);
    }
  }

  function zoomCentre(factor) {
    const r = wrapRef.current.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  }

  // ---- what to draw ----
  const colourOf = useMemo(() => new Map(teams.map((t) => [t.id, markerColor(t.slot)])), [teams]);
  const initialOf = useMemo(() => new Map(teams.map((t) => [t.id, t.initial ?? t.name?.[0] ?? '?'])), [teams]);
  const nameOf = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams]);

  const states = useMemo(() => new Map(PLACES.map((p) => [p.key, placeState({
    key: p.key, teamId: myTeamId, owners, homes, open, attacked, status,
  })])), [myTeamId, owners, homes, open, attacked, status]);

  const holders = useMemo(() => regionHolders(owners), [owners]);

  // Links drawn as routes: every boat and travel link, and any land link
  // between areas that do not share a border (a pass through the mountains).
  // Neighbours whose land touches need no line; the border is the link.
  const routes = useMemo(() => {
    const touching = new Set(areas?.touching ?? []);
    return LINKS.filter(([a, b, kind]) => kind !== 'land' || !touching.has(pairKey(a, b)));
  }, [areas]);

  const neighbourKeys = useMemo(() => {
    if (!selected) return new Set();
    return new Set(LINKS.flatMap(([a, b]) => (a === selected ? [b] : b === selected ? [a] : [])));
  }, [selected]);

  const showNames = k <= NAMES_AT;
  const pad = 60 * k;
  const visible = (p) => p.px > v.x - pad && p.px < v.x + v.w + pad && p.py > v.y - pad && p.py < v.y + h + pad;

  const hoverPlace = hovered && placeByKey.get(hovered);
  const hoverAt = hoverPlace && pixel.get(hovered);

  return (
    <div className="territory-map">
      <div
        ref={wrapRef}
        className="territory-map-view"
        tabIndex={0}
        role="application"
        aria-label="World map. Drag to move, scroll or pinch to zoom, press a piece of land to open it."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHovered(null)}
        onKeyDown={onKeyDown}
      >
        <svg viewBox={`${v.x} ${v.y} ${v.w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            {/* Hatching for the land a team can or does fight over, held at a
                constant on-screen size like everything else. */}
            {['gold', 'lit', 'red'].map((c) => (
              <pattern
                key={c} id={`territory-hatch-${c}`} patternUnits="userSpaceOnUse"
                width={9 * k} height={9 * k} patternTransform="rotate(45)"
              >
                <rect width={3 * k} height={9 * k} className={`territory-hatch ${c}`} />
              </pattern>
            ))}
          </defs>

          <image href={IMG} x="0" y="0" width={MAP.width} height={MAP.height} />

          {areas ? (
            <Land
              areas={areas}
              states={states}
              colourOf={colourOf}
              selected={selected}
              hovered={hovered}
              neighbourKeys={neighbourKeys}
              routes={routes}
            />
          ) : (
            <rect x="0" y="0" width={MAP.width} height={MAP.height} className="territory-dim" />
          )}

          {!showNames && REGIONS.map((r) => {
            const [x, y0] = areas?.labels?.[r.key] ?? fallbackLabels[r.key];
            // A home crest sitting on the name pushes the name up above it.
            const crest = [...homes.values()].map((key) => pixel.get(key))
              .find((p) => Math.abs(p.px - x) < 70 * k && Math.abs(p.py - y0) < 34 * k);
            const y = crest ? crest.py - 30 * k : y0;
            const holder = holders.get(r.key);
            return (
              <g key={r.key} className={`territory-region-label${holder ? ' held' : ''}`}>
                <text x={x} y={y} style={{ fontSize: REGION_LABEL * k, strokeWidth: 4 * k }}>
                  {(SHORT[r.key] ?? r.name).toUpperCase()}
                </text>
                <text
                  x={x} y={y + REGION_LABEL * 1.15 * k}
                  className="bonus"
                  style={{
                    fontSize: 9.5 * k, strokeWidth: 3 * k,
                    fill: holder ? colourOf.get(holder) : undefined,
                  }}
                >
                  {holder ? `♛ ${nameOf.get(holder) ?? ''} +${bonuses.get(r.key) ?? 0}` : `+${bonuses.get(r.key) ?? 0}`}
                </text>
              </g>
            );
          })}

          {PLACES.map((p) => {
            const at = pixel.get(p.key);
            if (!visible(at)) return null;
            const s = states.get(p.key);
            const isHomePlace = s.kind === 'home' || s.kind === 'home-rival';
            const isSel = selected === p.key;
            const colour = s.owner ? colourOf.get(s.owner) : null;
            const r = (isHomePlace ? HOME : MARKER) * k;
            // From afar the land says enough; the pins come with the names.
            const pinned = showNames || isHomePlace || isSel || hovered === p.key || s.working || s.attacked;
            if (!pinned) return null;
            return (
              <g
                key={p.key}
                data-place={p.key}
                transform={`translate(${at.px} ${at.py})`}
                className={[
                  'territory-marker', s.kind,
                  isSel && 'selected', hovered === p.key && 'hovered',
                ].filter(Boolean).join(' ')}
              >
                {/* A larger invisible target, so a fingertip finds the small
                    islands whose land alone would be hard to hit. */}
                <circle r={16 * k} className="hit" />
                {isHomePlace ? (
                  <>
                    <path d={shieldPath(r)} className="crest" style={{ fill: colour ?? '#222', strokeWidth: 2 * k }} />
                    <text y={r * 0.12} className="crest-letter" style={{ fontSize: 11.5 * k }}>
                      {initialOf.get(s.owner)}
                    </text>
                  </>
                ) : (
                  <rect
                    x={-r} y={-r} width={r * 2} height={r * 2}
                    transform="rotate(45)"
                    className="pin"
                    style={{ fill: colour ?? undefined, strokeWidth: 1.6 * k }}
                  />
                )}
                {(showNames || isHomePlace || isSel) && (
                  <text
                    y={r * (isHomePlace ? 1.35 : 1) + LABEL * 1.05 * k}
                    className="territory-label"
                    style={{ fontSize: LABEL * k, strokeWidth: 3.2 * k }}
                  >
                    {p.name}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {hoverPlace && hoverAt && (
          <HoverCard
            place={hoverPlace}
            state={states.get(hovered)}
            ownerName={nameOf.get(states.get(hovered).owner)}
            colour={colourOf.get(states.get(hovered).owner)}
            left={((hoverAt.px - v.x) / v.w) * box.w}
            top={((hoverAt.py - v.y) / h) * box.h}
          />
        )}

        <div className="territory-zoom" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => zoomCentre(0.7)} aria-label="Zoom in">+</button>
          <button type="button" onClick={() => zoomCentre(1 / 0.7)} aria-label="Zoom out">−</button>
          <button type="button" onClick={fit} aria-label="Show the whole world">⤢</button>
        </div>
      </div>
      <p className="territory-credit muted">{MAP.credit}</p>
    </div>
  );
}

/**
 * Everything that sits ON the land and does not move with the view: the
 * areas in their owners' colours, the hatching for land in play, the region
 * borders and the routes. Memoised, because a drag re-renders the map on
 * every frame and none of this changes while it does.
 */
const Land = memo(function Land({ areas, states, colourOf, selected, hovered, neighbourKeys, routes }) {
  const veil = `M0 0H${MAP.width}V${MAP.height}H0Z${areas.all}`;
  return (
    <>
      {/* The sea and the islands outside the game sink back; the board is lit. */}
      <path d={veil} className="territory-veil" fillRule="evenodd" />

      <g className="territory-areas">
        {PLACES.map((p) => {
          const s = states.get(p.key);
          const colour = s.owner ? colourOf.get(s.owner) : null;
          return (
            <path
              key={p.key}
              d={areas.places[p.key]}
              data-place={p.key}
              fillRule="evenodd"
              vectorEffect="non-scaling-stroke"
              className={`territory-area ${s.kind}`}
              style={colour ? { fill: colour } : undefined}
            />
          );
        })}
      </g>

      {/* Land in play, hatched over its colour. */}
      <g className="territory-overlays">
        {PLACES.map((p) => {
          const s = states.get(p.key);
          const kind = s.attacked ? 'attacked' : s.working ? 'working' : s.openable ? 'openable' : null;
          if (!kind) return null;
          return (
            <path
              key={p.key} d={areas.places[p.key]} fillRule="evenodd"
              vectorEffect="non-scaling-stroke" className={`territory-overlay ${kind}`}
            />
          );
        })}
      </g>

      <g className="territory-regions">
        {Object.entries(areas.regions).map(([key, d]) => (
          <g key={key}>
            <path d={d} className="territory-region-edge under" vectorEffect="non-scaling-stroke" />
            <path d={d} className="territory-region-edge" vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </g>

      <g className="territory-routes">
        {routes.map(([a, b, kind]) => {
          const far = routeLength(a, b) > FAR;
          const lit = [a, b].some((key) => key === selected || key === hovered);
          return (
            <path
              key={`${a}-${b}`} d={routePath(a, b)}
              className={['territory-route', kind, far && 'far', lit && 'lit'].filter(Boolean).join(' ')}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </g>

      {/* Outlines on top of everything else on the land. */}
      {[...neighbourKeys].map((key) => (
        <path
          key={`n-${key}`} d={areas.places[key]} fillRule="evenodd"
          className="territory-outline neighbour" vectorEffect="non-scaling-stroke"
        />
      ))}
      {hovered && hovered !== selected && (
        <path d={areas.places[hovered]} fillRule="evenodd" className="territory-outline hovered" vectorEffect="non-scaling-stroke" />
      )}
      {selected && (
        <path d={areas.places[selected]} fillRule="evenodd" className="territory-outline selected" vectorEffect="non-scaling-stroke" />
      )}
    </>
  );
});

const HINT = {
  home: 'Your home — safe for the whole game',
  'home-rival': 'A home — it cannot be taken',
  mine: 'Yours',
  rival: 'Held by a rival',
  free: 'Free land',
};

/** The little card that follows the mouse from place to place. */
function HoverCard({ place, state, ownerName, colour, left, top }) {
  let line = HINT[state.kind];
  if (state.kind === 'rival' || state.kind === 'home-rival') line = `${ownerName ?? 'A rival'}${state.kind === 'home-rival' ? "'s home" : ''}`;
  let tag = null;
  if (state.attacked) tag = <span className="tag attacked">Under attack!</span>;
  else if (state.working) tag = <span className="tag working">Working on it</span>;
  else if (state.openable) tag = <span className="tag openable">You can attack</span>;
  return (
    <div className="territory-hover" style={{ left, top }} role="presentation">
      <strong>{place.name}</strong>
      <span className="muted">{regionName.get(place.region)}</span>
      <span className="owner">
        {colour && <i style={{ background: colour }} aria-hidden="true" />}
        {line}
      </span>
      {tag}
    </div>
  );
}
