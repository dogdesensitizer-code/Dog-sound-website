// pick Opus if possible, fallback to MP3
function chooseExt() {
  const a = document.createElement('audio');
  return a.canPlayType('audio/ogg; codecs=opus') ? 'opus' : 'mp3';
}
const EXT = chooseExt();

const manifest = {
  rain: {
    1: "QP03 0292 Rain quiet light tone",
    2: "QP03 0295 Rain light consistent leaves",
    3: "QP03 0300 Rain strong consistent",
    4: "QP03 0302 Rain downpour fast",
    5: "QP03 0302 Rain downpour fast" // reuse for max
  },
  bgThunder: [
    "QP03 0283 Thunder distant slow long",
    "QP03 0287 Thunder very distant"
  ],
  manualThunder: {
    distant: "QP03 0280 Thunder moderately distant rolling",
    close: "QP03 0270 Thunder close"
  }
};

let ctx, masterGain, rainGain, bgGain, thunderGain;
let rainSrc;
let timerInterval;
let elapsed = 0;
let sessionLength = 600; // seconds

async function initAudio() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = ctx.createGain();
  masterGain.gain.value = parseFloat(document.getElementById("masterVol").value);
  masterGain.connect(ctx.destination);

  rainGain = ctx.createGain();
  bgGain = ctx.createGain();
  thunderGain = ctx.createGain();

  rainGain.connect(masterGain);
  bgGain.connect(masterGain);
  thunderGain.connect(masterGain);
}

function fileURL(base) {
  return `/sounds/${encodeURIComponent(base)}.${EXT}`;
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  const arr = await res.arrayBuffer();
  return await ctx.decodeAudioData(arr);
}

// ---- Rain loop ----
async function startRain(level) {
  if (rainSrc) { try { rainSrc.stop(); } catch {} }
  const base = manifest.rain[level];
  const buf = await fetchBuffer(fileURL(base));
  rainSrc = ctx.createBufferSource();
  rainSrc.buffer = buf;
  rainSrc.loop = true;
  rainSrc.connect(rainGain);
  rainGain.gain.value = 0.35;
  rainSrc.start();
}

// ---- Manual thunder ----
async function playThunder(which) {
  const base = manifest.manualThunder[which];
  const buf = await fetchBuffer(fileURL(base));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(thunderGain);
  src.start();
  manualCount++;
  document.getElementById("manualCounterLabel").textContent =
    "Manual Thunder: " + manualCount;
}

// ---- Background random thunder ----
function startBgThunder() {
  const schedule = async () => {
    const delay = 20 + Math.random() * 40; // 20–60s between rolls
    setTimeout(async () => {
      const pick = manifest.bgThunder[Math.floor(Math.random() * manifest.bgThunder.length)];
      try {
        const buf = await fetchBuffer(fileURL(pick));
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(bgGain);

        // slightly louder so it's audible under rain
        bgGain.gain.value = 0.25 + Math.random() * 0.1; // 0.25–0.35

        src.start();
      } catch (err) {
        console.error("bg thunder load error", err);
      }
      schedule();
    }, delay * 1000);
  };
  schedule();
}

// ---- Session timer ----
function startTimer() {
  clearInterval(timerInterval);
  elapsed = 0;
  timerInterval = setInterval(() => {
    elapsed++;
    const min = Math.floor(elapsed / 60).toString().padStart(2, "0");
    const sec = (elapsed % 60).toString().padStart(2, "0");
    document.getElementById("timer").textContent =
      `${min}:${sec} / ${sessionLength/60}:00`;
    const pct = (elapsed / sessionLength) * 100;
    document.getElementById("progressBar").style.width = pct + "%";
    if (elapsed >= sessionLength) stopSession();
  }, 1000);
}

function stopSession() {
  clearInterval(timerInterval);
  if (rainSrc) { try { rainSrc.stop(); } catch {} }
  document.getElementById("pauseBtn").disabled = true;
  document.getElementById("stopBtn").disabled = true;
  document.getElementById("startBtn").disabled = false;
}

// ---- UI wiring ----
let manualCount = 0;

window.addEventListener("DOMContentLoaded", () => {
  initAudio();

  // Mode switch
  document.getElementById("modeRandom").addEventListener("change", e => {
    document.getElementById("manualRow").style.display = "none";
    document.getElementById("manualCounterRow").style.display = "none";
  });
  document.getElementById("modeManual").addEventListener("change", e => {
    document.getElementById("manualRow").style.display = "";
    document.getElementById("manualCounterRow").style.display = "";
  });

  // Manual thunder
  document.getElementById("btnDistant").addEventListener("click", () => playThunder("distant"));
  document.getElementById("btnClose").addEventListener("click", () => playThunder("close"));

  // Master volume
  document.getElementById("masterVol").addEventListener("input", e => {
    masterGain.gain.value = parseFloat(e.target.value);
    document.getElementById("masterVolOut").textContent =
      Math.round(parseFloat(e.target.value) * 100) + "%";
  });

  // Intensity slider
  document.getElementById("intensity").addEventListener("input", e => {
    const val = parseInt(e.target.value);
    document.getElementById("intensityOut").textContent = val + " / 5";
  });

  // Start/Pause/Stop
  document.getElementById("startBtn").addEventListener("click", async () => {
    await ctx.resume();
    sessionLength = parseInt(document.getElementById("sessionMins").value) * 60;
    startRain(parseInt(document.getElementById("intensity").value));
    if (document.getElementById("modeRandom").checked) {
      startBgThunder();
    }
    startTimer();
    manualCount = 0;
    document.getElementById("pauseBtn").disabled = false;
    document.getElementById("stopBtn").disabled = false;
    document.getElementById("startBtn").disabled = true;
  });

  document.getElementById("pauseBtn").addEventListener("click", () => {
    ctx.suspend();
    clearInterval(timerInterval);
  });
  document.getElementById("stopBtn").addEventListener("click", () => {
    stopSession();
  });
});
