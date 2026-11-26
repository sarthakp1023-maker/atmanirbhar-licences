// Multi-device sync: encryption, the talk with the sync server, and the rules for merging two devices' changes.
// Pure logic (no storage, no screen) so it can be unit-tested and run against the real server in tests.
//
// What the server can and cannot see: every record is encrypted on the device (AES-256-GCM) with a key derived from
// the shop's secret, and stored under a scrambled name (HMAC). The secret travels only inside a pairing code that is
// itself encrypted with a one-time short code. The server sees sizes and timing — never bills, items or customers.
import { makeShortCode, parseShortCode, sealKeyForCode, deriveFromCode, openSealedKey } from './licence.mjs';

const te = new TextEncoder(), td = new TextDecoder();
const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const b64 = b => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = b => b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Which data is shared between a shop's devices. Everything else (open bill, held bills, counters, this device's choices) stays local. */
export const SYNC_STORES = Object.freeze(['products', 'customers', 'sales', 'creditNotes', 'khata', 'dayClose', 'bars']);
export const SYNC_KV = Object.freeze(['settings', 'departments', 'grades', 'licence']);
/** Settings that belong to one device (printer paper, language, payment device…) and are never overwritten by another device. */
export const DEVICE_SETTINGS = Object.freeze(['lang', 'paper', 'payDevice', 'payAlerts', 'lastBackup', 'keypadRate', 'keypad']);
export const isSynced = (store, key) => (store === 'kv' ? SYNC_KV.includes(key) : SYNC_STORES.includes(store));

/* ---------------- subscription plan (set per shop by the provider; arrives with every sync) ---------------- */
/** Paid features need a plan (or a licence key) that includes them. Base features are on unless the plan switches them off. */
export const PAID_FEATURES = Object.freeze(['sync', 'gateway', 'edc', 'alerts', 'gstr1', 'register', 'reports', 'csv']);
export const BASE_FEATURES = Object.freeze(['metal', 'miracle']);
/** Anything from the server → a plan with only known, typed fields (or null). */
export function cleanPlan(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const f = p.features && typeof p.features === 'object' ? p.features : {};
  const until = Number.isSafeInteger(p.until) && p.until > 0 && p.until < 4102444800 ? p.until : null;
  return { status: p.status === 'suspended' ? 'suspended' : 'active', until, now: Number.isSafeInteger(p.now) && p.now > 0 ? p.now : 0,
    features: Object.fromEntries([...PAID_FEATURES, ...BASE_FEATURES].map(k => [k, f[k] !== false])) };
}
/** Is the plan in force at nowMs? The device clock cannot be wound back past the server time the plan was fetched at. */
export function planActive(plan, nowMs = Date.now()) {
  if (!plan || plan.status !== 'active') return false;
  return plan.until == null || plan.until * 1000 > Math.max(nowMs, (plan.now || 0) * 1000);
}
/** Does this plan allow the feature? (No plan at all: paid features need a licence key instead; base features are on.) */
export function planAllows(plan, key, nowMs = Date.now()) {
  if (BASE_FEATURES.includes(key)) return !plan || plan.features[key] !== false;
  return PAID_FEATURES.includes(key) && planActive(plan, nowMs) && plan.features[key] === true;
}

export class SyncError extends Error { constructor(kind, message, extra = {}) { super(message); this.kind = kind; Object.assign(this, extra); } }

