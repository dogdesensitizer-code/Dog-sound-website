// -------- utilities --------
function chooseExt() {
  const a = document.createElement('audio');
  return a.canPlayType('audio/ogg; codecs=opus') ? 'opus' : 'mp3';
}
const EXT = chooseExt();
const enc  = (s, ext = EXT) => `sounds/${encodeURIComponent(s)}.${ext}`;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// -------- state --------
let ctx, masterGain, rainGain, bgGain, thunderGain;
let rainEQ = null;
let thunderLowShelf = null;
let thunderHighShelf = null;
let rainSrc = null;
let activeManual = [];
let activeBg = [];
let bgTimer = null, rainSwapTimer = null;
let manifest = null;
let sessionRunning = false, paused = false;
let timerInterval = null, elapsed = 0, sessionLength = 600;
let manualCount = 0;

// -------- fetch helpers --------
async function fetchJSON(url){ const r=await fetch(url); if(!r.ok) throw new Error(url); return r.json(); }
async function fetchBuffer(url){
  const r=await fetch(url); if(!r.ok) throw new Error(url);
  return await ctx.decodeAudioData(await r.arrayBuffer());
}
async function fetchBufferWithFallback(base){
  try { return await fetchBuffer(enc(base, EXT)); }
  catch { const alt = EXT==='opus'?'mp3':'opus'; return await fetchBuffer(enc(base, alt)); }
}

// -------- audio graph --------
async function initAudio(){
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = ctx.createGain(); masterGain.connect(ctx.destination);
  rainGain = ctx.createGain(); bgGain = ctx.createGain(); thunderGain = ctx.createGain();

  const masterVolEl = document.getElementById('masterVol');
  masterGain.gain.value = masterVolEl ? parseFloat(masterVolEl.value) : 0.25;

  rainGain.gain.value = 0.28; bgGain.gain.value = 0.30; thunderGain.gain.value = 0.9;
  rainGain.connect(masterGain); bgGain.connect(masterGain);

  // Thunder shelves (apply only to thunder bus)
  thunderLowShelf  = ctx.createBiquadFilter();  thunderLowShelf.type  = 'lowshelf';  thunderLowShelf.frequency.value = 120;
  thunderHighShelf = ctx.createBiquadFilter();  thunderHighShelf.type = 'highshelf'; thunderHighShelf.frequency.value = 3000;
  thunderGain.connect(thunderLowShelf); thunderLowShelf.connect(thunderHighShelf); thunderHighShelf.connect(masterGain);

  applyThunderEQFromSliders();
}

// Optional rain lows softener
function applyLowFreqSoft(enabled){
  if (!ctx) return;
  if (enabled){
    if (!rainEQ){
      rainEQ = ctx.createBiquadFilter(); rainEQ.type='lowshelf'; rainEQ.frequency.value=80; rainEQ.gain.value=-8;
      rainGain.disconnect(); rainGain.connect(rainEQ); rainEQ.connect(masterGain);
    } else { rainEQ.gain.value = -8; }
  } else if (rainEQ){
    rainGain.disconnect(); rainEQ.disconnect(); rainEQ=null; rainGain.connect(masterGain);
  }
}

// -------- thunder EQ helpers --------
function reductionToDb(percent){
  const p = clamp(percent, 0, 100);
  const keep = Math.max(0.0001, 1 - p/100);
  return 20 * Math.log10(keep); // 50% -> ~ -6.02 dB
}
function setPctText(ids, val){ for(const id of ids){ const el=document.getElementById(id); if(el){ el.textContent = `${val}%`; return; } } }
function applyThunderEQFromSliders(){
  const lowEl = document.getElementById('lowSlider');
  const highEl = document.getElementById('highSlider');
  if (!ctx || !thunderLowShelf || !thunderHighShelf) return;
  const STEP_MAP = [75, 50, 25, 0]; // reduction percents for 0..3 sliders

  let lowPct = 0, highPct = 0;
  if (lowEl)  lowPct  = (parseInt(lowEl.max,10) === 3)  ? STEP_MAP[clamp(parseInt(lowEl.value,10),0,3)]  : clamp(parseInt(lowEl.value,10)||0, 0, 100);
  if (highEl) highPct = (parseInt(highEl.max,10) === 3) ? STEP_MAP[clamp(parseInt(highEl.value,10),0,3)] : clamp(parseInt(highEl.value,10)||0, 0, 100);

  thunderLowShelf.gain.value  = reductionToDb(lowPct);
  thunderHighShelf.gain.value = reductionToDb(highPct);

  setPctText(['lowPct','lowOut','lowFreqOut'], lowPct);
  setPctText(['highPct','highOut','highFreqOut'], highPct);
}

