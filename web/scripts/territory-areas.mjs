// Builds public/territory/areas.json -- the land each Territory place owns on
// the map, as SVG paths -- from the map image and territoryWorld.js:
//
//   1. a land mask from the image (water is blue, the void is black), with
//      rivers and small lakes closed so an area is not split by a stream;
//   2. every place grows over the land nearest to it (a multi-source shortest
//      path that never crosses water), then a short hop across water picks up
//      the islets nobody stands on;
//   3. each area, each Leagues region and the whole board are traced with
//      marching squares and simplified to paths;
//   4. `touching` lists the areas that share a real border. The self-test
//      checks that each such pair is linked in territoryWorld.js (bar the
//      River Salve), so the map never shows two neighbours you cannot cross.
//
// Run it again after moving or adding a place. It needs sharp, which the app
// does not: npm i --no-save sharp && node scripts/territory-areas.mjs .
// It also writes preview.png (outlines over the map) to the current folder.
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const WEB = process.argv[2] ?? '.';
const world = await import(pathToFileURL(`${WEB}/src/lib/territoryWorld.js`).href);
const { MAP, PLACES, REGIONS, LINKS, toPixel } = world;

const S = 2; // map px per cell
const W = MAP.width / S;
const H = MAP.height / S;
const CAP = Number(process.env.CAP ?? 150); // reach, in cells of land
const WATER_COST = Number(process.env.WATER ?? 3);
const N = W * H;
const inGrid = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

// ---- land mask ----
const { data } = await sharp(`${WEB}/public/${MAP.src}`).resize(W, H, { kernel: 'cubic' })
  .removeAlpha().raw().toBuffer({ resolveWithObject: true });
let land = new Uint8Array(N);
for (let i = 0, j = 0; j < N; i += 3, j++) {
  const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
  land[j] = (b > r + 22 && b >= g - 4) || Math.max(r, g, b) < 18 ? 0 : 1;
}
function morph(src, rad, want) {
  const out = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = want ? 0 : 1;
      outer: for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (dx * dx + dy * dy > rad * rad) continue;
          const s = inGrid(x + dx, y + dy) ? src[(y + dy) * W + x + dx] : 0;
          if (s === want) { v = want; break outer; }
        }
      }
      out[y * W + x] = v;
    }
  }
  return out;
}
land = morph(morph(land, 2, 1), 2, 0); // close rivers and narrow gaps

function components(val) {
  const comp = new Int32Array(N).fill(-1);
  const sizes = [];
  const edge = [];
  for (let s = 0; s < N; s++) {
    if (land[s] !== val || comp[s] !== -1) continue;
    const id = sizes.length;
    let n = 0;
    let touches = false;
    const st = [s];
    comp[s] = id;
    while (st.length) {
      const c = st.pop();
      n++;
      const x = c % W; const y = (c / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touches = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!inGrid(x + dx, y + dy)) continue;
        const q = (y + dy) * W + x + dx;
        if (land[q] === val && comp[q] === -1) { comp[q] = id; st.push(q); }
      }
    }
    sizes.push(n);
    edge.push(touches);
  }
  return { comp, sizes, edge };
}
{ // fill small enclosed lakes
  const { comp, sizes, edge } = components(0);
  for (let s = 0; s < N; s++) if (comp[s] >= 0 && !edge[comp[s]] && sizes[comp[s]] < 900) land[s] = 1;
}
{ // drop specks
  const { comp, sizes } = components(1);
  for (let s = 0; s < N; s++) if (comp[s] >= 0 && sizes[comp[s]] < 25) land[s] = 0;
}

