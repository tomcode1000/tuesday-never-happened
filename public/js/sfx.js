// Audio engine — REAL recorded audio (the way shipped games do it), mixed through WebAudio buses.
//  · SFX: Kenney audio packs (CC0) — public/audio/sfx
//  · Music: Kevin MacLeod, incompetech.com (CC BY 4.0) — public/audio/music
//  · Ambience: a quiet room-tone bed (air handling + server fans), like Her Story's droning fan.
let ctx = null;
let master, comp, busMusic, musicLP, busSfx, busAmb, revIn;
let muted = false;
let brownBuf = null, noiseBuf = null;
let heartTimer = null;
let intensity = 1;

const VOL_KEY = 'tnh-volumes';
const vol = { music: 0.6, sfx: 0.85, amb: 0.6 };
try { Object.assign(vol, JSON.parse(localStorage.getItem(VOL_KEY) || '{}')); } catch { /* storage blocked */ }

const SFX_DIR = 'audio/sfx/';
const MUSIC = {
  title: 'audio/music/Night_on_the_Docks_Sax.mp3',
  calm: 'audio/music/Investigations.mp3',
  tense: 'audio/music/Hidden_Agenda.mp3',
};
const ALL_SFX = [
  'click_001', 'click_002', 'click_003', 'click_004', 'click_005', 'select_001', 'select_002', 'tick_001', 'tick_002',
  'switch_002', 'maximize_003', 'minimize_003', 'open_002', 'close_002', 'confirmation_002', 'error_004', 'error_006',
  'glitch_001', 'glitch_002', 'glitch_003', 'glitch_004', 'scroll_002', 'scratch_002', 'drop_002', 'bong_001', 'question_002', 'toggle_002',
  'footstep_concrete_000', 'footstep_concrete_001', 'footstep_concrete_002', 'footstep_concrete_003', 'footstep_concrete_004',
  'footstep_wood_000', 'footstep_wood_001', 'footstep_wood_002', 'footstep_wood_003', 'footstep_wood_004',
  'footstep_carpet_000', 'footstep_carpet_001', 'footstep_carpet_002', 'footstep_carpet_003', 'footstep_carpet_004',
  'impactPunch_heavy_000', 'impactSoft_heavy_000', 'impactSoft_heavy_001', 'impactBell_heavy_000', 'impactPlank_medium_000',
  'impactMetal_light_000', 'impactMetal_light_001', 'impactMetal_light_002', 'impactWood_light_000',
  'bookOpen', 'bookClose', 'bookFlip1', 'bookFlip2', 'bookFlip3', 'bookPlace1', 'doorOpen_1', 'doorClose_1', 'dropLeather', 'cloth1', 'metalClick', 'metalLatch', 'creak1',
];
const set = (base, n) => Array.from({ length: n }, (_, i) => `${base}${String(i).padStart(3, '0')}`);
const CLICKS = ['click_001', 'click_002', 'click_003', 'click_004', 'click_005'];
const STEPS = { concrete: set('footstep_concrete_', 5), wood: set('footstep_wood_', 5), carpet: set('footstep_carpet_', 5), metal: ['impactMetal_light_000', 'impactMetal_light_001', 'impactMetal_light_002'] };
const GLITCH = ['glitch_001', 'glitch_002', 'glitch_003', 'glitch_004'];

/* ───────── core ───────── */
function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.25;
    master = ctx.createGain(); master.gain.value = muted ? 0 : 1;
    master.connect(comp).connect(ctx.destination);
    musicLP = ctx.createBiquadFilter(); musicLP.type = 'lowpass'; musicLP.frequency.value = 18000;
    busMusic = ctx.createGain(); busMusic.gain.value = vol.music;
    busMusic.connect(musicLP).connect(master);
    busSfx = ctx.createGain(); busSfx.gain.value = vol.sfx * 1.3;
    busSfx.connect(master);
    busAmb = ctx.createGain(); busAmb.gain.value = vol.amb;
    busAmb.connect(master);
    const conv = ctx.createConvolver();
    conv.buffer = impulse(2.4, 2.6);
    revIn = ctx.createGain(); revIn.gain.value = 0.35;
    revIn.connect(conv).connect(master);
    brownBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const b = brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < b.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    preload();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function impulse(sec, decay) {
  const len = ctx.sampleRate * sec;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

/* ───────── samples ───────── */
const bufs = {};
function load(name) {
  if (!bufs[name]) {
    bufs[name] = fetch(SFX_DIR + name + '.ogg').then((r) => r.arrayBuffer()).then((a) => ac().decodeAudioData(a)).catch(() => null);
  }
  return bufs[name];
}
function preload() { for (const n of ALL_SFX) load(n); }
const pick = (a) => (Array.isArray(a) ? a[Math.floor(Math.random() * a.length)] : a);

// play a recorded sample: slight random pitch/volume so repeats never sound identical
function play(name, { vol: v = 0.7, rate = 1, vary = 0.05, delay = 0, rev = 0, bus = 'sfx' } = {}) {
  if (muted) return;
  const c = ac();
  load(pick(name)).then((buf) => {
    if (!buf || muted) return;
    const s = c.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * vary);
    const g = c.createGain();
    g.gain.value = v * (1 - Math.random() * vary);
    s.connect(g).connect(bus === 'amb' ? busAmb : busSfx);
    if (rev) { const r = c.createGain(); r.gain.value = rev; g.connect(r).connect(revIn); }
    s.start(c.currentTime + delay);
  });
}

