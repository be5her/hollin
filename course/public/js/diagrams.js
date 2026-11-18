/**
 * The course's own drawings (the pictures of the app are screenshots; these explain an idea or give the
 * lengths to type). Each is an inline SVG built from a few numbers in millimetres, with its words passed
 * in by the lesson, so the same drawing serves both languages. A drawing never mirrors: plans read the
 * same way in Arabic, as they do in the app.
 */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const isArabic = (s) => /[؀-ۿ]/.test(String(s));
/** Right-to-left text starts at its right edge: an Arabic label asks for the opposite anchor, so it lies where the English one does. */
const anchorOf = (s, anchor = 'middle') => (isArabic(s) && anchor !== 'middle' ? (anchor === 'start' ? 'end' : 'start') : anchor);
const text = (x, y, s, o = {}) =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchorOf(s, o.anchor)}" font-size="${o.size ?? 13}"${o.cls ? ` class="${o.cls}"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''}${isArabic(s) ? ' direction="rtl"' : ''}${o.fill ? ` fill="${o.fill}" style="fill:${o.fill}"` : ''}>${esc(s)}</text>`;
const fmt = (mm) => String(Math.round(mm));

/**
 * A plan scheme. `spec.box` is the part of the world shown, in mm (y up); walls are drawn to scale,
 * lengths are written beside them, stops are the points where a run pauses for a wall to come.
 */
