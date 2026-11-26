// Metal-cutting shop maths: sections (shapes), weight from size × length × density, cut planning and offcuts.
// Pure functions, no storage. All sizes and lengths are in millimetres; weights in kg (3 decimals = grams).

/** Shapes: which sizes are asked (in mm) and the cross-section area in mm². */
export const SHAPES = Object.freeze({
  round:    { label: 'Round bar',          sym: 'Ø', dims: ['Diameter'],                    area: ([d]) => Math.PI / 4 * d * d },
  square:   { label: 'Square bar',         sym: '□', dims: ['Side'],                        area: ([a]) => a * a },
  hex:      { label: 'Hex bar',            sym: '⬡', dims: ['Across flats'],                area: ([a]) => Math.sqrt(3) / 2 * a * a },
  flat:     { label: 'Flat / plate strip', sym: '▭', dims: ['Width', 'Thickness'],          area: ([w, t]) => w * t },
  pipe:     { label: 'Round pipe',         sym: '◯', dims: ['Outer diameter', 'Wall'],      area: ([od, t]) => Math.PI / 4 * (od * od - (od - 2 * t) * (od - 2 * t)) },
  sqtube:   { label: 'Square tube',        sym: '▢', dims: ['Side', 'Wall'],                area: ([a, t]) => a * a - (a - 2 * t) * (a - 2 * t) },
  recttube: { label: 'Rectangular tube',   sym: '▯', dims: ['Width', 'Height', 'Wall'],     area: ([w, h, t]) => w * h - (w - 2 * t) * (h - 2 * t) },
  angle:    { label: 'Angle',              sym: '∟', dims: ['Leg A', 'Leg B', 'Thickness'], area: ([a, b, t]) => t * (a + b - t) },
});

/** Starter grades. Density in kg/m³; HSN and GST are starting points only — the shop must confirm them with its CA. */
export const DEFAULT_GRADES = Object.freeze([
  { name: 'M.S.',          density: 7850, hsn: '7214', gstRate: 18 },   // mild steel
  { name: 'E.N.8',         density: 7850, hsn: '7214', gstRate: 18 },
  { name: 'E.N.19 ROLLED', density: 7850, hsn: '7228', gstRate: 18 },
  { name: 'E.N.19 FORGED', density: 7850, hsn: '7228', gstRate: 18 },
  { name: 'E.N.24 ROLLED', density: 7850, hsn: '7228', gstRate: 18 },
  { name: 'E.N.24 FORGED', density: 7850, hsn: '7228', gstRate: 18 },
  { name: 'E.N.41.B',      density: 7850, hsn: '7228', gstRate: 18 },
]);

const r1 = n => Math.round(n * 10) / 10;       // lengths to 0.1 mm
const r3 = n => Math.round(n * 1000) / 1000;   // weights to 1 g

/** A typed length or size in mm → number (0.1 mm steps) or null. Accepts "1250", "1250.5", "1,250". */
export function parseMm(v, max = 100000) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) && n > 0 && n <= max ? r1(n) : null;
}

/** Problems with a shape + sizes ([] = fine). */
export function sectionErrors(shape, dims) {
  if (typeof shape !== 'string' || !Object.hasOwn(SHAPES, shape)) return ['Choose a shape.'];
  const sh = SHAPES[shape], d = Array.isArray(dims) ? dims : [], e = [];
  sh.dims.forEach((label, i) => { if (!(Number.isFinite(d[i]) && d[i] > 0 && d[i] <= 5000)) e.push(`Enter ${label.toLowerCase()} in mm.`); });
  if (e.length) return e;
  if ((shape === 'pipe' || shape === 'sqtube') && d[1] * 2 >= d[0]) e.push('Wall is too thick for this size.');
  if (shape === 'recttube' && d[2] * 2 >= Math.min(d[0], d[1])) e.push('Wall is too thick for this size.');
  if (shape === 'angle' && d[2] >= Math.min(d[0], d[1])) e.push('Thickness must be less than the legs.');
  return e;
}

/** Cross-section area in mm² (0 when the section is not valid). */
export function sectionArea(shape, dims) { return sectionErrors(shape, dims).length ? 0 : SHAPES[shape].area(dims); }

/** Weight in kg of a length of this section. density in kg/m³. */
export function weightKg(shape, dims, lengthMm, density) {
  const a = sectionArea(shape, dims);
  if (!a || !(lengthMm > 0) || !(density > 0)) return 0;
  return r3(a * lengthMm * density / 1e9);
}
/** kg per metre, for showing on tiles. */
export const kgPerMetre = (shape, dims, density) => weightKg(shape, dims, 1000, density);

