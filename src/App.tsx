import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Dog Sound Desensitization — Core Player (pre-PartyPad)
 *
 * Drop this in as src/App.tsx. Assumes Vite + React + TS + Tailwind.
 * Put audio files in /public/sounds.
 *
 * This file intentionally contains only the core scheduler + UI.
 * No PartyPad / grids yet — just presets, play/stop, fades, and random delays.
 */

type SoundMeta = { id: string; name: string; file: string; defaultVolume?: number };

type Preset = {
  id: string;
  name: string;
  volume: number; // base gain 0..1
  fadeInMs: number;
  fadeOutMs: number;
  delayMinSec: number;
  delayMaxSec: number;
};

const PRESETS: Preset[] = [
  { id: "beginner", name: "Beginner (very gentle)", volume: 0.25, fadeInMs: 800, fadeOutMs: 600, delayMinSec: 30, delayMaxSec: 60 },
  { id: "gentle", name: "Gentle", volume: 0.35, fadeInMs: 600, fadeOutMs: 500, delayMinSec: 20, delayMaxSec: 40 },
  { id: "moderate", name: "Moderate", volume: 0.5, fadeInMs: 400, fadeOutMs: 400, delayMinSec: 12, delayMaxSec: 24 },
  { id: "steady", name: "Steady", volume: 0.65, fadeInMs: 350, fadeOutMs: 300, delayMinSec: 8, delayMaxSec: 16 },
  { id: "advanced", name: "Advanced", volume: 0.8, fadeInMs: 250, fadeOutMs: 250, delayMinSec: 5, delayMaxSec: 10 },
];

// You can rename/replace these files with your own; just keep ids unique.
const SOUNDS: SoundMeta[] = [
  { id: "doorbell-1", name: "Doorbell (ding-dong)", file: "/sounds/doorbell_ding_dong.mp3", defaultVolume: 0.9 },
  { id: "doorbell-2", name: "Doorbell (single chime)", file: "/sounds/doorbell_single.mp3", defaultVolume: 0.85 },
  { id: "knock-1", name: "Knock (light)", file: "/sounds/knock_light.mp3", defaultVolume: 0.8 },
  { id: "knock-2", name: "Knock (firm)", file: "/sounds/knock_firm.mp3", defaultVolume: 0.8 },
  { id: "fireworks-1", name: "Fireworks (pop)", file: "/sounds/firework_pop.mp3", defaultVolume: 0.6 },
  { id: "fireworks-2", name: "Fireworks (crackle)", file: "/sounds/firework_crackle.mp3", defaultVolume: 0.6 },
];

/**
 * Simple utility: random float in [min, max]
 */
const randFloat = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * WebAudio-backed player with per-play fades and overall master gain.
 */
class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private isMuted = false;
  private _volume = 0.5; // 0..1

  async ensureContext(): Promise<AudioContext> {
    if (this.ctx) return this.ctx;
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const master = ctx.createGain();
    master.gain.value = this.isMuted ? 0 : this._volume;
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    return ctx;
  }

  setMasterVolume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.linearRampToValueAtTime(this.isMuted ? 0 : this._volume, this.ctx!.currentTime + 0.01);
  }

  getMasterVolume() { return this._volume; }

  setMuted(m: boolean) {
    this.isMuted = m;
    if (this.master) this.master.gain.linearRampToValueAtTime(m ? 0 : this._volume, this.ctx!.currentTime + 0.01);
  }

  async playOnce(srcUrl: string, opts: { fadeInMs: number; fadeOutMs: number; baseGain: number }): Promise<void> {
    const ctx = await this.ensureContext();

    // Fetch & decode (cache via browser HTTP cache). For a production app, consider an app-level decode cache.
    const response = await fetch(srcUrl);
    const arrayBuf = await response.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(arrayBuf);

    const src = ctx.createBufferSource();
    src.buffer = audioBuf;

    const gain = ctx.createGain();
    const now = ctx.currentTime;

    // Start at near-silence to avoid clicks, then fade in.
    const maxGain = Math.max(0, Math.min(1, opts.baseGain));
    const fadeIn = Math.max(0, opts.fadeInMs) / 1000;
    const fadeOut = Math.max(0, opts.fadeOutMs) / 1000;

    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, maxGain), now + Math.max(0.01, fadeIn));

    src.connect(gain);
    gain.connect(this.master!);

    // Schedule fade-out to end smoothly.
    const duration = audioBuf.duration;
    const fadeOutStart = Math.max(0, duration - fadeOut);
    gain.gain.setValueAtTime(maxGain, now + fadeOutStart);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    return new Promise<void>((resolve) => {
      src.onended = () => resolve();
      src.start();
    });
  }
}

function useSoundEngine() {
  const engineRef = useRef<SoundEngine>();
  if (!engineRef.current) engineRef.current = new SoundEngine();
  return engineRef.current;
}

/**
 * SCHEDULER
 * Plays random sounds from the selected set, with random delay between plays.
 */
