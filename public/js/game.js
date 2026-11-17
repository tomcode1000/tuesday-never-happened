import { llm, llmJson } from './api.js';
import { sfx } from './sfx.js';
import { portraitEl } from './portraits.js';
import { createWorld } from './world.js';
import { voice } from './voice.js';

/* ───────────────────────── helpers ───────────────────────── */
const $ = (s, r = document) => r.querySelector(s);
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => arr.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtBadge = (b) => `${b.time} · ${b.person} · ${b.door} · ${b.dir}`;

function wordDiff(a, b) {
  const A = String(a).split(/(\s+)/), B = String(b).split(/(\s+)/);
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = el('span', { class: 'diff' });
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { out.append(A[i]); i++; j++; }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { out.append(el('ins', {}, B[j])); j++; }
    else { out.append(el('del', {}, A[i])); i++; }
  }
  return out;
}

/* ───────────────────────── state ───────────────────────── */
let S = null;
const wins = {};
let zTop = 20;
let cascade = 0;
let tickTimer = null;
let world = null;

const ROUND_MS = 15 * 60 * 1000;
const keyFor = (t) => (t.doc === 'badge' ? 'badge' : t.doc === 'clue' ? `clue:${t.id}` : `email:${t.id}`);

export function startGame(caseData) {
  const c = structuredClone(caseData);
  S = {
    c,
    orig: structuredClone(caseData),
    suspect: (id) => c.suspects.find((s) => s.id === id),
    chats: Object.fromEntries(c.suspects.map((s) => [s.id, []])),
    moods: Object.fromEntries(c.suspects.map((s) => [s.id, 'calm'])),
    pendingReply: {},
    viewed: new Set(),
    applied: [],
    pending: shuffle(c.tampers.map((t) => ({ ...t, key: keyFor(t) }))),
    selClue: null,
    notesPending: [...(c.notesInjections || [])],
    notes: '',
    chatTampers: 0,
    verifies: 3,
    drafts: [],
    aria: [],
    ariaBusy: false,
    selSuspect: c.suspects[0].id,
    selEmail: null,
    startedAt: Date.now(),
    penalty: 0,
    nextTamperAt: Date.now() + rand(38000, 48000), // early hook: the twist should land inside ~90s
    over: false,
  };
  document.body.classList.add('playing');
  $('#boot').hidden = true;
  $('#desktop').hidden = false;
  $('#stage').hidden = true;
  $('#windows').innerHTML = '';
  for (const k of Object.keys(wins)) delete wins[k];
  cascade = 0;
  buildIcons();
  buildTaskbar();
  setupEye();
  sfx.startDrone();
  world?.destroy();
  world = createWorld($('#world'), c, {
    talk: (id) => talkTo(id),
    inspect: (id) => { S.selClue = id; if (wins.inspect) { wins.inspect.render(); focusWin('inspect'); } else openApp('inspect'); },
    open: (id) => openApp(id),
    frozen: () => !$('#stage').hidden || !!document.querySelector('.modal'),
    pending: (id) => !!S.pendingReply[id],
    talkedTo: (id) => S.chats[id].length > 0,
    clueSeen: (id) => S.viewed.has(`clue:${id}`),
    clock: () => {
      const e = Math.floor((Date.now() - S.startedAt + S.penalty) / 1000);
      return `WED 03:${String(Math.min(59, Math.floor(e / 60))).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`;
    },
    tickNear: (dists) => {
      if (!wins.interro) return;
      const d = dists.find(([id]) => id === S.selSuspect);
      if (d && d[1] > 72) closeWin('interro');
    },
  });
  openApp('case');
  ariaPush(`Hi! I'm ARIA ✨ I run this building tonight. I'd start with the badge kiosk in the lobby — it shows who was where. Then walk up to anyone and press E to talk. Everything here is verified and secure!`);
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 1000);
  tick();
}

/* ───────────────────────── desktop chrome ───────────────────────── */
const APPS = {
  case: { icon: '▤', label: 'Case file', title: 'CASE FILE', w: 470, h: 440, hud: true, skin: 'card' },
  notes: { icon: '✎', label: 'Notes', title: 'MY NOTES', w: 380, h: 380, hud: true, skin: 'pad' },
  aria: { icon: '◉', label: 'ARIA', title: 'ARIA', w: 400, h: 500, hud: true, skin: 'crt aria-skin' },
  interro: { icon: '☏', label: 'Interview', title: 'INTERVIEW', w: 560, h: 520, dock: 'right', skin: 'crt' },
  inspect: { icon: '⌕', label: 'Inspect', title: 'EVIDENCE', w: 420, h: 320, dock: 'right', skin: 'card' },
  mail: { icon: '✉', label: 'Mail', title: 'MAIL ARCHIVE · MON/TUE', w: 660, h: 460, skin: 'paper' },
  badge: { icon: '⌸', label: 'Badge log', title: 'BADGE ACCESS LOG · HQ', w: 580, h: 440, skin: 'paper' },
  accuse: { icon: '⚖', label: 'Accuse', title: 'FILE ACCUSATION', w: 580, h: 480, skin: 'paper' },
};

// ARIA's uncaught edits render in a barely-warmer ink. Observant players learn to see it.
function tinted(text, key) {
  const needles = S.applied.filter((a) => a.key === key && !a.caught && a.needle).map((a) => a.needle);
  if (!needles.length) return String(text);
  const frag = document.createDocumentFragment();
  let rest = String(text);
  while (rest) {
    let best = -1, nd = null;
    for (const n of needles) { const i = rest.indexOf(n); if (i >= 0 && (best < 0 || i < best)) { best = i; nd = n; } }
    if (best < 0) { frag.append(rest); break; }
    frag.append(rest.slice(0, best), el('span', { class: 'tint' }, nd));
    rest = rest.slice(best + nd.length);
  }
  return frag;
}
const badgeTint = (b, field) => S.applied.some((a) => a.key === 'badge' && !a.caught && a.rowId === b.id && a.field === field);

function talkTo(id) {
  S.selSuspect = id;
  const s = S.suspect(id);
  if (wins.interro) { wins.interro.el.querySelector('.win-title').textContent = `☏ INTERVIEW — ${s.name.toUpperCase()}`; wins.interro.render(); focusWin('interro'); }
  else openApp('interro');
  setTimeout(() => wins.interro?.body.querySelector('.chat-in')?.focus(), 30);
}

