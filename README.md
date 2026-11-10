# Storm Atlas heat-map renderer

The pixel storm animation from the Storm Atlas prototype, as one dependency-free JavaScript module.
Six storm types, the full lifecycle (calm → peak → remnants), and the shockwave anomaly.

## Files

| File | What it is |
|---|---|
| `storm-heatmap.js` | The renderer. Load with a `<script>` tag (global `StormHeatmap`) or `require()` in Node. No dependencies. |
| `demo.html` | Working example: a div, `mount()`, a song-length field, Restart, and a TXT button that fires the anomaly. Open in a browser next to the JS file. |
| `dump-frames.js` | Node script that regenerates the reference frames: `node dump-frames.js out-dir` |
| `reference-frames/` | 17 PNGs + `manifest.json`. If you ever port the renderer, it's correct when it reproduces these pixel-for-pixel. |

## Usage

```html
<div id="storm"></div>
<script src="storm-heatmap.js"></script>
<script>
  const storm = StormHeatmap.mount('#storm', { type: 3, duration: 187 });   // duration = song length in seconds
  txtButton.onclick = () => storm.anomaly();                                // one shockwave per press
  // when the next song starts:
  storm.setType(4).setDuration(212).restart();
</script>
```

**The only thing to configure per song is `duration` — set it to the song length in seconds.**
The storm's life is shaped in proportions, so any duration keeps the same arc (peak at 50–58% of
the song, second surge at 64–72%), and the clock is real elapsed time, so the storm ends when the
song does. When it ends it holds the last frame (set `loop: true` to roll into the next storm type
instead). `type` picks the storm: 0 Thunderstorm, 1 Supercell, 2 Squall line, 3 Hurricane (default),
4 Blizzard, 5 Dust storm.

Other controls returned by `mount()`: `start()`, `stop()`, `restart()`, `setType(i)`,
`setDuration(sec)`, `seek(sec)` (resync with the audio), `destroy()`.

## The two sliders

- **instability** — `setInstability(v)`, −1 to 1: recolors the same storm colder (blues) or hotter
  (reds) without changing its shape. 0 = off.
- **cloud speed** — `setTimeScale(s)`: how fast the clouds churn. 1 = normal, 0 = frozen,
  5 = timelapse. Doesn't affect the song-synced lifecycle, only the texture motion.

The demo's **SFERIC** button fires `storm.lightning()`: a lightning strike at a random spot — a
leader races down, the return stroke flashes the sky, and it restrikes once or twice down the same
branching channel, all inside half a second. Pressing again strikes anew. (A "sferic" is the radio
crackle a real lightning strike gives off.)

## The anomaly button

Wire the TXT button to `storm.anomaly()`. Each press runs one 2-second shockwave: a hot cell erupts
at a random spot near the center, a bright ring races outward, and the frame jolts for the first
~0.3 s. Presses while a shockwave is already running are ignored (the call returns `false`), and
after 2 seconds the storm continues as if nothing happened — nothing to clean up or reset.