function scheme(spec, L = {}) {
  const [x0, y0, x1, y1] = spec.box;
  const W = 760;
  const s = W / (x1 - x0);
  const H = (y1 - y0) * s;
  const X = (x) => (x - x0) * s;
  const Y = (y) => (y1 - y) * s;
  const out = [];
  const word = (key) => L[key] ?? key;

  for (const r of spec.rooms ?? []) {
    const [a, b, c, d] = r.r;
    out.push(`<rect x="${X(a).toFixed(1)}" y="${Y(d).toFixed(1)}" width="${((c - a) * s).toFixed(1)}" height="${((d - b) * s).toFixed(1)}" fill="${r.fill ?? 'var(--room)'}" stroke="none"/>`);
  }
  const wall = (w, color, dash) => {
    const t = Math.max(2.5, (w.t ?? 200) * s);
    out.push(`<line x1="${X(w.a[0]).toFixed(1)}" y1="${Y(w.a[1]).toFixed(1)}" x2="${X(w.b[0]).toFixed(1)}" y2="${Y(w.b[1]).toFixed(1)}" stroke="${color}" stroke-width="${t.toFixed(1)}" stroke-linecap="square"${dash ? ` stroke-dasharray="${dash}" stroke-linecap="butt"` : ''}/>`);
  };
  for (const w of spec.ghost ?? []) wall(w, 'var(--edge)');
  for (const w of spec.later ?? []) wall({ ...w, t: 40 }, 'var(--muted)', '7 6');
  for (const w of spec.walls ?? []) wall(w, w.accent ? 'var(--accent)' : 'var(--wall)');

  for (const d of spec.dims ?? []) {
    const [ax, ay] = d.a;
    const [bx, by] = d.b;
    const len = Math.hypot(bx - ax, by - ay);
    // The offset is to the left of a → b; in screen space y is down, hence the signs.
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    const off = d.off ?? 700;
    const p = [X(ax + nx * off), Y(ay + ny * off)];
    const q = [X(bx + nx * off), Y(by + ny * off)];
    const tick = 5;
    const horizontal = Math.abs(by - ay) < 1;
    out.push(`<g stroke="var(--dim)" stroke-width="1.2" fill="none"><line x1="${p[0].toFixed(1)}" y1="${p[1].toFixed(1)}" x2="${q[0].toFixed(1)}" y2="${q[1].toFixed(1)}"/>`);
    for (const e of [p, q]) out.push(horizontal ? `<line x1="${e[0].toFixed(1)}" y1="${(e[1] - tick).toFixed(1)}" x2="${e[0].toFixed(1)}" y2="${(e[1] + tick).toFixed(1)}"/>` : `<line x1="${(e[0] - tick).toFixed(1)}" y1="${e[1].toFixed(1)}" x2="${(e[0] + tick).toFixed(1)}" y2="${e[1].toFixed(1)}"/>`);
    out.push('</g>');
    const label = d.text ?? fmt(len);
    const mx = (p[0] + q[0]) / 2;
    const my = (p[1] + q[1]) / 2;
    if (horizontal) out.push(text(mx, my + (ny * off > 0 ? -7 : 17), label, { cls: 'm', size: d.size ?? 13, weight: d.bold ? 600 : 400 }));
    else out.push(text(mx + (nx * off > 0 ? 8 : -8), my + 4, label, { cls: 'm', size: d.size ?? 13, anchor: nx * off > 0 ? 'start' : 'end', weight: d.bold ? 600 : 400 }));
  }
  for (const a of spec.arrows ?? []) {
    const p = [X(a.a[0]), Y(a.a[1])];
    const q = [X(a.b[0]), Y(a.b[1])];
    const ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const h = 8;
    out.push(
      `<g stroke="var(--accent)" stroke-width="1.6" fill="none" stroke-linecap="round"><line x1="${p[0].toFixed(1)}" y1="${p[1].toFixed(1)}" x2="${q[0].toFixed(1)}" y2="${q[1].toFixed(1)}"/><path d="M${(q[0] - h * Math.cos(ang - 0.45)).toFixed(1)} ${(q[1] - h * Math.sin(ang - 0.45)).toFixed(1)} L${q[0].toFixed(1)} ${q[1].toFixed(1)} L${(q[0] - h * Math.cos(ang + 0.45)).toFixed(1)} ${(q[1] - h * Math.sin(ang + 0.45)).toFixed(1)}"/></g>`,
    );
  }
  for (const p of spec.stops ?? []) out.push(`<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="5.5" fill="var(--canvas)" stroke="var(--accent)" stroke-width="2.4"/>`);
  if (spec.start) {
    out.push(`<circle cx="${X(spec.start[0]).toFixed(1)}" cy="${Y(spec.start[1]).toFixed(1)}" r="7" fill="var(--accent)" stroke="var(--canvas)" stroke-width="2"/>`);
  }
  for (const axis of spec.axis ?? []) {
    out.push(`<line x1="${X(axis.a[0]).toFixed(1)}" y1="${Y(axis.a[1]).toFixed(1)}" x2="${X(axis.b[0]).toFixed(1)}" y2="${Y(axis.b[1]).toFixed(1)}" stroke="var(--accent)" stroke-width="1.8" stroke-dasharray="9 5 2 5"/>`);
  }
  for (const n of spec.steps ?? []) {
    out.push(`<circle cx="${X(n.at[0]).toFixed(1)}" cy="${Y(n.at[1]).toFixed(1)}" r="11" fill="var(--fg)"/>`);
    out.push(text(X(n.at[0]), Y(n.at[1]) + 4.5, String(n.n), { size: 12.5, fill: 'var(--canvas)', cls: 'm', weight: 600 }));
  }
  for (const l of spec.labels ?? []) {
    const lines = String(word(l.key)).split('\n');
    lines.forEach((line, i) => out.push(text(X(l.at[0]), Y(l.at[1]) + i * ((l.size ?? 13) + 3), line, { size: l.size ?? 13, cls: l.soft ? 'soft' : undefined, weight: l.bold ? 700 : 400, anchor: l.anchor, fill: l.accent ? 'var(--accent)' : undefined })));
    if (l.sub) out.push(text(X(l.at[0]), Y(l.at[1]) + lines.length * ((l.size ?? 13) + 3), l.sub, { size: 11.5, cls: 'm' }));
  }
  return `<svg viewBox="0 0 ${W} ${H.toFixed(0)}" role="img" xmlns="http://www.w3.org/2000/svg">${out.join('')}</svg>`;
}

const seg = (a, b, t = 200, extra = {}) => ({ a, b, t, ...extra });
const ring = (pts, t = 200) => pts.map((p, i) => seg(p, pts[(i + 1) % pts.length], t));

// ---------- the practice house: 9.5 × 4.5 m ----------
const HOUSE = ring([
  [0, 0],
  [9500, 0],
  [9500, 4500],
  [0, 4500],
]);

