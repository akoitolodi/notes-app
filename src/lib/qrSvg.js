/**
 * qrSvg — 100% offline zero-dependency Byte-mode QR Code matrix & SVG generator (EC Level L).
 * Supports Versions 1–24 (~17 to ~1,171 UTF-8 bytes) for instant offline note sharing via QR.
 */

// [version, totalCodewords, ecPerBlock, [[numBlocks, dataCodewordsPerBlock], ...]]
const QR_LEVEL_L_SPECS = [
  [1, 26, 7, [[1, 19]]],
  [2, 44, 10, [[1, 34]]],
  [3, 70, 15, [[1, 55]]],
  [4, 100, 20, [[1, 80]]],
  [5, 134, 26, [[1, 108]]],
  [6, 172, 18, [[2, 68]]],
  [7, 196, 20, [[2, 78]]],
  [8, 242, 24, [[2, 97]]],
  [9, 292, 30, [[2, 116]]],
  [10, 346, 18, [[2, 68], [2, 69]]],
  [11, 404, 20, [[4, 81]]],
  [12, 466, 24, [[2, 92], [2, 93]]],
  [13, 532, 26, [[4, 107]]],
  [14, 581, 30, [[3, 115], [1, 116]]],
  [15, 655, 22, [[5, 87], [1, 88]]],
  [16, 733, 24, [[5, 98], [1, 99]]],
  [17, 815, 28, [[1, 107], [5, 108]]],
  [18, 901, 30, [[5, 120], [1, 121]]],
  [19, 991, 28, [[3, 113], [4, 114]]],
  [20, 1085, 28, [[3, 107], [5, 108]]],
  [21, 1156, 28, [[4, 116], [4, 117]]],
  [22, 1258, 28, [[2, 111], [7, 112]]],
  [23, 1364, 30, [[4, 121], [5, 122]]],
  [24, 1474, 30, [[6, 117], [4, 118]]],
];

const ALIGN_POS = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
  11: [6, 30, 54],
  12: [6, 32, 58],
  13: [6, 34, 62],
  14: [6, 26, 46, 66],
  15: [6, 26, 48, 70],
  16: [6, 26, 50, 74],
  17: [6, 30, 54, 78],
  18: [6, 30, 56, 82],
  19: [6, 30, 58, 86],
  20: [6, 34, 62, 90],
  21: [6, 28, 50, 72, 94],
  22: [6, 26, 50, 74, 98],
  23: [6, 30, 54, 78, 102],
  24: [6, 28, 54, 80, 106],
};

// GF(256) with primitive polynomial 0x11D
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function computeRsEcc(dataBytes, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const work = new Uint8Array(dataBytes.length + ecLen);
  work.set(dataBytes);
  for (let i = 0; i < dataBytes.length; i++) {
    const coef = work[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        work[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return work.slice(dataBytes.length);
}

function chooseSpec(byteLen) {
  for (const spec of QR_LEVEL_L_SPECS) {
    const [ver, , , groups] = spec;
    const totalData = groups.reduce((s, [cnt, dc]) => s + cnt * dc, 0);
    const lenBits = ver <= 9 ? 8 : 16;
    const overheadBytes = Math.ceil((4 + lenBits) / 8);
    if (byteLen + overheadBytes <= totalData) return spec;
  }
  return null;
}

function encodeDataCodewords(bytes, spec) {
  const [ver, , , groups] = spec;
  const totalData = groups.reduce((s, [cnt, dc]) => s + cnt * dc, 0);
  const lenBits = ver <= 9 ? 8 : 16;

  const bits = [];
  const pushBits = (val, count) => {
    for (let i = count - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };

  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, lenBits);
  for (const b of bytes) pushBits(b, 8);

  const maxBits = totalData * 8;
  const rem = maxBits - bits.length;
  for (let i = 0; i < Math.min(4, rem); i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let val = 0;
    for (let j = 0; j < 8; j++) val = (val << 1) | bits[i + j];
    out.push(val);
  }
  let padToggle = 0;
  while (out.length < totalData) {
    out.push(padToggle ? 0x11 : 0xec);
    padToggle ^= 1;
  }
  return out;
}

function interleaveBlocks(dataBytes, spec) {
  const [, , ecPerBlock, groups] = spec;
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;

  for (const [count, dc] of groups) {
    for (let b = 0; b < count; b++) {
      const slice = dataBytes.slice(offset, offset + dc);
      offset += dc;
      dataBlocks.push(slice);
      ecBlocks.push(computeRsEcc(slice, ecPerBlock));
    }
  }

  const res = [];
  const maxDc = Math.max(...dataBlocks.map(b => b.length));
  for (let i = 0; i < maxDc; i++) {
    for (const blk of dataBlocks) if (i < blk.length) res.push(blk[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const blk of ecBlocks) if (i < blk.length) res.push(blk[i]);
  }
  return res;
}

function placeFinderPattern(mod, reserved, r0, c0, size) {
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const r = r0 + dr;
      const c = c0 + dc;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      reserved[r][c] = true;
      const inBox = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
      const dark =
        inBox &&
        (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
      mod[r][c] = dark ? 1 : 0;
    }
  }
}

function placeAlignmentPattern(mod, reserved, rc, cc) {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const r = rc + dr;
      const c = cc + dc;
      reserved[r][c] = true;
      mod[r][c] = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0) ? 1 : 0;
    }
  }
}

