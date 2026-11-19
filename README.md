# Sentio — Voice Emotion Analysis

A local voice-emotion analysis tool: record or drop in a short clip of speech and
Sentio reads pitch, energy, spectral shape, tempo, and rhythm to surface the
emotion carried underneath — shown as a segmented probability spread, three
affective-dimension level bars, and a console-style metering panel.

## Run it

```bash
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open **http://127.0.0.1:5000**. Click the mic button, speak a full sentence, click
again to stop, then **Analyze reading** — or drag a `.wav`, `.flac`, or `.ogg` file
onto the capture card (max 15 MB). Audio goes only to the local Flask server.

The page loads Plus Jakarta Sans, Inter and JetBrains Mono from Google Fonts, and Three.js r128 plus
GSAP / ScrollTrigger 3.12.5 from cdnjs for the 3D background. Offline, it falls back
to system fonts and simply has no 3D layer — everything else works. To run fully
offline, download those three scripts into `static/vendor/` and point the `<script>`
tags in `templates/index.html` at them.

## Design system — "Obsidian & Ember"

A deep-slate canvas, hairline-bordered glass, and exactly one vivid accent. Every
value is a CSS custom property at the top of `static/css/style.css`.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#07090D` | Page canvas |
| `--text` / `--text-2` / `--text-3` | `#F6F7FB` / `#A4ACBD` / `#7A8396` | Primary / secondary / tertiary text (all >= 4.89:1 on the glass surface) |
| `--accent` (+ `-hi`, `-lo`) | `#FF8A3D` | The brand accent: primary buttons, the record control, the scope trace, one headline phrase. Never used for data |
| `--mint` / `--sky` / `--rose` | `#4FD6A3` / `#6FA8FF` / `#FF5C7A` | Semantic data hues: neutral-positive / elevated-low-energy / tense-negative emotions, level meters, recording state |

- **Type:** Plus Jakarta Sans for display (800 / 700 / 650, letter-spacing -0.045 / -0.035 /
  -0.02em), Inter for text (16px / 1.6), JetBrains Mono for every number. Nothing below 12px.
- **Spacing:** an 8px grid with a 4px half-step, as `--s-1` ... `--s-12` (4 ... 128px).
  Sections breathe at 128px, cards at 24-40px, with 24px between tiles.
- **Surfaces:** `backdrop-filter: blur(20px)` glass, a 1px gradient hairline border (via a
  masked pseudo-element, guarded by `@supports`), an inner top highlight, a soft shadow, and a
  faint 64px grid plus two ambient glows behind everything.
- **Motion:** all transitions use `cubic-bezier(0.16, 1, 0.3, 1)`. `static/js/fx.js` adds a
  cursor-following sheen on glass panels (fine pointers only) and staggered scroll reveals; if it
  fails, or `prefers-reduced-motion` is set, nothing is hidden and nothing animates.
- **Icons:** one inline SVG sprite at the top of `templates/index.html` (stroke icons on a 24px
  grid, `currentColor`), referenced with `<use href="#i-...">`. No icon font, no extra request.
- **Emotion hues** live in `EMOTION_META` in `emotion_engine.py` and ship through the API, so the
  front end never hard-codes them.
- **Capture states:** the capture card carries `data-state` = `idle | recording | ready |
  analyzing | done`; button, glow, chip, LEDs and scan line all key off it.
- **Accessibility:** keyboard-operable drop zone, `role="meter"` on probability bars, a live-region
  status chip, visible focus rings, and reduced-motion support.

## The scroll-driven 3D background

A platinum torus knot, lit by an ember key light and a cool rim light, sits fixed behind the page. Scrolling moves the camera,
turns the knot, and re-lights it. It is a backdrop only: `pointer-events: none`,
dimmed to 88% (50% on phones), and dissolving into the page colour with distance.
All of it lives in `static/js/backdrop.js`, which is commented in six numbered parts.

**1. Scene initialisation.** A transparent `WebGLRenderer` (so the page background and
dot grid show through) with ACES filmic tone mapping and sRGB output; a `PerspectiveCamera`;
a `TorusKnotGeometry` (~12k triangles, one mesh, one draw call) with a
`MeshStandardMaterial` at `metalness: 1`. A metal only shows what it reflects, so the file
bakes a tiny procedural "studio" (a dark room plus four emissive softboxes) once with
`PMREMGenerator` — no HDR download — and disposes the temporary geometry straight away.

**2. Lighting.** One ambient light lifts the shadows, an ember directional *key* light does
the modelling, and a cool-blue directional *rim* light keeps the silhouette readable.
Scroll changes the key light's colour (ember → peach → warm white → ember), position
and intensity, and the rim and ambient intensities.

**3. GSAP scroll binding.** One `gsap.timeline` with a `ScrollTrigger` spanning the
whole document (`start: "top top"`, `end: "bottom bottom"`, `scrub: 1`), so scroll
progress 0 → 1 *is* the timeline's progress, and the animation trails the scrollbar by
about a second. Four keyframes (hero, capture, reading, pipeline) give three tweened
segments. GSAP tweens plain `cam` / `look` objects plus `pivot.rotation` and the lights;
the render loop copies `cam` / `look` into `camera.position` and `camera.lookAt()`.
That indirection means a window resize can re-frame the shot without fighting the tween.
To change the choreography, edit the `KEYFRAMES` array.

