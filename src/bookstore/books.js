// Books: generated cover/spine/page art, the shelf filler, and the book in your hands.
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Design
const PALETTES = [
  { bg: '#1f3b2d', fg: '#e9d9a6', accent: '#b8934a' }, // bottle green / gilt
  { bg: '#1c2a44', fg: '#efe6cf', accent: '#c9a45c' }, // navy
  { bg: '#6b1e1e', fg: '#f3e3c3', accent: '#d8b066' }, // oxblood
  { bg: '#c9952e', fg: '#1d1a16', accent: '#5a2c16' }, // mustard
  { bg: '#e9e1cf', fg: '#2a2620', accent: '#a3402c' }, // cream
  { bg: '#245a5a', fg: '#f1e8d2', accent: '#e0b35a' }, // teal
  { bg: '#4a2a4a', fg: '#efe0cf', accent: '#d39a6a' }, // plum
  { bg: '#3a4048', fg: '#e8e4da', accent: '#e07a4f' }, // slate
  { bg: '#a7562b', fg: '#fbf0dc', accent: '#2a1e17' }, // terracotta
  { bg: '#151515', fg: '#ece6d8', accent: '#c7a25a' }, // black
  { bg: '#7f8f6a', fg: '#1f241a', accent: '#f4ead0' }, // sage
  { bg: '#d4c1a0', fg: '#3b2a1e', accent: '#7b2d26' }, // linen
];
const SERIF = 'Georgia, "Palatino Linotype", "Book Antiqua", "Times New Roman", serif';
const SANS = '"Gill Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';

export function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
const rngFrom = (seed) => () => ((seed = (seed + 0x6d2b79f5) >>> 0), (((seed ^ (seed >>> 15)) * (seed | 1)) >>> 0) / 4294967296);

export function designFor(book) {
  const h = hash(book.id || book.title);
  return { palette: PALETTES[h % PALETTES.length], style: (h >>> 8) % 4, seed: h };
}

// Fit text into a width by shrinking the font.
function fitFont(g, text, maxW, size, weight = '', family = SERIF, min = 10) {
  let s = size;
  do { g.font = `${weight} ${s}px ${family}`; } while (g.measureText(text).width > maxW && --s > min);
  return s;
}

function wrap(g, text, maxW) {
  const words = text.split(/\s+/), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function clothGrain(g, w, h, alpha = 0.06, seed = 1) {
  const r = rngFrom(seed);
  g.save(); g.globalAlpha = alpha;
  for (let i = 0; i < (w * h) / 60; i++) { g.fillStyle = r() < 0.5 ? '#000' : '#fff'; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1); }
  g.restore();
}

export function drawSpine(g, book, w, h, { filler = false } = {}) {
  const { palette: p, seed } = designFor(book);
  g.fillStyle = p.bg; g.fillRect(0, 0, w, h);
  clothGrain(g, w, h, 0.07, seed);
  // subtle rounded-spine shading
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0.35)'); grad.addColorStop(0.25, 'rgba(255,255,255,0.06)'); grad.addColorStop(0.6, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.fillStyle = p.accent;
  const band = (y) => { g.fillRect(w * 0.08, y, w * 0.84, h * 0.006); g.fillRect(w * 0.08, y + h * 0.012, w * 0.84, h * 0.003); };
  band(h * 0.05); band(h * 0.93);
  if (filler) { band(h * 0.3); band(h * 0.7); return; }
  // Title and author run top-to-bottom (rotate 90° clockwise).
  g.save(); g.translate(w / 2, 0); g.rotate(Math.PI / 2);
  const len = h * 0.78, thick = w * 0.62;
  g.fillStyle = p.fg; g.textBaseline = 'middle';
  const author = book.author.split(' ').at(-1).toUpperCase();
  const as = fitFont(g, author, len * 0.28, thick * 0.55, '600', SANS);
  const aw = g.measureText(author).width;
  g.fillText(author, h * 0.9 - aw, 0);
  fitFont(g, book.title, len - aw - h * 0.08, thick * 0.8, '600', SERIF);
  g.fillText(book.title, h * 0.1, 0);
  g.restore();
  // imprint mark
  g.fillStyle = p.accent; g.beginPath(); g.arc(w / 2, h * 0.965, Math.min(w, h) * 0.12, 0, Math.PI * 2); g.fill();
  void as;
}