function useScheduler(args: {
  enabled: boolean;
  preset: Preset;
  sounds: SoundMeta[];
  masterMultiplier: number; // extra attenuator 0..1
}) {
  const { enabled, preset, sounds, masterMultiplier } = args;
  const engine = useSoundEngine();
  const [lastEvent, setLastEvent] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function loop() {
      if (cancelled) return;
      // pick a sound
      const sound = sounds[Math.floor(Math.random() * sounds.length)];
      const base = (sound.defaultVolume ?? 1) * preset.volume * masterMultiplier;
      const delaySec = randFloat(preset.delayMinSec, preset.delayMaxSec);

      setLastEvent(
        `Next: ${sound.name} in ${delaySec.toFixed(1)}s (gain ${(base).toFixed(2)})`
      );

      await new Promise((r) => setTimeout(r, delaySec * 1000));
      if (cancelled) return;

      try {
        await engine.playOnce(sound.file, {
          fadeInMs: preset.fadeInMs,
          fadeOutMs: preset.fadeOutMs,
          baseGain: base,
        });
        setLastEvent(`Played: ${sound.name}`);
      } catch (e) {
        console.error(e);
        setLastEvent(`Error playing ${sound.name}`);
      }

      // tail recurse
      if (!cancelled && enabled) loop();
    }

    if (enabled) loop();
    return () => { cancelled = true; };
  }, [enabled, preset, sounds, masterMultiplier]);

  return { lastEvent };
}

export default function App() {
  const [presetId, setPresetId] = useState<string>("beginner");
  const preset = useMemo(() => PRESETS.find(p => p.id === presetId)!, [presetId]);
  const [enabled, setEnabled] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(SOUNDS.map(s => s.id));
  const [masterMultiplier, setMasterMultiplier] = useState(0.7);
  const [muted, setMuted] = useState(false);
  const engine = useSoundEngine();

  useEffect(() => { engine.setMasterVolume(1.0); }, []);
  useEffect(() => { engine.setMuted(muted); }, [muted]);

  const activeSounds = useMemo(() => SOUNDS.filter(s => selectedIds.includes(s.id)), [selectedIds]);
  const { lastEvent } = useScheduler({ enabled, preset, sounds: activeSounds, masterMultiplier });

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);

  const testPlay = useCallback(async () => {
    const s = activeSounds[0] ?? SOUNDS[0];
    const base = (s.defaultVolume ?? 1) * preset.volume * masterMultiplier;
    await engine.playOnce(s.file, { fadeInMs: preset.fadeInMs, fadeOutMs: preset.fadeOutMs, baseGain: base });
  }, [activeSounds, preset, masterMultiplier]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-4xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Dog Sound Desensitization — Core Player</h1>
          <p className="text-slate-300 mt-1">Pre-PartyPad build. Randomized single-shot scheduler with fades and preset delays.</p>
        </header>

        {/* Controls Card */}
        <div className="grid gap-6 md:grid-cols-2">
          <section className="bg-slate-900/60 rounded-2xl p-4 shadow">
            <h2 className="text-lg font-medium mb-3">Session</h2>

            <label className="block text-sm mb-2">Preset</label>
            <select
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 focus:outline-none"
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            <div className="mt-4">
              <label className="block text-sm">Master Attenuation</label>
              <input
                type="range" min={0} max={1} step={0.01}
                value={masterMultiplier}
                onChange={(e) => setMasterMultiplier(parseFloat(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-slate-400">{(masterMultiplier * 100).toFixed(0)}%</div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => setEnabled((v) => !v)}
                className={`px-4 py-2 rounded-xl shadow text-sm font-medium ${enabled ? "bg-emerald-500 text-emerald-950" : "bg-slate-700"}`}
              >{enabled ? "Stop" : "Start"}</button>
              <button
                onClick={testPlay}
                className="px-4 py-2 rounded-xl shadow text-sm font-medium bg-slate-700"
              >Test Play</button>
              <label className="inline-flex items-center gap-2 ml-auto text-sm">
                <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} />
                Mute
              </label>
            </div>

            <div className="mt-4 text-xs text-slate-400">
              <div>Preset gain: {(preset.volume * 100).toFixed(0)}% • Fade in/out: {preset.fadeInMs}/{preset.fadeOutMs} ms</div>
              <div>Delay window: {preset.delayMinSec}–{preset.delayMaxSec}s</div>
              <div className="mt-2 italic">{lastEvent}</div>
            </div>
          </section>

          <section className="bg-slate-900/60 rounded-2xl p-4 shadow">
            <h2 className="text-lg font-medium mb-3">Sound Pool</h2>
            <ul className="space-y-2">
              {SOUNDS.map((s) => {
                const checked = selectedIds.includes(s.id);
                return (
                  <li key={s.id} className="flex items-center gap-3 bg-slate-800/60 rounded-xl px-3 py-2">
                    <input type="checkbox" checked={checked} onChange={() => toggleSelected(s.id)} />
                    <div className="flex-1">
                      <div className="text-sm">{s.name}</div>
                      <div className="text-xs text-slate-400">{s.file}</div>
                    </div>
                    <button
                      onClick={async () => {
                        const base = (s.defaultVolume ?? 1) * preset.volume * masterMultiplier;
                        await engine.playOnce(s.file, { fadeInMs: preset.fadeInMs, fadeOutMs: preset.fadeOutMs, baseGain: base });
                      }}
                      className="px-3 py-1 rounded-lg bg-slate-700 text-xs"
                    >Play</button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <footer className="mt-8 text-xs text-slate-400">
          Place your audio files in <code className="px-1 bg-slate-800 rounded">/public/sounds</code>. Keep peaks low; desensitization starts very quiet.
        </footer>
      </div>
    </div>
  );
}
