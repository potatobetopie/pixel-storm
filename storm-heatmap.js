/*
 * storm-heatmap.js — Storm Atlas pixel heat-map renderer (handover build)
 *
 * Pure, deterministic frame generator. No DOM, no timers, no frame-to-frame state. Give it a state, it fills a buffer.
 * Same (state) => same pixels, every time, in every engine. See README.md.
 *
 * Usage (browser or Node):
 *   const r = StormHeatmap.create({ width: 256, height: 162, cellSize: 1.7 });
 *   r.render(state);               // state: see README "State"
 *   r.rgba                         // Uint8ClampedArray, width*height*4, ready for an ImageData / texture
 *   r.cells, r.gridW, r.gridH      // the cell grid (one entry per heat-map pixel) as RGB bytes
 *   r.cellIndex                    // Uint8Array of palette indexes 0..7 per cell (for engines that want to map colors themselves)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StormHeatmap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// ---------------------------------------------------------------------------------------------
// 1. Noise and math helpers (deterministic; the integer hash is the only source of randomness)
// ---------------------------------------------------------------------------------------------
function hash(x, y, s) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x, y, s) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 4; i++) { v += amp * vnoise(x * f, y * f, s + i * 17); amp *= 0.5; f *= 2.03; }
  return v / 0.9375;
}
function sstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(v) { return Math.min(1, Math.max(0, v)); }
function gauss(d, w) { return Math.exp(-(d * d) / (w * w)); }

// ---------------------------------------------------------------------------------------------
// 2. The six storm patterns. Each returns intensity 0..1 for a point in pattern space
//    (ux spans 0..4/3 across a 4:3 field, uy spans 0..1), at intensity t (0..1), texture seed, and clock time.
// ---------------------------------------------------------------------------------------------
// Every pattern takes (ux 0..1.33, uy 0..1, t 0..1 intensity, seed, time) and returns 0..1.
const TYPES = [
  {
    name: 'Thunderstorm', stages: ['Shower', 'Developing', 'Mature', 'Severe', 'Extreme'],
    desc: 'A single convective cell: a warm updraft builds a towering cumulonimbus, then collapses in a burst of rain and downdraft. The most common storm on Earth, with roughly 40,000 a day.',
    wind: '30–60 mph gusts', size: '5–15 mi across', life: '30–60 min', hours: 1,
    fn(ux, uy, t, seed, time) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 0.9);
      const cx = 0.66 + 0.04 * Math.sin(time * 0.3), cy = 0.5;
      const R = lerp(0.14, 0.34, t) * (0.92 + 0.08 * pulse);
      const n = fbm(ux * 6 + time * 0.2, uy * 6, seed);
      const d = Math.hypot(ux - cx, uy - cy) * (1 + 0.5 * (n - 0.5));
      let I = gauss(d, R) * lerp(0.55, 1.05, t);
      const anvil = gauss((uy - cy + 0.1), 0.12) * sstep(cx - 0.1, cx + 0.5, ux) * (1 - sstep(cx + 0.3, cx + 0.7, ux));
      I += 0.3 * t * anvil * fbm(ux * 5 + 3, uy * 5, seed + 2);
      return clamp01(I);
    }
  },
  {
    name: 'Supercell', stages: ['Weak', 'Rotating', 'Wall cloud', 'Tornado warned', 'Violent'],
    desc: 'A rotating thunderstorm with a persistent mesocyclone. On radar it wraps rain around the updraft into a hook echo, the signature that precedes most strong tornadoes.',
    wind: '60–100+ mph', size: '10–25 mi across', life: '2–6 hours', hours: 5,
    fn(ux, uy, t, seed, time) {
      const cx = 0.74, cy = 0.44;
      const dx = ux - cx, dy = uy - cy;
      const r = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
      const body = gauss(r, lerp(0.24, 0.38, t)) * (0.6 + 0.4 * sstep(-0.3, 0.3, dx + dy * 0.5)) * 1.2;
      // hook: a short tight spiral on the lower-left of the core
      const k = lerp(2.5, 5, t), rot = time * 0.5;
      const ang = th + k * Math.log(r + 0.02) - rot;
      const arm = Math.pow(0.5 + 0.5 * Math.cos(ang), 3) * gauss(r - lerp(0.1, 0.16, t), 0.07) * sstep(0.5, 1.2, Math.PI / 2 - th);
      const n = fbm(ux * 7 + time * 0.15, uy * 7, seed);
      let I = body * lerp(0.5, 0.95, t) + arm * lerp(0.4, 1.1, t) + 0.25 * (n - 0.5) * body;
      I += sstep(0.6, 1, t) * gauss(Math.hypot(dx - 0.08, dy + 0.06), 0.04) * 0.7; // tight core
      return clamp01(I);
    }
  },
  {
    name: 'Squall line', stages: ['Showers', 'Organizing', 'Line', 'Bow echo', 'Derecho'],
    desc: 'A band of thunderstorms hundreds of miles long along a cold front. When the line bows forward it is a derecho, the straight-line wind event that fells trees across whole states.',
    wind: '58–100 mph straight-line', size: '100–500 mi long', life: '6–12+ hours', hours: 12,
    fn(ux, uy, t, seed, time) {
      const bow = lerp(0.02, 0.22, t);
      const x0 = 0.72 + 0.03 * Math.sin(time * 0.3) - bow * Math.sin((uy - 0.5) * Math.PI) * (uy > 0.1 && uy < 0.9 ? 1 : 0) - bow * (1 - Math.cos((uy - 0.5) * Math.PI));
      const d = ux - x0;
      const edge = gauss(d, lerp(0.09, 0.07, t)) * lerp(0.75, 1.1, t);      // leading edge
      const trail = sstep(-0.08, 0.02, d) * sstep(0.55, 0.05, d) * 0.75 * (1 - t * 0.25); // stratiform rain behind
      const n = fbm(ux * 5 + time * 0.2, uy * 10, seed);
      let I = edge * (0.8 + 0.4 * (n - 0.5)) + trail * fbm(ux * 4, uy * 4 + 7, seed + 3) * 1.4;
      I *= sstep(0.0, 0.12, uy) * sstep(1.0, 0.88, uy);
      return clamp01(I);
    }
  },
  {
    name: 'Hurricane', stages: ['Disturbance', 'Depression', 'Tropical storm', 'Hurricane', 'Major'],
    desc: 'A tropical cyclone: warm ocean water drives a spiral of rainbands around a calm, clear eye. Named a hurricane in the Atlantic and east Pacific, a typhoon in the west Pacific.',
    wind: '74–157+ mph sustained', size: '200–600 mi across', life: 'Days to 2 weeks', hours: 216,
    fn(ux, uy, t, seed, time) {
      const cx = 0.62, cy = 0.5, rot = time * 0.25;
      const dx = ux - cx, dy = uy - cy;
      const r = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
      const s = sstep(0.1, 0.9, t);
      const k = lerp(1.8, 3.0, s);                       // spiral tightness
      const Rc = lerp(0.1, 0.28, s);                     // dense red central overcast
      const Rout = lerp(0.5, 0.72, s);                   // reach of the rainbands
      const eyeR = lerp(0.012, 0.022, s), eyeS = sstep(0.5, 0.85, t);
      const ang = th + k * Math.log(r + 0.015) - rot;
      // cloud texture: domain-warped, stretched along the flow so streaks curl with the storm
      const wx = fbm(ux * 4 + 3, uy * 4 + time * 0.04, seed + 9) - 0.5;
      const wy = fbm(ux * 4 + 17, uy * 4 - time * 0.04, seed + 13) - 0.5;
      const tex = fbm(r * 18 + wx * 1.4, ang * 2.4 + wy * 1.4, seed);
      const clump = fbm(ux * 7 + wx * 2, uy * 7 + wy * 2 + 5, seed + 3);
      // the big mottled core: flat-topped so it reads as one red mass, ragged at the edge
      const edge = r + 0.07 * (tex - 0.5) + 0.05 * (clump - 0.5) + 0.03 * Math.cos(2 * ang);
      const core = 1 - sstep(Rc * 0.85, Rc * 1.15, edge);
      // one dominant arm plus a weaker trailing one, feathering out from the core
      const arm = (Math.pow(0.5 + 0.5 * Math.cos(ang), lerp(2.0, 2.8, s)) + 0.45 * Math.pow(0.5 + 0.5 * Math.cos(ang + Math.PI), 4)) * (0.6 + 0.8 * tex) * (0.7 + 0.6 * clump);
      const halo = Math.exp(-Math.pow(Math.max(0, r - Rc) / (Rout - Rc), 1.4));
      // scattered convective clusters speckling the ocean around the storm
      const speck = sstep(0.52, 0.66, clump) * Math.exp(-Math.pow(r / (Rout * 1.35), 2)) * 0.4;
      const grain = 0.06 * (fbm(ux * 12, uy * 12 + 50, seed + 21) - 0.5);
      const swirl = 0.5 + 0.5 * Math.cos(3 * ang + r * 10);                      // curved banding spiralling into the eye
      let I = core * (lerp(0.62, 0.72, s) + 0.24 * (tex - 0.5) + 0.1 * (clump - 0.5) + 0.1 * (swirl - 0.5));
      I += (1 - core) * (halo * (lerp(0.02, 0.05, s) + lerp(0.42, 0.6, s) * arm) + 0.1 * (tex - 0.5) * halo + 0.18 * (clump - 0.5) * halo + speck);
      I += eyeS * core * Math.exp(-Math.pow((r - eyeR - 0.03) / 0.025, 2)) * (0.1 + 0.2 * tex);   // ragged hot eyewall
      I = lerp(I, 0.04, eyeS * sstep(eyeR + 0.01, eyeR - 0.006, r));             // tiny dark eye
      I += grain;
      return clamp01(I);
    }
  },
  {
    name: 'Blizzard', stages: ['Flurries', 'Snow', 'Heavy snow', 'Blizzard', 'Bomb cyclone'],
    desc: 'A winter cyclone, often a nor\'easter: a huge comma of cloud spins around a low pressure center, with the heaviest snow stacked on its cold northwest side.',
    wind: '35+ mph for 3+ hours', size: '500–1,000 mi across', life: '1–3 days', hours: 60,
    fn(ux, uy, t, seed, time) {
      const cx = 0.78, cy = 0.5, rot = time * 0.15;
      const dx = ux - cx, dy = uy - cy;
      const r = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
      const k = lerp(0.8, 1.6, t);
      const ang = th + k * Math.log(r + 0.05) - rot;
      // comma head: broad band on one side; tail: long front trailing down-left
      const head = Math.pow(0.5 + 0.5 * Math.cos(ang), lerp(1.4, 2.2, t)) * Math.exp(-Math.pow(r / lerp(0.45, 0.6, t), 2));
      const tx = cx - 0.15 - (uy - cy) * 0.9, tail = gauss(ux - tx, 0.08) * sstep(cy - 0.05, cy + 0.25, uy) * sstep(1.05, 0.7, uy);
      const n = fbm(ux * 5 + time * 0.1, uy * 5, seed);
      let I = head * lerp(0.55, 1.0, t) + tail * lerp(0.3, 0.6, t) + 0.3 * (n - 0.5) * (head + tail);
      I += sstep(0.5, 1, t) * gauss(r - 0.12, 0.05) * Math.pow(0.5 + 0.5 * Math.cos(ang + 0.8), 2) * 0.5; // tight wrap near the low
      return clamp01(I);
    }
  },
  {
    name: 'Dust storm', stages: ['Haze', 'Blowing dust', 'Dust wall', 'Haboob', 'Whiteout'],
    desc: 'A haboob: the cold outflow from a collapsing thunderstorm rushes across dry ground and lofts a wall of dust a mile high. Common in deserts from Arizona to the Sahel.',
    wind: '30–60 mph outflow', size: '50–100 mi wide front', life: '1–3 hours', hours: 3,
    fn(ux, uy, t, seed, time) {
      const front = 0.55 + 0.04 * Math.sin(time * 0.25);
      const arc = front + lerp(0.02, 0.12, t) * Math.cos((uy - 0.5) * Math.PI);  // bulging arc of the gust front
      const d = ux - arc;
      const wall = sstep(-0.06, 0.0, d) * sstep(0.02, 0.0, d) * lerp(0.6, 1.0, t);
      const behind = sstep(0.0, 0.1, d) * (1 - sstep(0.1, 0.8, d) * 0.7) * lerp(0.3, 0.6, t);
      const n = fbm(ux * 6 - time * 0.3, uy * 8, seed);
      const lobes = 0.6 + 0.4 * Math.sin(uy * 22 + time * 0.6);
      let I = wall * (0.7 + 0.3 * lobes) + behind * (0.6 + 0.8 * (n - 0.5)) + 0.08 * t;
      I *= sstep(0.0, 0.1, uy) * sstep(1.0, 0.9, uy);
      return clamp01(I);
    }
  }
];

// ---------------------------------------------------------------------------------------------
// 3. Palette: 8 flat colors, intensity thresholds between bands. No blending anywhere.
// ---------------------------------------------------------------------------------------------
// Exact 8-color palette, no blending: 1C59ED, 58ACFF, 58D8DF, 82EE7F, FBF488, FFB973, FF6777, FF9FBA
const PAL = [[28, 89, 237], [88, 172, 255], [88, 216, 223], [130, 238, 127], [251, 244, 136], [255, 185, 115], [255, 103, 119], [255, 159, 186]];
const CUTS = [0.1, 0.22, 0.34, 0.46, 0.58, 0.7, 0.84]; // intensity thresholds between bands
function colorAt(I) {
  let k = 0;
  while (k < CUTS.length && I > CUTS[k]) k++;
  return PAL[k];
}

function bandAt(I) {
  let k = 0;
  while (k < CUTS.length && I > CUTS[k]) k++;
  return k;
}

// ---------------------------------------------------------------------------------------------
// 4. Per-storm sky artifacts in the open-blue areas (the hurricane draws its own, so ART[3] is null)
// ---------------------------------------------------------------------------------------------
// Scattered cloud debris, streaks and grain in the open-sky (blue) areas, styled per storm.
const ART = [
  { seed: 100, speck: [0.56, 0.34], specks: 8,  wisp: 0.06, wx: 4,  wy: 4,  ang: 0.0,  drift: [0.02, 0.0],   grain: 0.04, gf: 10 }, // thunderstorm: popcorn cumulus
  { seed: 200, speck: [0.64, 0.18], specks: 6,  wisp: 0.22, wx: 2,  wy: 18, ang: 0.6,  drift: [0.12, -0.04], grain: 0.04, gf: 12 }, // supercell: anvil cirrus streaming downwind
  { seed: 300, speck: [0.6, 0.2],  specks: 7,  wisp: 0.24, wx: 2,  wy: 22, ang: 0.0,  drift: [0.25, 0.0],   grain: 0.05, gf: 12 }, // squall line: wind-torn horizontal streaks
  null,                                                                                                                              // hurricane: has its own
  { seed: 500, speck: [0.6, 0.14], specks: 9,  wisp: 0.16, wx: 3,  wy: 10, ang: -0.9, drift: [0.03, 0.06],  grain: 0.09, gf: 18 }, // blizzard: fine snow grain, curling bands
  { seed: 600, speck: [0.52, 0.22], specks: 5, wisp: 0.1,  wx: 6,  wy: 6,  ang: 0.0,  drift: [-0.15, 0.0],  grain: 0.11, gf: 24 }  // dust storm: gritty haze blowing back
];
function skyArtifacts(typeIndex, ux, uy, I, seed, time) {
  const A = ART[typeIndex];
  if (!A) return 0;
  const open = 1 - sstep(0.14, 0.34, I);                 // only where the map is cold
  if (open <= 0) return 0;
  const sd = seed + A.seed;
  const px = ux + A.drift[0] * time * 0.1, py = uy + A.drift[1] * time * 0.1;
  const c = Math.cos(A.ang), sn = Math.sin(A.ang);
  const rx = px * c - py * sn, ry = px * sn + py * c;    // rotate so streaks run along the storm's wind
  const clump = fbm(px * A.specks, py * A.specks + 5, sd + 3);
  const streak = fbm(rx * A.wx, ry * A.wy, sd + 7);
  const speck = sstep(A.speck[0], A.speck[0] + 0.14, clump) * A.speck[1];
  const wisp = sstep(0.58, 0.78, streak) * A.wisp;
  const grain = A.grain * (fbm(ux * A.gf, uy * A.gf + 50, sd + 21) - 0.5);
  return open * (speck + wisp + 0.12 * (clump - 0.5)) + grain;
}
// Hurricane track over its life: a real one is steered west-northwest by the trade winds, then

// ---------------------------------------------------------------------------------------------
// 5. Lifecycle (2.5-minute sequence), camera zoom over the life, hurricane track
// ---------------------------------------------------------------------------------------------
const LIFE_SECONDS = 150;
// Eight acts over the life: calm sky, first cells, organizing with pulses, intensifying, peak with flare-ups,
// a collapse-and-rebuild cycle (second surge), weakening, remnants. Intensity never sits still for long.
function lifeCurve(p) {
  const rise = sstep(0.06, 0.4, p), fall = 1 - sstep(0.72, 0.97, p);
  const env = rise * fall;
  const pulse = 0.5 + 0.5 * Math.cos(p * Math.PI * 2 * 7);                 // slow breathing, ~7 cycles over the life
  const pulseAmt = 0.16 * sstep(0.12, 0.3, p) * (1 - sstep(0.55, 0.7, p));
  const dip = 0.22 * Math.exp(-Math.pow((p - 0.6) / 0.03, 2));            // eyewall-replacement style collapse
  const surge = 0.1 * Math.exp(-Math.pow((p - 0.68) / 0.035, 2));         // then rebuilds stronger for a moment
  return clamp01(env * (1 - pulseAmt * pulse) - dip + surge);
}
function phaseName(p) {
  return p < 0.06 ? 'Calm' : p < 0.2 ? 'First cells' : p < 0.4 ? 'Organizing' : p < 0.5 ? 'Intensifying'
    : p < 0.58 ? 'Peak' : p < 0.64 ? 'Collapse' : p < 0.72 ? 'Second surge' : p < 0.88 ? 'Weakening' : 'Remnants';
}
// Camera over the life: pulls in as the storm organizes, holds tight at peak, eases back as it dies.
function lifeZoom(p) { return 1.25 + 0.55 * sstep(0.2, 0.5, p) - 0.4 * sstep(0.75, 1, p); }
// recurves north and northeast once it reaches the mid-latitudes. Quadratic bezier through those points.
function hurricaneTrack(p) {
  const P0 = [0.3, 0.14], P1 = [-0.28, 0.02], P2 = [0.1, -0.22];
  const u = 1 - p;
  return [u * u * P0[0] + 2 * u * p * P1[0] + p * p * P2[0], u * u * P0[1] + 2 * u * p * P1[1] + p * p * P2[1]];
}
// Anomaly: a 2-second burst, in one of three styles.

// ---------------------------------------------------------------------------------------------
// 6. Renderer
// ---------------------------------------------------------------------------------------------
const ANOMALY_SECONDS = 2;
const ZCX = 2 / 3, ZCY = 0.5;            // camera zooms toward the middle of the 4:3 pattern field

function create(opts) {
  opts = opts || {};
  const width = opts.width || 256, height = opts.height || 162;
  const cellSize = opts.cellSize || 1.7;                 // frame pixels per heat-map cell (1.7 => 151 x 95 cells at 256 x 162)
  const gridW = Math.max(1, Math.round(width / cellSize)), gridH = Math.max(1, Math.round(height / cellSize));
  const aspect = gridW / gridH, xoff = (aspect - 4 / 3) / 2;
  const cells = new Uint8Array(gridW * gridH * 3);
  const cellIndex = new Uint8Array(gridW * gridH);
  const rgba = new Uint8ClampedArray(width * height * 4);
  // cell -> frame pixel map (nearest neighbour), precomputed once
  const colOf = new Int32Array(width), rowOf = new Int32Array(height);
  for (let x = 0; x < width; x++) colOf[x] = Math.min(gridW - 1, Math.floor(x / width * gridW));
  for (let y = 0; y < height; y++) rowOf[y] = Math.min(gridH - 1, Math.floor(y / height * gridH));

  function render(st) {
    const typeIndex = st.type | 0;
    const T = TYPES[typeIndex];
    const seed = st.seed | 0, time = +st.time || 0;
    const p = st.life == null ? null : clamp01(st.life);
    let t = st.intensity != null ? clamp01(st.intensity) : (p == null ? 0.6 : lifeCurve(p));
    const zoom = st.zoom != null ? st.zoom : (p == null ? 1.45 : lifeZoom(p));
    const [ox, oy] = typeIndex === 3 && p != null ? hurricaneTrack(p) : [0, 0];
    const panX = st.pan ? st.pan[0] : 0.02 * Math.sin(time * 0.11);
    const panY = st.pan ? st.pan[1] : 0.012 * Math.cos(time * 0.08);

    // anomaly (shockwave): { elapsed (seconds since the trigger), epicenter [ux, uy] }
    // a: strength, 1 at the trigger, fading to 0 by ANOMALY_SECONDS. age = 1 - a drives the ring outward.
    const an = st.anomaly;
    const elapsed = an ? +an.elapsed : Infinity;
    const a = an && elapsed < ANOMALY_SECONDS ? Math.min(1, (ANOMALY_SECONDS - elapsed) / ANOMALY_SECONDS * 1.6) : 0;
    const age = 1 - a;
    const glitchFrame = Math.floor(elapsed * 20);         // 20 steps per second; seeds the faint static in the burst
    const epi = an && an.epicenter ? an.epicenter : [ZCX, ZCY];
    const ringR = age * 0.55, ringW = 0.03 + 0.05 * age;

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const k = (gy * gridW + gx) * 3, kk = gy * gridW + gx;
        const ux = ZCX + ((gx + 0.5) / gridW * aspect - xoff - ZCX) / zoom + panX;
        const uy = ZCY + ((gy + 0.5) / gridH - ZCY) / zoom + panY;
        let I = T.fn(ux - ox / zoom, uy - oy / zoom, t, seed, time);
        if (typeIndex !== 3) I = clamp01(I + skyArtifacts(typeIndex, ux, uy, I, seed, time));
        if (a > 0) {
          // shockwave: a hot cell erupts at the epicenter, a bright ring races outward, the air behind it is scoured darker
          const dist = Math.hypot(ux - epi[0], (uy - epi[1]) * 1.1);
          const core = Math.exp(-Math.pow(dist / (0.05 + 0.08 * age), 2)) * Math.pow(a, 1.5) * 1.1;
          const ring = Math.exp(-Math.pow((dist - ringR) / ringW, 2)) * a * 0.55;
          const wake = dist < ringR ? -0.12 * a * (1 - dist / Math.max(ringR, 0.001)) : 0;
          I = clamp01(I + core + ring + wake + 0.08 * a * (hash(gx, gy, glitchFrame) - 0.5));
        }
        const b = bandAt(I), c = PAL[b];
        cellIndex[kk] = b;
        cells[k] = c[0]; cells[k + 1] = c[1]; cells[k + 2] = c[2];
      }
    }
    // blit to the output frame
    for (let y = 0; y < height; y++) {
      const rowBase = rowOf[y] * gridW;
      for (let x = 0; x < width; x++) {
        const k = (rowBase + colOf[x]) * 3, i = (y * width + x) * 4;
        rgba[i] = cells[k]; rgba[i + 1] = cells[k + 1]; rgba[i + 2] = cells[k + 2]; rgba[i + 3] = 255;
      }
    }
    return rgba;
  }

  // Frame shake offset in frame pixels (apply to the whole drawn frame; optional)
  function shake(an, rng) {
    if (!an) return [0, 0];
    const elapsed = +an.elapsed, remaining = ANOMALY_SECONDS - elapsed;
    if (!(remaining > 0)) return [0, 0];
    const r = rng || Math.random;
    const sh = 24 * Math.exp(-elapsed / 0.11) * Math.abs(Math.sin(elapsed * 50));   // one sharp jolt, gone in ~0.3 s
    return [(r() - 0.5) * sh, (r() - 0.5) * sh * 0.7];
  }

  return { width, height, gridW, gridH, cellSize, cells, cellIndex, rgba, render, shake };
}

// ---------------------------------------------------------------------------------------------
// 7. Drop-in: mount the animation inside any element. Browser only.
//    const storm = StormHeatmap.mount('#my-div', { type: 3, duration: 187 });   // duration = the song's length in seconds
//    storm.anomaly();                                     // one shockwave (ignored while one is running)
//    storm.setType(4); storm.setDuration(210); storm.restart(); storm.stop(); storm.start();
//    Options:
//      type      0 Thunderstorm, 1 Supercell, 2 Squall line, 3 Hurricane, 4 Blizzard, 5 Dust storm   (default 3)
//      duration  seconds for the whole storm life, calm -> peak -> remnants. Set it to the song length. (default 150)
//      loop      true: when a storm ends, start the next type. false: hold the last frame and call onEnd. (default false)
//      onEnd(type)       called once when the storm's life is over (loop: false)
//      onFrame(p, phase, type, seconds)   called every frame; p is 0..1 through the life
//      seed, cellSize (1.7), fps (15), autoplay (true)
//    The life curve is shaped in proportions, so any duration keeps the same acts: peak at 50-58%, second surge at 64-72%.
//    The canvas is 256 x 162 and fills the element's width (image-rendering: pixelated); style the element as you like.
// ---------------------------------------------------------------------------------------------
function mount(target, opts) {
  opts = opts || {};
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) throw new Error('StormHeatmap.mount: element not found');
  const r = create({ width: opts.width || 256, height: opts.height || 162, cellSize: opts.cellSize || 1.7 });
  const canvas = document.createElement('canvas');
  canvas.width = r.width; canvas.height = r.height;
  canvas.style.cssText = 'display:block;width:100%;height:auto;image-rendering:pixelated;image-rendering:crisp-edges;';
  el.appendChild(canvas);
  const ctx = canvas.getContext('2d'), img = new ImageData(r.rgba, r.width, r.height);
  const frameMs = 1000 / (opts.fps || 15);
  let type = opts.type == null ? 3 : opts.type | 0, seed = opts.seed == null ? 7 : opts.seed | 0;
  let duration = opts.duration > 0 ? +opts.duration : LIFE_SECONDS;
  let time = 2.2, timeBase = 2.2, life = 0, pressedAt = -Infinity, epicenter = null, raf = 0, last = 0, running = false, ended = false;
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (now - last < frameMs) return;
    last = now;
    if (!ended) life += (now - (lastTick || now)) / 1000;   // real elapsed time, so the life tracks the song's clock
    lastTick = now;
    if (life >= duration) {
      if (opts.loop) { life = 0; timeBase = time; seed = (seed * 31 + 11) % 997; type = (type + 1) % TYPES.length; }
      else if (!ended) { ended = true; life = duration; if (opts.onEnd) opts.onEnd(type); }
    }
    const p = Math.min(0.9999, life / duration);
    time = timeBase + p * duration * 0.35;
    const elapsed = now / 1000 - pressedAt;
    const an = elapsed < ANOMALY_SECONDS ? { elapsed, epicenter } : null;
    r.render({ type, seed, time, life: p, anomaly: an });
    ctx.putImageData(img, 0, 0);
    const sh = r.shake(an);
    canvas.style.transform = sh[0] || sh[1] ? 'translate(' + sh[0].toFixed(1) + 'px,' + sh[1].toFixed(1) + 'px)' : '';
    if (opts.onFrame) opts.onFrame(p, phaseName(p), type, life);
  }
  let lastTick = 0;
  function reset() { life = 0; ended = false; timeBase = time; lastTick = 0; }
  const api = {
    canvas, renderer: r,
    start() { if (!running) { running = true; last = 0; lastTick = 0; raf = requestAnimationFrame(frame); } return api; },
    stop() { running = false; cancelAnimationFrame(raf); return api; },
    restart() { reset(); return api.start(); },           // back to Calm, e.g. when the song starts
    setDuration(sec) { if (sec > 0) duration = +sec; return api; },
    getDuration() { return duration; },
    anomaly() {                                           // one press = one 2-second shockwave
      const now = performance.now() / 1000;
      if (now - pressedAt < ANOMALY_SECONDS) return false;
      pressedAt = now;
      epicenter = [ZCX + (Math.random() - 0.5) * 0.3, ZCY + (Math.random() - 0.5) * 0.2];
      return true;
    },
    setType(i) { type = ((i % TYPES.length) + TYPES.length) % TYPES.length; reset(); return api; },
    getType() { return type; },
    setLife(p) { life = Math.max(0, Math.min(0.9999, p)) * duration; ended = false; return api; },   // jump to a point, 0..1
    seek(sec) { return api.setLife(sec / duration); },                                               // jump to a time in seconds
    destroy() { api.stop(); canvas.remove(); }
  };
  return opts.autoplay === false ? api : api.start();
}
const FRAME_DT = 0.066;

return {
  create, mount, TYPES, PAL, CUTS, ART, bandAt, lifeCurve, lifeZoom, phaseName, hurricaneTrack,
  LIFE_SECONDS, ANOMALY_SECONDS, FRAME_DT
};
});
