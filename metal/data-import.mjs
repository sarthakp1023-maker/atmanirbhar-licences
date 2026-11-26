// Bring a shop's existing data in from accounting software such as Miracle: items (with prices, HSN, GST, stock)
// and parties (customers). Works from a file the software exports — Excel (.xlsx) or CSV / text.
// Everything here treats the file as untrusted: sizes are capped, text is cleaned, numbers are checked.

const MAX_FILE = 15 * 1024 * 1024, MAX_UNZIPPED = 60 * 1024 * 1024, MAX_ROWS = 20000, MAX_COLS = 60, MAX_CELL = 300;
const cleanCell = v => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩﻿]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_CELL);

/* ---------------- CSV / tab / semicolon text ---------------- */
export function parseDelimited(text) {
  const src = String(text ?? '').slice(0, MAX_FILE);
  const head = src.slice(0, 4000), count = ch => head.split(ch).length - 1;
  const delim = [['\t', count('\t')], [';', count(';')], ['|', count('|')], [',', count(',')]].sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"' && cell === '') { q = true; continue; }
    if (c === delim) { if (row.length < MAX_COLS) row.push(cleanCell(cell)); cell = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      if (row.length < MAX_COLS) row.push(cleanCell(cell)); cell = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = []; if (rows.length >= MAX_ROWS) break; continue;
    }
    cell += c;
  }
  if (cell !== '' || row.length) { row.push(cleanCell(cell)); if (row.some(x => x !== '')) rows.push(row); }
  return rows;
}

/* ---------------- Excel .xlsx (a zip of XML files) ---------------- */
const u16 = (b, o) => b[o] | (b[o + 1] << 8), u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
async function inflateRaw(bytes, limit) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader(), chunks = []; let total = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > limit) { await reader.cancel(); throw new Error('File is too large.'); } chunks.push(value); }
  const out = new Uint8Array(total); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
/** Names and readers for the files inside a zip. */
function zipEntries(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b.length > MAX_FILE) throw new Error('File is too large (15 MB limit).');
  let e = -1; for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (u32(b, i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('This is not an Excel .xlsx file.');
  const n = Math.min(u16(b, e + 10), 2000); let p = u32(b, e + 16); const out = new Map();
  for (let i = 0; i < n && p + 46 <= b.length && u32(b, p) === 0x02014b50; i++) {
    const method = u16(b, p + 10), csize = u32(b, p + 20), usize = u32(b, p + 24), nl = u16(b, p + 28), xl = u16(b, p + 30), cl = u16(b, p + 32), lho = u32(b, p + 42);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl));
    out.set(name, async () => {
      if (usize > MAX_UNZIPPED || lho + 30 > b.length || u32(b, lho) !== 0x04034b50) throw new Error('File is damaged or too large.');
      const start = lho + 30 + u16(b, lho + 26) + u16(b, lho + 28), data = b.subarray(start, start + csize);
      if (method === 0) return data; if (method !== 8) throw new Error('Unsupported Excel compression.');
      return inflateRaw(data, MAX_UNZIPPED);
    });
    p += 46 + nl + xl + cl;
  }
  return out;
}
const xmlText = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Math.min(Number(d), 0x10ffff))).replace(/&amp;/g, '&');
const colIndex = ref => { let n = 0; for (const ch of ref) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) break; n = n * 26 + (c - 64); } return n - 1; };
/** First worksheet of an .xlsx file → rows of text cells. */
export async function readXlsx(buf) {
  const zip = zipEntries(buf), dec = new TextDecoder();
  const sheetName = [...zip.keys()].filter(k => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))[0];
  if (!sheetName) throw new Error('No worksheet found in this Excel file.');
  const shared = [];
  if (zip.has('xl/sharedStrings.xml')) {
    const x = dec.decode(await zip.get('xl/sharedStrings.xml')());
    for (const m of x.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) { shared.push(xmlText([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''))); if (shared.length > 400000) break; }
  }
  const x = dec.decode(await zip.get(sheetName)()), rows = [];
  for (const rm of x.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] || '', ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1], type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const idx = ref ? colIndex(ref) : row.length; if (idx < 0 || idx >= MAX_COLS) continue;
      let v = '';
      if (type === 'inlineStr') v = xmlText([...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''));
      else { const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? ''; v = type === 's' ? (shared[Number(raw)] ?? '') : xmlText(raw); }
      while (row.length < idx) row.push('');
      row[idx] = cleanCell(v);
    }
    if (row.some(c => c !== '')) rows.push(row);
    if (rows.length >= MAX_ROWS) break;
  }
  return rows;
}
/** Any supported file (ArrayBuffer + file name) → rows. */
export async function readTable(buf, name = '') {
  const b = new Uint8Array(buf);
  if (b.length > MAX_FILE) throw new Error('File is too large (15 MB limit).');
  if (b[0] === 0x50 && b[1] === 0x4b) return readXlsx(b);
  if (b[0] === 0xd0 && b[1] === 0xcf) throw new Error('This is an old Excel .xls file. In Excel choose “Save As → Excel Workbook (.xlsx)” or CSV, then import that.');
  const text = b[0] === 0xff && b[1] === 0xfe ? new TextDecoder('utf-16le').decode(b) : new TextDecoder('utf-8').decode(b);
  return parseDelimited(text);
}