const houseOutline = {
  box: [-1900, -1600, 11200, 6000],
  walls: HOUSE,
  later: [seg([7500, 0], [7500, 4500])],
  stops: [
    [7500, 0],
    [9500, 0],
    [9500, 4500],
    [7500, 4500],
    [0, 4500],
  ],
  start: [0, 0],
  dims: [
    { a: [0, 0], b: [7500, 0], off: -700 },
    { a: [7500, 0], b: [9500, 0], off: -700 },
    { a: [9500, 0], b: [9500, 4500], off: -700 },
    { a: [9500, 4500], b: [7500, 4500], off: -700 },
    { a: [7500, 4500], b: [0, 4500], off: -700 },
  ],
  arrows: [
    { a: [2800, 450], b: [4700, 450] },
    { a: [9050, 1400], b: [9050, 3100] },
    { a: [4700, 4050], b: [2800, 4050] },
    { a: [450, 3100], b: [450, 1400] },
  ],
  labels: [
    { key: 'start', at: [-180, -520], anchor: 'end', accent: true, bold: true },
    { key: 'close', at: [700, 2300], anchor: 'start', soft: true },
    { key: 'later', at: [7320, 1500], anchor: 'end', soft: true },
  ],
};

// ---------- the building: 21 × 10 m ----------
const B_OUTLINE = ring([
  [0, 0],
  [21000, 0],
  [21000, 10000],
  [0, 10000],
]);
const A_INNER = [
  seg([3800, 0], [3800, 10000], 100),
  seg([0, 5500], [9000, 5500], 100),
  seg([5700, 5500], [5700, 10000], 100),
  seg([3800, 7000], [5700, 7000], 100),
];
const mirror = (w) => seg([21000 - w.a[0], w.a[1]], [21000 - w.b[0], w.b[1]], w.t);
const HALL_A = seg([9000, 0], [9000, 10000], 200);

const buildingOutline = {
  box: [-3300, -2400, 24300, 12400],
  walls: B_OUTLINE,
  stops: [
    [3800, 0],
    [9000, 0],
    [12000, 0],
    [21000, 0],
    [21000, 10000],
    [12000, 10000],
    [9000, 10000],
    [5700, 10000],
    [3800, 10000],
    [0, 10000],
    [0, 5500],
  ],
  start: [0, 0],
  dims: [
    { a: [0, 0], b: [3800, 0], off: -1000 },
    { a: [3800, 0], b: [9000, 0], off: -1000 },
    { a: [9000, 0], b: [12000, 0], off: -1000 },
    { a: [12000, 0], b: [21000, 0], off: -1000 },
    { a: [21000, 0], b: [21000, 10000], off: -1000 },
    { a: [21000, 10000], b: [12000, 10000], off: -1000 },
    { a: [12000, 10000], b: [9000, 10000], off: -1000 },
    { a: [9000, 10000], b: [5700, 10000], off: -1000 },
    { a: [5700, 10000], b: [3800, 10000], off: -1000 },
    { a: [3800, 10000], b: [0, 10000], off: -1000 },
    { a: [0, 10000], b: [0, 5500], off: -1000 },
  ],
  arrows: [
    { a: [5200, 900], b: [8200, 900] },
    { a: [20100, 3600], b: [20100, 6600] },
    { a: [15800, 9100], b: [12800, 9100] },
    { a: [900, 4400], b: [900, 1400] },
  ],
  labels: [
    { key: 'start', at: [-250, -900], anchor: 'end', accent: true, bold: true },
    { key: 'close', at: [1500, 2900], anchor: 'start', soft: true },
  ],
};

const partitions = {
  box: [-2300, -1500, 13300, 11500],
  ghost: [seg([0, 0], [12000, 0]), seg([0, 0], [0, 10000]), seg([0, 10000], [12000, 10000])],
  walls: [HALL_A, ...A_INNER],
  stops: [
    [9000, 0],
    [9000, 5500],
    [9000, 10000],
    [3800, 0],
    [3800, 5500],
    [3800, 7000],
    [3800, 10000],
    [0, 5500],
    [5700, 5500],
    [5700, 7000],
    [5700, 10000],
  ],
  dims: [
    { a: [9000, 0], b: [9000, 5500], off: -900 },
    { a: [3800, 0], b: [3800, 5500], off: 550 },
    { a: [3800, 5500], b: [3800, 7000], off: 550 },
    { a: [3800, 5500], b: [5700, 5500], off: -520 },
    { a: [5700, 5500], b: [5700, 7000], off: -550 },
  ],
  steps: [
    { n: 1, at: [9000, -700] },
    { n: 2, at: [3800, -700] },
    { n: 3, at: [-700, 5500] },
    { n: 4, at: [6450, 8050] },
    { n: 5, at: [4750, 7600] },
  ],
  labels: [
    { key: 'kitchen', at: [1700, 2600], soft: true },
    { key: 'living', at: [6600, 2600], soft: true },
    { key: 'bed1', at: [1700, 8500], soft: true },
    { key: 'bath', at: [4750, 9000], soft: true },
    { key: 'bed2', at: [7500, 8500], soft: true },
    { key: 'hall', at: [10500, 5000], soft: true },
  ],
};

