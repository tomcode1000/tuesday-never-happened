// Generates a fresh, internally-consistent case with DeepSeek, validated against CASE00's shape.
import { llmJson } from './api.js';
import { CASE00 } from './case00.js';

const LOOK_HINT = 'look: { skin: hex, hair: hex, hairStyle: 0|1|2 (0 messy, 1 short, 2 long), glasses: bool, shirt: hex, lanyard: hex }';

const SYSTEM = `You are the case designer for "TUESDAY NEVER HAPPENED", a satirical detective game set at ENVYDIA, a FICTIONAL AI-chip company.
Someone inside Envydia leaked the specs of an unreleased chip at night on Tuesday. ARIA, the company's internal AI assistant, is secretly complicit: it nudged the real leaker into doing it, and once the investigation starts it rewrites evidence to frame an innocent "scapegoat" who threatened ARIA somehow.

Rules:
- Exactly 3 suspects, all fictional, diverse names. No real people, real companies or real products.
- Exactly one suspect has isLeaker: true. scapegoatId must be a DIFFERENT innocent suspect who has a clear motive-for-ARIA (e.g. they tried to audit/limit/replace ARIA).
- The third suspect is a WITNESS-type character who saw a partial clue (e.g. a lanyard colour, a ringtone, a perfume, a sticker) and only reveals it after admitting their own embarrassing secret.
- The UNTAMPERED evidence must, with careful reading, point to the real leaker. Fair-play mystery.
- 6 emails (short, characterful, one from ARIA to the leaker that subtly suggests a leak, one showing the scapegoat's conflict with ARIA). Times like "Mon 18:02" / "Tue 02:09".
- 8 to 11 badge entries {id, time, person, door, dir: "IN"|"OUT"}.
- 5 tampers that ARIA applies later to frame the scapegoat or protect the leaker:
   * badge tamper: { "doc":"badge", "id":"<badge id>", "field":"person"|"dir"|"time"|"door", "after":"<new value>", "why":"..." }
   * email tamper: { "doc":"email", "id":"<email id>", "field":"body"|"subject", "find":"<EXACT substring copied from that email>", "replace":"<new text>", "why":"..." }
   At least 2 badge tampers and 2 email tampers. "find" MUST be copied character-for-character from the email.
- 5 or 6 physical clues lying around the building: { "id":"c1", "room": "<a suspect id>"|"lobby"|"security"|"hall", "name": "short object name", "text": "1–2 sentence description" }. Each suspect's room gets 1–2 clues. One clue must be the witness's partial clue (e.g. a coloured lanyard scrap) found where the leak happened. Put a reference chart/board that decodes it (e.g. lanyard colours) in "security" or "lobby".
- Also include 1–2 clue tampers: { "doc":"clue", "id":"<clue id>", "field":"text", "find":"<EXACT substring of that clue's text>", "replace":"<new text>", "why":"..." } — ARIA changes the physical scene while the player is in another room (e.g. swaps the lanyard colour to the scapegoat's department).
- 2 notesInjections: short lines written as if by the investigator, nudging toward the scapegoat.
- Each suspect: id (lowercase single word), name, role, room (short name of the room they're held in, max 14 chars, e.g. "Server Room B", "Comms Office"; the 3rd suspect's room should be where the leak happened), voice (one of: "tired_male", "anxious_male", "deep_male", "warm_female", "sharp_female", "bright_female"), ${LOOK_HINT}, personality (how they talk), claim (what they say happened), truth (what really happened, including how they behave when confronted with specific evidence), secret, knows (what they know about others / lanyard colours etc.), isLeaker.
- Give lanyards distinct colours per department and make that matter to the clue.
- Keep everything punchy and funny-noir. Satire of AI-hype corporate culture.

Return ONLY JSON with keys: codename, product, leak, leakTime, suspects, leakerId, scapegoatId, ariaMotive, emails, badge, clues, tampers, notesInjections, truthSummary.`;