// ---- grow every place over the land nearest to it (water is slow) ----
const label = new Int16Array(N).fill(-1);
const dist = new Float32Array(N).fill(Infinity);
const done = new Uint8Array(N);
// binary heap on typed arrays: key = distance, val = cell * 128 + place
let hk = new Float64Array(1 << 20);
let hv = new Int32Array(1 << 20);
let hn = 0;
const heap = { get length() { return hn; } };
function push([d, c, li]) {
  if (hn === hk.length) {
    const k2 = new Float64Array(hn * 2); k2.set(hk); hk = k2;
    const v2 = new Int32Array(hn * 2); v2.set(hv); hv = v2;
  }
  const val = c * 128 + li;
  let i = hn++;
  while (i) {
    const p = (i - 1) >> 1;
    if (hk[p] <= d) break;
    hk[i] = hk[p]; hv[i] = hv[p];
    i = p;
  }
  hk[i] = d; hv[i] = val;
}
function pop() {
  const d = hk[0]; const val = hv[0];
  hn--;
  if (hn) {
    const lk = hk[hn]; const lv = hv[hn];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= hn) break;
      if (c + 1 < hn && hk[c + 1] < hk[c]) c++;
      if (hk[c] >= lk) break;
      hk[i] = hk[c]; hv[i] = hv[c];
      i = c;
    }
    hk[i] = lk; hv[i] = lv;
  }
  return [d, Math.floor(val / 128), val % 128];
}
PLACES.forEach((p, li) => {
  const { px, py } = toPixel(p.x, p.y);
  const cx = Math.round(px / S); const cy = Math.round(py / S);
  let best = null;
  for (let r = 0; r < 14 && best == null; r++) {
    for (let dy = -r; dy <= r && best == null; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const q = (cy + dy) * W + cx + dx;
        if (inGrid(cx + dx, cy + dy) && land[q]) { best = q; break; }
      }
    }
  }
  if (best == null) throw new Error(`no land near ${p.key}`);
  push([0, best, li]);
});
const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
// Pass 1: over land only, so an area never jumps a strait onto another coast.
// Pass 2: from every area's edge, a short hop over water claims the nearby
// islets no place stands on (only land nobody holds yet).
function grow(waterCost, cap) {
  while (heap.length) {
    const [d, c, li] = pop();
    if (done[c]) continue;
    done[c] = 1;
    if (land[c] && label[c] < 0) label[c] = li;
    const x = c % W; const y = (c / W) | 0;
    for (const [dx, dy, len] of steps) {
      if (!inGrid(x + dx, y + dy)) continue;
      const q = (y + dy) * W + x + dx;
      if (!land[q] && !waterCost) continue;
      if (waterCost && land[q] && label[q] >= 0 && label[q] !== li) continue;
      const nd = d + len * (land[q] ? 1 : waterCost);
      if (!done[q] && nd < dist[q] && nd <= cap) { dist[q] = nd; push([nd, q, li]); }
    }
  }
}
grow(0, CAP);
done.fill(0);
dist.fill(Infinity);
for (let s = 0; s < N; s++) if (label[s] >= 0) { dist[s] = 0; push([0, s, label[s]]); }
grow(WATER_COST, 40);