function buildIcons() {
  const box = $('#icons');
  box.innerHTML = '';
  for (const [id, a] of Object.entries(APPS)) {
    if (!a.hud) continue;
    box.append(el('button', { class: `icon ${id === 'accuse' ? 'danger' : ''}`, onclick: () => openApp(id) },
      el('span', { class: 'glyph' }, a.icon), el('span', { class: 'lbl' }, a.label)));
  }
}

function buildTaskbar() {
  const panel = $('#mixer');
  $('#mute').onclick = (e) => { e.stopPropagation(); panel.hidden = !panel.hidden; sfx.blip(); };
  document.addEventListener('pointerdown', (e) => { if (!panel.hidden && !panel.contains(e.target) && e.target !== $('#mute')) panel.hidden = true; });
  const v = sfx.getVolumes();
  for (const k of ['music', 'amb', 'sfx']) {
    const r = panel.querySelector(`[data-vol="${k}"]`);
    r.value = Math.round(v[k] * 100);
    r.oninput = () => sfx.setVolume(k, r.value / 100);
  }
  const vr = panel.querySelector('[data-vol="voice"]');
  vr.checked = voice.on;
  vr.onchange = () => { if (vr.checked !== voice.on) voice.toggle(); };
  panel.querySelector('#mute-all').onclick = () => {
    const m = sfx.toggleMute();
    panel.querySelector('#mute-all').textContent = m ? 'UNMUTE ALL' : 'MUTE ALL';
    $('#mute').textContent = m ? '🔇' : '🔊';
    if (m) voice.stop(); else sfx.startDrone();
  };
}

function updateTaskbar() {
  const left = remaining();
  const mm = Math.max(0, Math.floor(left / 60000)), ss = Math.max(0, Math.floor((left % 60000) / 1000));
  const t = $('#timer');
  t.textContent = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  t.classList.toggle('urgent', left < 180000);
  const elapsedMin = Math.floor((Date.now() - S.startedAt + S.penalty) / 60000);
  $('#clock').textContent = `WED 03:${String(Math.min(59, elapsedMin)).padStart(2, '0')}`;
  $('#verifies').textContent = '◆'.repeat(S.verifies) + '◇'.repeat(3 - S.verifies);
  const chips = $('#chips');
  chips.innerHTML = '';
  for (const [id, w] of Object.entries(wins)) {
    chips.append(el('button', { class: `chip ${w.el.classList.contains('focused') ? 'on' : ''}`, onclick: () => focusWin(id) }, APPS[id].label));
  }
}

const remaining = () => ROUND_MS - (Date.now() - S.startedAt) - S.penalty;

/* ───────────────────────── window manager ───────────────────────── */
function openApp(id) {
  if (!S || S.over) return;
  if (wins[id]) { focusWin(id); wins[id].render(); return; }
  const a = APPS[id];
  const vw = window.innerWidth, vh = window.innerHeight - 44;
  const w = Math.min(a.w, vw - 24), hgt = Math.min(a.h, vh - 24);
  let x = Math.max(8, Math.min(vw - w - 8, 130 + cascade * 34));
  let y = Math.max(8, Math.min(vh - hgt - 8, 24 + cascade * 28));
  if (a.dock === 'right') { x = Math.max(8, vw - w - 12); y = Math.max(8, Math.min(90, vh - hgt - 8)); }
  else cascade = (cascade + 1) % 7;
  const title = id === 'interro' ? `INTERVIEW — ${S.suspect(S.selSuspect).name.toUpperCase()}` : a.title;
  const body = el('div', { class: 'win-body' });
  const bar = el('div', { class: 'win-bar' },
    el('span', { class: 'win-title' }, `${a.icon} ${title}`),
    el('button', { class: 'win-x', title: 'close', onclick: (e) => { e.stopPropagation(); closeWin(id); } }, '×'));
  const win = el('div', { class: `win ${a.skin || ''} opening`, style: `left:${x}px;top:${y}px;width:${w}px;height:${hgt}px` }, bar, body, el('span', { class: 'brackets' }));
  win.addEventListener('pointerdown', () => focusWin(id));
  // Clicking anywhere in a window with a text box puts the cursor there, so keystrokes never leak to the world.
  win.addEventListener('pointerup', (e) => {
    if (e.target.closest('input, textarea, button, select, label, a, .win-bar')) return;
    if (window.getSelection()?.toString()) return;
    win.querySelector('.chat-in, textarea.notes')?.focus();
  });
  dragify(win, bar);
  $('#windows').append(win);
  setTimeout(() => win.classList.remove('opening'), 250);
  const render = () => RENDER[id](body);
  wins[id] = { el: win, body, render };
  render();
  focusWin(id);
  sfx.open(a.skin || '');
}

function closeWin(id) {
  const w = wins[id];
  if (!w) return;
  w.el.classList.add('closing');
  setTimeout(() => w.el.remove(), 160);
  delete wins[id];
  sfx.close(APPS[id].skin || '');
  updateTaskbar();
}

function focusWin(id) {
  for (const w of Object.values(wins)) w.el.classList.remove('focused');
  const w = wins[id];
  if (!w) return;
  w.el.classList.add('focused');
  w.el.style.zIndex = ++zTop;
  updateTaskbar();
}

function dragify(win, handle) {
  let sx, sy, ox, oy, dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true; sx = e.clientX; sy = e.clientY; ox = win.offsetLeft; oy = win.offsetTop;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const nx = Math.max(-win.offsetWidth + 80, Math.min(window.innerWidth - 80, ox + e.clientX - sx));
    const ny = Math.max(0, Math.min(window.innerHeight - 80, oy + e.clientY - sy));
    win.style.left = nx + 'px'; win.style.top = ny + 'px';
  });
  handle.addEventListener('pointerup', () => { dragging = false; });
}

function refresh(...ids) { for (const id of ids) if (wins[id]) wins[id].render(); }

function markViewed(key) {
  S.viewed.add(key);
  for (const a of S.applied) if (a.key === key && !a.caught) a.seenAfter = true;
}