/* ───────── music: real recorded tracks, crossfaded ───────── */
const players = {};
let currentTrack = null;
function track(name) {
  if (!players[name]) {
    const c = ac();
    const a = new Audio(MUSIC[name]);
    a.loop = true; a.preload = 'auto'; a.crossOrigin = 'anonymous';
    const g = c.createGain(); g.gain.value = 0;
    c.createMediaElementSource(a).connect(g).connect(busMusic);
    players[name] = { a, g, stopT: 0 };
  }
  return players[name];
}
function fadeTo(name, secs = 2) {
  if (name === currentTrack) return;
  currentTrack = name;
  const c = ac();
  const t = c.currentTime;
  for (const [k, p] of Object.entries(players)) {
    if (k === name) continue;
    p.g.gain.cancelScheduledValues(t);
    p.g.gain.setValueAtTime(p.g.gain.value, t);
    p.g.gain.linearRampToValueAtTime(0, t + secs);
    clearTimeout(p.stopT);
    p.stopT = setTimeout(() => p.a.pause(), secs * 1000 + 100);
  }
  if (!name || muted) return;
  const p = track(name);
  clearTimeout(p.stopT);
  p.a.play().catch(() => {});
  p.g.gain.cancelScheduledValues(t);
  p.g.gain.setValueAtTime(p.g.gain.value, t);
  p.g.gain.linearRampToValueAtTime(0.75, t + secs);
}

/* ───────── ambience: quiet room tone ───────── */
let amb = null;
const ROOM_MIX = {
  security: { hvac: 0.2, fan: 0.015, hum: 0 },
  office: { hvac: 0.18, fan: 0.01, hum: 0 },
  server: { hvac: 0.12, fan: 0.13, hum: 0.035 },
  hall: { hvac: 0.22, fan: 0.005, hum: 0 },
  lobby: { hvac: 0.28, fan: 0, hum: 0 },
};
function startAmbience() {
  if (amb || muted) return;
  const c = ac();
  const loop = (buf) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
  const hvacSrc = loop(brownBuf);
  const hvacLP = c.createBiquadFilter(); hvacLP.type = 'lowpass'; hvacLP.frequency.value = 240;
  const hvac = c.createGain(); hvac.gain.value = 0;
  hvacSrc.connect(hvacLP).connect(hvac).connect(busAmb);
  const fanSrc = loop(noiseBuf);
  const fanBP = c.createBiquadFilter(); fanBP.type = 'bandpass'; fanBP.frequency.value = 800; fanBP.Q.value = 0.5;
  const fan = c.createGain(); fan.gain.value = 0;
  fanSrc.connect(fanBP).connect(fan).connect(busAmb);
  const humOsc = c.createOscillator(); humOsc.type = 'sine'; humOsc.frequency.value = 60;
  const hum = c.createGain(); hum.gain.value = 0;
  humOsc.connect(hum).connect(busAmb); humOsc.start();
  amb = { hvac, fan, hum, nodes: [hvacSrc, fanSrc, humOsc] };
  sfx.setRoom('security');
  scheduleCreak();
}
let creakTimer = null;
function scheduleCreak() {
  clearTimeout(creakTimer);
  creakTimer = setTimeout(() => {
    if (amb) play(pick(['creak1', 'doorClose_1', 'metalLatch']), { vol: 0.12, rate: 0.8, rev: 0.8, bus: 'amb' }); // the building, somewhere
    scheduleCreak();
  }, 40000 + Math.random() * 50000);
}