// ---- contours: marching squares on a softened mask ----
function contour(inside) {
  let f = new Float32Array(N);
  let x0 = W; let y0 = H; let x1 = -1; let y1 = -1;
  for (let s = 0; s < N; s++) {
    if (!inside(s)) continue;
    f[s] = 1;
    const x = s % W; const y = (s / W) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return [];
  x0 = Math.max(0, x0 - 4); y0 = Math.max(0, y0 - 4); x1 = Math.min(W - 1, x1 + 4); y1 = Math.min(H - 1, y1 + 4);
  for (let pass = 0; pass < 2; pass++) { // 3x3 box blur rounds the stair steps off
    const g = new Float32Array(N);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let t = 0; let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!inGrid(x + dx, y + dy)) continue;
            t += f[(y + dy) * W + x + dx]; n++;
          }
        }
        g[y * W + x] = t / n;
      }
    }
    f = g;
  }
  const at = (x, y) => (inGrid(x, y) ? f[y * W + x] : 0);
  const pt = new Map();
  const next = new Map();
  const hid = (x, y) => 2 * (y * (W + 2) + x);
  const vid = (x, y) => 2 * (y * (W + 2) + x) + 1;
  const lerp = (a, b) => (0.5 - a) / (b - a);
  for (let y = y0 - 1; y <= y1; y++) {
    for (let x = x0 - 1; x <= x1; x++) {
      const a = at(x, y); const b = at(x + 1, y); const c = at(x + 1, y + 1); const d = at(x, y + 1);
      const code = (a > 0.5 ? 8 : 0) | (b > 0.5 ? 4 : 0) | (c > 0.5 ? 2 : 0) | (d > 0.5 ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const T = () => { const id = hid(x + 1, y + 1); pt.set(id, [x + lerp(a, b), y]); return id; };
      const R = () => { const id = vid(x + 2, y + 1); pt.set(id, [x + 1, y + lerp(b, c)]); return id; };
      const B = () => { const id = hid(x + 1, y + 2); pt.set(id, [x + lerp(d, c), y + 1]); return id; };
      const L = () => { const id = vid(x + 1, y + 1); pt.set(id, [x, y + lerp(a, d)]); return id; };
      const seg = (p, q) => next.set(p, q);
      switch (code) {
        case 1: seg(L(), B()); break;
        case 2: seg(B(), R()); break;
        case 3: seg(L(), R()); break;
        case 4: seg(R(), T()); break;
        case 5: seg(L(), T()); seg(R(), B()); break;
        case 6: seg(B(), T()); break;
        case 7: seg(L(), T()); break;
        case 8: seg(T(), L()); break;
        case 9: seg(T(), B()); break;
        case 10: seg(T(), R()); seg(B(), L()); break;
        case 11: seg(T(), R()); break;
        case 12: seg(R(), L()); break;
        case 13: seg(R(), B()); break;
        case 14: seg(B(), L()); break;
        default: break;
      }
    }
  }
  const rings = [];
  for (const start of [...next.keys()]) {
    if (!next.has(start)) continue;
    const ring = [];
    let e = start;
    while (next.has(e)) { const n = next.get(e); next.delete(e); ring.push(pt.get(e)); e = n; }
    if (ring.length > 3) rings.push(ring);
  }
  return rings;
}
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [i, j] = st.pop();
    let best = -1; let bi = -1;
    const [ax, ay] = pts[i]; const [bx, by] = pts[j];
    const L = Math.hypot(bx - ax, by - ay) || 1;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / L;
      if (d > best) { best = d; bi = k; }
    }
    if (best > tol) { keep[bi] = 1; st.push([i, bi], [bi, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}
// A closed ring has no baseline (its ends meet), so split it at the point
// farthest from the start and simplify the two halves.
function simplifyRing(r, tol) {
  let far = 0; let fd = -1;
  for (let i = 1; i < r.length; i++) {
    const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  const a = simplify(r.slice(0, far + 1), tol);
  const b = simplify([...r.slice(far), r[0]], tol);
  return [...a, ...b.slice(1, -1)];
}
function ringArea(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i]; const [x2, y2] = r[(i + 1) % r.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}
function toPath(rings, tol = 0.6, minArea = 6) {
  return rings
    .map((r) => simplifyRing(r, tol))
    .filter((r) => r.length >= 3 && Math.abs(ringArea(r)) >= minArea)
    .map((r) => `M${r.map(([x, y]) => `${Math.round((x + 0.5) * S)} ${Math.round((y + 0.5) * S)}`).join('L')}Z`)
    .join('');
}

const regionOf = PLACES.map((p) => p.region);
const out = { cell: S, places: {}, regions: {}, all: '' };
PLACES.forEach((p, li) => { out.places[p.key] = toPath(contour((s) => label[s] === li)); });
// Where a region's name goes: the point deepest inside its land (a chamfer
// distance transform), so the label sits in the middle of the territory
// rather than on a coast. Weighted a little toward the region's widest part.
function deepest(inside) {
  const d = new Float32Array(N);
  for (let s = 0; s < N; s++) d[s] = inside(s) ? 1e9 : 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = y * W + x;
      if (!d[s]) continue;
      if (x > 0) d[s] = Math.min(d[s], d[s - 1] + 1);
      if (y > 0) d[s] = Math.min(d[s], d[s - W] + 1);
      if (x > 0 && y > 0) d[s] = Math.min(d[s], d[s - W - 1] + Math.SQRT2);
      if (x < W - 1 && y > 0) d[s] = Math.min(d[s], d[s - W + 1] + Math.SQRT2);
    }
  }
  let best = 0; let at = 0;
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const s = y * W + x;
      if (!d[s]) continue;
      if (x < W - 1) d[s] = Math.min(d[s], d[s + 1] + 1);
      if (y < H - 1) d[s] = Math.min(d[s], d[s + W] + 1);
      if (x < W - 1 && y < H - 1) d[s] = Math.min(d[s], d[s + W + 1] + Math.SQRT2);
      if (x > 0 && y < H - 1) d[s] = Math.min(d[s], d[s + W - 1] + Math.SQRT2);
      if (d[s] > best) { best = d[s]; at = s; }
    }
  }
  return [(at % W + 0.5) * S, (((at / W) | 0) + 0.5) * S].map(Math.round);
}
out.labels = {};
for (const r of REGIONS) {
  const inRegion = (s) => label[s] >= 0 && regionOf[label[s]] === r.key;
  out.regions[r.key] = toPath(contour(inRegion), 0.8, 40);
  out.labels[r.key] = deepest(inRegion);
}
out.all = toPath(contour((s) => label[s] >= 0), 0.8, 40);
// ---- which areas share a border, and how long it is ----
const pair = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const border = new Map();
for (let y = 0; y < H - 1; y++) {
  for (let x = 0; x < W - 1; x++) {
    const a = label[y * W + x];
    if (a < 0) continue;
    for (const q of [y * W + x + 1, (y + 1) * W + x]) {
      const b = label[q];
      if (b >= 0 && b !== a) {
        const k = pair(PLACES[a].key, PLACES[b].key);
        border.set(k, (border.get(k) ?? 0) + 1);
      }
    }
  }
}
const MIN_BORDER = Number(process.env.MINB ?? 10);
const touching = new Set([...border].filter(([, n]) => n >= MIN_BORDER).map(([k]) => k));
out.touching = [...touching].sort();
const json = JSON.stringify(out);
writeFileSync(`${WEB}/public/territory/areas.json`, json);

