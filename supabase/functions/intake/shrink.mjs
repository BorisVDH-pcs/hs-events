// Makes a screenshot that is over the bucket's 3 MB small enough to keep, by
// halving its width and height until it fits.
//
// Only web-standard code: the Compression Streams API for zlib, which the
// runtime does natively, and plain loops for the rest. No image library, so no
// third-party code runs next to the service-role key, and the same file runs
// in Node (the tests) and in Deno (the Edge Function).
//
// It reads only what Dink sends when a screenshot is between 3 and 8 MB: a PNG
// written by Java's ImageIO, 8 bits per channel, RGB or RGBA, not interlaced.
// (Over 8 MB Dink itself turns it into a JPEG, which is not handled here.)
// Anything else gives null and the caller leaves the drop to the site.
//
// The cost was measured on Supabase's edge runtime, which allows 2 s of CPU
// per request: see runelite-plugin/README.md. MAX_PIXELS keeps every input
// inside what was measured.

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** The largest picture this will decode: a 4K screen, with room to spare. */
export const MAX_PIXELS = 3840 * 2400;

/** Width, height and format from the PNG header, or null when it is not one this can read. */
export function pngInfo(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 33) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(8) !== 13 || text(bytes, 12) !== 'IHDR') return null;
  const width = v.getUint32(16), height = v.getUint32(20);
  const depth = bytes[24], colourType = bytes[25], interlace = bytes[28];
  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : 0;
  if (!width || !height || depth !== 8 || !channels || interlace !== 0 || bytes[26] !== 0 || bytes[27] !== 0) return null;
  return { width, height, channels, colourType };
}

/** True when shrinkPng will try: a PNG it can read, and not too many pixels. */
export function canShrink(bytes) {
  const info = pngInfo(bytes);
  return !!info && info.width * info.height <= MAX_PIXELS;
}

/**
 * @returns {Promise<{bytes: Uint8Array, width: number, height: number, fromWidth: number, fromHeight: number} | null>}
 *   A PNG of at most maxBytes, or null when this cannot make one.
 */
export async function shrinkPng(bytes, maxBytes) {
  const info = pngInfo(bytes);
  if (!info || info.width * info.height > MAX_PIXELS) return null;
  const { width, height, channels } = info;

  const idat = chunksOf(bytes, 'IDAT');
  if (!idat) return null;
  const raw = await inflate(idat, height * (1 + width * channels));
  if (!raw) return null;
  let img = unfilter(raw, width, height, channels);
  if (!img) return null;
  // A screenshot's alpha is all 255: leave it out, a quarter less to compress.
  const keep = channels === 4 && !opaque(img) ? 4 : 3;

  // Half the width and height is a quarter of the pixels. A 4K screenshot
  // becomes 1920 x 1080, still easy to read; three halvings at most.
  for (let round = 0; round < 3 && img.w >= 2 && img.h >= 2; round++) {
    img = halve(img, keep);
    // Deflate is nearly all the cost, and unfiltered rows deflate fastest.
    // They are bigger, so the Sub filter is the fallback before halving again.
    for (const filter of [0, 1]) {
      const out = await encode(img, filter);
      if (out.length <= maxBytes) return { bytes: out, width: img.w, height: img.h, fromWidth: width, fromHeight: height };
    }
  }
  return null;
}

// ------------------------------------------------------------------ reading

const text = (b, at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** Every chunk of one type, joined; null if the file's chunk list is broken. */
function chunksOf(bytes, type) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = [];
  let at = 8, total = 0;
  while (at + 12 <= bytes.length) {
    const len = v.getUint32(at);
    const name = text(bytes, at + 4);
    if (at + 12 + len > bytes.length) return null;
    if (name === type) { parts.push(bytes.subarray(at + 8, at + 8 + len)); total += len; }
    if (name === 'IEND') break;
    at += 12 + len;
  }
  if (!parts.length) return null;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** zlib inflate that stops as soon as the output would be larger than the header says. */
async function inflate(data, expected) {
  try {
    const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    const out = new Uint8Array(expected);
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (n + value.length > expected) { await reader.cancel(); return null; }
      out.set(value, n);
      n += value.length;
    }
    return n === expected ? out : null;
  } catch {
    return null;
  }
}

/** Undoes PNG's per-row filters (types 0 to 4). */
function unfilter(raw, w, h, c) {
  const stride = w * c;
  const out = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const up = row - stride;
    const type = raw[src - 1];
    if (type === 0) {
      out.set(raw.subarray(src, src + stride), row);
    } else if (type === 1) {
      for (let x = 0; x < c; x++) out[row + x] = raw[src + x];
      for (let x = c; x < stride; x++) out[row + x] = (raw[src + x] + out[row + x - c]) & 255;
    } else if (type === 2) {
      if (y === 0) out.set(raw.subarray(src, src + stride), row);
      else for (let x = 0; x < stride; x++) out[row + x] = (raw[src + x] + out[up + x]) & 255;
    } else if (type === 3) {
      for (let x = 0; x < stride; x++) {
        const a = x >= c ? out[row + x - c] : 0, b = y ? out[up + x] : 0;
        out[row + x] = (raw[src + x] + ((a + b) >> 1)) & 255;
      }
    } else if (type === 4) {
      for (let x = 0; x < stride; x++) {
        const a = x >= c ? out[row + x - c] : 0, b = y ? out[up + x] : 0, d = x >= c && y ? out[up + x - c] : 0;
        out[row + x] = (raw[src + x] + paeth(a, b, d)) & 255;
      }
    } else {
      return null;
    }
  }
  return { w, h, c, data: out };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// ---------------------------------------------------------------- resizing

function opaque({ c, data }) {
  for (let i = c - 1; i < data.length; i += c) if (data[i] !== 255) return false;
  return true;
}

/**
 * Half the width and height: each new pixel is the average of a 2 x 2 block.
 * `keep` channels of each pixel are kept (3 drops an opaque alpha).
 */
function halve({ w, h, c, data }, keep = c) {
  const W = w >> 1, H = h >> 1, s = w * c;
  const out = new Uint8Array(W * H * keep);
  for (let y = 0; y < H; y++) {
    const r0 = 2 * y * s, r1 = r0 + s;
    let o = y * W * keep;
    for (let x = 0; x < W; x++) {
      const i = r0 + 2 * x * c, j = r1 + 2 * x * c;
      for (let k = 0; k < keep; k++, o++) {
        out[o] = (data[i + k] + data[i + c + k] + data[j + k] + data[j + c + k] + 2) >> 2;
      }
    }
  }
  return { w: W, h: H, c: keep, data: out };
}

// ------------------------------------------------------------------ writing

/** A PNG with every row given one filter: 0 (none) or 1 (Sub, each byte minus the one to its left). */
async function encode({ w, h, c, data }, filter) {
  const stride = w * c;
  const filtered = new Uint8Array(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    const row = y * stride, o = y * (stride + 1) + 1;
    filtered[o - 1] = filter;
    if (filter === 0) {
      filtered.set(data.subarray(row, row + stride), o);
    } else {
      for (let x = 0; x < c; x++) filtered[o + x] = data[row + x];
      for (let x = c; x < stride; x++) filtered[o + x] = data[row + x] - data[row + x - c];
    }
  }
  const zipped = new Uint8Array(await new Response(
    new Blob([filtered]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());

  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w);
  iv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = c === 4 ? 6 : 2;
  return join([Uint8Array.from(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', zipped), chunk('IEND', new Uint8Array(0))]);
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const join = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

let CRC_TABLE;
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