/* ───────── public API ───────── */
export const sfx = {
  unlock() { ac(); },

  // every button
  click() { play(CLICKS, { vol: 0.55, vary: 0.08 }); },
  hover() { play('tick_001', { vol: 0.18, vary: 0.1 }); },

  // boot / title
  teletype() { play(CLICKS, { vol: 0.13, rate: 1.5, vary: 0.12 }); },
  lineEnd() { play('tick_002', { vol: 0.3 }); },
  warn() { play('error_006', { vol: 0.45 }); },
  boot() { play('switch_002', { vol: 0.6 }); play('maximize_003', { vol: 0.4, delay: 0.12 }); play(GLITCH, { vol: 0.25, delay: 0.3 }); },
  titleSting() {
    play('impactBell_heavy_000', { vol: 0.85, rate: 0.55, vary: 0, rev: 0.7 });
    play('impactPunch_heavy_000', { vol: 0.6, rate: 0.7, vary: 0 });
  },
  startTitleMusic() { ac(); fadeTo('title', 2.5); },
  stopTitleMusic() { if (ctx) fadeTo(null, 0.8); },

  // in-game score + room tone
  startDrone() {
    if (muted) return;
    ac();
    startAmbience();
    fadeTo(intensity >= 4 ? 'tense' : 'calm', 3);
  },
  stopDrone(fade = 1.5) {
    if (!ctx) return;
    fadeTo(null, fade);
    if (amb) {
      const t = ctx.currentTime;
      for (const k of ['hvac', 'fan', 'hum']) amb[k].gain.setTargetAtTime(0, t, fade / 3);
      const nodes = amb.nodes;
      setTimeout(() => nodes.forEach((n) => { try { n.stop(); } catch { /* stopped */ } }), fade * 1000 + 200);
      amb = null;
    }
    clearTimeout(creakTimer);
  },
  setIntensity(n) {
    intensity = Math.max(1, Math.min(4, n));
    if (amb && currentTrack !== 'title') fadeTo(intensity >= 4 ? 'tense' : 'calm', 4);
  },
  get intensity() { return intensity; },
  setRoom(kind) {
    if (!amb) return;
    const mix = ROOM_MIX[kind] || ROOM_MIX.office;
    const t = ctx.currentTime;
    for (const k of Object.keys(mix)) amb[k].gain.setTargetAtTime(mix[k], t, 0.4);
  },
  duck(on) { if (ctx) busMusic.gain.setTargetAtTime(on ? vol.music * 0.3 : vol.music, ctx.currentTime, 0.2); },
  playResultsMusic() { setTimeout(() => fadeTo('title', 3), 2500); },

  // movement
  step(surface = 0) {
    const set = surface === 2 ? STEPS.metal : surface === 3 ? STEPS.wood : surface === 4 ? STEPS.carpet : STEPS.concrete;
    play(set, { vol: surface === 2 ? 0.22 : 0.42, rate: surface === 2 ? 1.4 : 1, vary: 0.07 });
  },
  camCut() { play(GLITCH, { vol: 0.28 }); },

  // typing: real key clicks (soft) / typewriter-ish metal click for the notepad
  key(kind = 'crt') {
    if (kind === 'type') play('metalClick', { vol: 0.28, rate: 1.25, vary: 0.15 });
    else play(CLICKS, { vol: 0.14, rate: 1.35, vary: 0.12 });
  },
  speak(pitch = 1) { play('tick_001', { vol: 0.16, rate: 0.7 + pitch * 0.5, vary: 0.12 }); },

  // windows — each skin sounds like the object it is
  open(skin = '') {
    if (skin.includes('crt')) { play('maximize_003', { vol: 0.45 }); play('glitch_001', { vol: 0.15, delay: 0.05 }); }
    else if (skin.includes('paper')) play(['bookFlip1', 'bookFlip2', 'bookFlip3'], { vol: 0.55 });
    else if (skin.includes('card')) play('bookPlace1', { vol: 0.55 });
    else if (skin.includes('pad')) play('bookOpen', { vol: 0.5 });
    else play('open_002', { vol: 0.45 });
  },
  close(skin = '') {
    if (skin.includes('crt')) play('minimize_003', { vol: 0.4 });
    else if (skin.includes('pad') || skin.includes('paper')) play('bookClose', { vol: 0.45 });
    else if (skin.includes('card')) play('cloth1', { vol: 0.5 });
    else play('close_002', { vol: 0.4 });
  },

  // UI
  blip() { play('select_001', { vol: 0.45 }); },
  msg() { play('drop_002', { vol: 0.5 }); },
  error() { play('error_004', { vol: 0.5 }); },
  success() { play('confirmation_002', { vol: 0.55 }); },

  // ARIA: one signature sound, always the same, so players learn to dread it
  aria() { play('bong_001', { vol: 0.5, rate: 0.85, vary: 0, rev: 0.45 }); },
  glitch() { play('glitch_003', { vol: 0.55 }); play('glitch_004', { vol: 0.45, delay: 0.09 }); },
  softGlitch() { play(GLITCH, { vol: 0.2 }); },
  tamper() {
    play('glitch_004', { vol: 0.4 });
    play('impactSoft_heavy_001', { vol: 0.5, rate: 0.45, vary: 0 });
    if (!ctx) return;
    const t = ctx.currentTime; // the score goes "underwater" for a moment
    musicLP.frequency.cancelScheduledValues(t);
    musicLP.frequency.setValueAtTime(18000, t);
    musicLP.frequency.exponentialRampToValueAtTime(380, t + 0.3);
    musicLP.frequency.exponentialRampToValueAtTime(18000, t + 2.4);
  },
  scan() { for (let i = 0; i < 3; i++) play('scroll_002', { vol: 0.4, delay: i * 0.28, rate: 1 + i * 0.12 }); play('scratch_002', { vol: 0.3, delay: 0.75 }); },
  alarm() { for (let i = 0; i < 3; i++) play('error_006', { vol: 0.5, delay: i * 0.3, vary: 0 }); },
  stamp() { play('impactPunch_heavy_000', { vol: 0.95, vary: 0.03 }); play('impactPlank_medium_000', { vol: 0.55, delay: 0.02 }); },
  objection() {
    if (ctx) busMusic.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08); // cut to silence — let it land
    play('impactPunch_heavy_000', { vol: 1, rate: 0.6, vary: 0, rev: 0.5 });
    play('glitch_003', { vol: 0.5, delay: 0.05 });
    play('bong_001', { vol: 0.55, rate: 0.7, vary: 0, rev: 0.7, delay: 0.5 });
  },
  verdict(win) {
    if (win) play('impactBell_heavy_000', { vol: 0.8, rate: 1, vary: 0, rev: 0.7 });
    else { play('impactBell_heavy_000', { vol: 0.8, rate: 0.5, vary: 0, rev: 0.8 }); play('bong_001', { vol: 0.5, rate: 0.7, delay: 1.4, rev: 0.6 }); }
    if (ctx) busMusic.gain.setTargetAtTime(vol.music, ctx.currentTime + 2, 0.5);
    sfx.playResultsMusic();
  },
  heartbeat() { play('impactSoft_heavy_000', { vol: 0.75, rate: 0.5, vary: 0.02 }); play('impactSoft_heavy_001', { vol: 0.5, rate: 0.5, vary: 0.02, delay: 0.2 }); },
  setHeartbeat(bpm) {
    clearInterval(heartTimer); heartTimer = null;
    if (bpm) heartTimer = setInterval(() => sfx.heartbeat(), 60000 / bpm);
  },

  // mixer
  getVolumes() { return { ...vol }; },
  setVolume(kind, v) {
    vol[kind] = v;
    try { localStorage.setItem(VOL_KEY, JSON.stringify(vol)); } catch { /* storage blocked */ }
    if (!ctx) return;
    const t = ctx.currentTime;
    if (kind === 'music') busMusic.gain.setTargetAtTime(v, t, 0.05);
    if (kind === 'sfx') busSfx.gain.setTargetAtTime(v * 1.3, t, 0.05);
    if (kind === 'amb') busAmb.gain.setTargetAtTime(v, t, 0.05);
  },
  toggleMute() {
    muted = !muted;
    if (ctx) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
    if (muted) sfx.setHeartbeat(0);
    return muted;
  },
  get muted() { return muted; },
};

// Every button in the game makes a sound — one delegated listener covers buttons added later too.
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button, .btn, .icon, .acc-card, .mail-item, input[type=checkbox], input[type=range]');
  if (b && !b.disabled) sfx.click();
}, true);
document.addEventListener('pointerover', (e) => {
  const b = e.target.closest('button, .btn, .icon, .acc-card, .mail-item');
  if (b && !b.disabled && !b.contains(e.relatedTarget)) sfx.hover();
}, true);
