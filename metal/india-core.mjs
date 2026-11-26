// India POS — pure business logic (no DOM, no storage). All money is integer paise.
// Rules referenced here are summarised in COMPLIANCE.md. Item-level GST rates and HSN
// codes must be confirmed by the shop's CA against current CBIC notifications.

export const TZ = 'Asia/Kolkata';

// GST 2.0 (effective 22 Sep 2025): 0, 5, 18 and 40 % slabs, plus special rates for
// precious metals/stones. 12 % and 28 % were removed.
export const GST_RATES = [0, 0.25, 1.5, 3, 5, 18, 40];

// Unit Quantity Codes accepted by the GST portal (subset useful for shops).
export const UQC = {
  PCS: 'Pieces', NOS: 'Numbers', KGS: 'Kilograms', GMS: 'Grams', LTR: 'Litres',
  MLT: 'Millilitres', PAC: 'Packs', BOX: 'Box', DOZ: 'Dozens', MTR: 'Metres',
  BTL: 'Bottles', SET: 'Sets', PRS: 'Pairs', BAG: 'Bags', OTH: 'Others'
};
// Units sold loose by weight/volume (decimal quantity allowed, metric only — Legal Metrology).
export const LOOSE_UNITS = new Set(['KGS', 'GMS', 'LTR', 'MLT', 'MTR']);

// GST state codes. Union territories without a legislature charge UTGST instead of SGST.
export const STATES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
  '97': 'Other Territory'
};
const UTGST_STATES = new Set(['04', '26', '31', '35', '38']);
export function stateTaxLabel(code) { return UTGST_STATES.has(code) ? 'UTGST' : 'SGST'; }
export function stateLabel(code) { return code && STATES[code] ? `${code}-${STATES[code]}` : ''; }

// Legal limits (₹ in paise)
export const LIMITS = {
  CASH_269ST: 2_00_000_00,        // Income-tax s.269ST: no cash receipt of ₹2,00,000 or more
  PAN_114B: 2_00_000_00,          // Rule 114B: PAN for sale of goods/services above ₹2,00,000
  B2C_DETAILS_RULE46: 50_000_00,  // Rule 46: unregistered buyer, value ≥ ₹50,000 → name, address, state
  B2CL_INTERSTATE: 1_00_000_00,   // GSTR-1 B2CL: inter-state B2C invoice above ₹1,00,000
  EINVOICE_TURNOVER: 5_00_00_000_00 // e-invoice (IRN) for B2B when turnover > ₹5 crore
};

export const REGIMES = {
  regular: { label: 'Regular GST', doc: 'TAX INVOICE', chargesTax: true },
  composition: { label: 'Composition scheme', doc: 'BILL OF SUPPLY', chargesTax: false },
  unregistered: { label: 'Not registered under GST', doc: 'BILL / CASH MEMO', chargesTax: false }
};
export const COMPOSITION_DECLARATION = 'Composition taxable person, not eligible to collect tax on supplies';