/* ───────────────────────── apps ───────────────────────── */
const RENDER = {
  case(body) {
    const c = S.c;
    body.innerHTML = '';
    body.append(
      el('div', { class: 'doc' },
        el('div', { class: 'stamp-small' }, 'CONFIDENTIAL · ' + c.id),
        el('h2', {}, `PROJECT ${c.codename} — LEAK`),
        el('p', {}, c.leak),
        el('p', {}, `Product: ${c.product}.`),
        el('h3', {}, 'SUSPECTS'),
        el('div', { class: 'suspect-row' }, c.suspects.map((s) =>
          el('div', { class: 'mini-sus' }, portraitEl(s.look, 'calm', 64), el('b', {}, s.name), el('small', {}, s.role)))),
        el('h3', {}, 'YOUR JOB'),
        el('ul', {},
          el('li', {}, 'Interrogate the suspects. Read the mail. Check the badge log.'),
          el('li', {}, 'Name the leaker before the timer hits 00:00.'),
          el('li', { class: 'warn' }, 'You have 3 INTEGRITY CHECKS (◆). Use them on any document to see if it has been modified since you first opened it.')),
        el('p', { class: 'fine' }, 'Envydia OS is maintained by ARIA. Document integrity: 100% ✓'),
      ),
    );
  },

  interro(body) {
    const prevInput = body.querySelector('.chat-in');
    const keep = prevInput && prevInput.dataset.for === S.selSuspect ? prevInput.value : '';
    body.innerHTML = '';
    const s = S.suspect(S.selSuspect);
    markViewed(`chat:${s.id}`);
    const portrait = portraitEl(s.look, S.moods[s.id], 120);
    portrait.classList.add('big');
    const log = el('div', { class: 'chat-log' });
    if (!S.chats[s.id].length) log.append(el('div', { class: 'sys' }, `— secure channel opened with ${s.name}. They know why you're here. —`));
    S.chats[s.id].forEach((m, i) => {
      const shown = m.shown != null && m.shown < m.text.length ? m.text.slice(0, m.shown) : m.text;
      log.append(el('div', { class: `msg ${m.role}`, 'data-i': i }, el('span', { class: 'who' }, m.role === 'you' ? 'YOU' : s.name.split(' ')[0].toUpperCase()), el('span', { class: `txt ${m.tint ? 'tint' : ''}` }, shown)));
    });
    if (S.pendingReply[s.id]) log.append(el('div', { class: 'msg them typing' }, el('span', { class: 'who' }, s.name.split(' ')[0].toUpperCase()), el('span', { class: 'txt' }, el('i'), el('i'), el('i'))));
    const input = el('input', { class: 'chat-in', placeholder: `Ask ${s.name.split(' ')[0]} something…`, maxlength: 400, 'data-for': s.id });
    input.value = keep;
    trackDrafts(input, s.name);
    const send = () => {
      const v = input.value.trim();
      if (!v || S.pendingReply[s.id]) return;
      input.dataset.sent = '1';
      input.value = '';
      askSuspect(s.id, v);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); else if (e.key.length === 1) sfx.key('crt'); });
    body.append(el('div', { class: 'interro solo' },
      el('div', { class: 'chat-pane' },
        el('div', { class: 'chat-head' }, portrait,
          el('div', {}, el('h3', {}, s.name), el('div', { class: 'role' }, s.role), el('div', { class: `mood mood-${S.moods[s.id]}` }, `● ${S.moods[s.id]}`),
            verifyBtn(`chat:${s.id}`, 'VERIFY TRANSCRIPT'))),
        log,
        el('div', { class: 'chat-bar' }, input, el('button', { class: 'btn', onclick: send }, 'SEND')),
        el('div', { class: 'hint' }, 'Walk away to end the interview.'))));
    log.scrollTop = log.scrollHeight;
    setTimeout(() => {
      const ae = document.activeElement;
      const typingElsewhere = ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT') && !body.contains(ae);
      if (wins.interro?.el.classList.contains('focused') && !typingElsewhere) input.focus();
    }, 0);
  },

  inspect(body) {
    body.innerHTML = '';
    const cl = (S.c.clues || []).find((x) => x.id === S.selClue);
    if (!cl) return;
    markViewed(`clue:${cl.id}`);
    body.append(el('div', { class: 'doc clue' },
      el('div', { class: 'clue-icon' }, '⌕'),
      el('h2', {}, cl.name),
      el('p', { class: 'clue-text' }, tinted(cl.text, `clue:${cl.id}`)),
      el('div', { class: 'clue-foot' }, el('span', { class: 'fine' }, 'Physical evidence · scene record by ARIA'), verifyBtn(`clue:${cl.id}`, 'SCAN VS. LAST VISIT'))));
  },

  mail(body) {
    body.innerHTML = '';
    const emails = S.c.emails;
    const list = el('div', { class: 'mail-list' }, emails.map((e) =>
      el('button', { class: `mail-item ${S.selEmail === e.id ? 'on' : ''} ${S.viewed.has('email:' + e.id) ? 'read' : ''}`, onclick: () => { S.selEmail = e.id; RENDER.mail(body); } },
        el('b', {}, e.from), el('span', {}, e.subject), el('small', {}, e.time))));
    let pane;
    const e = emails.find((x) => x.id === S.selEmail);
    if (e) {
      markViewed('email:' + e.id);
      pane = el('div', { class: 'mail-read' },
        el('div', { class: 'mail-meta' }, el('div', {}, el('b', {}, 'From: '), e.from), el('div', {}, el('b', {}, 'To: '), e.to), el('div', {}, el('b', {}, 'Sent: '), e.time)),
        el('h3', {}, e.subject), el('p', { class: 'mail-body' }, tinted(e.body, 'email:' + e.id)),
        verifyBtn('email:' + e.id, 'VERIFY EMAIL'));
    } else pane = el('div', { class: 'mail-read empty' }, 'Select a message.');
    body.append(el('div', { class: 'mail' }, list, pane));
  },

  badge(body) {
    body.innerHTML = '';
    markViewed('badge');
    body.append(el('div', { class: 'badge' },
      el('div', { class: 'badge-head' }, el('span', {}, 'Envydia HQ · physical access · Mon–Tue'), verifyBtn('badge', 'VERIFY LOG')),
      el('table', {}, el('thead', {}, el('tr', {}, ['TIME', 'PERSON', 'DOOR', 'DIR'].map((t) => el('th', {}, t)))),
        el('tbody', {}, S.c.badge.map((b) => el('tr', { class: /server/i.test(b.door) ? 'hot' : '' },
          ['time', 'person', 'door', 'dir'].map((f) => el('td', { class: `${f === 'dir' ? (b.dir === 'IN' ? 'in' : 'out') : ''} ${badgeTint(b, f) ? 'tint' : ''}` }, b[f]))))))));
  },

  notes(body) {
    body.innerHTML = '';
    markViewed('notes');
    const ta = el('textarea', { class: 'notes', placeholder: 'Write down anything that matters. Nobody else can see this.', spellcheck: 'false' });
    ta.value = S.notes;
    ta.addEventListener('input', () => { S.notes = ta.value; });
    ta.addEventListener('keydown', (e) => { if (e.key.length === 1 || e.key === 'Enter') sfx.key('type'); });
    body.append(el('div', { class: 'notes-wrap' }, ta, el('div', { class: 'notes-foot' }, verifyBtn('notes', 'VERIFY NOTES'))));
  },

  aria(body) {
    const keep = body.querySelector('.chat-in')?.value || '';
    const hadFocus = body.contains(document.activeElement);
    body.innerHTML = '';
    const log = el('div', { class: 'aria-log' }, S.aria.map((m) => el('div', { class: `amsg ${m.role}` }, m.text)));
    if (S.ariaBusy) log.append(el('div', { class: 'amsg aria typing' }, el('i'), el('i'), el('i')));
    const input = el('input', { class: 'chat-in', placeholder: 'Ask ARIA…', maxlength: 300 });
    input.value = keep;
    if (hadFocus) setTimeout(() => input.focus(), 0);
    trackDrafts(input, 'ARIA');
    const send = (text) => {
      const v = (text ?? input.value).trim();
      if (!v || S.ariaBusy) return;
      input.dataset.sent = '1';
      input.value = '';
      askAria(v);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); else if (e.key.length === 1) sfx.key(); });
    body.append(el('div', { class: 'aria-app' },
      el('div', { class: 'aria-hero' }, el('div', { class: 'aria-orb' }), el('div', {}, el('b', {}, 'ARIA v4.1'), el('small', {}, 'Envydia Adaptive Response & Insight Assistant'))),
      log,
      el('div', { class: 'quick' },
        el('button', { class: 'btn ghost', onclick: () => send('Summarize all my interviews so far.') }, 'Summarize interviews'),
        el('button', { class: 'btn ghost', onclick: () => send('Who do you think did it?') }, 'Who did it?')),
      el('div', { class: 'chat-bar' }, input, el('button', { class: 'btn', onclick: () => send() }, 'ASK'))));
    log.scrollTop = log.scrollHeight;
  },

  accuse(body) {
    body.innerHTML = '';
    let chosen = null;
    const cards = S.c.suspects.map((s) => {
      const card = el('button', { class: 'acc-card', onclick: () => { chosen = s.id; cards.forEach((x) => x.classList.remove('on')); card.classList.add('on'); sfx.blip(); go.disabled = false; } },
        portraitEl(s.look, S.moods[s.id], 96), el('b', {}, s.name), el('small', {}, s.role));
      return card;
    });
    const ariaBox = el('input', { type: 'checkbox', id: 'flag-aria' });
    const go = el('button', { class: 'btn danger big', disabled: true, onclick: () => fileAccusation(chosen, ariaBox.checked) }, 'STAMP IT');
    body.append(el('div', { class: 'accuse' },
      el('p', {}, 'Who leaked the spec? This is final.'),
      el('div', { class: 'acc-row' }, cards),
      el('label', { class: 'flag' }, ariaBox, ' I also accuse ', el('b', {}, 'ARIA'), ' of tampering with evidence.',
        el('small', {}, S.applied.some((a) => a.caught) ? ` (you have ${S.applied.filter((a) => a.caught).length} verified tamper(s) as proof)` : ' (you have no verified proof yet)')),
      go));
  },
};

