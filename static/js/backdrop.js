/**
 * backdrop.js — scroll-driven 3D background for Sentio
 * Three.js draws the scene; GSAP ScrollTrigger maps page scroll to
 * camera position, object rotation and lighting.
 *
 *   1. INITIALISE  renderer, scene, camera, mesh, procedural studio environment
 *   2. LIGHT       ambient + two directional lights (key, rim)
 *   3. BIND SCROLL one scrubbed GSAP timeline = page scroll progress (0 -> 1)
 *   4. RENDER LOOP one ticker, draws only when something changed
 *   5. RESIZE      rAF-throttled; aspect + pixel ratio only, never re-allocates assets
 *   6. TEARDOWN    destroy() releases every GPU resource and listener
 *
 * If WebGL or either CDN script is unavailable this file exits quietly and
 * the page simply has no 3D layer — nothing else depends on it.
 */
(function () {
  "use strict";

  const canvas = document.getElementById("bg3d");
  if (!canvas || !window.THREE || !window.gsap || !window.ScrollTrigger) return;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const AMP = reduceMotion ? 0.35 : 1; // scroll travel is scaled down for reduced-motion users
  const IDLE = !reduceMotion; // slow ambient drift on top of the scroll-driven rotation
  const IDLE_FRAME_MS = 33; // idle drift redraws at ~30 fps; scrolling redraws at full rate

  gsap.registerPlugin(ScrollTrigger);
  // Mobile URL-bar show/hide fires resize; don't re-measure the page for it.
  ScrollTrigger.config({ ignoreMobileResize: true });

  /* ==========================================================
     1. INITIALISE
     ========================================================== */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      alpha: true, // transparent: the page's own background and dot grid show through
      antialias: (window.devicePixelRatio || 1) < 2, // MSAA is wasted work at 2x density
      powerPreference: "default", // a background layer shouldn't wake the discrete GPU
    });
  } catch (err) {
    return; // no WebGL — leave the canvas transparent
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // keeps highlights from clipping to flat white
  renderer.toneMappingExposure = 0.9;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x07090d, 8, 17); // same colour as the page: distance fades into it

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);

  // The mesh sits in a pivot group. Scroll rotates the pivot; the slow idle
  // drift rotates the mesh inside it, so the two never fight over one value.
  const pivot = new THREE.Group();
  scene.add(pivot);

  // One draw call: ~12k triangles, one material, no textures.
  const geometry = new THREE.TorusKnotGeometry(1, 0.3, 220, 28, 2, 3);
  const material = new THREE.MeshStandardMaterial({
    color: 0xc9ceda, // platinum — takes its colour from the lights
    metalness: 1,
    roughness: 0.3, // soft highlights keep text on top legible
    envMapIntensity: 0.9,
  });
  const mesh = new THREE.Mesh(geometry, material);
  pivot.add(mesh);

  /**
   * A metal surface only shows what it reflects, so it needs something to
   * reflect. Rather than download an HDR file, build a tiny "studio" — a dark
   * room with a few emissive softboxes — and bake it once with PMREMGenerator.
   * Zero network cost; the geometry used to bake it is disposed immediately.
   */
  let envTarget = null;
  function buildEnvironment() {
    const env = new THREE.Scene();
    env.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(24, 24, 24),
        new THREE.MeshBasicMaterial({ color: 0x05070b, side: THREE.BackSide })
      )
    );
    const softbox = (w, h, hex, gain, x, y, z) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(gain), side: THREE.DoubleSide })
      );
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    softbox(8, 5, 0xff8a3d, 6, 6, 7, 4); // large ember key, upper right
    softbox(2, 9, 0xe9f0ff, 4, -8, 1, 3); // tall cool strip, left
    softbox(7, 3, 0x6fa8ff, 3, -2, -7, -5); // blue kicker, low rear
    softbox(5, 5, 0xf2641f, 2.5, 0, 3, -9); // deep-ember back light

    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromScene(env, 0.035);
    pmrem.dispose();
    env.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    return target;
  }
  function setEnvironment() {
    if (envTarget) envTarget.dispose();
    envTarget = buildEnvironment();
    scene.environment = envTarget.texture;
  }
  setEnvironment();

  /* ==========================================================
     2. LIGHT
     Ambient lifts the shadows; the key light (ember, moves + changes
     colour with scroll) does the modelling; the cool-blue rim light keeps the
     silhouette readable against the dark page. All three are tweened below.
     ========================================================== */
  const KEYFRAMES = [
    // hero: knot sits right, behind the spec plate
    { cam: [0.0, 0.5, 7.2], look: [-2.0, 0.0, 0.0], rot: [0.2, 0.0, 0.0], keyPos: [4, 5, 5], key: 0xff8a3d, keyI: 1.6, rimI: 0.55, ambI: 0.25 },
    // capture: swings left, key light softens to peach
    { cam: [2.0, -0.4, 6.2], look: [2.1, 0.0, 0.0], rot: [0.9, 1.7, 0.3], keyPos: [-4, 4, 5], key: 0xffb27a, keyI: 1.5, rimI: 0.9, ambI: 0.18 },
    // reading: back to the right, light warms toward white
    { cam: [-1.6, 1.1, 5.6], look: [-2.0, 0.1, 0.0], rot: [1.5, 3.3, 0.8], keyPos: [3, -3, 6], key: 0xfff0e4, keyI: 1.3, rimI: 0.6, ambI: 0.3 },
    // pipeline/footer: pulls back and centres, light calms down
    { cam: [0.0, 0.0, 9.0], look: [0.0, -0.3, 0.0], rot: [2.1, 4.9, 1.2], keyPos: [0, 5, 4], key: 0xff8a3d, keyI: 1.0, rimI: 0.4, ambI: 0.22 },
  ];
  const K0 = KEYFRAMES[0];

  const ambient = new THREE.AmbientLight(0x8a93a6, K0.ambI);
  const key = new THREE.DirectionalLight(0xffffff, K0.keyI);
  key.color.set(K0.key);
  key.position.set(K0.keyPos[0], K0.keyPos[1], K0.keyPos[2]);
  const rim = new THREE.DirectionalLight(0x6fa8ff, K0.rimI);
  rim.position.set(-5, -2, -4);
  scene.add(ambient, key, rim);

  /* ==========================================================
     3. BIND SCROLL
     GSAP does not touch the camera directly. It tweens two plain objects
     (`cam`, `look`); the render loop then writes them into the camera. That
     keeps the scroll animation independent of the window size, so a resize
     can re-frame the shot without fighting the tween.
     ========================================================== */
  const cam = { x: K0.cam[0], y: K0.cam[1], z: K0.cam[2] };
  const look = { x: K0.look[0], y: K0.look[1], z: K0.look[2] };
  pivot.rotation.set(K0.rot[0], K0.rot[1], K0.rot[2]);

  // Reduced motion: every keyframe moves only 35% of the way from the first one.
  const travel = (from, to) => from + (to - from) * AMP;

  let dirty = true; // true = something changed, redraw on the next tick
  const markDirty = () => { dirty = true; };

  const tl = gsap.timeline({
    defaults: { duration: 1, ease: "none" },
    onUpdate: markDirty, // fires on every scrub step, including the catch-up after scrolling stops
    scrollTrigger: {
      trigger: document.body,
      start: "top top",
      end: "bottom bottom", // whole document height = progress 0 -> 1
      scrub: reduceMotion ? true : 1, // 1 = the animation trails the scrollbar by ~1s for a silky feel
    },
  });

  KEYFRAMES.slice(1).forEach((k, i) => {
    const color = new THREE.Color(k.key);
    tl.to(cam, { x: travel(K0.cam[0], k.cam[0]), y: travel(K0.cam[1], k.cam[1]), z: travel(K0.cam[2], k.cam[2]), ease: "power1.inOut" }, i)
      .to(look, { x: travel(K0.look[0], k.look[0]), y: travel(K0.look[1], k.look[1]), z: travel(K0.look[2], k.look[2]), ease: "power1.inOut" }, i)
      .to(pivot.rotation, { x: travel(K0.rot[0], k.rot[0]), y: travel(K0.rot[1], k.rot[1]), z: travel(K0.rot[2], k.rot[2]) }, i)
      .to(key.position, { x: k.keyPos[0], y: k.keyPos[1], z: k.keyPos[2] }, i)
      .to(key.color, { r: color.r, g: color.g, b: color.b }, i)
      .to(key, { intensity: k.keyI }, i)
      .to(rim, { intensity: k.rimI }, i)
      .to(ambient, { intensity: k.ambI }, i);
  });

  /* ==========================================================
     4. RENDER LOOP
     One requestAnimationFrame for everything: GSAP's ticker. It sleeps
     when the tab is hidden. A frame is only drawn when the scroll
     animation moved, the window resized, or the idle drift is due.
     ========================================================== */
  const view = { spread: 1, pull: 1 }; // responsive framing, set in applySize()

  function applyView() {
    camera.position.set(cam.x * view.spread, cam.y, cam.z * view.pull);
    camera.lookAt(look.x * view.spread, look.y, look.z);
  }

  let idleAcc = 0;
  let perfFrames = 0;
  let perfSlow = 0;

  function render(_time, dtMs) {
    idleAcc += dtMs;
    const idleDue = IDLE && idleAcc >= IDLE_FRAME_MS;
    if (!dirty && !idleDue) return; // nothing changed: spend zero GPU time

    const wasDirty = dirty;
    if (IDLE) {
      const s = Math.min(idleAcc, 100) / 1000; // clamp so returning to a tab doesn't jump
      mesh.rotation.x += s * 0.05;
      mesh.rotation.y += s * 0.08;
    }
    idleAcc = 0;
    dirty = false;

    applyView();
    renderer.render(scene, camera);
    watchPerformance(dtMs, wasDirty);
  }

  /**
   * Adaptive resolution: while scrolling, if more than 40% of 60 frames take
   * longer than ~30 ms, drop the pixel ratio a step (never below 1). The
   * background gets a touch softer; scrolling stays smooth.
   */
  function watchPerformance(dtMs, wasDirty) {
    if (!wasDirty || dtMs > 250) return;
    perfFrames++;
    if (dtMs > 30) perfSlow++;
    if (perfFrames >= 60) {
      if (perfSlow > 24 && pixelCap > 1) {
        pixelCap = Math.max(1, pixelCap - 0.25);
        applySize(true);
      }
      perfFrames = 0;
      perfSlow = 0;
    }
  }

  /* ==========================================================
     5. RESIZE
     The canvas is CSS-sized (100% x 100lvh), so we read its box rather than
     window.inner*. 'lvh' doesn't change when a mobile URL bar collapses, so
     that case is a no-op. Resize events are coalesced to one per frame and
     skipped if nothing changed. No geometry, material or texture is
     re-created — only the drawing buffer and the camera matrix.
     ========================================================== */
  let pixelCap = Math.min(window.devicePixelRatio || 1, 1.75);
  let lastW = 0;
  let lastH = 0;
  let lastPR = 0;

  function applySize(force) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const pr = Math.min(pixelCap, window.devicePixelRatio || 1);
    if (!force && w === lastW && h === lastH && pr === lastPR) return;
    lastW = w;
    lastH = h;
    lastPR = pr;

    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false); // false: leave the CSS size alone
    const aspect = w / h;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();

    // On narrow/portrait screens, pull the camera back and shrink the left/right
    // offsets so the knot stays in frame instead of sliding off the edge.
    view.spread = clamp(aspect / 1.6, 0.3, 1);
    view.pull = 1 + clamp(1 - aspect, 0, 0.7) * 0.45;
    markDirty();
  }

  let resizeRaf = 0;
  function onResize() {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      applySize(false);
    });
  }
  window.addEventListener("resize", onResize, { passive: true });

  // The page's height changes when results appear or the font loads;
  // re-measure ScrollTrigger (debounced) so progress still spans 0 -> 1.
  let refreshTimer = 0;
  const refresh = () => ScrollTrigger.refresh();
  const bodyObserver =
    "ResizeObserver" in window
      ? new ResizeObserver(() => {
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(refresh, 200);
        })
      : null;
  if (bodyObserver) bodyObserver.observe(document.body);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);

  // GPU context loss (driver reset, memory pressure): stop drawing, then
  // rebuild the one thing that lived only on the GPU — the baked environment.
  function onContextLost(e) {
    e.preventDefault();
    gsap.ticker.remove(render);
  }
  function onContextRestored() {
    setEnvironment();
    markDirty();
    gsap.ticker.add(render);
  }
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  /* ==========================================================
     6. TEARDOWN
     ========================================================== */
  function destroy() {
    gsap.ticker.remove(render);
    window.removeEventListener("resize", onResize);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    canvas.removeEventListener("webglcontextrestored", onContextRestored);
    if (bodyObserver) bodyObserver.disconnect();
    clearTimeout(refreshTimer);
    if (resizeRaf) cancelAnimationFrame(resizeRaf);

    if (tl.scrollTrigger) tl.scrollTrigger.kill();
    tl.kill();

    geometry.dispose();
    material.dispose();
    if (envTarget) envTarget.dispose();
    scene.environment = null;
    renderer.dispose();
    if (renderer.forceContextLoss) renderer.forceContextLoss();

    canvas.classList.remove("is-ready");
    delete window.SentioBackdrop;
  }

  /* start */
  applySize(true);
  applyView();
  renderer.render(scene, camera);
  gsap.ticker.add(render);
  requestAnimationFrame(() => canvas.classList.add("is-ready")); // fade in once the first frame exists

  // Exposed for DevTools / debugging; nothing else in the app relies on it.
  window.SentioBackdrop = { refresh, destroy, timeline: tl, scene, camera, renderer };
})();
