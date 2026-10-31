// Generates the animated GitHub profile banner (dark and light variants).
//
// Why text is converted to paths: GitHub shows SVGs through an <img> tag,
// and an SVG loaded that way cannot fetch web fonts. Turning the text into
// vector outlines makes it render in Inter on every OS, at a few KB.
//
// Usage (from this folder): pnpm install, then pnpm build
// Writes ../assets/banner-dark.svg and ../assets/banner-light.svg.
// To update the banner, edit NAME, ROLE or PATH below and rebuild.

import opentype from 'opentype.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] ?? join(here, '..', 'assets'));

// ---------- Content -------------------------------------------------------

const NAME = 'Yann Thobena';
const ROLE = 'Head of AI at Ipanova';

// The career path. Points without a label only shape the flat decade.
// x/y are in the 1200 x 380 viewBox.
const PATH = [
  { x: 64, y: 300, year: '2010', label: 'Sales, then store manager', place: 'below', dy: 38 },
  { x: 300, y: 300 },
  { x: 470, y: 300 },
  { x: 600, y: 300, year: '2021', label: 'Developer', place: 'below', dy: 38 },
  { x: 728, y: 280, label: 'Tech lead', place: 'below' },
  { x: 850, y: 246, label: 'AI consultant', place: 'below' },
  { x: 966, y: 192, label: 'AI lead', place: 'below' },
  { x: 1076, y: 112, year: '2026', label: 'Head of AI', place: 'above-left', current: true },
];

const ALT_TITLE = `${NAME}, ${ROLE}`;
const ALT_DESC =
  'Career path drawn as a line: ten years in sales and store management from 2010, ' +
  'developer in 2021, then tech lead, AI consultant, AI lead, and Head of AI in 2026.';

// ---------- Themes (tokens taken from yanndevweb.com) ---------------------

const THEMES = {
  dark: {
    bg: '#0A0A0A',
    border: '#262626',
    name: '#FAFAFA',
    role: '#C4B5FD', // violet-300
    label: '#D4D4D4',
    year: '#A78BFA', // violet-400
    lineFrom: '#6D28D9', // violet-700: the business decade, quieter
    lineTo: '#A78BFA',
    current: '#A78BFA',
    glow: '#7C3AED', // violet-600, the site's accent
    glowOpacity: 0.42,
    dots: '#DDD6FE',
    dotsOpacity: 0.16,
  },
  light: {
    bg: '#FFFFFF',
    border: '#E5E5E5',
    name: '#0A0A0A',
    role: '#6D28D9', // violet-700
    label: '#404040',
    year: '#7C3AED',
    lineFrom: '#C4B5FD',
    lineTo: '#7C3AED',
    current: '#7C3AED',
    glow: '#8B5CF6',
    glowOpacity: 0.16,
    dots: '#7C3AED',
    dotsOpacity: 0.14,
  },
};

// ---------- Fonts ---------------------------------------------------------

const fontDir = join(here, 'node_modules/@fontsource/inter/files');
function loadFont(weight) {
  const buf = readFileSync(join(fontDir, `inter-latin-${weight}-normal.woff`));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
const INTER = { 500: loadFont(500), 600: loadFont(600), 700: loadFont(700) };

const r1 = (n) => Math.round(n * 10) / 10;

// Text as an SVG path. `tracking` is in em (e.g. -0.03).
function text(str, { x, y, size, weight = 500, tracking = 0 }) {
  const font = INTER[weight];
  const scale = size / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(str);
  let cursor = x;
  let d = '';
  glyphs.forEach((g, i) => {
    d += g.getPath(cursor, y, size).toPathData(1);
    let advance = g.advanceWidth * scale;
    if (i < glyphs.length - 1) {
      advance += font.getKerningValue(g, glyphs[i + 1]) * scale + tracking * size;
    }
    cursor += advance;
  });
  return { d, width: cursor - x };
}

function measure(str, opts) {
  return text(str, { ...opts, x: 0, y: 0 }).width;
}

// ---------- Curve ---------------------------------------------------------

// Catmull-Rom spline through the points, expressed as cubic Béziers.
function splineSegments(pts) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    segs.push([
      p1,
      { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p2,
    ]);
  }
  return segs;
}

function bezierPoint([a, b, c, d], t) {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
}