export function drawCover(g, book, w, h) {
  const { palette: p, style, seed } = designFor(book);
  const r = rngFrom(seed);
  g.fillStyle = p.bg; g.fillRect(0, 0, w, h);
  clothGrain(g, w, h, 0.05, seed);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const title = book.title, author = book.author;
  if (style === 0) { // classic cloth: gilt frame, centred title
    g.strokeStyle = p.accent; g.lineWidth = 6; g.strokeRect(w * 0.07, h * 0.05, w * 0.86, h * 0.9);
    g.lineWidth = 2; g.strokeRect(w * 0.1, h * 0.07, w * 0.8, h * 0.86);
    g.fillStyle = p.fg;
    fitFont(g, title.toUpperCase(), w * 0.72, w * 0.11, '600');
    const lines = wrap(g, title.toUpperCase(), w * 0.72);
    lines.forEach((l, i) => g.fillText(l, w / 2, h * 0.3 + i * w * 0.13));
    g.font = `italic ${w * 0.055}px ${SERIF}`; g.fillText(author, w / 2, h * 0.3 + lines.length * w * 0.13 + w * 0.08);
    // ornament
    g.strokeStyle = p.accent; g.lineWidth = 3; g.beginPath();
    for (let i = 0; i < 4; i++) g.arc(w / 2 + (i - 1.5) * w * 0.07, h * 0.72, w * 0.03, 0, Math.PI * 2);
    g.stroke();
  } else if (style === 1) { // three bands
    g.fillStyle = p.accent; g.fillRect(0, 0, w, h * 0.28); g.fillRect(0, h * 0.72, w, h * 0.28);
    g.fillStyle = '#f4ecdc'; g.fillRect(0, h * 0.3, w, h * 0.4);
    g.fillStyle = '#1d1a16';
    fitFont(g, title, w * 0.84, w * 0.1, '600');
    const lines = wrap(g, title, w * 0.84);
    const top = h * 0.5 - ((lines.length - 1) * w * 0.12) / 2 - w * 0.03;
    lines.forEach((l, i) => g.fillText(l, w / 2, top + i * w * 0.12));
    g.font = `${w * 0.05}px ${SANS}`; g.fillText(author.toUpperCase(), w / 2, h * 0.66);
    g.fillStyle = p.bg; g.font = `600 ${w * 0.04}px ${SANS}`; g.fillText('COLLINSLAB CLASSICS', w / 2, h * 0.15);
  } else if (style === 2) { // modern: big type, a shape
    g.fillStyle = p.accent; g.globalAlpha = 0.9;
    const cx = w * (0.3 + r() * 0.4), cy = h * (0.55 + r() * 0.2);
    if (r() < 0.5) { g.beginPath(); g.arc(cx, cy, w * (0.25 + r() * 0.15), 0, Math.PI * 2); g.fill(); }
    else for (let i = 0; i < 9; i++) g.fillRect(0, h * 0.5 + i * h * 0.045, w * (0.3 + r() * 0.7), h * 0.022);
    g.globalAlpha = 1; g.fillStyle = p.fg; g.textAlign = 'left';
    fitFont(g, title, w * 0.84, w * 0.13, '700', SANS);
    const lines = wrap(g, title, w * 0.84);
    lines.forEach((l, i) => g.fillText(l, w * 0.08, h * 0.14 + i * w * 0.14));
    g.font = `${w * 0.05}px ${SANS}`; g.fillText(author, w * 0.08, h * 0.14 + lines.length * w * 0.14 + w * 0.03);
    if (book.tagline) { g.font = `italic ${w * 0.042}px ${SERIF}`; g.fillText(book.tagline, w * 0.08, h * 0.93); }
  } else { // art deco fan
    g.strokeStyle = p.accent; g.lineWidth = 3;
    for (let i = 0; i < 16; i++) {
      const a = Math.PI + (i / 15) * Math.PI;
      g.beginPath(); g.moveTo(w / 2, h * 0.86); g.lineTo(w / 2 + Math.cos(a) * w * 0.6, h * 0.86 + Math.sin(a) * w * 0.6); g.stroke();
    }
    for (let k = 1; k < 4; k++) { g.beginPath(); g.arc(w / 2, h * 0.86, w * 0.15 * k, Math.PI, 0); g.stroke(); }
    g.fillStyle = p.fg;
    fitFont(g, title.toUpperCase(), w * 0.8, w * 0.1, '600');
    const lines = wrap(g, title.toUpperCase(), w * 0.8);
    lines.forEach((l, i) => g.fillText(l, w / 2, h * 0.16 + i * w * 0.12));
    g.font = `${w * 0.048}px ${SANS}`; g.fillText(author.toUpperCase(), w / 2, h * 0.16 + lines.length * w * 0.12 + w * 0.02);
  }
}

