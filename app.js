// ===================== utilities & prefs (unchanged) =====================
function chooseExt() {
  const a = document.createElement('audio');
  return a.canPlayType('audio/ogg; codecs=opus') ? 'opus' : 'mp3';
}
const EXT = chooseExt();
const enc  = (s, ext = EXT) => `sounds/${encodeURIComponent(s)}.${ext}`;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ===================== global state (mostly unchanged) =====================
let ctx, masterGain, rainGain, bgGain, thunderGain;
let rainEQ = null;

// NEW: thunder-band shelves (apply only to thunder)
let thunderLowShelf = null;
let thunderHighShelf = null;

let rainSrc = null;
let activeManual = []; // [{src, g}]
let activeBg = [];     // [{src, g}]

let bgTimer = null;
let rainSwapTimer = null;

let manifest = null;

let sessionRunning = false;
let paused = false;

let timerInterval = null;
let elapsed = 0;
let sessionLength = 600; // seconds
let manualCount = 0;

// ===================== fetch helpers (unchanged) =====================
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  return res.json();
}
async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load audio ${url}`);
  const arr = await res.arrayBuffer();
  return await ctx.decodeAudioData(arr);
}
async function fetchBufferWithFallback(base) {
  try {
    return await fetchBuffer(enc(base, EXT));
  } catch {
    const alt = EXT === 'opus' ? 'mp3' : 'opus';
    return await fetchBuffer(enc(base, alt));
  }
}

// ===================== audio graph (revised wiring) =====================
async function initAudio() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  masterGain = ctx.createGain();
  masterGain.connect(ctx.destination);

  // Program busses
  rainGain    = ctx.createGain();
  bgGain      = ctx.createGain();
  thunderGain = ctx.createGain();

  // Master vol from UI (0..1)
  const masterVolEl = document.getElementById("masterVol");
  masterGain.gain.value = masterVolEl ? parseFloat(masterVolEl.value) : 0.25;

  // Bed levels (original values preserved)
  rainGain.gain.value    = 0.28;
  bgGain.gain.value      = 0.30;
  thunderGain.gain.value = 0.9;

  // Rain bus direct to master (optional rain low-rumble softener kept below)
  rainGain.connect(masterGain);
  bgGain.connect(masterGain); // bg thunder uses its own envelopes already

  // --- NEW: thunder shelves for "thunder intensity" controls ---
  thunderLowShelf  = ctx.createBiquadFilter();
  thunderHighShelf = ctx.createBiquadFilter();

  thunderLowShelf.type = "lowshelf";
  thunderLowShelf.frequency.value = 120; // rumbles

  thunderHighShelf.type = "highshelf";
  thunderHighShelf.frequency.value = 3000; // crack transients

  // Wire: thunderGain -> lowShelf -> highShelf -> master
  thunderGain.connect(thunderLowShelf);
  thunderLowShelf.connect(thunderHighShelf);
  thunderHighShelf.connect(masterGain);

  // Initialize shelf gains from current sliders (if present)
  applyThunderEQFromSliders();
}

// Optional rain low-rumble reducer on rain bus (unchanged behavior)
function applyLowFreqSoft(enabled) {
  if (!ctx) return;
  if (enabled) {
    if (!rainEQ) {
      rainEQ = ctx.createBiquadFilter();
      rainEQ.type = "lowshelf";
      rainEQ.frequency.value = 80;
      rainEQ.gain.value = -8;
      rainGain.disconnect();
      rainGain.connect(rainEQ);
      rainEQ.connect(masterGain);
    } else {
      rainEQ.gain.value = -8;
    }
  } else {
    if (rainEQ) {
      rainGain.disconnect();
      rainEQ.disconnect();
      rainEQ = null;
      rainGain.connect(masterGain);
    }
  }
}

// ===================== helpers for thunder shelves (NEW) =====================
// Map reduction percent → dB cut. 0% = 0 dB, 75% ≈ -24 dB.
function reductionToDb(percent) {
  const p = Math.max(0, Math.min(100, percent));
  return -24 * (p / 100);
}

function applyThunderEQFromSliders() {
  const lowEl  = document.getElementById("lowSlider");
  const highEl = document.getElementById("highSlider");
  if (!ctx || !thunderLowShelf || !thunderHighShelf) return;

  const lowPct  = lowEl  ? parseInt(lowEl.value, 10)  : 0;  // default no cut
  const highPct = highEl ? parseInt(highEl.value, 10) : 0;

  thunderLowShelf.gain.value  = reductionToDb(lowPct);
  thunderHighShelf.gain.value = reductionToDb(highPct);
}

// ===================== rain loop (unchanged) =====================
async function startRain(level) {
  if (rainSwapTimer) { clearTimeout(rainSwapTimer); rainSwapTimer = null; }
  if (rainSrc) { try { rainSrc.stop(); } catch {} rainSrc = null; }

  const list = manifest.rain?.[level] || manifest.rain?.["2"] || [];
  if (!list.length) {
    console.warn("No rain list for level", level);
    return;
  }

  const base = pick(list);
  let buf;
  try {
    buf = await fetchBufferWithFallback(base);
  } catch (e) {
    console.warn("[rain] failed to load", base, e);
    const candidates = list.filter(b => b !== base);
    for (const alt of candidates) {
      try { buf = await fetchBufferWithFallback(alt); break; } catch {}
    }
    if (!buf) { console.warn("[rain] nothing playable for level", level); return; }
  }

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.connect(rainGain);
  src.start();
  rainSrc = src;

  // rotate rain every 4–7 minutes
  const nextMs = 240000 + Math.random() * 180000;
  rainSwapTimer = setTimeout(() => {
    if (sessionRunning && !paused) startRain(level).catch(console.error);
  }, nextMs);
}

// ===================== manual thunder (unchanged) =====================
async function playThunder(which) {
  const group = manifest.manualThunder?.[which] || [];
  if (!group.length) return;

  const base = pick(group);
  let buf;
  try {
    buf = await fetchBufferWithFallback(base);
  } catch (e) {
    console.warn("[manual] missing", base, e);
    return;
  }

  const src = ctx.createBufferSource();
  src.buffer = buf;

  // anti-click envelope
  const g = ctx.createGain();
  g.gain.value = 0.0001;
  src.connect(g).connect(thunderGain);

  const now = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(1.0, now + 0.02);
  src.start(now);

  // soft tail to avoid clicks
  const dur = buf.duration;
  g.gain.setValueAtTime(1.0, now + Math.max(0, dur - 0.08));
  g.gain.linearRampToValueAtTime(0.0001, now + Math.max(0, dur - 0.02));

  // track & cleanup
  const rec = { src, g };
  activeManual.push(rec);
  src.onended = () => {
    try { g.disconnect(); } catch {}
    activeManual = activeManual.filter(r => r !== rec);
  };

  manualCount++;
  const lbl = document.getElementById("manualCounterLabel");
  if (lbl) lbl.textContent = "Manual Thunder: " + manualCount;
}

// ===================== background thunder (UPDATED to include Sound Ideas) =====================
function startBgThunder() {
  stopBgThunder(); // ensure single scheduler

  const schedule = (initial = false) => {
    const delay = initial ? (3 + Math.random() * 5) : (20 + Math.random() * 40);

    bgTimer = setTimeout(async () => {
      try {
        // NEW: merge default bg list + Sound Ideas list if present
        const pool = []
          .concat(manifest.bgThunder || [])
          .concat(manifest.soundIdeasThunder || []);

        if (!pool.length) {
          console.warn("[bg] no background thunder in manifest");
          schedule();
          return;
        }

        const base = pick(pool);
        console.log("[bg] trying:", base);

        let buf;
        try { buf = await fetchBufferWithFallback(base); }
        catch (e) { console.warn("[bg] missing:", base, e); schedule(); return; }

        const src = ctx.createBufferSource();
        src.buffer = buf;

        // soft, audible roll envelope
        const g = ctx.createGain();
        const target = 0.6 + Math.random() * 0.2;
        g.gain.value = 0.0001;
        src.connect(g).connect(thunderGain);

        const now = ctx.currentTime;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(target, now + 0.25);
        src.start(now);

        const dur = buf.duration;
        g.gain.setValueAtTime(target, now + Math.max(0, dur - 0.4));
        g.gain.linearRampToValueAtTime(0.0001, now + Math.max(0, dur - 0.05));

        const rec = { src, g };
        activeBg.push(rec);
        src.onended = () => {
          try { g.disconnect(); } catch {}
          activeBg = activeBg.filter(r => r !== rec);
        };
      } catch (e) {
        console.warn("[bg] error:", e);
      }
      schedule(); // next roll
    }, delay * 1000);
  };

  schedule(true); // kick first roll soon
}

function stopBgThunder() {
  if (bgTimer) { clearTimeout(bgTimer); bgTimer = null; }
  activeBg.forEach(({src}) => { try { src.stop(); } catch {} });
  activeBg = [];
}

// ===================== timer & session (unchanged) =====================
function startTimer() {
  clearInterval(timerInterval);
  elapsed = 0;
  timerInterval = setInterval(() => {
    elapsed++;
    const min = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const sec = String(elapsed % 60).padStart(2, "0");
    const timerEl = document.getElementById("timer");
    if (timerEl) timerEl.textContent = `${min}:${sec} / ${sessionLength/60}:00`;
    const pb = document.getElementById("progressBar");
    if (pb) pb.style.width = (elapsed / sessionLength) * 100 + "%";
    if (elapsed >= sessionLength) stopSession();
  }, 1000);
}

function hardStopAllAudio() {
  clearInterval(timerInterval); timerInterval = null;
  if (rainSwapTimer) { clearTimeout(rainSwapTimer); rainSwapTimer = null; }
  stopBgThunder();

  if (rainSrc) { try { rainSrc.stop(); } catch {} }
  rainSrc = null;

  activeManual.forEach(({src}) => { try { src.stop(); } catch {} });
  activeManual = [];
}

function stopSession() {
  sessionRunning = false;
  paused = false;
  hardStopAllAudio();

  const pauseBtn = document.getElementById("pauseBtn");
  const stopBtn  = document.getElementById("stopBtn");
  const startBtn = document.getElementById("startBtn");
  if (pauseBtn) pauseBtn.disabled = true;
  if (stopBtn)  stopBtn.disabled  = true;
  if (startBtn) startBtn.disabled = false;
  if (pauseBtn) pauseBtn.textContent = "Pause";
}

// ===================== UI wiring (revised to be tolerant) =====================
window.addEventListener("DOMContentLoaded", async () => {
  try {
    // Load from sounds/ to match your current project layout
    manifest = await fetchJSON('sounds/manifest.json');
  } catch (e) {
    console.error("manifest.json load failed", e);
    alert("Couldn't load sounds/manifest.json – please add it.");
    return;
  }

  await initAudio();

  // Init labels
  const mvEl = document.getElementById("masterVol");
  const mvOut = document.getElementById("masterVolOut");
  if (mvEl && mvOut) mvOut.textContent = Math.round(parseFloat(mvEl.value) * 100) + "%";

  const intensityEl = document.getElementById("intensity");
  const intensityOut = document.getElementById("intensityOut");
  if (intensityEl && intensityOut) intensityOut.textContent = `${parseInt(intensityEl.value,10)} / 5`;

  // Mode switch (show/hide manual panel)
  const modeRandom = document.getElementById("modeRandom");
  const modeManual = document.getElementById("modeManual");
  const manualRow = document.getElementById("manualRow");
  const manualCounterRow = document.getElementById("manualCounterRow");

  modeRandom?.addEventListener("change", () => {
    if (manualRow) manualRow.style.display = "none";
    if (manualCounterRow) manualCounterRow.style.display = "none";
  });
  modeManual?.addEventListener("change", () => {
    if (manualRow) manualRow.style.display = "";
    if (manualCounterRow) manualCounterRow.style.display = "";
  });

  // Manual thunder buttons
  document.getElementById("btnDistant")?.addEventListener("click", () => playThunder("roll"));
  document.getElementById("btnClose")?.addEventListener("click", () => playThunder("close"));

  // Master volume
  mvEl?.addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    masterGain.gain.value = v;
    if (mvOut) mvOut.textContent = Math.round(v * 100) + "%";
  });

  // Intensity changes (if present): swap rain immediately
  intensityEl?.addEventListener("input", (e) => {
    const val = parseInt(e.target.value, 10);
    if (intensityOut) intensityOut.textContent = val + " / 5";
    if (sessionRunning && !paused) startRain(val).catch(console.error);
  });

  // Low-rumble softener (if present)
  const softEl = document.getElementById("lowFreqSoft");
  softEl?.addEventListener("change", (e) => {
    applyLowFreqSoft(e.target.checked);
  });
  if (softEl) applyLowFreqSoft(softEl.checked); // default when present

  // --- NEW: thunder intensity sliders (low/high shelves) ---
  const lowEl  = document.getElementById("lowSlider");
  const highEl = document.getElementById("highSlider");
  function updateThunderShelvesFromUI() {
    applyThunderEQFromSliders();
  }
  lowEl?.addEventListener("input", updateThunderShelvesFromUI);
  highEl?.addEventListener("input", updateThunderShelvesFromUI);
  // initialize once more after listeners
  applyThunderEQFromSliders();

  // Start
  document.getElementById("startBtn")?.addEventListener("click", async () => {
    await ctx.resume();
    const minsSel = document.getElementById("sessionMins");
    sessionLength = parseInt(minsSel?.value ?? "10", 10) * 60;

    // Use intensity if present; otherwise default to level 2
    const level = intensityEl ? parseInt(intensityEl.value, 10) : 2;
    await startRain(level);

    if (modeRandom?.checked) startBgThunder();
    else                     stopBgThunder();

    manualCount = 0;
    const lbl = document.getElementById("manualCounterLabel");
    if (lbl) lbl.textContent = "Manual Thunder: 0";
    startTimer();

    sessionRunning = true;
    paused = false;
    const pauseBtn = document.getElementById("pauseBtn");
    const stopBtn  = document.getElementById("stopBtn");
    const startBtn = document.getElementById("startBtn");
    if (pauseBtn) pauseBtn.disabled = false;
    if (stopBtn)  stopBtn.disabled  = false;
    if (startBtn) startBtn.disabled = true;
  });

  // Pause/Resume
  document.getElementById("pauseBtn")?.addEventListener("click", async (e) => {
    if (!sessionRunning) return;
    if (!paused) {
      await ctx.suspend();
      clearInterval(timerInterval);
      e.target.textContent = "Resume";
      paused = true;
    } else {
      await ctx.resume();
      startTimer();
      e.target.textContent = "Pause";
      paused = false;
    }
  });

  // Stop
  document.getElementById("stopBtn")?.addEventListener("click", () => {
    stopSession();
  });

  // Timer label initial
  const sel = document.getElementById("sessionMins");
  const mins = parseInt(sel?.value ?? "10", 10);
  const timerEl = document.getElementById("timer");
  if (timerEl) timerEl.textContent = `00:00 / ${mins}:00`;
  sel?.addEventListener("change", (e) => {
    const m = parseInt(e.target.value, 10);
    if (!sessionRunning) {
      if (timerEl) timerEl.textContent = `00:00 / ${m}:00`;
      const pb = document.getElementById("progressBar");
      if (pb) pb.style.width = "0%";
    }
  });
});

// ======= global error logs (unchanged) =======
window.addEventListener('error', e => console.error('Global error:', e.message));
window.addEventListener('unhandledrejection', e => console.error('Unhandled promise:', e.reason));