/* ---------------- keys ---------------- */
export function newShopSecret() { return { shopId: hex(crypto.getRandomValues(new Uint8Array(16))), master: b64(crypto.getRandomValues(new Uint8Array(32))) }; }
/** master (base64 of 32 bytes) + shopId → { enc, mac, token, tokenHash } */
export async function deriveKeys(master, shopId) {
  let raw; try { raw = unb64(String(master)); } catch { raw = new Uint8Array(0); }
  if (raw.length !== 32 || !/^[0-9a-f]{32}$/.test(String(shopId))) throw new SyncError('code', 'Bad sync secret.');
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits']);
  const bits = async info => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('atmanirbhar-sync-v1:' + shopId), info: te.encode(info) }, base, 256));
  const token = b64url(await bits('token'));
  return {
    enc: await crypto.subtle.importKey('raw', await bits('enc'), 'AES-GCM', false, ['encrypt', 'decrypt']),
    mac: await crypto.subtle.importKey('raw', await bits('mac'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    token, tokenHash: hex(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(token)))),
  };
}
/** Scrambled record name the server stores the record under. */
export async function recordKey(keys, store, id) { return hex(new Uint8Array(await crypto.subtle.sign('HMAC', keys.mac, te.encode(store + '\n' + id)))); }
/** Encrypt one record (value null = deleted). Returns base64(iv | ciphertext). */
export async function seal(keys, shopId, k, store, id, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(shopId + ':' + k) }, keys.enc, te.encode(JSON.stringify({ s: store, i: id, v: value ?? null, t: Date.now() }))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return b64(out);
}
/** Decrypt and check one record from the server. Throws if it was altered, moved to another name, or is not this shop's. */
export async function open(keys, shopId, k, blob) {
  let raw; try { raw = unb64(String(blob)); } catch { throw new SyncError('tamper', 'Unreadable record from the server.'); }
  if (raw.length < 28) throw new SyncError('tamper', 'Unreadable record from the server.');
  let obj;
  try { obj = JSON.parse(td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: te.encode(shopId + ':' + k) }, keys.enc, raw.subarray(12)))); }
  catch { throw new SyncError('tamper', 'A record from the server failed its check.'); }
  if (!obj || typeof obj.s !== 'string' || typeof obj.i !== 'string' || !obj.i || obj.i.length > 200 || !isSynced(obj.s, obj.i) || (obj.v !== null && (typeof obj.v !== 'object' && obj.s !== 'kv'))) throw new SyncError('tamper', 'A record from the server is not valid.');
  if (await recordKey(keys, obj.s, obj.i) !== k) throw new SyncError('tamper', 'A record from the server is under the wrong name.');
  return { store: obj.s, id: obj.i, value: obj.v, at: Number(obj.t) || 0 };
}

/* ---------------- pairing code (to add another device) ---------------- */
/** → { code: 'XXXX-XXXX-XXXX', fileId, blob } — upload fileId + blob; tell the person the code. */
export async function makePairing({ shopId, master }, iterations) {
  const code = makeShortCode();
  const { fileId, file } = await sealKeyForCode(code, JSON.stringify({ v: 1, s: shopId, m: master }), iterations);
  return { code, fileId, blob: file };
}
/** typed code → { code, fileId, open(blob) → { shopId, master } } or throws SyncError('code'). */
export async function readPairing(text, iterations) {
  const p = parseShortCode(text);
  if (!p) throw new SyncError('code', 'Type the 12-character code shown on the other device, like 7KQ4-M2XP-9DR3.');
  if (p.error) throw new SyncError('code', 'That code has a typing mistake — check it and try again.');
  const { fileId, aesKey } = await deriveFromCode(p.code, iterations);
  return { code: p.code, fileId, async open(blob) {
    let o; try { o = JSON.parse(await openSealedKey(fileId, aesKey, blob)); } catch { throw new SyncError('code', 'That code did not open the pairing data.'); }
    if (o?.v !== 1 || !/^[0-9a-f]{32}$/.test(o.s) || typeof o.m !== 'string') throw new SyncError('code', 'That code did not open the pairing data.');
    return { shopId: o.s, master: o.m };
  } };
}