// ---- report ----
const cells = new Map();
for (const l of label) if (l >= 0) cells.set(l, (cells.get(l) ?? 0) + 1);
const small = PLACES.map((p, i) => [p.key, cells.get(i) ?? 0]).sort((a, b) => a[1] - b[1]).slice(0, 8);
console.log('short borders, ignored:', [...border].filter(([, n]) => n < MIN_BORDER).map(([k, n]) => `${k}:${n}`).join(', '));
console.log('borders:', [...border].filter(([, n]) => n >= MIN_BORDER).map(([k, n]) => `${k}:${n}`).join(', '));
const links = new Set(LINKS.map(([a, b]) => pair(a, b)));
console.log(`areas.json ${(json.length / 1024).toFixed(0)} KB; smallest areas (cells):`, small);
console.log('touching but NOT linked:', [...touching].filter((t) => !links.has(t)).join(', ') || 'none');
console.log('land links whose areas do not touch:',
  LINKS.filter(([, , k]) => k === 'land').map(([a, b]) => pair(a, b)).filter((t) => !touching.has(t)).join(', ') || 'none');

// preview image: area outlines and region borders over the map
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${MAP.width}" height="${MAP.height}">${
  Object.values(out.places).map((d) => `<path d="${d}" fill="rgba(255,255,255,.12)" stroke="#fff" stroke-width="2.5" fill-rule="evenodd"/>`).join('')}${
  Object.values(out.regions).map((d) => `<path d="${d}" fill="none" stroke="#ffcc33" stroke-width="6"/>`).join('')}${
  PLACES.map((p) => { const { px, py } = toPixel(p.x, p.y); return `<circle cx="${px}" cy="${py}" r="9" fill="#e33"/>`; }).join('')}</svg>`;
await sharp(`${WEB}/public/${MAP.src}`).composite([{ input: Buffer.from(svg) }]).png().toFile('preview-full.png');
await sharp('preview-full.png').resize(1480).png().toFile('preview.png');
