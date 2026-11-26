// Offline licence keys for Pro features.
// A key is a 14-byte payload signed with ECDSA P-256 (SHA-256). The app holds only the PUBLIC key,
// so it can check keys without internet; only the private key on the seller's Mac can create them.
//
// Payload: [version 1][plan 1][issued day u16][expiry day u16][licence id u32][phone tag u32]
// Days count from 1 Jan 2026 (UTC). Expiry 0xFFFF = lifetime. Phone tag = first 4 bytes of
// SHA-256("atmanirbhar-licence:" + 10-digit mobile), so a key works only for that shop's phone number.
// Text form: "AN1-" + Crockford base32 of (payload + 64-byte signature), in groups of 5.

export const LICENCE_EPOCH = Date.UTC(2026, 0, 1);
export const LIFETIME = 0xffff;
export const PLANS = { 1: 'pro' };
export const PLAN_CODES = { pro: 1 };
const VERSION = 1, PAYLOAD_LEN = 14, SIG_LEN = 64, PREFIX = 'AN1';
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: no I, L, O, U

export const dayNumber = ms => Math.floor((ms - LICENCE_EPOCH) / 864e5);
export const dayToMs = d => LICENCE_EPOCH + d * 864e5;

export function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}
export async function phoneTag(phone) {
  const p = normalizePhone(phone);
  if (!p) throw new Error('A valid 10-digit mobile number is needed');
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('atmanirbhar-licence:' + p)));
  return h.slice(0, 4);
}

export function packPayload({ plan, issuedDay, expiryDay, id, tag }) {
  const b = new Uint8Array(PAYLOAD_LEN), v = new DataView(b.buffer);
  v.setUint8(0, VERSION); v.setUint8(1, PLAN_CODES[plan] ?? plan);
  v.setUint16(2, issuedDay); v.setUint16(4, expiryDay); v.setUint32(6, id >>> 0);
  b.set(tag, 10);
  return b;
}
export function unpackPayload(b) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { version: v.getUint8(0), planCode: v.getUint8(1), issuedDay: v.getUint16(2), expiryDay: v.getUint16(4), id: v.getUint32(6), tag: b.slice(10, 14) };
}