const program = {
  box: [-900, -2000, 23600, 12600],
  rooms: [
    { r: [100, 100, 3750, 5450], fill: 'var(--accent-tint)' },
    { r: [3850, 100, 8900, 5450], fill: 'var(--accent-tint)' },
    { r: [100, 5550, 3750, 9900], fill: 'var(--room)' },
    { r: [5750, 5550, 8900, 9900], fill: 'var(--room)' },
    { r: [3850, 5550, 5650, 6950], fill: 'var(--room)' },
    { r: [3850, 7050, 5650, 9900], fill: 'var(--ai-tint)' },
    { r: [12100, 100, 17150, 5450], fill: 'var(--accent-tint)' },
    { r: [17250, 100, 20900, 5450], fill: 'var(--accent-tint)' },
    { r: [17250, 5550, 20900, 9900], fill: 'var(--room)' },
    { r: [12100, 5550, 15250, 9900], fill: 'var(--room)' },
    { r: [15350, 5550, 17150, 6950], fill: 'var(--room)' },
    { r: [15350, 7050, 17150, 9900], fill: 'var(--ai-tint)' },
  ],
  walls: [...B_OUTLINE, HALL_A, mirror(HALL_A), ...A_INNER, ...A_INNER.map(mirror)],
  axis: [
    { a: [10500, -1700], b: [10500, -150] },
    { a: [10500, 10150], b: [10500, 12300] },
  ],
  dims: [
    { a: [0, 0], b: [9000, 0], off: -1100, text: '9000' },
    { a: [9000, 0], b: [12000, 0], off: -1100, text: '3000' },
    { a: [12000, 0], b: [21000, 0], off: -1100, text: '9000' },
    { a: [21000, 0], b: [21000, 10000], off: -900, text: '10000' },
  ],
  labels: [
    { key: 'kitchen', at: [1925, 2900], sub: '19.5 m²' },
    { key: 'living', at: [6375, 2900], sub: '27 m²' },
    { key: 'bed1', at: [1925, 7850], sub: '15.9 m²' },
    { key: 'bed2', at: [7325, 7850], sub: '13.7 m²' },
    { key: 'bath', at: [4750, 8650], size: 11.5 },
    { key: 'hallway', at: [4750, 6350], size: 11 },
    { key: 'hall', at: [10500, 3200], bold: true },
    { key: 'stair', at: [10500, 8300], soft: true },
    { key: 'flatA', at: [4500, 11300], bold: true, size: 14 },
    { key: 'flatB', at: [16500, 11300], bold: true, size: 14 },
    { key: 'kitchen', at: [19075, 2900], soft: true },
    { key: 'living', at: [14625, 2900], soft: true },
    { key: 'bed1', at: [19075, 7850], soft: true },
    { key: 'bed2', at: [13675, 7850], soft: true },
  ],
};

// ---------- the villa: 12 × 10 m ----------
const V_OUTLINE = ring([
  [0, 0],
  [12000, 0],
  [12000, 10000],
  [0, 10000],
]);
const V_INNER = [
  seg([0, 5500], [7000, 5500], 200),
  seg([7000, 0], [7000, 10000], 100),
  seg([5000, 0], [5000, 5500], 100),
  seg([5000, 2500], [7000, 2500], 100),
  seg([7000, 5500], [12000, 5500], 100),
];