/* ---------------- matching columns ---------------- */
const key = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9%]/g, '');
/** field → header words (already squashed to letters/digits). First match wins, in this order. */
export const FIELDS = Object.freeze({
  items: {
    name: ['itemname', 'productname', 'nameofitem', 'nameofproduct', 'stockitemname', 'item', 'product', 'particulars', 'description', 'name', 'itemdescription', 'stockitem'],
    category: ['group', 'groupname', 'itemgroup', 'category', 'categoryname', 'productgroup', 'undergroup', 'department', 'stockgroup'],
    unit: ['unit', 'uom', 'units', 'uqc', 'per'],
    hsn: ['hsn', 'hsncode', 'hsnsac', 'hsnsaccode', 'hsnno', 'hsnsacno', 'sac'],
    gstRate: ['gst%', 'gst', 'gstrate', 'gstrate%', 'taxrate', 'tax%', 'tax', 'igst%', 'igst', 'gstper', 'taxper', 'gstslab', 'taxslab', 'taxcategory', 'taxname', 'taxtype'],
    price: ['salerate', 'salesrate', 'saleprice', 'sellingprice', 'sellingrate', 'salesprice', 'srate', 'sprice', 'retailrate', 'rate', 'price'],
    mrp: ['mrp', 'maxretailprice'],
    stock: ['closingstock', 'closingqty', 'clstock', 'clqty', 'stock', 'stockqty', 'currentstock', 'balanceqty', 'balqty', 'openingstock', 'openingqty', 'opstock', 'opqty', 'qty', 'quantity'],
    barcode: ['barcode', 'itemcode', 'code', 'productcode', 'sku', 'partno'],
  },
  parties: {
    name: ['accountname', 'acname', 'partyname', 'customername', 'ledgername', 'nameofaccount', 'nameofparty', 'account', 'party', 'customer', 'name', 'ledger', 'particulars'],
    phone: ['mobile', 'mobileno', 'mobno', 'mobilenumber', 'phone', 'phoneno', 'contactno', 'contact', 'cell', 'whatsapp', 'whatsappno'],
    gstin: ['gstin', 'gstno', 'gstnumber', 'gstinuin', 'gstinno', 'tin'],
    address: ['address', 'address1', 'add1', 'addressline1', 'billingaddress'],
    city: ['city', 'place', 'town', 'area', 'station'],
    state: ['state', 'statename'],
    pan: ['pan', 'panno', 'itpan'],
    balance: ['closingbalance', 'clbalance', 'netbalance', 'balance', 'outstanding', 'balanceamount', 'openingbalance', 'opbalance', 'amount', 'due', 'pending'],
    drcr: ['drcr', 'crdr', 'dc', 'dbcr', 'type'],
    debit: ['debit', 'debitamount', 'dr', 'dramount'],
    credit: ['credit', 'creditamount', 'cr', 'cramount'],
    group: ['group', 'groupname', 'accountgroup', 'undergroup', 'under'],
  },
});
/** { headerRow, map: { field: columnIndex } } — the first of the top 20 rows that names at least two known columns. */
export function detectColumns(rows, kind) {
  if (typeof kind !== 'string' || !Object.hasOwn(FIELDS, kind)) throw new Error('Unknown import type');
  const defs = FIELDS[kind];
  let best = { headerRow: -1, map: {}, score: 0 };
  (Array.isArray(rows) ? rows : []).slice(0, 20).forEach((row, r) => {
    const keys = row.map(key), map = {}, used = new Set();
    for (const [field, names] of Object.entries(defs))
      for (const nm of names) { const i = keys.findIndex((k, j) => k === nm && !used.has(j)); if (i >= 0) { map[field] = i; used.add(i); break; } }
    for (const [field, names] of Object.entries(defs)) {
      if (map[field] != null || ['drcr', 'debit', 'credit', 'group'].includes(field)) continue;
      for (const nm of names.filter(n => n.length >= 4)) {
        const i = keys.findIndex((k, j) => !used.has(j) && k.length <= 40 && k.includes(nm) && !(field === 'price' && /pur|cost|mrp|whole|amount/.test(k)) && !(field === 'stock' && /value|amount|rate|min|max|reorder/.test(k)) && !(field === 'name' && /group|code|short|print/.test(k)) && !(field === 'gstRate' && /no|number|gstin|type|amount/.test(k)));
        if (i >= 0) { map[field] = i; used.add(i); break; }
      }
    }
    const score = Object.keys(map).length + (map.name != null ? 2 : 0);
    if (map.name != null && Object.keys(map).length >= 2 && score > best.score) best = { headerRow: r, map, score };
  });
  return { headerRow: best.headerRow, map: best.map };
}