**4. Render loop.** A single `gsap.ticker` callback (one `requestAnimationFrame` shared
with GSAP, asleep when the tab is hidden). A frame is drawn only if the scroll animation
moved, the window resized, or the slow idle drift is due, and idle drift is throttled
to ~30 fps. Nothing is allocated per frame.

**5. Resize.** Events are coalesced to one per animation frame and ignored if the canvas
box didn't change. The handler updates `camera.aspect`, the projection matrix, the drawing
buffer and the pixel ratio — it never recreates geometry, materials or textures. The
canvas is `100lvh` tall so a collapsing mobile URL bar is a no-op. On narrow screens the
camera pulls back and the left/right swing shrinks so the knot stays in frame.
A `ResizeObserver` on `<body>` re-measures ScrollTrigger (debounced) when the page height
changes, e.g. when results appear.

**6. Teardown.** `SentioBackdrop.destroy()` removes every listener, kills the
ScrollTrigger and timeline, disposes geometry, material, the baked environment and the
renderer, and releases the GL context. `webglcontextlost` / `restored` are handled
(the baked environment is rebuilt on restore).

### Performance and asset best practices used here (and to keep in mind when you swap the mesh)

- **Keep geometry light.** A background rarely needs more than ~10–50k triangles and
  one or two draw calls. Reuse geometries and materials; merge static meshes or use
  `InstancedMesh` for repeats.
- **Prefer procedural or compressed assets.** The knot and its reflections are generated
  in code (0 bytes to download). For glTF models use Draco or meshopt geometry
  compression and KTX2/Basis textures; keep textures power-of-two and no larger than needed
  (1–2K); bake lighting instead of using real-time shadows.
- **Cap the work per pixel.** Pixel ratio is capped at 1.75 and automatically stepped
  down (never below 1) if scrolling frames run slow; MSAA is skipped at 2× density; no
  shadows, no post-processing, no transparency overdraw.
- **Render only when something changed**, throttle ambient motion, and let the ticker
  sleep in hidden tabs. This matters more than usual here because the glass panels use
  `backdrop-filter`, which the browser must re-blur whenever the canvas underneath
  changes.
- **Don't wake the discrete GPU** for decoration (`powerPreference: "default"`).
- **Never leak.** Dispose geometries, materials, textures and render targets you
  create, remove listeners with the same function reference you added, and release the
  context on teardown.
- **Respect the user.** With `prefers-reduced-motion` the idle drift stops, scroll travel
  is reduced to 35%, and the scrub snaps instead of trailing.

## How the recognition works

1. **Input.** The browser records the mic with the Web Audio API and encodes real
   16-bit PCM WAV client-side (`static/js/recorder.js`) — no ffmpeg needed.
2. **Feature extraction** (`emotion_engine.py`, via `librosa`): F0 (`pyin`), RMS
   energy, zero-crossing rate, spectral centroid / bandwidth / rolloff / contrast,
   13 MFCCs, tempo, and onset rate.
3. **Scoring.** Features are combined into **arousal**, **valence**, and **tension**
   (weightings drawn from speech-emotion research: Scherer 2003; Banse & Scherer
   1996) and compared against reference points for 8 emotions. This is an
   explainable heuristic, **not** a trained classifier. Percentages are relative
   shares across the 8 classes, not calibrated probabilities, and the UI flags a
   "close call" when the top two are within 5 points.

### Upgrading to a trained model

`train_model.py` trains a `RandomForestClassifier` on a labeled corpus (RAVDESS,
CREMA-D, TESS, SAVEE, or your own) using the same feature extractor:

```bash
python train_model.py --data ./dataset --out model.joblib --n-estimators 1000
```

with one folder per emotion (`happy/`, `sad/`, `angry/`, `fearful/`, `surprised/`,
`disgust/`, `calm/`, `neutral/`) of `.wav` files. Once `model.joblib` sits next to
`emotion_engine.py` the app uses it automatically; the dimension bars then show
"n/a" because a classifier doesn't produce them. Training starts from scratch and
overwrites the output model. `--n-estimators` controls the number of trees (default:
`400`); increasing it can help, but adding more varied, correctly labeled recordings
is usually more valuable. Check the printed test accuracy when comparing runs.

## Project structure

```
app.py                  Flask app + /api/analyze endpoint
emotion_engine.py       Feature extraction + scoring (heuristic or trained model)
train_model.py          Optional: train a classifier on labeled data
templates/index.html    Page markup
static/css/style.css    "Obsidian & Ember" design system
static/js/backdrop.js   Scroll-driven 3D background (Three.js + GSAP ScrollTrigger)
static/js/recorder.js   Mic capture -> WAV encoding
static/js/fx.js         Glass sheen + scroll reveals (progressive enhancement)
static/js/main.js       State machine, drag-and-drop, scope, results rendering
```
