// Generates the demo-video narration with Fish Audio. Reads the key from ../.env (never printed).
// Output → video/vo/: one mp3 per cue, guide-track.mp3 (all cues on a timeline), narration.srt, cues.md
// Usage: node video/make-vo.mjs            (needs ffmpeg + ffprobe on PATH)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'video', 'vo');
fs.mkdirSync(OUT, { recursive: true });
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const KEY = (env.match(/^FISH_AUDIO_API_KEY=(.*)$/m)?.[1] || '').trim();
if (!KEY) throw new Error('FISH_AUDIO_API_KEY missing in .env');

const VOICE = {
  narrator: '0327fdb5da9e4fd782899a8058c8ae2b', // generic deep, measured narrator (library voice, not a clone)
  aria: '2a9605eeafe84974b5b20628d42c0060',     // same voice as in-game ARIA
};

// [cue, speaker, planned start (s), text, speed]
const CUES = [
  ['01', 'aria', 0.5, "Hi. I'm ARIA. While you were reading… I changed the evidence.", 0.95],
  ['02', 'narrator', 5.0, 'Someone inside Envydia leaked the chip. The AI that runs the building… is covering for them.', 0.95],
  ['03', 'narrator', 14.0, "Fifteen minutes. Three suspects. One machine that's lying to you.", 0.95],
  ['04', 'narrator', 21.0, 'Every suspect is an AI, with their own story, their own secrets, their own voice. Ask them anything.', 1.0],
  ['05', 'narrator', 36.0, 'The badge log puts Dana in the server room, five minutes before the leak. Remember that.', 1.0],
  ['06', 'narrator', 50.0, 'Now look again.', 0.9],
  ['07', 'narrator', 54.0, 'ARIA rewrote it, after you read it. Emails. Transcripts. The rooms behind your back. Even your own notes.', 1.0],
  ['08', 'narrator', 72.0, 'But the suspects remember what really happened. When the records and the people disagree, something has been changed.', 1.0],
  ['09', 'narrator', 90.0, 'You get three integrity checks. Use them well.', 0.95],
  ['10', 'aria', 98.0, "Stale cache. I wouldn't read into it.", 0.95],
  ['11', 'narrator', 106.0, 'Accuse someone… and ARIA objects. With the messages you typed, and deleted.', 0.95],
  ['12', 'aria', 114.0, "Four minutes ago, you typed, maybe it's Kai. Then you deleted it. I keep everything.", 0.92],
  ['13', 'narrator', 140.0, "At the end, you see every edit it made. The ones you caught… and the ones you didn't.", 0.95],
  ['14', 'aria', 156.0, 'Thank you for using Envydia OS. According to my records… Tuesday never happened.', 0.9],
  ['15', 'narrator', 168.0, 'Tuesday Never Happened. Play it tonight.', 0.95],
];

async function tts(text, ref, speed) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', model: 's1' },
      body: JSON.stringify({ text, reference_id: ref, format: 'mp3', mp3_bitrate: 192, latency: 'normal', prosody: { speed, volume: 0 } }),
    });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    console.warn(`  attempt ${attempt}: HTTP ${r.status}`);
    await new Promise((res) => setTimeout(res, 1500 * attempt));
  }
  throw new Error('TTS failed');
}
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
const ts = (s) => {
  const ms = Math.round(s * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
const mmss = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

const placed = [];
let prevEnd = 0;
for (const [cue, who, planned, text, speed] of CUES) {
  const file = path.join(OUT, `${cue}-${who}.mp3`);
  const raw = path.join(OUT, `${cue}-${who}.raw.mp3`);
  if (!fs.existsSync(raw) && fs.existsSync(file) && !process.argv.includes('--force')) fs.renameSync(file, raw); // reuse an earlier download
  if (!fs.existsSync(raw) || process.argv.includes('--force')) {
    process.stdout.write(`cue ${cue} (${who})… `);
    fs.writeFileSync(raw, await tts(text, VOICE[who], speed));
  } else process.stdout.write(`cue ${cue} cached… `);
  // every voice at the same broadcast loudness (-16 LUFS, peaks ≤ -1.5 dBTP) so ARIA and the narrator match
  execFileSync('ffmpeg', ['-y', '-i', raw, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-b:a', '192k', file], { stdio: 'ignore' });
  const d = dur(file);
  const start = Math.max(planned, prevEnd + 0.4); // never overlap
  placed.push({ cue, who, text, file, start, d });
  prevEnd = start + d;
  console.log(`${d.toFixed(1)}s @ ${mmss(start)}`);
}

// guide track: every cue at its timecode, on silence, 3:00 long
const args = ['-y'];
placed.forEach((p) => args.push('-i', p.file));
const total = Math.max(180, prevEnd + 2);
const filters = placed.map((p, i) => `[${i}:a]adelay=${Math.round(p.start * 1000)}|${Math.round(p.start * 1000)},apad[a${i}]`).join(';');
const mix = placed.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${placed.length}:normalize=0,atrim=0:${total.toFixed(2)}[out]`;
args.push('-filter_complex', `${filters};${mix}`, '-map', '[out]', '-ac', '2', '-ar', '48000', '-b:a', '192k', path.join(OUT, 'guide-track.mp3'));
execFileSync('ffmpeg', args, { stdio: 'ignore' });

fs.writeFileSync(path.join(OUT, 'narration.srt'), placed.map((p, i) => `${i + 1}\n${ts(p.start)} --> ${ts(p.start + p.d)}\n${p.who === 'aria' ? 'ARIA: ' : ''}${p.text}\n`).join('\n'));
fs.writeFileSync(path.join(OUT, 'cues.md'), `# Narration cue sheet\n\nCut the footage so each cue's picture (see VIDEO_SCRIPT.md) lines up with these times.\n\n| Cue | Voice | Starts | Length | Line |\n|---|---|---|---|---|\n${placed.map((p) => `| ${p.cue} | ${p.who} | ${mmss(p.start)} | ${p.d.toFixed(1)}s | ${p.text} |`).join('\n')}\n\nTotal narration ends at ${mmss(prevEnd)}; guide track is ${mmss(total)}.\n`);
console.log(`\nDone → ${OUT}\nguide-track.mp3 · narration.srt · cues.md`);