/** "Ø40" / "50×10" / "∟50×50×6" */
export function sizeLabel(shape, dims) {
  if (!Object.hasOwn(SHAPES, shape)) return '';
  const n = (Array.isArray(dims) ? dims : []).slice(0, SHAPES[shape].dims.length).map(x => String(r1(Number(x) || 0)));
  return (['round', 'pipe'].includes(shape) ? 'Ø' : shape === 'angle' ? '∟' : '') + n.join('×');
}
/** "EN8 Round bar Ø40" */
export function materialName(shape, dims, gradeName, label) {
  return `${gradeName || ''} ${label || SHAPES[shape]?.label || ''} ${sizeLabel(shape, dims)}`.replace(/\s+/g, ' ').trim();
}

/**
 * How many pieces of pieceMm come out of one bar of stockMm, with kerfMm lost to the blade on every cut.
 * The last piece needs no cut after it when it ends exactly at the end of the bar.
 */
export function maxPieces(stockMm, pieceMm, kerfMm = 0) {
  if (!(stockMm > 0) || !(pieceMm > 0) || !(kerfMm >= 0)) return 0;
  return Math.max(0, Math.floor((stockMm + kerfMm + 1e-9) / (pieceMm + kerfMm)));
}
/** Cutting `pieces` pieces from one bar: { pieces, usedMm, leftoverMm } (usedMm includes blade loss). */
export function cutFromBar(stockMm, pieceMm, pieces, kerfMm = 0) {
  const n = Math.min(Math.max(0, Math.floor(pieces)), maxPieces(stockMm, pieceMm, kerfMm));
  const usedMm = r1(Math.min(stockMm, n * (pieceMm + kerfMm)));
  return { pieces: n, usedMm, leftoverMm: r1(stockMm - usedMm) };
}

/**
 * Plan a job across the bars in stock: `qty` pieces of pieceMm.
 * Short pieces (offcuts) are used up first, so full bars stay whole for bigger jobs.
 * bars: [{ id, lengthMm, code }] → { cuts: [{ barId, code, beforeMm, pieces, usedMm, afterMm, scrap }], pieces, shortfall, usedMm, scrapMm }
 * A leftover shorter than minOffcutMm is scrap (not kept as stock).
 */
export function planCuts(bars, pieceMm, qty, { kerfMm = 0, minOffcutMm = 0, onlyBarId = null, prefer = 'offcuts' } = {}) {
  const out = { cuts: [], pieces: 0, shortfall: 0, usedMm: 0, scrapMm: 0 };
  const want = Math.floor(Number(qty));
  if (!(pieceMm > 0) || !(want > 0) || want > 100000) return out;
  const usable = (Array.isArray(bars) ? bars : [])
    .filter(b => b && Number.isFinite(b.lengthMm) && (!onlyBarId || b.id === onlyBarId) && maxPieces(b.lengthMm, pieceMm, kerfMm) > 0)
    // prefer 'full': never dip into offcuts by itself — first a bar this bill is already cutting, then uncut full-length bars
    .filter(b => prefer !== 'full' || onlyBarId || b.inBill || isFullBar(b))
    .sort(prefer === 'full'
      ? (a, b) => (b.inBill ? 1 : 0) - (a.inBill ? 1 : 0) || String(a.code || '').localeCompare(String(b.code || ''), undefined, { numeric: true })
      : (a, b) => a.lengthMm - b.lengthMm || String(a.code || '').localeCompare(String(b.code || '')));
  let left = want;
  for (const b of usable) {
    if (!left) break;
    const c = cutFromBar(b.lengthMm, pieceMm, left, kerfMm);
    if (!c.pieces) continue;
    const scrap = c.leftoverMm > 0 && c.leftoverMm < minOffcutMm;
    out.cuts.push({ barId: b.id, code: b.code || '', beforeMm: b.lengthMm, pieces: c.pieces, usedMm: c.usedMm, afterMm: c.leftoverMm, scrap });
    out.usedMm = r1(out.usedMm + c.usedMm); if (scrap) out.scrapMm = r1(out.scrapMm + c.leftoverMm);
    left -= c.pieces;
  }
  out.pieces = want - left; out.shortfall = left;
  return out;
}

