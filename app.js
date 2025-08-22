// ===================== utilities & prefs =====================
function chooseExt() {
  const a = document.createElement('audio');
  return a.canPlayType('audio/ogg; codecs=opus') ? 'opus' : 'mp3';
}
const EXT = chooseExt();
const enc = (s) => `sounds/${encodeURIComponent(s)}.${EXT}`;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ===================== global state =====================
let ctx, masterGain, rainGain, bgGain, thunderGain;
let rainEQ = null;

let rainSrc = null;
let activeManual = []; // currently playing manual thunder sources
let activeBg = [];     // currently playing background thunder sources

let bgTimer = null;
let rainSwapTimer = null;

let manifest = null;

let sessionRunning = false;
let paused = false;

let timerInterval = null;
let elapsed = 0;
let sessionLength = 600; // seconds
let manualCount = 0;

// ===================== fetch helpers =====================
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

// ===================== audio graph =====================
async function initAudio() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  masterGain = ctx.createGain();
  masterGain.connect(ctx.destination);

  rainGain = ctx.createGain();
  bgGain = ctx.createGain();
  thunderGain = ctx.createGain();

  masterGain.gain.value = parseFloat(document.getElementById("masterVol").value);
  rainGain.gain.value = 0.28;   // bed kept soft
  bgGain.gain.value = 0.24;     // soft background rolls
  thunderGain.gain.value = 0.9; // punchy manual thunder

  rainGain.connect(masterGain);
  bgGain.connect(masterGain);
  thunderGain.connect(masterGain);
}

// optional low-rumble reducer on rain bus
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

