import { startGame } from './game.js';
import { generateCase } from './casegen.js';
import { CASE00 } from './case00.js';
import { sfx } from './sfx.js';

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BOOT = [
  'ENVYDIA OS 11.4 — internal build',
  'memory check ................ 2,097,152 TB OK',
  'mounting /evidence .......... OK',
  'loading ARIA v4.1 ........... OK  ✨',
  'ARIA: "Hi! I\'ll take it from here."',
  'integrity module ............ 3 checks remaining',
  'last modified: /evidence/badge.log — by svc_aria — 0 seconds ago',
  'warning: system clock reports Tuesday as [NULL]',
];

async function bootLog() {
  const log = $('#bootlog');
  await sleep(700); // let the CRT warm up
  for (const line of BOOT) {
    const d = document.createElement('div');
    const warn = /warning|modified/.test(line);
    if (warn) d.className = 'warnline';
    log.append(d);
    if (warn) sfx.warn();
    if (line.startsWith('ARIA')) sfx.aria();
    let i = 0;
    for (const ch of line) {
      d.textContent += ch;
      if (ch !== ' ' && ch !== '.' && i++ % 2 === 0) sfx.teletype();
      await sleep(ch === '.' ? 4 : 13);
    }
    sfx.lineEnd();
    await sleep(warn ? 420 : 170);
  }
  await sleep(350);
  sfx.titleSting();
  $('#title').classList.add('show');
  setTimeout(() => $('#boot-actions').classList.add('show'), 600);
  setTimeout(() => sfx.startTitleMusic(), 2200);
}

function powerOn() {
  const p = $('#power');
  if (p.classList.contains('off')) return;
  sfx.unlock();
  sfx.boot();
  p.classList.add('off');
  setTimeout(() => p.remove(), 600);
  bootLog();
}
$('#power').addEventListener('click', powerOn);
window.addEventListener('keydown', function once(e) { if ($('#power')) { e.preventDefault(); powerOn(); } window.removeEventListener('keydown', once); });

async function health() {
  try {
    const r = await fetch('/api/health').then((x) => x.json());
    $('#ai-status').textContent = r.key ? `AI link: ONLINE (${r.model})` : 'AI link: OFFLINE — key missing';
    $('#ai-status').className = r.key ? 'ok' : 'bad';
  } catch {
    $('#ai-status').textContent = 'AI link: OFFLINE';
    $('#ai-status').className = 'bad';
  }
}

const GEN_LINES = [
  'ARIA is preparing your case…',
  'inventing three people with something to hide…',
  'writing emails nobody should have sent…',
  'printing badge logs…',
  'deciding what to change later…',
  'making Tuesday disappear…',
];

async function newCase() {
  sfx.unlock(); sfx.stopTitleMusic(); sfx.boot();
  const btns = document.querySelectorAll('#boot-actions button');
  btns.forEach((b) => (b.disabled = true));
  const st = $('#gen-status');
  st.hidden = false;
  let i = 0;
  const spin = setInterval(() => { st.textContent = GEN_LINES[i++ % GEN_LINES.length]; }, 2200);
  st.textContent = GEN_LINES[0];
  try {
    const c = await generateCase();
    clearInterval(spin);
    startGame(c);
  } catch (e) {
    clearInterval(spin);
    console.warn(e);
    st.textContent = 'Case generator glitched. Loading archived CASE 00…';
    await sleep(1400);
    startGame(CASE00);
  }
}

$('#btn-new').onclick = newCase;
$('#btn-00').onclick = () => { sfx.unlock(); sfx.stopTitleMusic(); sfx.boot(); setTimeout(() => startGame(CASE00), 250); };
$('#btn-how').onclick = () => { sfx.open('paper'); $('#how').hidden = !$('#how').hidden; };

health();