function toBase32(bytes) {
  let bits = 0, val = 0, out = '';
  for (const byte of bytes) { val = (val << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function fromBase32(str, byteLen) {
  let bits = 0, val = 0; const out = [];
  for (const ch of str) {
    const i = B32.indexOf(ch); if (i < 0) return null;
    val = ((val << 5) | i) & 0xffffff; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
    if (out.length === byteLen) break; // ignore anything pasted after the key
  }
  return out.length >= byteLen ? new Uint8Array(out.slice(0, byteLen)) : null;
}
export function formatKey(bytes) { return PREFIX + '-' + toBase32(bytes).match(/.{1,5}/g).join('-'); }

/** Finds a licence key inside any pasted text (e.g. the whole WhatsApp message). */
export function extractKey(text) {
  const m = String(text || '').toUpperCase().match(/AN1(?:[ \t-]*[0-9A-Z]){100,}/);
  if (!m) return null;
  const body = m[0].slice(3).replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return fromBase32(body, PAYLOAD_LEN + SIG_LEN);
}

const ALG = { name: 'ECDSA', hash: 'SHA-256' };
// ECDSA signatures have two valid forms (s and n−s). Allow only the low one so each licence has exactly one key text.
const N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n;
const toBig = b => BigInt('0x' + (Array.from(b, x => x.toString(16).padStart(2, '0')).join('') || '0'));
const fromBig = (v, len) => { const h = v.toString(16).padStart(len * 2, '0'); return Uint8Array.from(h.match(/../g), x => parseInt(x, 16)); };
function lowS(sig) { const s = toBig(sig.slice(32)); if (s <= N / 2n) return sig; const out = new Uint8Array(64); out.set(sig.slice(0, 32)); out.set(fromBig(N - s, 32), 32); return out; }
const isLowS = sig => { const r = toBig(sig.slice(0, 32)), s = toBig(sig.slice(32)); return r > 0n && r < N && s > 0n && s <= N / 2n; };
export async function importPublicKey(base64Raw) {
  const raw = Uint8Array.from(atob(base64Raw), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

/** Seller side: create a key. privateKey is a WebCrypto ECDSA P-256 CryptoKey. */
export async function signLicence(privateKey, { plan = 'pro', phone, issuedAt = Date.now(), months = 12, id }) {
  const tag = await phoneTag(phone);
  const issuedDay = dayNumber(issuedAt);
  let expiryDay = LIFETIME;
  if (months) { const d = new Date(issuedAt); d.setUTCMonth(d.getUTCMonth() + months); expiryDay = dayNumber(d.getTime()); }
  const payload = packPayload({ plan, issuedDay, expiryDay, id: id ?? crypto.getRandomValues(new Uint32Array(1))[0], tag });
  const sig = lowS(new Uint8Array(await crypto.subtle.sign(ALG, privateKey, payload)));
  const all = new Uint8Array(PAYLOAD_LEN + SIG_LEN); all.set(payload); all.set(sig, PAYLOAD_LEN);
  return { key: formatKey(all), payload: unpackPayload(payload), expiresAt: expiryDay === LIFETIME ? null : dayToMs(expiryDay) };
}

/**
 * App side: check a key. Returns { ok, reason, plan, expiresAt, id }.
 * now should come from effectiveNow() so moving the phone's clock back doesn't extend a licence.
 */
export async function verifyLicence(text, publicKey, { phone, now = Date.now() }) {
  const all = extractKey(text);
  if (!all) return { ok: false, reason: 'format', message: 'This does not look like a licence key.' };
  const payload = all.slice(0, PAYLOAD_LEN), sig = all.slice(PAYLOAD_LEN);
  const key = typeof publicKey === 'string' ? await importPublicKey(publicKey) : publicKey;
  if (!isLowS(sig) || !(await crypto.subtle.verify(ALG, key, sig, payload))) return { ok: false, reason: 'signature', message: 'This licence key is not genuine. Check that it was copied completely.' };
  const p = unpackPayload(payload);
  const info = { plan: PLANS[p.planCode] || 'unknown', id: p.id.toString(16).toUpperCase().padStart(8, '0'), issuedAt: dayToMs(p.issuedDay), expiresAt: p.expiryDay === LIFETIME ? null : dayToMs(p.expiryDay) };
  if (p.version !== VERSION || !PLANS[p.planCode]) return { ok: false, reason: 'version', message: 'This key is for a newer version of the app — please update the app.', ...info };
  let tag;
  try { tag = await phoneTag(phone); } catch { return { ok: false, reason: 'phone', message: 'Add your shop mobile number in Settings first — the licence is linked to it.', ...info }; }
  if (tag.some((b, i) => b !== p.tag[i])) return { ok: false, reason: 'phone', message: 'This licence is for a different shop mobile number than the one in Settings.', ...info };
  if (info.expiresAt != null && now >= info.expiresAt + 864e5) return { ok: false, reason: 'expired', message: 'This licence has expired.', ...info };
  return { ok: true, reason: 'ok', message: 'Licence active.', ...info };
}

/** Never let time run backwards: the highest time seen so far (minus 1 day of slack) is the floor. */
export function effectiveNow(now, maxSeen = 0) { return Math.max(now, maxSeen - 864e5); }

/* ================= Short activation codes (e.g. 7KQ4-M2XP-9DR3) =================
 * A full key needs a 64-byte signature, so it can't be short. Short codes work like this:
 *  - the seller tool makes a random 12-character code (11 random characters = 55 bits, plus 1 check character for typos),
 *  - stretches it with PBKDF2 (200,000 rounds) into a file name + an AES-256-GCM key,
 *  - encrypts the full signed key with it and publishes the file on a plain static web host.
 * The app, given the code, derives the same file name, downloads the file once, decrypts it and checks the
 * signature exactly as for a pasted key. The host only ever sees random file names and encrypted blobs:
 * it cannot learn codes, read keys, or create licences (the signature check still happens in the app).
 */
export const CODE_ITERATIONS = 200_000;
const CODE_SALT = 'atmanirbhar-licence-code-v1';
const CODE_WEIGHTS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21]; // odd weights: every single-character typo changes the check

function codeCheck(vals) { return CODE_WEIGHTS.reduce((s, w, i) => s + w * vals[i], 0) % 32; }

/** Seller side: a new random short code, formatted XXXX-XXXX-XXXX. */
export function makeShortCode() {
  const vals = Array.from(crypto.getRandomValues(new Uint8Array(11)), b => b & 31);
  const s = [...vals, codeCheck(vals)].map(v => B32[v]).join('');
  return s.match(/.{4}/g).join('-');
}

/** Finds a short code in typed or pasted text. Returns { code } , { error:'check' } for a typo, or null. */
export function parseShortCode(text) {
  const t = String(text || '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
  const m = t.match(/(?:^|[^0-9A-Z])([0-9A-Z]{4})[ \t-]?([0-9A-Z]{4})[ \t-]?([0-9A-Z]{4})(?![0-9A-Z])/) || t.replace(/[\s-]/g, '').match(/^()([0-9A-Z]{12})()$/);
  if (!m) return null;
  const s = (m[1] + m[2] + m[3]);
  const vals = [...s].map(c => B32.indexOf(c));
  if (vals.some(v => v < 0)) return null;
  if (codeCheck(vals.slice(0, 11)) !== vals[11]) return { error: 'check' };
  return { code: s.match(/.{4}/g).join('-') };
}

const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const b64 = b => btoa(String.fromCharCode(...b));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/** Both sides: code -> { fileId (32 hex chars), aesKey }. Slow on purpose (guessing codes stays expensive). */
export async function deriveFromCode(code, iterations = CODE_ITERATIONS) {
  const norm = String(code).replace(/-/g, '');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(norm), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(CODE_SALT), iterations }, base, 384));
  const fileId = hex(bits.slice(0, 16));
  const aesKey = await crypto.subtle.importKey('raw', bits.slice(16, 48), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { fileId, aesKey };
}

/** Seller side: the file to publish at <host>/k/<fileId>.json */
export async function sealKeyForCode(code, fullKey, iterations) {
  const { fileId, aesKey } = await deriveFromCode(code, iterations);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(fileId) }, aesKey, new TextEncoder().encode(fullKey)));
  return { fileId, file: JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) }) };
}

