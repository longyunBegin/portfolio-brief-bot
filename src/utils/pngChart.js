const zlib = require('zlib');

const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, pixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const rowLen = 1 + width * 4;
  const rawData = Buffer.alloc(height * rowLen);
  for (let y = 0; y < height; y++) {
    rawData[y * rowLen] = 0;
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = y * rowLen + 1 + x * 4;
      rawData[di] = pixels[si]; rawData[di + 1] = pixels[si + 1];
      rawData[di + 2] = pixels[si + 2]; rawData[di + 3] = pixels[si + 3];
    }
  }
  return Buffer.concat([sig, makeChunk('IHDR', ihdr), makeChunk('IDAT', zlib.deflateSync(rawData)), makeChunk('IEND', Buffer.alloc(0))]);
}

function createCanvas(w, h) { return { width: w, height: h, pixels: new Uint8Array(w * h * 4) }; }

function setPixel(c, x, y, r, g, b, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || x >= c.width || y < 0 || y >= c.height) return;
  const i = (y * c.width + x) * 4;
  const sa = a / 255, da = c.pixels[i + 3] / 255, oa = sa + da * (1 - sa);
  if (oa === 0) return;
  c.pixels[i] = Math.round((r * sa + c.pixels[i] * da * (1 - sa)) / oa);
  c.pixels[i + 1] = Math.round((g * sa + c.pixels[i + 1] * da * (1 - sa)) / oa);
  c.pixels[i + 2] = Math.round((b * sa + c.pixels[i + 2] * da * (1 - sa)) / oa);
  c.pixels[i + 3] = Math.round(oa * 255);
}

function drawLine(c, x1, y1, x2, y2, r, g, b, a) {
  x1 = Math.round(x1); y1 = Math.round(y1); x2 = Math.round(x2); y2 = Math.round(y2);
  const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
  let err = dx - dy, x = x1, y = y1;
  while (true) {
    setPixel(c, x, y, r, g, b, a); setPixel(c, x, y + 1, r, g, b, a);
    if (x === x2 && y === y2) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

function drawDashedH(c, y, r, g, b, a, x1, x2, dash, gap) {
  y = Math.round(y);
  let x = x1;
  while (x < x2) {
    const end = Math.min(x + dash, x2);
    for (let i = x; i < end; i++) setPixel(c, i, y, r, g, b, a);
    x += dash + gap;
  }
}

const FONT = {
  '0': ['01110','10001','10001','10001','10001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','11110','00001','00001','10001','01110'],
  '6': ['01110','10000','11110','10001','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00001','01110'],
  '.': ['00000','00000','00000','00000','00000','00100','00100'],
  ' ': ['00000','00000','00000','00000','00000','00000','00000'],
};

function drawText(c, text, x, y, r, g, b, a) {
  for (let i = 0; i < text.length; i++) {
    const glyph = FONT[text[i]] || FONT[' '];
    for (let row = 0; row < 7; row++)
      for (let col = 0; col < 5; col++)
        if (glyph[row][col] === '1') setPixel(c, x + i * 6 + col, y + row, r, g, b, a);
  }
}

function buildChartBase64(bars, prevClose, dayHigh, dayLow) {
  const prices = bars.map((b) => b.close);
  const min = Math.min(dayLow, Math.min.apply(null, prices));
  const max = Math.max(dayHigh, Math.max.apply(null, prices));
  const range = max - min || 1;
  const midLine = (dayHigh + dayLow) / 2;
  const n = bars.length;
  const W = 400, H = 80;
  const X0 = 8, X1 = 392, Y0 = 5, Y1 = 72;
  const chartW = X1 - X0, chartH = Y1 - Y0;
  const c = createCanvas(W, H);
  const isUp = bars[n - 1].close >= bars[0].close;
  const lc = isUp ? [52, 199, 89] : [255, 59, 48];
  const ac = isUp ? [232, 248, 237] : [252, 235, 235];
  const toX = (i) => X0 + (i / (n - 1)) * chartW;
  const toY = (p) => Y0 + (1 - (p - min) / range) * chartH;
  const yAt = (x) => {
    const t = (x - X0) / chartW * (n - 1);
    const i = Math.floor(t);
    if (i >= n - 1) return toY(bars[n - 1].close);
    const f = t - i;
    return toY(bars[i].close * (1 - f) + bars[i + 1].close * f);
  };
  for (let x = X0; x <= X1; x++) {
    const y = Math.round(yAt(x));
    for (let yy = y; yy <= Y1; yy++) setPixel(c, x, yy, ac[0], ac[1], ac[2], 200);
  }
  const highY = toY(dayHigh), lowY = toY(dayLow), midY = toY(midLine), prevY = toY(prevClose);
  drawDashedH(c, highY, 52, 199, 89, 220, X0, X1, 4, 3);
  drawDashedH(c, lowY, 255, 59, 48, 220, X0, X1, 4, 3);
  drawDashedH(c, midY, 134, 134, 139, 160, X0, X1, 2, 2);
  drawDashedH(c, prevY, 134, 134, 139, 190, X0, X1, 3, 2);
  for (let i = 0; i < n - 1; i++) drawLine(c, toX(i), toY(bars[i].close), toX(i + 1), toY(bars[i + 1].close), lc[0], lc[1], lc[2], 255);
  return encodePng(W, H, c.pixels).toString('base64');
}

module.exports = { buildChartBase64 };