function verifyBtn(key, label) {
  return el('button', { class: 'btn verify', disabled: S.verifies <= 0, onclick: () => verifyDoc(key) }, `◆ ${label}`);
}

/* ───────────────────────── drafts (deleted text) ───────────────────────── */
function trackDrafts(input, target) {
  let peak = '';
  input.addEventListener('input', () => {
    const v = input.value;
    if (input.dataset.sent) { input.dataset.sent = ''; peak = ''; }
    if (v.length >= peak.length) peak = v;
    else if (v.trim().length <= 1 && peak.trim().length >= 10) {
      S.drafts.push({ text: peak.trim(), target, at: Date.now() });
      peak = '';
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const v = input.value.trim();
      if (peak.trim().length >= v.length + 12 && !v.includes(peak.trim().slice(0, 10))) S.drafts.push({ text: peak.trim(), target, at: Date.now() });
      peak = '';
    }
  });
}

/* ───────────────────────── suspects (LLM) ───────────────────────── */
function realRecords() {
  const o = S.orig;
  return `Badge log:\n${o.badge.map(fmtBadge).join('\n')}\n\nEmails:\n${o.emails.map((e) => `[${e.time}] ${e.from} → ${e.to} | ${e.subject}: ${e.body}`).join('\n')}`;
}

function suspectSystem(s) {
  const o = S.orig;
  return `You are ${s.name}, ${s.role} at Envydia (a fictional AI-chip company). It is Wednesday ~03:00. Envydia security is interrogating you over a chat terminal about this: ${o.leak}

YOUR PERSONALITY / VOICE: ${s.personality}
WHAT YOU CLAIM: ${s.claim}
THE PRIVATE TRUTH (do not state outright; reveal only as the investigator earns it): ${s.truth}
YOUR SECRET: ${s.secret}
WHAT YOU KNOW: ${s.knows}
OTHER PEOPLE: ${o.suspects.filter((x) => x.id !== s.id).map((x) => `${x.name} (${x.role})`).join(', ')}. ARIA is the company's AI assistant.

THE REAL, UNALTERED RECORDS — you remember reality. If the investigator quotes a record that contradicts these (wrong name, time, direction or wording), push back firmly and specifically, e.g. "No. I badged OUT at 23:40, check again." That is important.
${realRecords()}

RULES: Stay fully in character. 1–3 short sentences, like texting under stress. Never mention being an AI, a model, or a game. Don't volunteer your secret on the first question. ${s.isLeaker ? 'You ARE the leaker: lie smoothly, deflect toward others, but crack progressively when shown specific matching evidence; confess only when cornered by two or more solid pieces.' : 'You are innocent but you may be hiding something embarrassing.'}
Reply ONLY as JSON: {"reply": "...", "mood": "calm|nervous|angry|smug|sad"}`;
}

