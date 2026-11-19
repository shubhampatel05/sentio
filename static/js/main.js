(function () {
  "use strict";

  /* ==========================================================
     Helpers
     ========================================================== */
  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const nextFrame = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));
  const cssVar = (name, fallback) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

  const ACCENT = cssVar("--accent", "#ff8a3d");
  const MAX_BYTES = 15 * 1024 * 1024;
  const ALLOWED_EXT = [".wav", ".flac", ".ogg"];

  function hexToRgb(hex) {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(", ");
  }
  function fmtClock(sec) {
    const t = Math.floor(sec);
    return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
  }
  function fmtBytes(b) {
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return Math.round(b / 1024) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  }

  /** Eased count-up for numeric readouts (instant under reduced motion). */
  function countTo(el, target, decimals) {
    if (reduceMotion) {
      el.textContent = target.toFixed(decimals);
      return;
    }
    const start = performance.now();
    const dur = 850;
    (function tick(now) {
      const t = clamp((now - start) / dur, 0, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      el.textContent = (target * eased).toFixed(decimals);
      if (t < 1) requestAnimationFrame(tick);
    })(start);
  }

  /** Canvas sized to its CSS box, re-fit on resize (also fires when a hidden ancestor appears). */
  function makeFit(canvas, onFit) {
    const s = { ctx: canvas.getContext("2d"), w: 0, h: 0 };
    let ready = false; // skip onFit during construction — the caller's binding doesn't exist yet
    s.fit = function () {
      const r = canvas.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      s.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      s.w = r.width;
      s.h = r.height;
      if (ready && onFit) onFit();
    };
    if (window.ResizeObserver) new ResizeObserver(s.fit).observe(canvas);
    else window.addEventListener("resize", s.fit);
    s.fit();
    ready = true;
    return s;
  }

  /* ==========================================================
     Elements + state
     ========================================================== */
  const captureCard = $("capture-card");
  const stateText = $("state-text");
  const recordBtn = $("record-btn");
  const timerEl = $("timer");
  const statusEl = $("status-label");
  const levelEl = $("level-meter");
  const dropzone = $("dropzone");
  const fileInput = $("file-input");
  const sourceEl = $("source-readout");
  const analyzeBtn = $("analyze-btn");
  const analyzeLabel = $("analyze-label");
  const errorMsg = $("error-msg");
  const resultsSection = $("results");

  const recorder = new WavRecorder();
  let pendingAudio = null; // { blob, filename, label, duration }
  let isRecording = false;
  let timerInterval = null;
  let startedAt = 0;
  let previewToken = 0;

  const STATE = {
    idle: { chip: "Standby", status: "Press to record" },
    recording: { chip: "Recording", status: "Recording — speak now" },
    ready: { chip: "Ready", status: "Captured — ready to analyze" },
    analyzing: { chip: "Analyzing", status: "Reading signal…" },
    done: { chip: "Complete", status: "Reading complete" },
  };

  function locked() {
    const s = captureCard.dataset.state;
    return s === "recording" || s === "analyzing";
  }

  function setState(state) {
    captureCard.dataset.state = state;
    stateText.textContent = STATE[state].chip;
    statusEl.textContent = STATE[state].status;
    const lock = state === "recording" || state === "analyzing";
    fileInput.disabled = lock;
    recordBtn.disabled = state === "analyzing";
    recordBtn.setAttribute("aria-pressed", state === "recording" ? "true" : "false");
    recordBtn.setAttribute("aria-label", state === "recording" ? "Stop recording" : "Start recording");
    analyzeBtn.disabled = lock || !pendingAudio;
    analyzeLabel.textContent = state === "analyzing" ? "Analyzing…" : "Analyze reading";
  }

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.hidden = false;
  }
  function clearError() {
    errorMsg.hidden = true;
  }
  function hideResults() {
    resultsSection.hidden = true;
  }

  function updateSource() {
    if (!pendingAudio) {
      sourceEl.textContent = "No source loaded";
      return;
    }
    const parts = [pendingAudio.label];
    if (pendingAudio.duration) parts.push(fmtClock(pendingAudio.duration));
    parts.push(fmtBytes(pendingAudio.blob.size));
    sourceEl.textContent = parts.join(" · ");
  }

  /* ==========================================================
     Scope (live + static waveform) and LED input meter
     ========================================================== */
  const scope = makeFit($("scope"), () => drawScope());
  let scopeMode = "idle"; // idle | live | static
  let livePeaks = [];
  let staticPeaks = null;
  const LIVE_BARS = 160;

  function drawScope() {
    const { ctx, w, h } = scope;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2;

    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(mid) + 0.5);
    ctx.lineTo(w, Math.round(mid) + 0.5);
    ctx.stroke();

    let peaks, bars, gain, offset;
    if (scopeMode === "live") {
      peaks = livePeaks;
      bars = LIVE_BARS;
      gain = 3.2;
      offset = bars - peaks.length;
    } else if (scopeMode === "static" && staticPeaks) {
      peaks = staticPeaks;
      bars = staticPeaks.length;
      gain = 1;
      offset = 0;
    } else {
      return;
    }

    const slot = (w - 28) / bars;
    const bw = Math.max(1.6, slot - 1.6);
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    if (scopeMode === "live") {
      grad.addColorStop(0, "rgba(" + hexToRgb(ACCENT) + ",0.15)");
      grad.addColorStop(1, ACCENT);
    } else {
      grad.addColorStop(0, ACCENT);
      grad.addColorStop(1, ACCENT);
    }
    ctx.strokeStyle = grad;
    ctx.lineWidth = bw;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < peaks.length; i++) {
      const amp = clamp(peaks[i] * gain, 0.03, 1);
      const half = Math.max(0.5, amp * (h * 0.43) - bw / 2);
      const x = 22 + (offset + i) * slot + bw / 2;
      ctx.moveTo(x, mid - half);
      ctx.lineTo(x, mid + half);
    }
    ctx.stroke();
  }

  const LED_COUNT = 14;
  const leds = [];
  for (let i = 0; i < LED_COUNT; i++) {
    const el = document.createElement("i");
    if (i >= 12) el.className = "hot";
    else if (i >= 9) el.className = "warm";
    levelEl.appendChild(el);
    leds.push(el);
  }
  let inputLevel = 0;
  let litLeds = 0;
  function updateLevel() {
    const target = Math.round(clamp(inputLevel * 2.2, 0, 1) * LED_COUNT);
    if (target === litLeds) return;
    leds.forEach((el, i) => el.classList.toggle("on", i < target));
    litLeds = target;
  }

  let liveRaf = null;
  function liveLoop() {
    inputLevel *= 0.9;
    updateLevel();
    drawScope();
    if (isRecording) liveRaf = requestAnimationFrame(liveLoop);
  }

  function pushPeak(channelData) {
    let max = 0;
    for (let i = 0; i < channelData.length; i++) {
      const v = Math.abs(channelData[i]);
      if (v > max) max = v;
    }
    livePeaks.push(max);
    if (livePeaks.length > LIVE_BARS) livePeaks.shift();
    inputLevel = Math.max(inputLevel, max);
  }

  /** Decode the captured/dropped audio in the browser to draw its full waveform. */
  async function renderPendingWaveform(blob) {
    const token = ++previewToken;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error("no audio context");
      const ctx = new Ctx();
      const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
      ctx.close();
      if (token !== previewToken) return;

      const data = decoded.getChannelData(0);
      const bars = 120;
      const block = Math.max(1, Math.floor(data.length / bars));
      const peaks = [];
      let top = 0;
      for (let b = 0; b < bars; b++) {
        let m = 0;
        for (let i = b * block; i < Math.min(data.length, (b + 1) * block); i++) {
          const v = Math.abs(data[i]);
          if (v > m) m = v;
        }
        peaks.push(m);
        if (m > top) top = m;
      }
      staticPeaks = peaks.map((p) => (top > 0 ? p / top : 0));
      scopeMode = "static";
      if (pendingAudio && pendingAudio.blob === blob) {
        pendingAudio.duration = decoded.duration;
        timerEl.textContent = fmtClock(decoded.duration);
        updateSource();
      }
      drawScope();
    } catch (e) {
      if (token === previewToken) {
        scopeMode = "idle";
        drawScope();
      }
    }
  }

  /* ==========================================================
     Recording
     ========================================================== */
  async function startRecording() {
    clearError();
    try {
      await recorder.start(pushPeak);
    } catch (err) {
      showError("Microphone access is off. Enable it in your browser to take a reading.");
      return;
    }
    isRecording = true;
    livePeaks = [];
    scopeMode = "live";
    pendingAudio = null;
    updateSource();
    hideResults();
    setState("recording");
    startedAt = Date.now();
    timerEl.textContent = "00:00";
    timerInterval = setInterval(() => {
      timerEl.textContent = fmtClock((Date.now() - startedAt) / 1000);
    }, 200);
    liveRaf = requestAnimationFrame(liveLoop);
  }

  function stopRecording() {
    const { blob, durationSeconds } = recorder.stop();
    isRecording = false;
    clearInterval(timerInterval);
    cancelAnimationFrame(liveRaf);
    inputLevel = 0;
    updateLevel();

    if (durationSeconds < 0.8) {
      scopeMode = "idle";
      timerEl.textContent = "00:00";
      setState("idle");
      drawScope();
      showError("That was too short to read. Try a full sentence — a second or two of speech.");
      return;
    }

    pendingAudio = { blob, filename: "recording.wav", label: "Live recording", duration: durationSeconds };
    timerEl.textContent = fmtClock(durationSeconds);
    setState("ready");
    updateSource();
    renderPendingWaveform(blob);
  }

  recordBtn.addEventListener("click", () => {
    if (isRecording) stopRecording();
    else startRecording();
  });

  /* ==========================================================
     File input + drag-and-drop
     ========================================================== */
  function acceptFile(file) {
    clearError();
    const dot = file.name.lastIndexOf(".");
    const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
    if (!ALLOWED_EXT.includes(ext)) {
      showError("“" + file.name + "” isn’t a supported format. Use a .wav, .flac, or .ogg file, or record directly.");
      return;
    }
    if (file.size > MAX_BYTES) {
      showError("That file is over the 15 MB limit. Trim it or export a shorter clip.");
      return;
    }
    pendingAudio = { blob: file, filename: file.name, label: file.name, duration: 0 };
    hideResults();
    scopeMode = "idle";
    timerEl.textContent = "00:00";
    setState("ready");
    updateSource();
    renderPendingWaveform(file);
  }

  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (file) acceptFile(file);
  });

  function setDrag(on) {
    captureCard.classList.toggle("is-dragover", on);
    dropzone.classList.toggle("is-dragover", on);
  }
  ["dragenter", "dragover"].forEach((ev) =>
    captureCard.addEventListener(ev, (e) => {
      e.preventDefault();
      if (locked()) return;
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setDrag(true);
    })
  );
  ["dragleave", "dragend"].forEach((ev) =>
    captureCard.addEventListener(ev, (e) => {
      if (!e.relatedTarget || !captureCard.contains(e.relatedTarget)) setDrag(false);
    })
  );
  captureCard.addEventListener("drop", (e) => {
    e.preventDefault();
    setDrag(false);
    if (locked()) return;
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) acceptFile(file);
  });
  // A file dropped outside the card must not navigate the page away.
  ["dragover", "drop"].forEach((ev) => window.addEventListener(ev, (e) => e.preventDefault()));

  /* ==========================================================
     Analyze
     ========================================================== */
  analyzeBtn.addEventListener("click", async () => {
    if (!pendingAudio || locked()) return;
    clearError();
    setState("analyzing");

    const form = new FormData();
    form.append("audio", pendingAudio.blob, pendingAudio.filename);

    try {
      const res = await fetch("/api/analyze", { method: "POST", body: form });
      let data = {};
      try {
        data = await res.json();
      } catch (e) {}
      if (!res.ok) throw new Error(data.error || "The reading failed. Try again.");
      renderResults(data);
      setState("done");
    } catch (err) {
      showError(
        err.message === "Failed to fetch"
          ? "The reading failed. Check that the Sentio server is running, then try again."
          : err.message
      );
      setState("ready");
    }
  });

  $("reset-btn").addEventListener("click", () => {
    hideResults();
    pendingAudio = null;
    previewToken++;
    scopeMode = "idle";
    timerEl.textContent = "00:00";
    clearError();
    updateSource();
    setState("idle");
    drawScope();
    $("capture").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  });

  /* ==========================================================
     Results
     ========================================================== */
  const SEGMENTS = 40;
  const READOUTS = [
    { label: "Pitch", unit: "Hz", dec: 1, tip: "Mean fundamental frequency (F0) of voiced frames", get: (r) => r.pitch_mean_hz },
    { label: "Pitch var.", unit: "Hz", dec: 1, tip: "Standard deviation of F0 — how much the pitch moves", get: (r) => r.pitch_variability_hz },
    { label: "RMS level", unit: "dBFS", dec: 1, tip: "Average signal level relative to digital full scale", get: (r) => (r.energy > 0 ? 20 * Math.log10(r.energy) : NaN) },
    { label: "Tempo", unit: "BPM", dec: 0, tip: "Estimated beat tempo of the speech rhythm", get: (r) => r.tempo_bpm },
    { label: "Speech rate", unit: "/s", dec: 1, tip: "Acoustic onsets per second — a proxy for speech rate", get: (r) => r.speech_rate_ops },
    { label: "Brightness", unit: "Hz", dec: 0, tip: "Spectral centroid — where the energy sits in the spectrum", get: (r) => r.brightness_hz },
  ];

  const meter = makeFit($("meter-wave"), () => drawMeterWave());
  let meterPeaks = null;
  let meterTone = ACCENT;

  function drawMeterWave() {
    const { ctx, w, h } = meter;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(mid) + 0.5);
    ctx.lineTo(w, Math.round(mid) + 0.5);
    ctx.stroke();
    if (!meterPeaks || !meterPeaks.length) return;

    const top = Math.max.apply(null, meterPeaks) || 1;
    const slot = (w - 20) / meterPeaks.length;
    const bw = Math.max(1.4, slot - 1.4);
    ctx.strokeStyle = meterTone;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = bw;
    ctx.lineCap = "round";
    ctx.beginPath();
    meterPeaks.forEach((p, i) => {
      const half = Math.max(0.5, (p / top) * (h * 0.42) - bw / 2);
      const x = 10 + i * slot + bw / 2;
      ctx.moveTo(x, mid - half);
      ctx.lineTo(x, mid + half);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function renderSpread(ranked, colors, labels, dominant) {
    const wrap = $("spread-rows");
    wrap.innerHTML = "";
    const toLight = [];
    ranked.forEach(([emo, p], r) => {
      const row = document.createElement("div");
      row.className = "spread-row" + (emo === dominant ? " is-dominant" : "");
      row.style.setProperty("--tone", colors[emo]);

      const name = document.createElement("span");
      name.className = "spread-name";
      name.textContent = labels[emo];

      const segs = document.createElement("div");
      segs.className = "segs";
      segs.setAttribute("role", "meter");
      segs.setAttribute("aria-label", labels[emo] + " share of score");
      segs.setAttribute("aria-valuemin", "0");
      segs.setAttribute("aria-valuemax", "100");
      segs.setAttribute("aria-valuenow", String(Math.round(p * 100)));
      const lit = Math.round(p * SEGMENTS);
      for (let i = 0; i < SEGMENTS; i++) {
        const s = document.createElement("i");
        s.style.transitionDelay = reduceMotion ? "0ms" : r * 55 + i * 12 + "ms";
        segs.appendChild(s);
        if (i < lit) toLight.push(s);
      }

      const pct = document.createElement("span");
      pct.className = "spread-pct mono";
      pct.textContent = Math.round(p * 100) + "%";

      row.appendChild(name);
      row.appendChild(segs);
      row.appendChild(pct);
      wrap.appendChild(row);
    });
    nextFrame(() => toLight.forEach((s) => s.classList.add("lit")));
  }

  function renderDims(dims) {
    $("dims-card").classList.toggle("is-unavailable", !dims);
    $("dims-note").hidden = !!dims;
    ["arousal", "valence", "tension"].forEach((k) => {
      const fill = $("fill-" + k);
      const thumb = $("thumb-" + k);
      const val = $("val-" + k);
      fill.style.width = "0%";
      thumb.style.left = "0%";
      if (!dims) {
        val.textContent = "n/a";
        return;
      }
      const v = Math.round(dims[k] * 100);
      countTo(val, v, 0);
      nextFrame(() => {
        fill.style.width = v + "%";
        thumb.style.left = v + "%";
      });
    });
  }

  function renderMeters(raw, preview, duration, tone) {
    $("meter-duration").textContent = duration ? "Duration " + Number(duration).toFixed(2) + " s" : "";
    const grid = $("readouts");
    grid.innerHTML = "";
    READOUTS.forEach((def) => {
      const cell = document.createElement("div");
      cell.className = "readout";
      cell.title = def.tip;
      const label = document.createElement("span");
      label.className = "r-label";
      label.textContent = def.label;
      const line = document.createElement("div");
      const num = document.createElement("span");
      num.className = "r-val";
      const unit = document.createElement("span");
      unit.className = "r-unit";
      unit.textContent = def.unit;
      const value = def.get(raw);
      if (Number.isFinite(value)) countTo(num, value, def.dec);
      else num.textContent = "—";
      line.appendChild(num);
      line.appendChild(unit);
      cell.appendChild(label);
      cell.appendChild(line);
      grid.appendChild(cell);
    });
    meterPeaks = preview || null;
    meterTone = tone;
    meter.fit();
    drawMeterWave();
  }

  function renderResults(data) {
    const probs = data.probabilities;
    const colors = data.emotion_colors;
    const labels = data.emotion_labels;
    const dominant = data.dominant_emotion;
    const tone = colors[dominant];

    const ranked = Object.entries(probs).sort((a, b) => b[1] - a[1]);
    const topP = ranked[0][1];
    const [secKey, secP] = ranked[1];
    const marginPts = (topP - secP) * 100;

    resultsSection.style.setProperty("--tone", tone);
    resultsSection.style.setProperty("--tone-rgb", hexToRgb(tone));
    resultsSection.hidden = false;
    resultsSection.classList.remove("reveal-in");
    void resultsSection.offsetWidth;
    resultsSection.classList.add("reveal-in");

    $("results-source").textContent =
      data.source === "trained_model"
        ? "Scored by a trained classifier loaded from model.joblib."
        : "Scored by the acoustic heuristic engine. Scores are relative shares across eight classes, not calibrated probabilities.";

    $("dominant-label").textContent = labels[dominant];
    $("dominant-caption").textContent =
      "Highest of 8 scored emotions. Runner-up: " + labels[secKey] + " at " + Math.round(secP * 100) + "%.";
    countTo($("dominant-pct"), Math.round(topP * 100), 0);
    const marginEl = $("dominant-margin");
    marginEl.textContent = "Margin +" + marginPts.toFixed(1) + " pts" + (marginPts < 5 ? " · close call" : "");
    marginEl.classList.toggle("is-close", marginPts < 5);

    renderSpread(ranked, colors, labels, dominant);
    renderDims(data.dimensions);
    renderMeters(data.raw_features, data.waveform_preview, data.duration, tone);

    nextFrame(() =>
      resultsSection.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" })
    );
  }

  /* init */
  setState("idle");
  updateSource();
  drawScope();
})();