// ===================== rain loop =====================
async function startRain(level) {
  if (rainSwapTimer) { clearTimeout(rainSwapTimer); rainSwapTimer = null; }
  if (rainSrc) { try { rainSrc.stop(); } catch {} rainSrc = null; }

  const list = manifest.rain?.[level] || manifest.rain?.["2"] || [];
  if (!list.length) return;

  const base = pick(list);
  const buf = await fetchBuffer(enc(base));

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

// ===================== manual thunder (no ducking) =====================
async function playThunder(which) {
  const group = manifest.manualThunder?.[which] || [];
  if (!group.length) return;

  const base = pick(group);
  const buf = await fetchBuffer(enc(base));

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

  // fade tail to avoid clicks
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
  document.getElementById("manualCounterLabel").textContent =
    "Manual Thunder: " + manualCount;
}

// ===================== background thunder =====================
function startBgThunder() {
  stopBgThunder();
  const schedule = () => {
    const delay = 20 + Math.random() * 40; // 20–60s
    bgTimer = setTimeout(async () => {
      try {
        const list = manifest.bgThunder || [];
        if (!list.length) { schedule(); return; }

        const base = pick(list);
        const buf = await fetchBuffer(enc(base));

        const src = ctx.createBufferSource();
        src.buffer = buf;

        const g = ctx.createGain();
        const target = 0.20 + Math.random() * 0.10; // 0.20–0.30
        g.gain.value = 0.0001;
        src.connect(g).connect(bgGain);

        const now = ctx.currentTime;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(target, now + 0.25);
        src.start(now);

        const dur = buf.duration;
        g.gain.setValueAtTime(target, now + Math.max(0, dur - 0.4));
        g.gain.linearRampToValueAtTime(0.0001, now + Math.max(0, dur - 0.05));

        // track & cleanup
        const rec = { src, g };
        activeBg.push(rec);
        src.onended = () => {
          try { g.disconnect(); } catch {}
          activeBg = activeBg.filter(r => r !== rec);
        };
      } catch (e) {
        console.warn("bg thunder error", e);
      }
      schedule();
    }, delay * 1000);
  };
  schedule();
}
function stopBgThunder() {
  if (bgTimer) { clearTimeout(bgTimer); bgTimer = null; }
  // stop any currently playing bg rolls
  activeBg.forEach(({src}) => { try { src.stop(); } catch {} });
  activeBg = [];
}

// ===================== timer & session =====================
function startTimer() {
  clearInterval(timerInterval);
  elapsed = 0;
  timerInterval = setInterval(() => {
    elapsed++;
    const min = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const sec = String(elapsed % 60).padStart(2, "0");
    document.getElementById("timer").textContent =
      `${min}:${sec} / ${sessionLength/60}:00`;
    document.getElementById("progressBar").style.width =
      (elapsed / sessionLength) * 100 + "%";
    if (elapsed >= sessionLength) stopSession();
  }, 1000);
}

function hardStopAllAudio() {
  // stop timers
  clearInterval(timerInterval); timerInterval = null;
  if (rainSwapTimer) { clearTimeout(rainSwapTimer); rainSwapTimer = null; }
  stopBgThunder();

  // stop sources
  if (rainSrc) { try { rainSrc.stop(); } catch {} }
  rainSrc = null;

  activeManual.forEach(({src}) => { try { src.stop(); } catch {} });
  activeManual = [];
}

function stopSession() {
  sessionRunning = false;
  paused = false;
  hardStopAllAudio();

  // reset UI
  document.getElementById("pauseBtn").disabled = true;
  document.getElementById("stopBtn").disabled = true;
  document.getElementById("startBtn").disabled = false;
  document.getElementById("pauseBtn").textContent = "Pause";
}

// ===================== UI wiring =====================
window.addEventListener("DOMContentLoaded", async () => {
  try {
    manifest = await fetchJSON('sounds/manifest.json');
  } catch (e) {
    console.error("manifest.json load failed", e);
    alert("Couldn't load sounds/manifest.json – please add it.");
    return;
  }

  await initAudio();

  // init UI labels
  const mv = parseFloat(document.getElementById("masterVol").value);
  document.getElementById("masterVolOut").textContent = Math.round(mv * 100) + "%";
  const iv = parseInt(document.getElementById("intensity").value, 10);
  document.getElementById("intensityOut").textContent = iv + " / 5";

  // mode switch (show/hide manual panel)
  document.getElementById("modeRandom").addEventListener("change", () => {
    document.getElementById("manualRow").style.display = "none";
    document.getElementById("manualCounterRow").style.display = "none";
  });
  document.getElementById("modeManual").addEventListener("change", () => {
    document.getElementById("manualRow").style.display = "";
    document.getElementById("manualCounterRow").style.display = "";
  });

  // manual thunder buttons
  document.getElementById("btnDistant").addEventListener("click", () => playThunder("roll"));
  document.getElementById("btnClose").addEventListener("click", () => playThunder("close"));

  // master volume
  document.getElementById("masterVol").addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    masterGain.gain.value = v;
    document.getElementById("masterVolOut").textContent = Math.round(v * 100) + "%";
  });

  // intensity changes: swap rain immediately if running
  document.getElementById("intensity").addEventListener("input", (e) => {
    const val = parseInt(e.target.value, 10);
    document.getElementById("intensityOut").textContent = val + " / 5";
    if (sessionRunning && !paused) startRain(val).catch(console.error);
  });

  // low-rumble softener
  document.getElementById("lowFreqSoft").addEventListener("change", (e) => {
    applyLowFreqSoft(e.target.checked);
  });
  applyLowFreqSoft(document.getElementById("lowFreqSoft").checked);

  // start
  document.getElementById("startBtn").addEventListener("click", async () => {
    await ctx.resume();
    sessionLength = parseInt(document.getElementById("sessionMins").value, 10) * 60;

    const level = parseInt(document.getElementById("intensity").value, 10);
    await startRain(level);

    if (document.getElementById("modeRandom").checked) startBgThunder();
    else stopBgThunder();

    manualCount = 0;
    document.getElementById("manualCounterLabel").textContent = "Manual Thunder: 0";
    startTimer();

    sessionRunning = true;
    paused = false;
    document.getElementById("pauseBtn").disabled = false;
    document.getElementById("stopBtn").disabled = false;
    document.getElementById("startBtn").disabled = true;
  });

  // pause/resume
  document.getElementById("pauseBtn").addEventListener("click", async (e) => {
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

  // stop
  document.getElementById("stopBtn").addEventListener("click", () => {
    stopSession();
  });

  // timer label initial
  const sel = document.getElementById("sessionMins");
  const mins = parseInt(sel.value, 10);
  document.getElementById("timer").textContent = `00:00 / ${mins}:00`;
  sel.addEventListener("change", (e) => {
    const m = parseInt(e.target.value, 10);
    if (!sessionRunning) {
      document.getElementById("timer").textContent = `00:00 / ${m}:00`;
      document.getElementById("progressBar").style.width = "0%";
    }
  });
});
