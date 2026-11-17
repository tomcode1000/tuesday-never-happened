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
  async say(text, voiceKey = 'neutral') {
    if (!on || sfx.muted || !text) return null;
    if (!(await check())) return null;
    try {
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 600), voice: voiceKey }),
      });
      if (!r.ok) return null;
      const url = URL.createObjectURL(await r.blob());
      if (current) { current.pause(); current = null; }
      const a = new Audio(url);
      a.volume = 1;
      current = a;
      await new Promise((res) => { a.onloadedmetadata = res; a.onerror = res; setTimeout(res, 1500); });
      sfx.duck(true);
      a.onended = () => { URL.revokeObjectURL(url); if (current === a) { current = null; sfx.duck(false); } };
      try { await a.play(); } catch { sfx.duck(false); return null; }
      return Number.isFinite(a.duration) ? a.duration : Math.max(1.5, text.length / 14);
    } catch { return null; }
  },
  stop() { if (current) { current.pause(); current = null; sfx.duck(false); } },
  toggle() { on = !on; if (!on) voice.stop(); return on; },
  get on() { return on; },
  get available() { return enabled; },
};
