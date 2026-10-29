// Node: writes reference PNG frames so a port can be checked pixel-for-pixel.
//   node dump-frames.js [outDir]
// Every frame below is fully determined by its state; a correct port must reproduce them exactly.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const S = require('./storm-heatmap.js');
const out = process.argv[2] || 'reference-frames';
fs.mkdirSync(out, { recursive: true });

function png(w, h, rgba) {
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c; }
  const crc = b => { let c = -1; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = rgba[i]; raw[o + 1] = rgba[i + 1]; raw[o + 2] = rgba[i + 2]; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const r = S.create({ width: 256, height: 162, cellSize: 1.7 });
const frames = [];
const names = ['thunderstorm', 'supercell', 'squall-line', 'hurricane', 'blizzard', 'dust-storm'];
for (let i = 0; i < 6; i++) frames.push([`${names[i]}_seed7_time2.2_life0.50`, { type: i, seed: 7, time: 2.2, life: 0.5 }]);
for (const p of [0.1, 0.3, 0.6, 0.68, 0.9]) frames.push([`hurricane_seed7_life${p.toFixed(2)}`, { type: 3, seed: 7, time: 2.2 + p * S.LIFE_SECONDS * 0.35, life: p }]);
for (const e of [0.1, 0.4, 0.8, 1.2, 1.7]) frames.push([`hurricane_anomaly_t${e.toFixed(2)}`, { type: 3, seed: 7, time: 2.2, life: 0.5, anomaly: { elapsed: e, epicenter: [0.7, 0.48] } }]);
frames.push(['thunderstorm_anomaly_t0.40', { type: 0, seed: 7, time: 2.2, life: 0.5, anomaly: { elapsed: 0.4, epicenter: [0.66, 0.5] } }]);
const manifest = [];
for (const [name, state] of frames) {
  r.render(state);
  const file = path.join(out, name + '.png');
  fs.writeFileSync(file, png(r.width, r.height, r.rgba));
  // checksum of palette indexes, so a port can verify without image diffing
  let sum = 0; for (let i = 0; i < r.cellIndex.length; i++) sum = (sum * 31 + r.cellIndex[i]) >>> 0;
  manifest.push({ file: name + '.png', state, cellIndexChecksum: sum });
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('wrote', frames.length, 'frames to', out);
