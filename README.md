# Storm Atlas heat-map renderer — developer handover

This package is the pixel heat-map animation extracted from the Storm Atlas prototype, as a single
dependency-free JavaScript module plus reference frames. Everything the prototype page did on screen
(six storm types, the 2.5-minute lifecycle, the camera, the shockwave anomaly) is reproduced by
`storm-heatmap.js`. The page's UI (sliders, buttons, CRT overlay) is **not** included; that is the
host app's job.

## Files

| File | What it is |
|---|---|
| `storm-heatmap.js` | The renderer. UMD: `require()` it in Node or load it with a `<script>` tag (global `StormHeatmap`). No dependencies. |
| `demo.html` | The drop-in in use: a div, `mount()`, a song-length field, Restart, and a TXT button that fires the anomaly. Open it in a browser next to the JS file. |
| `dump-frames.js` | Node script that writes the reference frames. `node dump-frames.js out-dir` |
| `reference-frames/` | 17 PNGs + `manifest.json` (the exact state that produced each one, and a checksum of its palette indexes). A port is correct when it reproduces these pixel-for-pixel. |

## Drop it in a div, with the song's length

```html
<div id="storm"></div>
<script src="storm-heatmap.js"></script>
<script>
  const storm = StormHeatmap.mount('#storm', { type: 3, duration: 187 });   // duration = song length in seconds
  txtButton.onclick = () => storm.anomaly();                               // one shockwave per press
  // when the next song starts:
  storm.setType(4).setDuration(212).restart();
</script>
```

`mount(elementOrSelector, options)` creates a 256 × 162 canvas inside the element (it fills the
element's width, pixelated) and runs everything: the lifecycle, the camera, the hurricane track, the
anomaly timing and the frame jolt.

**Duration is the only thing to configure per song.** The storm's life (Calm → Organizing → Peak →
Collapse → Second surge → Weakening → Remnants) is shaped in proportions, so any duration keeps the
same acts: the peak lands at 50–58% of the song, the second surge at 64–72%. The clock is real
elapsed time, so the storm ends when the song does. When it ends it holds the last frame and calls
`onEnd` (set `loop: true` instead to roll into the next storm type).

Options: `type` (0–5, default 3 Hurricane), `duration` (seconds, default 150), `loop` (default false),
`onFrame(p, phase, type, seconds)`, `onEnd(type)`, `seed`, `cellSize` (1.7), `fps` (15), `autoplay` (true).

Returned controls: `start()`, `stop()`, `restart()`, `anomaly()`, `setType(i)`, `setDuration(sec)`,
`getDuration()`, `setLife(p)` / `seek(sec)` (jump to a point in the life, e.g. to resync with the
audio), `destroy()`, plus `canvas` and `renderer`.

Use `create()` + `render()` directly (below) only if you need the raw pixels, your own clock, or a
non-canvas target. There, `life` is the same 0..1 proportion; `duration` is whatever you divide by.

## The one-paragraph version

Every frame is a pure function of a small **state**: storm type, texture seed, clock time, lifecycle
position, and (optionally) an anomaly. The renderer evaluates a procedural intensity field (0..1)
on a grid of cells, snaps each cell to one of **8 flat palette colors** by fixed thresholds, and
blits the cells to the output frame as hard-edged pixels. No blending, no randomness outside the
integer hash, no hidden state at all.
Same state in, same pixels out, in any engine.

## Frame format

- Output frame: **256 × 162** RGBA (`rgba`, `Uint8ClampedArray`, row-major, 4 bytes/pixel, alpha always 255).
- Cell grid: **151 × 95** cells (`cellSize: 1.7` frame px per cell, nearest-neighbour blit). Also exposed as
  `cells` (RGB bytes per cell) and `cellIndex` (palette index 0..7 per cell) for engines that prefer to
  draw the grid themselves or map colors their own way.
- Different sizes: `create({ width, height, cellSize })`. Patterns are designed on a 4:3 field and
  centered in whatever aspect you give.

## Palette (exact, in band order cold → hot)

| index | hex | role |
|---|---|---|
| 0 | `#1C59ED` | open sky / coldest |
| 1 | `#58ACFF` | |
| 2 | `#58D8DF` | |
| 3 | `#82EE7F` | |
| 4 | `#FBF488` | |
| 5 | `#FFB973` | |
| 6 | `#FF6777` | |
| 7 | `#FF9FBA` | hottest core |

Intensity thresholds between bands: `0.10, 0.22, 0.34, 0.46, 0.58, 0.70, 0.84` (`CUTS`). A cell with
intensity `I` gets band `k` = number of thresholds below `I`.

## State (what you pass to `render`)