/* ---------------- talking to the server ---------------- */
/** fetchFn(url, { method, headers, body }) → Response-like. base has no trailing slash. */
export function client(base, shopId, token, fetchFn = fetch) {
  async function call(method, path, body, auth = true) {
    let res;
    try { res = await fetchFn(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Authorization: 'Bearer ' + token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' }); }
    catch { throw new SyncError('network', 'Could not reach the sync server.'); }
    let j = null; try { j = await res.json(); } catch {}
    if (res.status === 200 && j && typeof j === 'object') return j;
    if (res.status === 409 && j?.error === 'behind') throw new SyncError('behind', 'Another device synced first.', { seq: j.seq });
    if (res.status === 402) throw new SyncError(j?.error === 'nosync' ? 'nosync' : 'suspended', j?.error === 'nosync' ? 'Sync is not part of this shop’s plan.' : 'This shop’s subscription has ended or is paused.', { plan: cleanPlan(j?.plan) });
    if (res.status === 401) throw new SyncError('auth', 'The sync server did not accept this device. Sync may have been turned off for this shop.');
    if (res.status === 403 && j?.error === 'invite') throw new SyncError('invite', 'That invite code is not valid or was already used.');
    if (res.status === 403 && j?.error === 'devices') throw new SyncError('devices', 'This shop already has the maximum number of devices.');
    if (res.status === 404) throw new SyncError('notfound', 'Not found on the sync server.');
    if (res.status === 429) throw new SyncError('busy', 'Too many attempts. Wait ten minutes and try again.');
    if (res.status === 507) throw new SyncError('quota', 'The shop has reached its sync storage limit.');
    throw new SyncError('server', `Sync server problem (${res.status}).`);
  }
  const S = `/v1/shops/${shopId}`;
  return {
    health: () => call('GET', '/health', undefined, false),
    register: (invite, tokenHash) => call('POST', '/v1/register', { invite, shop: shopId, tokenHash }, false),
    addDevice: () => call('POST', S + '/devices', {}),
    push: (since, device, items) => call('POST', S + '/push', { since, device, items }),
    pull: since => call('GET', `${S}/pull?since=${Math.max(0, Math.floor(since))}`),
    pairPut: (fileId, blob) => call('POST', S + '/pair', { fileId, blob }),
    pairGet: fileId => call('GET', '/v1/pair/' + fileId, undefined, false),
    deleteShop: () => call('DELETE', S, {}),
    plan: () => call('GET', S + '/plan'),
  };
}

/* ---------------- merging ---------------- */
/**
 * A change arrives from another device for a record this device also has.
 *   pending   = this device has its own unsent change to the same record
 *   baseStock = the stock this device last saw from the server (products only)
 * Returns { value, push } — value to keep locally (null = delete), and whether it still has to be sent.
 */
export function mergeRecord(store, id, local, remote, { pending = false, baseStock = null } = {}) {
  if (local == null || !pending) {
    if (store === 'kv' && id === 'settings' && local && remote) return { value: mergeSettings(local, remote, false), push: false };
    return { value: remote, push: false };
  }
  if (remote == null) return { value: local, push: true };                       // deleted elsewhere, changed here: the change wins
  if (store === 'products') {
    // Two counters selling the same item: both sales must come off the stock. Other fields: the more recent edit wins.
    const newer = (Number(remote.editedAt) || 0) > (Number(local.editedAt) || 0) ? remote : local;
    if (local.metal || remote.metal) return { value: { ...newer }, push: true };  // bar materials: stock is recounted from the bars
    const sold = Number.isFinite(baseStock) ? (Number(local.stock) || 0) - baseStock : 0;
    return { value: { ...newer, stock: Math.round(((Number(remote.stock) || 0) + sold) * 1000) / 1000 }, push: true };
  }
  if (store === 'bars') {
    // The same bar cut on two devices: keep the shorter length (both cuts happened) and whichever status is further along.
    const rank = { stock: 0, scrap: 1, used: 2, void: 3 }, shorter = (Number(remote.lengthMm) || 0) < (Number(local.lengthMm) || 0) ? remote : local;
    return { value: { ...shorter, status: (rank[remote.status] ?? 0) > (rank[local.status] ?? 0) ? remote.status : local.status }, push: true };
  }
  if (store === 'sales' || store === 'creditNotes') {
    // A bill is never edited, only cancelled: a cancellation on either device stands.
    return { value: remote.status === 'cancelled' && local.status !== 'cancelled' ? remote : local, push: !(remote.status === 'cancelled' && local.status !== 'cancelled') };
  }
  if (store === 'kv' && id === 'settings') return { value: mergeSettings(local, remote, true), push: true };
  return { value: local, push: true };                                             // last change wins: ours is still to be sent
}
/** Shop details are shared; each device keeps its own printer, language and payment-device choices. */
export function mergeSettings(local, remote, localWins) {
  const out = localWins ? { ...remote, ...local } : { ...local, ...remote };
  for (const k of DEVICE_SETTINGS) { if (k in local) out[k] = local[k]; else delete out[k]; }
  return out;
}

/* ---------------- per-device numbering (two devices billing offline must never issue the same number) ---------------- */
const TAG = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Device 1 keeps the shop's prefix (INV). Device 2 → INV2, device 3 → INV3 … so each device has its own bill series. */
export function devicePrefix(prefix, device) {
  const p = String(prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4), d = Math.floor(Number(device) || 1);
  if (d <= 1) return p;
  const tag = TAG[d % 32] || 'Z', cand = p.slice(0, 3) + tag;
  return cand === p ? tag + p.slice(0, 3) : cand;
}
/** Stock-piece label prefix: B- on device 1, B2- on device 2 … */
export function barPrefix(device) { const d = Math.floor(Number(device) || 1); return d <= 1 ? 'B' : 'B' + d; }

/* ---------------- the sync loop ---------------- */
/**
 * One sync engine per device. `store` is the device's storage (IndexedDB in the app, a Map in tests):
 *   state()                 → { shopId, master, device, since }
 *   outbox()                → [{ id: 'store\nkey', n }]   records changed on this device and not yet sent
 *   get(store, id)          → value or undefined
 *   base(id)                → stock this device last saw from the server for a product, or null
 *   apply({ puts, dels, bases, since, drop })   save changes from other devices (must not add to the outbox), all at once
 *   sent({ drop, bases, since })                after a successful send
 * Always pulls before pushing, and the server refuses a push from a device that is behind, so no change is ever overwritten unseen.
 */
export function createEngine({ store, api, keys, onApplied = () => {}, onPlan = () => {} }) {
  let running = null;
  async function pullAll(st) {
    let applied = 0;
    for (let page = 0; page < 2000; page++) {
      const r = await api.pull(st.since);
      if (!r || !Array.isArray(r.items) || !Number.isSafeInteger(r.upto) || r.upto < st.since) throw new SyncError('server', 'Unexpected reply from the sync server.');
      if (r.plan) await onPlan(cleanPlan(r.plan));
      const pending = new Map((await store.outbox()).map(e => [e.id, e])), puts = [], dels = [], bases = {}, drop = [], touched = new Set();
      for (const it of r.items) {
        const rec = await open(keys, st.shopId, String(it.k), it.b), oid = rec.store + '\n' + rec.id, mine = pending.get(oid);
        const local = await store.get(rec.store, rec.id);
        const m = mergeRecord(rec.store, rec.id, local, rec.value, { pending: !!mine, baseStock: rec.store === 'products' ? await store.base(rec.id) : null });
        if (m.value == null) dels.push({ store: rec.store, id: rec.id }); else puts.push({ store: rec.store, id: rec.id, value: m.value });
        if (rec.store === 'products' && rec.value) bases[rec.id] = Number(rec.value.stock) || 0;
        if (mine && !m.push) drop.push(mine);
        touched.add(rec.store);
      }
      await store.apply({ puts, dels, bases, since: r.upto, drop });
      st.since = r.upto; applied += r.items.length;
      if (touched.size) await onApplied([...touched]);
      if (!r.more) break;
    }
    return applied;
  }
  async function pushAll(st) {
    let sent = 0;
    for (;;) {
      const batch = (await store.outbox()).slice(0, 200); if (!batch.length) return sent;
      const items = [], bases = {};
      for (const e of batch) {
        const cut = e.id.indexOf('\n'), s = e.id.slice(0, cut), id = e.id.slice(cut + 1);
        if (!isSynced(s, id)) continue;
        const value = await store.get(s, id), k = await recordKey(keys, s, id);
        items.push({ k, b: await seal(keys, st.shopId, k, s, id, value ?? null) });
        if (s === 'products' && value) bases[id] = Number(value.stock) || 0;
      }
      const r = items.length ? await api.push(st.since, st.device, items) : { seq: st.since };
      if (!Number.isSafeInteger(r.seq) || r.seq < st.since) throw new SyncError('server', 'Unexpected reply from the sync server.');
      await store.sent({ drop: batch, bases, since: r.seq }); st.since = r.seq; sent += items.length;
    }
  }
  /** Pull, then push; if another device got in first, pull again and retry. Returns { pulled, pushed }. */
  async function once() {
    const st = { ...(await store.state()) }; let pulled = 0, pushed = 0;
    for (let attempt = 0; attempt < 6; attempt++) {
      pulled += await pullAll(st);
      try { pushed += await pushAll(st); return { pulled, pushed }; }
      catch (e) { if (e.kind !== 'behind') throw e; }
    }
    throw new SyncError('busy', 'Other devices are syncing — will try again shortly.');
  }
  return { sync: () => (running ??= once().finally(() => { running = null; })) };
}