/** The ground floor by zone: the guests at the front left, the family behind the thick wall and at the side. */
const villaProgram = {
  box: [-2600, -1900, 16600, 11700],
  rooms: [
    { r: [100, 100, 4950, 5400], fill: 'var(--accent-tint)' },
    { r: [5050, 100, 6950, 2450], fill: 'var(--accent-tint)' },
    { r: [5050, 2550, 6950, 5400], fill: 'var(--ai-tint)' },
    { r: [7050, 100, 11900, 5450], fill: 'var(--room)' },
    { r: [100, 5600, 6950, 9900], fill: 'var(--room)' },
    { r: [7050, 5550, 11900, 9900], fill: 'var(--room)' },
  ],
  walls: [...V_OUTLINE, ...V_INNER],
  arrows: [
    { a: [6000, -1500], b: [6000, -250] },
    { a: [13500, 6300], b: [12250, 6300] },
  ],
  dims: [
    { a: [0, 10000], b: [12000, 10000], off: 900, text: '12000' },
    { a: [0, 0], b: [0, 10000], off: 900, text: '10000' },
  ],
  labels: [
    { key: 'majlis', at: [2500, 2900], bold: true, sub: '25.7 m²' },
    { key: 'entry', at: [6000, 1500], size: 11 },
    { key: 'wash', at: [6000, 4200], size: 11 },
    { key: 'kitchen', at: [9500, 2900], bold: true, sub: '25.9 m²' },
    { key: 'living', at: [3500, 7850], bold: true, sub: '29.4 m²' },
    { key: 'stairHall', at: [9500, 7850], bold: true, sub: '21.1 m²' },
    { key: 'guests', at: [6000, -1650], accent: true, bold: true },
    { key: 'family', at: [13650, 6350], anchor: 'start', accent: true, bold: true, size: 12 },
    { key: 'street', at: [1700, -900], soft: true },
    { key: 'garden', at: [3500, 11350], soft: true },
  ],
};

/** The lengths to type: the outline with its stops, then the five runs of inner walls. */
const villaWalls = {
  box: [-2700, -1900, 14700, 11900],
  walls: [...V_OUTLINE, ...V_INNER.map((w, i) => (i === 0 ? { ...w, accent: true } : w))],
  stops: [
    [5000, 0],
    [7000, 0],
    [12000, 5500],
    [7000, 10000],
    [3500, 10000],
    [0, 5500],
    [3500, 5500],
    [5000, 5500],
    [7000, 5500],
    [5000, 2500],
    [7000, 2500],
  ],
  start: [0, 0],
  dims: [
    { a: [0, 0], b: [5000, 0], off: -800 },
    { a: [5000, 0], b: [7000, 0], off: -800 },
    { a: [7000, 0], b: [12000, 0], off: -800 },
    { a: [12000, 0], b: [12000, 5500], off: -800 },
    { a: [12000, 5500], b: [12000, 10000], off: -800 },
    { a: [12000, 10000], b: [7000, 10000], off: -800 },
    { a: [7000, 10000], b: [3500, 10000], off: -800 },
    { a: [3500, 10000], b: [0, 10000], off: -800 },
    { a: [0, 10000], b: [0, 5500], off: -800 },
    { a: [0, 5500], b: [3500, 5500], off: 480 },
    { a: [3500, 5500], b: [5000, 5500], off: 480 },
    { a: [5000, 5500], b: [7000, 5500], off: 480 },
    { a: [7000, 0], b: [7000, 2500], off: -520 },
    { a: [5000, 0], b: [5000, 2500], off: 520 },
  ],
  steps: [
    { n: 1, at: [1700, 4950] },
    { n: 2, at: [7000, 7700] },
    { n: 3, at: [5000, 3900] },
    { n: 4, at: [6000, 2500] },
    { n: 5, at: [9500, 5500] },
  ],
  labels: [
    { key: 'start', at: [-250, -900], anchor: 'end', accent: true, bold: true },
    { key: 'majlis', at: [2500, 2500], soft: true },
    { key: 'kitchen', at: [9700, 2700], soft: true },
    { key: 'living', at: [3500, 8200], soft: true },
    { key: 'stairHall', at: [9700, 8200], soft: true },
  ],
};