export function drawBack(g, book, w, h) {
  const { palette: p, seed } = designFor(book);
  g.fillStyle = p.bg; g.fillRect(0, 0, w, h);
  clothGrain(g, w, h, 0.05, seed + 7);
  g.fillStyle = p.fg; g.textAlign = 'left';
  if (book.tagline) {
    g.font = `italic ${w * 0.07}px ${SERIF}`;
    wrap(g, book.tagline, w * 0.8).forEach((l, i) => g.fillText(l, w * 0.1, h * 0.14 + i * w * 0.085));
  }
  g.font = `${w * 0.046}px ${SERIF}`;
  const lines = wrap(g, book.blurb || '', w * 0.8);
  lines.forEach((l, i) => g.fillText(l, w * 0.1, h * 0.32 + i * w * 0.068));
  g.font = `${w * 0.036}px ${SANS}`; g.globalAlpha = 0.85;
  const yr = book.year < 0 ? `${-book.year} BCE` : book.year;
  g.fillText(`${book.author} · first published ${yr}`, w * 0.1, h * 0.32 + lines.length * w * 0.068 + w * 0.06);
  g.globalAlpha = 1;
  // barcode block
  g.fillStyle = '#fbf8f1'; g.fillRect(w * 0.55, h * 0.8, w * 0.36, h * 0.13);
  g.fillStyle = '#111';
  const r = rngFrom(seed);
  let x = w * 0.58;
  while (x < w * 0.88) { const bw = 1 + Math.floor(r() * 4); g.fillRect(x, h * 0.815, bw, h * 0.08); x += bw + 1 + Math.floor(r() * 3); }
  g.font = `${w * 0.028}px ${SANS}`; g.fillText(`PG ${book.gutenberg ?? ''} · public domain`, w * 0.58, h * 0.925);
  g.fillStyle = p.accent; g.font = `600 ${w * 0.035}px ${SANS}`; g.fillText('COLLINSLAB CLASSICS', w * 0.1, h * 0.9);
}