```js
r.render({
  type: 3,            // 0 Thunderstorm, 1 Supercell, 2 Squall line, 3 Hurricane, 4 Blizzard, 5 Dust storm
  seed: 7,            // integer; picks the cloud texture. Change it between storms.
  time: 2.2,          // the clouds' clock, seconds. Advance it every frame (see Timing).
  life: 0.5,          // 0..1 position in the 2.5-minute lifecycle. Drives intensity, zoom, hurricane track.
  // optional overrides:
  intensity: 0.8,     // 0..1, replaces lifeCurve(life)
  zoom: 1.45,         // replaces lifeZoom(life)
  pan: [0, 0],        // replaces the slow handheld drift
  anomaly: {          // omit or null when none is running
    elapsed: 0.4,                // seconds since the trigger; the burst is over at 2.0
    epicenter: [0.7, 0.48]       // pattern-space point of the eruption; pick inside ~[0.52..0.82] × [0.4..0.6]
  }
});
```

## Timing (to match the prototype exactly)

- **15 fps**: one frame every 66 ms, `FRAME_DT = 0.066`.
- **Lifecycle**: `life` = elapsed seconds / duration (the song length; `LIFE_SECONDS = 150` is only the
  default). At `life >= 1` the storm is over: hold, or go to the next type with a new seed.
- **Clock**: `time = timeBase + life * 150 * 0.35` while a lifecycle runs (the clouds evolve at 35% of
  wall-clock; faster looks frantic over 2.5 minutes). `timeBase` is whatever `time` was when the
  storm started, so the clock never jumps.
- **Anomaly**: `ANOMALY_SECONDS = 2`. Starts only on an explicit trigger; one trigger = one burst;
  ignore triggers while one is running. Pass `elapsed` = seconds since the trigger each frame, and
  stop passing the anomaly once `elapsed >= 2`.
- **Frame shake** (optional, the prototype applies it as a CSS transform on the whole frame):
  `r.shake(anomaly)` returns an `[x, y]` pixel offset for this frame: one sharp jolt at the trigger,
  gone in ~0.3 s.

## Lifecycle acts (`lifeCurve`, `phaseName`, `lifeZoom`)

| life | phase | what happens |
|---|---|---|
| 0.00–0.06 | Calm | near-empty sky, artifacts only |
| 0.06–0.20 | First cells | intensity rising |
| 0.20–0.40 | Organizing | rising, with slow ~7-cycle breathing pulses; camera zooms in |
| 0.40–0.50 | Intensifying | |
| 0.50–0.58 | Peak | intensity 1.0, zoom 1.8 |
| 0.58–0.64 | Collapse | sharp dip to ~0.7 (eyewall-replacement style) |
| 0.64–0.72 | Second surge | back to 1.0 |
| 0.72–0.88 | Weakening | falling; camera eases out |
| 0.88–1.00 | Remnants | to 0 |

The hurricane also translates along a quadratic Bézier track over its life (`hurricaneTrack`):
west-northwest while forming, recurving north-east while dissipating. Other storms stay put.

## The anomaly (shockwave)

A convective eruption. On the trigger, a hot cell (bands 6–7) erupts at `epicenter`; a bright ring
expands from it to a radius of ~0.55 of the field over the 2 seconds; the air behind the ring is
scoured darker; faint static rides on the whole burst. Strength `a` is 1 at the trigger and fades
to 0 by 2 s (`a = min(1, (2 - elapsed) / 2 * 1.6)`), the ring radius is `(1 - a) * 0.55`. The frame
shake is a single jolt that is gone in ~0.3 s. Nothing carries over between frames.

## Porting to another engine

If you reimplement rather than embed the JS:

1. Port `hash`, `vnoise`, `fbm`, `sstep`, `lerp`, `clamp01`, `gauss` exactly. `hash` uses 32-bit
   integer multiplies (`Math.imul`) and unsigned shifts; it must match bit-for-bit or every texture
   changes. Use 64-bit floats elsewhere.
2. Port the six `TYPES[i].fn` intensity functions and `skyArtifacts` + the `ART` table verbatim.
3. Port the `render` loop: camera mapping (zoom toward `(2/3, 0.5)`, pan, aspect centering),
   artifacts, anomaly terms, then `bandAt`.
4. Validate against `reference-frames/`: render each `manifest.json` state and compare either the PNG
   or the `cellIndexChecksum` (`sum = (sum*31 + band) mod 2^32` over `cellIndex` in row-major order).

Performance: ~20 ms per 151×95 frame in V8 on a laptop (most of it in `fbm`). A GPU port can put
all the per-cell work in a fragment shader; every cell is independent of every other.

## Things the prototype does that are NOT in this module

- The CRT look (scanlines, phosphor glow, vignette) is a CSS overlay on the page, not in the pixels.
- UI: intensity/timelapse sliders, type tiles, Animate/Play/Anomaly buttons.
- The frame shake is returned as numbers; applying it to the drawn frame is up to the host.