/** A bar that has never been cut (still the length it was received at). */
export function isFullBar(b) { return !!b && Number.isFinite(b.lengthMm) && b.lengthMm >= (Number.isFinite(b.origLengthMm) ? b.origLengthMm : b.lengthMm) - 0.05; }
/** Offcuts long enough for at least one piece, shortest first — offered as a suggestion, never used automatically. */
export function usableOffcuts(bars, pieceMm, kerfMm = 0) {
  return (Array.isArray(bars) ? bars : []).filter(b => b && !isFullBar(b) && !b.inBill && maxPieces(b.lengthMm, pieceMm, kerfMm) > 0).sort((a, b) => a.lengthMm - b.lengthMm);
}
/** Heat / batch number as typed at receiving: letters, digits, dash, slash, space; max 24. */
export function cleanHeat(v) { return String(v ?? '').replace(/[^A-Za-z0-9/ -]/g, '').trim().slice(0, 24); }

/** Total stock of one material: pieces, metres and kg. */
export function stockSummary(bars, material, density) {
  const mine = (Array.isArray(bars) ? bars : []).filter(b => b && b.materialId === material.id && b.status === 'stock' && b.lengthMm > 0);
  const mm = mine.reduce((a, b) => a + b.lengthMm, 0);
  return { pieces: mine.length, mm: r1(mm), kg: weightKg(material.metal.shape, material.metal.dims, mm, density), longestMm: mine.reduce((a, b) => Math.max(a, b.lengthMm), 0) };
}

/** "1,250 mm" / "6.0 m" */
export function fmtMm(mm) { const n = Number(mm) || 0; return n >= 10000 ? `${(n / 1000).toFixed(2).replace(/\.?0+$/, '')} m` : `${String(r1(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} mm`; }

/* ---------------- reading names and barcodes ---------------- */
const norm = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const SHAPE_WORDS = [
  ['recttube', /\b(rect(angular)?\s*(tube|pipe)|rhs)\b/i], ['sqtube', /\b(sq(uare)?\.?\s*(tube|pipe)|shs)\b/i], ['pipe', /\b(pipe|tube|erw|seamless)\b/i],
  ['angle', /\b(angle|l[- ]?angle)\b/i], ['hex', /\b(hex(agon(al)?)?)\b/i], ['flat', /\b(flat|patti|patta|plate|sheet|strip)\b/i],
  ['square', /\b(sq(uare)?\.?)\b/i], ['round', /\b(round|rd\.?|rod|bright\s*bar|shaft(ing)?|bar)\b/i],
];
/** Which grade does this text mention? Longest grade name wins ("EN19" before "EN1"). */
export function gradeInText(text, grades) {
  const t = norm(text); if (!t) return null;
  // "E.N.19 FORGED" is found in "EN19 FORGED RD 50" and also in "EN-19 RD 50 FORGED": every word of the name must be there
  return (Array.isArray(grades) ? grades : []).filter(g => { const w = gradeWords(g?.name); return w.length && norm(g.name).length >= 2 && (t.includes(norm(g.name)) || (w.length > 1 && w.every(k => t.includes(k)))); })
    .sort((a, b) => norm(b.name).length - norm(a.name).length)[0] || null;
}
const gradeWords = name => String(name ?? '').trim().split(/\s+/).map(norm).filter(Boolean);
/**
 * Best guess of shape, sizes and grade from an item name such as "EN8 ROUND 40MM" or "SS304 FLAT 50 X 10".
 * Returns { shape, dims, grade } or null when it can't be read with confidence.
 */
export function parseMaterialName(name, grades) {
  const text = String(name ?? '').slice(0, 120);
  const grade = gradeInText(text, grades);
  const shape = SHAPE_WORDS.find(([, re]) => re.test(text))?.[0];
  if (!shape) return null;
  // sizes: numbers that are not part of the grade name
  let rest = text; if (grade) for (const w of gradeWords(grade.name)) rest = rest.replace(new RegExp(w.split('').join('[^A-Za-z0-9]*'), 'i'), ' ');
  const nums = [...rest.matchAll(/(\d+(?:\.\d+)?)\s*(?:mm)?/gi)].map(m => Number(m[1])).filter(n => n > 0 && n <= 5000);
  const need = SHAPES[shape].dims.length;
  if (nums.length < need) return null;
  const dims = nums.slice(0, need);
  if (shape === 'flat' && dims[1] > dims[0]) dims.reverse();       // width is the larger number
  return sectionErrors(shape, dims).length ? null : { shape, dims, grade };
}

