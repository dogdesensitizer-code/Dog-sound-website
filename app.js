// Minimal audio engine with fade in/out and randomized intervals
// Uses HTMLAudioElement for simplicity (works locally).

const presets = {
  beginner:  { volume: 0.25, fadeInMs: 800,  fadeOutMs: 600,  delayMinSec: 30, delayMaxSec: 60 },
  gentle:    { volume: 0.35, fadeInMs: 600,  fadeOutMs: 500,  delayMinSec: 20, delayMaxSec: 40 },
  moderate:  { volume: 0.50, fadeInMs: 400,  fadeOutMs: 400,  delayMinSec: 12, delayMaxSec: 24 },
};

const els = {
  volume: document.getElementById('volume'),
  fadeInMs: document.getElementById('fadeInMs'),
  fadeOutMs: document.getElementById('fadeOutMs'),
  delayMinSec: document.getElementById('delayMinSec'),
  delayMaxSec: document.getElementById('delayMaxSec'),
  playBtn: document.getElementById('playBtn'),
  stopBtn: document.getElementById('stopBtn'),
  status: document.getElementById('status'),
  year: document.getElementById('year'),
};

document.getElementById('year').textContent = new Date().getFullYear();

let isPlaying = false;
let currentAudio = null;
let nextTimer = null;

function logStatus(message) {
  els.status.textContent = message;
  console.log(message);
}

function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

function applyMode(mode) {
  const p = presets[mode];
  if (!p) return;
  els.volume.value = p.volume;
  els.fadeInMs.value = p.fadeInMs;
  els.fadeOutMs.value = p.fadeOutMs;
  els.delayMinSec.value = p.delayMinSec;
  els.delayMaxSec.value = p.delayMaxSec;
  logStatus(`Mode set: ${mode}`);
}

for (const btn of document.querySelectorAll('.mode-btn')) {
  btn.addEventListener('click', () => applyMode(btn.dataset.mode));
}

function getSelectedSoundPath() {
  const checked = document.querySelector('input[name="sound"]:checked');
  if (!checked) return null;
  return `sounds/${checked.value}`;
}

async function fadeVolume(audio, from, to, durationMs) {
  return new Promise((resolve) => {
    const steps = Math.max(1, Math.floor(durationMs / 16));
    let i = 0;
    const start = performance.now();
    audio.volume = from;
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / durationMs);
      audio.volume = from + (to - from) * t;
      if (++i >= steps || t >= 1) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function playOnce() {
  const path = getSelectedSoundPath();
  if (!path) {
    logStatus('No sound selected.');
    return;
  }

  // Stop any previous
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  const volume = parseFloat(els.volume.value || '0.25');
  const fadeInMs = parseInt(els.fadeInMs.value || '400', 10);
  const fadeOutMs = parseInt(els.fadeOutMs.value || '400', 10);

  const audio = new Audio(path);
  audio.loop = false;
  audio.volume = 0.0001; // start silent
  currentAudio = audio;

  audio.addEventListener('error', () => {
    logStatus('Could not load audio. Make sure your file exists in /sounds.');
  });

  // Some browsers need a user gesture; clicking Play button counts
  try {
    await audio.play();
    await fadeVolume(audio, 0.0001, volume, fadeInMs);
    logStatus('Playing…');
  } catch (e) {
    logStatus('Click anywhere on the page, then press Play again.');
    return;
  }

  audio.addEventListener('ended', async () => {
    // If ended naturally, we’re done here
  });

  // Schedule fade-out near the end (approximate with 85% of duration if available)
  const tryFadeOut = () => {
    // If metadata available, schedule a timeout before end. Otherwise, do nothing.
    if (!isFinite(audio.duration) || audio.duration <= 0) return;
    const msBeforeEnd = Math.max(0, (audio.duration * 1000) - fadeOutMs - 100);
    setTimeout(async () => {
      await fadeVolume(audio, audio.volume, 0.0001, fadeOutMs);
      audio.pause();
      audio.currentTime = 0;
      logStatus('Finished.');
    }, msBeforeEnd);
  };

  // If we have metadata now, schedule fade; else wait for it
  if (isFinite(audio.duration) && audio.duration > 0) tryFadeOut();
  else audio.addEventListener('loadedmetadata', tryFadeOut);
}

function scheduleNext() {
  const min = parseInt(els.delayMinSec.value || '10', 10);
  const max = parseInt(els.delayMaxSec.value || '20', 10);
  const delayMs = Math.round(randRange(min, max) * 1000);
  logStatus(`Waiting ~${Math.round(delayMs / 1000)}s before next play…`);
  nextTimer = setTimeout(async () => {
    if (!isPlaying) return;
    await playOnce();
    scheduleNext();
  }, delayMs);
}

els.playBtn.addEventListener('click', async () => {
  if (isPlaying) return;
  isPlaying = true;
  await playOnce();
  scheduleNext();
});

els.stopBtn.addEventListener('click', () => {
  isPlaying = false;
  if (nextTimer) { clearTimeout(nextTimer); nextTimer = null; }
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  logStatus('Stopped.');
});
