// Top-down world of Envydia HQ at 3 AM, shown as a dithered CCTV feed.
// Visual rule: everything is ink & paper (4-tone ordered dither). The ONLY colour is ARIA pink.
import { sfx } from './sfx.js';

const T = 16, COLS = 30, ROWS = 17, W = COLS * T, H = ROWS * T;
const SPEED = 120; // logical px / s
const PINK = '#ff2e88';

const DOORS = [[5, 7], [6, 7], [15, 7], [16, 7], [24, 7], [25, 7], [6, 10], [7, 10], [21, 10], [22, 10]];
const SCREENS = [[3, 7], [12, 7], [19, 7], [27, 7], [11, 10], [26, 10]];

// 4x4 Bayer matrix thresholds + 4-tone ink/paper palette
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const PAL = [[9, 10, 9], [48, 50, 46], [132, 129, 118], [230, 225, 210]];
const GAMMA = new Float32Array(256).map((_, i) => Math.pow(i / 255, 0.62));

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

export function createWorld(container, c, hooks) {
  /* ── map ── */
  const top = c.suspects.map((s, i) => ({
    id: s.id, name: (s.room || s.role.split(' ').slice(-1)[0]).toUpperCase().slice(0, 18),
    x0: [1, 11, 21][i], x1: [9, 19, 28][i], y0: 1, y1: 6, floor: ['#3a3f44', '#45393f', '#2f3a36'][i], pat: i,
    amb: (/server|lab|data|vault|rack|fab/i.test(s.room || s.role) || i === 2) ? 'server' : 'office',
  }));
  const rooms = [
    ...top,
    { id: 'hall', name: 'HALLWAY', x0: 1, x1: 28, y0: 8, y1: 9, floor: '#34362f', pat: 3, amb: 'hall' },
    { id: 'lobby', name: 'LOBBY', x0: 1, x1: 13, y0: 11, y1: 15, floor: '#3d3a33', pat: 4, amb: 'lobby' },
    { id: 'security', name: 'SECURITY OFFICE', x0: 15, x1: 28, y0: 11, y1: 15, floor: '#323a35', pat: 1, amb: 'security' },
  ];
  let roomObj = rooms.find((r) => r.id === 'security');
  const solid = Array.from({ length: ROWS }, () => Array(COLS).fill(true));
  for (const r of rooms) for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) solid[y][x] = false;
  for (const [x, y] of DOORS) solid[y][x] = false;
  const blocked = new Set();
  const decor = [];
  const block = (x, y) => blocked.add(`${x},${y}`);

  top.forEach((r, i) => {
    const isServer = /server|lab|data|vault|rack|fab/i.test(r.name) || i === 2;
    if (isServer) {
      for (let y = r.y0; y <= r.y0 + 2; y++) { decor.push({ k: 'rack', x: r.x0, y }); block(r.x0, y); decor.push({ k: 'rack', x: r.x1, y }); block(r.x1, y); }
      decor.push({ k: 'terminal', x: r.x0 + 3, y: r.y0 }); block(r.x0 + 3, r.y0);
    } else {
      for (const dx of [1, 2, 5, 6]) { decor.push({ k: 'desk', x: r.x0 + dx, y: r.y0 + 1, mon: dx === 1 || dx === 5 }); block(r.x0 + dx, r.y0 + 1); }
      decor.push({ k: 'plant', x: r.x1, y: r.y0 }); block(r.x1, r.y0);
    }
  });
  decor.push({ k: 'kiosk', x: 3, y: 11 }); block(3, 11);
  for (const x of [9, 10, 11]) { decor.push({ k: 'desk', x, y: 13, mon: x === 10 }); block(x, 13); }
  decor.push({ k: 'plant', x: 13, y: 11 }); block(13, 11);
  decor.push({ k: 'plant', x: 1, y: 11 }); block(1, 11);
  decor.push({ k: 'glass', x: 4, y: 16 });
  decor.push({ k: 'desk', x: 17, y: 13, mon: true }); block(17, 13);
  decor.push({ k: 'desk', x: 18, y: 13, mon: false }); block(18, 13);
  decor.push({ k: 'board', x: 26, y: 11 }); block(26, 11); block(25, 11);
  decor.push({ k: 'plant', x: 28, y: 15 }); block(28, 15);
  decor.push({ k: 'coffee', x: 28, y: 11 }); block(28, 11);

  /* ── interactables ── */
  // No character may accidentally wear "ARIA pink": lift the green channel of any pinkish colour.
  const unpink = (hex) => {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '#666666';
    const n = parseInt(hex.slice(1), 16), r = n >> 16, gg = (n >> 8) & 255, b = n & 255;
    return r > gg * 2 && b > gg ? `#${[r, Math.max(gg, Math.round(r * 0.5)), b].map((v) => v.toString(16).padStart(2, '0')).join('')}` : hex;
  };
  for (const s of c.suspects) for (const k of ['skin', 'hair', 'shirt', 'lanyard']) s.look[k] = unpink(s.look[k]);
  const npcs = c.suspects.map((s, i) => ({ id: s.id, s, x: (top[i].x0 + 4) * T + 8, y: (top[i].y0 + 3) * T + 14, tx: top[i].x0 + 4, ty: top[i].y0 + 3, facing: 'down' }));
  npcs.forEach((n) => block(n.tx, n.ty));
  const roomSlots = {};
  top.forEach((r) => { roomSlots[r.id] = [[r.x0 + 1, r.y0 + 4], [r.x1 - 1, r.y0 + 4], [r.x0 + 2, r.y0 + 5]]; });
  roomSlots.lobby = [[2, 14], [12, 15], [5, 15]];
  roomSlots.security = [[16, 15], [27, 14], [20, 15]];
  roomSlots.hall = [[10, 9], [20, 8]];
  const clues = (c.clues || []).map((cl) => {
    const slots = roomSlots[cl.room] || roomSlots.hall;
    const [tx, ty] = slots.shift() || [14, 9];
    return { ...cl, tx, ty };
  });

  const targets = [
    ...npcs.map((n) => ({ kind: 'suspect', id: n.id, tx: n.tx, ty: n.ty, label: `Talk to ${n.s.name.split(' ')[0]}` })),
    { kind: 'app', id: 'badge', tx: 3, ty: 11, label: 'Badge kiosk' },
    { kind: 'app', id: 'mail', tx: 17, ty: 13, label: 'Your terminal · mail' },
    { kind: 'app', id: 'accuse', tx: 25.5, ty: 11, label: 'Case board · ACCUSE' },
    ...clues.map((cl) => ({ kind: 'clue', id: cl.id, tx: cl.tx, ty: cl.ty, label: `Inspect · ${cl.name}` })),
  ];

  /* ── player ── */
  const P = { x: 20 * T + 8, y: 13 * T + 14, facing: 'down', moving: false, path: [], goal: null };
  let room = 'security';
  const keys = new Set();
  let t = 0, last = performance.now(), raf = 0, stepAcc = 0;
  let flick = 0, flickStrong = false;
  let near = null;

  /* ── DOM: feed = canvas + camera chrome ── */
  const feed = document.createElement('div');
  feed.className = 'feed';
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.className = 'world';
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  const mask = document.createElement('canvas');
  mask.width = W; mask.height = H;
  const m = mask.getContext('2d');
  const chrome = document.createElement('div');
  chrome.className = 'cam';
  chrome.innerHTML = `
    <span class="cam-id"></span><span class="cam-rec"><i></i>REC</span>
    <span class="cam-time"></span><span class="cam-lens">ENVYDIA SECURE·VIEW  F1.8  IR</span>
    <b class="br tl"></b><b class="br tr"></b><b class="br bl"></b><b class="br br2"></b>
    <span class="cam-cross"></span>`;
  const staticEl = document.createElement('div');
  staticEl.className = 'static';
  const prompt = document.createElement('button');
  prompt.className = 'world-prompt';
  prompt.hidden = true;
  const banner = document.createElement('div');
  banner.className = 'room-banner';
  feed.append(canvas, chrome, staticEl, prompt, banner);
  container.append(feed);
  let cssScale = 1;

  function fit() {
    const availW = container.clientWidth - 24, availH = container.clientHeight - 24;
    cssScale = Math.max(1, Math.floor(Math.min(availW / W, availH / H) * 4) / 4);
    if (Math.min(availW / W, availH / H) < 1) cssScale = Math.min(availW / W, availH / H);
    feed.style.width = `${W * cssScale}px`;
    feed.style.height = `${H * cssScale}px`;
  }
  const ro = new ResizeObserver(fit);
  ro.observe(container);
  fit();

  const camOf = (id) => {
    const i = rooms.findIndex((r) => r.id === id);
    return `CAM ${String(i + 1).padStart(2, '0')} · ${rooms[i]?.name || ''}`;
  };
  chrome.querySelector('.cam-id').textContent = camOf(room);

  /* ── helpers ── */
  const passable = (tx, ty) => tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS && !solid[ty][tx] && !blocked.has(`${tx},${ty}`);
  const tileOf = (x, y) => [Math.floor(x / T), Math.floor(y / T)];
  const roomAt = (tx, ty) => rooms.find((r) => tx >= r.x0 && tx <= r.x1 && ty >= r.y0 && ty <= r.y1);
  const center = (tx, ty) => [tx * T + 8, ty * T + 10];

  function free(x, y) {
    for (const [ox, oy] of [[-4, -4], [4, -4], [-4, 0], [4, 0]]) {
      const [tx, ty] = tileOf(x + ox, y + oy);
      if (!passable(tx, ty)) return false;
    }
    return true;
  }

  function bfs(from, to) {
    const key = (x, y) => `${x},${y}`;
    let goals = [to];
    if (!passable(...to)) {
      goals = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [Math.round(to[0]) + dx, Math.round(to[1]) + dy]).filter((p) => passable(...p));
      if (!goals.length) return null;
    }
    const goalSet = new Set(goals.map((p) => key(...p)));
    const prev = new Map([[key(...from), null]]);
    const q = [from];
    while (q.length) {
      const cur = q.shift();
      if (goalSet.has(key(...cur))) {
        const path = [];
        let k = key(...cur);
        while (k) { path.unshift(k.split(',').map(Number)); k = prev.get(k); }
        return path.slice(1);
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cur[0] + dx, ny = cur[1] + dy;
        if (!passable(nx, ny) || prev.has(key(nx, ny))) continue;
        prev.set(key(nx, ny), key(...cur));
        q.push([nx, ny]);
      }
    }
    return null;
  }

  function distToTarget(tg) {
    const [cx, cy] = [tg.tx * T + 8, tg.ty * T + 8];
    return Math.hypot(P.x - cx, P.y - 4 - cy);
  }

  function interact(tg) {
    if (!tg) return;
    sfx.blip();
    if (tg.kind === 'suspect') {
      const n = npcs.find((x) => x.id === tg.id);
      n.facing = Math.abs(P.x - n.x) > Math.abs(P.y - n.y) ? (P.x < n.x ? 'left' : 'right') : (P.y < n.y ? 'up' : 'down');
      hooks.talk(tg.id);
    } else if (tg.kind === 'clue') hooks.inspect(tg.id);
    else hooks.open(tg.id);
  }

  /* ── input ── */
  const typing = () => {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  };
  const onKey = (e) => {
    if (typing() || hooks.frozen()) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys.add(k); P.path = []; P.goal = null; e.preventDefault(); }
    if ((k === 'e' || k === 'enter' || k === ' ') && near) { e.preventDefault(); interact(near); }
  };
  const onKeyUp = (e) => keys.delete(e.key.toLowerCase());
  const onBlur = () => keys.clear();
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  canvas.addEventListener('pointerdown', (e) => {
    if (hooks.frozen() || document.querySelector('.win.opening, .win.closing')) return;
    document.activeElement?.blur?.();
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / cssScale, y = (e.clientY - r.top) / cssScale;
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    const tg = targets.find((q) => Math.abs(q.tx - tx) < 1 && Math.abs(q.ty - ty) < 1) ||
      targets.find((q) => q.kind === 'suspect' && q.tx === tx && ty >= q.ty - 1 && ty <= q.ty);
    if (tg && distToTarget(tg) < 24) { interact(tg); return; }
    const path = bfs(tileOf(P.x, P.y - 2), tg ? [Math.floor(tg.tx), tg.ty] : [tx, ty]);
    if (path) { P.path = path; P.goal = tg || null; }
  });
  prompt.addEventListener('click', () => near && interact(near));

  /* ── update ── */
  let cutTimer = 0;
  function cameraCut(r) {
    chrome.querySelector('.cam-id').textContent = camOf(r.id);
    feed.classList.remove('cut');
    void feed.offsetWidth;
    feed.classList.add('cut');
    clearTimeout(cutTimer);
    cutTimer = setTimeout(() => feed.classList.remove('cut'), 260);
    sfx.camCut();
  }

  function update(dt) {
    let vx = 0, vy = 0;
    if (!typing() && !hooks.frozen()) {
      if (keys.has('a') || keys.has('arrowleft')) vx -= 1;
      if (keys.has('d') || keys.has('arrowright')) vx += 1;
      if (keys.has('w') || keys.has('arrowup')) vy -= 1;
      if (keys.has('s') || keys.has('arrowdown')) vy += 1;
    } else keys.clear();
    if (!vx && !vy && P.path.length) {
      const [cx, cy] = center(...P.path[0]);
      const dx = cx - P.x, dy = cy + 4 - P.y;
      const d = Math.hypot(dx, dy);
      if (d < 2) { P.path.shift(); if (!P.path.length && P.goal) { const gl = P.goal; P.goal = null; if (distToTarget(gl) < 26) interact(gl); } }
      else { vx = dx / d; vy = dy / d; }
    }
    P.moving = !!(vx || vy);
    if (P.moving) {
      const len = Math.hypot(vx, vy);
      vx /= len; vy /= len;
      const nx = P.x + vx * SPEED * dt, ny = P.y + vy * SPEED * dt;
      if (free(nx, P.y)) P.x = nx;
      if (free(P.x, ny)) P.y = ny;
      P.facing = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 'left' : 'right') : (vy < 0 ? 'up' : 'down');
      stepAcc += dt;
      if (stepAcc > 0.24) { stepAcc = 0; sfx.step(roomObj.pat); }
    }
    const [tx, ty] = tileOf(P.x, P.y - 2);
    const r = roomAt(tx, ty);
    if (r && r.id !== room) {
      room = r.id;
      roomObj = r;
      cameraCut(r);
      if (r.id !== 'hall') showBanner(r.name);
      sfx.setRoom(r.amb);
      hooks.roomChanged?.(room);
    }
    let best = null, bd = 26;
    for (const tg of targets) { const d = distToTarget(tg); if (d < bd) { bd = d; best = tg; } }
    near = best;
    for (const n of npcs) {
      if (Math.hypot(P.x - n.x, P.y - n.y) < 56) n.facing = Math.abs(P.x - n.x) > Math.abs(P.y - n.y) ? (P.x < n.x ? 'left' : 'right') : (P.y < n.y ? 'up' : 'down');
    }
    hooks.tickNear?.(npcs.map((n) => [n.id, Math.hypot(P.x - n.x, P.y - n.y)]));
    if (flick > 0) flick -= dt;
  }

  let bannerTimer = 0;
  function showBanner(name) {
    banner.textContent = name;
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => banner.classList.remove('show'), 1600);
  }

  /* ── draw ── */
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const INK = '#050505';

  function drawPerson(x, y, look, facing, moving, opts = {}) {
    x = Math.round(x); y = Math.round(y);
    const bob = moving ? 0 : Math.round(Math.sin(t * 2 + x) * 0.5);
    const step = moving ? Math.floor(t * 8) % 2 : -1;
    const hy = y - 18 + bob;
    R(x - 6, y - 1, 12, 2, 'rgba(0,0,0,.6)');
    // ink outline silhouette
    R(x - 4, hy - (opts.player ? 5 : 2), 8, opts.player ? 11 : 8, INK);
    R(x - 6, y - 13 + bob, 12, opts.player ? 11 : 9, INK);
    R(x - 4, y - 6, 8, 7, INK);
    if (opts.player) R(x - 5, hy - 2, 10, 3, INK);
    const pants = '#2b2b2e';
    R(x - 3, y - 5, 2, step === 0 ? 4 : 5, pants);
    R(x + 1, y - 5, 2, step === 1 ? 4 : 5, pants);
    const shirt = opts.player ? '#b8a67e' : look.shirt;
    R(x - 4, y - 12 + bob, 8, opts.player ? 9 : 7, shirt);
    R(x - 5, y - 11 + bob, 1, 5, shade(shirt, -35));
    R(x + 4, y - 11 + bob, 1, 5, shade(shirt, -35));
    if (opts.player) { R(x - 4, y - 7 + bob, 8, 1, '#3a3020'); R(x, y - 12 + bob, 1, 6, '#6e5a38'); R(x - 2, y - 12 + bob, 1, 3, '#eee'); }
    else if (facing !== 'up') { R(x - 2, y - 12 + bob, 1, 3, look.lanyard); R(x + 1, y - 12 + bob, 1, 3, look.lanyard); R(x - 1, y - 9 + bob, 2, 2, '#f4f0e4'); }
    R(x - 3, hy, 6, 6, look.skin);
    const hair = look.hair;
    if (facing === 'up') R(x - 3, hy - 1, 6, 6, hair);
    else {
      R(x - 3, hy - 1, 6, 2, hair);
      if (look.hairStyle === 2) { R(x - 4, hy, 1, 6, hair); R(x + 3, hy, 1, 6, hair); }
      if (look.hairStyle === 0) { R(x - 2, hy - 2, 1, 1, hair); R(x + 1, hy - 2, 1, 1, hair); }
      if (look.glasses && facing === 'down') R(x - 3, hy + 3, 6, 1, '#d8e8f0');
      if (facing === 'down') { R(x - 2, hy + 3, 1, 1, INK); R(x + 1, hy + 3, 1, 1, INK); }
      else if (facing === 'left') { R(x - 3, hy + 3, 1, 1, INK); R(x - 1, hy + 3, 1, 1, INK); }
      else { R(x, hy + 3, 1, 1, INK); R(x + 2, hy + 3, 1, 1, INK); }
    }
    if (opts.player) { R(x - 4, hy - 1, 8, 1, '#1b1712'); R(x - 3, hy - 4, 6, 3, '#2a231a'); R(x - 3, hy - 2, 6, 1, '#5a5048'); }
  }

  function drawDecor(d) {
    const x = d.x * T, y = d.y * T;
    const hot = flick > 0;
    switch (d.k) {
      case 'desk':
        R(x - 1, y + 5, 18, 10, INK);
        R(x, y + 6, 16, 8, '#6a5a48'); R(x, y + 6, 16, 2, '#8e7c64'); R(x + 1, y + 14, 2, 2, INK); R(x + 13, y + 14, 2, 2, INK);
        if (d.mon) { R(x + 3, y - 3, 12, 10, INK); R(x + 5, y - 1, 8, 6, hot ? PINK : '#8c9a90'); R(x + 6, y, 3, 1, '#f0f0e0'); R(x + 6, y + 2, 5, 1, '#c8d0c8'); R(x + 8, y + 6, 2, 1, '#222'); }
        break;
      case 'rack':
        R(x, y - 5, 16, 22, INK);
        R(x + 1, y - 4, 14, 20, '#26292c'); R(x + 1, y - 4, 14, 1, '#4a4f54');
        for (let i = 0; i < 5; i++) { R(x + 3, y - 2 + i * 3, 10, 2, '#3a3f44'); R(x + 11, y - 2 + i * 3, 1, 1, Math.sin(t * 6 + i * 2 + d.y * 3 + d.x) > 0.3 ? '#ffffff' : '#555'); }
        break;
      case 'terminal':
        // the spec terminal is ARIA's — always pink
        R(x + 1, y - 3, 14, 16, INK);
        R(x + 2, y - 2, 12, 14, '#202326'); R(x + 3, y - 1, 10, 7, hot ? '#ffffff' : PINK); R(x + 4, y, 6, 1, hot ? PINK : '#ffd0e4'); R(x + 3, y + 8, 10, 2, '#3a3f44');
        break;
      case 'plant':
        R(x + 2, y - 2, 12, 18, 'rgba(0,0,0,0)');
        R(x + 4, y + 9, 8, 7, INK); R(x + 5, y + 10, 6, 5, '#5a4a3a');
        R(x + 2, y + 1, 12, 11, INK); R(x + 3, y + 2, 10, 9, '#5f6b5c'); R(x + 6, y - 1, 4, 5, '#7c8a78'); R(x + 5, y + 4, 2, 2, '#9aa894');
        break;
      case 'kiosk':
        R(x + 2, y - 5, 12, 20, INK);
        R(x + 3, y - 4, 10, 18, '#3a3f44'); R(x + 4, y - 3, 8, 7, hot ? PINK : '#9aa59c'); R(x + 5, y - 2, 6, 1, '#fff'); R(x + 6, y + 6, 4, 3, '#d8d0b8');
        break;
      case 'board':
        R(x - 17, y - 7, 34, 18, INK);
        R(x - 16, y - 6, 32, 16, '#6a5438'); R(x - 15, y - 5, 30, 14, '#a08a66');
        R(x - 12, y - 3, 6, 5, '#f4f0e4'); R(x - 2, y - 4, 5, 6, '#f4f0e4'); R(x + 7, y - 2, 6, 5, '#f4f0e4');
        R(x - 9, y, 9, 1, INK); R(x + 1, y + 1, 8, 1, INK); R(x - 1, y + 4, 3, 3, INK);
        break;
      case 'coffee':
        R(x + 2, y - 3, 12, 16, INK);
        R(x + 3, y - 2, 10, 14, '#3a3a3a'); R(x + 5, y, 6, 3, '#111'); R(x + 6, y + 6, 4, 4, '#f4f0e4');
        break;
      case 'glass':
        R(x, y, 64, 3, '#8c9aa0'); R(x, y, 64, 1, '#e8eef0');
        break;
    }
  }

  function drawScreen(sx, sy) {
    const x = sx * T + 3, y = sy * T + 4;
    const hot = flick > 0;
    R(x - 1, y - 1, 12, 8, INK);
    R(x, y, 10, 6, hot ? PINK : '#2a0a1a');
    R(x + 2, y + 2, 6, 2, hot ? '#fff' : PINK);
    R(x + 4, y + 2, 2, 2, hot ? PINK : '#1a0010');
  }

  function drawFloor(r) {
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const px = x * T, py = y * T;
      R(px, py, T, T, r.floor);
      if (r.pat === 0) { R(px, py, T, 1, shade(r.floor, 14)); R(px, py, 1, T, shade(r.floor, 14)); }           // tile grid
      else if (r.pat === 1) { if ((x + y) % 2) R(px, py, T, T, shade(r.floor, 10)); }                         // checker
      else if (r.pat === 2) { R(px, py + 7, T, 2, shade(r.floor, -12)); R(px + 7, py, 2, T, shade(r.floor, -12)); } // raised floor
      else if (r.pat === 3) { R(px, py + 15, T, 1, shade(r.floor, -10)); }                                    // planks
      else { if ((x * 7 + y * 3) % 5 === 0) R(px + 4, py + 6, 2, 2, shade(r.floor, 14)); }                    // carpet fleck
    }
  }

  function dither() {
    const im = g.getImageData(0, 0, W, H);
    const d = im.data;
    for (let y = 0; y < H; y++) {
      const row = (y & 3) * 4;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const r = d[i], gg = d[i + 1], b = d[i + 2];
        // ARIA pink survives the dither untouched (scaled by its brightness)
        if (r > 30 && r > gg * 3.5 && b > gg * 1.8 && r > b) {
          const k = r > 150 ? 1 : 0.5;
          d[i] = 255 * k; d[i + 1] = 46 * k; d[i + 2] = 136 * k;
          continue;
        }
        const lum = (r * 77 + gg * 151 + b * 28) >> 8;
        const v = GAMMA[lum] * 3;
        const base = v | 0;
        const idx = Math.min(3, base + (v - base > BAYER[row + (x & 3)] ? 1 : 0));
        const p = PAL[idx];
        d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2];
      }
    }
    g.putImageData(im, 0, 0);
  }

  function draw() {
    R(0, 0, W, H, '#0e100f');
    for (const r of rooms) drawFloor(r);
    for (const [x, y] of DOORS) R(x * T, y * T, T, T, '#3e3f3a');
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (!solid[y][x]) continue;
      const below = y + 1 < ROWS && !solid[y + 1][x];
      R(x * T, y * T, T, T, '#151716');
      if (below) { R(x * T, y * T + 5, T, 11, '#4a4e4c'); R(x * T, y * T + 5, T, 1, '#7a7f7c'); R(x * T, y * T + 15, T, 1, INK); }
    }
    for (const [x, y] of SCREENS) drawScreen(x, y);

    for (const cl of clues) {
      const x = cl.tx * T + 8, y = cl.ty * T + 9;
      const seen = hooks.clueSeen(cl.id);
      const pulse = (Math.sin(t * 4 + cl.tx) + 1) / 2;
      const lift = seen ? 0 : pulse * 2;
      R(x - 4, y, 8, 2, 'rgba(0,0,0,.6)');
      g.fillStyle = INK;
      g.beginPath(); g.moveTo(x, y - 9 - lift); g.lineTo(x + 5, y - 4 - lift); g.lineTo(x, y + 1 - lift); g.lineTo(x - 5, y - 4 - lift); g.fill();
      g.fillStyle = seen ? '#8a877c' : '#ffffff';
      g.beginPath(); g.moveTo(x, y - 8 - lift); g.lineTo(x + 4, y - 4 - lift); g.lineTo(x, y - lift); g.lineTo(x - 4, y - 4 - lift); g.fill();
    }

    const items = [
      ...decor.map((d) => ({ y: d.y * T + 14, draw: () => drawDecor(d) })),
      ...npcs.map((n) => ({ y: n.y, draw: () => drawPerson(n.x, n.y, n.s.look, n.facing, false) })),
      { y: P.y, draw: () => drawPerson(P.x, P.y, { skin: '#d9a679', hair: '#2a231a', hairStyle: 1 }, P.facing, P.moving, { player: true }) },
    ].sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    // darkness + light pools
    m.globalCompositeOperation = 'source-over';
    m.clearRect(0, 0, W, H);
    const dark = flick > 0 ? (Math.floor(flick * 20) % 2 ? 0.95 : 0.45) : 0.62;
    m.fillStyle = `rgba(0,0,0,${dark})`;
    m.fillRect(0, 0, W, H);
    m.globalCompositeOperation = 'destination-out';
    const light = (x, y, r, a = 1) => {
      const grd = m.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(0,0,0,${a})`); grd.addColorStop(1, 'rgba(0,0,0,0)');
      m.fillStyle = grd; m.beginPath(); m.arc(x, y, r, 0, Math.PI * 2); m.fill();
    };
    light(P.x, P.y - 8, 92, 0.95);
    for (const n of npcs) light(n.x, n.y - 10, 32, 0.65);
    for (const d of decor) if (d.mon || ['kiosk', 'terminal', 'rack'].includes(d.k)) light(d.x * T + 8, d.y * T + 2, 24, 0.55);
    for (const cl of clues) light(cl.tx * T + 8, cl.ty * T + 5, 14, 0.6);
    g.drawImage(mask, 0, 0);

    // bubbles / markers (pre-dither, they read as paper-white)
    for (const n of npcs) {
      if (hooks.pending(n.id)) {
        const bx = n.x - 8, by = n.y - 32;
        R(bx - 1, by - 1, 18, 10, INK); R(bx, by, 16, 8, '#f4f0e4'); R(bx + 6, by + 8, 3, 2, '#f4f0e4');
        for (let i = 0; i < 3; i++) R(bx + 3 + i * 4, by + 3, 2, 2, Math.floor(t * 4) % 3 === i ? INK : '#9a968a');
      } else if (!hooks.talkedTo(n.id)) {
        const by = Math.round(n.y - 30 + Math.sin(t * 3) * 1.5);
        R(n.x - 2, by - 1, 4, 10, INK); R(n.x - 1, by, 2, 5, '#fff'); R(n.x - 1, by + 6, 2, 2, '#fff');
      }
    }

    dither();
  }

  function placePrompt() {
    if (!near || hooks.frozen()) { prompt.hidden = true; return; }
    prompt.hidden = false;
    prompt.textContent = `E  ${near.label}`;
    prompt.style.left = `${(near.tx * T + 8) * cssScale}px`;
    prompt.style.top = `${(near.ty * T - 16) * cssScale}px`;
  }

  let clockAcc = 0;
  const timeEl = chrome.querySelector('.cam-time');
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; t += dt;
    update(dt);
    draw();
    placePrompt();
    clockAcc += dt;
    if (clockAcc > 0.2) {
      clockAcc = 0;
      const glitching = flick > 0;
      timeEl.textContent = glitching ? 'TUE 02:14:00' : (hooks.clock?.() || '');
      timeEl.classList.toggle('aria', glitching);
    }
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);
  setTimeout(() => showBanner('SECURITY OFFICE'), 400);

  return {
    // used by the scripted demo recording (?demo) to direct the camera; not used in normal play
    player: () => ({ x: P.x, y: P.y, moving: P.moving || P.path.length > 0 }),
    walkTo(tx, ty) { const path = bfs(tileOf(P.x, P.y - 2), [tx, ty]); if (path) { P.path = path; P.goal = null; } return !!path; },
    interactNearest() { if (near) interact(near); return near?.label || null; },
    room: () => room,
    clueRoom: (id) => clues.find((x) => x.id === id)?.room,
    flicker(strong = false) {
      flick = strong ? 0.9 : 0.45; flickStrong = strong;
      feed.classList.remove('aria-hit'); void feed.offsetWidth; feed.classList.add('aria-hit');
    },
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      container.innerHTML = '';
    },
  };
}