/* ---------------- rows → records ---------------- */
const num = v => { const s = String(v ?? '').replace(/[₹,\s]/g, '').replace(/^\((.*)\)$/, '-$1').replace(/(dr|cr)\.?$/i, ''); const n = Number(s); return s !== '' && Number.isFinite(n) ? n : null; };
const paise = v => { const n = num(v); return n != null && n >= 0 && n <= 1e8 ? Math.round(n * 100) : null; };
const UNIT_MAP = { kg: 'KGS', kgs: 'KGS', kilogram: 'KGS', g: 'GMS', gm: 'GMS', gms: 'GMS', gram: 'GMS', l: 'LTR', ltr: 'LTR', litre: 'LTR', liter: 'LTR', ml: 'MLT', m: 'MTR', mtr: 'MTR', meter: 'MTR', metre: 'MTR',
  pc: 'PCS', pcs: 'PCS', piece: 'PCS', nos: 'NOS', no: 'NOS', number: 'NOS', box: 'BOX', pkt: 'PAC', pac: 'PAC', pack: 'PAC', packet: 'PAC', dz: 'DOZ', doz: 'DOZ', dozen: 'DOZ', btl: 'BTL', bottle: 'BTL', bag: 'BAG', set: 'SET', ton: 'TON', mt: 'TON' };
const GST_OK = [0, 0.25, 1.5, 3, 5, 18, 40];
const STATE_NAMES = { 'jammu and kashmir': '01', 'himachal pradesh': '02', punjab: '03', chandigarh: '04', uttarakhand: '05', haryana: '06', delhi: '07', rajasthan: '08', 'uttar pradesh': '09', bihar: '10', sikkim: '11',
  'arunachal pradesh': '12', nagaland: '13', manipur: '14', mizoram: '15', tripura: '16', meghalaya: '17', assam: '18', 'west bengal': '19', jharkhand: '20', odisha: '21', orissa: '21', chhattisgarh: '22', 'madhya pradesh': '23',
  gujarat: '24', maharashtra: '27', karnataka: '29', goa: '30', kerala: '32', 'tamil nadu': '33', puducherry: '34', telangana: '36', 'andhra pradesh': '37', ladakh: '38' };

/**
 * Item rows → { items: [{ name, category, unit, hsn, gstRate, pricePaise, mrpPaise, stock, barcode, row, notes[] }], skipped: [{ row, why }] }
 * A GST rate that isn't a current slab is kept out (the shop sets it), never guessed.
 */
