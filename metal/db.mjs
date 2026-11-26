// Tiny IndexedDB wrapper. Everything stays on the device (offline-first).
const DB_NAME = 'india-pos', VERSION = 3; // v2 adds 'bars' (metal stock pieces); v3 adds 'outbox' and 'local' for sync
export const STORES = ['kv', 'products', 'customers', 'sales', 'creditNotes', 'khata', 'dayClose', 'bars'];
/** This device only — never in backups, never synced: the list of changes waiting to be sent, and the sync secret. */
const LOCAL_STORES = ['outbox', 'local'];
let dbp;
export function open() {
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'kv' ? 'key' : 'id' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('local')) db.createObjectStore('local', { keyPath: 'key' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export async function all(store) { const db = await open(); return req(db.transaction(store).objectStore(store).getAll()); }
export async function get(store, key) { const db = await open(); return req(db.transaction(store).objectStore(store).get(key)); }
/* ---- change tracking for sync: every write to shared data is noted in 'outbox' inside the SAME transaction, so a change can't be saved without being queued ---- */
let tracker = null, onDirty = () => {}, stamp = 0;
/** shouldSync(store, key) → boolean; dirty() is called after a tracked write. Pass null to stop tracking. */
export function setTracking(shouldSync, dirty) { tracker = shouldSync || null; onDirty = dirty || (() => {}); }
const keyOf = (store, value) => (store === 'kv' ? value.key : value.id);
const txn = (db, stores, mode) => db.transaction(tracker && mode === 'readwrite' ? [...new Set([...stores, 'outbox'])] : stores, mode);
function note(t, store, key) { if (!tracker || !tracker(store, key)) return false; t.objectStore('outbox').put({ id: store + '\n' + key, n: `${Date.now()}-${++stamp}` }); return true; }
export async function put(store, value) { const db = await open(); const t = txn(db, [store], 'readwrite'); t.objectStore(store).put(value); const d = note(t, store, keyOf(store, value)); await done(t); if (d) onDirty(); }
export async function del(store, key) { const db = await open(); const t = txn(db, [store], 'readwrite'); t.objectStore(store).delete(key); const d = note(t, store, key); await done(t); if (d) onDirty(); }
export async function kvGet(key, fallback) { const r = await get('kv', key); return r ? r.value : fallback; }
export async function kvSet(key, value) { return put('kv', { key, value }); }
function done(t) { return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Transaction aborted')); }); }
/** Write several records atomically: writes = [{store, value}] */
export async function writeAll(writes) {
  const db = await open();
  const stores = [...new Set(writes.map(w => w.store))];
  const t = txn(db, stores, 'readwrite'); let d = false;
  for (const w of writes) { t.objectStore(w.store).put(w.value); d = note(t, w.store, keyOf(w.store, w.value)) || d; }
  await done(t); if (d) onDirty();
}
export async function exportAll() {
  const out = { app: 'india-pos', version: VERSION, exportedAt: new Date().toISOString() };
  for (const s of STORES) out[s] = await all(s);
  return out;
}
/**
 * Restore a backup. The file may come from anywhere (a forwarded "backup" could be tampered with), so it is
 * cleaned first: only plain records, no prototype keys, finite numbers, bounded sizes, and the characters
 * < > " in text are swapped for look-alikes so text can never become HTML.
 */
export function cleanBackup(data) {
  if (!data || typeof data !== 'object' || data.app !== 'india-pos') throw new Error('Not an India POS backup file');
  const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  // fields the app treats as numbers / yes-no: a tampered file must not put text there
  const NUM = new Set('feePaise,barMm,cutGstRate,lengthMm,origLengthMm,beforeMm,afterMm,usedMm,pieces,pieceMm,density,ratePaise,cutChargePaise,kerfMm,minOffcutMm,receivedAt,cuts,buyQty,getQty,savePaise,promoPaise,order,amountPaise,at,billDiscountPaise,cess,cessRate,cgst,change,createdAt,discount,discountPaise,grandTotal,gross,gstRate,igst,keypadRate,lineIndex,lowStock,mrpPaise,pricePaise,qty,rate,roundOff,seq,sgst,stock,subtotal,taxable,total'.split(','));
  const BOOL = new Set('scrap,off,implicit,waConsent,turnoverAbove5Cr,merchantUpi,priceIncludesTax,active,interState,chargesTax'.split(','));
  const clean = (v, depth, key) => {
    if (depth > 10) return null;
    if (NUM.has(key) && !(key === 'mrpPaise' && v == null)) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
    if (BOOL.has(key) && v != null) return v === true || v === 'true';
    if (typeof v === 'string') return v.slice(0, 5000).replace(/</g, '‹').replace(/>/g, '›').replace(/"/g, '″');
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'boolean' || v === null) return v;
    if (Array.isArray(v)) return v.slice(0, 5000).map(x => clean(x, depth + 1, key));
    if (typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) if (!BAD_KEYS.has(k) && k.length <= 64) o[k] = clean(x, depth + 1, k); return o; }
    return null;
  };
  const out = {};
  for (const s of STORES) {
    const list = data[s] ?? [];
    if (!Array.isArray(list) || list.length > 500000) throw new Error('Backup file is damaged (' + s + ')');
    out[s] = list.map(r => clean(r, 0)).filter(r => r && typeof r === 'object' && !Array.isArray(r) && typeof r[s === 'kv' ? 'key' : 'id'] === 'string' && r[s === 'kv' ? 'key' : 'id'] !== '');
  }
  // settings that the app trusts to be valid
  const st = out.kv.find(r => r.key === 'settings')?.value;
  if (st && typeof st === 'object') {
    if (!['regular', 'composition', 'unregistered'].includes(st.regime)) st.regime = 'unregistered';
    if (!/^\d{2}$/.test(String(st.stateCode))) st.stateCode = '24';
    if (st.upiVpa && !/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.]{1,64}$/.test(st.upiVpa)) st.upiVpa = '';
    if (st.shopType !== 'metal') st.shopType = 'retail';
  } else if (st !== undefined) out.kv = out.kv.filter(r => r.key !== 'settings');
  return out;
}
export async function importAll(data) {
  const clean = cleanBackup(data);
  // never let an old backup wind the licence clock back
  const seen = Math.max(Number((await get('kv', 'maxSeen'))?.value) || 0, Number(clean.kv.find(r => r.key === 'maxSeen')?.value) || 0);
  clean.kv = clean.kv.filter(r => r.key !== 'maxSeen').concat({ key: 'maxSeen', value: seen });
  const db = await open();
  const t = txn(db, STORES, 'readwrite'); let d = false;
  for (const s of STORES) { const os = t.objectStore(s); os.clear(); for (const v of clean[s]) { os.put(v); d = note(t, s, keyOf(s, v)) || d; } }
  await done(t); if (d) onDirty();
}

/* ---------------- sync support (used by sync-ui.mjs) ---------------- */
export async function localGet(key, fallback = null) { const db = await open(); const r = await req(db.transaction('local').objectStore('local').get(key)); return r ? r.value : fallback; }
export async function localSet(key, value) { const db = await open(); const t = db.transaction('local', 'readwrite'); t.objectStore('local').put({ key, value }); return done(t); }
export async function outboxAll() { const db = await open(); return req(db.transaction('outbox').objectStore('outbox').getAll()); }
/** Drop outbox entries, but only those not changed again since they were read (same n). */
function dropSent(t, drop) { const os = t.objectStore('outbox'); for (const e of drop || []) { const r = os.get(e.id); r.onsuccess = () => { if (r.result && r.result.n === e.n) os.delete(e.id); }; } }
/**
 * Save changes that arrived from other devices — never noted in the outbox — together with the new sync position, in one transaction.
 * puts: [{ store, value }] (kv values as { key, value }), dels: [{ store, key }], local: { key: value }
 */
export async function syncApply({ puts = [], dels = [], drop = [], local = {} }) {
  const db = await open();
  const t = db.transaction([...STORES, ...LOCAL_STORES], 'readwrite');
  for (const p of puts) if (STORES.includes(p.store)) t.objectStore(p.store).put(p.value);
  for (const d of dels) if (STORES.includes(d.store)) t.objectStore(d.store).delete(d.key);
  dropSent(t, drop);
  for (const [key, value] of Object.entries(local)) t.objectStore('local').put({ key, value });
  return done(t);
}
/** Queue every shared record for sending (first upload, or after a backup restore). */
export async function markAllForSync(shouldSync) {
  const db = await open();
  for (const s of STORES) {
    const keys = await req(db.transaction(s).objectStore(s).getAllKeys());
    const t = db.transaction('outbox', 'readwrite'), os = t.objectStore('outbox');
    for (const k of keys) if (shouldSync(s, k)) os.put({ id: s + '\n' + k, n: `${Date.now()}-${++stamp}` });
    await done(t);
  }
}
/** A device joining a shop starts from the shop's data: remove this device's own shared data first. */
export async function clearShared(shouldSync) {
  const db = await open();
  const t = db.transaction([...STORES, 'outbox'], 'readwrite');
  for (const s of STORES) {
    const os = t.objectStore(s);
    if (s === 'kv') { const r = os.getAllKeys(); r.onsuccess = () => { for (const k of r.result) if (shouldSync('kv', k)) os.delete(k); }; }
    else os.clear();
  }
  t.objectStore('outbox').clear();
  return done(t);
}
/** Forget sync on this device (data stays). */
export async function syncForget() {
  const db = await open();
  const t = db.transaction(LOCAL_STORES, 'readwrite'); t.objectStore('outbox').clear(); t.objectStore('local').clear();
  return done(t);
}