/** The first floor on the same walls: one new wall, and the rooms' new jobs. */
const villaUpper = {
  box: [-2400, -900, 14400, 10900],
  rooms: [
    { r: [100, 100, 4950, 5400], fill: 'var(--room)' },
    { r: [5050, 100, 6950, 2450], fill: 'var(--ai-tint)' },
    { r: [5050, 2550, 6950, 5400], fill: 'var(--ai-tint)' },
    { r: [7050, 100, 11900, 5450], fill: 'var(--room)' },
    { r: [100, 5600, 3450, 9900], fill: 'var(--room)' },
    { r: [3550, 5600, 6950, 9900], fill: 'var(--accent-tint)' },
    { r: [7050, 5550, 11900, 9900], fill: 'var(--accent-tint)' },
  ],
  walls: [...V_OUTLINE, ...V_INNER],
  later: [seg([3500, 5500], [3500, 10000])],
  stops: [
    [3500, 10000],
    [3500, 5500],
  ],
  labels: [
    { key: 'master', at: [2500, 2600], bold: true },
    { key: 'masterBath', at: [6000, 1200], size: 11 },
    { key: 'bath', at: [6000, 4100], size: 11 },
    { key: 'bed2', at: [9500, 2900], bold: true },
    { key: 'bed3', at: [1750, 7850], bold: true },
    { key: 'lounge', at: [5250, 7850], bold: true },
    { key: 'landing', at: [9500, 7850], bold: true },
    { key: 'newWall', at: [3700, 9300], anchor: 'start', soft: true, size: 11.5 },
  ],
};

// ---------- drawings that explain an idea ----------

/** A wall with a door and a window seen from the side, cut 1.2 m up, and the same wall on the plan. */
function slice(L) {
  const o = [];
  // Elevation: ground line, wall, door, window, the cut.
  o.push(`<rect x="40" y="60" width="300" height="150" fill="var(--canvas)" stroke="var(--wall)" stroke-width="2.5"/>`);
  o.push(`<rect x="80" y="105" width="45" height="105" fill="var(--surface)" stroke="var(--wall)" stroke-width="2"/>`);
  o.push(`<rect x="165" y="105" width="80" height="60" fill="var(--surface)" stroke="var(--wall)" stroke-width="2"/><line x1="205" y1="105" x2="205" y2="165" stroke="var(--wall)" stroke-width="1.2"/>`);
  o.push(`<line x1="20" y1="210" x2="360" y2="210" stroke="var(--muted)" stroke-width="1.5"/>`);
  o.push(`<line x1="14" y1="150" x2="366" y2="150" stroke="var(--accent)" stroke-width="2" stroke-dasharray="9 6"/>`);
  o.push(text(190, 40, L.side, { size: 14, weight: 700 }));
  o.push(text(334, 143, L.cut, { size: 12, anchor: 'end', fill: 'var(--accent)', weight: 700 }));
  o.push(text(102, 232, L.door, { size: 12.5, cls: 'soft' }));
  o.push(text(205, 232, L.window, { size: 12.5, cls: 'soft' }));
  // The arrow between the two.
  o.push(`<g stroke="var(--muted)" stroke-width="1.8" fill="none" stroke-linecap="round"><line x1="378" y1="135" x2="414" y2="135"/><path d="M406 128 L414 135 L406 142"/></g>`);
  // Plan: the wall as a band, the door as a gap with its swing, the window as thin lines.
  o.push(text(580, 40, L.above, { size: 14, weight: 700 }));
  o.push(`<rect x="430" y="118" width="40" height="34" fill="var(--wall)"/><rect x="515" y="118" width="75" height="34" fill="var(--wall)"/><rect x="680" y="118" width="50" height="34" fill="var(--wall)"/>`);
  o.push(`<line x1="470" y1="152" x2="470" y2="197" stroke="var(--wall)" stroke-width="2"/><path d="M470 197 A45 45 0 0 0 515 152" fill="none" stroke="var(--wall)" stroke-width="1.3" stroke-dasharray="4 3"/>`);
  o.push(`<rect x="590" y="118" width="90" height="34" fill="var(--canvas)" stroke="var(--wall)" stroke-width="1.3"/><line x1="590" y1="135" x2="680" y2="135" stroke="var(--wall)" stroke-width="1.3"/>`);
  o.push(text(492, 222, L.door, { size: 12.5, cls: 'soft' }));
  o.push(text(635, 108, L.window, { size: 12.5, cls: 'soft' }));
  o.push(text(450, 108, L.wall, { size: 12.5, cls: 'soft' }));
  return `<svg viewBox="0 0 760 250" role="img" xmlns="http://www.w3.org/2000/svg">${o.join('')}</svg>`;
}