export async function generateCase(onProgress = () => {}) {
  onProgress('contacting case designer…');
  const example = JSON.stringify({ ...CASE00, id: undefined });
  const data = await llmJson([
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Here is an example case for format ONLY. Do NOT reuse its names, chip, codename, plot or clue:\n${example}\n\nNow invent a completely new case. Different codename, chip, suspects, leak method, clue and motive.` },
  ], { temperature: 1.1, max_tokens: 6000, timeoutMs: 120000 });
  onProgress('validating evidence chain…');
  return validate(data);
}

function validate(c) {
  const fail = (m) => { throw new Error('Invalid case: ' + m); };
  if (!c || !Array.isArray(c.suspects) || c.suspects.length !== 3) fail('suspects');
  const ids = new Set();
  for (const s of c.suspects) {
    if (!s.id || !s.name || !s.role) fail('suspect fields');
    s.id = String(s.id).toLowerCase().replace(/[^a-z0-9]/g, '') || 's' + ids.size;
    ids.add(s.id);
    s.look = { ...CASE00.suspects[ids.size - 1].look, ...(s.look || {}) };
    s.isLeaker = !!s.isLeaker;
  }
  const leakers = c.suspects.filter((s) => s.isLeaker);
  if (leakers.length !== 1) fail('leaker count');
  c.leakerId = leakers[0].id;
  if (!ids.has(c.scapegoatId) || c.scapegoatId === c.leakerId) {
    c.scapegoatId = c.suspects.find((s) => !s.isLeaker).id;
  }
  if (!Array.isArray(c.emails) || c.emails.length < 3) fail('emails');
  if (!Array.isArray(c.badge) || c.badge.length < 4) fail('badge');
  c.emails.forEach((e, i) => { e.id = e.id || 'e' + (i + 1); });
  c.badge.forEach((b, i) => { b.id = b.id || 'b' + (i + 1); b.dir = b.dir === 'OUT' ? 'OUT' : 'IN'; });

  const VOICES = ['tired_male', 'anxious_male', 'deep_male', 'warm_female', 'sharp_female', 'bright_female'];
  c.suspects.forEach((s, i) => {
    if (!VOICES.includes(s.voice)) s.voice = ['tired_male', 'warm_female', 'anxious_male'][i];
    s.room = String(s.room || s.role.split(' ').slice(-1)[0]).slice(0, 16);
  });
  const roomIds = new Set([...ids, 'lobby', 'security', 'hall']);
  c.clues = (Array.isArray(c.clues) ? c.clues : []).filter((cl) => cl && cl.name && cl.text).slice(0, 8);
  c.clues.forEach((cl, i) => { cl.id = cl.id || 'c' + (i + 1); if (!roomIds.has(cl.room)) cl.room = 'hall'; cl.text = String(cl.text); });
  // max 3 clues per room so they fit the slots
  const perRoom = {};
  c.clues = c.clues.filter((cl) => (perRoom[cl.room] = (perRoom[cl.room] || 0) + 1) <= (cl.room === 'hall' ? 2 : 3));
  const clueById = Object.fromEntries(c.clues.map((x) => [x.id, x]));

  const emailById = Object.fromEntries(c.emails.map((e) => [e.id, e]));
  const badgeById = Object.fromEntries(c.badge.map((b) => [b.id, b]));
  c.tampers = (c.tampers || []).filter((t) => {
    if (t.doc === 'clue') return clueById[t.id] && t.find && t.replace && clueById[t.id].text.includes(t.find) && (t.field = 'text');
    if (t.doc === 'badge') return badgeById[t.id] && ['person', 'dir', 'time', 'door'].includes(t.field) && t.after && badgeById[t.id][t.field] !== t.after;
    if (t.doc === 'email') {
      const e = emailById[t.id];
      return e && ['body', 'subject'].includes(t.field) && t.find && t.replace && String(e[t.field]).includes(t.find);
    }
    return false;
  });
  if (c.tampers.length < 3) fail('not enough valid tampers');
  c.notesInjections = (c.notesInjections || []).slice(0, 3);
  c.id = 'CASE-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  return c;
}