/* ---------------- money & formatting ---------------- */
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
/** Removes invisible control and text-direction characters (e.g. U+202E) that could make a receipt read differently than it is. */
export function cleanText(v) { return String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C\uFEFF]/g, ''); }
export function money(paise) { return inr.format((paise || 0) / 100); }
export function plain(paise) { return ((paise || 0) / 100).toFixed(2); }
export function parsePaise(value) {
  const s = String(value ?? '').replace(/[₹,\s]/g, '');
  if (!/^\d{0,9}(\.\d{0,2})?$/.test(s) || s === '' || s === '.') return null;
  const [r, p = ''] = s.split('.');
  return Number(r || 0) * 100 + Number((p + '00').slice(0, 2));
}
export function parseQty(value, unit) {
  const n = Number(String(value ?? '').trim());
  if (!Number.isFinite(n) || n <= 0 || n > 99999) return null;
  if (!LOOSE_UNITS.has(unit) && !Number.isInteger(n)) return null;
  return Math.round(n * 1000) / 1000;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function twoDigits(n) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`; }
function threeDigits(n) {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? twoDigits(r) : ''].filter(Boolean).join(' ');
}
function rupeeWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${rupeeWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  return parts.join(' ');
}
export function amountInWords(paise) {
  const r = Math.floor(Math.abs(paise) / 100), p = Math.abs(paise) % 100;
  return `Rupees ${rupeeWords(r)}${p ? ` and ${twoDigits(p)} Paise` : ''} Only`;
}

/* ---------------- dates / financial year (IST) ---------------- */
function istParts(at) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const [y, m, d] = f.format(new Date(at)).split('-').map(Number);
  return { y, m, d };
}
export function istDate(at = Date.now()) {
  const { y, m, d } = istParts(at);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function financialYear(at = Date.now()) {
  const { y, m } = istParts(at);
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function gstDate(at) { const { y, m, d } = istParts(at); return `${String(d).padStart(2, '0')}-${MON[m - 1]}-${y}`; }
export function displayDateTime(at) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at));
}

/* ---------------- invoice numbering (Rule 46(b)) ---------------- */
// Consecutive serial number, unique per financial year, ≤16 chars, only A-Z 0-9 - /.
export function cleanPrefix(prefix) { return String(prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); }
export function nextDocNumber(counters, kind, prefix, at = Date.now()) {
  const fy = financialYear(at);
  const key = `${kind}:${fy}`;
  const seq = (counters[key] || 0) + 1;
  const p = cleanPrefix(prefix) || (kind === 'CN' ? 'CN' : 'INV');
  const number = `${p}/${fy}/${String(seq).padStart(16 - p.length - 7, '0')}`;
  return { number, key, seq, fy, counters: { ...counters, [key]: seq } };
}
export function validDocNumber(n) { return typeof n === 'string' && n.length >= 1 && n.length <= 16 && /^[A-Z0-9/-]+$/.test(n); }

/* ---------------- identifiers ---------------- */
const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function gstinCheckChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GST_CHARS.indexOf(first14[i]);
    const prod = v * (i % 2 ? 2 : 1);
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36];
}
export function validateGstin(raw) {
  const g = String(raw || '').trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return { ok: false, error: 'GSTIN must be 15 characters like 24ABCDE1234F1Z5' };
  if (!STATES[g.slice(0, 2)]) return { ok: false, error: 'GSTIN starts with an unknown state code' };
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return { ok: false, error: 'GSTIN check digit does not match — please re-check' };
  return { ok: true, gstin: g, stateCode: g.slice(0, 2), pan: g.slice(2, 12) };
}
export function validatePan(raw) { const p = String(raw || '').trim().toUpperCase(); return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(p) ? p : null; }
export function validateVpa(raw) { const v = String(raw || '').trim(); return /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.]{1,64}$/.test(v) ? v : null; }
export function validatePhone(raw) { const d = String(raw || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''); return /^[6-9]\d{9}$/.test(d) ? d : null; }
export function hsnDigitsRequired(settings, isB2B) {
  if (settings.regime !== 'regular') return 0;
  if (settings.turnoverAbove5Cr) return 6;
  return isB2B ? 4 : 0;
}
export function validHsn(hsn) { return /^\d{4}$|^\d{6}$|^\d{8}$/.test(String(hsn || '')); }

/* ---------------- bill calculation ---------------- */
function allocate(total, weights) {
  // Split `total` paise across weights proportionally; remainder goes to largest weights.
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!total || !sum) return weights.map(() => 0);
  const raw = weights.map(w => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0; k++, rest--) out[order[k % order.length][1]]++;
  return out;
}

/**
 * @param lines   [{name, hsn, unit, qty, pricePaise, mrpPaise, gstRate, cessRate, priceIncludesTax, discountPaise}]
 * @param ctx     {regime, shopState, placeOfSupply, billDiscountPaise}
 */
export function computeBill(lines, ctx) {
  const chargesTax = REGIMES[ctx.regime]?.chargesTax === true;
  const pos = ctx.placeOfSupply || ctx.shopState;
  const interState = !!pos && pos !== ctx.shopState;
  const gross = lines.map(l => Math.round(l.pricePaise * l.qty));
  const afterLine = lines.map((l, i) => Math.max(0, gross[i] - Math.min(gross[i], l.discountPaise || 0)));
  const billDisc = Math.min(ctx.billDiscountPaise || 0, afterLine.reduce((a, b) => a + b, 0));
  const share = allocate(billDisc, afterLine);
  const out = lines.map((l, i) => {
    const net = afterLine[i] - share[i];
    const rate = chargesTax ? Number(l.gstRate || 0) : 0;
    const cessRate = chargesTax ? Number(l.cessRate || 0) : 0;
    let taxable, gst, cess, total;
    if (!chargesTax) { taxable = net; gst = 0; cess = 0; total = net; }
    else if (l.priceIncludesTax !== false) {
      taxable = Math.round((net * 100) / (100 + rate + cessRate));
      cess = Math.round((taxable * cessRate) / 100);
      gst = net - taxable - cess; total = net;
    } else {
      taxable = net; gst = Math.round((taxable * rate) / 100); cess = Math.round((taxable * cessRate) / 100);
      total = net + gst + cess;
    }
    const cgst = interState ? 0 : Math.ceil(gst / 2), sgst = interState ? 0 : gst - cgst, igst = interState ? gst : 0;
    return { ...l, gross: gross[i], discount: gross[i] - net, taxable, gstRate: rate, cessRate, cgst, sgst, igst, cess, total };
  });
  const sum = k => out.reduce((a, l) => a + l[k], 0);
  const subtotal = sum('total');
  const rounded = Math.round(subtotal / 100) * 100;
  const rateMap = new Map();
  for (const l of out) {
    const r = rateMap.get(l.gstRate) || { rate: l.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 };
    for (const k of ['taxable', 'cgst', 'sgst', 'igst', 'cess']) r[k] += l[k];
    rateMap.set(l.gstRate, r);
  }
  return {
    lines: out, interState, placeOfSupply: pos, chargesTax,
    gross: sum('gross'), discount: sum('discount'), taxable: sum('taxable'),
    cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), cess: sum('cess'),
    subtotal, roundOff: rounded - subtotal, grandTotal: rounded,
    byRate: [...rateMap.values()].sort((a, b) => a.rate - b.rate),
    stateTaxLabel: stateTaxLabel(ctx.shopState)
  };
}

/* ---------------- offers (automatic promotions on one item) ----------------
 * Stored on the product as promo = { kind, buyQty, getQty, savePaise, from, to, off }.
 *   bxgy        Buy X, get Y of the same item free   (e.g. buy 2 get 1)
 *   buy_n_save  Buy N, save ₹ on every complete set  (e.g. buy 2 save ₹10)
 *   price_off   ₹ off each unit (a sale price), works for loose items too
 * The saving is a discount shown on the invoice at the time of sale, so it lowers the taxable value
 * (CGST Act s.15(3)(a)); free units in "buy X get Y" are treated the same way (CBIC circular 92/11/2019).
 * An offer never applies to a line whose price was changed by hand.
 */
export const PROMO_KINDS = { bxgy: 'Buy X get Y free', buy_n_save: 'Buy N, save ₹ per set', price_off: '₹ off each (sale price)' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDay = d => typeof d === 'string' && DATE_RE.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;

/** Problems with an offer for this product ([] = fine). */
export function promoErrors(promo, product = {}) {
  const e = [];
  if (!promo || typeof promo !== 'object') return ['No offer.'];
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (typeof promo.kind !== 'string' || !Object.hasOwn(PROMO_KINDS, promo.kind)) e.push('Choose an offer type.');
  if (promo.kind !== 'price_off' && LOOSE_UNITS.has(product.unit)) e.push('Buy-X offers are for items sold by count, not by weight.');
  if (promo.kind === 'bxgy' && !(int(promo.buyQty, 1, 20) && int(promo.getQty, 1, 20))) e.push('Buy and free quantities must be 1–20.');
  if (promo.kind === 'buy_n_save') {
    if (!int(promo.buyQty, 2, 50)) e.push('“Buy” quantity must be 2–50.');
    if (!int(promo.savePaise, 1, 1e8)) e.push('Enter the saving per set.');
    else if (Number.isInteger(product.pricePaise) && int(promo.buyQty, 2, 50) && promo.savePaise >= product.pricePaise * promo.buyQty) e.push('Saving must be less than the price of the set.');
  }
  if (promo.kind === 'price_off') {
    if (!int(promo.savePaise, 1, 1e8)) e.push('Enter the amount off each.');
    else if (Number.isInteger(product.pricePaise) && promo.savePaise >= product.pricePaise) e.push('Amount off must be less than the price.');
  }
  if (promo.from && !validDay(promo.from)) e.push('Start date is not valid.');
  if (promo.to && !validDay(promo.to)) e.push('End date is not valid.');
  if (promo.from && promo.to && promo.from > promo.to) e.push('End date is before the start date.');
  return e;
}
/** 'off' | 'scheduled' | 'active' | 'expired' | 'invalid' on a given IST day (YYYY-MM-DD). */
export function promoStatus(promo, day = istDate(), product) {
  if (!promo || promo.off) return 'off';
  if (promoErrors(promo, product).length) return 'invalid';
  if (promo.from && day < promo.from) return 'scheduled';
  if (promo.to && day > promo.to) return 'expired';
  return 'active';
}
export function promoLabel(promo) {
  if (!promo) return '';
  const r = p => '₹' + ((p || 0) / 100).toFixed(2).replace(/\.00$/, '');
  if (promo.kind === 'bxgy') return `Buy ${promo.buyQty} get ${promo.getQty} free`;
  if (promo.kind === 'buy_n_save') return `Buy ${promo.buyQty}, save ${r(promo.savePaise)}`;
  if (promo.kind === 'price_off') return `${r(promo.savePaise)} off each`;
  return '';
}
/** Paise saved on one line (qty × price) under an active offer. */
export function promoSaving(promo, { qty, pricePaise, unit }) {
  const gross = Math.round(pricePaise * qty);
  if (!promo || !(qty > 0) || !(pricePaise > 0) || !Number.isSafeInteger(gross)) return 0;
  let off = 0;
  if (promo.kind === 'bxgy' && Number.isInteger(qty)) off = Math.floor(qty / (promo.buyQty + promo.getQty)) * promo.getQty * pricePaise;
  else if (promo.kind === 'buy_n_save' && Number.isInteger(qty)) off = Math.floor(qty / promo.buyQty) * promo.savePaise;
  else if (promo.kind === 'price_off') off = Math.round(qty * promo.savePaise);
  return Math.max(0, Math.min(gross, off));
}
/**
 * Lines ready for computeBill: adds each item's active offer to the line discount.
 * Same item on several lines (no hand-changed price) is counted together, and the saving is split back over those lines.
 * Returns new line objects with promoPaise / promoLabel; the cart itself is not changed.
 */
export function applyPromotions(lines, products, day = istDate()) {
  const byId = new Map((products || []).map(p => [p.id, p]));
  const out = lines.map(l => ({ ...l, promoPaise: 0, promoLabel: '' }));
  const groups = new Map();
  out.forEach((l, i) => {
    const pr = l.productId && byId.get(l.productId);
    if (!pr || promoStatus(pr.promo, day, pr) !== 'active' || l.pricePaise !== pr.pricePaise) return;
    (groups.get(pr.id) || groups.set(pr.id, []).get(pr.id)).push(i);
  });
  for (const [pid, idx] of groups) {
    const pr = byId.get(pid), qty = idx.reduce((a, i) => a + out[i].qty, 0);
    const saving = promoSaving(pr.promo, { qty, pricePaise: pr.pricePaise, unit: pr.unit });
    if (!Number.isSafeInteger(saving) || saving <= 0) continue;
    const share = allocate(saving, idx.map(i => Math.round(out[i].pricePaise * out[i].qty)));
    idx.forEach((i, k) => {
      const l = out[i], gross = Math.round(l.pricePaise * l.qty);
      const promoPaise = Math.min(share[k], Math.max(0, gross - (l.discountPaise || 0)));
      Object.assign(l, { promoPaise, promoLabel: promoLabel(pr.promo), discountPaise: (l.discountPaise || 0) + promoPaise });
    });
  }
  return out;
}

/* ---------------- departments ----------------
 * A department groups items on the register and gives new items (and open-price sales) a default GST rate and HSN.
 * Each item keeps its own GST rate: GST follows the item's HSN, not the shelf it sits on.
 */
export function departmentErrors(d, all = []) {
  const e = [];
  const name = String(d?.name || '').trim();
  if (!name) e.push('Enter a department name.');
  else if (name.length > 30) e.push('Name must be 30 characters or less.');
  else if ((Array.isArray(all) ? all : []).some(x => x && x.id !== d.id && String(x.name ?? '').trim().toLowerCase() === name.toLowerCase())) e.push('Another department has this name.');
  if (!GST_RATES.includes(Number(d?.gstRate))) e.push('Choose a GST rate.');
  if (d?.hsn && !validHsn(d.hsn)) e.push('HSN code must be 4, 6 or 8 digits.');
  return e;
}
/** Departments for the register: saved ones first (in order), then any category used by items but not saved yet. */
export function departmentList(saved = [], products = []) {
  // saved may come from a restored backup: keep only well-formed entries, never crash on odd types
  const list = (Array.isArray(saved) ? saved : []).filter(d => d && typeof d === 'object' && typeof d.name === 'string' && d.name.trim() && !departmentErrors({ ...d, hsn: d.hsn || '' }).length)
    .map((d, i) => ({ id: String(d.id || 'd' + i), name: d.name.trim(), gstRate: Number(d.gstRate), hsn: typeof d.hsn === 'string' ? d.hsn : '', order: Number.isFinite(d.order) ? d.order : i }));
  const names = new Set(list.map(d => d.name.toLowerCase()));
  for (const p of Array.isArray(products) ? products : []) {
    if (!p || typeof p !== 'object') continue;
    const c = (typeof p.category === 'string' && p.category.trim()) ? p.category.trim().slice(0, 30) : 'General';
    if (p.active !== false && !names.has(c.toLowerCase())) { names.add(c.toLowerCase()); list.push({ id: 'cat:' + c, name: c, gstRate: GST_RATES.includes(Number(p.gstRate)) ? Number(p.gstRate) : 5, hsn: '', implicit: true, order: 1e6 + list.length }); }
  }
  return list.sort((a, b) => a.order - b.order);
}

/** Price shown to the customer including tax (for MRP comparison). */
export function inclusiveUnitPrice(line, regime) {
  if (REGIMES[regime]?.chargesTax !== true || line.priceIncludesTax !== false) return line.pricePaise;
  return Math.round(line.pricePaise * (1 + (Number(line.gstRate || 0) + Number(line.cessRate || 0)) / 100));
}

/* ---------------- legal checks before completing a sale ---------------- */
export function checkoutIssues({ bill, settings, customer = {}, payments = [] }) {
  const blocking = [], warnings = [];
  const isB2B = !!customer.gstin && settings.regime === 'regular';
  const regime = settings.regime;
  if (!bill.lines.length) blocking.push('Add at least one item.');
  for (const l of bill.lines) {
    if (l.mrpPaise && inclusiveUnitPrice(l, regime) > l.mrpPaise)
      blocking.push(`${l.name}: price is above MRP ${money(l.mrpPaise)} — not allowed (Legal Metrology Act).`);
    if (regime === 'regular' && !GST_RATES.includes(Number(l.gstRate)))
      blocking.push(`${l.name}: choose a valid GST rate.`);
    const need = hsnDigitsRequired(settings, isB2B);
    const hsnLen = String(l.hsn || '').length;
    if (need && (!validHsn(l.hsn) || hsnLen < need))
      blocking.push(`${l.name}: HSN code of at least ${need} digits is required on this invoice (Rule 46).`);
  }
  if (bill.interState && regime === 'composition')
    blocking.push('Composition dealers cannot make inter-state sales of goods. Set place of supply to your state.');
  if (bill.interState && regime === 'unregistered')
    blocking.push('Inter-state taxable sales need GST registration. Set place of supply to your state.');
  const cash = payments.filter(p => p.mode === 'cash').reduce((a, p) => a + p.amountPaise, 0);
  if (cash >= LIMITS.CASH_269ST)
    blocking.push(`Cash of ₹2,00,000 or more from one customer is not allowed (Income-tax s.269ST). Take UPI/card for part of it.`);
  if (bill.grandTotal > LIMITS.PAN_114B && !validatePan(customer.pan) && !validateGstin(customer.gstin).ok)
    blocking.push('Bill above ₹2,00,000 — enter the customer\'s PAN (Income-tax Rule 114B).');
  if (regime === 'regular' && !customer.gstin && bill.taxable >= LIMITS.B2C_DETAILS_RULE46 &&
      !(customer.name && customer.address && customer.stateCode))
    blocking.push('Value ₹50,000 or more to an unregistered buyer — enter customer name, address and state (Rule 46).');
  if (customer.gstin) {
    const g = validateGstin(customer.gstin);
    if (!g.ok) blocking.push(`Customer GSTIN: ${g.error}.`);
    else if (regime === 'regular' && !customer.name) blocking.push('Enter the buyer\'s legal name for a B2B invoice.');
    if (regime !== 'regular') warnings.push('You are not a regular GST dealer, so the buyer cannot claim input tax credit on this bill.');
  }
  if (isB2B && settings.turnoverAbove5Cr)
    warnings.push('Turnover above ₹5 crore: this B2B invoice needs an IRN from the e-invoice portal (IRP) before it is valid.');
  if (payments.some(p => p.mode === 'udhaar') && !customer.id)
    blocking.push('Select a customer to give udhaar (credit).');
  return { blocking: [...new Set(blocking)], warnings };
}

/* ---------------- payments ---------------- */
export const PAY_MODES = { cash: 'Cash', upi: 'UPI', card: 'Card', udhaar: 'Udhaar (credit)' };
export function paymentState(grandTotal, payments) {
  const paid = payments.reduce((a, p) => a + p.amountPaise, 0);
  const cash = payments.filter(p => p.mode === 'cash').reduce((a, p) => a + p.amountPaise, 0);
  const due = Math.max(0, grandTotal - paid);
  // change can only come out of cash tendered
  const change = Math.min(Math.max(0, paid - grandTotal), cash);
  return { paid, due, change, over: paid - grandTotal - change };
}
export const CASH_NOTES = [1000, 2000, 5000, 10000, 20000, 50000];

/* ---------------- UPI (NPCI linking spec) ---------------- */
export function upiUri({ vpa, payeeName, amountPaise, note, ref, merchantCode, lockAmount = false }) {
  const v = validateVpa(vpa);
  if (!v) throw new Error('Invalid UPI ID');
  const q = [['pa', v], ['pn', cleanText(payeeName).replace(/[\r\n\t]/g, ' ').slice(0, 50)]];
  if (merchantCode) q.push(['mc', String(merchantCode)]);
  if (ref && merchantCode) q.push(['tr', String(ref).replace(/[^A-Za-z0-9-]/g, '').slice(0, 35)]);
  if (amountPaise) q.push(['am', plain(amountPaise)]);
  // mam = minimum amount; equal to am, UPI apps won't let the customer pay a different amount
  if (amountPaise && lockAmount) q.push(['mam', plain(amountPaise)]);
  q.push(['cu', 'INR']);
  if (note) q.push(['tn', cleanText(note).replace(/[\r\n\t]/g, ' ').slice(0, 50)]);
  // '@' stays literal in the VPA: some UPI apps reject %40 inside pa.
  return 'upi://pay?' + q.map(([k, val]) => `${k}=${encodeURIComponent(val).replace(/%40/g, '@')}`).join('&');
}
export function validUtr(raw) { return /^\d{12}$/.test(String(raw || '').trim()); }

/* ---------------- returns / credit notes (s.34) ---------------- */
export function returnableQty(sale, creditNotes) {
  const used = {};
  for (const cn of creditNotes.filter(c => c.invoiceId === sale.id && c.status !== 'cancelled'))
    for (const l of cn.lines) used[l.lineIndex] = (used[l.lineIndex] || 0) + l.qty;
  return sale.bill.lines.map((l, i) => Math.max(0, Math.round((l.qty - (used[i] || 0)) * 1000) / 1000));
}
export function buildCreditNoteLines(sale, picks) {
  // picks: {lineIndex: qty}. Values are pro-rated from the original invoice line, so tax reverses exactly.
  const lines = [];
  for (const [idx, qty] of Object.entries(picks)) {
    const l = sale.bill.lines[idx]; if (!l || !qty) continue;
    const f = qty / l.qty, pr = k => Math.round(l[k] * f);
    lines.push({ lineIndex: Number(idx), name: l.name, hsn: l.hsn, unit: l.unit, qty, gstRate: l.gstRate, productId: l.productId,
      taxable: pr('taxable'), cgst: pr('cgst'), sgst: pr('sgst'), igst: pr('igst'), cess: pr('cess'), total: pr('total') });
  }
  const sum = k => lines.reduce((a, l) => a + l[k], 0);
  const subtotal = sum('total'), rounded = Math.round(subtotal / 100) * 100;
  return { lines, taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), cess: sum('cess'),
    subtotal, roundOff: rounded - subtotal, grandTotal: rounded };
}

/* ---------------- khata (customer credit ledger) ---------------- */
export function khataBalance(entries, customerId) {
  return entries.filter(e => e.customerId === customerId).reduce((a, e) => a + e.amountPaise, 0);
}

/* ---------------- reports ---------------- */
export function inRange(at, from, to) { const d = istDate(at); return d >= from && d <= to; }
export function salesSummary(sales, creditNotes = []) {
  const live = sales.filter(s => s.status !== 'cancelled');
  const modes = {}; let total = 0, taxable = 0, cgst = 0, sgst = 0, igst = 0, cess = 0;
  for (const s of live) {
    total += s.bill.grandTotal; taxable += s.bill.taxable; cgst += s.bill.cgst; sgst += s.bill.sgst; igst += s.bill.igst; cess += s.bill.cess;
    for (const p of s.payments) modes[p.mode] = (modes[p.mode] || 0) + p.amountPaise;
    if (s.change) modes.cash = (modes.cash || 0) - s.change;
  }
  const cns = creditNotes.filter(c => c.status !== 'cancelled');
  const refunds = cns.reduce((a, c) => a + c.totals.grandTotal, 0);
  return { count: live.length, cancelled: sales.length - live.length, total, taxable, cgst, sgst, igst, cess, modes,
    refunds, net: total - refunds, creditNotes: cns.length };
}
export function itemSummary(sales) {
  const m = new Map();
  for (const s of sales.filter(x => x.status !== 'cancelled')) for (const l of s.bill.lines) {
    const k = l.productId || l.name; const r = m.get(k) || { name: l.name, unit: l.unit, qty: 0, total: 0 };
    r.qty = Math.round((r.qty + l.qty) * 1000) / 1000; r.total += l.total; m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

/* ---------------- GSTR-1 ready exports (CSV, GST offline tool column names) ---------------- */
// Text starting with = + - @ (or a tab/CR) would run as a formula when the CSV is opened in Excel/Sheets: prefix it with '
function csvCell(v) {
  let s = cleanText(v);
  if (typeof v !== 'number' && /^\s*[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(header, rows) { return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n'; }

export function gstr1(sales, creditNotes, settings) {
  const live = sales.filter(s => s.status !== 'cancelled' && s.bill.chargesTax);
  const shop = settings.stateCode;
  const b2b = [], b2cl = [], b2csMap = new Map();
  const isB2B = s => !!s.customer?.gstin;
  for (const s of live) {
    const pos = stateLabel(s.bill.placeOfSupply);
    for (const r of s.bill.byRate) {
      if (isB2B(s)) b2b.push([s.customer.gstin, s.customer.name || '', s.number, gstDate(s.at), plain(s.bill.grandTotal), pos, 'N', '', 'Regular B2B', '', r.rate, plain(r.taxable), plain(r.cess)]);
      else if (s.bill.interState && s.bill.grandTotal > LIMITS.B2CL_INTERSTATE) b2cl.push([s.number, gstDate(s.at), plain(s.bill.grandTotal), pos, '', r.rate, plain(r.taxable), plain(r.cess), '']);
      else {
        const k = `${s.bill.placeOfSupply}|${r.rate}`;
        const e = b2csMap.get(k) || { pos, rate: r.rate, taxable: 0, cess: 0 };
        e.taxable += r.taxable; e.cess += r.cess; b2csMap.set(k, e);
      }
    }
  }
  const liveCn = creditNotes.filter(c => c.status !== 'cancelled');
  const cdnr = [];
  for (const c of liveCn) {
    const sale = sales.find(s => s.id === c.invoiceId); if (!sale?.bill.chargesTax) continue;
    const byRate = new Map();
    for (const l of c.totals.lines) { const r = byRate.get(l.gstRate) || { taxable: 0, cess: 0 }; r.taxable += l.taxable; r.cess += l.cess; byRate.set(l.gstRate, r); }
    for (const [rate, r] of byRate) {
      if (sale.customer?.gstin) cdnr.push([sale.customer.gstin, sale.customer.name || '', c.number, gstDate(c.at), 'C', stateLabel(sale.bill.placeOfSupply), 'N', 'Regular B2B', plain(c.totals.grandTotal), '', rate, plain(r.taxable), plain(r.cess)]);
      else { // unregistered returns reduce B2CS for the same place of supply and rate
        const k = `${sale.bill.placeOfSupply}|${rate}`;
        const e = b2csMap.get(k) || { pos: stateLabel(sale.bill.placeOfSupply), rate, taxable: 0, cess: 0 };
        e.taxable -= r.taxable; e.cess -= r.cess; b2csMap.set(k, e);
      }
    }
  }
  const b2cs = [...b2csMap.values()].map(e => ['OE', e.pos, '', e.rate, plain(e.taxable), plain(e.cess), '']);

  const hsnTable = (filter) => {
    const m = new Map();
    const add = (l, sign) => {
      const k = `${l.hsn || ''}|${l.unit}|${l.gstRate}`;
      const e = m.get(k) || { hsn: l.hsn || '', desc: l.name, uqc: l.unit, qty: 0, value: 0, rate: l.gstRate, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
      e.qty = Math.round((e.qty + sign * l.qty) * 1000) / 1000;
      for (const [a, b] of [['value', 'total'], ['taxable', 'taxable'], ['igst', 'igst'], ['cgst', 'cgst'], ['sgst', 'sgst'], ['cess', 'cess']]) e[a] += sign * l[b];
      m.set(k, e);
    };
    for (const s of live.filter(filter)) for (const l of s.bill.lines) add(l, 1);
    for (const c of liveCn) { const s = sales.find(x => x.id === c.invoiceId); if (s && s.bill.chargesTax && filter(s)) for (const l of c.totals.lines) add(l, -1); }
    return [...m.values()].map(e => [e.hsn, e.desc, `${e.uqc}-${(UQC[e.uqc] || 'OTHERS').toUpperCase()}`, e.qty, plain(e.value), e.rate, plain(e.taxable), plain(e.igst), plain(e.cgst), plain(e.sgst), plain(e.cess)]);
  };
  const docRange = (list, label) => {
    if (!list.length) return [];
    const byFy = new Map();
    for (const d of list) { const fy = d.number.split('/')[1]; (byFy.get(fy) || byFy.set(fy, []).get(fy)).push(d); }
    return [...byFy.values()].map(ds => {
      ds.sort((a, b) => a.seq - b.seq);
      return [label, ds[0].number, ds[ds.length - 1].number, ds.length, ds.filter(d => d.status === 'cancelled').length];
    });
  };
  const H = {
    b2b: ['GSTIN/UIN of Recipient', 'Receiver Name', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Reverse Charge', 'Applicable % of Tax Rate', 'Invoice Type', 'E-Commerce GSTIN', 'Rate', 'Taxable Value', 'Cess Amount'],
    b2cl: ['Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'],
    b2cs: ['Type', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'],
    cdnr: ['GSTIN/UIN of Recipient', 'Receiver Name', 'Note Number', 'Note Date', 'Note Type', 'Place Of Supply', 'Reverse Charge', 'Note Supply Type', 'Note Value', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount'],
    hsn: ['HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Rate', 'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount', 'State/UT Tax Amount', 'Cess Amount'],
    docs: ['Nature of Document', 'Sr. No. From', 'Sr. No. To', 'Total Number', 'Cancelled']
  };
  return {
    b2b: toCsv(H.b2b, b2b), b2cl: toCsv(H.b2cl, b2cl), b2cs: toCsv(H.b2cs, b2cs), cdnr: toCsv(H.cdnr, cdnr),
    hsn_b2b: toCsv(H.hsn, hsnTable(isB2B)), hsn_b2c: toCsv(H.hsn, hsnTable(s => !isB2B(s))),
    docs: toCsv(H.docs, [...docRange(sales, 'Invoices for outward supply'), ...docRange(creditNotes, 'Credit Note')]),
    counts: { b2b: b2b.length, b2cl: b2cl.length, b2cs: b2cs.length, cdnr: cdnr.length },
    shopState: shop
  };
}

/* ---------------- product CSV import ---------------- */
export const PRODUCT_CSV_HEADER = ['name', 'local_name', 'barcode', 'hsn', 'gst_rate', 'cess_rate', 'mrp', 'price', 'price_includes_tax', 'unit', 'stock', 'low_stock', 'category'];
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
export function productFromRow(obj) {
  const errors = [];
  const name = String(obj.name || '').trim(); if (!name) errors.push('name missing');
  const unit = String(obj.unit || 'PCS').trim().toUpperCase(); if (!UQC[unit]) errors.push(`unknown unit ${unit}`);
  const gstRate = Number(obj.gst_rate || 0); if (!GST_RATES.includes(gstRate)) errors.push(`GST rate ${obj.gst_rate} is not a current slab`);
  const price = parsePaise(obj.price); if (price == null) errors.push('price invalid');
  const mrp = obj.mrp ? parsePaise(obj.mrp) : null; if (obj.mrp && mrp == null) errors.push('MRP invalid');
  const hsn = String(obj.hsn || '').trim(); if (hsn && !validHsn(hsn)) errors.push('HSN must be 4, 6 or 8 digits');
  const num = (v, label, max) => { const n = Number(String(v ?? '').trim() || 0); if (!Number.isFinite(n) || n < 0 || n > max) { errors.push(`${label} invalid`); return 0; } return n; };
  const txt = (v, max) => String(v ?? '').trim().slice(0, max).replace(/</g, '‹').replace(/>/g, '›').replace(/"/g, '″');
  if (name.length > 80) errors.push('name longer than 80 characters');
  const p = { name: txt(name, 80), localName: txt(obj.local_name, 60), barcode: txt(obj.barcode, 30), hsn, gstRate,
    cessRate: num(obj.cess_rate, 'cess rate', 100), mrpPaise: mrp, pricePaise: price, priceIncludesTax: !/^(n|no|false|0)$/i.test(String(obj.price_includes_tax || 'yes')),
    unit, stock: num(obj.stock, 'stock', 1e9), lowStock: num(obj.low_stock, 'low stock', 1e9), category: txt(obj.category, 40) || 'General' };
  if (p.mrpPaise && p.pricePaise != null && inclusiveUnitPrice(p, 'regular') > p.mrpPaise) errors.push('price above MRP');
  return { product: p, errors };
}