// -------- rain loop --------
async function startRain(level){
  if (rainSwapTimer){ clearTimeout(rainSwapTimer); rainSwapTimer=null; }
  if (rainSrc){ try{ rainSrc.stop(); }catch{} rainSrc=null; }

  const list = manifest.rain?.[level] || manifest.rain?.['2'] || [];
  const disallow = /thunder|lightning|boom|strike|rumble|close|distant/i;
  let candidates = list.filter(n => !disallow.test(n));
  if (!candidates.length) candidates = list.slice();

  const base = pick(candidates);
  let buf;
  try { buf = await fetchBufferWithFallback(base); }
  catch {
    const alts = list.filter(b => b!==base);
    for (const alt of alts){ try { buf = await fetchBufferWithFallback(alt); break; } catch {} }
    if (!buf) return;
  }

  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  src.connect(rainGain); src.start(); rainSrc = src;

  // rotate every 4–7 minutes
  const nextMs = 240000 + Math.random()*180000;
  rainSwapTimer = setTimeout(() => { if (sessionRunning && !paused) startRain(level).catch(console.error); }, nextMs);
}

// -------- manual & background thunder --------
async function playThunder(which){
  const group = manifest.manualThunder?.[which] || []; if (!group.length) return;
  let buf; try { buf = await fetchBufferWithFallback(pick(group)); } catch { return; }
  const src = ctx.createBufferSource(); src.buffer = buf;
  const g = ctx.createGain(); g.gain.value = 0.0001; src.connect(g).connect(thunderGain);
  const now = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(1.0, now+0.02); src.start(now);
  const dur = buf.duration;
  g.gain.setValueAtTime(1.0, now + Math.max(0,dur-0.08));
  g.gain.linearRampToValueAtTime(0.0001, now + Math.max(0,dur-0.02));
  const rec = {src,g}; activeManual.push(rec);
  src.onended = () => { try{ g.disconnect(); }catch{} activeManual = activeManual.filter(r=>r!==rec); };
  manualCount++; const lbl=document.getElementById('manualCounterLabel'); if (lbl) lbl.textContent = 'Manual Thunder: ' + manualCount;
}
function startBgThunder(){
  stopBgThunder();
  const schedule = (initial=false)=>{
    const delay = initial ? (3+Math.random()*5) : (20+Math.random()*40);
    bgTimer = setTimeout(async ()=>{
      try{
        const pool = [].concat(manifest.bgThunder||[], manifest.soundIdeasThunder||[]);
        if (!pool.length) { schedule(); return; }
        let buf; try{ buf = await fetchBufferWithFallback(pick(pool)); } catch { schedule(); return; }
        const src = ctx.createBufferSource(); src.buffer = buf;
        const g = ctx.createGain(); const target = 0.6 + Math.random()*0.2;
        g.gain.value = 0.0001; src.connect(g).connect(thunderGain);
        const now = ctx.currentTime;
        g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(target, now+0.25); src.start(now);
        const dur = buf.duration;
        g.gain.setValueAtTime(target, now + Math.max(0, dur-0.4));
        g.gain.linearRampToValueAtTime(0.0001, now + Math.max(0, dur-0.05));
        const rec = {src,g}; activeBg.push(rec); src.onended = () => { try{ g.disconnect(); }catch{} activeBg = activeBg.filter(r=>r!==rec); };
      } catch {}
      schedule();
    }, delay*1000);
  };
  schedule(true);
}
function stopBgThunder(){
  if (bgTimer){ clearTimeout(bgTimer); bgTimer=null; }
  activeBg.forEach(({src}) => { try{ src.stop(); }catch{} }); activeBg = [];
}

