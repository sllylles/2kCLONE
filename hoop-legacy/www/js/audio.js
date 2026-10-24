// Synthesized sound effects (no audio files needed).
let ctx = null, master = null, crowdGain = null;
export let muted = false;

function ensure() {
  if (ctx) return ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.7; master.connect(ctx.destination);
  } catch (e) { ctx = null; }
  return ctx;
}

export function unlock() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); }
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.7; }

function noiseBuffer(sec) {
  const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
let nb = null;

function noise(dur, freq, q, vol, type = 'bandpass', attack = 0.005) {
  if (!ensure() || muted) return;
  nb = nb || noiseBuffer(2);
  const s = ctx.createBufferSource(); s.buffer = nb;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t, Math.random()); s.stop(t + dur + 0.05);
}

function tone(freq, dur, vol, type = 'sine', slide = 0) {
  if (!ensure() || muted) return;
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  dribble() { tone(95, 0.09, 0.35, 'sine', 0.6); noise(0.05, 400, 1, 0.12, 'lowpass'); },
  swish() { noise(0.35, 3500, 0.8, 0.25, 'highpass', 0.02); },
  rim() { tone(620, 0.25, 0.18, 'triangle', 0.97); tone(1310, 0.18, 0.08, 'square', 0.98); noise(0.08, 900, 2, 0.2); },
  bounce() { tone(80, 0.1, 0.25, 'sine', 0.6); },
  whistle() { if (!ensure() || muted) return; const o = ctx.createOscillator(); o.type = 'sine'; const l = ctx.createOscillator(); l.frequency.value = 28; const lg = ctx.createGain(); lg.gain.value = 120; l.connect(lg); lg.connect(o.frequency); o.frequency.value = 2900; const g = ctx.createGain(); const t = ctx.currentTime; g.gain.setValueAtTime(0.0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.02); g.gain.setValueAtTime(0.18, t + 0.35); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5); o.connect(g); g.connect(master); o.start(t); l.start(t); o.stop(t + 0.55); l.stop(t + 0.55); },
  buzzer() { tone(180, 1.1, 0.25, 'sawtooth'); tone(183, 1.1, 0.2, 'square'); },
  cheer(level = 1) { noise(1.6 * level, 1200, 0.5, 0.22 * level, 'bandpass', 0.15); noise(1.2 * level, 2400, 0.7, 0.1 * level, 'bandpass', 0.2); },
  ooh() { noise(1.0, 700, 3, 0.25, 'bandpass', 0.12); tone(220, 0.9, 0.05, 'sine', 0.8); },
  green() { tone(880, 0.12, 0.15, 'sine'); setTimeout(() => tone(1320, 0.18, 0.15, 'sine'), 70); },
  dunk() { tone(70, 0.3, 0.5, 'sine', 0.5); noise(0.25, 300, 1, 0.35, 'lowpass'); setTimeout(() => sfx.cheer(1.3), 100); },
  pass() { noise(0.08, 1800, 1, 0.08); },
  click() { tone(660, 0.05, 0.08, 'square'); },
  steal() { noise(0.12, 600, 2, 0.2); },
  block() { tone(110, 0.15, 0.4, 'sine', 0.5); noise(0.15, 500, 1.5, 0.3); },
  thud() { tone(70, 0.12, 0.35, 'sine', 0.5); noise(0.08, 300, 1.2, 0.18, 'lowpass'); },
  squeak() { tone(2200 + Math.random() * 600, 0.07, 0.04, 'sine', 1.15); },
};

// Ambient crowd bed
export function startCrowd() {
  if (!ensure() || crowdGain) return;
  nb = nb || noiseBuffer(2);
  const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.4;
  crowdGain = ctx.createGain(); crowdGain.gain.value = 0.035;
  s.connect(f); f.connect(crowdGain); crowdGain.connect(master);
  s.start();
  crowdGain._src = s;
}
export function stopCrowd() {
  if (crowdGain) { try { crowdGain._src.stop(); } catch (e) { /* ignore */ } crowdGain.disconnect(); crowdGain = null; }
}

// Voice acting: plays audio/vo/<id>.mp3 (one line at a time), ducking the crowd under it. `onEnd` fires when the
// line finishes (or right away if muted / it can't play), so cutscenes can wait for the voice.
let voEl = null;
export function playVO(id, onEnd) {
  stopVO();
  if (muted) { if (onEnd) onEnd(false); return; }
  const a = new Audio(`audio/vo/${id}.mp3`);
  voEl = a;
  a.volume = 1;
  if (crowdGain && ctx) crowdGain.gain.setTargetAtTime(0.012, ctx.currentTime, 0.15);
  let done = false;
  const fin = ok => { if (done) return; done = true; if (voEl === a) voEl = null; if (crowdGain && ctx) crowdGain.gain.setTargetAtTime(0.035, ctx.currentTime, 0.4); if (onEnd) onEnd(ok); };
  a.onended = () => fin(true);
  a.onerror = () => fin(false);
  const p = a.play();
  if (p && p.catch) p.catch(() => fin(false));
}
export function stopVO() { if (voEl) { const a = voEl; voEl = null; a.onended = a.onerror = null; try { a.pause(); } catch (e) { /* ignore */ } if (crowdGain && ctx) crowdGain.gain.setTargetAtTime(0.035, ctx.currentTime, 0.4); } }