function canvasTex(w, h, draw) {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

// ---------------------------------------------------------------------------
// Pages
const PAPER = '#f6f0e2';

function paper(g, w, h, seed) {
  g.fillStyle = PAPER; g.fillRect(0, 0, w, h);
  const r = rngFrom(seed);
  g.save(); g.globalAlpha = 0.035;
  for (let i = 0; i < 1800; i++) { g.fillStyle = r() < 0.5 ? '#7a6a4a' : '#ffffff'; g.fillRect(r() * w, r() * h, 1.5, 1.5); }
  g.restore();
}

/** Lay out the opening text into page-sized chunks of lines. */
function layoutText(book, w, h) {
  const c = document.createElement('canvas').getContext('2d');
  const fs = Math.round(w * 0.037), lh = Math.round(fs * 1.5);
  const marginX = w * 0.11, top = h * 0.1, bottom = h * 0.09;
  const maxW = w - marginX * 2;
  c.font = `${fs}px ${SERIF}`;
  const linesPerPage = Math.floor((h - top - bottom) / lh);
  const paras = (book.text || '').split(/\n\n+/);
  const out = []; // {text, indent}
  paras.forEach((para, pi) => {
    if (book.verse) {
      for (const line of para.split('\n')) wrap(c, line, maxW - fs).forEach((l, i) => out.push({ text: l, indent: i ? fs * 1.5 : 0 }));
      out.push({ text: '' });
    } else {
      const indent = pi === 0 ? 0 : fs * 1.6;
      const words = para.replace(/\s+/g, ' ').trim().split(' ');
      let line = '', first = true;
      for (const word of words) {
        const t = line ? `${line} ${word}` : word;
        if (c.measureText(t).width > maxW - (first ? indent : 0) && line) { out.push({ text: line, indent: first ? indent : 0, justify: true }); line = word; first = false; }
        else line = t;
      }
      if (line) out.push({ text: line, indent: first ? indent : 0 });
    }
  });
  return { lines: out, fs, lh, marginX, top, linesPerPage, maxW };
}

/** Returns draw functions for the preview pages (index 0 = page 1, a right-hand page). */
export function previewPages(book, w, h) {
  const L = layoutText(book, w, h);
  const yr = book.year < 0 ? `${-book.year} BCE` : book.year;
  const pages = [];
  const centred = (g, text, y, font, color = '#2b261f') => { g.font = font; g.fillStyle = color; g.textAlign = 'center'; g.fillText(text, w / 2, y); };
  pages.push((g) => { // 1 half-title
    centred(g, book.title, h * 0.32, `italic ${w * 0.06}px ${SERIF}`);
  });
  pages.push((g) => { // 2 imprint
    g.fillStyle = '#4a4238'; g.textAlign = 'left'; g.font = `${w * 0.026}px ${SERIF}`;
    const lines = [`${book.title}`, `First published ${yr}.`, '', `This edition is set from Project Gutenberg`, `eBook #${book.gutenberg}, a public-domain text.`, '', 'collinslab classics · collinslab.dev'];
    lines.forEach((l, i) => g.fillText(l, w * 0.12, h * 0.72 + i * w * 0.04));
  });
  pages.push((g) => { // 3 title page
    g.font = `600 ${w * 0.075}px ${SERIF}`; g.fillStyle = '#211d18'; g.textAlign = 'center';
    const lines = wrap(g, book.title.toUpperCase(), w * 0.78);
    lines.forEach((l, i) => g.fillText(l, w / 2, h * 0.28 + i * w * 0.09));
    centred(g, 'by', h * 0.28 + lines.length * w * 0.09 + w * 0.04, `italic ${w * 0.035}px ${SERIF}`, '#5a5146');
    centred(g, book.author, h * 0.28 + lines.length * w * 0.09 + w * 0.1, `${w * 0.05}px ${SERIF}`);
    g.strokeStyle = '#8a6d3b'; g.lineWidth = 2; g.beginPath(); g.moveTo(w * 0.42, h * 0.62); g.lineTo(w * 0.58, h * 0.62); g.stroke();
    centred(g, 'COLLINSLAB CLASSICS', h * 0.88, `600 ${w * 0.03}px ${SANS}`, '#5a5146');
  });
  pages.push((g) => { // 4 epigraph-ish tagline
    if (book.tagline) centred(g, book.tagline, h * 0.4, `italic ${w * 0.04}px ${SERIF}`, '#5a5146');
  });
  // Text pages: first one opens with the heading lower down and a drop cap.
  let idx = 0, pageNo = 1;
  const textPages = 6;
  for (let p = 0; p < textPages && idx < L.lines.length; p++, pageNo++) {
    const first = p === 0;
    const startIdx = idx;
    const startY = first ? h * 0.3 : L.top + L.lh;
    const avail = Math.floor((h * 0.91 - startY) / L.lh);
    idx = Math.min(L.lines.length, idx + avail);
    const chunk = L.lines.slice(startIdx, idx), num = pageNo, right = (pages.length + 1) % 2 === 1;
    pages.push((g) => {
      if (first) {
        centred(g, book.heading || 'I', h * 0.2, `${w * 0.045}px ${SERIF}`, '#3a332a');
        g.strokeStyle = '#8a6d3b'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(w * 0.45, h * 0.235); g.lineTo(w * 0.55, h * 0.235); g.stroke();
      } else {
        centred(g, right ? book.title.toUpperCase() : book.author.toUpperCase(), L.top * 0.75, `${w * 0.022}px ${SANS}`, '#7a7065');
      }
      g.fillStyle = '#26211b'; g.textAlign = 'left';
      chunk.forEach((ln, i) => {
        g.font = `${L.fs}px ${SERIF}`;
        const y = startY + i * L.lh;
        if (first && i === 0 && !book.verse && ln.text) { // small-caps first words
          const [head, ...rest] = ln.text.split(' ');
          g.font = `600 ${L.fs * 1.05}px ${SERIF}`; g.fillText(head.toUpperCase(), L.marginX, y);
          const hw = g.measureText(`${head.toUpperCase()} `).width;
          g.font = `${L.fs}px ${SERIF}`; g.fillText(rest.join(' '), L.marginX + hw, y);
          return;
        }
        if (ln.justify && !book.verse) {
          const words = ln.text.split(' '), x0 = L.marginX + (ln.indent || 0), avail2 = L.maxW - (ln.indent || 0);
          const ww = words.reduce((s, x) => s + g.measureText(x).width, 0), gap = words.length > 1 ? (avail2 - ww) / (words.length - 1) : 0;
          let x = x0;
          for (const wd of words) { g.fillText(wd, x, y); x += g.measureText(wd).width + gap; }
        } else g.fillText(ln.text, L.marginX + (ln.indent || 0), y);
      });
      centred(g, String(num), h * 0.95, `${w * 0.026}px ${SERIF}`, '#7a7065');
    });
  }
  // Make the last page odd (right-hand) and end with the "preview ends" page.
  if (pages.length % 2 === 1) pages.push(() => {});
  pages.push((g) => {
    centred(g, '— end of preview —', h * 0.4, `italic ${w * 0.045}px ${SERIF}`, '#5a5146');
    centred(g, 'Press H to keep this book', h * 0.48, `${w * 0.032}px ${SANS}`, '#7a7065');
    centred(g, 'and read on.', h * 0.525, `${w * 0.032}px ${SANS}`, '#7a7065');
  });
  return pages;
}

// ---------------------------------------------------------------------------
// Shelves
const CELL_W = 128, CELL_H = 512, COLS = 32, ROWS = 4;

export function bookDims(book, r) {
  const pages = book?.pages || 200 + Math.floor(r() * 300);
  const h = 0.195 + r() * 0.045;
  return { h, w: h * (0.62 + r() * 0.06), t: Math.min(0.065, 0.008 + pages * 0.000085) };
}

/**
 * Fill every shelf run with books. Titled books (from the catalogue) go in their
 * section, 1–3 copies together; muted, untitled "old volumes" pad the rest.
 */
export class ShelfBooks {
  constructor(catalog, runs, { seed = Date.now() } = {}) {
    this.catalog = catalog;
    const r = rngFrom(seed);
    // Atlas: one cell per catalogue book, then filler designs.
    const fillers = Array.from({ length: COLS * ROWS - catalog.books.length }, (_, i) => ({ id: `filler-${i}`, title: '', author: '' }));
    this.cells = [...catalog.books, ...fillers].slice(0, COLS * ROWS);
    const canvas = Object.assign(document.createElement('canvas'), { width: COLS * CELL_W, height: ROWS * CELL_H });
    const g = canvas.getContext('2d');
    this.cells.forEach((b, i) => {
      const x = (i % COLS) * CELL_W, y = Math.floor(i / COLS) * CELL_H;
      const filler = b.id.startsWith('filler');
      if (filler) Object.assign(b, { muted: true });
      g.save(); g.translate(x, y);
      drawSpine(g, b, 96, CELL_H, { filler });
      if (filler) { // mute the untitled volumes so the titled books stand out
        g.globalCompositeOperation = 'saturation'; g.fillStyle = 'rgba(128,128,128,0.45)'; g.fillRect(0, 0, 96, CELL_H);
        g.globalCompositeOperation = 'source-over'; g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, 0, 96, CELL_H);
      }
      const p = designFor(b).palette;
      g.fillStyle = p.bg; g.fillRect(96, 0, 16, CELL_H);
      g.fillStyle = PAPER; g.fillRect(112, 0, 16, CELL_H);
      g.fillStyle = 'rgba(120,100,70,0.25)'; for (let k = 0; k < 16; k += 2) g.fillRect(112 + k, 0, 1, CELL_H);
      g.restore();
    });
    globalThis.__bsMark?.('atlas drawn');
    this.atlas = new THREE.CanvasTexture(canvas);
    this.atlas.colorSpace = THREE.SRGBColorSpace;
    this.atlas.anisotropy = 16;

    // Place books.
    const bySection = new Map();
    catalog.books.forEach((b, i) => { if (!bySection.has(b.section)) bySection.set(b.section, []); bySection.get(b.section).push(i); });
    for (const list of bySection.values()) list.sort(() => r() - 0.5);
    const cursor = new Map();
    this.items = []; // { cell, bookIndex|null, dims, matrix, normal, runIndex, along }
    runs.forEach((run, ri) => {
      let x = 0.005;
      const titled = bySection.get(run.section) || [];
      while (x < run.length - 0.02) {
        let cell, bookIndex = null, copies = 1;
        if (titled.length && r() < 0.3) {
          const c = cursor.get(run.section) || 0; cursor.set(run.section, c + 1);
          bookIndex = titled[c % titled.length]; cell = bookIndex; copies = 1 + (r() < 0.35 ? 1 : 0);
        } else cell = catalog.books.length + Math.floor(r() * (this.cells.length - catalog.books.length));
        const dims = bookDims(bookIndex != null ? catalog.books[bookIndex] : null, rngFrom(hash(this.cells[cell].id) + (bookIndex == null ? Math.floor(r() * 1e6) : 0)));
        dims.h = Math.min(dims.h, run.clearance - 0.01);
        let placed = 0;
        for (let k = 0; k < copies; k++) {
          if (x + dims.t > run.length) break;
          placed++;
          this.items.push({ cell, bookIndex, dims, runIndex: ri, along: x + dims.t / 2, run });
          x += dims.t + 0.0015 + r() * 0.002;
        }
        if (!placed) break; // no room left on this run
        if (r() < 0.04) x += 0.04 + r() * 0.08; // the odd gap
      }
    });
    globalThis.__bsMark?.(`placed ${this.items.length} books`);
    this.#buildMesh();
    globalThis.__bsMark?.('mesh built');
    this.hover = -1;
    this.offsets = new Float32Array(this.items.length);
  }

  #buildMesh() {
    const tmpl = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0, 0).toNonIndexed();
    const tp = tmpl.attributes.position.array, tn = tmpl.attributes.normal.array, tu = tmpl.attributes.uv.array;
    const n = this.items.length, V = 36;
    const pos = new Float32Array(n * V * 3), nor = new Float32Array(n * V * 3), uv = new Float32Array(n * V * 2);
    const m = new THREE.Matrix4(), rot = new THREE.Matrix3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    this.items.forEach((it, i) => {
      const { run, dims } = it;
      const X = run.normal.clone().negate(), Z = new THREE.Vector3().crossVectors(X, up);
      const origin = run.start.clone().addScaledVector(run.dir, it.along).addScaledVector(run.normal, -0.015).add(new THREE.Vector3(0, dims.h / 2, 0));
      m.makeBasis(X, up, Z).setPosition(origin);
      it.matrix = m.clone(); it.normal = run.normal;
      // Z must run along the shelf so thickness is along the run.
      const scale = new THREE.Matrix4().makeScale(dims.w, dims.h, dims.t);
      const full = m.clone().multiply(scale);
      rot.setFromMatrix4(m);
      const cx = (it.cell % COLS) * CELL_W, cy = Math.floor(it.cell / COLS) * CELL_H;
      const U = (px) => px / (COLS * CELL_W), Vv = (py) => 1 - py / (ROWS * CELL_H);
      for (let k = 0; k < V; k++) {
        v.set(tp[k * 3], tp[k * 3 + 1], tp[k * 3 + 2]).applyMatrix4(full);
        pos.set([v.x, v.y, v.z], (i * V + k) * 3);
        v.set(tn[k * 3], tn[k * 3 + 1], tn[k * 3 + 2]).applyMatrix3(rot).normalize();
        nor.set([v.x, v.y, v.z], (i * V + k) * 3);
        const face = Math.floor(k / 6), su = tu[k * 2], sv = tu[k * 2 + 1];
        let u0, u1;
        if (face === 1) { u0 = cx; u1 = cx + 96; }            // -x: spine
        else if (face === 4 || face === 5) { u0 = cx + 98; u1 = cx + 110; } // covers
        else { u0 = cx + 113; u1 = cx + 127; }                // page edges
        uv.set([U(u0 + su * (u1 - u0)), Vv(cy + CELL_H - sv * CELL_H)], (i * V + k) * 2);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    this.basePositions = pos.slice();
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this.atlas, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.6 }));
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  /** Which titled book is the camera ray pointing at (within reach)? Returns item index or -1. */
  pick(ray, maxDist = 2.3) {
    let best = -1, bestT = maxDist;
    const byRun = this.#runIndex || (this.#runIndex = this.#indexRuns());
    for (const [run, list] of byRun) {
      const denom = ray.direction.dot(run.normal);
      if (denom > -0.05) continue; // facing away
      const t = run.start.clone().sub(ray.origin).dot(run.normal) / denom;
      if (t <= 0 || t >= bestT) continue;
      const p = ray.at(t, new THREE.Vector3());
      const rel = p.clone().sub(run.start);
      const along = rel.dot(run.dir), y = rel.y;
      if (along < 0 || along > run.length || y < 0 || y > run.clearance) continue;
      for (const i of list) {
        const it = this.items[i];
        if (Math.abs(along - it.along) <= it.dims.t / 2 + 0.001 && y <= it.dims.h) {
          if (it.hidden) break;
          best = i; bestT = t; break;
        }
      }
    }
    return best;
  }

  #runIndex = null;
  #indexRuns() {
    const m = new Map();
    this.items.forEach((it, i) => { if (!m.has(it.run)) m.set(it.run, []); m.get(it.run).push(i); });
    return m;
  }

  #write(i, offset, collapse = false) {
    const pos = this.mesh.geometry.attributes.position, base = this.basePositions, it = this.items[i], n = it.normal;
    const c = it.matrix.elements; // origin for collapse
    for (let k = 0; k < 36; k++) {
      const j = (i * 36 + k) * 3;
      if (collapse) { pos.array[j] = c[12]; pos.array[j + 1] = c[13]; pos.array[j + 2] = c[14]; }
      else { pos.array[j] = base[j] + n.x * offset; pos.array[j + 1] = base[j + 1]; pos.array[j + 2] = base[j + 2] + n.z * offset; }
    }
    pos.needsUpdate = true;
  }

  setHidden(i, hidden) { this.items[i].hidden = hidden; this.offsets[i] = 0; this.#write(i, 0, hidden); }

  /** Ease the hovered book a little out of the shelf. */
  update(dt) {
    for (let i = 0; i < this.items.length; i++) {
      const target = i === this.hover && !this.items[i].hidden ? 0.022 : 0;
      const o = this.offsets[i];
      if (Math.abs(o - target) < 1e-4) continue;
      this.offsets[i] = o + (target - o) * Math.min(1, dt * 14);
      this.#write(i, this.offsets[i]);
    }
  }
}