function segmentLength(seg, steps = 400) {
  let len = 0;
  let prev = seg[0];
  for (let s = 1; s <= steps; s++) {
    const p = bezierPoint(seg, s / steps);
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return len;
}

const segs = splineSegments(PATH);
const pathD =
  `M${PATH[0].x},${PATH[0].y}` +
  segs.map(([, c1, c2, p]) => ` C${r1(c1.x)},${r1(c1.y)} ${r1(c2.x)},${r1(c2.y)} ${p.x},${p.y}`).join('');

// Cumulative length at each point, as a fraction of the whole line.
const lengths = segs.map((s) => segmentLength(s));
const total = lengths.reduce((a, b) => a + b, 0);
const fractions = [0];
lengths.reduce((acc, l) => {
  fractions.push((acc + l) / total);
  return acc + l;
}, 0);

// ---------- Timing --------------------------------------------------------

const DRAW_START = 0.3; // s
const DRAW_DURATION = 2.6; // s, linear so node delays match the line
const reachAt = (i) => DRAW_START + fractions[i] * DRAW_DURATION;
const ARRIVAL = DRAW_START + DRAW_DURATION;

// ---------- SVG -----------------------------------------------------------

const W = 1200;
const H = 380;
// Labels are drawn at 18 units so they stay around 12-13px on a GitHub
// profile column (~830px wide).
const LABEL_SIZE = 18;

function labelGroup(p, i, t) {
  const gap = 7;
  const yearW = p.year ? measure(p.year, { size: LABEL_SIZE, weight: 600 }) : 0;
  const labelW = measure(p.label, { size: LABEL_SIZE, weight: 500 });
  const totalW = yearW + (p.year ? gap : 0) + labelW;

  let x;
  let y;
  if (p.place === 'above-left') {
    // Clear of the pulse ring around the current node.
    x = p.x - 36 - totalW;
    y = p.y - 22;
  } else {
    x = i === 0 ? p.x : p.x + 12;
    y = p.y + (p.dy ?? 30);
  }

  const parts = [];
  if (p.year) {
    parts.push(`<path fill="${t.year}" d="${text(p.year, { x, y, size: LABEL_SIZE, weight: 600 }).d}"/>`);
  }
  const lx = x + (p.year ? yearW + gap : 0);
  parts.push(`<path fill="${t.label}" d="${text(p.label, { x: lx, y, size: LABEL_SIZE, weight: 500 }).d}"/>`);

  const delay = (reachAt(i) + 0.12).toFixed(2);
  return `<g class="label" style="animation-delay:${delay}s">${parts.join('')}</g>`;
}

function node(p, i, t) {
  const delay = Math.max(reachAt(i) - 0.06, 0).toFixed(2);
  if (p.current) {
    return `
    <g transform="translate(${p.x} ${p.y})">
      <circle class="pulse" r="7" fill="none" stroke="${t.current}" stroke-width="2"/>
      <circle class="node" style="animation-delay:${delay}s" r="7.5" fill="${t.current}"/>
    </g>`;
  }
  return `<circle class="node" style="animation-delay:${delay}s" cx="${p.x}" cy="${p.y}" r="6" fill="${t.bg}" stroke="${t.lineTo}" stroke-width="2.5"/>`;
}

function build(themeName) {
  const t = THEMES[themeName];
  const current = PATH.find((p) => p.current);
  const climbStart = (600 - PATH[0].x) / (current.x - PATH[0].x);

  const name = text(NAME, { x: 62, y: 110, size: 66, weight: 700, tracking: -0.03 });
  const role = text(ROLE, { x: 65, y: 156, size: 27, weight: 500, tracking: -0.01 });

  const labels = PATH.map((p, i) => (p.label ? labelGroup(p, i, t) : '')).join('');
  const nodes = PATH.map((p, i) => (p.label ? node(p, i, t) : '')).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="title desc">
  <title id="title">${ALT_TITLE}</title>
  <desc id="desc">${ALT_DESC}</desc>
  <style>
    .pulse { opacity: 0; transform-box: fill-box; transform-origin: center; }
    @media (prefers-reduced-motion: no-preference) {
      .line { stroke-dasharray: 1 1; stroke-dashoffset: 1; animation: draw ${DRAW_DURATION}s linear ${DRAW_START}s forwards; }
      .node { transform-box: fill-box; transform-origin: center; animation: pop .45s cubic-bezier(.2,.9,.3,1.35) both; }
      .label { animation: rise .5s ease-out both; }
      .glow { animation: fade 1.4s ease-out ${(ARRIVAL - 0.4).toFixed(2)}s both; }
      .pulse { animation: pulse 2.6s ease-out ${(ARRIVAL + 0.2).toFixed(2)}s infinite; }
    }
    @keyframes draw { to { stroke-dashoffset: 0; } }
    @keyframes pop { from { opacity: 0; transform: scale(.2); } to { opacity: 1; transform: scale(1); } }
    @keyframes rise { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes pulse { 0% { opacity: .75; transform: scale(1); } 80%, 100% { opacity: 0; transform: scale(3.8); } }
  </style>
  <defs>
    <clipPath id="card"><rect width="${W}" height="${H}" rx="20"/></clipPath>
    <radialGradient id="glow" cx="${current.x}" cy="${current.y}" r="420" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${t.glow}" stop-opacity="${t.glowOpacity}"/>
      <stop offset="1" stop-color="${t.glow}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="fadeDots" cx="${current.x}" cy="${current.y}" r="520" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff"/>
      <stop offset="1" stop-color="#000"/>
    </radialGradient>
    <mask id="dotsMask"><rect width="${W}" height="${H}" fill="url(#fadeDots)"/></mask>
    <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
      <circle cx="11" cy="11" r="1" fill="${t.dots}" fill-opacity="${t.dotsOpacity}"/>
    </pattern>
    <linearGradient id="stroke" x1="${PATH[0].x}" x2="${current.x}" y1="0" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${t.lineFrom}"/>
      <stop offset="${(climbStart * 0.85).toFixed(3)}" stop-color="${t.lineFrom}"/>
      <stop offset="1" stop-color="${t.lineTo}"/>
    </linearGradient>
  </defs>

  <g clip-path="url(#card)">
    <rect width="${W}" height="${H}" fill="${t.bg}"/>
    <rect class="glow" width="${W}" height="${H}" fill="url(#glow)"/>
    <rect width="${W}" height="${H}" fill="url(#dots)" mask="url(#dotsMask)"/>
  </g>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="19.5" fill="none" stroke="${t.border}"/>

  <path fill="${t.name}" d="${name.d}"/>
  <path fill="${t.role}" d="${role.d}"/>

  <path class="line" pathLength="1" d="${pathD}" fill="none" stroke="url(#stroke)" stroke-width="3" stroke-linecap="round"/>
  ${nodes}
  ${labels}
</svg>
`;
}

mkdirSync(outDir, { recursive: true });
for (const theme of Object.keys(THEMES)) {
  const svg = build(theme);
  const file = join(outDir, `banner-${theme}.svg`);
  writeFileSync(file, svg);
  console.log(`${file}  ${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB`);
}