/** Which material does a scanned supplier barcode belong to? Exact barcodes the shop has linked before. */
export function materialForBarcode(code, materials) {
  const c = String(code ?? '').trim(); if (!c) return null;
  return (Array.isArray(materials) ? materials : []).find(m => m && m.active !== false && m.metal && (m.barcode === c || (Array.isArray(m.barcodes) && m.barcodes.includes(c)))) || null;
}

/** Next stock-piece code: B-0001, B-0002 … */
export function nextBarCode(seq, prefix = 'B') { return (/^B\d{0,2}$/.test(prefix) ? prefix : 'B') + '-' + String(Math.max(1, Math.floor(Number(seq) || 1))).padStart(4, '0'); }
/** B-0042 on the first device; B2-0042 on a shop's second device when devices are synced. */
/* ---------- suppliers, fees ---------- */
const cleanName = (v, max) => String(v ?? '').replace(/[\u0000-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩؜﻿<>"]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
/** Suppliers a new shop starts with. barMm 0 = the length differs every time and is typed in at delivery. */
export const DEFAULT_SUPPLIERS = Object.freeze([{ id: 'punjab', name: 'PUNJAB', barMm: 0 }, { id: 'imported', name: 'IMPORTED', barMm: 6000 }, { id: 'kolkata', name: 'KOLKATA', barMm: 3000 }]);
/** The shop's supplier list, safe to draw. Not set yet → the three defaults. */
export function cleanSuppliers(list) {
  if (!Array.isArray(list)) return DEFAULT_SUPPLIERS.map(s => ({ ...s }));
  const out = [], seen = new Set();
  for (const s of list.slice(0, 20)) {
    if (!s || typeof s !== 'object') continue;
    const name = cleanName(s.name, 30), mm = Number(s.barMm);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ id: typeof s.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(s.id) ? s.id : 's' + (out.length + 1), name, barMm: Number.isFinite(mm) && mm > 0 && mm <= 100000 ? Math.round(mm * 10) / 10 : 0 });
  }
  return out;
}
/** A delivery typed as a total length: how many pieces of `eachMm` it holds, and what does not divide evenly. */
export function piecesFromTotal(totalMm, eachMm) {
  if (!(totalMm > 0) || !(eachMm > 0)) return { pieces: 0, extraMm: 0 };
  const n = Math.floor(totalMm / eachMm + 1e-9);
  return { pieces: n, extraMm: Math.max(0, Math.round((totalMm - n * eachMm) * 10) / 10) };
}
/**
 * The shop's shape list: every built-in shape (the shop can rename or hide it) followed by the shop's own shapes.
 * A shop's own shape has a name and is calculated like one built-in shape (`base`), e.g. "Bright bar" like a round bar.
 */
export function cleanShapes(list) {
  const mine = Array.isArray(list) ? list.filter(s => s && typeof s === 'object').slice(0, 60) : [];
  const out = Object.entries(SHAPES).map(([id, sh]) => { const o = mine.find(s => s.id === id); return { id, base: id, label: (o && cleanName(o.label, 24)) || sh.label, off: !!(o && o.off === true) }; });
  const seen = new Set(out.map(s => s.id));
  for (const s of mine) {
    if (typeof s.id !== 'string' || !/^c[0-9A-Fa-f-]{2,40}$/.test(s.id) || seen.has(s.id) || typeof s.base !== 'string' || !Object.hasOwn(SHAPES, s.base)) continue;
    const label = cleanName(s.label, 24); if (!label || out.length >= 28) continue;
    seen.add(s.id); out.push({ id: s.id, base: s.base, label, off: s.off === true });
  }
  return out;
}

/** The two extra fees a bill can carry. Names, usual amounts and GST rates are the shop's own. */
export const FEE_KEYS = Object.freeze(['loading', 'cartage']);
const FEE_NAME = { loading: 'Loading fee', cartage: 'Cartage fee' };
export function cleanFees(fees, rates) {
  return FEE_KEYS.map(key => {
    const f = fees && typeof fees === 'object' && !Array.isArray(fees) && Object.hasOwn(fees, key) && fees[key] && typeof fees[key] === 'object' ? fees[key] : {};
    return { key, name: cleanName(f.name, 24) || FEE_NAME[key], feePaise: Number.isSafeInteger(f.feePaise) && f.feePaise >= 0 && f.feePaise <= 1e9 ? f.feePaise : 0, gstRate: typeof f.gstRate === 'number' && rates.includes(f.gstRate) ? f.gstRate : 18 };
  });
}

export const BAR_CODE_RE = /^B\d{0,2}-\d{4,7}$/i;