// -------- timer & session --------
function startTimer(){
  clearInterval(timerInterval); elapsed=0;
  timerInterval = setInterval(()=>{
    elapsed++;
    const min = String(Math.floor(elapsed/60)).padStart(2,'0');
    const sec = String(elapsed%60).padStart(2,'0');
    const t = document.getElementById('timer'); if (t) t.textContent = `${min}:${sec} / ${sessionLength/60}:00`;
    const pb = document.getElementById('progressBar'); if (pb) pb.style.width = (elapsed/sessionLength)*100 + '%';
    if (elapsed >= sessionLength) stopSession();
  }, 1000);
}
function hardStopAllAudio(){
  clearInterval(timerInterval); timerInterval=null;
  if (rainSwapTimer){ clearTimeout(rainSwapTimer); rainSwapTimer=null; }
  stopBgThunder(); if (rainSrc){ try{ rainSrc.stop(); }catch{} } rainSrc=null;
  activeManual.forEach(({src})=>{ try{ src.stop(); }catch{} }); activeManual=[];
}
function stopSession(){
  sessionRunning=false; paused=false; hardStopAllAudio();
  const pauseBtn=document.getElementById('pauseBtn'), stopBtn=document.getElementById('stopBtn'), startBtn=document.getElementById('startBtn');
  if (pauseBtn) pauseBtn.disabled=true; if (stopBtn) stopBtn.disabled=true; if (startBtn) startBtn.disabled=false;
  if (pauseBtn) pauseBtn.textContent='Pause';
}

// -------- UI wiring --------
window.addEventListener('DOMContentLoaded', async ()=>{
  try { manifest = await fetchJSON('sounds/manifest.json'); }
  catch(e){ console.error('manifest.json load failed', e); alert("Couldn't load sounds/manifest.json – please add it."); return; }

  await initAudio();

  const mvEl = document.getElementById('masterVol');
  const mvOut = document.getElementById('masterVolOut');
  if (mvEl && mvOut) mvOut.textContent = Math.round(parseFloat(mvEl.value)*100) + '%';

  const intensityEl = document.getElementById('intensity');
  const intensityOut = document.getElementById('intensityOut');
  if (intensityEl && intensityOut) intensityOut.textContent = `${parseInt(intensityEl.value,10)} / 5`;

  const modeRandom = document.getElementById('modeRandom');
  const modeManual = document.getElementById('modeManual');
  const manualRow = document.getElementById('manualRow');
  const manualCounterRow = document.getElementById('manualCounterRow');

  modeRandom?.addEventListener('change', ()=>{
    if (manualRow) manualRow.style.display='none';
    if (manualCounterRow) manualCounterRow.style.display='none';
    if (sessionRunning && !paused) startBgThunder();
  });
  modeManual?.addEventListener('change', ()=>{
    if (manualRow) manualRow.style.display='';
    if (manualCounterRow) manualCounterRow.style.display='';
    if (sessionRunning) stopBgThunder();
  });

  document.getElementById('btnDistant')?.addEventListener('click', ()=> playThunder('roll'));
  document.getElementById('btnClose')?.addEventListener('click', ()=> playThunder('close'));

  mvEl?.addEventListener('input', (e)=>{
    const v = parseFloat(e.target.value);
    masterGain.gain.value = v;
    if (mvOut) mvOut.textContent = Math.round(v*100) + '%';
  });

  intensityEl?.addEventListener('input', (e)=>{
    const val = parseInt(e.target.value,10);
    if (intensityOut) intensityOut.textContent = val + ' / 5';
    if (sessionRunning && !paused) startRain(val).catch(console.error);
  });

  const softEl = document.getElementById('lowFreqSoft');
  softEl?.addEventListener('change', (e)=> applyLowFreqSoft(e.target.checked));
  if (softEl) applyLowFreqSoft(softEl.checked);

  const lowEl  = document.getElementById('lowSlider');
  const highEl = document.getElementById('highSlider');
  // Ensure 50% default if HTML was changed
  if (lowEl && parseInt(lowEl.max,10)===3)  lowEl.value='1';
  if (highEl && parseInt(highEl.max,10)===3) highEl.value='1';
  applyThunderEQFromSliders();
  lowEl?.addEventListener('input', applyThunderEQFromSliders);
  highEl?.addEventListener('input', applyThunderEQFromSliders);

  document.getElementById('startBtn')?.addEventListener('click', async ()=>{
    await ctx.resume();
    const minsSel = document.getElementById('sessionMins');
    sessionLength = parseInt(minsSel?.value ?? '10', 10) * 60;
    const level = intensityEl ? parseInt(intensityEl.value,10) : 2;
    await startRain(level);
    if (modeRandom?.checked) startBgThunder(); else stopBgThunder();
    manualCount=0; const lbl=document.getElementById('manualCounterLabel'); if (lbl) lbl.textContent='Manual Thunder: 0';
    startTimer();
    sessionRunning=true; paused=false;
    const pauseBtn=document.getElementById('pauseBtn'), stopBtn=document.getElementById('stopBtn'), startBtn=document.getElementById('startBtn');
    if (pauseBtn) pauseBtn.disabled=false; if (stopBtn) stopBtn.disabled=false; if (startBtn) startBtn.disabled=true;
  });

  document.getElementById('pauseBtn')?.addEventListener('click', async (e)=>{
    if (!sessionRunning) return;
    if (!paused){ await ctx.suspend(); clearInterval(timerInterval); e.target.textContent='Resume'; paused=true; }
    else { await ctx.resume(); startTimer(); e.target.textContent='Pause'; paused=false; }
  });

  document.getElementById('stopBtn')?.addEventListener('click', stopSession);

  // Footer niceties
  document.getElementById('year')?.append(new Date().getFullYear());
  document.getElementById('showSetup')?.addEventListener('click', ()=> window.__cdtOnboard?.reset?.());

  // Init timer display for selected minutes
  const sel = document.getElementById('sessionMins');
  const mins = parseInt(sel?.value ?? '10', 10);
  const timerEl = document.getElementById('timer');
  if (timerEl) timerEl.textContent = `00:00 / ${mins}:00`;
  sel?.addEventListener('change', (e)=>{
    const m = parseInt(e.target.value,10);
    if (!sessionRunning){
      if (timerEl) timerEl.textContent = `00:00 / ${m}:00`;
      const pb = document.getElementById('progressBar'); if (pb) pb.style.width='0%';
    }
  });
});