export function itemsFromRows(rows, { headerRow, map }) {
  const items = [], skipped = [], seen = new Set(), cell = (r, f) => (map[f] != null ? r[map[f]] ?? '' : '');
  for (let i = headerRow + 1; i < rows.length && items.length < MAX_ROWS; i++) {
    const r = rows[i], name = cleanCell(cell(r, 'name')).slice(0, 80);
    if (!name || /^(total|grand total|sub total|page \d+)/i.test(name)) continue;
    const dupKey = name.toLowerCase(); if (seen.has(dupKey)) { skipped.push({ row: i + 1, why: `${name}: listed twice` }); continue; } seen.add(dupKey);
    const notes = [], price = paise(cell(r, 'price'));
    if (price == null && cell(r, 'price') !== '') { skipped.push({ row: i + 1, why: `${name}: price “${cell(r, 'price')}” is not a number` }); continue; }
    let gst = num((/\d+(\.\d+)?/.exec(String(cell(r, 'gstRate'))) || [''])[0]); if (gst != null && !GST_OK.includes(gst)) { notes.push(`GST ${gst}% is not a current slab — set it in the item`); gst = null; }
    const hsnRaw = String(cell(r, 'hsn')).replace(/\D/g, ''), hsn = /^(\d{4}|\d{6}|\d{8})$/.test(hsnRaw) ? hsnRaw : ''; if (hsnRaw && !hsn) notes.push('HSN ignored (needs 4, 6 or 8 digits)');
    const mrp = paise(cell(r, 'mrp')), stock = num(cell(r, 'stock'));
    items.push({ row: i + 1, name, category: cleanCell(cell(r, 'category')).slice(0, 30) || 'General', unit: UNIT_MAP[key(cell(r, 'unit'))] || 'PCS', hsn, gstRate: gst,
      pricePaise: price ?? 0, mrpPaise: mrp && price != null && mrp >= price ? mrp : null, stock: stock != null && stock >= 0 && stock <= 1e7 ? Math.round(stock * 1000) / 1000 : 0,
      barcode: cleanCell(cell(r, 'barcode')).replace(/[^A-Za-z0-9._/-]/g, '').slice(0, 30), notes });
  }
  return { items, skipped };
}
/** Party rows → { parties: [{ name, phone, gstin, address, stateCode, pan, balancePaise, row }], skipped } */
export function partiesFromRows(rows, { headerRow, map }, { validateGstin, validatePhone, validatePan } = {}) {
  const parties = [], skipped = [], seen = new Set(), cell = (r, f) => (map[f] != null ? r[map[f]] ?? '' : '');
  for (let i = headerRow + 1; i < rows.length && parties.length < MAX_ROWS; i++) {
    const r = rows[i], name = cleanCell(cell(r, 'name')).slice(0, 80);
    if (!name || /^(total|grand total|sub total|page \d+)/i.test(name)) continue;
    const dupKey = name.toLowerCase(); if (seen.has(dupKey)) { skipped.push({ row: i + 1, why: `${name}: listed twice` }); continue; } seen.add(dupKey);
    const notes = [];
    const gRaw = cleanCell(cell(r, 'gstin')).toUpperCase(), gv = gRaw && validateGstin ? validateGstin(gRaw) : null, gstin = gv && typeof gv === 'object' ? (gv.ok ? gv.gstin : null) : (typeof gv === 'string' ? gv : null); if (gRaw && !gstin) notes.push('GSTIN ignored (not valid)');
    const pRaw = cleanCell(cell(r, 'phone')), phone = pRaw ? (validatePhone ? validatePhone(pRaw.split(/[,/;]/)[0]) : null) : null; if (pRaw && !phone) notes.push('Mobile ignored (needs 10 digits)');
    const panRaw = cleanCell(cell(r, 'pan')), pan = panRaw && validatePan ? validatePan(panRaw) : null;
    const stRaw = cleanCell(cell(r, 'state')).toLowerCase(), stateCode = gstin ? gstin.slice(0, 2) : (/^\d{2}$/.test(stRaw) ? stRaw : STATE_NAMES[stRaw.replace(/^\d+\s*[-–]\s*/, '')] || '');
    // Dr balance = the customer owes the shop. "Cr" or a negative number = the shop owes them: not brought in as udhaar.
    const bRaw = String(cell(r, 'balance')), split = map.balance == null && (map.debit != null || map.credit != null);
    const bal = split ? (num(cell(r, 'debit')) || 0) - (num(cell(r, 'credit')) || 0) : num(bRaw);
    const isCr = /cr\.?\s*$/i.test(bRaw.trim()) || /^c/i.test(cleanCell(cell(r, 'drcr'))) || (bal != null && bal < 0);
    parties.push({ row: i + 1, name, phone: phone || '', gstin: gstin || '', pan: pan || '', stateCode,
      address: [cell(r, 'address'), cell(r, 'city')].map(cleanCell).filter(Boolean).join(', ').slice(0, 200),
      balancePaise: bal != null && !isCr && bal > 0 && bal <= 1e9 ? Math.round(bal * 100) : 0, notes });
  }
  return { parties, skipped };
}