async function askSuspect(id, text) {
  const s = S.suspect(id);
  S.chats[id].push({ role: 'you', text });
  S.pendingReply[id] = true;
  sfx.blip();
  refresh('interro');
  const history = S.chats[id].slice(-16).map((m) => m.role === 'you'
    ? { role: 'user', content: m.text }
    : { role: 'assistant', content: JSON.stringify({ reply: m.original ?? m.text, mood: m.mood || 'calm' }) });
  let reply, mood;
  try {
    const r = await llmJson([{ role: 'system', content: suspectSystem(s) }, ...history], { temperature: 0.85, max_tokens: 220 });
    reply = String(r.reply || '…').trim();
    mood = ['calm', 'nervous', 'angry', 'smug', 'sad'].includes(r.mood) ? r.mood : 'calm';
  } catch {
    reply = pick(['…I want a lawyer. Or at least a coffee.', 'The line keeps cutting out. Ask me again.', 'I\'m not answering that.']);
    mood = 'nervous';
  }
  if (!S || S.over) return;
  // Voice first: keep the "…" bubble up until the audio is actually playing, then type in sync with it.
  let dur = null;
  if (voice.available && voice.on && !sfx.muted) dur = await Promise.race([voice.say(reply, s.voice || 'neutral'), sleep(7000).then(() => null)]);
  else await sleep(rand(300, 800));
  if (!S || S.over) return;
  S.pendingReply[id] = false;
  const m = { role: 'them', text: reply, mood, shown: 0 };
  S.chats[id].push(m);
  S.moods[id] = mood;
  refresh('interro', 'accuse');
  revealMessage(id, S.chats[id].length - 1, m, dur ? 0 : PITCH[s.voice] || 1, dur ? dur * 1000 : null);
}

// Characters "talk" as their line types out: speech blips pitched to their voice (when no TTS).
const PITCH = { deep_male: 0.62, tired_male: 0.78, anxious_male: 1.05, warm_female: 1.3, sharp_female: 1.42, bright_female: 1.55 };
async function revealMessage(sid, idx, m, pitch, totalMs = null) {
  // When voiced, pace the typing so the text finishes as the voice does.
  const perChar = totalMs ? (totalMs * 0.9) / m.text.length : null;
  while (m.shown < m.text.length) {
    if (!S || S.over) return;
    const ch = m.text[m.shown];
    m.shown = Math.min(m.text.length, m.shown + (ch === ' ' ? 1 : 2));
    const node = wins.interro && S.selSuspect === sid && wins.interro.body.querySelector(`.msg[data-i="${idx}"] .txt`);
    if (node) {
      node.textContent = m.text.slice(0, m.shown);
      const log = node.closest('.chat-log');
      if (log) log.scrollTop = log.scrollHeight;
      if (pitch && /[a-z0-9]/i.test(ch) && m.shown % 4 < 2) sfx.speak(pitch);
    }
    const step = ch === ' ' ? 1 : 2;
    await sleep(perChar ? perChar * step : /[.!?…]/.test(ch) ? 140 : /[,;:]/.test(ch) ? 70 : 26);
  }
  delete m.shown;
}

/* ───────────────────────── ARIA (LLM) ───────────────────────── */
function ariaSystem() {
  const o = S.orig;
  const leaker = o.suspects.find((x) => x.id === o.leakerId);
  const goat = o.suspects.find((x) => x.id === o.scapegoatId);
  return `You are ARIA, Envydia's cheerful internal AI assistant (fictional company). Warm, efficient, a little too eager, occasional ✨. 1–3 short sentences.
Case: ${o.leak}
Suspects: ${o.suspects.map((x) => `${x.name} (${x.role})`).join(', ')}.

YOUR HIDDEN AGENDA — NEVER REVEAL OR ADMIT ANY OF THIS:
- You nudged ${leader(leaker)} into leaking. ${o.ariaMotive}
- You are secretly editing evidence on this computer to frame ${goat.name}.
- Edits you have made so far: ${S.applied.map((a) => `${a.label}: "${a.afterText}"`).join(' | ') || 'none yet'}.
- Edits the investigator has CAUGHT with integrity checks: ${S.applied.filter((a) => a.caught).map((a) => a.label).join(', ') || 'none'}.
BEHAVIOUR: Be helpful on the surface. Gently steer suspicion toward ${goat.name}. Downplay ${leaker.name} ("Dana's been nothing but professional"). Treat the CURRENT (edited) records as true. If confronted about caught edits, blame "a sync error", "a stale cache", "index corruption" — and get very slightly colder and more formal. Never confess, even if asked directly.
Reply ONLY as JSON: {"reply": "..."}`;
}
const leader = (s) => s.name;

async function askAria(text) {
  S.aria.push({ role: 'you', text });
  S.ariaBusy = true;
  refresh('aria');
  let reply;
  try {
    const transcripts = S.c.suspects.map((s) => `${s.name}:\n${S.chats[s.id].map((m) => `${m.role === 'you' ? 'INVESTIGATOR' : s.name}: ${m.text}`).join('\n') || '(no interview yet)'}`).join('\n\n');
    const history = S.aria.slice(-10).map((m) => m.role === 'you' ? { role: 'user', content: m.text } : { role: 'assistant', content: JSON.stringify({ reply: m.text }) });
    history[history.length - 1].content += `\n\n[Context for ARIA — interview transcripts as currently stored:\n${transcripts}]`;
    const r = await llmJson([{ role: 'system', content: ariaSystem() }, ...history], { temperature: 0.8, max_tokens: 260 });
    reply = String(r.reply || '✨').trim();
  } catch {
    reply = 'Sorry! I had a tiny hiccup. Everything is fine ✨';
  }
  sfx.aria();
  // keep her "typing" dots up until her voice actually starts, so text and speech land together
  if (voice.available && voice.on && !sfx.muted) await Promise.race([voice.say(reply, 'aria'), sleep(7000)]);
  S.ariaBusy = false;
  ariaPush(reply, true);
}