// Global error logs
window.addEventListener('error', e => console.error('Global error:', e.message));
window.addEventListener('unhandledrejection', e => console.error('Unhandled promise:', e.reason));

// -------- Onboarding modal logic --------
(function(){
  const KEY='cdt_onboard_v4';
  const qs = (id)=>document.getElementById(id);
  const force = ()=>{ try{ return new URLSearchParams(location.search).get('onboard')==='1'; }catch{ return false; } };
  const seen = ()=>{ try{ return !!localStorage.getItem(KEY); }catch{ return false; } };
  const setSeen = ()=>{ try{ localStorage.setItem(KEY,'1'); }catch{} };

  function openModal(){ const o=qs('cdtOnboardOverlay'), m=qs('cdtOnboard'); if(!o||!m) return; o.hidden=false; m.hidden=false;
    (qs('cdtStartNow')||m).focus(); document.addEventListener('keydown', onEsc); document.addEventListener('focus', trapFocus, true); }
  function closeModal(){ const o=qs('cdtOnboardOverlay'), m=qs('cdtOnboard'); if(!o||!m) return; o.hidden=true; m.hidden=true;
    document.removeEventListener('keydown', onEsc); document.removeEventListener('focus', trapFocus, true); }
  function onEsc(e){ if(e.key==='Escape') closeModal(); }
  function trapFocus(e){ const m=qs('cdtOnboard'); if(m && !m.hidden && !m.contains(e.target)){ e.stopPropagation(); (qs('cdtStartNow')||m).focus(); } }

  function updateCallout(){ const c=qs('speakerCallout'); if (!c) return; c.style.display = (!seen() || force()) ? '' : 'none'; }

  document.addEventListener('DOMContentLoaded', ()=>{
    updateCallout();
    const btnClose=qs('cdtOnboardClose'), btnStart=qs('cdtStartNow'), btnLater=qs('cdtLater'), cbDont=qs('cdtDontShow');
    if (!seen() || force()) openModal();
    btnClose?.addEventListener('click', closeModal);
    btnLater?.addEventListener('click', ()=>{ if (cbDont?.checked) setSeen(); updateCallout(); closeModal(); });
    btnStart?.addEventListener('click', ()=>{ setSeen(); updateCallout(); closeModal(); (qs('startBtn')||document.querySelector('[data-role="start-session"], button.start, .btn-start'))?.click(); });

    const realStart = qs('startBtn') || document.querySelector('[data-role="start-session"], button.start, .btn-start');
    if (realStart && !seen() && !force()){
      realStart.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); openModal(); }, {once:true});
    }
  });

  window.__cdtOnboard = { show:()=>openModal(), reset:()=>{ try{ localStorage.removeItem(KEY); }catch{} updateCallout(); openModal(); } };
})();