/** App side: decrypt a downloaded file. Throws if the file is not for this code or was altered. */
export async function openSealedKey(fileId, aesKey, fileText) {
  if (typeof fileText !== 'string' || fileText.length > 4096) throw new Error('bad file');
  const f = JSON.parse(fileText);
  if (f?.v !== 1 || typeof f.iv !== 'string' || typeof f.ct !== 'string') throw new Error('bad file');
  const iv = unb64(f.iv); if (iv.length !== 12) throw new Error('bad file');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(fileId) }, aesKey, unb64(f.ct));
  return new TextDecoder().decode(pt);
}

/**
 * App side: activate with a short code. fetchText(url) returns the body text or null for "not found".
 * Returns the same shape as verifyLicence, plus fullKey to store when ok.
 */
export async function activateShortCode(text, publicKey, { phone, now, host, fetchText }) {
  const p = parseShortCode(text);
  if (!p) return { ok: false, reason: 'format', message: 'This does not look like a licence code.' };
  if (p.error) return { ok: false, reason: 'typo', message: 'One character of the code looks wrong — please check it and type it again.' };
  if (!host) return { ok: false, reason: 'nohost', message: 'Short codes are not available yet — paste the whole licence message instead.' };
  const { fileId, aesKey } = await deriveFromCode(p.code);
  let body;
  try { body = await fetchText(`${host.replace(/\/+$/, '')}/k/${fileId}.json`); }
  catch { return { ok: false, reason: 'network', message: 'No internet. Connect once to activate the code, or paste the whole licence message (works offline).' }; }
  if (body == null) return { ok: false, reason: 'notfound', message: 'This code was not found. Check it, or ask your seller — it may not be active yet.' };
  let fullKey;
  try { fullKey = await openSealedKey(fileId, aesKey, body); } catch { return { ok: false, reason: 'signature', message: 'This licence could not be verified.' }; }
  const r = await verifyLicence(fullKey, publicKey, { phone, now });
  return r.ok ? { ...r, fullKey: extractKeyText(fullKey) } : r;
}

/** The canonical AN1-… text of the key inside some text (what the app stores). */
export function extractKeyText(text) { const b = extractKey(text); return b ? formatKey(b) : null; }