/** The same room twice: a door in the middle of a wall leaves two short walls; a door by the corner leaves one long wall for furniture. */
function doorPlace(L) {
  const room = (x, corner) => {
    const o = [];
    const y = 50;
    const w = 300;
    const h = 170;
    const t = 9;
    const gapStart = corner ? x + w - 82 : x + w / 2 - 30;
    o.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="var(--room)" stroke="none"/>`);
    o.push(`<g fill="var(--wall)"><rect x="${x - t}" y="${y - t}" width="${w + 2 * t}" height="${t}"/><rect x="${x - t}" y="${y - t}" width="${t}" height="${h + 2 * t}"/><rect x="${x + w}" y="${y - t}" width="${t}" height="${h + 2 * t}"/><rect x="${x - t}" y="${y + h}" width="${gapStart - x + t}" height="${t}"/><rect x="${gapStart + 60}" y="${y + h}" width="${x + w + t - gapStart - 60}" height="${t}"/></g>`);
    // The door leaf and its swing, opening into the room.
    o.push(`<line x1="${gapStart + 60}" y1="${y + h}" x2="${gapStart + 60}" y2="${y + h - 60}" stroke="var(--wall)" stroke-width="2"/><path d="M${gapStart + 60} ${y + h - 60} A60 60 0 0 0 ${gapStart} ${y + h}" fill="none" stroke="var(--wall)" stroke-width="1.2" stroke-dasharray="4 3"/>`);
    // The walking path from the door.
    o.push(`<path d="M${gapStart + 30} ${y + h - 6} L${gapStart + 30} ${y + h - 95}" stroke="var(--accent)" stroke-width="2" stroke-dasharray="6 5" fill="none"/>`);
    if (corner) {
      o.push(`<rect x="${x + 14}" y="${y + 14}" width="150" height="92" rx="6" fill="var(--canvas)" stroke="var(--muted)" stroke-width="1.5"/>`);
      o.push(`<rect x="${x + 14}" y="${y + h - 50}" width="110" height="38" rx="5" fill="var(--canvas)" stroke="var(--muted)" stroke-width="1.5"/>`);
    } else {
      o.push(`<rect x="${x + 12}" y="${y + 14}" width="92" height="62" rx="6" fill="var(--canvas)" stroke="var(--muted)" stroke-width="1.5"/>`);
    }
    return o.join('');
  };
  const o = [room(50, false), room(420, true)];
  o.push(text(200, 28, L.middle, { size: 14, weight: 700 }));
  o.push(text(570, 28, L.corner, { size: 14, weight: 700 }));
  o.push(text(200, 256, L.middleNote, { size: 12.5, cls: 'soft' }));
  o.push(text(570, 256, L.cornerNote, { size: 12.5, cls: 'soft' }));
  return `<svg viewBox="0 0 760 270" role="img" xmlns="http://www.w3.org/2000/svg">${o.join('')}</svg>`;
}

/** The apartment as bubbles: the day zone by the entrance, the night zone behind a door, the wet rooms together. */
function zones(L) {
  const o = [];
  const bubble = (cx, cy, rx, ry, fill, stroke, label, sub) => {
    o.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="1.8"/>`);
    o.push(text(cx, cy + (sub ? -2 : 5), label, { size: 14, weight: 700 }));
    if (sub) o.push(text(cx, cy + 17, sub, { size: 12, cls: 'soft' }));
  };
  const link = (x1, y1, x2, y2, dash) => o.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--muted)" stroke-width="2"${dash ? ' stroke-dasharray="5 5"' : ''}/>`);
  link(110, 215, 250, 200);
  link(330, 180, 470, 120);
  link(330, 215, 440, 250);
  link(520, 120, 640, 80);
  link(520, 130, 650, 180);
  link(520, 150, 520, 220, true);
  o.push(`<g stroke="var(--accent)" stroke-width="2.2" fill="none" stroke-linecap="round"><line x1="24" y1="215" x2="68" y2="215"/><path d="M60 208 L68 215 L60 222"/></g>`);
  bubble(110, 215, 42, 26, 'var(--canvas)', 'var(--accent)', L.entrance);
  bubble(290, 200, 78, 46, 'var(--accent-tint)', 'var(--accent)', L.living, L.day);
  bubble(490, 250, 60, 34, 'var(--accent-tint)', 'var(--accent)', L.kitchen, L.dayWet);
  bubble(495, 120, 40, 26, 'var(--canvas)', 'var(--muted)', L.hall);
  bubble(660, 70, 66, 36, 'var(--room)', 'var(--success)', L.bedroom + ' 1', L.night);
  bubble(668, 190, 62, 34, 'var(--room)', 'var(--success)', L.bedroom + ' 2', L.night);
  o.push(`<ellipse cx="380" cy="60" rx="70" ry="32" fill="var(--ai-tint)" stroke="var(--ai)" stroke-width="1.8"/>`);
  o.push(text(380, 58, L.bathroom, { size: 14, weight: 700 }));
  o.push(text(380, 75, L.wet, { size: 12, cls: 'soft' }));
  link(440, 78, 465, 104);
  return `<svg viewBox="0 0 760 300" role="img" xmlns="http://www.w3.org/2000/svg">${o.join('')}</svg>`;
}