function formatInfoBits(maskIdx) {
  // EC Level L = 01
  const data = (0b01 << 3) | maskIdx;
  let rem = data << 10;
  const poly = 0b10100110111;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= poly << (i - 10);
  }
  return ((data << 10) | rem) ^ 0b101010000010010;
}

function applyMaskPattern(maskIdx, r, c) {
  switch (maskIdx) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

function writeFormatInfo(mod, size, maskIdx) {
  const fmt = formatInfoBits(maskIdx);
  for (let i = 0; i < 15; i++) {
    const bit = (fmt >> i) & 1;
    if (i < 6) mod[8][i] = bit;
    else if (i < 8) mod[8][i + 1] = bit;
    else mod[size - 15 + i][8] = bit;

    if (i < 8) mod[size - 1 - i][8] = bit;
    else if (i < 9) mod[8][size - 8 + (i - 8)] = bit;
    else mod[14 - i][8] = bit;
  }
}

function writeVersionInfo(mod, reserved, ver, size) {
  if (ver < 7) return;
  let rem = ver << 12;
  const poly = 0b1111100100101;
  for (let i = 17; i >= 12; i--) {
    if ((rem >> i) & 1) rem ^= poly << (i - 12);
  }
  const bits = (ver << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const bit = (bits >> i) & 1;
    const a = Math.floor(i / 3);
    const b = size - 11 + (i % 3);
    reserved[a][b] = true;
    mod[a][b] = bit;
    reserved[b][a] = true;
    mod[b][a] = bit;
  }
}

/** Generate a boolean 2D QR Code matrix (EC Level L) for any text up to ~1,171 bytes. */
export function generateQrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const spec = chooseSpec(bytes.length);
  if (!spec) return null;

  const ver = spec[0];
  const size = ver * 4 + 17;
  const dataCodewords = encodeDataCodewords(bytes, spec);
  const finalBytes = interleaveBlocks(dataCodewords, spec);

  const mod = Array.from({ length: size }, () => new Uint8Array(size));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  placeFinderPattern(mod, reserved, 0, 0, size);
  placeFinderPattern(mod, reserved, 0, size - 7, size);
  placeFinderPattern(mod, reserved, size - 7, 0, size);

  const centers = ALIGN_POS[ver] || [];
  for (const rc of centers) {
    for (const cc of centers) {
      if (reserved[rc][cc]) continue;
      placeAlignmentPattern(mod, reserved, rc, cc);
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    const bit = i % 2 === 0 ? 1 : 0;
    reserved[6][i] = true;
    mod[6][i] = bit;
    reserved[i][6] = true;
    mod[i][6] = bit;
  }

  // Dark module & reserve format areas
  mod[size - 8][8] = 1;
  reserved[size - 8][8] = true;
  for (let i = 0; i < 9; i++) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  for (let i = size - 8; i < size; i++) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  writeVersionInfo(mod, reserved, ver, size);

  // Place data bits in zig-zag columns
  const bitStream = [];
  for (const b of finalBytes) {
    for (let i = 7; i >= 0; i--) bitStream.push((b >> i) & 1);
  }
  let bitIdx = 0;
  let up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let step = 0; step < size; step++) {
      const r = up ? size - 1 - step : step;
      for (const dc of [0, -1]) {
        const c = col + dc;
        if (!reserved[r][c]) {
          mod[r][c] = bitIdx < bitStream.length ? bitStream[bitIdx++] : 0;
        }
      }
    }
    up = !up;
  }

  // Evaluate mask 0 and mask 2 cleanly (fast & minimal penalty for high-density QR)
  let bestMask = 0;
  let bestPenalty = Infinity;
  for (const maskIdx of [0, 1, 2, 3]) {
    let darkCount = 0;
    let sameRuns = 0;
    for (let r = 0; r < size; r++) {
      let runLen = 1;
      for (let c = 0; c < size; c++) {
        const v = reserved[r][c] ? mod[r][c] : mod[r][c] ^ (applyMaskPattern(maskIdx, r, c) ? 1 : 0);
        if (v) darkCount += 1;
        if (c > 0) {
          const prev = reserved[r][c - 1]
            ? mod[r][c - 1]
            : mod[r][c - 1] ^ (applyMaskPattern(maskIdx, r, c - 1) ? 1 : 0);
          if (v === prev) runLen += 1;
          else {
            if (runLen >= 5) sameRuns += runLen - 2;
            runLen = 1;
          }
        }
      }
    }
    const pctDiff = Math.abs((darkCount * 100) / (size * size) - 50) * 2;
    const pen = sameRuns + pctDiff;
    if (pen < bestPenalty) {
      bestPenalty = pen;
      bestMask = maskIdx;
    }
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved[r][c] && applyMaskPattern(bestMask, r, c)) {
        mod[r][c] ^= 1;
      }
    }
  }
  writeFormatInfo(mod, size, bestMask);

  return {
    version: ver,
    size,
    modules: mod.map(row => Array.from(row, v => v === 1)),
  };
}

/** Render a crisp scannable SVG string for any QR payload (returns '' if > capacity). */
export function generateQrSvg(text, { pixelSize = 220, quietZone = 3 } = {}) {
  const qr = generateQrMatrix(text);
  if (!qr) return '';
  const total = qr.size + quietZone * 2;
  let d = '';
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.modules[r][c]) {
        d += `M${c + quietZone},${r + quietZone}h1v1h-1z`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${pixelSize}" height="${pixelSize}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><path d="${d}" fill="#111111"/></svg>`;
}
