// Calm Dog Thunder – thunderstorm-only engine (paths fixed for ./sounds)
let ctx, masterGain, softShelf, compressor, panner, rainNode;
let rainBuffer;
let thunderBuffers = [];
let session = { running:false, startedAt:0, durationSec:600, timerId:null, thunderTimer:null };
const $ = sel => document.querySelector(sel);
manualCounterRow.style.display = (playMode === 'manual') ? 'flex' : 'none';

// DOM elements
const startBtn = $('#startBtn');
const pauseBtn = $('#pauseBtn');
const stopBtn  = $('#stopBtn');
const intensity = $('#intensity');
const intensityOut = $('#intensityOut');
const masterVol = $('#masterVol');
const masterVolOut = $('#masterVolOut');
const lowFreqSoft = $('#lowFreqSoft');
const sessionMins = $('#sessionMins');
const timer = $('#timer');
const progressBar = $('#progressBar');
const modeRandom = document.getElementById('modeRandom');
const modeManual = document.getElementById('modeManual');
const manualRow  = document.getElementById('manualRow');
let manualThunderCount = 0;

const btnDistant = document.getElementById('btnDistant');
const btnClose   = document.getElementById('btnClose');

let playMode = 'random'; // 'random' | 'manual'

function setMode(mode){
  playMode = mode;
  manualRow.style.display = (playMode === 'manual') ? 'flex' : 'none';
  // In manual mode, intensity is not used; you can disable slider if you want:
  // intensity.disabled = (playMode === 'manual');
  persist();
}

modeRandom?.addEventListener('change', ()=>{ if(modeRandom.checked) setMode('random'); });
modeManual?.addEventListener('change', ()=>{ if(modeManual.checked) setMode('manual'); });

// load persisted mode (extend your loadPersisted)
function loadPersisted(){
  const s = JSON.parse(localStorage.getItem('cdt_settings')||'{}');
  if(s.intensity) intensity.value = s.intensity;
  if(s.masterVol) masterVol.value = s.masterVol;
  if(typeof s.lowFreqSoft === 'boolean') lowFreqSoft.checked = s.lowFreqSoft;
  if(s.playMode) {
    if(s.playMode === 'manual') { modeManual.checked = true; setMode('manual'); }
    else { modeRandom.checked = true; setMode('random'); }
  } else {
    setMode('random');
  }
  updateReadouts();
}

function persist(){
  localStorage.setItem('cdt_settings', JSON.stringify({
    intensity: intensity.value,
    masterVol: masterVol.value,
    lowFreqSoft: lowFreqSoft.checked,
    playMode
  }));
}

function loadPersisted(){
  const s = JSON.parse(localStorage.getItem('cdt_settings')||'{}');
  if(s.intensity) intensity.value = s.intensity;
  if(s.masterVol) masterVol.value = s.masterVol;
  if(typeof s.lowFreqSoft === 'boolean') lowFreqSoft.checked = s.lowFreqSoft;
  updateReadouts();
}
function persist(){
  localStorage.setItem('cdt_settings', JSON.stringify({
    intensity: intensity.value,
    masterVol: masterVol.value,
    lowFreqSoft: lowFreqSoft.checked
  }));
}
function updateReadouts(){
  intensityOut.textContent = `${intensity.value} / 5`;
  masterVolOut.textContent = `${Math.round(masterVol.value * 100)}%`;
}

