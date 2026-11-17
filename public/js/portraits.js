// Procedural 16x16 pixel portraits with mood expressions.
const BG = '#07120c';

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

export function drawPortrait(canvas, look, mood = 'calm') {
  const S = 16;
  const ctx = canvas.getContext('2d');
  const px = canvas.width / S;
  ctx.imageSmoothingEnabled = false;
  const p = (x, y, c, w = 1, h = 1) => { ctx.fillStyle = c; ctx.fillRect(x * px, y * px, w * px, h * px); };

  p(0, 0, BG, S, S);
  // subtle backdrop gradient lines
  for (let y = 0; y < S; y += 2) p(0, y, 'rgba(57,255,136,0.04)', S, 1);

  const skin = look.skin, skinD = shade(look.skin, -30), hair = look.hair;
  // shoulders / shirt
  p(2, 14, look.shirt, 12, 2);
  p(3, 13, look.shirt, 10, 1);
  // lanyard
  p(6, 13, look.lanyard, 1, 3);
  p(9, 13, look.lanyard, 1, 3);
  p(7, 15, look.lanyard, 2, 1);
  // neck
  p(6, 12, skinD, 4, 1);
  // head
  p(4, 4, skin, 8, 8);
  p(5, 3, skin, 6, 1);
  p(5, 11, skinD, 6, 1);
  p(3, 7, skinD, 1, 2); // ears
  p(12, 7, skinD, 1, 2);

  // hair styles
  if (look.hairStyle === 0) { // messy
    p(4, 2, hair, 8, 2); p(3, 3, hair, 1, 3); p(12, 3, hair, 1, 3);
    p(5, 4, hair, 2, 1); p(9, 4, hair, 3, 1); p(6, 1, hair, 2, 1); p(10, 1, hair, 1, 1);
  } else if (look.hairStyle === 1) { // short neat
    p(4, 2, hair, 8, 2); p(4, 4, hair, 1, 2); p(11, 4, hair, 1, 2); p(5, 4, hair, 6, 1);
  } else { // long / tied
    p(4, 2, hair, 8, 2); p(3, 3, hair, 1, 9); p(12, 3, hair, 1, 9); p(4, 4, hair, 2, 1); p(10, 4, hair, 2, 1);
    p(2, 8, hair, 1, 4); p(13, 8, hair, 1, 4);
  }

  // brows
  const brow = shade(hair, 10);
  if (mood === 'angry') { p(5, 6, brow); p(6, 6, brow); p(9, 6, brow); p(10, 6, brow); p(6, 5, 'transparent'); p(7, 6, brow); p(8, 6, brow); }
  else if (mood === 'nervous' || mood === 'sad') { p(5, 5, brow, 2, 1); p(9, 5, brow, 2, 1); }
  else p(5, 6, brow, 2, 1), p(9, 6, brow, 2, 1);

  // eyes
  const eye = '#0b0b0b';
  if (mood === 'smug') { p(5, 7, eye, 2, 1); p(9, 7, eye, 2, 1); }
  else { p(5, 7, '#f2f2f2', 2, 1); p(9, 7, '#f2f2f2', 2, 1); p(6, 7, eye); p(10, 7, eye); }

  // glasses
  if (look.glasses) {
    const gl = '#9fe8ff';
    p(4, 7, gl); p(7, 7, gl); p(8, 7, gl); p(11, 7, gl);
    p(5, 8, gl, 2, 1); p(9, 8, gl, 2, 1);
  }

  // nose
  p(7, 8, skinD, 2, 1);

  // mouth by mood
  const m = '#5a1f1f';
  if (mood === 'nervous') { p(6, 10, m); p(7, 9, m); p(8, 10, m); p(9, 9, m); }
  else if (mood === 'angry') { p(6, 10, m, 4, 1); p(6, 9, m); p(9, 9, m); }
  else if (mood === 'smug') { p(6, 10, m, 3, 1); p(9, 9, m); }
  else if (mood === 'sad') { p(6, 10, m); p(7, 9, m, 2, 1); p(9, 10, m); }
  else p(6, 10, m, 4, 1);

  // sweat
  if (mood === 'nervous') { p(12, 5, '#cfe8f4'); p(12, 6, '#cfe8f4'); }
  ditherCanvas(canvas, mood);
}

// Same ink/paper ordered dither as the world. Stress = noise + horizontal tearing.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const PAL = [[9, 10, 9], [48, 50, 46], [132, 129, 118], [230, 225, 210]];
function ditherCanvas(cv, mood) {
  const ctx = cv.getContext('2d');
  const w = cv.width, h = cv.height;
  const cell = w >= 90 ? 2 : 1;
  const im = ctx.getImageData(0, 0, w, h);
  const src = new Uint8ClampedArray(im.data);
  const d = im.data;
  const stress = mood === 'nervous' ? 0.9 : mood === 'angry' ? 0.6 : mood === 'sad' ? 0.25 : 0;
  for (let y = 0; y < h; y++) {
    const cy = Math.floor(y / cell);
    for (let x = 0; x < w; x++) {
      const cx = Math.floor(x / cell);
      const si = ((cy * cell) * w + cx * cell) * 4;
      const lum = (src[si] * 77 + src[si + 1] * 151 + src[si + 2] * 28) >> 8;
      let v = Math.pow(lum / 255, 0.7) * 3;
      if (stress) v += (Math.random() - 0.5) * stress;
      v = Math.max(0, Math.min(2.999, v));
      const base = v | 0;
      const idx = Math.min(3, base + (v - base > BAYER[(cy & 3) * 4 + (cx & 3)] ? 1 : 0));
      const i = (y * w + x) * 4;
      d[i] = PAL[idx][0]; d[i + 1] = PAL[idx][1]; d[i + 2] = PAL[idx][2]; d[i + 3] = 255;
    }
  }
  ctx.putImageData(im, 0, 0);
  if (stress >= 0.6) {
    for (let k = 0; k < 3; k++) {
      const y = Math.floor(Math.random() * h * 0.8), bh = 2 + Math.floor(Math.random() * 5);
      const band = ctx.getImageData(0, y, w, bh);
      ctx.putImageData(band, Math.round((Math.random() - 0.5) * 10), y);
    }
  }
}

export function portraitEl(look, mood, size = 96) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.className = 'portrait';
  drawPortrait(c, look, mood);
  return c;
}