// ---------------------------------------------------------------------------
// The book in your hands
export class HandBook {
  constructor(book, dims) {
    this.book = book;
    const { w, h, t } = dims;
    Object.assign(this, { w, h, t });
    const b = 0.0028; // board thickness
    this.board = b;
    const texH = 1024, texW = Math.round((texH * w) / h);
    const cover = canvasTex(texW, texH, (g) => drawCover(g, book, texW, texH));
    const back = canvasTex(texW, texH, (g) => drawBack(g, book, texW, texH));
    const spineW = Math.max(64, Math.round((texH * t) / h));
    const spine = canvasTex(spineW, texH, (g) => drawSpine(g, book, spineW, texH));
    const p = designFor(book).palette;
    const endpaper = canvasTex(512, 768, (g, W, H) => {
      g.fillStyle = p.bg; g.fillRect(0, 0, W, H);
      g.globalAlpha = 0.22; g.strokeStyle = p.accent; g.lineWidth = 2;
      for (let y = -H; y < H * 2; y += 18) { g.beginPath(); for (let x = 0; x <= W; x += 16) g.lineTo(x, y + Math.sin(x / 40 + y / 90) * 22); g.stroke(); }
    });
    const edge = canvasTex(64, 512, (g, W, H) => { g.fillStyle = PAPER; g.fillRect(0, 0, W, H); g.fillStyle = 'rgba(120,100,70,0.22)'; for (let x = 0; x < W; x += 2) g.fillRect(x, 0, 1, H); });
    const cloth = (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.72, envMapIntensity: 0.5 });
    const plain = new THREE.MeshStandardMaterial({ color: p.bg, roughness: 0.75 });
    const edgeMat = new THREE.MeshStandardMaterial({ map: edge, roughness: 0.95 });
    this.disposables = [cover, back, spine, endpaper, edge];