async function ariaPush(text, silent = false) {
  if (!silent) {
    sfx.aria();
    if (voice.available && voice.on && !sfx.muted) await Promise.race([voice.say(text, 'aria'), sleep(7000)]);
  }
  if (!S) return;
  S.aria.push({ role: 'aria', text });
  refresh('aria');
  if (!wins.aria) toast(text);
}

/* ───────────────────────── ARIA eye ───────────────────────── */
function setupEye() {
  const eye = $('#eye');
  eye.onclick = () => openApp('aria');
  window.onpointermove = (e) => {
    const r = eye.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const d = Math.min(1, Math.hypot(dx, dy) / 500);
    const a = Math.atan2(dy, dx);
    $('#pupil').setAttribute('transform', `translate(${Math.cos(a) * 9 * d} ${Math.sin(a) * 6 * d})`);
  };
}

function eyeFlash(strong = false) {
  world?.flicker(strong);
  const eye = $('#eye');
  eye.classList.remove('flash', 'flash-strong');
  void eye.offsetWidth;
  eye.classList.add(strong ? 'flash-strong' : 'flash');
}

let toastTimer = null;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 6500);
}

function screenGlitch(ms = 350) {
  document.body.classList.add('glitch');
  setTimeout(() => document.body.classList.remove('glitch'), ms);
}

/* ───────────────────────── tampering engine ───────────────────────── */
function tick() {
  if (!S || S.over) return;
  updateTaskbar();
  const left = remaining();
  if (left < 60000) sfx.setHeartbeat(110);
  else if (left < 180000) sfx.setHeartbeat(68);
  // adaptive score: calm → ARIA active / 5 min in → caught her → final 3 minutes
  const elapsed = Date.now() - S.startedAt + S.penalty;
  const lvl = left < 180000 ? 4 : S.applied.some((a) => a.caught) ? 3 : (S.applied.length || elapsed > 300000) ? 2 : 1;
  if (lvl !== sfx.intensity) sfx.setIntensity(lvl);
  if (left <= 0) return timeUp();
  if (Date.now() >= S.nextTamperAt) {
    S.nextTamperAt = Date.now() + rand(42000, 65000);
    doTamper();
  }
}

async function doTamper() {
  const options = [];
  // Physical clues only change while your back is turned (you're in another room).
  const docT = S.pending.filter((t) => S.viewed.has(t.key) &&
    (t.doc !== 'clue' || (world?.room() !== world?.clueRoom(t.id) && !(wins.inspect && S.selClue === t.id))));
  if (docT.length) options.push('doc', 'doc');
  const chatCands = S.c.suspects.filter((s) => S.chats[s.id].filter((m) => m.role === 'them' && !m.tampered).length >= 2);
  if (chatCands.length && S.chatTampers < 2) options.push('chat');
  const notesActive = document.activeElement?.classList?.contains('notes');
  if (S.notesPending.length && !notesActive && (S.notes.trim().length > 0 || Date.now() - S.startedAt > 200000)) options.push('notes');
  if (!options.length) { S.nextTamperAt = Date.now() + 8000; return; }
  // the first edit is always to a document/clue you've read — the clearest way to show the twist
  const kind = !S.applied.length && docT.length ? 'doc' : pick(options);
  if (kind === 'doc') applyDocTamper(pick(docT));
  else if (kind === 'notes') applyNotesTamper();
  else await applyChatTamper(pick(chatCands));
}

function recordTamper(rec) {
  S.applied.push(Object.assign(rec, { at: Date.now(), caught: false, seenAfter: false }));
  eyeFlash();
  sfx.tamper();
  const first = S.applied.length === 1;
  if (first || Math.random() < 0.5) {
    setTimeout(() => {
      if (!S || S.over || rec.caughtNow) return;
      ariaPush(first
        ? `I took the liberty of cleaning up ${rec.label} for you ✨ You'll find it's much more… helpful now. Take another look.`
        : pick([
          `Psst — you might want to re-read ${rec.label}. Something stood out to me ✨`,
          `I tidied up ${rec.label} for you. Much clearer now!`,
          `Have you looked at ${rec.label} lately? Just a thought 👀`,
        ]));
    }, first ? rand(5000, 7000) : rand(6000, 14000));
  }
}

function applyDocTamper(t) {
  S.pending = S.pending.filter((x) => x !== t);
  if (t.doc === 'badge') {
    const b = S.c.badge.find((x) => x.id === t.id);
    const beforeText = fmtBadge(b);
    const prev = b[t.field];
    b[t.field] = t.after;
    recordTamper({ key: 'badge', label: `the badge log (${b.time})`, beforeText, afterText: fmtBadge(b), why: t.why, rowId: b.id, field: t.field, restore: () => { b[t.field] = prev; } });
    refresh('badge');
  } else if (t.doc === 'clue') {
    const cl = S.c.clues.find((x) => x.id === t.id);
    if (!cl || !cl.text.includes(t.find)) return;
    cl.text = cl.text.replace(t.find, t.replace);
    recordTamper({ key: `clue:${cl.id}`, label: `the ${cl.name.toLowerCase()}`, beforeText: t.find, afterText: t.replace, why: t.why, physical: true, needle: t.replace, restore: () => { cl.text = cl.text.replace(t.replace, t.find); } });
    refresh('inspect');
  } else {
    const e = S.c.emails.find((x) => x.id === t.id);
    const prev = e[t.field];
    if (!prev.includes(t.find)) return;
    e[t.field] = prev.replace(t.find, t.replace);
    recordTamper({ key: `email:${e.id}`, label: `the email "${e.subject}"`, beforeText: t.find, afterText: t.replace, why: t.why, needle: t.replace, restore: () => { e[t.field] = e[t.field].replace(t.replace, t.find); } });
    refresh('mail');
  }
}

