// Character voices via the server's Fish Audio proxy. Silently no-ops if TTS isn't configured.
import { sfx } from './sfx.js';

let enabled = null; // null = unknown yet
let current = null;
let on = true;

async function check() {
  if (enabled !== null) return enabled;
  try {
    const r = await fetch('/api/health').then((x) => x.json());
    enabled = !!r.tts;
  } catch { enabled = false; }
  return enabled;
}
check();

export const voice = {
  // Resolves with the clip's duration (seconds) the moment playback starts, or null if no voice.
  // If the voice isn't ready within maxWaitMs it is DROPPED — a late voice out of sync with the text is worse than none.
  async say(text, voiceKey = 'neutral', maxWaitMs = 9000) {
    if (!on || sfx.muted || !text) return null;
    if (!(await check())) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), maxWaitMs);
    try {
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 600), voice: voiceKey }),
        signal: ctrl.signal,
      });
      if (!r.ok) return null;
      const blob = await r.blob();
      clearTimeout(timer);
      if (ctrl.signal.aborted) return null;
      const url = URL.createObjectURL(blob);
      if (current) { current.pause(); current = null; }
      const a = new Audio(url);
      a.volume = 1;
      current = a;
      await new Promise((res) => { a.onloadedmetadata = res; a.onerror = res; setTimeout(res, 1500); });
      sfx.duck(true);
      a.onended = () => { URL.revokeObjectURL(url); if (current === a) { current = null; sfx.duck(false); } };
      try { await a.play(); } catch { sfx.duck(false); return null; }
      return Number.isFinite(a.duration) ? a.duration : Math.max(1.5, text.length / 14);
    } catch { return null; } finally { clearTimeout(timer); }
  },
  stop() { if (current) { current.pause(); current = null; sfx.duck(false); } },
  toggle() { on = !on; if (!on) voice.stop(); return on; },
  get on() { return on; },
  get available() { return enabled; },
};