async function ensureAudio(){
  if(ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive", sampleRate: 48000 });

  // Main chain
  masterGain = ctx.createGain();
  masterGain.gain.value = parseFloat(masterVol.value);

  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 12;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.25;

  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 80;
  highpass.Q.value = 0.707;

  softShelf = ctx.createBiquadFilter();
  softShelf.type = 'lowshelf';
  softShelf.frequency.value = 200;
  softShelf.gain.value = lowFreqSoft.checked ? -3 : 0;

  panner = ctx.createStereoPanner();
  panner.pan.value = 0;

  masterGain.connect(softShelf).connect(highpass).connect(compressor).connect(ctx.destination);

  // Load buffers from ./sounds folder
  [rainBuffer, ...thunderBuffers] = await Promise.all([
    fetchDecodeBuffer(['./sounds/rain_bed_v2.ogg?v=2','./sounds/rain_bed_v2.mp3?v=2']),
    fetchDecodeBuffer('./sounds/thunder_distant_01.mp3?v=2'),
    fetchDecodeBuffer('./sounds/thunder_distant_02.mp3?v=2'),
    fetchDecodeBuffer('./sounds/thunder_close_01.mp3?v=2'),
    fetchDecodeBuffer('./sounds/thunder_close_02.mp3?v=2')
  ]);
}

async function fetchDecodeBuffer(urls) {
  const list = Array.isArray(urls) ? urls : [urls];
  let lastErr;
  for (const u of list) {
    try {
      const res = await fetch(u, { cache:'force-cache' });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status} ${u}`); continue; }
      const arr = await res.arrayBuffer();
      const buf = await (ctx || new AudioContext()).decodeAudioData(arr);
      return buf;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Failed to load: ' + list.join(', '));
}

function createLoopNode(buffer){
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(gain).connect(panner).connect(masterGain);
  src.start();
  rampTo(gain.gain, 0.35, 2.0);
  return { src, gain };
}

function rampTo(param, target, seconds){
  const t = ctx.currentTime;
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.linearRampToValueAtTime(target, t + seconds);
}

function scheduleThunder(){
  clearTimeout(session.thunderTimer);
  if(!session.running) return;

  const level = parseInt(intensity.value,10);
  const table = {
    1: { min:12, max:22, closeChance:0.05, gain:0.22 },
    2: { min:9,  max:16, closeChance:0.12, gain:0.28 },
    3: { min:7,  max:12, closeChance:0.18, gain:0.34 },
    4: { min:5,  max:10, closeChance:0.25, gain:0.38 },
    5: { min:4,  max:8,  closeChance:0.32, gain:0.42 }
  };
  const cfg = table[level];
  const isClose = Math.random() < cfg.closeChance;
  const pool = thunderBuffers.slice(isClose ? 3 : 1, isClose ? thunderBuffers.length : 3);
  const buf = pool[Math.floor(Math.random()*pool.length)];
  const panVal = (Math.random()*1.2 - 0.6) * (isClose ? 1 : 0.6);

  playOneShot(buf, { gain: cfg.gain * (isClose ? 1.05 : 0.9), pan: panVal });

  const nextIn = rand(cfg.min, cfg.max) * 1000;
  session.thunderTimer = setTimeout(scheduleThunder, nextIn);
}

function playOneShot(buffer, { gain=0.3, pan=0 }={}){
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const g = ctx.createGain();
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  g.gain.value = 0.0001;
  src.connect(g).connect(p).connect(masterGain);

  const now = ctx.currentTime;
  const dur = buffer.duration;
  const target = Math.min(gain, 0.6);
  g.gain.setValueAtTime(g.gain.value, now);
  g.gain.linearRampToValueAtTime(target, now + 0.15);
  g.gain.setValueAtTime(target, now + Math.max(0, dur - 0.25));
  g.gain.linearRampToValueAtTime(0.0001, now + Math.max(0.01, dur - 0.05));
  src.start(now);
  src.stop(now + dur + 0.1);
}

function rand(min, max){ return Math.random() * (max - min) + min; }

function startSession(){
  session.durationSec = parseInt(sessionMins.value,10) * 60;
  session.startedAt = performance.now();
  session.running = true;

  startBtn.disabled = true; pauseBtn.disabled = false; stopBtn.disabled = false;
  ctx.resume();

  if(!rainNode){
    rainNode = createLoopNode(rainBuffer);
  } else {
    rampTo(rainNode.gain.gain, 0.35, 1.0);
  }

  softShelf.gain.value = lowFreqSoft.checked ? -3 : 0;
  masterGain.gain.value = parseFloat(masterVol.value);

  clearTimeout(session.thunderTimer);
  if (playMode === 'random') {
    scheduleThunder();   // ← only in random mode
  }

  clearInterval(session.timerId);
  session.timerId = setInterval(tick, 200);

  manualThunderCount = 0;
  manualCounterLabel.textContent = `Manual Thunder: 0`;

}


function pauseSession(){
  if(!session.running) return;
  session.running = false;
  pauseBtn.disabled = true; startBtn.disabled = false;
  clearTimeout(session.thunderTimer);
  if(rainNode) rampTo(rainNode.gain.gain, 0.08, 0.6);
}

function stopSession(){
  session.running = false;
  startBtn.disabled = false; pauseBtn.disabled = true; stopBtn.disabled = true;
  clearTimeout(session.thunderTimer);
  clearInterval(session.timerId);
  progressBar.style.width = '0%';
  timer.textContent = `00:00 / ${minsToMMSS(session.durationSec/60)}`;
  if(rainNode){
    rampTo(rainNode.gain.gain, 0.0001, 0.8);
    setTimeout(()=>{ try{ rainNode.src.stop(); }catch{} rainNode=null; }, 900);
  }
}

function tick(){
  const elapsed = Math.min((performance.now() - session.startedAt)/1000, session.durationSec);
  const remain = session.durationSec - elapsed;
  const pct = (elapsed / session.durationSec) * 100;
  progressBar.style.width = `${pct}%`;
  timer.textContent = `${toMMSS(elapsed)} / ${minsToMMSS(session.durationSec/60)}`;
  if(remain <= 0){
    stopSession();
  }
}

function toMMSS(sec){
  sec = Math.max(0, sec);
  const m = Math.floor(sec/60);
  const s = Math.floor(sec%60);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function minsToMMSS(min){ return `${String(min).padStart(2,'0')}:00`; }

// Event bindings
window.addEventListener('load', loadPersisted);
intensity.addEventListener('input', ()=>{ updateReadouts(); persist(); });
masterVol.addEventListener('input', ()=>{ updateReadouts(); if(masterGain) masterGain.gain.value = parseFloat(masterVol.value); persist(); });
lowFreqSoft.addEventListener('change', ()=>{ if(softShelf) softShelf.gain.value = lowFreqSoft.checked ? -3 : 0; persist(); });
sessionMins.addEventListener('change', ()=>{ timer.textContent = `00:00 / ${minsToMMSS(sessionMins.value)}`; });

startBtn.addEventListener('click', async ()=>{
  await ensureAudio();
  pauseBtn.disabled = false; stopBtn.disabled = false;
  startSession();
});
pauseBtn.addEventListener('click', ()=>{ pauseSession(); });
stopBtn.addEventListener('click', ()=>{ stopSession(); });
btnDistant?.addEventListener('click', ()=>{
  if(!ctx || !thunderBuffers.length) return;
  const pool = thunderBuffers.slice(1, 3); // distant sounds
  const buf = pool[Math.floor(Math.random()*pool.length)];
  const levelMap = [0,0.24,0.28,0.32,0.36,0.40];
  const lvl = levelMap[parseInt(intensity.value,10)] || 0.28;
  playOneShot(buf, { gain: Math.min(lvl, 0.45), pan: (Math.random()*0.8 - 0.4) });

  manualThunderCount++;
  manualCounterLabel.textContent = `Manual Thunder: ${manualThunderCount}`;
});

btnClose?.addEventListener('click', ()=>{
  if(!ctx || !thunderBuffers.length) return;
  const pool = thunderBuffers.slice(3); // close sounds
  const buf = pool[Math.floor(Math.random()*pool.length)];
  const levelMap = [0,0.30,0.34,0.38,0.42,0.46];
  const lvl = levelMap[parseInt(intensity.value,10)] || 0.38;
  playOneShot(buf, { gain: Math.min(lvl, 0.50), pan: (Math.random()*1.2 - 0.6) });

  manualThunderCount++;
  manualCounterLabel.textContent = `Manual Thunder: ${manualThunderCount}`;
});


document.addEventListener('keydown', e=>{
  if((e.key === ' ' || e.key === 'Enter') && document.activeElement === startBtn && !startBtn.disabled){
    e.preventDefault(); startBtn.click();
  }
});