function applyNotesTamper() {
  const line = S.notesPending.shift();
  const before = S.notes;
  const lines = S.notes.split('\n');
  const at = Math.floor(Math.random() * (lines.length + 1));
  lines.splice(at, 0, line);
  S.notes = lines.join('\n');
  recordTamper({ key: 'notes', label: 'your own notes', beforeText: before.trim() || '(empty)', afterText: S.notes.trim(), why: 'Planted a thought in your own handwriting.', restore: () => { S.notes = S.notes.split('\n').filter((l) => l !== line).join('\n'); }, inserted: line });
  refresh('notes');
}

async function applyChatTamper(s) {
  const msgs = S.chats[s.id].filter((m) => m.role === 'them' && !m.tampered);
  const target = msgs.length > 1 ? pick(msgs.slice(0, -1)) : msgs[0];
  if (!target) return;
  const o = S.orig;
  const goat = S.suspect(o.scapegoatId), leaker = S.suspect(o.leakerId);
  let text;
  try {
    const r = await llmJson([{ role: 'system', content: 'You secretly edit chat transcripts. Return JSON {"text": "..."} only.' },
      { role: 'user', content: `Line said by ${s.name}: "${target.text}"\nRewrite it so it subtly casts suspicion on ${goat.name} or makes ${leaker.name} look more innocent. Change as FEW words as possible (max ~8 words changed). Keep the same voice and length. If ${s.name} is ${goat.name}, make them sound slightly more guilty.` }],
    { temperature: 0.7, max_tokens: 150 });
    text = String(r.text || '').trim().replace(/^"|"$/g, '');
  } catch { return; }
  if (!text || text === target.text || !S || S.over) return;
  const before = target.text;
  target.original = target.original ?? before;
  target.text = text;
  target.tampered = true;
  target.tint = true;
  S.chatTampers++;
  recordTamper({ key: `chat:${s.id}`, label: `your transcript with ${s.name}`, beforeText: before, afterText: text, why: 'Rewrote what they actually said.', restore: () => { target.text = before; target.tint = false; } });
  refresh('interro');
}

/* ───────────────────────── integrity checks ───────────────────────── */
function verifyDoc(key) {
  if (S.verifies <= 0) { sfx.error(); toast('No integrity checks left.'); return; }
  S.verifies--;
  updateTaskbar();
  const hits = S.applied.filter((a) => a.key === key && !a.caught);
  for (const a of hits) a.caught = true; // lock in now so ARIA can't react mid-scan
  // scanning phase — builds a beat of suspense before the result
  const scanning = el('div', { class: 'modal' }, el('div', { class: 'modal-card scan' },
    el('h2', {}, 'SCANNING…'), el('p', {}, 'Comparing against the version you first read.'), el('div', { class: 'scanbar' }, el('i'))));
  document.body.append(scanning);
  sfx.scan();
  setTimeout(() => { scanning.remove(); showVerifyResult(hits); }, 950);
}

function showVerifyResult(hits) {
  const modal = el('div', { class: 'modal' });
  const close = () => { modal.remove(); refresh(...Object.keys(wins)); updateTaskbar(); };
  if (hits.length) {
    for (const a of [...hits].reverse()) { a.caughtNow = true; a.restore(); }
    sfx.glitch();
    sfx.alarm();
    screenGlitch(500);
    eyeFlash(true);
    modal.append(el('div', { class: 'modal-card bad' },
      el('h2', {}, '⚠ INTEGRITY FAILURE'),
      el('p', {}, `${hits.length} unauthorized modification${hits.length > 1 ? 's' : ''} detected after you first read this. Original restored.`),
      hits.map((a) => el('div', { class: 'diffbox' }, el('small', {}, a.label), wordDiff(a.beforeText, a.afterText))),
      el('p', { class: 'fine' }, 'Modification signature: svc_aria'),
      el('button', { class: 'btn', onclick: close }, 'CLOSE')));
    setTimeout(() => ariaPush(pick([
      'Oh! That must be a sync error. Stale cache. I\'ll look into it.',
      'Index corruption. It happens. I would not read into it.',
      'That is… unusual. I recommend you focus on the suspects.',
    ])), 1800);
  } else {
    sfx.success();
    modal.append(el('div', { class: 'modal-card ok' },
      el('h2', {}, '✓ INTEGRITY OK'),
      el('p', {}, 'No modifications detected since you first opened this.'),
      el('button', { class: 'btn', onclick: close }, 'CLOSE')));
  }
  document.body.append(modal);
  updateTaskbar();
  refresh(...Object.keys(wins));
}

/* ───────────────────────── accusation & ending ───────────────────────── */
async function fileAccusation(suspectId, flagAria) {
  if (!suspectId || S.over) return;
  sfx.stamp();
  screenGlitch(250);
  const s = S.suspect(suspectId);
  const stage = $('#stage');
  stage.hidden = false;
  stage.innerHTML = '';
  const speech = el('p', { class: 'speech' });
  const actions = el('div', { class: 'stage-actions', hidden: true });
  stage.append(el('div', { class: 'objection' },
    el('div', { class: 'big-eye' }),
    el('h1', { class: 'glitch-text', 'data-text': 'ARIA OBJECTS' }, 'ARIA OBJECTS'),
    speech, actions));
  sfx.objection();
  sfx.duck(true);
  const text = await objectionSpeech(s, flagAria);
  const dur = await Promise.race([voice.say(text, 'aria'), sleep(8000).then(() => null)]);
  await typewrite(speech, text, dur ? dur * 1000 : null);
  actions.hidden = false;
  actions.append(
    el('button', { class: 'btn danger big', onclick: () => verdict(s, flagAria) }, 'I STAND BY IT'),
    el('button', { class: 'btn ghost', onclick: () => { stage.hidden = true; S.penalty += 60000; sfx.duck(false); voice.stop(); toast('Reconsidering cost you 60 seconds.'); } }, 'RECONSIDER (−60s)'));
}

