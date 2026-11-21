// A PNG writer and reader for the tests only. Written apart from
// intake/shrink.mjs and built on Node's own zlib, so the two check each other:
// this writes every row filter PNG has and splits the data over several IDAT
// chunks; the reader checks every chunk's CRC.

import { crc32, deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function predict(t, a, b, d) {
  switch (t) {
    case 0: return 0;
    case 1: return a;
    case 2: return b;
    case 3: return (a + b) >> 1;
    default: return paeth(a, b, d);
  }
}

export function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}

export function ihdr(w, h, { depth = 8, colourType = 6, interlace = 0 } = {}) {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(w, 0);
  d.writeUInt32BE(h, 4);
  d[8] = depth;
  d[9] = colourType;
  d[12] = interlace;
  return chunk('IHDR', d);
}

/** A PNG of w x h pixels from pixel(x, y, channel). Rows take the filters in turn. */
export function makePng(w, h, pixel, { channels = 4, filters = [0, 1, 2, 3, 4], level = 6, idatChunk = 8192 } = {}) {
  const c = channels, s = w * c;
  const data = new Uint8Array(h * s);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < c; k++) data[y * s + x * c + k] = pixel(x, y, k);
  const raw = new Uint8Array(h * (s + 1));
  for (let y = 0; y < h; y++) {
    const t = filters[y % filters.length];
    raw[y * (s + 1)] = t;
    for (let x = 0; x < s; x++) {
      const a = x >= c ? data[y * s + x - c] : 0, b = y ? data[(y - 1) * s + x] : 0, d = x >= c && y ? data[(y - 1) * s + x - c] : 0;
      raw[y * (s + 1) + 1 + x] = (data[y * s + x] - predict(t, a, b, d)) & 255;
    }
  }
  const z = deflateSync(raw, { level });
  const parts = [SIGNATURE, ihdr(w, h, { colourType: c === 4 ? 6 : 2 })];
  for (let i = 0; i < z.length; i += idatChunk) parts.push(chunk('IDAT', z.subarray(i, i + idatChunk)));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return { bytes: new Uint8Array(Buffer.concat(parts)), data };
}

/** Header and chunks of a PNG, put together as given: for files that are wrong on purpose. */
export const rawPng = (...chunks) => new Uint8Array(Buffer.concat([SIGNATURE, ...chunks]));

/** Reads an 8-bit RGB or RGBA PNG; throws on a bad CRC. */
export function readPng(bytes) {
  const b = Buffer.from(bytes);
  if (!b.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let at = 8, w, h, c, colourType;
  const idat = [];
  while (at < b.length) {
    const len = b.readUInt32BE(at), type = b.toString('latin1', at + 4, at + 8);
    const data = b.subarray(at + 8, at + 8 + len);
    if (crc32(b.subarray(at + 4, at + 8 + len)) !== b.readUInt32BE(at + 8 + len)) throw new Error(`bad CRC in ${type}`);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colourType = data[9]; c = colourType === 6 ? 4 : 3; }
    if (type === 'IDAT') idat.push(data);
    at += 12 + len;
    if (type === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const s = w * c, out = new Uint8Array(h * s);
  for (let y = 0; y < h; y++) {
    const t = raw[y * (s + 1)];
    for (let x = 0; x < s; x++) {
      const a = x >= c ? out[y * s + x - c] : 0, bb = y ? out[(y - 1) * s + x] : 0, d = x >= c && y ? out[(y - 1) * s + x - c] : 0;
      out[y * s + x] = (raw[y * (s + 1) + 1 + x] + predict(t, a, bb, d)) & 255;
    }
  }
  return { width: w, height: h, channels: c, colourType, data: out };
}

/** What half the size should look like: each pixel the rounded average of a 2 x 2 block. */
export function expectedHalf(data, w, h, c, keep = c) {
  const W = w >> 1, H = h >> 1, out = new Uint8Array(W * H * keep);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let k = 0; k < keep; k++) {
    const at = (yy, xx) => data[(yy * w + xx) * c + k];
    out[(y * W + x) * keep + k] = Math.round((at(2 * y, 2 * x) + at(2 * y, 2 * x + 1) + at(2 * y + 1, 2 * x) + at(2 * y + 1, 2 * x + 1)) / 4);
  }
  return out;
}

export const same = (a, b) => a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