/** A stair from the side: the riser is the height of a step, the tread its depth. */
function stair(L) {
  const o = [];
  const n = 6;
  const tr = 62;
  const ri = 34;
  const x0 = 150;
  const yb = 250;
  let d = `M${x0} ${yb}`;
  for (let i = 0; i < n; i++) d += ` v${-ri} h${tr}`;
  o.push(`<path d="${d} V${yb} Z" fill="var(--room)" stroke="var(--wall)" stroke-width="2.5" stroke-linejoin="miter"/>`);
  o.push(`<line x1="60" y1="${yb}" x2="700" y2="${yb}" stroke="var(--muted)" stroke-width="1.5"/>`);
  // One riser and one tread, measured.
  const sx = x0 + 2 * tr;
  const sy = yb - 2 * ri;
  o.push(`<g stroke="var(--dim)" stroke-width="1.4" fill="none"><line x1="${sx - 14}" y1="${sy}" x2="${sx - 14}" y2="${sy - ri}"/><line x1="${sx - 19}" y1="${sy}" x2="${sx - 9}" y2="${sy}"/><line x1="${sx - 19}" y1="${sy - ri}" x2="${sx - 9}" y2="${sy - ri}"/><line x1="${sx}" y1="${sy - ri - 14}" x2="${sx + tr}" y2="${sy - ri - 14}"/><line x1="${sx}" y1="${sy - ri - 19}" x2="${sx}" y2="${sy - ri - 9}"/><line x1="${sx + tr}" y1="${sy - ri - 19}" x2="${sx + tr}" y2="${sy - ri - 9}"/></g>`);
  o.push(text(sx - 22, sy - ri / 2 + 4, L.riser, { size: 13, anchor: 'end', weight: 700 }));
  o.push(text(sx + tr / 2, sy - ri - 22, L.tread, { size: 13, weight: 700 }));
  // The whole rise.
  const top = yb - n * ri;
  const rx = x0 + n * tr + 40;
  o.push(`<g stroke="var(--accent)" stroke-width="1.6" fill="none"><line x1="${rx}" y1="${yb}" x2="${rx}" y2="${top}"/><line x1="${rx - 6}" y1="${yb}" x2="${rx + 6}" y2="${yb}"/><line x1="${rx - 6}" y1="${top}" x2="${rx + 6}" y2="${top}"/></g>`);
  o.push(text(rx + 12, (yb + top) / 2 + 4, L.rise, { size: 13, anchor: 'start', fill: 'var(--accent)', weight: 700 }));
  o.push(text(380, 290, L.formula, { size: 14, weight: 700 }));
  return `<svg viewBox="0 0 760 305" role="img" xmlns="http://www.w3.org/2000/svg">${o.join('')}</svg>`;
}

const SCHEMES = { 'house-outline': houseOutline, 'building-outline': buildingOutline, partitions, program, 'villa-program': villaProgram, 'villa-walls': villaWalls, 'villa-upper': villaUpper };
const DRAWINGS = { slice, 'door-place': doorPlace, zones, stair };

/** The SVG of a drawing by its id, worded with `L`; an empty string when there is none. */
export function draw(id, L = {}) {
  if (SCHEMES[id]) return scheme(SCHEMES[id], L);
  if (DRAWINGS[id]) return DRAWINGS[id](L);
  return '';
}