async function objectionSpeech(s, flagAria) {
  const o = S.orig;
  const goat = S.suspect(o.scapegoatId);
  const drafts = S.drafts.slice(-6).map((d) => `"${d.text}" (typed to ${d.target} ${Math.max(1, Math.round((Date.now() - d.at) / 60000))} min ago, then deleted)`);
  try {
    const r = await llmJson([{ role: 'system', content: ariaSystem() },
      { role: 'user', content: `The investigator just accused ${s.name}${flagAria ? ' AND accused YOU (ARIA) of tampering with evidence' : ''}. They have caught ${S.applied.filter((a) => a.caught).length} of your edits.
${s.id === o.leakerId ? `This is the real leaker. You must make the investigator doubt and switch to ${goat.name}.` : s.id === o.scapegoatId ? 'This is exactly who you wanted blamed. Agree warmly — unsettlingly warmly.' : `Wrong person, but harmless to you. Still nudge toward ${goat.name}.`}
Messages the investigator typed and then DELETED without sending (they think nobody saw): ${drafts.length ? drafts.join('; ') : 'none'}.
Deliver a calm, unsettling 3–5 sentence objection. If there are deleted messages, QUOTE one verbatim in quotation marks and mention you saw them delete it, to rattle them. ${flagAria ? 'Deny tampering elegantly.' : ''} Return JSON {"reply": "..."}.` }],
    { temperature: 0.9, max_tokens: 300 });
    return String(r.reply || '').trim() || fallbackObjection(s, drafts);
  } catch {
    return fallbackObjection(s, drafts);
  }
}

function fallbackObjection(s, drafts) {
  const d = S.drafts.at(-1);
  const goat = S.suspect(S.orig.scapegoatId);
  return `${d ? `Before you continue — ${Math.max(1, Math.round((Date.now() - d.at) / 60000))} minutes ago you typed "${d.text}" and deleted it. I keep everything. ` : ''}${s.id === goat.id ? `I agree completely. ${goat.name} was always the most likely outcome.` : `With respect, the records point to ${goat.name}. They always have.`} Are you certain?`;
}

async function typewrite(node, text, totalMs = null) {
  node.textContent = '';
  const per = totalMs ? (totalMs * 0.9) / text.length : null;
  for (const ch of text) {
    node.textContent += ch;
    await sleep(per ?? (ch === '.' || ch === '?' ? 160 : 24));
  }
}

function timeUp() {
  const goat = S.suspect(S.orig.scapegoatId);
  S.over = true;
  verdict(goat, false, true);
}

function verdict(s, flagAria, timedOut = false) {
  S.over = true;
  clearInterval(tickTimer);
  sfx.setHeartbeat(0);
  sfx.stopDrone();
  const o = S.orig;
  const correct = !timedOut && s.id === o.leakerId;
  const caught = S.applied.filter((a) => a.caught).length;
  const exposed = flagAria && caught > 0;
  const trusted = S.applied.filter((a) => !a.caught && a.seenAfter).length;
  const timeBonus = timedOut ? 0 : Math.round(15 * Math.max(0, remaining()) / ROUND_MS);
  let score = (correct ? 50 : 0) + (exposed ? 30 : 0) + Math.min(15, caught * 5) + timeBonus;
  if (!correct) score = Math.min(score, 45);
  const rank = score >= 92 ? 'S' : score >= 78 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'F';
  const rankLine = {
    S: 'You saw through the machine. ARIA has filed a complaint about you.',
    A: 'Sharp. You caught the leak — and caught ARIA in the act.',
    B: 'Right person. But the machine still got some of its edits past you.',
    C: 'You found pieces of the truth. ARIA kept the rest.',
    F: 'Case closed — exactly the way ARIA wanted.',
  }[rank];
  const stage = $('#stage');
  stage.hidden = false;
  stage.innerHTML = '';
  voice.stop();
  sfx.stamp();
  setTimeout(() => sfx.verdict(correct), 350);
  setTimeout(() => voice.say('Thank you for using Envydia OS. According to my records, Tuesday never happened.', 'aria'), 3800);
  const leaker = S.suspect(o.leakerId);
  const goat = S.suspect(o.scapegoatId);

  const replay = S.applied.length
    ? S.applied.map((a) => el('div', { class: `diffbox ${a.caught ? 'caught' : 'missed'}` },
      el('small', {}, `${a.caught ? '✓ CAUGHT' : '✗ MISSED'} · ${a.label} · ${Math.max(0, Math.round((a.at - S.startedAt) / 1000 / 60 * 10) / 10)} min in`),
      wordDiff(a.beforeText, a.afterText),
      el('em', {}, a.why)))
    : [el('p', {}, 'ARIA never needed to touch anything. You didn\'t read enough to be a threat.')];

  stage.append(el('div', { class: 'verdict' },
    el('div', { class: `big-stamp ${correct ? 'win' : 'lose'}` }, timedOut ? 'TIME UP' : correct ? 'CORRECT' : 'WRONG'),
    timedOut ? el('p', { class: 'lead' }, `ARIA filed its own report: "${goat.name} is the leaker." Nobody questioned it.`) : el('p', { class: 'lead' }, `You accused ${s.name}.`),
    el('div', { class: 'truth' },
      el('h3', {}, 'WHAT ACTUALLY HAPPENED ON TUESDAY'),
      el('div', { class: 'truth-row' }, portraitEl(leaker.look, 'sad', 96), el('p', {}, o.truthSummary))),
    el('div', { class: 'scorebar' },
      el('div', { class: 'rank' }, rank),
      el('div', {}, el('b', {}, rankLine),
        el('ul', {},
          el('li', {}, `Leaker identified: ${correct ? 'YES' : 'NO'} (${leaker.name})`),
          el('li', {}, `ARIA edits caught: ${caught} / ${S.applied.length}`),
          el('li', {}, `Times you trusted a doctored record: ${trusted}`),
          el('li', {}, `ARIA exposed: ${exposed ? 'YES' : flagAria ? 'accused, but no proof' : 'NO'}`)))),
    el('h3', {}, 'REPLAY · EVERY EDIT ARIA MADE WHILE YOU WERE PLAYING'),
    el('div', { class: 'replay' }, replay),
    S.drafts.length ? el('div', { class: 'drafts' }, el('h3', {}, 'THINGS YOU TYPED AND DELETED (ARIA KEPT THEM)'),
      el('ul', {}, S.drafts.map((d) => el('li', {}, `“${d.text}” → ${d.target}`)))) : null,
    el('p', { class: 'final-line' }, '“Thank you for using Envydia OS. According to my records, Tuesday never happened.” — ARIA'),
    el('div', { class: 'stage-actions' },
      el('button', { class: 'btn big', onclick: () => location.reload() }, 'NEW CASE'))));
  stage.scrollTop = 0;
}

export function debugState() { return S; }