    this.group = new THREE.Group();       // origin = spine centre
    this.pivot = new THREE.Group();       // centres the closed book for display
    this.pivot.add(this.group);
    // Back board: faces [+x,-x,+y,-y,+z,-z]; outside is -z.
    const backBoard = new THREE.Mesh(new THREE.BoxGeometry(w, h, b).translate(w / 2, 0, -t / 2 + b / 2),
      [plain, plain, plain, plain, cloth(endpaper), cloth(back)]);
    // Spine.
    const spineMesh = new THREE.Mesh(new THREE.BoxGeometry(b, h, t).translate(-b / 2, 0, 0), [plain, cloth(spine), plain, plain, plain, plain]);
    // Page block (right-hand stack when open): top face shows the current right page.
    this.rightMat = new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.95, envMapIntensity: 0.4 });
    const pb = t - 2 * b;
    this.pageBlock = new THREE.Mesh(new THREE.BoxGeometry(w - 0.006, h - 0.006, pb).translate((w - 0.006) / 2 + 0.002, 0, 0),
      [edgeMat, edgeMat, edgeMat, edgeMat, this.rightMat, edgeMat]);
    // Front board on a hinge at the spine.
    this.hinge = new THREE.Group();
    this.hinge.position.set(0, 0, t / 2 - b);
    const frontBoard = new THREE.Mesh(new THREE.BoxGeometry(w, h, b).translate(w / 2, 0, b / 2), [plain, plain, plain, plain, cloth(cover), cloth(endpaper)]);
    // Left page: lies on the inside of the front board (faces -z before opening).
    this.leftMat = new THREE.MeshStandardMaterial({ map: endpaper, roughness: 0.95, color: '#e6e0d4', envMapIntensity: 0.4 });
    this.leftPage = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.006, h - 0.006).translate((w - 0.006) / 2 + 0.002, 0, 0.0006), this.leftMat);
    this.leftPage.rotation.y = Math.PI; this.leftPage.position.x = w;
    this.hinge.add(frontBoard, this.leftPage);
    this.group.add(backBoard, spineMesh, this.pageBlock, this.hinge);
    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    // Turning page: a strip of quads bent along x.
    this.flipGeo = new THREE.PlaneGeometry(w - 0.006, h - 0.006, 48, 1);
    this.flipBase = this.flipGeo.attributes.position.array.slice();
    this.flipFrontMat = new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.FrontSide, color: '#e6e0d4', envMapIntensity: 0.4 });
    this.flipBackMat = new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.BackSide, color: '#e6e0d4', envMapIntensity: 0.4 });
    this.flip = new THREE.Group();
    this.flip.add(new THREE.Mesh(this.flipGeo, this.flipFrontMat), new THREE.Mesh(this.flipGeo, this.flipBackMat));
    this.flip.position.z = t / 2 - b + 0.0008;
    this.flip.visible = false;
    this.group.add(this.flip);

    this.pages = previewPages(book, 900, Math.round((900 * h) / w));
    this.pageTex = new Map();
    this.spread = 0;        // 0 = closed-cover view; k>0 = left page 2k-1 | right page 2k (1-based)
    this.openness = 0;      // 0 closed .. 1 open
    this.flipT = null;      // active flip progress
    this.group.position.x = -w / 2; // centre the closed book on the pivot
  }

  texForPage(i, mirror = false) {
    if (i < 0 || i >= this.pages.length) return null;
    const key = `${i}:${mirror}`;
    if (!this.pageTex.has(key)) {
      const W = 900, H = Math.round((900 * this.h) / this.w);
      const t = canvasTex(W, H, (g) => { paper(g, W, H, i + 3); this.pages[i](g); });
      if (mirror) { t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1; }
      this.pageTex.set(key, t); this.disposables.push(t);
    }
    return this.pageTex.get(key);
  }

  /** Show pages for a spread: left = page 2k-1 (or endpaper), right = page 2k (0-based index 2k). */
  showSpread(k) {
    this.spread = k;
    const right = this.texForPage(2 * k);
    this.rightMat.map = right; this.rightMat.color.set(right ? '#e6e0d4' : PAPER); this.rightMat.needsUpdate = true;
    const left = k === 0 ? null : this.texForPage(2 * k - 1);
    if (left) { this.leftMat.map = left; this.leftMat.needsUpdate = true; }
    else { this.leftMat.map = this.disposables[3]; this.leftMat.needsUpdate = true; }
  }

  get spreads() { return Math.ceil(this.pages.length / 2); }

  setOpenness(o) {
    this.openness = o;
    this.hinge.rotation.y = -Math.PI * o;
    // slide so the spine sits at the centre once open
    this.group.position.x = -this.w / 2 * (1 - o);
  }

  /** Bend the turning page. s: 0 (lying on the right) .. 1 (lying on the left). */
  setFlip(s) {
    const pos = this.flipGeo.attributes.position, base = this.flipBase, W = this.w - 0.006;
    const segs = 48, step = W / segs, theta = Math.PI * s, curl = 1.25 * Math.sin(Math.PI * s);
    const xs = [0], zs = [0];
    for (let i = 1; i <= segs; i++) {
      const u = (i - 0.5) / segs;
      const phi = Math.min(Math.PI, Math.max(0, theta + curl * (u - 0.15)));
      xs.push(xs[i - 1] + Math.cos(phi) * step); zs.push(zs[i - 1] + Math.sin(phi) * step);
    }
    for (let k = 0; k < pos.count; k++) {
      const x0 = base[k * 3] + W / 2; // plane is centred; shift to 0..W
      const i = Math.round(x0 / step);
      pos.setXYZ(k, xs[i] + 0.002, base[k * 3 + 1], zs[i]);
    }
    pos.needsUpdate = true;
    this.flipGeo.computeVertexNormals();
  }

  /** Start turning from spread k to k+dir. Returns false if there is nowhere to go. */
  beginFlip(dir) {
    if (this.flipT !== null) return false;
    const k = this.spread, to = k + dir;
    if (to < 0 || to > this.spreads - 1) return false;
    // forward: the turning page carries right page 2k (front) and page 2k+1 (back)
    const frontIdx = dir > 0 ? 2 * k : 2 * k - 2;
    const backIdx = dir > 0 ? 2 * k + 1 : 2 * k - 1;
    this.flipFrontMat.map = this.texForPage(frontIdx); this.flipFrontMat.needsUpdate = true;
    this.flipBackMat.map = this.texForPage(backIdx, true); this.flipBackMat.needsUpdate = true;
    if (dir > 0) { // reveal the next right page underneath immediately
      const nr = this.texForPage(2 * to); this.rightMat.map = nr; this.rightMat.needsUpdate = true;
    } else {        // reveal the previous left page underneath
      const nl = to === 0 ? this.disposables[3] : this.texForPage(2 * to - 1); this.leftMat.map = nl; this.leftMat.needsUpdate = true;
    }
    this.flipDir = dir; this.flipTo = to; this.flipT = 0;
    this.flip.visible = true;
    this.setFlip(dir > 0 ? 0 : 1);
    return true;
  }

  /** Advance an active flip; returns true while flipping. */
  updateFlip(dt) {
    if (this.flipT === null) return false;
    this.flipT = Math.min(1, this.flipT + dt / 0.62);
    const e = this.flipT < 0.5 ? 2 * this.flipT * this.flipT : 1 - (-2 * this.flipT + 2) ** 2 / 2;
    this.setFlip(this.flipDir > 0 ? e : 1 - e);
    if (this.flipT >= 1) {
      this.flip.visible = false; this.flipT = null;
      this.showSpread(this.flipTo);
    }
    return true;
  }

  dispose() {
    this.disposables.forEach((t) => t.dispose());
    this.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); } });
  }
}
