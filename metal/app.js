import * as C from './india-core.mjs';
import * as db from './db.mjs';
import { qrSvg } from './qr.mjs';
import { effectiveNow } from './licence.mjs';
import { razorpay, keyMode, maskKey, validSecret } from './upi-gateway.mjs';
import { phonepeEdc, validEdcCreds } from './phonepe-edc.mjs';
import { matchAlert, ALERT_APPS } from './pay-alerts.mjs';
import { createMetal } from './metal-ui.mjs';
import { createSync } from './sync-ui.mjs';
import { planAllows, planActive, PAID_FEATURES } from './sync-core.mjs';
import { initNumpad, dockNumpad } from './numpad.mjs';
import { DEFAULT_SHOP_TYPE, APP_VERSION, UPDATE_URL } from './build-config.mjs';
import { readManifest, isNewer } from './update-core.mjs';

/* ================= state ================= */
const S = {
  settings: null, plan: null, products: [], departments: [], bars: [], grades: [], barSeq: 0, customers: [], sales: [], creditNotes: [], khata: [], dayClose: [],
  counters: {}, cart: newCart(), held: [], page: 'bill', cat: 'All', q: '', lang: 'en',
  itemsFilter: '', khataFilter: '', range: null
};
function newCart() { return { lines: [], customerId: null, placeOfSupply: null, billDiscountPaise: 0 }; }
const uid = () => crypto.randomUUID();
const $ = (sel, root = document) => root.querySelector(sel);
const esc = v => C.cleanText(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = C.money;
// Metal-cutting shop type (grades, bars and offcuts, cut planner) and the Miracle / Excel import live in metal-ui.mjs.
const Metal = createMetal({ S, $, esc, C, db, uid, money, modal: (...a) => modal(...a), toast: (...a) => toast(...a), confirmBox: (...a) => confirmBox(...a), qrSvg,
  rateOptions: (...a) => rateOptions(...a), printDoc: (...a) => printDoc(...a), itemsTabs: () => itemsTabs(), bindItemsTabs: p => bindItemsTabs(p),
  saveCart: () => saveCart(), renderCart: () => renderCart(), barPrefix: () => Sync.barPrefix(), can: k => can(k), dockPad: (box, scope) => (padOn() ? dockNumpad(box, scope) : null),
  go: page => go(page),
  refresh: () => { if (S.page === 'items') renderItems(); else if (S.page === 'inventory') Metal.renderInventory($('#page-inventory')); else if (S.page === 'bill') renderBill(); else if (S.page === 'home') renderHome(); } });
const isMetal = () => Metal.isMetal();   // shop type is metal AND the plan (if any) has not switched metal mode off
// Sync between a shop's devices through the sync server (encrypted on the device; see sync-core.mjs).
const Sync = createSync({ S, $, esc, db, modal: (...a) => modal(...a), toast: (...a) => toast(...a), confirmBox: (...a) => confirmBox(...a), lockTag: () => lockTag(), requirePro: (...a) => requirePro(...a),
  reload: () => reloadShared(), afterDeviceChange: () => { ownBarSeq(); },
  planChanged: async () => { if (!S.settings) return; await refreshGateway().catch(() => {}); applyChrome(); if ($('#modalRoot').children.length) S.staleView = true; else go(S.page); } });

/* ================= i18n (short UI labels; please have a native speaker review) ================= */
const T = {
  en: { 'nav.home': 'Home', 'nav.more': 'More', todaySales: "Today's sales", toCollect: 'To collect (udhaar)', lowStock: 'Low stock', keypad: 'Keypad', youGet: 'You will get', advance: 'Advance', bills: 'bills', recent: 'Recent receipts', namaste: 'Namaste',
    'nav.bill': 'Bill', 'nav.khata': 'Khata', 'nav.receipts': 'Receipts', 'nav.items': 'Items', 'nav.inventory': 'Inventory', 'nav.reports': 'Reports', 'nav.settings': 'Settings',
    search: 'Search item or scan barcode', pay: 'Pay', hold: 'Hold', clear: 'Clear', customer: 'Customer', walkin: 'Walk-in customer',
    cash: 'Cash', upi: 'UPI', card: 'Card', udhaar: 'Udhaar', total: 'Total', received: 'Payment received', newBill: 'New bill',
    print: 'Print', whatsapp: 'WhatsApp', addItem: 'Add item', receive: 'Receive payment', remind: 'Send reminder', remindShort: 'Remind', today: 'Today',
    custom: 'Custom item', empty: 'Tap an item or scan a barcode to start the bill.' },
  hi: { 'nav.home': 'होम', 'nav.more': 'और', todaySales: 'आज की बिक्री', toCollect: 'लेना है (उधार)', lowStock: 'कम स्टॉक', keypad: 'कीपैड', youGet: 'आपको मिलेंगे', advance: 'एडवांस', bills: 'बिल', recent: 'हाल की रसीदें', namaste: 'नमस्ते',
    'nav.bill': 'बिल', 'nav.khata': 'खाता', 'nav.receipts': 'रसीदें', 'nav.items': 'सामान', 'nav.inventory': 'स्टॉक माल', 'nav.reports': 'रिपोर्ट', 'nav.settings': 'सेटिंग',
    search: 'सामान खोजें या बारकोड स्कैन करें', pay: 'भुगतान', hold: 'होल्ड', clear: 'साफ़ करें', customer: 'ग्राहक', walkin: 'आम ग्राहक',
    cash: 'नकद', upi: 'UPI', card: 'कार्ड', udhaar: 'उधार', total: 'कुल', received: 'भुगतान मिल गया', newBill: 'नया बिल',
    print: 'प्रिंट', whatsapp: 'व्हाट्सऐप', addItem: 'सामान जोड़ें', receive: 'भुगतान लें', remind: 'याद दिलाएँ', remindShort: 'याद दिलाएँ', today: 'आज',
    custom: 'अन्य सामान', empty: 'बिल शुरू करने के लिए सामान चुनें या बारकोड स्कैन करें।' },
  gu: { 'nav.home': 'હોમ', 'nav.more': 'વધુ', todaySales: 'આજનું વેચાણ', toCollect: 'લેવાના બાકી (ઉધાર)', lowStock: 'ઓછો સ્ટોક', keypad: 'કીપેડ', youGet: 'તમને મળશે', advance: 'એડવાન્સ', bills: 'બિલ', recent: 'તાજેતરની રસીદો', namaste: 'નમસ્તે',
    'nav.bill': 'બિલ', 'nav.khata': 'ખાતું', 'nav.receipts': 'રસીદો', 'nav.items': 'માલ', 'nav.inventory': 'સ્ટોક માલ', 'nav.reports': 'રિપોર્ટ', 'nav.settings': 'સેટિંગ',
    search: 'માલ શોધો અથવા બારકોડ સ્કેન કરો', pay: 'ચુકવણી', hold: 'હોલ્ડ', clear: 'સાફ કરો', customer: 'ગ્રાહક', walkin: 'સામાન્ય ગ્રાહક',
    cash: 'રોકડ', upi: 'UPI', card: 'કાર્ડ', udhaar: 'ઉધાર', total: 'કુલ', received: 'ચુકવણી મળી ગઈ', newBill: 'નવું બિલ',
    print: 'પ્રિન્ટ', whatsapp: 'વોટ્સએપ', addItem: 'માલ ઉમેરો', receive: 'ચુકવણી લો', remind: 'યાદ અપાવો', remindShort: 'યાદ અપાવો', today: 'આજે',
    custom: 'અન્ય માલ', empty: 'બિલ શરૂ કરવા માલ પસંદ કરો અથવા બારકોડ સ્કેન કરો.' }
};
// A metal shop says "Credit"; a kirana shop says khata / udhaar. (English wording only.)
const METAL_EN = { 'nav.khata': 'Credit', udhaar: 'Credit', toCollect: 'To collect (credit)' };
const metalWords = () => !!S.settings && isMetal();
const t = k => (metalWords() && !T[S.lang]?.[k] || metalWords() && (S.lang || 'en') === 'en' ? METAL_EN[k] : undefined) ?? T[S.lang]?.[k] ?? T.en[k] ?? k;
const W = () => metalWords() ? { Khata: 'Credit', khata: 'credit account', Udhaar: 'Credit', udhaar: 'credit' } : { Khata: 'Khata', khata: 'khata', Udhaar: 'Udhaar', udhaar: 'udhaar' };
const payName = m => (m === 'udhaar' && metalWords() ? 'Credit' : C.PAY_MODES[m]);
const refundName = r => (r === 'Khata' && metalWords() ? 'Credit account' : r);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const MODE_LABEL = m => ({ cash: t('cash'), upi: t('upi'), card: t('card'), udhaar: t('udhaar') }[m] || m);

/* ================= ui helpers ================= */
let toastTimer;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600); }
function modal(title, body, foot = '', { wide = false, onClose } = {}) {
  const root = $('#modalRoot');
  const wrap = document.createElement('div');
  wrap.className = 'backdrop';
  wrap.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="x" data-close aria-label="Close">×</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  // wrap.guard (optional, async): return false to keep the popup open (e.g. a payment QR is live)
  wrap.addEventListener('click', async e => { if (e.target === wrap || e.target.closest('[data-close]')) { if (wrap.guard && !(await wrap.guard())) return; close(); } });
  function close() { wrap.remove(); onClose?.(); if (S.staleView && !root.children.length && S.settings) { S.staleView = false; if (S.page !== 'settings') go(S.page); } }
  wrap.close = close;
  root.appendChild(wrap);
  setTimeout(() => wrap.querySelector('[autofocus]')?.focus(), 30);
  return wrap;
}
function confirmBox(title, text, okLabel = 'OK', danger = false) {
  return new Promise(res => {
    const m = modal(title, `<p>${esc(text)}</p>`, `<button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? 'bad' : 'pri'}" id="cfOk">${esc(okLabel)}</button>`, { onClose: () => res(false) });
    $('#cfOk', m).onclick = () => { m.remove(); res(true); };
  });
}
/* ---------- native (Android/iOS app) bridges; plain browser fallbacks ---------- */
const NATIVE = !!window.Capacitor?.isNativePlatform?.();
const plugin = name => window.Capacitor?.Plugins?.[name];
function openExternal(url) {
  // Inside the app, navigating to an outside URL hands it to Android (opens WhatsApp / UPI app).
  if (NATIVE) location.href = url; else window.open(url, '_blank', 'noopener');
}
/* ---------- UPI auto-confirm: secure key storage, native HTTP, payment announcement ---------- */
// Dev-only fallbacks so the flow can be tried in a desktop browser on localhost with a mock gateway.
const DEV_LOCAL = !NATIVE && ['localhost', '127.0.0.1'].includes(location.hostname);
const secure = {
  available: () => (NATIVE && !!plugin('ShopDevice')) || DEV_LOCAL,
  async get(name) { if (NATIVE && plugin('ShopDevice')) return (await plugin('ShopDevice').secureGet({ name })).value ?? null; return DEV_LOCAL ? sessionStorage.getItem('dev-secure-' + name) : null; },
  async set(name, value) { if (NATIVE && plugin('ShopDevice')) return plugin('ShopDevice').secureSet({ name, value }); if (DEV_LOCAL) sessionStorage.setItem('dev-secure-' + name, value); },
  async remove(name) { if (NATIVE && plugin('ShopDevice')) return plugin('ShopDevice').secureRemove({ name }); if (DEV_LOCAL) sessionStorage.removeItem('dev-secure-' + name); }
};
function gatewayHttp() {
  const H = plugin('CapacitorHttp');
  if (NATIVE && H) return req => H.request({ ...req, connectTimeout: 10000, readTimeout: 15000 });
  return DEV_LOCAL && typeof window.__gatewayHttp === 'function' ? window.__gatewayHttp : null;
}
async function refreshGateway() {
  S.gw = null; S.gwInfo = null; S.edc = null; S.edcInfo = null;
  try {
    const raw = await secure.get('phonepe'); const http = gatewayHttp();
    if (raw) { const c = JSON.parse(raw); if (validEdcCreds(c)) { S.edcInfo = { env: c.env, terminal: '••••' + c.terminalId.slice(-4) }; if (http) S.edc = phonepeEdc({ ...c, http }); } }
  } catch { S.edc = null; }
  try {
    const raw = await secure.get('razorpay'); const http = gatewayHttp();
    if (!raw) return;
    const { keyId, keySecret } = JSON.parse(raw);
    S.gwInfo = { mode: keyMode(keyId), keyMasked: maskKey(keyId) };
    if (http) S.gw = razorpay({ keyId, keySecret, http });
  } catch { S.gw = null; }
}
const useGateway = () => can('gateway') && !!S.gw;
const onDevice = () => ['device', 'phonepe'].includes(S.settings.payDevice); // the QR is on shop hardware, not the phone
const useEdc = () => can('edc') && !!S.edc && S.settings.payDevice === 'phonepe';
/** Download the QR picture from Razorpay and turn it into a data: URL (only real images, max 2 MB). */
async function fetchQrImage(url) {
  const res = await gatewayHttp()({ method: 'GET', url, responseType: 'blob' });
  const type = String(Object.entries(res.headers || {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1] || '').split(';')[0].trim().toLowerCase();
  const data = String(res.data || '');
  if (res.status !== 200 || !/^image\/(png|jpeg|webp|svg\+xml)$/.test(type) || data.length > 2.8e6 || !/^[A-Za-z0-9+/=\s]+$/.test(data)) throw new Error('QR picture could not be loaded');
  return `data:${type};base64,${data.replace(/\s/g, '')}`;
}
let audioCtx;
function unlockAudio() { try { audioCtx ??= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch {} }
function chime() {
  try {
    unlockAudio(); const t0 = audioCtx.currentTime;
    [[880, 0], [1320, 0.18]].forEach(([f, d]) => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.5, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.6);
      o.connect(g).connect(audioCtx.destination); o.start(t0 + d); o.stop(t0 + d + 0.65); });
  } catch {}
}
function paymentWords(amountPaise, lang) {
  const r = Math.floor(amountPaise / 100), p = amountPaise % 100;
  if (lang === 'hi') return `${r} रुपये${p ? ` ${p} पैसे` : ''} प्राप्त हुए`;
  if (lang === 'gu') return `${r} રૂપિયા${p ? ` ${p} પૈસા` : ''} મળ્યા`;
  return `Received ${r} rupees${p ? ` ${p} paise` : ''}`;
}
function announcePayment(amountPaise) {
  chime(); try { navigator.vibrate?.([120, 80, 120]); } catch {}
  const text = paymentWords(amountPaise, S.lang);
  setTimeout(() => {
    if (NATIVE && plugin('ShopDevice')) plugin('ShopDevice').speak({ text, lang: S.lang }).catch(() => {});
    else try { const u = new SpeechSynthesisUtterance(text); u.lang = { hi: 'hi-IN', gu: 'gu-IN' }[S.lang] || 'en-IN'; speechSynthesis.speak(u); } catch {}
  }, 700);
}
const usedPaymentIds = () => new Set(S.sales.flatMap(x => x.payments || []).filter(p => p.gateway).map(p => p.ref));
/* ---------- free UPI auto-confirm from payment-app alerts (Google Pay / PhonePe / Paytm for Business) ---------- */
const alertsPlugin = () => (NATIVE ? plugin('PaymentAlerts') : null) || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? window.__payAlerts : null);
const useAlerts = () => !!(S.settings?.payAlerts && can('alerts') && alertsPlugin());
/**
 * Watch for an alert of exactly amountPaise that arrives after now. Calls onPaid(match) once.
 * Returns stop(). Polls every 1.5 s and also reacts to the instant 'alert' event.
 */
function watchAlerts(amountPaise, onPaid, onState) {
  const pl = alertsPlugin(); if (!pl) return () => {};
  const since = Date.now(); let stopped = false, handle = null;
  const check = async () => {
    if (stopped) return;
    try {
      const { alerts } = await pl.recent({ since: since - 5000 });
      const hit = matchAlert(alerts, amountPaise, since, usedPaymentIds());
      if (hit && !stopped) { stopped = true; handle?.remove?.(); onPaid(hit); }
    } catch {}
  };
  pl.status?.().then(st => { if (!stopped) onState?.(st); if (st && st.enabled && !st.connected) pl.rebind?.(); }).catch(() => {});
  Promise.resolve(pl.addListener?.('alert', () => check())).then(h => { handle = h; if (stopped) h?.remove?.(); }).catch(() => {});
  const timer = setInterval(check, 1500); check();
  return () => { stopped = true; clearInterval(timer); handle?.remove?.(); };
}
async function nativeShareFile(name, data, { base64 = false, text = '' } = {}) {
  const fs = plugin('Filesystem'), share = plugin('Share');
  const w = await fs.writeFile({ path: name, data, directory: 'CACHE', ...(base64 ? {} : { encoding: 'utf8' }) });
  await share.share({ title: name, text: text || undefined, files: [w.uri], dialogTitle: 'Share' });
}
function blobToBase64(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); }); }
async function download(name, text, type = 'text/csv') {
  if (NATIVE) { try { await nativeShareFile(name, text); } catch (e) { if (!/cancel/i.test(e.message)) toast('Could not save file: ' + e.message); } return; }
  const blob = new Blob([text], { type });
  const file = new File([blob], name, { type });
  if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer:coarse)').matches) {
    navigator.share({ files: [file], title: name }).catch(() => {});
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function stateOptions(sel) { return Object.entries(C.STATES).map(([c, n]) => `<option value="${c}"${c === sel ? ' selected' : ''}>${c} – ${esc(n)}</option>`).join(''); }
function rateOptions(sel) { return C.GST_RATES.map(r => `<option value="${r}"${Number(sel) === r ? ' selected' : ''}>${r}%</option>`).join(''); }
function unitOptions(sel) { return Object.entries(C.UQC).map(([c, n]) => `<option value="${c}"${c === sel ? ' selected' : ''}>${c} – ${n}</option>`).join(''); }
const unitShort = u => ({ KGS: 'kg', GMS: 'g', LTR: 'L', MLT: 'ml', MTR: 'm', PCS: 'pc', NOS: 'no', PAC: 'pack', BOX: 'box', DOZ: 'dozen', BTL: 'btl', SET: 'set', PRS: 'pair', BAG: 'bag' }[u] || esc(String(u || '').toLowerCase()));
const fmtQty = (q, u) => `${Number((Number(q) || 0).toFixed(3))} ${unitShort(u)}`;
const customerById = id => S.customers.find(c => c.id === id);
const balanceOf = id => C.khataBalance(S.khata, id);

/* ================= subscription features (set per shop by the provider; no prices or purchase links inside the app — Play policy) ================= */
// Licence keys were retired in 1.2.0: paid features now come only from the shop's subscription plan, which arrives through
// "Sync devices & subscription" in Settings (connect once with the invite code from the provider).
/** A clock that cannot simply be wound back to stretch a plan: never earlier than a day before the latest time this device has seen. */
async function refreshClock() {
  const maxSeen = Math.max(await db.kvGet('maxSeen', 0), S.sales[0]?.at || 0);
  S.licenceNow = effectiveNow(Date.now(), maxSeen);
  if (Date.now() > maxSeen) await db.kvSet('maxSeen', Date.now());
}
const FEATURE_LABEL = { sync: 'Sync between phone, tablet and PC', gateway: 'UPI auto-confirm with sound (Razorpay)', edc: 'PhonePe card machine link', alerts: 'UPI auto-confirm from payment app alerts',
  gstr1: 'GSTR-1 files for your CA', register: 'Sales register (CSV)', reports: 'Monthly and custom-date reports', csv: 'Item list import / export (CSV)', metal: 'Metal cutting mode', miracle: 'Import from Miracle / Excel' };
const featureKey = label => Object.keys(FEATURE_LABEL).find(k => FEATURE_LABEL[k] === label || label.startsWith(FEATURE_LABEL[k]));
const planNow = () => Math.max(Date.now(), S.licenceNow || 0);
/** May this shop use the feature right now? */
const can = key => planAllows(S.plan, key, planNow());
const isPro = () => planActive(S.plan, planNow()) && PAID_FEATURES.some(k => S.plan.features[k]);
const lockTag = key => ((key ? can(key) : isPro()) ? '' : '🔒 ');
function requirePro(feature, fn) { const key = featureKey(feature); return (...a) => ((key ? can(key) : isPro()) ? fn(...a) : planModal(feature)); }
/** Why a feature is locked, and what to do about it. */
function planModal(feature) {
  const p = S.plan, on = planActive(p, planNow());
  const m = modal(feature ? '🔒 Not in your plan' : 'Your plan', `
    ${feature ? `<p><b>${esc(feature)}</b> is a subscription feature.</p>` : ''}
    ${!p ? `<div class="alert warn">This shop is not connected to a subscription yet.</div>
        <p class="hint">Ask your provider for an <b>invite code</b>, then open Settings → Sync devices & subscription → “Connect with an invite code”. The features in your plan switch on by themselves.</p>`
      : !on ? `<div class="alert warn">Your subscription has ${p.status === 'suspended' ? 'been paused' : 'ended'}. Renew it with your provider and the features switch back on by themselves.</div>`
      : feature ? '<div class="alert warn">Your subscription plan does not include this feature. Ask your provider to turn it on — it switches on here by itself.</div>' : ''}
    ${p ? `<p class="hint">Included now: ${PAID_FEATURES.filter(k => can(k)).map(k => esc(FEATURE_LABEL[k])).join(' · ') || 'no extra features'}.</p>` : ''}
    <p class="hint">Billing, UPI QR, ${W().khata}, receipts and WhatsApp are always free and never switch off.</p>`,
    `${!p ? '<button class="btn pri big" id="pmGo">Open Settings</button>' : '<button class="btn" data-close>OK</button>'}`);
  $('#pmGo', m)?.addEventListener('click', () => { m.close(); go('settings'); });
}
function gatewayCard() {
  const st = S.gwInfo;
  const dev = ['device', 'phonepe'].includes(S.settings.payDevice) ? S.settings.payDevice : 'phone';
  return `<div class="card section" id="gwCard"><h2>UPI payments</h2>
    <label>Where does the customer see the UPI QR?<select id="gwDevice">
      <option value="phone"${dev === 'phone' ? ' selected' : ''}>On this phone / tablet (QR for the exact bill amount)</option>
      <option value="device"${dev === 'device' ? ' selected' : ''}>On my payment device from the bank / gateway (soundbox QR, card machine)</option>
      <option value="phonepe"${dev === 'phonepe' ? ' selected' : ''}>On my PhonePe card machine — the app sends the amount to it</option></select></label>
    ${dev === 'phonepe' ? `<div class="card" style="margin:8px 0;padding:10px"><b>${lockTag('edc')}PhonePe card machine</b>
      ${S.edcInfo ? `<p>✓ Connected · terminal ${esc(S.edcInfo.terminal)} · ${S.edcInfo.env === 'uat' ? 'TEST (UAT)' : 'Live'}${can('edc') ? '' : ' · <b>not in your plan</b>'}</p>` : '<p class="hint">Not connected yet — until then the machine is used like any other device (tap “Payment received”).</p>'}
      <div class="row"><button class="btn ${S.edcInfo ? 'ghost' : 'pri'}" id="edcConnect"${secure.available() ? '' : ' disabled'}>${S.edcInfo ? 'Change details' : 'Connect PhonePe machine'}</button>${S.edcInfo ? '<button class="btn ghost" id="edcOff">Disconnect</button>' : ''}</div></div>` : ''}
    <p class="hint">${dev === 'phonepe' ? 'Tap UPI or Card at checkout and the amount appears on your PhonePe machine. The customer pays there and the app finishes the bill by itself.' : dev === 'device' ? 'The app shows only the amount to collect — no QR on the phone. With Razorpay connected (Pro), it confirms the payment by itself when that exact amount reaches your Razorpay account; otherwise tap “Payment received” when your device announces it.' : 'The app shows a QR for the exact bill amount; the customer cannot change the amount.'}</p>
    <h3 style="margin-top:14px">${lockTag('alerts')}Free auto-confirm from your payment app</h3>
    <p class="hint">Use <b>Google Pay for Business, PhonePe Business or Paytm for Business</b> (or the normal Google Pay / PhonePe / Paytm / BHIM app) on this phone for your shop's UPI ID. When it shows “₹250 received”, this app matches it to the open bill, rings, says the amount and opens the receipt. <b>No gateway, no fees.</b></p>
    ${alertsPlugin() || !NATIVE ? `<label class="check"><input type="checkbox" id="alOn"${S.settings.payAlerts ? ' checked' : ''}${alertsPlugin() ? '' : ' disabled'}> Auto-confirm UPI from payment app alerts</label>
      <div id="alAccess" class="hint"></div>
      <p class="hint">🔒 Only alerts from those payment apps are read — every other notification is ignored. Nothing is stored or sent anywhere; the app keeps the last few payment alerts in memory for 30 minutes. You can turn it off any time in Android settings.</p>` : ''}
    ${!NATIVE ? '<div class="alert warn">Available in the Android app.</div>' : ''}
    <h3 style="margin-top:14px">${lockTag('gateway')}Auto-confirm with Razorpay</h3>
    <p class="hint">Each bill gets its own QR on <b>your own Razorpay account</b>. When the customer pays, the app rings, says the amount and finishes the bill — no checking the bank app. Money goes straight to your Razorpay account; this app never touches it.</p>
    ${!secure.available() ? '<div class="alert warn">Available in the Android app.</div>' : st ? `<p><b>✓ Connected</b> · ${st.mode === 'test' ? 'TEST mode (no real money)' : 'Live'} · Key ${esc(st.keyMasked)}${isPro() ? '' : ' · <b>needs Pro</b>'}</p>` : ''}
    <div class="row"><button class="btn ${st ? 'ghost' : 'pri'}" id="gwConnect"${secure.available() ? '' : ' disabled'}>${st ? 'Change keys' : 'Connect Razorpay'}</button><button class="btn ghost" id="gwSound">🔔 Test sound</button>${st ? '<button class="btn ghost" id="gwOff">Disconnect</button>' : ''}</div>
    <p class="hint">Have a Paytm / PhonePe soundbox? It only announces payments made to that company's QR, so it stays quiet for these QR codes — this app announces them instead.</p></div>`;
}
function wireGatewayCard(root) {
  const redraw = () => { $('#gwCard').outerHTML = gatewayCard(); wireGatewayCard(root); };
  $('#gwConnect', root).onclick = requirePro('UPI auto-confirm with sound (Razorpay)', () => gatewayModal(redraw));
  $('#gwSound', root).onclick = () => announcePayment(25000);
  const pl = alertsPlugin(), access = $('#alAccess', root);
  const showAccess = async () => {
    if (!pl || !access) return;
    const st = await pl.status().catch(() => null);
    access.innerHTML = st?.enabled ? `✓ Notification access is on${st.connected ? '' : ' (connecting…)'} · reads: ${esc(Object.values(ALERT_APPS).join(', '))}`
      : '<div class="alert warn" style="margin:6px 0">Notification access is off. Tap below, find <b>Atmanirbhar</b> and allow it.</div><button class="btn sm pri" id="alOpen">Open Android setting</button>';
    $('#alOpen', root)?.addEventListener('click', () => pl.openSettings().catch(() => toast('Open Settings → Notifications → Notification access')));
  };
  if (S.settings.payAlerts) showAccess();
  $('#alOn', root)?.addEventListener('change', requirePro('UPI auto-confirm from payment app alerts', async () => {
    const on = $('#alOn', root).checked;
    if (on && !await confirmBox('Read payment alerts?', 'Atmanirbhar will read notifications from Google Pay, PhonePe, Paytm and BHIM only, to spot “money received” alerts and finish the bill. Other notifications are ignored and nothing leaves this phone. Android will ask you to allow Notification access.', 'Allow')) { $('#alOn', root).checked = false; return; }
    S.settings.payAlerts = on; await db.kvSet('settings', S.settings); redraw();
    if (on) { const st = await pl?.status().catch(() => null); if (!st?.enabled) pl?.openSettings().catch(() => {}); }
  }));
  if (!can('alerts') && $('#alOn', root)) $('#alOn', root).addEventListener('click', e => { if (!can('alerts')) { e.preventDefault(); planModal('UPI auto-confirm from payment app alerts'); } });
  $('#edcConnect', root)?.addEventListener('click', requirePro('PhonePe card machine link', () => edcModal(redraw)));
  $('#edcOff', root)?.addEventListener('click', async () => {
    if (!await confirmBox('Disconnect PhonePe machine?', 'The PhonePe details are deleted from this phone.', 'Disconnect', true)) return;
    await secure.remove('phonepe'); await refreshGateway(); redraw();
  });
  $('#gwDevice', root).onchange = async e => { S.settings.payDevice = e.target.value; await db.kvSet('settings', S.settings); redraw(); toast('Saved'); };
  $('#gwOff', root)?.addEventListener('click', async () => {
    if (!await confirmBox('Disconnect Razorpay?', 'The keys are deleted from this phone. UPI goes back to your own QR with manual confirmation.', 'Disconnect', true)) return;
    await secure.remove('razorpay'); await refreshGateway(); redraw();
  });
}
function edcModal(done) {
  const m = modal('Connect PhonePe card machine', `
    <p class="hint">Ask PhonePe (your PhonePe business contact) to enable <b>Integrated EDC</b> for your machine. They give you these details:</p>
    <div class="grid2"><label>Merchant ID<input id="edMid" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="64"></label>
    <label>Store ID<input id="edSid" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="64"></label></div>
    <label>Terminal ID (on the machine)<input id="edTid" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="64"></label>
    <div class="grid2"><label>Salt key<input id="edKey" type="password" autocomplete="off" spellcheck="false" maxlength="128"></label>
    <label>Salt index<input id="edIdx" inputmode="numeric" maxlength="3" value="1"></label></div>
    <label>Mode<select id="edEnv"><option value="uat">Test (UAT) — no real money</option><option value="prod">Live</option></select></label>
    <p class="hint">Stored encrypted on this phone only (Android Keystore), sent only to PhonePe, never in backups. Never share the salt key.</p><div id="edMsg"></div>`,
    `<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="edSave">Check and save</button>`);
  $('#edSave', m).onclick = async () => {
    const v = id => $(id, m).value.trim();
    const c = { merchantId: v('#edMid'), storeId: v('#edSid'), terminalId: v('#edTid'), saltKey: v('#edKey'), saltIndex: v('#edIdx'), env: v('#edEnv') };
    const msg = $('#edMsg', m);
    if (!validEdcCreds(c)) return msg.innerHTML = '<div class="alert bad">Please check the details — IDs use letters, digits and _ only; the salt index is a number.</div>';
    const http = gatewayHttp(); if (!http) return msg.innerHTML = '<div class="alert bad">Available in the Android app.</div>';
    $('#edSave', m).disabled = true; msg.innerHTML = '<p class="hint">Checking with PhonePe…</p>';
    try {
      await phonepeEdc({ ...c, http }).test();
      await secure.set('phonepe', JSON.stringify(c)); await refreshGateway(); m.close(); toast('PhonePe machine connected ✓'); done();
    } catch (e) { $('#edSave', m).disabled = false; msg.innerHTML = `<div class="alert bad">${esc(e.message || 'Could not connect.')}</div>`; }
  };
}
function gatewayModal(done) {
  const m = modal('Connect Razorpay', `
    <ol class="hint" style="padding-left:18px;margin:0 0 10px">
      <li>Log in to the Razorpay Dashboard → <b>Account &amp; Settings → API Keys</b> → generate a key.</li>
      <li>Ask Razorpay support to turn on <b>QR Codes</b> for your account (one time).</li>
      <li>Type both keys below. Start with <b>Test</b> keys (rzp_test_…) to try it safely.</li></ol>
    <label>Key ID<input id="gwKey" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="60" placeholder="rzp_live_…"></label>
    <label>Key Secret<input id="gwSecret" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="80"></label>
    <p class="hint">The secret is stored encrypted on this phone only (Android Keystore). It is never sent anywhere except to Razorpay, and is not included in backups. Never share it.</p><div id="gwMsg"></div>`,
    `<button class="btn ghost" data-close>Cancel</button><button class="btn pri" id="gwSave">Check and save</button>`);
  $('#gwSave', m).onclick = async () => {
    const keyId = $('#gwKey', m).value.trim(), keySecret = $('#gwSecret', m).value.trim(), msg = $('#gwMsg', m);
    if (!keyMode(keyId)) return msg.innerHTML = '<div class="alert bad">Key ID should start with rzp_live_ or rzp_test_.</div>';
    if (!validSecret(keySecret)) return msg.innerHTML = '<div class="alert bad">The Key Secret does not look right — copy it again from Razorpay.</div>';
    const http = gatewayHttp(); if (!http) return msg.innerHTML = '<div class="alert bad">Available in the Android app.</div>';
    $('#gwSave', m).disabled = true; msg.innerHTML = '<p class="hint">Checking with Razorpay…</p>';
    try {
      const gw = razorpay({ keyId, keySecret, http });
      await gw.test();
      const qr = await gw.createQr({ amountPaise: 100, billRef: 'SETUP-CHECK', shopName: S.settings.shopName }); // proves QR Codes are enabled; closed at once
      await gw.close(qr.id);
      await secure.set('razorpay', JSON.stringify({ keyId, keySecret }));
      await refreshGateway(); m.close(); toast('Razorpay connected ✓'); done();
    } catch (e) {
      $('#gwSave', m).disabled = false;
      msg.innerHTML = `<div class="alert bad">${esc(e.kind === 'feature' ? 'Keys are fine, but QR Codes are not turned on for your Razorpay account yet. Ask Razorpay support to enable “QR Codes”, then try again.' : e.message || 'Could not connect.')}</div>`;
    }
  };
}

/* ================= boot ================= */
/** Highest stock-label number this device has used (labels are B-0001… here, B2-0001… on a shop's second device). */
function ownBarSeq() { const re = new RegExp('^' + Sync.barPrefix() + '-(\\d+)$', 'i'); S.barSeq = Math.max(S.barSeqSaved || 0, S.barSeq || 0, ...S.bars.map(b => Number(re.exec(b.code)?.[1]) || 0)); }
/** Reads everything a shop's devices share. Used at start-up and again whenever sync brings in changes. */
async function loadShared() {
  S.departments = await db.kvGet('departments', []);
  if (!Array.isArray(S.departments)) S.departments = [];
  for (const s of ['products', 'customers', 'sales', 'creditNotes', 'khata', 'dayClose', 'bars']) S[s] = await db.all(s);
  S.grades = await db.kvGet('grades', []); if (!Array.isArray(S.grades)) S.grades = [];
  S.grades = S.grades.filter(g => g && typeof g === 'object' && typeof g.id === 'string' && typeof g.name === 'string' && g.name.trim() && typeof g.density === 'number' && g.density >= 500 && g.density <= 25000)
    .map(g => ({ id: g.id, name: g.name.slice(0, 20), density: g.density, ratePaise: Number.isSafeInteger(g.ratePaise) && g.ratePaise >= 0 ? g.ratePaise : 0, hsn: C.validHsn(g.hsn) ? String(g.hsn) : '', gstRate: C.GST_RATES.includes(g.gstRate) ? g.gstRate : 18 }));
  S.bars = S.bars.filter(b => b && typeof b === 'object' && typeof b.id === 'string' && typeof b.code === 'string' && /^[A-Za-z0-9-]{1,12}$/.test(b.code) && typeof b.materialId === 'string' && typeof b.lengthMm === 'number' && Number.isFinite(b.lengthMm) && b.lengthMm >= 0 && b.lengthMm <= 100000 && ['stock', 'used', 'scrap', 'void'].includes(b.status))
    .map(b => ({ ...b, origLengthMm: typeof b.origLengthMm === 'number' && Number.isFinite(b.origLengthMm) && b.origLengthMm >= b.lengthMm ? b.origLengthMm : b.lengthMm, receivedAt: Number(b.receivedAt) || 0, supplierCode: typeof b.supplierCode === 'string' ? b.supplierCode.slice(0, 60) : '', supplier: typeof b.supplier === 'string' ? C.cleanText(b.supplier).replace(/[<>"]/g, '').slice(0, 30) : '', heatNo: typeof b.heatNo === 'string' ? b.heatNo.replace(/[^A-Za-z0-9/ -]/g, '').slice(0, 24) : '' }));
  // materials: a product only counts as a bar material when its shape and sizes are valid numbers
  S.products = S.products.map(p => (p && p.metal && !(typeof p.metal === 'object' && typeof p.metal.shape === 'string' && Array.isArray(p.metal.dims) && p.metal.dims.every(d => typeof d === 'number' && Number.isFinite(d)) && typeof p.metal.gradeId === 'string' && (p.metal.kind == null || typeof p.metal.kind === 'string')) ? { ...p, metal: undefined } : p));
  S.barSeqSaved = Number(await db.kvGet('barSeq', 0)) || 0; ownBarSeq();
  S.sales.sort((a, b) => b.at - a.at); S.creditNotes.sort((a, b) => b.at - a.at);
}
async function reloadShared() {
  const hadSettings = !!S.settings, fresh = await db.kvGet('settings', null);
  if (fresh) S.settings = fresh;
  await loadShared(); await refreshClock();
  // bar materials: stock is always the sum of the bars, whichever device cut them
  for (const p of S.products) if (p.metal && p.active !== false) { const kg = Metal.summary(p).kg; if (Math.abs((Number(p.stock) || 0) - kg) > 0.0005) { const np = { ...p, stock: kg }; await db.put('products', np); S.products = S.products.map(k => k.id === np.id ? np : k); } }
  if (!hadSettings || !S.settings) return;
  applyChrome();
  if ($('#modalRoot').children.length) S.staleView = true; else if (S.page !== 'settings') go(S.page);
}
async function boot() {
  S.settings = await db.kvGet('settings', null);
  S.counters = await db.kvGet('counters', {});
  S.held = await db.kvGet('held', []);
  S.cart = await db.kvGet('cart', newCart());
  // a restored backup can't put impossible numbers into an open or held bill
  const num = (v, max = 1e7) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
  const okMetal = m => m && typeof m === 'object' && Number.isInteger(m.pieces) && m.pieces > 0 && m.pieces <= 100000 && num(m.pieceMm, 100000) && Array.isArray(m.cuts) && m.cuts.length <= 200 &&
    m.cuts.every(c => c && typeof c === 'object' && (c.barId == null || typeof c.barId === 'string') && Number.isInteger(c.pieces) && c.pieces > 0 && num(c.beforeMm, 100000) && num(c.usedMm, 100000) && num(c.afterMm, 100000) && c.afterMm <= c.beforeMm && typeof (c.code ?? '') === 'string');
  const okLine = l => l && typeof l === 'object' && (l.metal == null || okMetal(l.metal)) && Number.isFinite(l.qty) && l.qty > 0 && l.qty <= 100000 && Number.isSafeInteger(l.pricePaise) && l.pricePaise >= 0 && l.pricePaise <= 1e10 && (l.discountPaise == null || (Number.isSafeInteger(l.discountPaise) && l.discountPaise >= 0));
  const okCart = c => c && typeof c === 'object' && Array.isArray(c.lines) ? { ...newCart(), ...c, lines: c.lines.filter(okLine), billDiscountPaise: Number.isSafeInteger(c.billDiscountPaise) && c.billDiscountPaise >= 0 ? c.billDiscountPaise : 0 } : newCart();
  S.cart = okCart(S.cart);
  S.held = (Array.isArray(S.held) ? S.held : []).filter(h => h && typeof h === 'object').map(h => ({ ...h, cart: okCart(h.cart) })).slice(0, 10);
  await Sync.init();
  await loadShared();
  S.lang = S.settings?.lang || 'en';
  $('#langSelect').value = S.lang;
  if (!S.settings) return renderSetup();
  await refreshClock(); await refreshGateway(); await Metal.ensureDefaults();
  applyChrome(); go('home');
}
function applyChrome() {
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
  $('#brandName').textContent = S.settings?.shopName || 'Atmanirbhar';
  $('#shopLine').textContent = S.settings ? `${S.settings.shopName} · ${C.REGIMES[S.settings.regime].label}${S.settings.gstin ? ' · ' + S.settings.gstin : ''}` : '';
  document.documentElement.lang = S.lang;
  document.querySelectorAll('.nav[data-page="inventory"]').forEach(b => { b.hidden = !isMetal(); });
}
function go(page) {
  if (page === 'inventory' && !isMetal()) page = 'items';
  S.page = page;
  document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => { p.hidden = p.id !== `page-${page}`; });
  const pg = $(`#page-${page}`); pg.classList.remove('enter'); void pg.offsetWidth; pg.classList.add('enter');
  $('#pageTitle').textContent = t(`nav.${page}`);
  ({ home: renderHome, more: renderMore, bill: renderBill, khata: renderKhata, receipts: renderReceipts, items: renderItems, inventory: () => Metal.renderInventory($('#page-inventory')), reports: renderReports, settings: renderSettings })[page]();
}
document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => S.settings && go(b.dataset.page)));
$('#langSelect').addEventListener('change', async e => {
  S.lang = e.target.value;
  if (S.settings) { S.settings.lang = S.lang; await db.kvSet('settings', S.settings); applyChrome(); go(S.page); }
});
function netChip() { const c = $('#netChip'); c.textContent = navigator.onLine ? '● Online · data on this device' : '● Offline · billing works'; c.classList.toggle('off', !navigator.onLine); }
addEventListener('online', netChip); addEventListener('offline', netChip); netChip();
// Live time and date pill in the header (IST)
function clockChip() { const c = $('#clockChip'); if (!c) return; const d = new Date(); c.textContent = new Intl.DateTimeFormat('en-IN', { timeZone: C.TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(d); }
clockChip(); setInterval(clockChip, 30000);

/* ================= setup ================= */
function settingsForm(s = {}, { quick = false } = {}) {
  // quick = first-time setup: only the shop name and address are needed; everything else waits in a closed section.
  return `
  <div class="card"><h2>Shop details</h2>
    <label>Shop name${quick ? ' *' : ' (as on GST registration)'}<input id="f_shopName" maxlength="80" value="${esc(s.shopName)}" required></label>
    <label>Full address${quick ? ' *' : ''}<textarea id="f_address" rows="2" maxlength="250">${esc(s.address)}</textarea></label>
    <div class="grid2">
      <label>State<select id="f_state">${stateOptions(s.stateCode || '24')}</select></label>
      <label>Phone${quick ? ' (optional)' : ''}<input id="f_phone" type="tel" inputmode="numeric" maxlength="14" value="${esc(s.phone)}"></label>
    </div>
    ${quick ? `</div><details class="morefields"><summary>More details — GST, UPI, FSSAI, printer <span>optional · you can add these later in Settings</span></summary><div class="card">` : ''}
    <label>FSSAI licence / registration no. (14 digits — required on bills if you sell food)<input id="f_fssai" inputmode="numeric" maxlength="14" value="${esc(s.fssai || '')}"></label>
  </div>
  <div class="card"><h2>GST</h2>
    <label>GST registration<select id="f_regime">${Object.entries(C.REGIMES).map(([k, v]) => `<option value="${k}"${(s.regime || (quick ? 'unregistered' : 'regular')) === k ? ' selected' : ''}>${v.label}</option>`).join('')}</select></label>
    <p class="hint">Regular → Tax Invoice with CGST/SGST or IGST. Composition → Bill of Supply, no tax shown. Not registered (turnover below the limit) → simple bill.</p>
    <div id="gstFields">
      <label>GSTIN<input id="f_gstin" maxlength="15" autocapitalize="characters" value="${esc(s.gstin)}" placeholder="24ABCDE1234F1Z5"></label>
      <label class="row" style="color:var(--ink)"><input type="checkbox" id="f_turnover" style="width:auto;min-height:auto"${s.turnoverAbove5Cr ? ' checked' : ''}> Annual turnover above ₹5 crore (6-digit HSN on all bills, e-invoice for B2B)</label>
    </div>
  </div>
  <div class="card"><h2>UPI</h2>
    <label>Your UPI ID (VPA)<input id="f_vpa" maxlength="80" autocapitalize="none" value="${esc(s.upiVpa)}" placeholder="shopname@okaxis"></label>
    <label>Name shown in customer's UPI app<input id="f_upiName" maxlength="50" value="${esc(s.upiName || s.shopName)}"></label>
    <label class="row" style="color:var(--ink)"><input type="checkbox" id="f_merchant" style="width:auto;min-height:auto"${s.merchantUpi ? ' checked' : ''}> This is a merchant / business UPI ID (from my bank or PhonePe/Paytm/GPay for Business)</label>
    <label>Merchant category code (optional, e.g. 5411 grocery)<input id="f_mcc" inputmode="numeric" maxlength="4" value="${esc(s.mcc || '')}"></label>
    <p class="hint">Use a business UPI ID for shop sales — banks may limit personal UPI IDs that receive many payments. UPI to merchants has no MDR charge.</p>
  </div>
  <div class="card"><h2>Bills</h2>
    <div class="grid2">
      <label>Invoice prefix (max 4 letters)<input id="f_prefix" maxlength="4" value="${esc(s.invoicePrefix || 'INV')}"></label>
      <label>Credit note prefix<input id="f_cnprefix" maxlength="4" value="${esc(s.cnPrefix || 'CN')}"></label>
    </div>
    <p class="hint">Numbers look like INV/26-27/000001 and restart every 1 April (financial year), as GST Rule 46 requires.</p>
    <label>Printer paper<select id="f_paper"><option value="w58"${s.paper === 'w58' ? ' selected' : ''}>58 mm thermal (2 inch)</option><option value="w80"${(s.paper || 'w80') === 'w80' ? ' selected' : ''}>80 mm thermal (3 inch)</option><option value="a4"${s.paper === 'a4' ? ' selected' : ''}>A4</option></select></label>
    <label>Bill footer<input id="f_footer" maxlength="120" value="${esc(s.footer ?? 'Thank you! Visit again.')}"></label>
  </div>${quick ? '</details>' : ''}`;
}
function wireSettingsForm(root) {
  const sync = () => { $('#gstFields', root).hidden = $('#f_regime', root).value === 'unregistered'; };
  $('#f_regime', root).addEventListener('change', sync); sync();
}
function readSettingsForm(root, base = {}) {
  const v = id => $(id, root).value.trim();
  const s = { ...base, shopName: v('#f_shopName'), address: v('#f_address'), stateCode: v('#f_state'), phone: v('#f_phone'), fssai: v('#f_fssai'),
    regime: v('#f_regime'), gstin: v('#f_gstin').toUpperCase(), turnoverAbove5Cr: $('#f_turnover', root).checked,
    upiVpa: v('#f_vpa'), upiName: v('#f_upiName'), merchantUpi: $('#f_merchant', root).checked, mcc: v('#f_mcc'),
    invoicePrefix: C.cleanPrefix(v('#f_prefix')) || 'INV', cnPrefix: C.cleanPrefix(v('#f_cnprefix')) || 'CN',
    paper: v('#f_paper'), footer: v('#f_footer'), lang: S.lang };
  const errs = [];
  if (!s.shopName) errs.push('Enter the shop name.');
  if (!s.address) errs.push('Enter the shop address (required on every bill).');
  if (s.regime !== 'unregistered') {
    const g = C.validateGstin(s.gstin);
    if (!g.ok) errs.push(g.error);
    else if (g.stateCode !== s.stateCode) errs.push(`GSTIN state code ${g.stateCode} does not match the selected state ${s.stateCode}.`);
  } else { s.gstin = ''; s.turnoverAbove5Cr = false; }
  if (s.fssai && !/^\d{14}$/.test(s.fssai)) errs.push('FSSAI number must be 14 digits.');
  if (s.upiVpa && !C.validateVpa(s.upiVpa)) errs.push('UPI ID looks wrong — it should look like name@bank.');
  if (s.mcc && !/^\d{4}$/.test(s.mcc)) errs.push('Merchant category code must be 4 digits.');
  if (s.invoicePrefix === s.cnPrefix) errs.push('Invoice and credit note prefixes must be different.');
  if (s.upiVpa && !s.upiName) s.upiName = s.shopName;
  return { s, errs };
}
function renderSetup() {
  document.querySelector('.rail').hidden = true;
  $('#pageTitle').textContent = 'Set up your shop';
  document.querySelectorAll('.page').forEach(p => { p.hidden = p.id !== 'page-settings'; });
  const p = $('#page-settings');
  p.innerHTML = `<div class="setup"><div class="alert ok">Welcome! Just your shop name and address to start — it takes a few seconds. Everything is saved on this device and works without internet.</div>
    <p class="hint" style="text-align:center">Independent app — not affiliated with, endorsed by or operated by the Government of India.</p>
    <div class="card"><h2>Type of shop</h2><label>What kind of shop is this?<select id="f_type"><option value="retail"${DEFAULT_SHOP_TYPE === 'metal' ? '' : ' selected'}>General / kirana / retail shop</option><option value="metal"${DEFAULT_SHOP_TYPE === 'metal' ? ' selected' : ''}>Metal cutting — bars, pipes and plates cut to size</option></select></label>
      <p class="hint">You can change this later in Settings.</p></div>
    ${settingsForm({}, { quick: true })}
    <div class="card"><label class="row" style="color:var(--ink)"><input type="checkbox" id="f_samples" checked style="width:auto;min-height:auto"> Add sample items to try (you can delete them later)</label></div>
    <div id="setupErr"></div><button class="btn pri big" style="width:100%" id="setupSave">Start billing</button>
    <button class="btn ghost" style="width:100%;margin-top:10px" id="setupJoin">Already use Atmanirbhar on another device? Join that shop with a code</button></div>`;
  wireSettingsForm(p);
  $('#setupJoin').onclick = () => Sync.join();
  $('#setupSave').onclick = async () => {
    const { s, errs } = readSettingsForm(p);
    $('#setupErr').innerHTML = errs.map(e => `<div class="alert bad">${esc(e)}</div>`).join('');
    if (errs.length && !errs.every(e => /shop name|shop address/i.test(e))) { const d = $('.morefields', p); if (d) d.open = true; }
    if (errs.length) return;
    s.createdAt = Date.now(); s.shopType = $('#f_type').value === 'metal' ? 'metal' : 'retail';
    s.gstChecked = s.regime !== 'unregistered' || !!$('.morefields', p)?.open;
    await db.kvSet('settings', s); S.settings = s; await Metal.ensureDefaults();
    if ($('#f_samples').checked) { if (isMetal()) await Metal.addSamples(); else for (const pr of sampleProducts()) { await db.put('products', pr); S.products.push(pr); } }
    document.querySelector('.rail').hidden = false;
    applyChrome(); go('home');
  };
}
function sampleProducts() {
  // Indicative GST 2.0 rates — confirm each item's HSN and rate with your CA.
  const P = (name, localName, hsn, gstRate, mrp, price, unit, category, barcode = '') => ({ id: uid(), name, localName, hsn, gstRate, cessRate: 0,
    mrpPaise: mrp ? mrp * 100 : null, pricePaise: Math.round(price * 100), priceIncludesTax: true, unit, stock: unit === 'KGS' ? 50 : 24, lowStock: unit === 'KGS' ? 5 : 5, category, barcode, active: true });
  return [
    P('Wheat Atta 5 kg (packed)', 'गेहूं आटा', '1101', 5, 290, 275, 'PAC', 'Grocery', '8900000000017'),
    P('Rice (loose)', 'चावल', '1006', 0, 0, 52, 'KGS', 'Grocery'),
    P('Sugar (loose)', 'चीनी', '1701', 5, 0, 46, 'KGS', 'Grocery'),
    P('Toor Dal 1 kg (packed)', 'तूर दाल', '0713', 5, 180, 170, 'PAC', 'Grocery', '8900000000024'),
    P('Salt 1 kg', 'नमक', '2501', 0, 28, 28, 'PAC', 'Grocery', '8900000000031'),
    P('Sunflower Oil 1 L', 'तेल', '1512', 5, 165, 155, 'BTL', 'Grocery', '8900000000048'),
    P('Milk 500 ml pouch', 'दूध', '0401', 0, 34, 34, 'PAC', 'Dairy', '8900000000055'),
    P('Biscuits 100 g', 'बिस्कुट', '1905', 5, 10, 10, 'PAC', 'Snacks', '8900000000062'),
    P('Namkeen 200 g', 'नमकीन', '2106', 5, 55, 50, 'PAC', 'Snacks', '8900000000079'),
    P('Soft drink 750 ml', 'कोल्ड ड्रिंक', '2202', 40, 45, 45, 'BTL', 'Drinks', '8900000000086'),
    P('Toothpaste 150 g', 'टूथपेस्ट', '3306', 5, 99, 95, 'PCS', 'Personal care', '8900000000093'),
    P('Bath soap 100 g', 'साबुन', '3401', 5, 40, 38, 'PCS', 'Personal care', '8900000000109'),
    P('Detergent powder 1 kg', 'सर्फ़', '3402', 18, 120, 115, 'PAC', 'Home care', '8900000000116')
  ];
}

/* ================= home dashboard (Vyapar/Khatabook-style: today, dues, quick actions) ================= */
const CAT_ICON = { grocery: '🌾', kirana: '🌾', dairy: '🥛', milk: '🥛', snacks: '🍪', drinks: '🥤', beverages: '🥤', 'personal care': '🧴', 'home care': '🧽',
  fruits: '🍎', vegetables: '🥦', sabzi: '🥦', medicine: '💊', pharmacy: '💊', stationery: '✏️', bakery: '🍞', sweets: '🍬', masala: '🌶️', spices: '🌶️',
  oil: '🫙', rice: '🍚', dal: '🫘', pulses: '🫘', frozen: '🧊', baby: '🍼', pooja: '🪔', hardware: '🔧', electrical: '💡', mobile: '📱', general: '🛍️' };
const AVATAR_COLORS = ['#e0f2ec', '#fdecd6', '#e3ecfb', '#f6e1ef', '#e9e4fb', '#fbe7e1', '#e2f3f7', '#eef3dc'];
const hashIdx = (str, n) => [...String(str)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % n;
const catIcon = cat => CAT_ICON[String(cat || '').toLowerCase()] || null;
function avatar(label, cat) {
  const icon = catIcon(cat);
  const initials = String(label || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return `<span class="avatar" style="background:${AVATAR_COLORS[hashIdx(cat || label, AVATAR_COLORS.length)]}">${icon || esc(initials)}</span>`;
}
function renderHome() {
  const p = $('#page-home'), today = C.istDate();
  const todaySales = S.sales.filter(s => C.istDate(s.at) === today);
  const sum = C.salesSummary(todaySales, S.creditNotes.filter(c => C.istDate(c.at) === today));
  const dues = S.customers.filter(c => !c.deleted).map(c => balanceOf(c.id)).filter(b => b > 0);
  const toCollect = dues.reduce((a, b) => a + b, 0);
  const low = S.products.filter(x => x.active !== false && x.stock <= (x.lowStock || 0)).length;
  const backupOld = !S.settings.lastBackup || Date.now() - S.settings.lastBackup > 7 * 864e5;
  const recent = S.sales.slice(0, 5);
  const hour = Number(new Intl.DateTimeFormat('en-IN', { timeZone: C.TZ, hour: 'numeric', hour12: false }).format(new Date()));
  p.innerHTML = `<div class="home">
    <div class="hello"><div><div class="hint">${esc(new Intl.DateTimeFormat('en-IN', { timeZone: C.TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()))}</div>
      <h2>${esc(t('namaste'))} 🙏 <span>${esc(S.settings.shopName)}</span></h2></div>
      <button class="btn pri big newbill" data-go="bill">＋ ${esc(t('newBill'))}</button></div>
    <div class="hero card">
      <div class="hero-main"><span>${esc(t('todaySales'))}</span><b class="num">${money(sum.net)}</b><small>${sum.count} ${esc(sum.count === 1 && S.lang === 'en' ? 'bill' : t('bills'))}${hour < 10 && !sum.count ? ' · Shubh din!' : ''}</small></div>
      <div class="hero-split">${['cash', 'upi', 'card', 'udhaar'].map(k => `<div><span>${{ cash: '💵', upi: '📱', card: '💳', udhaar: '📒' }[k]} ${esc(MODE_LABEL(k))}</span><b class="num">${money(sum.modes[k] || 0)}</b></div>`).join('')}</div>
    </div>
    <div class="tiles2">
      <button class="card tile-due" data-go="khata"><span>${esc(t('toCollect'))}</span><b class="num owes">${money(toCollect)}</b><small>${plural(dues.length, 'customer')} ›</small></button>
      <button class="card tile-low" data-lowstock><span>${esc(t('lowStock'))}</span><b class="${low ? 'owes' : 'clear'}">${low}</b><small>${low === 1 ? 'item' : 'items'} ›</small></button>
    </div>
    <div class="quick">
      <button data-go="bill"><span>🛒</span>${esc(t('newBill'))}</button>
      <button data-act="receive"><span>💰</span>${esc(t('receive'))}</button>
      <button data-act="additem"><span>${isMetal() ? '📥' : '📦'}</span>${esc(isMetal() ? 'Receive material' : t('addItem'))}</button>
      <button data-go="receipts"><span>🧾</span>${esc(t('nav.receipts'))}</button>
    </div>
    ${S.settings.regime === 'unregistered' && !S.settings.gstChecked ? `<div class="nudge warn nudge-row"><button data-go="settings">🧾 <b>Registered for GST?</b> Add your GSTIN in Settings so your bills show GST ›</button><button class="btn sm" id="gstNo">Not registered</button></div>` : ''}
    ${(() => { const p = S.plan; if (!p) return ''; const now = Math.max(Date.now(), S.licenceNow || 0), on = planActive(p, now), days = p.until ? Math.ceil((p.until * 1000 - now) / 864e5) : null;
      return !on ? `<button class="nudge warn" data-go="settings">⏸ <b>Subscription ${p.status === 'suspended' ? 'paused' : 'ended'}</b> — billing keeps working; syncing and extra features are off until it is renewed ›</button>`
        : days != null && days <= 7 ? `<button class="nudge warn" data-go="settings">⭐ <b>Subscription ends ${days <= 0 ? 'today' : 'in ' + days + ' day' + (days === 1 ? '' : 's')}</b> — renew with your provider to keep your features ›</button>` : ''; })()}
    ${!S.settings.upiVpa ? `<button class="nudge" data-go="settings">📱 <b>Add your UPI ID</b> to show a payment QR on every bill ›</button>` : ''}

    ${backupOld ? `<button class="nudge warn" data-act="backup">💾 <b>Backup your data</b> — ${S.settings.lastBackup ? 'last backup over a week ago' : 'never backed up'} ›</button>` : ''}
    <div class="section"><div class="row"><h2 class="grow" style="margin:0">${esc(t('recent'))}</h2><button class="btn sm ghost" data-go="receipts">All ›</button></div>
      <div class="list" style="margin-top:10px">${recent.map(s => receiptRow(s, 'invoice')).join('') || '<div class="empty">No bills yet today. Tap “New bill” to start.</div>'}</div></div>
  </div>`;
  p.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  $('#gstNo', p)?.addEventListener('click', async () => { S.settings.gstChecked = true; await db.kvSet('settings', S.settings); renderHome(); });
  $('[data-lowstock]', p).onclick = () => { S.itemsFilter = ':low'; go('items'); };
  $('[data-act="receive"]', p).onclick = () => pickCustomer(id => { if (id) receivePayment(customerById(id)); });
  $('[data-act="additem"]', p).onclick = () => (isMetal() ? Metal.receiveModal() : productModal({}));
  $('[data-act="backup"]', p)?.addEventListener('click', backupNow);
  wireReceiptRows(p);
}
function renderMore() {
  const p = $('#page-more');
  const tile = (go, icon, title, sub) => `<button class="more-tile card" data-go="${go}"><span class="mi">${icon}</span><span><b>${esc(title)}</b><small>${esc(sub)}</small></span>›</button>`;
  p.innerHTML = `<div class="more">
    ${isMetal() ? tile('inventory', '📥', t('nav.inventory'), 'Full bars, leftover pieces, receive material') : ''}
    ${tile('items', '📦', t('nav.items'), isMetal() ? 'Materials, rates, grades, import from Miracle' : 'Prices, MRP, stock, barcodes, CSV import')}
    ${tile('reports', '📊', t('nav.reports'), 'Sales, GST, day close, GSTR-1 files')}
    ${tile('settings', '⚙️', t('nav.settings'), 'Shop, GST, UPI ID, printer, backup')}
    <button class="more-tile card" id="morePlan"><span class="mi">⭐</span><span><b>Your plan</b><small>${!S.plan ? 'Not connected to a subscription' : isPro() ? 'Subscription active' + (S.plan.until ? ' · till ' + esc(C.gstDate(S.plan.until * 1000)) : '') : 'Subscription paused or ended'}</small></span>›</button>
    <button class="more-tile card" id="moreBackup"><span class="mi">💾</span><span><b>Backup now</b><small>${esc(S.settings.lastBackup ? 'Last: ' + C.displayDateTime(S.settings.lastBackup) : 'Never backed up')}</small></span>›</button>
    ${updateUrl() ? `<button class="more-tile card" id="moreUpdate"><span class="mi">⬇️</span><span><b>Check for updates</b><small>This is version ${esc(APP_VERSION)}</small></span>›</button>` : `<p class="hint" style="text-align:center">Version ${esc(APP_VERSION)}</p>`}
    <p class="hint" style="text-align:center;margin-top:8px">Independent app — not affiliated with, endorsed by or operated by the Government of India.</p>
  </div>`;
  p.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  $('#moreBackup').onclick = backupNow;
  $('#morePlan').onclick = () => planModal();
  if ($('#moreUpdate')) $('#moreUpdate').onclick = checkForUpdate;
}
/* ---------- updates for an app installed from an APK file (the Google Play build has no UPDATE_URL: Play updates it) ---------- */
const updateUrl = () => (NATIVE ? UPDATE_URL : DEV_LOCAL && typeof window.__updateUrl === 'string' ? window.__updateUrl : '');
async function fetchManifest() {
  const url = updateUrl(), bust = '?t=' + Math.floor(Date.now() / 60000);
  if (NATIVE) { const r = await plugin('CapacitorHttp').request({ method: 'GET', url: url + bust, connectTimeout: 10000, readTimeout: 15000 }); return { status: r.status, m: readManifest(r.data, url) }; }
  const r = await fetch(new URL(url).pathname + bust); return { status: r.status, m: r.ok ? readManifest(await r.text(), url) : null };
}
async function checkForUpdate() {
  const b = $('#moreUpdate'); if (b) b.disabled = true;
  let res = null; try { res = await fetchManifest(); } catch { res = null; }
  if (b) b.disabled = false;
  if (!res) return toast('Could not check. Is the internet on?');
  if (res.status === 404 || (res.m && !isNewer(res.m, APP_VERSION))) return toast(`You have the latest version (${APP_VERSION}).`);
  if (!res.m) return toast('Could not read the update details. Please try again later.');
  const m = modal(`Update available: version ${res.m.version}`, `<p>You have version ${esc(APP_VERSION)}.</p>${res.m.notes ? `<p><b>What is new</b><br>${esc(res.m.notes).replace(/\n/g, '<br>')}</p>` : ''}
    <div class="alert ok">Your bills, items and customers stay on this device when you update. To be safe, tap <b>Backup now</b> first.</div>
    <p class="hint">Tap Download. When it finishes, open the downloaded file and tap <b>Update</b>. Android may ask you to allow installing from your browser the first time.</p>`,
    `<button class="btn" id="upLater">Later</button><button class="btn pri" id="upGet">Download update</button>`);
  $('#upLater', m).onclick = () => m.close();
  $('#upGet', m).onclick = () => { openExternal(res.m.apkUrl); m.close(); };
}
async function backupNow() {
  const data = await db.exportAll();
  await download(`india-pos-backup-${C.istDate()}.json`, JSON.stringify(data), 'application/json');
  S.settings.lastBackup = Date.now(); await db.kvSet('settings', S.settings);
  if (S.page === 'home' || S.page === 'more') go(S.page);
}

/* ================= billing ================= */
const billCtx = () => ({ regime: S.settings.regime, shopState: S.settings.stateCode, placeOfSupply: S.cart.placeOfSupply || S.settings.stateCode, billDiscountPaise: S.cart.billDiscountPaise });
// Automatic offers are worked out fresh for every bill (never stored in the cart), so changing an offer updates open bills too.
const pricedLines = lines => C.applyPromotions(lines, S.products);
const currentBill = () => C.computeBill(pricedLines(S.cart.lines), billCtx());
const departments = () => {
  const list = C.departmentList(S.departments, S.products); if (!isMetal()) return list;
  // metal shop: material names first, in the shop's own order (M.S., E.N.8 …)
  const at = n => { const i = S.grades.findIndex(g => g.name.toLowerCase() === n.toLowerCase()); return i < 0 ? 1e6 : i; };
  return list.map((d, i) => [d, i]).sort((a, b) => at(a[0].name) - at(b[0].name) || a[1] - b[1]).map(k => k[0]);
};
const sameDept = (a, b) => String(a || 'General').toLowerCase() === String(b || 'General').toLowerCase();
const saveCart = () => db.kvSet('cart', S.cart);

function renderBill() {
  const p = $('#page-bill');
  S.billMode ??= 'items';
  if (isMetal() && S.billMode === 'depts') S.billMode = 'items';
  const depts = departments().filter(d => !d.implicit || S.products.some(x => x.active !== false && sameDept(x.category, d.name)));
  const cats = ['All', ...depts.map(d => d.name)];
  if (!cats.some(c => sameDept(c, S.cat))) S.cat = 'All';
  const tab = (mode, icon, label) => `<button data-mode="${mode}" role="tab" aria-selected="${S.billMode === mode}" class="${S.billMode === mode ? 'on' : ''}">${icon} ${esc(label)}</button>`;
  p.innerHTML = `<div class="billing">
    <aside class="cart" id="cart"></aside>
    <div class="catalog">
      <div class="seg billseg entry-tabs" role="tablist">${tab('items', '📦', t('nav.items'))}${tab('keypad', isMetal() ? '📐' : '🔢', isMetal() ? 'Any size' : t('keypad'))}${isMetal() ? '' : tab('depts', '🗂', 'Departments')}</div>
      <div id="itemsMode"${S.billMode === 'items' ? '' : ' hidden'} class="itemsmode">
        <div class="searchbar"><input id="search" type="search" enterkeyhint="search" autocomplete="off" placeholder="🔍 ${esc(t('search'))}" value="${esc(S.q)}">
          ${'BarcodeDetector' in window ? '<button class="btn" id="camScan" aria-label="Scan with camera">📷</button>' : ''}
          <button class="btn" id="customItem" aria-label="${esc(t('custom'))}">＋<span class="hide-sm"> ${esc(t('custom'))}</span></button></div>
        <div class="cats">${cats.map(c => `<button data-cat="${esc(c)}" class="${sameDept(c, S.cat) ? 'on' : ''}">${c === 'All' ? '⭐ ' : (catIcon(c) ? catIcon(c) + ' ' : '')}${esc(c)}</button>`).join('')}</div>
        <div class="products" id="productGrid"></div>
      </div>
      <div id="keypadMode"${S.billMode === 'keypad' ? '' : ' hidden'} class="keypadmode"></div>
      <div id="deptMode"${S.billMode === 'depts' ? '' : ' hidden'} class="deptmode"></div>
    </div>
  </div>
  <button class="cartbar" id="cartBar" hidden></button>`;
  const search = $('#search');
  search.addEventListener('input', () => { S.q = search.value; renderGrid(); });
  search.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const v = search.value.trim(); if (!v) return;
    if (isMetal() && Metal.BAR_CODE_RE.test(v)) { if (Metal.cutByBarCode(v)) { search.value = ''; S.q = ''; renderGrid(); } return; }
    const hit = S.products.find(x => x.barcode && x.barcode === v) || (isMetal() && Metal.materialForBarcode(v)) || (filtered().length === 1 ? filtered()[0] : null);
    if (hit) { addProduct(hit); search.value = ''; S.q = ''; renderGrid(); } else toast('No item with that barcode');
  });
  p.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { S.billMode = b.dataset.mode; renderBill(); });
  p.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { S.cat = b.dataset.cat; renderBill(); });
  $('#customItem').onclick = customItemModal;
  $('#camScan')?.addEventListener('click', cameraScan);
  $('#cartBar').onclick = () => $('#cart').classList.add('open');
  if (S.billMode === 'keypad') renderKeypad(); else if (S.billMode === 'depts') renderDeptKeys(); else renderGrid();
  renderCart();
}
/* Department keys: sell by amount under a department (its GST rate and HSN), like a register's open-price key. */
function renderDeptKeys() {
  const el = $('#deptMode'); if (!el) return;
  const reg = S.settings.regime === 'regular', list = departments();
  el.innerHTML = `<p class="hint">Tap a department to ring up an amount${reg ? ' at its GST rate' : ''}. Set departments in ${esc(t('nav.items'))} → Departments.</p>
    <div class="dept-keys">${list.map(d => `<button class="dept-key" data-dk="${esc(d.id)}">${avatar(d.name, d.name)}<span><b>${esc(d.name)}</b><small>${reg ? `GST ${d.gstRate}%${d.hsn ? ' · HSN ' + esc(d.hsn) : ''}` : 'Open price'}</small></span></button>`).join('')}
      <button class="dept-key add" id="dkNew"><span class="avatar" style="background:#e8f4e9">＋</span><span><b>New department</b><small>Name, GST rate, HSN</small></span></button></div>`;
  el.querySelectorAll('[data-dk]').forEach(b => b.onclick = () => deptSaleModal(list.find(d => d.id === b.dataset.dk)));
  $('#dkNew').onclick = () => departmentModal({}, () => renderDeptKeys());
}
function deptSaleModal(d) {
  const reg = S.settings.regime === 'regular';
  const m = modal(d.name, `<div class="grid2"><label>Amount (₹${reg ? ', incl. GST' : ''})<input id="dsAmt" type="number" inputmode="decimal" step="0.01" min="0" autofocus></label>
    <label>Quantity<input id="dsQty" type="number" inputmode="numeric" value="1" min="1"></label></div>
    <label>Description (optional)<input id="dsName" maxlength="60" placeholder="${esc(d.name)}"></label>
    ${reg ? `<p class="hint">GST ${d.gstRate}%${d.hsn ? ` · HSN ${esc(d.hsn)}` : ' · no HSN set for this department'}.</p>` : ''}`,
    `<button class="btn pri big" id="dsAdd">Add to bill</button>`);
  const add = () => {
    const price = C.parsePaise($('#dsAmt', m).value), qty = C.parseQty($('#dsQty', m).value, 'PCS');
    if (!price || !qty) return toast('Enter amount and quantity');
    S.cart.lines.push({ uid: uid(), productId: null, departmentId: d.implicit ? null : d.id, name: $('#dsName', m).value.trim() || d.name, hsn: reg ? (d.hsn || '') : '', unit: 'NOS', qty,
      pricePaise: price, mrpPaise: null, gstRate: reg ? Number(d.gstRate) : 0, cessRate: 0, priceIncludesTax: true, discountPaise: 0 });
    if (navigator.vibrate) navigator.vibrate(15);
    m.close(); saveCart(); renderCart();
  };
  $('#dsAdd', m).onclick = add; $('#dsAmt', m).onkeydown = e => e.key === 'Enter' && add();
}
// Best sellers first: how often each item was billed in the last 30 days.
function popularity() {
  const since = Date.now() - 30 * 864e5, n = {};
  for (const s of S.sales) { if (s.at < since) break; for (const l of s.bill.lines) if (l.productId) n[l.productId] = (n[l.productId] || 0) + 1; }
  return n;
}
function filtered() {
  const q = S.q.trim().toLowerCase(), pop = popularity();
  return S.products.filter(x => x.active !== false && (S.cat === 'All' || sameDept(x.category, S.cat)) &&
    (!q || x.name.toLowerCase().includes(q) || (x.localName || '').toLowerCase().includes(q) || (x.barcode || '').includes(q)))
    .sort((a, b) => (pop[b.id] || 0) - (pop[a.id] || 0) || a.name.localeCompare(b.name));
}
function renderGrid() {
  const g = $('#productGrid'); if (!g) return;
  const list = filtered();
  const inCart = {}; for (const l of S.cart.lines) if (l.productId) inCart[l.productId] = (inCart[l.productId] || 0) + (Number(l.metal ? l.metal.pieces : C.LOOSE_UNITS.has(l.unit) ? 1 : l.qty) || 0);
  g.innerHTML = list.length ? list.map(x => `<button class="pcard${inCart[x.id] ? ' incart' : ''}${S.bump === x.id ? ' bump' : ''}" data-pid="${x.id}">
      ${inCart[x.id] ? `<span class="qbadge">${esc(inCart[x.id])}</span>` : (x.metal ? Metal.summary(x).pieces === 0 || x.stock <= (x.lowStock || 0) : x.stock <= (x.lowStock || 0)) ? `<span class="tag low">${x.metal && Metal.summary(x).pieces === 0 ? 'Out' : 'Low'}</span>` : ''}
      ${avatar(x.name, x.category)}
      <span class="pn">${esc(x.name)}</span>${x.metal ? `<span class="pl">${(s => s.pieces ? `${s.pieces} pc · ${esc(Metal.fmtMm(s.mm))}` : 'none in stock')(Metal.summary(x))}</span>` : x.localName ? `<span class="pl">${esc(x.localName)}</span>` : ''}
      <span class="pp num">${money(x.pricePaise)}${C.LOOSE_UNITS.has(x.unit) ? `<small>/${unitShort(x.unit)}</small>` : ''}</span>${C.promoStatus(x.promo, C.istDate(), x) === 'active' ? `<span class="offer">🏷 ${esc(C.promoLabel(x.promo))}</span>` : ''}</button>`).join('')
    : `<div class="empty" style="grid-column:1/-1">No items yet. Use <b>🔢 ${esc(t('keypad'))}</b> to bill by amount, or add items in <b>${esc(t('nav.items'))}</b>.</div>`;
  g.querySelectorAll('[data-pid]').forEach(b => b.onclick = () => addProduct(S.products.find(x => x.id === b.dataset.pid)));
  S.bump = null;
}
/* Calculator-style billing: type an amount, tap Add — for shops that don't keep an item list. */
function renderKeypad() {
  const k = $('#keypadMode'); if (!k) return;
  if (isMetal()) return Metal.renderKeypad(k);
  const reg = S.settings.regime === 'regular';
  S.kp ??= { amt: '', qty: 1, rate: S.settings.keypadRate ?? 5 };
  const amt = C.parsePaise(S.kp.amt || '0') || 0;
  k.innerHTML = `<div class="kp-display"><small>${S.kp.qty > 1 ? `${S.kp.qty} × ` : ''}${reg ? `GST ${S.kp.rate}% incl.` : ''}</small><b class="num">${money(amt * S.kp.qty)}</b></div>
    ${reg ? `<div class="kp-rates">${C.GST_RATES.filter(r => [0, 5, 18, 40].includes(r)).map(r => `<button data-rate="${r}" class="${S.kp.rate === r ? 'on' : ''}">${r}%</button>`).join('')}</div>` : ''}
    <div class="kp-keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map(d => `<button data-k="${d}">${d}</button>`).join('')}</div>
    <div class="kp-actions"><button class="btn" data-k="qty">× Qty${S.kp.qty > 1 ? ' ' + S.kp.qty : ''}</button><button class="btn" data-k="C">Clear</button>
      <button class="btn pri big" data-k="add"${amt ? '' : ' disabled'}>＋ Add ${amt ? money(amt * S.kp.qty) : ''}</button></div>
    <p class="hint" style="text-align:center">Prices include GST. Tip: add HSN codes by saving common items in ${esc(t('nav.items'))}.</p>`;
  k.querySelectorAll('[data-rate]').forEach(b => b.onclick = async () => { S.kp.rate = Number(b.dataset.rate); S.settings.keypadRate = S.kp.rate; db.kvSet('settings', S.settings); renderKeypad(); });
  k.querySelectorAll('[data-k]').forEach(b => b.onclick = () => keypadPress(b.dataset.k));
}
function keypadPress(key) {
  const kp = S.kp;
  if (/^\d$/.test(key)) { if (/\.\d\d$/.test(kp.amt) || kp.amt.replace('.', '').length >= 8) return; kp.amt = (kp.amt === '0' ? '' : kp.amt) + key; }
  else if (key === '.') { if (!kp.amt.includes('.')) kp.amt = (kp.amt || '0') + '.'; }
  else if (key === '⌫') kp.amt = kp.amt.slice(0, -1);
  else if (key === 'C') { kp.amt = ''; kp.qty = 1; }
  else if (key === 'qty') kp.qty = kp.qty >= 20 ? 1 : kp.qty + 1;
  else if (key === 'add') {
    const price = C.parsePaise(kp.amt || '0'); if (!price) return;
    const reg = S.settings.regime === 'regular';
    S.cart.lines.push({ uid: uid(), productId: null, name: reg ? `Item (GST ${kp.rate}%)` : 'Item', hsn: '', unit: 'NOS', qty: kp.qty, pricePaise: price, mrpPaise: null,
      gstRate: reg ? kp.rate : 0, cessRate: 0, priceIncludesTax: true, discountPaise: 0 });
    kp.amt = ''; kp.qty = 1; if (navigator.vibrate) navigator.vibrate(15);
    saveCart(); renderCart();
  }
  renderKeypad();
}
function lineFromProduct(pr, qty) {
  return { uid: uid(), productId: pr.id, name: pr.name, hsn: pr.hsn, unit: pr.unit, qty, pricePaise: pr.pricePaise, mrpPaise: pr.mrpPaise,
    gstRate: pr.gstRate, cessRate: pr.cessRate || 0, priceIncludesTax: pr.priceIncludesTax !== false, discountPaise: 0 };
}
function addProduct(pr, qty) {
  if (!pr) return;
  if (pr.metal) return Metal.cutModal(pr);
  if (C.LOOSE_UNITS.has(pr.unit) && qty == null) return weightModal(pr);
  const existing = !C.LOOSE_UNITS.has(pr.unit) && S.cart.lines.find(l => l.productId === pr.id && !l.discountPaise && l.pricePaise === pr.pricePaise);
  if (existing) { existing.qty += qty || 1; S.newLine = existing.uid; } else { const l = lineFromProduct(pr, qty || 1); S.cart.lines.push(l); S.newLine = l.uid; }
  if (navigator.vibrate) navigator.vibrate(15);
  S.bump = pr.id;
  saveCart(); renderCart();
}
function weightModal(pr) {
  const u = unitShort(pr.unit);
  const quick = { KGS: [0.1, 0.25, 0.5, 1, 2, 5], LTR: [0.25, 0.5, 1, 2, 5], GMS: [50, 100, 250, 500], MLT: [100, 250, 500], MTR: [0.5, 1, 2, 5] }[pr.unit] || [1];
  const m = modal(pr.name, `<p class="hint">${money(pr.pricePaise)} per ${u}</p>
    <div class="notes">${quick.map(q => `<button data-q="${q}">${q < 1 && pr.unit === 'KGS' ? q * 1000 + ' g' : q < 1 && pr.unit === 'LTR' ? q * 1000 + ' ml' : q + ' ' + u}</button>`).join('')}</div>
    <div class="grid2"><label>Quantity (${u})<input id="wq" type="number" inputmode="decimal" step="0.001" min="0" autofocus></label>
    <label>…or amount (₹)<input id="wa" type="number" inputmode="decimal" step="0.01" min="0"></label></div>
    <p class="hint" id="wPrev"></p>`, `<button class="btn pri big" id="wAdd">Add</button>`);
  const wq = $('#wq', m), wa = $('#wa', m), prev = $('#wPrev', m);
  const show = () => { const q = C.parseQty(wq.value, pr.unit); prev.textContent = q ? `${fmtQty(q, pr.unit)} = ${money(Math.round(q * pr.pricePaise))}` : ''; };
  wq.oninput = () => { wa.value = ''; show(); };
  wa.oninput = () => { const a = C.parsePaise(wa.value); wq.value = a ? (Math.round((a / pr.pricePaise) * 1000) / 1000) : ''; show(); };
  m.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { m.close(); addProduct(pr, Number(b.dataset.q)); });
  const add = () => { const q = C.parseQty(wq.value, pr.unit); if (!q) return toast('Enter a quantity'); m.close(); addProduct(pr, q); };
  $('#wAdd', m).onclick = add; wq.onkeydown = wa.onkeydown = e => e.key === 'Enter' && add();
}
function customItemModal() {
  const s = S.settings, reg = s.regime === 'regular';
  const m = modal(t('custom'), `<label>Item name<input id="ciName" maxlength="60" value="Item" autofocus></label>
    <div class="grid2"><label>Price (₹, incl. GST)<input id="ciPrice" type="number" inputmode="decimal" step="0.01"></label>
    <label>Quantity<input id="ciQty" type="number" inputmode="numeric" value="1" min="1"></label></div>
    ${reg ? `<div class="grid2"><label>GST rate<select id="ciRate">${rateOptions(5)}</select></label><label>HSN code${s.turnoverAbove5Cr ? ' (6 digits)' : ''}<input id="ciHsn" inputmode="numeric" maxlength="8"></label></div>` : ''}`,
    `<button class="btn pri big" id="ciAdd">Add to bill</button>`);
  $('#ciAdd', m).onclick = () => {
    const price = C.parsePaise($('#ciPrice', m).value), qty = C.parseQty($('#ciQty', m).value, 'PCS');
    if (!price || !qty) return toast('Enter price and quantity');
    S.cart.lines.push({ uid: uid(), productId: null, name: $('#ciName', m).value.trim() || 'Item', hsn: reg ? $('#ciHsn', m).value.trim() : '', unit: 'NOS', qty,
      pricePaise: price, mrpPaise: null, gstRate: reg ? Number($('#ciRate', m).value) : 0, cessRate: 0, priceIncludesTax: true, discountPaise: 0 });
    m.close(); saveCart(); renderCart();
  };
}
function renderCart() {
  const el = $('#cart'); if (!el) return;
  const wasOpen = el.classList.contains('open');
  const bill = currentBill(), cust = customerById(S.cart.customerId), reg = S.settings.regime === 'regular';
  const items = S.cart.lines.length;
  el.innerHTML = `<div class="cart-head">
      <button class="btn sm ghost cart-close" id="cartClose">‹ Items</button>
      <div class="cart-title"><b>Current bill</b><small>${items ? `${items} line${items > 1 ? 's' : ''}` : 'No items yet'}</small></div>
      <button class="cust-btn" id="pickCust">👤 ${cust ? esc(cust.name) + (balanceOf(cust.id) > 0 ? ` · <span class="owes">${money(balanceOf(cust.id))}</span>` : '') : esc(t('walkin'))}</button>
      <button class="btn sm ghost" id="billOpts" aria-label="Bill options">⋯</button></div>
    ${bill.interState ? `<div class="alert warn" style="margin:8px 14px 0">Delivery to ${esc(C.STATES[bill.placeOfSupply])} — IGST applies</div>` : ''}
    <div class="cart-cols" aria-hidden="true"><span>Item</span><span>Qty</span><span>Price</span><span>Total</span></div>
    <div class="cart-lines">${items ? bill.lines.map((l, i) => {
      const u = S.cart.lines[i].uid, loose = C.LOOSE_UNITS.has(l.unit), manual = l.discount - (l.promoPaise || 0);
      return `<div class="cline${u === S.newLine ? ' new' : ''}">
        <button class="cl-name" data-edit="${u}"><div class="cn">${esc(l.name)}</div>
          <div class="cm num"><span class="cl-unit">${money(l.pricePaise)}${loose ? '/' + unitShort(l.unit) : ''} · </span>${reg ? `GST ${l.gstRate}%` : ''}${manual > 0 ? ` · −${money(manual)}` : ''}</div>
          ${l.promoPaise ? `<div class="cl-offer">🏷 ${esc(l.promoLabel)} · −${money(l.promoPaise)}</div>` : ''}</button>
        <div class="cl-qty qty">${loose ? `<span class="num">${fmtQty(l.qty, l.unit)}</span><button data-edit="${u}" aria-label="Edit">✎</button>` :
          `<button data-dec="${u}" aria-label="Less">−</button><span class="num">${l.qty}</span><button data-inc="${u}" aria-label="More">+</button>`}</div>
        <div class="cl-price num">${money(l.pricePaise)}${loose ? '<small>/' + unitShort(l.unit) + '</small>' : ''}</div>
        <div class="cl-total ct num">${money(l.total)}</div>
      </div>`; }).join('') : `<div class="empty"><div class="empty-icon">🧾</div><b>${esc(t('empty'))}</b><span class="hint">Tap items, scan a barcode or use the keypad.</span></div>`}</div>
    <div class="checkout-foot">
    ${isMetal() && items ? `<div class="cart-tools">${Metal.feeButtons()}${S.cart.lines.some(l => l.metal) ? '<button class="btn sm" id="cutSlip">🖨 Cutting slip for the saw</button>' : ''}</div>` : ''}
    <div class="totals num">
      ${bill.lines.some(l => l.promoPaise) ? `<div class="save"><span>🏷 Offer savings</span><span>−${money(bill.lines.reduce((a, l) => a + (l.promoPaise || 0), 0))}</span></div>` : ''}
      ${bill.discount - bill.lines.reduce((a, l) => a + (l.promoPaise || 0), 0) > 0 ? `<div><span>Discount</span><span>−${money(bill.discount - bill.lines.reduce((a, l) => a + (l.promoPaise || 0), 0))}</span></div>` : ''}
      ${reg ? `<div><span>Taxable value</span><span>${money(bill.taxable)}</span></div>
        ${bill.interState ? `<div><span>IGST</span><span>${money(bill.igst)}</span></div>` : `<div><span>CGST</span><span>${money(bill.cgst)}</span></div><div><span>${bill.stateTaxLabel}</span><span>${money(bill.sgst)}</span></div>`}
        ${bill.cess ? `<div><span>Cess</span><span>${money(bill.cess)}</span></div>` : ''}` : ''}
      ${bill.roundOff ? `<div><span>Round off</span><span>${bill.roundOff > 0 ? '+' : '−'}${money(Math.abs(bill.roundOff))}</span></div>` : ''}
      <div class="grand"><span>${esc(t('total'))}</span><span>${money(bill.grandTotal)}</span></div>
    </div>
    <div class="cart-actions">
      <button class="btn" id="holdBtn">${S.held.length && !items ? `Recall (${S.held.length})` : esc(t('hold'))}</button>
      <button class="btn bad" id="clearBtn"${items ? '' : ' disabled'}>${esc(t('clear'))}</button>
      <button class="btn pri big" id="payBtn"${items ? '' : ' disabled'}>${esc(t('pay'))} ${money(bill.grandTotal)}</button>
    </div></div>`;
  S.newLine = null;
  if (wasOpen && items) el.classList.add('open');
  if (S.billMode === 'items') renderGrid();
  const bar = $('#cartBar');
  if (bar) { bar.hidden = !items; bar.innerHTML = `<span>${items} item${items > 1 ? 's' : ''}</span><span>${money(bill.grandTotal)} ›</span>`; }
  $('#cartClose').onclick = () => el.classList.remove('open');
  $('#pickCust').onclick = () => pickCustomer(id => { S.cart.customerId = id; saveCart(); renderCart(); });
  $('#billOpts').onclick = billOptions;
  el.querySelectorAll('[data-inc]').forEach(b => b.onclick = () => { S.cart.lines.find(l => l.uid === b.dataset.inc).qty++; saveCart(); renderCart(); });
  el.querySelectorAll('[data-dec]').forEach(b => b.onclick = () => {
    const l = S.cart.lines.find(x => x.uid === b.dataset.dec);
    if (l.qty > 1) l.qty--; else S.cart.lines = S.cart.lines.filter(x => x !== l && x.linkedTo !== l.uid);
    saveCart(); renderCart();
  });
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editLine(b.dataset.edit));
  $('#clearBtn').onclick = async () => { if (await confirmBox('Clear bill?', 'Remove all items from this bill?', 'Clear', true)) { S.cart = newCart(); saveCart(); renderCart(); } };
  el.querySelectorAll('[data-fee]').forEach(b => b.onclick = () => Metal.feeModal(b.dataset.fee));
  $('#cutSlip')?.addEventListener('click', () => Metal.printSlip(S.cart.lines, customerById(S.cart.customerId)?.name || ''));
  $('#holdBtn').onclick = holdOrRecall;
  $('#payBtn').onclick = openPayment;
}
function editLine(lineUid) {
  const l = S.cart.lines.find(x => x.uid === lineUid); if (!l) return;
  if (l.metal) return Metal.editLine(l);
  if (l.charge && isMetal() && Metal.feeModal(l.charge)) return;
  const loose = C.LOOSE_UNITS.has(l.unit);
  const m = modal(l.name, `<div class="grid2">
      <label>Quantity${loose ? ` (${unitShort(l.unit)})` : ''}<input id="elQ" type="number" inputmode="decimal" step="${loose ? '0.001' : '1'}" value="${l.qty}" autofocus></label>
      <label>Price per ${unitShort(l.unit)} (₹)<input id="elP" type="number" inputmode="decimal" step="0.01" value="${C.plain(l.pricePaise)}"></label></div>
    <label>Discount on this line (₹)<input id="elD" type="number" inputmode="decimal" step="0.01" value="${l.discountPaise ? C.plain(l.discountPaise) : ''}"></label>
    ${l.mrpPaise ? `<p class="hint">MRP ${money(l.mrpPaise)} — selling above MRP is not allowed.</p>` : ''}`,
    `<button class="btn bad" id="elDel">Remove</button><span class="grow"></span><button class="btn pri" id="elSave">Save</button>`);
  $('#elDel', m).onclick = () => { S.cart.lines = S.cart.lines.filter(x => x !== l); m.close(); saveCart(); renderCart(); };
  $('#elSave', m).onclick = () => {
    const q = C.parseQty($('#elQ', m).value, l.unit), p = C.parsePaise($('#elP', m).value), d = $('#elD', m).value ? C.parsePaise($('#elD', m).value) : 0;
    if (!q || p == null || d == null) return toast('Check the numbers');
    const test = { ...l, pricePaise: p };
    if (l.mrpPaise && C.inclusiveUnitPrice(test, S.settings.regime) > l.mrpPaise) return toast(`Price cannot be above MRP ${money(l.mrpPaise)}`);
    if (d > Math.round(p * q)) return toast('Discount is more than the line amount');
    Object.assign(l, { qty: q, pricePaise: p, discountPaise: d }); m.close(); saveCart(); renderCart();
  };
}
function billOptions() {
  const reg = S.settings.regime === 'regular';
  const m = modal('Bill options', `
    <label>Discount on whole bill (₹)<input id="boD" type="number" inputmode="decimal" step="0.01" value="${S.cart.billDiscountPaise ? C.plain(S.cart.billDiscountPaise) : ''}"></label>
    <p class="hint">Discount given on the bill reduces the taxable value (GST s.15).</p>
    ${reg ? `<label>Place of supply<select id="boPos">${stateOptions(S.cart.placeOfSupply || S.settings.stateCode)}</select></label>
    <p class="hint">Counter sales are always in your state (CGST + ${C.stateTaxLabel(S.settings.stateCode)}). Change only when you deliver goods to another state (IGST).</p>` : ''}`,
    `<button class="btn pri" id="boSave">Apply</button>`);
  $('#boSave', m).onclick = () => {
    const d = $('#boD', m).value ? C.parsePaise($('#boD', m).value) : 0;
    if (d == null) return toast('Check the discount');
    S.cart.billDiscountPaise = d;
    if (reg) S.cart.placeOfSupply = $('#boPos', m).value === S.settings.stateCode ? null : $('#boPos', m).value;
    m.close(); saveCart(); renderCart();
  };
}
async function holdOrRecall() {
  if (S.cart.lines.length) {
    if (S.held.length >= 10) return toast('Up to 10 bills can be on hold');
    S.held.push({ id: uid(), at: Date.now(), cart: S.cart });
    S.cart = newCart(); await db.kvSet('held', S.held); saveCart(); renderCart(); toast('Bill on hold');
    return;
  }
  if (!S.held.length) return toast('No bills on hold');
  const m = modal('Bills on hold', `<div class="list">${S.held.map(h => {
    const b = C.computeBill(pricedLines(h.cart.lines), { ...billCtx(), placeOfSupply: h.cart.placeOfSupply || S.settings.stateCode, billDiscountPaise: h.cart.billDiscountPaise });
    return `<button class="li" data-h="${h.id}"><div class="grow"><div class="t1">${money(b.grandTotal)} · ${h.cart.lines.length} items</div><div class="t2">${C.displayDateTime(h.at)} ${esc(customerById(h.cart.customerId)?.name || '')}</div></div>›</button>`;
  }).join('')}</div>`);
  m.querySelectorAll('[data-h]').forEach(b => b.onclick = async () => {
    const h = S.held.find(x => x.id === b.dataset.h); S.held = S.held.filter(x => x !== h); S.cart = h.cart;
    await db.kvSet('held', S.held); saveCart(); m.close(); renderCart();
  });
}

/* ---------- barcode: USB/Bluetooth scanners type fast and press Enter ---------- */
let scanBuf = '', scanAt = 0;
document.addEventListener('keydown', e => {
  if (S.page !== 'bill' || !S.settings || $('#modalRoot').children.length) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (S.billMode === 'keypad' && isMetal()) return;
  if (S.billMode === 'keypad') { const map = { Enter: 'add', Backspace: '⌫', Escape: 'C', '*': 'qty' }; const k = /^[\d.]$/.test(e.key) ? e.key : map[e.key]; if (k) { e.preventDefault(); keypadPress(k); } return; }
  const now = Date.now();
  if (now - scanAt > 80) scanBuf = '';
  scanAt = now;
  if (e.key === 'Enter' && scanBuf.length >= 4) {
    const hit = S.products.find(x => x.active !== false && x.barcode === scanBuf) || (isMetal() && Metal.materialForBarcode(scanBuf));
    if (isMetal() && Metal.BAR_CODE_RE.test(scanBuf)) Metal.cutByBarCode(scanBuf);
    else hit ? addProduct(hit) : toast(`Barcode ${scanBuf} not found`);
    scanBuf = ''; e.preventDefault();
  } else if (e.key.length === 1) scanBuf += e.key;
});
async function cameraScan() {
  let stream, stop = false;
  const m = modal('Scan barcode', `<video class="scan" playsinline muted autoplay></video><p class="hint">Point the camera at the barcode.</p>`, '', { onClose: () => { stop = true; stream?.getTracks().forEach(tr => tr.stop()); } });
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = $('video', m); v.srcObject = stream; await v.play();
    const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
    while (!stop) {
      const codes = await det.detect(v).catch(() => []);
      if (codes[0]) {
        const code = codes[0].rawValue, hit = S.products.find(x => x.barcode === code);
        m.close();
        if (hit) addProduct(hit); else if (await confirmBox('New barcode', `No item has barcode ${code}. Add a new item?`, 'Add item')) productModal({ barcode: code });
        return;
      }
      await new Promise(r => setTimeout(r, 200));
    }
  } catch (err) { m.close(); toast('Camera not available: ' + err.message); }
}

/* ================= customers ================= */
function pickCustomer(onPick) {
  const m = modal(t('customer'), `<input id="pcQ" type="search" placeholder="Name, phone or GSTIN" autofocus>
    <div class="list" id="pcList" style="margin-top:10px"></div>`,
    `<button class="btn ghost" id="pcWalk">${esc(t('walkin'))}</button><button class="btn pri" id="pcNew">＋ New customer</button>`);
  const draw = () => {
    const q = $('#pcQ', m).value.trim().toLowerCase();
    const list = S.customers.filter(c => !c.deleted && (!q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.gstin || '').toLowerCase().includes(q))).slice(0, 50);
    $('#pcList', m).innerHTML = list.map(c => { const b = balanceOf(c.id); return `<button class="li" data-c="${c.id}"><div class="grow"><div class="t1">${esc(c.name)}</div><div class="t2">${esc(c.phone || '')} ${c.gstin ? '· ' + esc(c.gstin) : ''}</div></div>${b ? `<span class="${b > 0 ? 'owes' : 'clear'} num">${money(Math.abs(b))}</span>` : ''}</button>`; }).join('') || '<p class="hint">No customers yet.</p>';
    m.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { m.close(); onPick(b.dataset.c); });
  };
  $('#pcQ', m).oninput = draw; draw();
  $('#pcWalk', m).onclick = () => { m.close(); onPick(null); };
  $('#pcNew', m).onclick = () => { m.close(); customerModal({}, c => onPick(c.id)); };
}
function customerModal(c, onSave) {
  const m = modal(c.id ? 'Edit customer' : 'New customer', `
    <label>Name<input id="cuName" maxlength="80" value="${esc(c.name)}" autofocus></label>
    <div class="grid2"><label>Mobile number<input id="cuPhone" type="tel" inputmode="numeric" maxlength="13" value="${esc(c.phone)}"></label>
    <label>${W().Udhaar} limit (₹, optional)<input id="cuLimit" type="number" inputmode="decimal" value="${c.creditLimitPaise ? C.plain(c.creditLimitPaise) : ''}"></label></div>
    <label class="row" style="color:var(--ink)"><input type="checkbox" id="cuConsent" style="width:auto;min-height:auto"${c.waConsent ? ' checked' : ''}> Customer agreed to get bills and reminders on WhatsApp/SMS</label>
    <h3>For GST bills (optional)</h3>
    <label>GSTIN (business customer)<input id="cuGstin" maxlength="15" autocapitalize="characters" value="${esc(c.gstin)}"></label>
    <label>Address<textarea id="cuAddr" rows="2" maxlength="250">${esc(c.address)}</textarea></label>
    <div class="grid2"><label>State<select id="cuState"><option value="">—</option>${stateOptions(c.stateCode || '')}</select></label>
    <label>PAN (needed for bills above ₹2 lakh)<input id="cuPan" maxlength="10" autocapitalize="characters" value="${esc(c.pan)}"></label></div>
    <p class="hint">Only collect what you need. Customer data stays on this device (DPDP Act 2023).</p><div id="cuErr"></div>`,
    `<button class="btn pri" id="cuSave">Save</button>`);
  $('#cuGstin', m).oninput = e => { const g = C.validateGstin(e.target.value); if (g.ok) { $('#cuState', m).value = g.stateCode; if (!$('#cuPan', m).value) $('#cuPan', m).value = g.pan; } };
  $('#cuSave', m).onclick = async () => {
    const v = id => $(id, m).value.trim(), errs = [];
    const rec = { ...c, id: c.id || uid(), name: v('#cuName'), phone: v('#cuPhone'), gstin: v('#cuGstin').toUpperCase(), address: v('#cuAddr'),
      stateCode: v('#cuState'), pan: v('#cuPan').toUpperCase(), waConsent: $('#cuConsent', m).checked, createdAt: c.createdAt || Date.now(),
      creditLimitPaise: v('#cuLimit') ? C.parsePaise(v('#cuLimit')) : null };
    if (!rec.name) errs.push('Enter a name.');
    if (rec.phone) { const ph = C.validatePhone(rec.phone); if (!ph) errs.push('Mobile number should be 10 digits starting with 6–9.'); else rec.phone = ph; }
    if (rec.gstin) { const g = C.validateGstin(rec.gstin); if (!g.ok) errs.push(g.error); }
    if (rec.pan && !C.validatePan(rec.pan)) errs.push('PAN should look like ABCDE1234F.');
    if (rec.phone && S.customers.some(x => x.id !== rec.id && !x.deleted && x.phone === rec.phone)) errs.push('Another customer has this number.');
    $('#cuErr', m).innerHTML = errs.map(e => `<div class="alert bad">${esc(e)}</div>`).join('');
    if (errs.length) return;
    await db.put('customers', rec);
    S.customers = S.customers.filter(x => x.id !== rec.id).concat(rec);
    m.close(); onSave?.(rec);
  };
}

/* ================= payment ================= */
function openPayment() {
  const bill = currentBill();
  const cust = customerById(S.cart.customerId);
  const payments = [];
  let mode = 'cash', upiView = null;
  const m = modal(t('pay'), '<div id="payBody"></div>', '<div id="payFoot" class="row" style="width:100%"></div>', { wide: true });
  const body = $('#payBody', m), foot = $('#payFoot', m);
  const draw = () => {
    const st = C.paymentState(bill.grandTotal, payments);
    const issues = C.checkoutIssues({ bill, settings: S.settings, customer: cust || {}, payments });
    m.guard = null;
    if (upiView) return upiView.via === 'edc' ? drawEdc(upiView) : upiView.via === 'device' ? drawDeviceUpi(upiView) : upiView.via === 'gateway' ? drawGatewayUpi(upiView) : drawUpi(upiView);
    body.innerHTML = `
      <div class="due num">${st.due ? money(st.due) : st.change ? `Change ${money(st.change)}` : '✓ Paid'}</div>
      <p class="hint" style="text-align:center">${st.due ? 'Balance to collect' : st.change ? 'Give back to customer' : ''} · Bill ${money(bill.grandTotal)}</p>
      ${payments.length ? `<div class="paylist num">${payments.map((p, i) => `<div><span>${esc(MODE_LABEL(p.mode))}${p.verified ? ' ✓ verified' : ''}${p.utr ? ` · UTR ${esc(p.utr)}` : ''}${p.app ? ` · ${esc(p.app)}` : p.ref ? ` · ${esc(p.ref)}` : ''}</span><span>${money(p.amountPaise)} <button class="btn sm bad" data-rm="${i}">✕</button></span></div>`).join('')}</div>` : ''}
      ${st.due ? `<div class="paygrid">${['cash', 'upi', 'card', 'udhaar'].map(k => `<button data-mode="${k}" class="${mode === k ? 'on' : ''}"><span>${{ cash: '💵', upi: '📱', card: '💳', udhaar: '📒' }[k]}</span>${esc(MODE_LABEL(k))}</button>`).join('')}</div>
      <label>Amount (₹)<input id="payAmt" type="number" inputmode="decimal" step="0.01" value="${C.plain(st.due)}"></label>
      ${mode === 'cash' ? `<div class="notes">${C.CASH_NOTES.filter(n => n >= st.due || n >= 10000).map(n => `<button data-note="${n}">₹${n / 100}</button>`).join('')}</div>` : ''}
      ${(mode === 'upi' || mode === 'card') && useEdc() ? `<p class="hint">📟 The amount goes to your PhonePe machine; the customer pays there by UPI QR or card, and the bill finishes by itself${S.edcInfo?.env === 'uat' ? ' (PhonePe TEST mode — no real money)' : ''}.</p>` : ''}
      ${mode === 'card' && !useEdc() ? `<label>Card slip / approval number (optional)<input id="payRef" maxlength="30"></label><p class="hint">Charge the card on your bank's card machine first, then record it here.</p>` : ''}
      ${mode === 'udhaar' ? (cust ? `<p class="hint">Will be added to ${esc(cust.name)}'s ${W().khata}. Current balance ${money(balanceOf(cust.id))}${cust.creditLimitPaise ? ` · limit ${money(cust.creditLimitPaise)}` : ''}.</p>` : `<div class="alert warn">Select a customer first. <button class="btn sm" id="payPick">Choose customer</button></div>`) : ''}
      ${useEdc() ? '' : mode === 'upi' && onDevice() ? `<p class="hint">📟 The customer pays on your payment device (soundbox / card machine) — no QR on this phone.${useGateway() ? ' The app watches your Razorpay account and rings when the amount arrives.' : ''}</p>` : mode === 'upi' && useGateway() ? `<p class="hint">🔔 Auto-confirm is on: the app will ring and finish the bill when the customer pays${S.gwInfo?.mode === 'test' ? ' (Razorpay TEST mode — no real money)' : ''}.</p>` : mode === 'upi' && !S.settings.upiVpa ? '<div class="alert warn">Add your UPI ID in Settings to show a QR code.</div>' : ''}` : ''}
      ${issues.blocking.map(x => `<div class="alert bad">${esc(metalWords() ? x.replace('udhaar (credit)', 'credit') : x)}</div>`).join('')}${issues.warnings.map(x => `<div class="alert warn">${esc(x)}</div>`).join('')}`;
    const canDone = !st.due && !issues.blocking.length;
    foot.innerHTML = st.due
      ? `<button class="btn ghost" data-close>Back</button><span class="grow"></span>${payments.length ? '' : `<button class="btn" id="payExact">Exact cash ${money(st.due)}</button>`}<button class="btn pri big" id="payAdd">${(mode === 'upi' || mode === 'card') && useEdc() ? '📟 Send to PhonePe machine' : mode === 'upi' ? (onDevice() ? 'Collect on payment device' : 'Show UPI QR') : 'Add ' + esc(MODE_LABEL(mode))}</button>`
      : `<button class="btn ghost" id="payUndo">Change payment</button><span class="grow"></span><button class="btn ok big" id="payDone"${canDone ? '' : ' disabled'}>Complete sale ✓</button>`;
    // UPI opens its QR (or the payment device / PhonePe machine) straight away for the balance due; Card starts the
    // linked PhonePe terminal straight away. Back returns here, where a part amount can be typed instead.
    body.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
      mode = b.dataset.mode;
      if (mode === 'upi' || (mode === 'card' && useEdc())) return startDigital(mode, st.due);
      draw();
    });
    body.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { payments.splice(Number(b.dataset.rm), 1); draw(); });
    body.querySelectorAll('[data-note]').forEach(b => b.onclick = () => { payments.push({ mode: 'cash', amountPaise: Number(b.dataset.note) }); draw(); });
    $('#payPick', body)?.addEventListener('click', () => pickCustomer(id => { S.cart.customerId = id; saveCart(); m.close(); renderCart(); openPayment(); }));
    $('#payExact', foot)?.addEventListener('click', () => { payments.push({ mode: 'cash', amountPaise: st.due }); draw(); });
    $('#payUndo', foot)?.addEventListener('click', () => { payments.length = 0; draw(); });
    $('#payDone', foot)?.addEventListener('click', async () => { $('#payDone', foot).disabled = true; m.close(); await completeSale(bill, payments, st.change); });
    $('#payAdd', foot)?.addEventListener('click', () => {
      const amt = C.parsePaise($('#payAmt', body).value);
      if (!amt) return toast('Enter an amount');
      if (mode !== 'cash' && amt > st.due) return toast('Only cash can be more than the balance (for change)');
      if (mode === 'udhaar') {
        if (!cust) return toast('Select a customer');
        if (cust.creditLimitPaise && balanceOf(cust.id) + amt > cust.creditLimitPaise) return toast(`Over ${W().udhaar} limit of ${money(cust.creditLimitPaise)}`);
      }
      if (mode === 'upi' || (mode === 'card' && useEdc())) return startDigital(mode, amt);
      payments.push({ mode, amountPaise: amt, ref: mode === 'card' ? ($('#payRef', body)?.value.trim() || '') : '' }); draw();
    });
  };
  const startDigital = (how, amt) => {
    if (!amt) return toast('Nothing left to collect');
    if (useEdc()) { unlockAudio(); upiView = { amountPaise: amt, via: 'edc' }; return draw(); }
    if (how !== 'upi') return draw();
    const via = onDevice() ? 'device' : useGateway() ? 'gateway' : 'own';
    if (via === 'own' && !S.settings.upiVpa) { draw(); return toast('Add your UPI ID in Settings'); }
    unlockAudio(); upiView = { amountPaise: amt, via }; return draw();
  };
  // A QR (or device request) for a fixed amount is live: no amount field, and leaving needs a deliberate confirm.
  const lockPayment = amountPaise => {
    m.guard = () => confirmBox('Stop this payment?', `The ${money(amountPaise)} payment request will be cancelled. Only stop if the customer has NOT paid.`, 'Stop payment', true);
  };
  const acceptVerified = async (amountPaise, r, rec = { mode: 'upi', amountPaise, utr: r.utr, ref: r.paymentId, gateway: 'razorpay', verified: true }) => {
    m.guard = null; announcePayment(amountPaise);
    payments.push(rec);
    upiView = null;
    const st = C.paymentState(bill.grandTotal, payments);
    const issues = C.checkoutIssues({ bill, settings: S.settings, customer: cust || {}, payments });
    toast(`✓ ${money(amountPaise)} received`);
    if (!st.due && !issues.blocking.length) { m.close(); await completeSale(bill, payments, st.change, { showReceipt: true }); } else draw();
  };
  const drawEdc = ({ amountPaise }) => {
    const edc = S.edc; let txn = null, stopped = false, done = false;
    const say = html => { const el = $('#gwStatus', body); if (el) el.innerHTML = html; };
    const record = r => ({ mode: r.mode, amountPaise, utr: r.mode === 'upi' && /^\d{12}$/.test(r.reference) ? r.reference : '', ref: r.reference + (r.last4 ? ' ·' + r.last4 : ''), gateway: 'phonepe', verified: true, txn });
    const finish = r => { done = true; stopped = true; return acceptVerified(amountPaise, null, record(r)); };
    lockPayment(amountPaise);
    body.innerHTML = `<div class="upi-box"><div class="upi-amt num">${money(amountPaise)}</div>
      <p style="font-size:18px">📟 Sending <b>${money(amountPaise)}</b> to your PhonePe machine…</p><div id="gwStatus"></div></div>`;
    foot.innerHTML = `<button class="btn ghost" id="edcStop">Stop</button><span class="grow"></span>`;
    // Stop = cancel at PhonePe; if PhonePe says it was already paid, finish the bill instead of losing it.
    const cancelOrFinish = async () => {
      if (!txn) return 'cancelled';
      const c = await edc.cancel(txn);
      if (c === 'already_paid') { const r = await edc.status(txn, amountPaise).catch(() => null); if (r?.state === 'paid') { await finish(r); return 'paid'; } }
      return c;
    };
    $('#edcStop', foot).onclick = async () => {
      if (!await m.guard()) return;
      stopped = true; say('<p class="hint">Cancelling on the machine…</p>');
      if (await cancelOrFinish() === 'paid') return;
      m.guard = null; upiView = null; draw();
    };
    const retry = (msg) => {
      m.guard = null; stopped = true;
      say(`<div class="alert warn">${esc(msg)}</div>`);
      foot.innerHTML = `<button class="btn ghost" id="edcBack">Back</button><span class="grow"></span><button class="btn pri" id="edcAgain">Send again</button>`;
      $('#edcBack', foot).onclick = () => { upiView = null; draw(); };
      $('#edcAgain', foot).onclick = () => draw();
    };
    (async () => {
      try { ({ transactionId: txn } = await edc.startSale({ amountPaise, orderId: `${S.settings.invoicePrefix}-${Date.now().toString(36)}` })); }
      catch (e) { return retry(e.message || 'Could not reach the machine.'); }
      if (stopped || !m.isConnected) return cancelOrFinish();
      body.querySelector('p').innerHTML = `📟 <b>${money(amountPaise)}</b> sent to your PhonePe machine.`;
      say('<p class="gw-wait">⏳ Accept it on the machine — the customer pays by QR or card there. The app rings and opens the receipt when it is done.</p>');
      let fails = 0; const until = Date.now() + 10 * 60 * 1000;
      while (!stopped && m.isConnected && Date.now() < until) {
        await new Promise(r => setTimeout(r, 3000));
        if (stopped) return;
        if (!m.isConnected) break;
        try {
          const r = await edc.status(txn, amountPaise); fails = 0;
          if (r.state === 'paid') return finish(r);
          if (r.state === 'failed') return retry(`Payment failed on the machine: ${r.message}`);
          if (r.state === 'expired') return retry('The machine did not pick up the request in time. Check it is switched on, online and in integrated mode, then send again.');
        } catch (e) {
          if (e.kind === 'keys') return retry(e.message);
          if (++fails >= 2) say('<div class="alert warn">Connection problem — still checking with PhonePe…</div>');
        }
      }
      if (done) return;
      // popup closed or 10 minutes passed: cancel; if it had gone through, still save the bill
      const c = await cancelOrFinish();
      if (c !== 'paid' && m.isConnected && !stopped) retry('No payment after 10 minutes — the request was cancelled.');
    })();
  };
  const drawDeviceUpi = ({ amountPaise }) => {
    const since = Date.now(), gw = useGateway() ? S.gw : null;
    let stopped = false, paid = false;
    lockPayment(amountPaise);
    body.innerHTML = `<div class="upi-box"><div class="upi-amt num">${money(amountPaise)}</div>
      <p style="font-size:18px">📟 Ask the customer to pay <b>${money(amountPaise)}</b> on your payment device.</p>
      <div id="gwStatus">${gw ? '<p class="gw-wait">⏳ Watching your Razorpay account — the app will ring and open the receipt when it arrives.</p>' : '<p class="hint">When your soundbox / card machine confirms the payment, tap “Payment received”.</p>'}</div></div>`;
    foot.innerHTML = `<button class="btn ghost" id="dvBack">Stop</button><span class="grow"></span>${gw || S.settings.upiVpa ? '<button class="btn" id="dvPhone">Show QR on this phone</button>' : ''}<button class="btn ok big" id="dvOk">✓ ${esc(t('received'))}</button>`;
    const leave = async next => { if (!await m.guard()) return; stopped = true; m.guard = null; upiView = next; draw(); };
    $('#dvBack', foot).onclick = () => leave(null);
    $('#dvPhone', foot)?.addEventListener('click', () => leave({ amountPaise, via: gw ? 'gateway' : 'own' }));
    $('#dvOk', foot).onclick = async () => {
      if (gw && !await confirmBox('Mark as received?', `The payment has not appeared in your Razorpay account yet. Only continue if your device clearly confirmed ${money(amountPaise)}.`, 'Yes, received')) return;
      stopped = true; m.guard = null; payments.push({ mode: 'upi', amountPaise, utr: '', ref: 'device' }); upiView = null; draw();
    };
    if (!gw && useAlerts()) {
      $('#gwStatus', body).innerHTML = '<div id="alStatus"><p class="gw-wait">⏳ Watching your payment app alerts — the app will ring and open the receipt when it arrives.</p></div>';
      const stopWatch = watchAlerts(amountPaise, hit => { stopped = true; alertPaid(amountPaise, hit); }, st => alertState(st));
      const offWatch = new MutationObserver(() => { if (stopped || !m.isConnected || !$('#dvOk', foot)) { stopWatch(); offWatch.disconnect(); } });
      offWatch.observe(document.body, { childList: true, subtree: true });
    }
    if (!gw) return;
    (async () => {
      let fails = 0;
      const until = since + 20 * 60 * 1000;
      while (!stopped && m.isConnected && Date.now() < until) {
        await new Promise(r => setTimeout(r, 3000));
        if (stopped || !m.isConnected) return;
        try {
          const r = await gw.findRecent(amountPaise, since, usedPaymentIds()); fails = 0;
          if (r.paid && !stopped) { paid = true; stopped = true; return acceptVerified(amountPaise, r); }
        } catch (e) {
          const st = $('#gwStatus', body); if (!st) return;
          if (e.kind === 'keys') { st.innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; return; }
          if (++fails >= 2) st.innerHTML = '<div class="alert warn">Connection problem — still checking. You can also tap “Payment received” when your device confirms.</div>';
        }
      }
    })();
  };
  const drawGatewayUpi = ({ amountPaise }) => {
    const gw = S.gw, billRef = `${S.settings.invoicePrefix}-${Date.now().toString(36).toUpperCase()}`;
    let qr = null, stopped = false, paid = false;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const statusEl = () => $('#gwStatus', body);
    const say = (html) => { if (statusEl()) statusEl().innerHTML = html; };
    body.innerHTML = `<div class="upi-box"><div class="upi-amt num">${money(amountPaise)}</div>
      <div class="qr gw-qr" id="gwQr"><p class="hint" style="padding:40px 0">Making a QR code…</p></div>
      <p class="hint">Customer scans with any UPI app (GPay, PhonePe, Paytm, BHIM…).</p><div id="gwStatus"></div></div>`;
    foot.innerHTML = `<button class="btn ghost" id="upiBack">Back</button><span class="grow"></span><button class="btn" id="gwOwn">Use my own UPI QR</button>`;
    const stop = async () => { stopped = true; if (qr && !paid) await gw.close(qr.id); };
    lockPayment(amountPaise);
    $('#upiBack', foot).onclick = async () => { if (!await m.guard()) return; await stop(); upiView = null; draw(); };
    $('#gwOwn', foot).onclick = async () => { if (!await m.guard()) return; await stop(); if (!S.settings.upiVpa) { upiView = null; draw(); return toast('Add your UPI ID in Settings'); } upiView = { amountPaise, via: 'own' }; draw(); };
    (async () => {
      try {
        qr = await gw.createQr({ amountPaise, billRef, shopName: S.settings.shopName });
        const img = await fetchQrImage(qr.imageUrl);
        if (stopped || !m.isConnected) return gw.close(qr.id);
        $('#gwQr', body).innerHTML = `<img src="${esc(img)}" alt="UPI payment QR code" style="display:block;width:100%;height:auto">`;
        say('<p class="gw-wait">⏳ Waiting for payment… the app will ring when it arrives.</p>');
      } catch (e) {
        if (qr) gw.close(qr.id);
        if (!stopped) say(`<div class="alert bad">${esc(e.kind === 'feature' ? 'QR Codes are not turned on for your Razorpay account yet — ask Razorpay support to enable “QR Codes”.' : e.message || 'Could not make the QR code.')}</div><p class="hint">You can use your own UPI QR instead.</p>`);
        return;
      }
      let fails = 0;
      while (!stopped && m.isConnected && Date.now() < qr.closeBy) {
        await sleep(3000);
        if (stopped || !m.isConnected) break;
        try {
          const r = await gw.check(qr.id, amountPaise, usedPaymentIds());
          fails = 0;
          if (r.paid) { paid = true; return acceptVerified(amountPaise, r); }
          say('<p class="gw-wait">⏳ Waiting for payment… the app will ring when it arrives.</p>');
        } catch (e) {
          if (e.kind === 'keys') { say(`<div class="alert bad">${esc(e.message)} Check Settings → UPI auto-confirm.</div>`); stopped = true; break; }
          if (++fails >= 2) say('<div class="alert warn">Connection problem — still checking. If the customer has paid, wait a moment.</div>');
        }
      }
      if (!paid && qr && !stopped) {
        gw.close(qr.id);
        if (m.isConnected) {
          m.guard = null;
          say('<div class="alert warn">This QR code has expired.</div>');
          foot.innerHTML = `<button class="btn ghost" id="upiBack2">Back</button><span class="grow"></span><button class="btn pri" id="gwAgain">New QR</button>`;
          $('#upiBack2', foot).onclick = () => { upiView = null; draw(); };
          $('#gwAgain', foot).onclick = () => draw();
        }
      }
    })();
  };
  const drawUpi = ({ amountPaise }) => {
    const ref = `${S.settings.invoicePrefix}-${Date.now().toString(36).toUpperCase()}`;
    const uri = C.upiUri({ vpa: S.settings.upiVpa, payeeName: S.settings.upiName, amountPaise, note: `Bill ${S.settings.shopName}`.slice(0, 50),
      ref, merchantCode: S.settings.merchantUpi ? (S.settings.mcc || '5411') : '', lockAmount: true });
    lockPayment(amountPaise);
    body.innerHTML = `<div class="upi-box"><div class="upi-amt num">${money(amountPaise)}</div>
      <div class="qr">${qrSvg(uri, { label: 'UPI payment QR code' })}</div>
      <p><b>${esc(S.settings.upiName)}</b><br><span class="hint">${esc(S.settings.upiVpa)}</span></p>
      <p class="hint">Customer scans with any UPI app (GPay, PhonePe, Paytm, BHIM…). Check your bank/soundbox for the payment, then tap “${esc(t('received'))}”.</p>
      <label style="text-align:left">UTR / reference number (optional, 12 digits)<input id="upiUtr" inputmode="numeric" maxlength="12"></label></div>`;
    foot.innerHTML = `<button class="btn ghost" id="upiBack">Back</button><span class="grow"></span><button class="btn ok big" id="upiOk">✓ ${esc(t('received'))}</button>`;
    const stopWatch = useAlerts() ? watchAlerts(amountPaise, hit => alertPaid(amountPaise, hit), st => alertState(st)) : () => {};
    if (useAlerts()) $('.upi-box .hint:last-of-type', body).insertAdjacentHTML('afterend', '<div id="alStatus"><p class="gw-wait">⏳ Watching your payment app alerts — the app will ring and open the receipt when it arrives.</p></div>');
    const offWatch = new MutationObserver(() => { if (!m.isConnected || !$('#upiOk', foot)) { stopWatch(); offWatch.disconnect(); } });
    offWatch.observe(document.body, { childList: true, subtree: true });
    $('#upiBack', foot).onclick = async () => { if (!await m.guard()) return; stopWatch(); upiView = null; draw(); };
    $('#upiOk', foot).onclick = () => {
      const utr = $('#upiUtr', body).value.trim();
      if (utr && !C.validUtr(utr)) return toast('UTR is 12 digits');
      stopWatch(); m.guard = null; payments.push({ mode: 'upi', amountPaise, utr, ref }); upiView = null; draw();
    };
  };
  const alertPaid = (amountPaise, hit) => acceptVerified(amountPaise, null, { mode: 'upi', amountPaise, utr: '', ref: hit.id, app: hit.app, gateway: 'alerts', verified: true });
  const alertState = st => {
    const el = $('#alStatus', body); if (!el || !st) return;
    if (!st.enabled) el.innerHTML = '<div class="alert warn">Notification access is off, so the app can\'t see payment alerts. Turn it on in Settings → UPI payments, or tap “Payment received” yourself.</div>';
  };
  draw();
}
async function completeSale(bill, payments, change, { showReceipt = false } = {}) {
  const s = S.settings, at = Date.now();
  const cust = customerById(S.cart.customerId);
  const n = C.nextDocNumber(S.counters, 'INV', Sync.prefix(s.invoicePrefix), at);
  const allZero = bill.lines.every(l => !l.gstRate);
  const sale = {
    id: uid(), number: n.number, seq: n.seq, fy: n.fy, at, status: 'completed',
    docType: s.regime === 'regular' && allZero ? 'BILL OF SUPPLY' : C.REGIMES[s.regime].doc,
    regime: s.regime,
    shop: { name: s.shopName, address: s.address, phone: s.phone, fssai: s.fssai, gstin: s.gstin, stateCode: s.stateCode, upiVpa: s.upiVpa, upiName: s.upiName, footer: s.footer },
    customer: cust ? { id: cust.id, name: cust.name, phone: cust.phone, gstin: cust.gstin, address: cust.address, stateCode: cust.stateCode, pan: cust.pan } : null,
    bill, payments, change
  };
  // Metal lines: cut the bars, keep offcuts, scrap short ends. Checked first, saved in the same transaction as the bill.
  const metal = Metal.applySale(bill.lines);
  if (!metal.ok) return toast(metal.error);
  const writes = [{ store: 'sales', value: sale }, { store: 'kv', value: { key: 'counters', value: n.counters } }, ...metal.writes];
  const changed = [];
  for (const l of bill.lines) {
    const pr = S.products.find(x => x.id === l.productId);
    if (pr && !pr.metal) { const np = { ...pr, stock: Math.round((pr.stock - l.qty) * 1000) / 1000 }; writes.push({ store: 'products', value: np }); changed.push(np); }
  }
  const udhaar = payments.filter(p => p.mode === 'udhaar').reduce((a, p) => a + p.amountPaise, 0);
  let kEntry;
  if (udhaar && cust) { kEntry = { id: uid(), customerId: cust.id, at, amountPaise: udhaar, type: 'sale', ref: sale.number, saleId: sale.id }; writes.push({ store: 'khata', value: kEntry }); }
  try { await db.writeAll(writes); } catch (e) { toast('Could not save the sale: ' + e.message); return; }
  S.counters = n.counters; S.sales.unshift(sale); metal.commit(); changed.push(...(metal.products || []));
  for (const np of changed) S.products = S.products.map(x => x.id === np.id ? np : x);
  if (kEntry) S.khata.push(kEntry);
  S.cart = newCart(); saveCart(); renderBill();
  const low = changed.filter(p => p.stock <= (p.lowStock || 0));
  if (low.length) toast(`Low stock: ${low.map(p => p.name).slice(0, 3).join(', ')}`);
  showInvoice(sale, true, { expand: showReceipt });
}

/* ================= invoice / receipt ================= */
/** Heat / batch numbers of the bars a metal line was cut from (for traceability on the bill). */
const heatOf = l => [...new Set((Array.isArray(l?.metal?.cuts) ? l.metal.cuts : []).map(c => String(c?.heat || '').replace(/[^A-Za-z0-9/ -]/g, '').slice(0, 24)).filter(Boolean))].slice(0, 6).join(', ');
function invoiceHtml(doc, paper = S.settings.paper || 'w80', kind = 'invoice') {
  const isCn = kind === 'cn';
  const sale = isCn ? S.sales.find(x => x.id === doc.invoiceId) : doc;
  const b = isCn ? doc.totals : doc.bill, shop = sale.shop, cu = sale.customer, reg = sale.regime === 'regular' && sale.bill.chargesTax;
  const sLbl = C.stateTaxLabel(shop.stateCode), inter = sale.bill.interState;
  const lines = b.lines.map(l => `<tr><td colspan="4">${esc(l.name)}${reg && l.hsn ? ` <span class="small">HSN ${esc(l.hsn)}</span>` : ''}</td></tr>
     <tr><td>${fmtQty(l.qty, l.unit)}</td><td class="r">${isCn ? '' : C.plain(l.pricePaise)}</td><td class="r">${reg ? l.gstRate + '%' : ''}</td><td class="r">${C.plain(l.total)}</td></tr>
     ${!isCn && l.promoPaise ? `<tr><td colspan="3" class="small">Offer: ${esc(l.promoLabel)}</td><td class="r small">-${C.plain(l.promoPaise)}</td></tr>` : ''}
     ${!isCn && heatOf(l) ? `<tr><td colspan="4" class="small">Heat no: ${esc(heatOf(l))}</td></tr>` : ''}`).join('');
  const byRate = isCn ? Object.values(b.lines.reduce((a, l) => { const r = a[l.gstRate] ||= { rate: l.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 }; for (const k of ['taxable', 'cgst', 'sgst', 'igst', 'cess']) r[k] += l[k]; return a; }, {})) : b.byRate;
  const taxTable = reg ? `<table><tr><th>GST%</th><th class="r">Taxable</th>${inter ? '<th class="r">IGST</th>' : `<th class="r">CGST</th><th class="r">${sLbl}</th>`}</tr>
    ${byRate.map(r => `<tr><td>${r.rate}%</td><td class="r">${C.plain(r.taxable)}</td>${inter ? `<td class="r">${C.plain(r.igst)}</td>` : `<td class="r">${C.plain(r.cgst)}</td><td class="r">${C.plain(r.sgst)}</td>`}</tr>`).join('')}</table>` : '';
  const udhaarBal = !isCn && cu?.id ? balanceOf(cu.id) : 0;
  const upiQr = !isCn && udhaarBal > 0 && shop.upiVpa ? `<div class="c small">Scan to pay ${W().udhaar} ${money(udhaarBal)}</div><div class="qr">${qrSvg(C.upiUri({ vpa: shop.upiVpa, payeeName: shop.upiName, amountPaise: udhaarBal, note: `${W().Udhaar} ${shop.name}`.slice(0, 50) }))}</div>` : '';
  return `<div class="invoice ${paper}">
    ${doc.status === 'cancelled' ? '<div class="doc">*** CANCELLED ***</div>' : ''}
    <h4>${esc(shop.name)}</h4>
    <div class="c">${esc(shop.address)}${shop.phone ? `<br>Ph: ${esc(shop.phone)}` : ''}</div>
    ${shop.gstin ? `<div class="c">GSTIN: <b>${esc(shop.gstin)}</b></div>` : ''}
    <div class="c">State: ${esc(C.stateLabel(shop.stateCode))}</div>
    ${shop.fssai ? `<div class="c">FSSAI Lic. No: ${esc(shop.fssai)}</div>` : ''}
    <div class="doc">${isCn ? 'CREDIT NOTE' : esc(doc.docType)}</div>
    <table><tr><td>${isCn ? 'Note' : 'Bill'} No: <b>${esc(doc.number)}</b></td><td class="r">${C.gstDate(doc.at)}</td></tr>
    ${isCn ? `<tr><td colspan="2">Against invoice ${esc(sale.number)} dt ${C.gstDate(sale.at)}</td></tr>` : ''}</table>
    ${cu ? `<div>To: <b>${esc(cu.name)}</b>${cu.gstin ? `<br>GSTIN: ${esc(cu.gstin)}` : ''}${cu.address ? `<br>${esc(cu.address)}` : ''}${cu.stateCode ? `<br>State: ${esc(C.stateLabel(cu.stateCode))}` : ''}${cu.pan && !cu.gstin && sale.bill.grandTotal > C.LIMITS.PAN_114B ? `<br>PAN: ${esc(cu.pan)}` : ''}</div>` : ''}
    ${reg ? `<div>Place of supply: ${esc(C.stateLabel(sale.bill.placeOfSupply))}</div>` : ''}
    <hr><table><tr><th>Qty</th><th class="r">Rate</th><th class="r">${reg ? 'GST' : ''}</th><th class="r">Amt</th></tr>${lines}</table><hr>
    <table>
      ${!isCn && b.discount ? `<tr><td>Discount given</td><td class="r">${C.plain(b.discount)}</td></tr>` : ''}
      ${reg ? `<tr><td>Taxable value</td><td class="r">${C.plain(b.taxable)}</td></tr>
        ${inter ? `<tr><td>IGST</td><td class="r">${C.plain(b.igst)}</td></tr>` : `<tr><td>CGST</td><td class="r">${C.plain(b.cgst)}</td></tr><tr><td>${sLbl}</td><td class="r">${C.plain(b.sgst)}</td></tr>`}
        ${b.cess ? `<tr><td>Cess</td><td class="r">${C.plain(b.cess)}</td></tr>` : ''}` : ''}
      ${b.roundOff ? `<tr><td>Round off</td><td class="r">${C.plain(b.roundOff)}</td></tr>` : ''}
      <tr class="tot"><td>${isCn ? 'CREDIT TOTAL' : 'TOTAL'}</td><td class="r">₹${C.plain(b.grandTotal)}</td></tr></table>
    <div class="small">${C.amountInWords(b.grandTotal)}</div>
    ${taxTable ? `<hr>${taxTable}` : ''}
    ${reg ? '<div class="small">Tax payable on reverse charge: No</div>' : ''}
    ${sale.regime === 'composition' ? `<div class="small"><b>${C.COMPOSITION_DECLARATION}</b></div>` : ''}
    ${!isCn ? `<hr>${doc.payments.map(p => `<div>${esc(payName(p.mode))}${p.utr ? ` (UTR ${esc(p.utr)})` : p.mode === 'card' && p.ref ? ` (Ref ${esc(p.ref)})` : ''}: ₹${C.plain(p.amountPaise)}</div>`).join('')}${doc.change ? `<div>Change returned: ₹${C.plain(doc.change)}</div>` : ''}` : `<div>Refund: ${esc(doc.refundMode)}${doc.reason ? ` · ${esc(doc.reason)}` : ''}</div>`}
    ${udhaarBal > 0 ? `<div><b>Total ${W().udhaar} due: ₹${C.plain(udhaarBal)}</b></div>` : ''}
    ${upiQr}
    <hr><div class="r small">For ${esc(shop.name)}<br><br>Authorised Signatory</div>
    ${shop.footer ? `<div class="c">${esc(shop.footer)}</div>` : ''}
  </div>`;
}
let cssCache;
const appCss = async () => (cssCache ??= await fetch('style.css').then(r => r.text()).catch(() => ''));
async function printDoc(html, name = 'Receipt') {
  const printer = NATIVE && plugin('ReceiptPrinter');
  if (printer) {
    // Android WebView ignores window.print(); the native plugin opens Android's print screen
    // (Bluetooth/thermal printers work through their print-service app, e.g. the printer maker's or RawBT).
    const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${await appCss()}</style><style>body{margin:0;background:#fff;overflow:visible}html{overflow:visible}</style></head><body><div id="printArea">${html}</div></body></html>`;
    try { await printer.print({ html: doc, name, paper: S.settings.paper || 'w80' }); } catch (e) { toast('Print failed: ' + e.message); }
    return;
  }
  $('#printArea').innerHTML = html;
  setTimeout(() => {
    // A normal browser shows its print screen here. Some embedded previews have no printing at all: say so instead of doing nothing.
    let shown = false; const mark = () => { shown = true; };
    addEventListener('beforeprint', mark, { once: true });
    try { window.print(); } catch { /* handled below */ }
    setTimeout(() => { removeEventListener('beforeprint', mark); if (!shown) toast('This window cannot print. Open the app in Chrome, or use the Android app.'); }, 900);
  }, 50);
}
/** Receipt as simple rows — drawn on a canvas for the WhatsApp image (576 px = 80 mm thermal width). */
function receiptRows(doc, kind = 'invoice') {
  const isCn = kind === 'cn', sale = docSale(doc, kind), shop = sale.shop, cu = sale.customer;
  const b = isCn ? doc.totals : doc.bill, reg = sale.regime === 'regular' && sale.bill.chargesTax, inter = sale.bill.interState;
  const sLbl = C.stateTaxLabel(shop.stateCode), R = [], P = C.plain;
  const k = C.cleanText, c = (text, o = {}) => R.push({ t: 'c', text: k(text), ...o }), lr = (l, r, o = {}) => R.push({ t: 'lr', l: k(l), r: k(r), ...o }), tx = (text, o = {}) => R.push({ t: 'x', text: k(text), ...o }), hr = () => R.push({ t: 'hr' });
  if (doc.status === 'cancelled') c('*** CANCELLED ***', { bold: true });
  c(shop.name, { bold: true, size: 1.35 });
  c(shop.address); if (shop.phone) c('Ph: ' + shop.phone);
  if (shop.gstin) c('GSTIN: ' + shop.gstin, { bold: true });
  c('State: ' + C.stateLabel(shop.stateCode)); if (shop.fssai) c('FSSAI Lic. No: ' + shop.fssai);
  R.push({ t: 'box', text: k(isCn ? 'CREDIT NOTE' : doc.docType) });
  lr(`${isCn ? 'Note' : 'Bill'} No: ${doc.number}`, C.gstDate(doc.at), { bold: true });
  if (isCn) tx(`Against invoice ${sale.number} dt ${C.gstDate(sale.at)}`);
  if (cu) { tx('To: ' + cu.name, { bold: true }); if (cu.gstin) tx('GSTIN: ' + cu.gstin); if (cu.address) tx(cu.address); if (cu.stateCode) tx('State: ' + C.stateLabel(cu.stateCode)); }
  if (reg) tx('Place of supply: ' + C.stateLabel(sale.bill.placeOfSupply));
  hr(); lr('Item / Qty x Rate', 'Amount', { bold: true }); hr();
  for (const l of b.lines) {
    tx(l.name + (reg && l.hsn ? `  (HSN ${l.hsn})` : ''));
    lr(`  ${fmtQty(l.qty, l.unit)}${isCn ? '' : ' x ' + P(l.pricePaise)}${reg ? `  GST ${l.gstRate}%` : ''}`, P(l.total));
    if (!isCn && l.promoPaise) lr(`  Offer: ${l.promoLabel}`, '-' + P(l.promoPaise), { small: true });
    if (!isCn && heatOf(l)) tx(`  Heat no: ${heatOf(l)}`, { small: true });
  }
  hr();
  if (!isCn && b.discount) lr('Discount given', P(b.discount));
  if (reg) {
    lr('Taxable value', P(b.taxable));
    if (inter) lr('IGST', P(b.igst)); else { lr('CGST', P(b.cgst)); lr(sLbl, P(b.sgst)); }
    if (b.cess) lr('Cess', P(b.cess));
  }
  if (b.roundOff) lr('Round off', P(b.roundOff));
  lr(isCn ? 'CREDIT TOTAL' : 'TOTAL', '₹' + P(b.grandTotal), { bold: true, size: 1.3 });
  tx(C.amountInWords(b.grandTotal), { small: true });
  if (reg && !isCn) { hr(); for (const r of b.byRate) lr(`GST ${r.rate}% on ${P(r.taxable)}`, inter ? `IGST ${P(r.igst)}` : `C ${P(r.cgst)} + S ${P(r.sgst)}`, { small: true }); tx('Tax payable on reverse charge: No', { small: true }); }
  if (sale.regime === 'composition') tx(C.COMPOSITION_DECLARATION, { small: true, bold: true });
  hr();
  if (!isCn) { for (const p of doc.payments) lr(payName(p.mode) + (p.utr ? ` (UTR ${p.utr})` : p.mode === 'card' && p.ref ? ` (Ref ${p.ref})` : ''), '₹' + P(p.amountPaise)); if (doc.change) lr('Change returned', '₹' + P(doc.change)); }
  else lr('Refund: ' + refundName(doc.refundMode), '₹' + P(b.grandTotal));
  const bal = !isCn && cu?.id ? balanceOf(cu.id) : 0;
  if (bal > 0) { lr(`Total ${W().udhaar} due`, '₹' + P(bal), { bold: true }); if (shop.upiVpa) { c('Scan to pay by UPI', { small: true }); R.push({ t: 'qr', text: C.upiUri({ vpa: shop.upiVpa, payeeName: shop.upiName, amountPaise: bal, note: `${W().Udhaar} ${shop.name}`.slice(0, 50) }) }); } }
  hr(); R.push({ t: 'r', text: 'For ' + shop.name, small: true }); R.push({ t: 'r', text: 'Authorised Signatory', small: true, gap: 18 });
  if (shop.footer) c(shop.footer);
  return R;
}
async function receiptPng(doc, kind = 'invoice') {
  const { encodeQr } = await import('./qr.mjs');
  const W = 576, PAD = 22, F = 22, LH = 1.38, FONT = (sz, bold) => `${bold ? '700 ' : ''}${Math.round(F * sz)}px ui-monospace, Menlo, "Roboto Mono", "Droid Sans Mono", monospace`;
  const rows = receiptRows(doc, kind);
  const cv = document.createElement('canvas'), g = cv.getContext('2d');
  const wrap = (text, font, max) => { g.font = font; const out = []; let line = ''; for (const word of String(text).split(' ')) { const tryL = line ? line + ' ' + word : word; if (g.measureText(tryL).width <= max || !line) line = tryL; else { out.push(line); line = word; } } if (line) out.push(line); return out; };
  const ops = []; let y = PAD;
  for (const r of rows) {
    const sz = r.size || (r.small ? 0.82 : 1), font = FONT(sz, r.bold), lh = F * sz * LH;
    if (r.gap) y += r.gap;
    if (r.t === 'hr') { const yy = y + 8; ops.push(() => { g.setLineDash([6, 5]); g.beginPath(); g.moveTo(PAD, yy); g.lineTo(W - PAD, yy); g.stroke(); g.setLineDash([]); }); y += 18; continue; }
    if (r.t === 'qr') { const q = encodeQr(r.text), cell = Math.floor(220 / (q.size + 8)), qs = cell * (q.size + 8), x0 = (W - qs) / 2, y0 = y; ops.push(() => { for (let yy = 0; yy < q.size; yy++) for (let xx = 0; xx < q.size; xx++) if (q.modules[yy][xx]) g.fillRect(x0 + (xx + 4) * cell, y0 + (yy + 4) * cell, cell, cell); }); y += qs + 6; continue; }
    if (r.t === 'box') { const yy = y; ops.push(() => { g.strokeRect(PAD, yy + 2, W - 2 * PAD, lh + 6); g.font = FONT(1, true); g.textAlign = 'center'; g.fillText(r.text, W / 2, yy + lh); }); y += lh + 14; continue; }
    if (r.t === 'lr') {
      g.font = font; const rw = g.measureText(r.r).width;
      const lines = wrap(r.l, font, W - 2 * PAD - rw - 16);
      lines.forEach((ln, i) => { const yy = y + lh * (i + 1) - lh * 0.28; ops.push(() => { g.font = font; g.textAlign = 'left'; g.fillText(ln, PAD, yy); if (i === lines.length - 1) { g.textAlign = 'right'; g.fillText(r.r, W - PAD, yy); } }); });
      y += lh * lines.length; continue;
    }
    const align = r.t === 'c' ? 'center' : r.t === 'r' ? 'right' : 'left', x = align === 'center' ? W / 2 : align === 'right' ? W - PAD : PAD;
    for (const ln of wrap(r.text, font, W - 2 * PAD)) { const yy = y + lh - lh * 0.28; ops.push(() => { g.font = font; g.textAlign = align; g.fillText(ln, x, yy); }); y += lh; }
  }
  const scale = 1.5;
  cv.width = W * scale; cv.height = Math.ceil((y + PAD) * scale);
  g.scale(scale, scale); g.fillStyle = '#fff'; g.fillRect(0, 0, W, y + PAD); g.fillStyle = '#000'; g.strokeStyle = '#000'; g.lineWidth = 1.5; g.textBaseline = 'alphabetic';
  for (const op of ops) op();
  return new Promise((res, rej) => cv.toBlob(bl => bl ? res(bl) : rej(new Error('Could not create image')), 'image/png'));
}
function waText(sale) {
  const b = sale.bill, cu = sale.customer;
  const bal = cu?.id ? balanceOf(cu.id) : 0;
  let txt = `*${sale.shop.name}*\n${sale.docType} ${sale.number}\n${C.displayDateTime(sale.at)}\n\n` +
    b.lines.map(l => `${l.name} × ${fmtQty(l.qty, l.unit)} = ${money(l.total)}`).join('\n') +
    `\n\n*Total: ${money(b.grandTotal)}*\nPaid: ${sale.payments.map(p => `${payName(p.mode)} ${money(p.amountPaise)}`).join(', ')}`;
  if (bal > 0 && sale.shop.upiVpa) txt += `\n\n${W().Udhaar} due: ${money(bal)}\nPay by UPI: ${C.upiUri({ vpa: sale.shop.upiVpa, payeeName: sale.shop.upiName, amountPaise: bal, note: W().Udhaar })}`;
  return txt + `\n\n${sale.shop.footer || 'Thank you!'}`;
}
function cnText(cn) {
  const sale = S.sales.find(x => x.id === cn.invoiceId);
  return `*${sale.shop.name}*\nCredit note ${cn.number}\nAgainst bill ${sale.number}\n${C.displayDateTime(cn.at)}\n\n` +
    cn.totals.lines.map(l => `${l.name} × ${fmtQty(l.qty, l.unit)} = ${money(l.total)}`).join('\n') +
    `\n\n*Refund: ${money(cn.totals.grandTotal)}* (${refundName(cn.refundMode)})`;
}
function waLink(phone, text) { const ph = C.validatePhone(phone); return `https://wa.me/${ph ? '91' + ph : ''}?text=${encodeURIComponent(C.cleanText(text))}`; }
const docSale = (doc, kind) => (kind === 'cn' ? S.sales.find(x => x.id === doc.invoiceId) : doc);

/** WhatsApp a receipt: text straight to the customer's chat, or the receipt as an image via the share menu. */
function whatsappReceipt(doc, kind = 'invoice') {
  const sale = docSale(doc, kind);
  const cust = sale?.customer?.id ? customerById(sale.customer.id) : null;
  const needsConsent = cust && !cust.deleted && !cust.waConsent;
  const m = modal(`${t('whatsapp')} — ${doc.number}`, `
    <label>Customer's WhatsApp number<input id="waPh" type="tel" inputmode="numeric" maxlength="14" placeholder="98765 43210" value="${esc(cust && !cust.deleted ? cust.phone || '' : '')}"></label>
    ${needsConsent ? `<label class="row" style="color:var(--ink)"><input type="checkbox" id="waOk" style="width:auto;min-height:auto"> ${esc(cust.name)} agrees to get bills on WhatsApp</label>` : ''}
    <p class="hint"><b>Send bill</b> opens WhatsApp with this number and the bill written out (leave the number empty to pick a contact).<br><b>Share receipt image</b> sends a picture of the printed receipt — choose WhatsApp, then the contact.</p>`,
    `<button class="btn" id="waImg">🖼 Share receipt image</button><span class="grow"></span><button class="btn ok big" id="waTxt">Send bill on WhatsApp</button>`);
  const consentOk = async () => {
    if (!needsConsent) return true;
    if (!$('#waOk', m).checked) { toast('Ask the customer first, then tick the box'); return false; }
    const rec = { ...cust, waConsent: true }; await db.put('customers', rec); S.customers = S.customers.map(x => x.id === rec.id ? rec : x);
    return true;
  };
  const text = () => (kind === 'cn' ? cnText(doc) : waText(doc));
  $('#waTxt', m).onclick = async () => {
    const raw = $('#waPh', m).value.trim();
    const ph = raw ? C.validatePhone(raw) : '';
    if (raw && !ph) return toast('Enter a 10-digit mobile number');
    if (!await consentOk()) return;
    m.close(); openExternal(waLink(ph, text()));
  };
  $('#waImg', m).onclick = async () => {
    if (!await consentOk()) return;
    const btn = $('#waImg', m); btn.disabled = true; btn.textContent = 'Making image…';
    try {
      await shareReceiptImage(doc, kind, 'Image saved — attach it in WhatsApp');
      m.close();
    } catch (e) { if (!/cancel|abort/i.test(e.message)) toast('Could not share image: ' + e.message); btn.disabled = false; btn.textContent = '🖼 Share receipt image'; }
  };
}

/** Shares the receipt as a picture through the phone's share menu (WhatsApp, Gmail, …); on a PC it saves the picture. */
async function shareReceiptImage(doc, kind, savedHint) {
  const sale = docSale(doc, kind), png = await receiptPng(doc, kind);
  const name = `${doc.number.replace(/\//g, '-')}.png`, caption = `${sale.shop.name} — ${doc.number}`;
  if (NATIVE) return nativeShareFile(name, await blobToBase64(png), { base64: true, text: caption });
  const file = new File([png], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) return navigator.share({ files: [file], text: caption });
  const a = document.createElement('a'); a.href = URL.createObjectURL(png); a.download = name; a.click(); toast(savedHint);
}
const validEmail = v => /^[^\s@<>"',;]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(v) && v.length <= 120;
/** Email a bill: opens Gmail (or the phone's mail app) with the bill written out, or shares the receipt picture to attach. */
function emailReceipt(doc, kind = 'invoice') {
  const sale = docSale(doc, kind);
  const m = modal(`Email — ${doc.number}`, `
    <label>Customer's email address<input id="emTo" type="email" inputmode="email" autocomplete="off" maxlength="120" placeholder="name@example.com"></label>
    <p class="hint"><b>Write email</b> opens ${NATIVE ? 'your mail app (Gmail)' : 'Gmail'} with the address and the bill written out — you press Send there (leave the address empty to choose it there).<br><b>Send receipt picture</b> ${NATIVE ? 'opens the share menu — choose Gmail and the picture is attached.' : 'saves the picture so you can attach it.'}</p>`,
    `<button class="btn" id="emImg">🖼 Send receipt picture</button><span class="grow"></span><button class="btn pri big" id="emGo">✉ Write email</button>`);
  $('#emGo', m).onclick = () => {
    const to = $('#emTo', m).value.trim();
    if (to && !validEmail(to)) return toast('Check the email address');
    const subject = `${kind === 'cn' ? 'Credit note' : sale.docType} ${doc.number} — ${sale.shop.name}`;
    const body = C.cleanText(kind === 'cn' ? cnText(doc) : waText(doc)).replace(/\*/g, '').slice(0, 1500);
    m.close();
    if (NATIVE) return openExternal(`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
    openExternal(`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  };
  $('#emImg', m).onclick = async () => {
    const btn = $('#emImg', m); btn.disabled = true; btn.textContent = 'Making picture…';
    try { await shareReceiptImage(doc, kind, 'Picture saved — attach it to your email'); m.close(); }
    catch (e) { if (!/cancel|abort/i.test(e.message)) toast('Could not share picture: ' + e.message); btn.disabled = false; btn.textContent = '🖼 Send receipt picture'; }
  };
}

/* ---------- receipt rows (used by the Receipts panel and each customer's page) ---------- */
function receiptRow(doc, kind) {
  const sale = docSale(doc, kind);
  const who = sale?.customer?.name || t('walkin');
  const left = kind === 'cn'
    ? `<div class="t1">${esc(doc.number)} <span class="tag">Credit note</span></div><div class="t2">${C.displayDateTime(doc.at)} · ${esc(who)} · ${esc(refundName(doc.refundMode))}</div>`
    : `<div class="t1">${esc(doc.number)} ${doc.status === 'cancelled' ? '<span class="tag low">Cancelled</span>' : ''}</div><div class="t2">${C.displayDateTime(doc.at)} · ${esc(who)} · ${doc.payments.map(p => MODE_LABEL(p.mode)).join('+')}</div>`;
  const amt = kind === 'cn' ? `−${money(doc.totals.grandTotal)}` : money(doc.bill.grandTotal);
  return `<div class="li rrow"><button class="grow rview" data-view="${kind}:${doc.id}">${left}</button>
    <b class="num">${amt}</b>
    <button class="btn sm wa" data-wa="${kind}:${doc.id}" aria-label="WhatsApp ${esc(doc.number)}">WhatsApp</button></div>`;
}
function findDoc(key) {
  const [kind, id] = key.split(':');
  return { kind, doc: kind === 'cn' ? S.creditNotes.find(x => x.id === id) : S.sales.find(x => x.id === id) };
}
function wireReceiptRows(root, before = () => {}) {
  root.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { const { kind, doc } = findDoc(b.dataset.view); before(); kind === 'cn' ? showCreditNote(doc) : showInvoice(doc); });
  root.querySelectorAll('[data-wa]').forEach(b => b.onclick = () => { const { kind, doc } = findDoc(b.dataset.wa); whatsappReceipt(doc, kind); });
}
function showCreditNote(c) {
  const m = modal(c.number, `<div style="background:#f0f0f0;padding:10px;border-radius:10px;overflow:auto">${invoiceHtml(c, undefined, 'cn')}</div>`,
    `<span class="grow"></span><button class="btn ok" id="cnWa">${esc(t('whatsapp'))}</button><button class="btn" id="cnMail">✉ Email</button><button class="btn" id="cnPrint">🖨 ${esc(t('print'))}</button>`, { wide: true });
  $('#cnPrint', m).onclick = () => printDoc(invoiceHtml(c, undefined, 'cn'), c.number);
  $('#cnWa', m).onclick = () => whatsappReceipt(c, 'cn');
  $('#cnMail', m).onclick = () => emailReceipt(c, 'cn');
}
function renderReceipts() {
  const p = $('#page-receipts');
  S.rq ??= ''; S.rr ??= 'today';
  const today = C.istDate();
  const since = { today, '7': C.istDate(Date.now() - 6 * 864e5), '30': C.istDate(Date.now() - 29 * 864e5), all: '0000-00-00' }[S.rr];
  const q = S.rq.trim().toLowerCase(), qd = q.replace(/\D/g, '');
  const match = (doc, kind) => {
    if (C.istDate(doc.at) < since) return false;
    if (!q) return true;
    const s = docSale(doc, kind), cu = s?.customer || {};
    return doc.number.toLowerCase().includes(q) || (cu.name || '').toLowerCase().includes(q) || (qd.length >= 4 && (cu.phone || '').includes(qd));
  };
  const rows = [...S.sales.filter(s => match(s, 'invoice')).map(d => ({ d, k: 'invoice' })), ...S.creditNotes.filter(c => match(c, 'cn')).map(d => ({ d, k: 'cn' }))]
    .sort((a, b) => b.d.at - a.d.at);
  const total = rows.filter(r => r.k === 'invoice' && r.d.status !== 'cancelled').reduce((a, r) => a + r.d.bill.grandTotal, 0);
  p.innerHTML = `<div class="toolbar"><input id="rcq" type="search" placeholder="Bill number, customer name or phone" value="${esc(S.rq)}"></div>
    <div class="toolbar">${[['today', t('today')], ['7', '7 days'], ['30', '30 days'], ['all', 'All']].map(([k, l]) => `<button class="btn sm${S.rr === k ? ' pri' : ''}" data-rr="${k}">${esc(l)}</button>`).join('')}
      <span class="hint grow" style="text-align:right">${rows.length} receipts · ${money(total)}</span></div>
    <div class="list" id="rcList">${rows.slice(0, 300).map(r => receiptRow(r.d, r.k)).join('') || '<div class="empty">No receipts found.</div>'}</div>
    ${rows.length > 300 ? '<p class="hint">Showing the latest 300 — search to find older receipts.</p>' : ''}`;
  $('#rcq').oninput = e => { S.rq = e.target.value; renderReceipts(); const i = $('#rcq'); i.focus(); i.setSelectionRange(99, 99); };
  p.querySelectorAll('[data-rr]').forEach(b => b.onclick = () => { S.rr = b.dataset.rr; renderReceipts(); });
  wireReceiptRows(p);
}
function showInvoice(sale, fresh = false, { expand = false } = {}) {
  const cns = S.creditNotes.filter(c => c.invoiceId === sale.id);
  const hero = fresh ? `<div class="done-hero"><div class="done-tick">✓</div><b class="num">${money(sale.bill.grandTotal)}</b>
      <span>${sale.payments.map(p => esc(MODE_LABEL(p.mode))).join(' + ')}${sale.change ? ` · ${esc('Change')} ${money(sale.change)}` : ''}</span><small>${esc(sale.number)}${sale.customer ? ' · ' + esc(sale.customer.name) : ''}</small></div>
      <details class="preview"${expand ? ' open' : ''}><summary>Show receipt</summary>` : '';
  const m = modal(fresh ? 'Sale complete' : sale.number, `${hero}<div style="background:#f0f0f0;padding:10px;border-radius:10px;overflow:auto">${invoiceHtml(sale)}</div>${fresh ? '</details>' : ''}
    ${cns.length ? `<h3>Credit notes</h3>${cns.map(c => `<button class="li" data-cn="${c.id}"><div class="grow"><div class="t1">${esc(c.number)}</div><div class="t2">${C.displayDateTime(c.at)}</div></div><span class="num">−${money(c.totals.grandTotal)}</span></button>`).join('')}` : ''}`,
    `${!fresh && sale.status !== 'cancelled' ? '<button class="btn" id="ivReturn">Return items</button><button class="btn bad" id="ivCancel">Cancel bill</button>' : ''}<span class="grow"></span>
     <button class="btn wa${fresh ? ' big' : ''}" id="ivWa">${esc(t('whatsapp'))}</button><button class="btn${fresh ? ' big' : ''}" id="ivMail">✉ Email</button><button class="btn${fresh ? ' big' : ''}" id="ivPrint">🖨 ${esc(t('print'))}</button>${fresh ? `<button class="btn pri big" data-close>＋ ${esc(t('newBill'))}</button>` : ''}`, { wide: true });
  $('#ivPrint', m).onclick = () => printDoc(invoiceHtml(sale), sale.number);
  $('#ivWa', m).onclick = () => whatsappReceipt(sale, 'invoice');
  $('#ivMail', m).onclick = () => emailReceipt(sale, 'invoice');
  m.querySelectorAll('[data-cn]').forEach(b => b.onclick = () => showCreditNote(S.creditNotes.find(x => x.id === b.dataset.cn)));
  $('#ivReturn', m)?.addEventListener('click', () => { m.close(); returnModal(sale); });
  $('#ivCancel', m)?.addEventListener('click', () => { m.close(); cancelSale(sale); });
}
function returnModal(sale) {
  const left = C.returnableQty(sale, S.creditNotes);
  if (left.every(q => !q)) return toast('Everything on this bill is already returned');
  const m = modal(`Return — ${sale.number}`, `<p class="hint">Creates a GST credit note (s.34) and puts stock back${isMetal() ? ' (cut metal pieces are not put back: receive them as stock if you keep them)' : ''}.</p>
    <table><tr><th>Item</th><th class="r">Can return</th><th class="r">Return qty</th></tr>
    ${sale.bill.lines.map((l, i) => left[i] ? `<tr><td>${esc(l.name)}</td><td class="r">${fmtQty(left[i], l.unit)}</td><td class="r"><input data-ri="${i}" type="number" inputmode="decimal" min="0" max="${left[i]}" step="${C.LOOSE_UNITS.has(l.unit) ? 0.001 : 1}" value="0" style="width:90px"></td></tr>` : '').join('')}</table>
    <div class="grid2"><label>Refund as<select id="rtMode"><option value="Cash">Cash</option><option value="UPI">UPI</option>${sale.customer?.id ? `<option value="Khata">${metalWords() ? 'Reduce credit due' : 'Reduce udhaar (khata)'}</option>` : ''}</select></label>
    <label>Reason<input id="rtReason" maxlength="80" placeholder="Damaged / wrong item"></label></div><p id="rtSum" class="due num"></p>`,
    `<button class="btn pri" id="rtSave">Create credit note</button>`, { wide: true });
  const picks = () => { const p = {}; m.querySelectorAll('[data-ri]').forEach(inp => { const i = Number(inp.dataset.ri), q = Math.min(Number(inp.value) || 0, left[i]); if (q > 0) p[i] = q; }); return p; };
  const upd = () => { $('#rtSum', m).textContent = money(C.buildCreditNoteLines(sale, picks()).grandTotal); };
  m.querySelectorAll('[data-ri]').forEach(i => i.oninput = upd); upd();
  $('#rtSave', m).onclick = async () => {
    const totals = C.buildCreditNoteLines(sale, picks());
    if (!totals.lines.length) return toast('Enter a quantity to return');
    const at = Date.now(), n = C.nextDocNumber(S.counters, 'CN', Sync.prefix(S.settings.cnPrefix), at);
    const cn = { id: uid(), number: n.number, seq: n.seq, fy: n.fy, at, invoiceId: sale.id, totals, refundMode: $('#rtMode', m).value, reason: $('#rtReason', m).value.trim(), status: 'issued' };
    const writes = [{ store: 'creditNotes', value: cn }, { store: 'kv', value: { key: 'counters', value: n.counters } }];
    const changed = [];
    for (const l of totals.lines) { const pr = S.products.find(x => x.id === l.productId); if (pr && !pr.metal) { const np = { ...pr, stock: Math.round((pr.stock + l.qty) * 1000) / 1000 }; changed.push(np); writes.push({ store: 'products', value: np }); } }
    let k; if (cn.refundMode === 'Khata') { k = { id: uid(), customerId: sale.customer.id, at, amountPaise: -totals.grandTotal, type: 'return', ref: cn.number }; writes.push({ store: 'khata', value: k }); }
    await db.writeAll(writes);
    S.counters = n.counters; S.creditNotes.unshift(cn); if (k) S.khata.push(k);
    for (const np of changed) S.products = S.products.map(x => x.id === np.id ? np : x);
    m.close(); toast(`Credit note ${cn.number} — refund ${money(totals.grandTotal)}`);
    showCreditNote(cn);
    if (S.page === 'reports') renderReports();
  };
}
async function cancelSale(sale) {
  if (S.creditNotes.some(c => c.invoiceId === sale.id && c.status !== 'cancelled')) return toast('This bill has a return. Use another credit note instead.');
  const m = modal('Cancel bill ' + sale.number, `<div class="alert warn">Cancel only if the sale did not happen (wrong bill) and <b>before</b> you file GSTR-1 for this month. After filing, use “Return items” to issue a credit note. The number stays in the series and is reported as cancelled.</div>
    <label>Reason (optional)<input id="cxReason" maxlength="80" placeholder="e.g. wrong bill, customer left" autofocus></label>`, `<button class="btn bad" id="cxOk">Cancel bill</button>`);
  // There are no staff logins in this app, so whoever uses it is treated as the owner: the reason is optional.
  // (If cashier logins are added later, make it required for cashiers here.)
  $('#cxOk', m).onclick = async () => {
    const reason = $('#cxReason', m).value.trim();
    const upd = { ...sale, status: 'cancelled', cancelledAt: Date.now(), cancelReason: reason };
    const writes = [{ store: 'sales', value: upd }], changed = [];
    for (const l of sale.bill.lines) { const pr = S.products.find(x => x.id === l.productId); if (pr && !pr.metal) { const np = { ...pr, stock: Math.round((pr.stock + l.qty) * 1000) / 1000 }; changed.push(np); writes.push({ store: 'products', value: np }); } }
    const metal = Metal.cancelSale(sale); writes.push(...metal.writes);
    const kOrig = S.khata.filter(k => k.saleId === sale.id).reduce((a, k) => a + k.amountPaise, 0);
    let k; if (kOrig) { k = { id: uid(), customerId: sale.customer.id, at: Date.now(), amountPaise: -kOrig, type: 'cancel', ref: sale.number }; writes.push({ store: 'khata', value: k }); }
    await db.writeAll(writes);
    S.sales = S.sales.map(x => x.id === sale.id ? upd : x); if (k) S.khata.push(k);
    for (const np of changed) S.products = S.products.map(x => x.id === np.id ? np : x);
    metal.commit();
    m.close(); toast(metal.skipped ? `Bill cancelled. ${metal.skipped} stock piece${metal.skipped > 1 ? 's were' : ' was'} cut again since, so check your stock.` : 'Bill cancelled'); if (S.page === 'reports') renderReports();
  };
}

/* ================= khata ================= */
function remindCustomer(c) {
  const bal = balanceOf(c.id);
  if (!c.phone) return toast('Add a mobile number for this customer first');
  if (!c.waConsent) return toast('Customer has not agreed to WhatsApp messages — open the customer and edit');
  const txt = `Namaste ${c.name} 🙏\nYour pending amount at ${S.settings.shopName} is *${money(bal)}*.` + (S.settings.upiVpa ? `\nPay easily by UPI: ${C.upiUri({ vpa: S.settings.upiVpa, payeeName: S.settings.upiName, amountPaise: bal, note: W().Udhaar })}` : '') + '\nThank you!';
  openExternal(waLink(c.phone, txt));
}
function renderKhata() {
  const p = $('#page-khata');
  const rows = S.customers.filter(c => !c.deleted).map(c => {
    const last = S.khata.filter(k => k.customerId === c.id).reduce((m, k) => Math.max(m, k.at), 0);
    return { c, bal: balanceOf(c.id), last };
  });
  const q = S.khataFilter.toLowerCase();
  const list = rows.filter(r => !q || r.c.name.toLowerCase().includes(q) || (r.c.phone || '').includes(q)).sort((a, b) => b.bal - a.bal || b.last - a.last);
  const totalDue = rows.reduce((a, r) => a + Math.max(0, r.bal), 0), totalAdv = rows.reduce((a, r) => a + Math.max(0, -r.bal), 0);
  const ago = at => { if (!at) return ''; const d = Math.floor((Date.now() - at) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
  p.innerHTML = `<div class="khata-sum card"><div><span>${esc(t('youGet'))}</span><b class="num owes">${money(totalDue)}</b><small>${plural(rows.filter(r => r.bal > 0).length, 'customer')}</small></div>
      <div><span>${esc(t('advance'))}</span><b class="num clear">${money(totalAdv)}</b><small>${plural(rows.filter(r => r.bal < 0).length, 'customer')}</small></div></div>
    <div class="toolbar"><input id="kq" type="search" placeholder="🔍 Search name or phone" value="${esc(S.khataFilter)}"><button class="btn pri" id="kNew">＋ New customer</button></div>
    <div class="list">${list.map(({ c, bal, last }) => `<div class="li krow"><button class="grow kopen" data-k="${c.id}">${avatar(c.name)}<span class="kinfo"><span class="t1">${esc(c.name)}</span><span class="t2">${esc(c.phone || 'No phone')}${last ? ' · ' + ago(last) : ''}</span></span></button>
      <span class="kbal"><b class="num ${bal > 0 ? 'owes' : 'clear'}">${bal > 0 ? money(bal) : bal < 0 ? money(-bal) : '✓'}</b><small>${bal > 0 ? esc(t('youGet')) : bal < 0 ? esc(t('advance')) : 'settled'}</small></span>
      ${bal > 0 && c.phone ? `<button class="btn sm wa" data-remind="${c.id}" aria-label="Remind ${esc(c.name)} on WhatsApp">${esc(t('remindShort'))}</button>` : ''}</div>`).join('') || '<div class="empty">No customers yet. Add one, or pick a customer while billing.</div>'}</div>`;
  $('#kq').oninput = e => { S.khataFilter = e.target.value; renderKhata(); $('#kq').focus(); $('#kq').setSelectionRange(99, 99); };
  $('#kNew').onclick = () => customerModal({}, () => renderKhata());
  p.querySelectorAll('[data-k]').forEach(b => b.onclick = () => customerDetail(b.dataset.k));
  p.querySelectorAll('[data-remind]').forEach(b => b.onclick = () => remindCustomer(customerById(b.dataset.remind)));
}
function customerDetail(id) {
  const c = customerById(id), bal = balanceOf(id);
  const entries = S.khata.filter(k => k.customerId === id).sort((a, b) => b.at - a.at);
  const label = { sale: W().Udhaar + ' sale', payment: 'Payment received', return: 'Return', cancel: 'Bill cancelled', adjust: 'Opening balance' };
  const mySales = S.sales.filter(s => s.customer?.id === id);
  const myIds = new Set(mySales.map(s => s.id));
  const receipts = [...mySales.map(d => ({ d, k: 'invoice' })), ...S.creditNotes.filter(c => myIds.has(c.invoiceId)).map(d => ({ d, k: 'cn' }))].sort((a, b) => b.d.at - a.d.at);
  const boughtTotal = mySales.filter(s => s.status !== 'cancelled').reduce((a, s) => a + s.bill.grandTotal, 0);
  const m = modal(c.name, `<div class="due num ${bal > 0 ? 'owes' : 'clear'}">${bal > 0 ? money(bal) + ' due' : bal < 0 ? 'Advance ' + money(-bal) : 'No dues ✓'}</div>
    <p class="hint" style="text-align:center">${esc(c.phone || '')}</p>
    <div class="row" style="justify-content:center;margin:10px 0">
      <button class="btn pri" id="cdPay">${esc(t('receive'))}</button>
      <button class="btn" id="cdRemind"${bal > 0 && c.phone ? '' : ' disabled'}>${esc(t('remind'))}</button>
      <button class="btn ghost" id="cdOpen">Opening balance</button>
      <button class="btn ghost" id="cdEdit">Edit</button></div>
    ${!c.waConsent && c.phone ? '<p class="hint" style="text-align:center">Customer has not agreed to WhatsApp reminders — ask before sending.</p>' : ''}
    <div class="seg" role="tablist"><button class="on" data-tab="rc" role="tab">Receipts (${receipts.length})</button><button data-tab="kh" role="tab">${W().Khata} entries (${entries.length})</button></div>
    <div data-pane="rc"><p class="hint">Total bought: <b class="num">${money(boughtTotal)}</b></p>
      <div class="list">${receipts.map(r => receiptRow(r.d, r.k)).join('') || '<div class="empty">No receipts yet.</div>'}</div></div>
    <div data-pane="kh" hidden><table><tr><th>Date</th><th>Entry</th><th class="r">Amount</th></tr>${entries.map(e => `<tr><td>${C.displayDateTime(e.at)}</td><td>${esc(label[e.type] || e.type)} ${e.mode ? '· ' + esc(C.PAY_MODES[e.mode]) : ''}<br><span class="hint">${esc(e.ref || '')}</span></td><td class="r num ${e.amountPaise > 0 ? 'owes' : 'clear'}">${e.amountPaise > 0 ? '+' : '−'}${money(Math.abs(e.amountPaise))}</td></tr>`).join('') || '<tr><td colspan="3" class="hint">No entries.</td></tr>'}</table></div>
    ${bal === 0 && !entries.length && !receipts.length ? '<button class="btn bad sm" id="cdDel" style="margin-top:12px">Delete customer</button>' : ''}`, '', { wide: true });
  m.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    m.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
    m.querySelectorAll('[data-pane]').forEach(x => { x.hidden = x.dataset.pane !== b.dataset.tab; });
  });
  wireReceiptRows(m);
  $('#cdEdit', m).onclick = () => { m.close(); customerModal(c, () => { renderKhata(); customerDetail(id); }); };
  $('#cdPay', m).onclick = () => { m.close(); receivePayment(c); };
  $('#cdOpen', m).onclick = () => { m.close(); openingBalance(c); };
  $('#cdRemind', m).onclick = () => remindCustomer(c);
  $('#cdDel', m)?.addEventListener('click', async () => {
    if (!await confirmBox('Delete customer?', `Remove ${c.name}? Bills already issued keep their details.`, 'Delete', true)) return;
    const rec = { id: c.id, deleted: true, name: 'Deleted customer', createdAt: c.createdAt };
    await db.put('customers', rec); S.customers = S.customers.map(x => x.id === c.id ? rec : x); m.close(); renderKhata();
  });
}
function openingBalance(c) {
  const m = modal(`Opening balance — ${c.name}`, `<label>Amount the customer already owes you (₹)<input id="obA" type="number" inputmode="decimal" autofocus></label>`, `<button class="btn pri" id="obS">Add</button>`);
  $('#obS', m).onclick = async () => {
    const a = C.parsePaise($('#obA', m).value); if (!a) return toast('Enter an amount');
    const e = { id: uid(), customerId: c.id, at: Date.now(), amountPaise: a, type: 'adjust', ref: 'Old balance' };
    await db.put('khata', e); S.khata.push(e); m.close(); renderKhata(); customerDetail(c.id);
  };
}
function receivePayment(c) {
  const bal = balanceOf(c.id);
  let mode = 'cash';
  const m = modal(`${t('receive')} — ${c.name}`, '<div id="rpB"></div>', `<button class="btn ok big" id="rpOk">✓ ${esc(t('received'))}</button>`);
  const draw = () => {
    const amt = C.parsePaise($('#rpA', m)?.value) ?? bal;
    $('#rpB', m).innerHTML = `<p class="hint">Due: ${money(bal)}</p>
      <div class="paygrid" style="grid-template-columns:1fr 1fr">${['cash', 'upi'].map(k => `<button data-m="${k}" class="${mode === k ? 'on' : ''}">${esc(MODE_LABEL(k))}</button>`).join('')}</div>
      <label>Amount (₹)<input id="rpA" type="number" inputmode="decimal" value="${amt > 0 ? C.plain(amt) : ''}"></label>
      ${mode === 'upi' && S.settings.upiVpa && amt > 0 ? `<div class="upi-box"><div class="qr">${qrSvg(C.upiUri({ vpa: S.settings.upiVpa, payeeName: S.settings.upiName, amountPaise: amt, note: `${W().Udhaar} ${S.settings.shopName}`.slice(0, 50) }))}</div><label style="text-align:left">UTR (optional)<input id="rpUtr" inputmode="numeric" maxlength="12"></label></div>` : ''}`;
    m.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { mode = b.dataset.m; draw(); });
    $('#rpA', m).onchange = draw;
  };
  draw();
  $('#rpOk', m).onclick = async () => {
    const a = C.parsePaise($('#rpA', m).value); if (!a) return toast('Enter an amount');
    if (mode === 'cash' && a >= C.LIMITS.CASH_269ST) return toast('Cash of ₹2 lakh or more is not allowed (s.269ST)');
    const utr = $('#rpUtr', m)?.value.trim() || '';
    if (utr && !C.validUtr(utr)) return toast('UTR is 12 digits');
    const e = { id: uid(), customerId: c.id, at: Date.now(), amountPaise: -a, type: 'payment', mode, utr, ref: utr ? `UTR ${utr}` : '' };
    await db.put('khata', e); S.khata.push(e); m.close(); toast(`Received ${money(a)} from ${c.name}`);
    if (S.page === 'khata') renderKhata(); customerDetail(c.id);
  };
}

/* ================= items ================= */
function itemsTabs() {
  S.itemsTab ??= 'items';
  const n = S.products.filter(x => x.active !== false && x.promo && !x.promo.off).length;
  return `<div class="seg pagetabs" role="tablist">${[['items', '📦 ' + t('nav.items')], ...(isMetal() ? [['grades', '⚙ Material names']] : []), ['depts', '🗂 Departments'], ['offers', `🏷 Offers${n ? ' (' + n + ')' : ''}`]].map(([k, l]) =>
    `<button data-itab="${k}" role="tab" aria-selected="${S.itemsTab === k}" class="${S.itemsTab === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
}
function bindItemsTabs(p) { p.querySelectorAll('[data-itab]').forEach(b => b.onclick = () => { S.itemsTab = b.dataset.itab; renderItems(); }); }
function renderItems() {
  const p = $('#page-items');
  S.itemsTab ??= 'items';
  if (S.itemsTab === 'stock' || (!isMetal() && S.itemsTab === 'grades')) S.itemsTab = 'items';
  if (S.itemsTab === 'grades') return Metal.renderGrades(p);
  if (S.itemsTab === 'depts') return renderDepartments(p);
  if (S.itemsTab === 'offers') return renderOffers(p);
  const f = S.itemsFilter.toLowerCase();
  const lowOnly = f === ':low';
  const list = S.products.filter(x => x.active !== false && (lowOnly ? x.stock <= (x.lowStock || 0) : (!f || x.name.toLowerCase().includes(f) || (x.barcode || '').includes(f) || (x.hsn || '').includes(f))))
    .sort((a, b) => a.name.localeCompare(b.name));
  const low = S.products.filter(x => x.active !== false && x.stock <= (x.lowStock || 0)).length;
  p.innerHTML = `${itemsTabs()}<div class="toolbar"><input id="iq" type="search" placeholder="Search name, barcode or HSN" value="${lowOnly ? '' : esc(S.itemsFilter)}">
      <button class="btn${lowOnly ? ' pri' : ''}" id="iLow">Low stock (${low})</button>
      ${isMetal() ? '<button class="btn pri" id="iNewMat">＋ Material</button>' : ''}<button class="btn${isMetal() ? '' : ' pri'}" id="iNew">＋ ${esc(isMetal() ? 'Other item' : t('addItem'))}</button></div>
    <div class="toolbar"><button class="btn sm" id="iMiracle">⬆ Import from Miracle / Excel</button><button class="btn sm ghost" id="iImp">${lockTag('csv')}Import CSV</button><button class="btn sm ghost" id="iExp">${lockTag()}Export CSV</button><button class="btn sm ghost" id="iTpl">CSV template</button><input type="file" id="iFile" accept=".csv,text/csv" hidden></div>
    <div class="list">${list.map(x => `<button class="li" data-i="${x.id}"><div class="grow"><div class="t1">${esc(x.name)} ${x.localName ? `<span class="hint">${esc(x.localName)}</span>` : ''}</div>
      <div class="t2">${x.hsn ? 'HSN ' + esc(x.hsn) + ' · ' : ''}${x.gstRate < 0 ? '<b class="owes">GST not set</b>' : 'GST ' + x.gstRate + '%'}${x.mrpPaise ? ' · MRP ' + money(x.mrpPaise) : ''} · ${esc(x.category || '')}${x.metal ? ` · ${Metal.kgm(x).toFixed(3)} kg/m` : ''}</div>${C.promoStatus(x.promo, C.istDate(), x) === 'active' ? `<span class="offer">🏷 ${esc(C.promoLabel(x.promo))}</span>` : ''}</div>
      <div style="text-align:right"><div class="num"><b>${money(x.pricePaise)}</b>${C.LOOSE_UNITS.has(x.unit) ? '/' + unitShort(x.unit) : ''}</div><span class="tag${x.stock <= (x.lowStock || 0) ? ' low' : ''}">Stock ${Number((Number(x.stock) || 0).toFixed(3))} ${unitShort(x.unit)}</span></div></button>`).join('') || '<div class="empty">No items.</div>'}</div>`;
  bindItemsTabs(p);
  $('#iq').oninput = e => { S.itemsFilter = e.target.value; renderItems(); $('#iq').focus(); $('#iq').setSelectionRange(99, 99); };
  $('#iLow').onclick = () => { S.itemsFilter = lowOnly ? '' : ':low'; renderItems(); };
  $('#iNew').onclick = () => productModal({});
  $('#iNewMat')?.addEventListener('click', () => Metal.materialModal(null));
  $('#iMiracle').onclick = () => (can('miracle') ? Metal.importModal() : toast('Import from Miracle / Excel is not part of your plan. Ask your provider to turn it on.'));
  p.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { const pr = S.products.find(x => x.id === b.dataset.i); pr.metal ? Metal.materialModal(pr) : productModal(pr); });
  $('#iTpl').onclick = () => download('items-template.csv', C.toCsv(C.PRODUCT_CSV_HEADER, [['Toor Dal 1 kg', 'तूर दाल', '8900000000024', '0713', '5', '0', '180', '170', 'yes', 'PAC', '20', '5', 'Grocery']]));
  $('#iExp').onclick = requirePro('Item list import / export (CSV)', () => download(`items-${C.istDate()}.csv`, C.toCsv(C.PRODUCT_CSV_HEADER, S.products.filter(x => x.active !== false).map(x => [x.name, x.localName, x.barcode, x.hsn, x.gstRate, x.cessRate || 0, x.mrpPaise ? C.plain(x.mrpPaise) : '', C.plain(x.pricePaise), x.priceIncludesTax !== false ? 'yes' : 'no', x.unit, x.stock, x.lowStock, x.category]))));
  $('#iImp').onclick = requirePro('Item list import / export (CSV)', () => $('#iFile').click());
  $('#iFile').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    const rows = C.parseCsv(await file.text()); const head = rows.shift()?.map(h => h.trim().toLowerCase()) || [];
    if (!head.includes('name') || !head.includes('price')) return toast('CSV needs at least name and price columns');
    let ok = 0; const bad = [];
    for (const [i, r] of rows.entries()) {
      const obj = Object.fromEntries(head.map((h, j) => [h, r[j]]));
      const { product, errors } = C.productFromRow(obj);
      if (errors.length) { bad.push(`Row ${i + 2}: ${errors.join(', ')}`); continue; }
      const existing = product.barcode && S.products.find(x => x.barcode === product.barcode);
      const rec = { ...(existing || {}), ...product, id: existing?.id || uid(), active: true, editedAt: Date.now() };
      await db.put('products', rec); S.products = S.products.filter(x => x.id !== rec.id).concat(rec); ok++;
    }
    renderItems();
    modal('Import finished', `<p>${ok} items saved.</p>${bad.length ? `<div class="alert warn">${bad.slice(0, 30).map(esc).join('<br>')}</div>` : ''}`);
  };
}
function renderDepartments(p) {
  const reg = S.settings.regime === 'regular', list = departments();
  const count = d => S.products.filter(x => x.active !== false && sameDept(x.category, d.name)).length;
  p.innerHTML = `${itemsTabs()}<div class="toolbar"><p class="hint grow">Departments group items on the register (the tabs above the item tiles) and give new items${reg ? ' and department sales a default GST rate and HSN' : ' a home'}. Each item keeps its own GST rate.</p>
      <button class="btn pri" id="dNew">＋ New department</button></div>
    <div class="list">${list.map((d, i) => `<div class="li dept-row"><button class="grow kopen" data-d="${esc(d.id)}">${avatar(d.name, d.name)}<span class="kinfo"><span class="t1">${esc(d.name)}${d.implicit ? ' <span class="tag">from items</span>' : ''}</span>
        <span class="t2">${count(d)} item${count(d) === 1 ? '' : 's'}${reg ? ` · GST ${d.gstRate}%${d.hsn ? ' · HSN ' + esc(d.hsn) : ''}` : ''}</span></span></button>
        ${d.implicit ? '' : `<button class="btn sm ghost" data-up="${i}" aria-label="Move up"${i ? '' : ' disabled'}>↑</button>`}</div>`).join('') || '<div class="empty">No departments yet.</div>'}</div>`;
  bindItemsTabs(p);
  $('#dNew').onclick = () => departmentModal({}, () => renderItems());
  p.querySelectorAll('[data-d]').forEach(b => b.onclick = () => departmentModal(list.find(d => d.id === b.dataset.d), () => renderItems()));
  p.querySelectorAll('[data-up]').forEach(b => b.onclick = async () => {
    const saved = departments().filter(d => !d.implicit), i = Number(b.dataset.up); if (i < 1 || i >= saved.length) return;
    [saved[i - 1], saved[i]] = [saved[i], saved[i - 1]];
    S.departments = saved.map((d, k) => ({ id: d.id, name: d.name, gstRate: d.gstRate, hsn: d.hsn || '', order: k }));
    await db.kvSet('departments', S.departments); renderItems();
  });
}
function departmentModal(d, done) {
  const reg = S.settings.regime === 'regular', isNew = !d.id || d.implicit;
  const items = d.name ? S.products.filter(x => x.active !== false && sameDept(x.category, d.name)) : [];
  const m = modal(isNew && !d.name ? 'New department' : 'Department', `
    <label>Name<input id="dName" maxlength="30" value="${esc(d.name)}" placeholder="e.g. Grocery, Dairy, Snacks" autofocus></label>
    ${reg ? `<div class="grid2"><label>Default GST rate<select id="dRate">${rateOptions(d.gstRate ?? 5)}</select></label>
    <label>Default HSN (optional)<input id="dHsn" inputmode="numeric" maxlength="8" value="${esc(d.hsn)}"></label></div>
    ${items.length ? `<label class="check"><input type="checkbox" id="dApply"> Also set this GST rate${' '}and HSN on all ${items.length} item${items.length > 1 ? 's' : ''} in this department</label>
    <p class="hint">Only tick this if every item here really has the same HSN and rate — check with your CA.</p>` : ''}` : ''}
    <div id="dErr"></div>`,
    `${!isNew && !items.length ? '<button class="btn bad" id="dDel">Delete</button>' : ''}<span class="grow"></span><button class="btn pri" id="dSave">Save</button>`);
  $('#dSave', m).onclick = async () => {
    const rec = { id: isNew ? uid() : d.id, name: $('#dName', m).value.trim(), gstRate: reg ? Number($('#dRate', m).value) : (d.gstRate ?? 0), hsn: reg ? $('#dHsn', m).value.trim() : (d.hsn || ''), order: isNew ? S.departments.length : d.order };
    const errs = C.departmentErrors(rec, S.departments);
    $('#dErr', m).innerHTML = errs.map(e => `<div class="alert bad">${esc(e)}</div>`).join(''); if (errs.length) return;
    const oldName = d.name;
    S.departments = S.departments.filter(x => x.id !== rec.id).concat(rec).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const writes = [{ store: 'kv', value: { key: 'departments', value: S.departments } }];
    const apply = $('#dApply', m)?.checked;
    for (const x of S.products) {
      if (x.active === false || !oldName || !sameDept(x.category, oldName)) continue;
      const upd = { ...x, editedAt: Date.now(), category: rec.name, ...(apply ? { gstRate: rec.gstRate, ...(rec.hsn ? { hsn: rec.hsn } : {}) } : {}) };
      if (upd.category !== x.category || apply) writes.push({ store: 'products', value: upd });
    }
    await db.writeAll(writes);
    for (const w of writes.slice(1)) S.products = S.products.map(x => x.id === w.value.id ? w.value : x);
    m.close(); toast('Saved'); done?.();
  };
  $('#dDel', m)?.addEventListener('click', async () => {
    S.departments = S.departments.filter(x => x.id !== d.id); await db.kvSet('departments', S.departments); m.close(); done?.();
  });
}
function renderOffers(p) {
  const today = C.istDate();
  const withOffer = S.products.filter(x => x.active !== false && x.promo).sort((a, b) => a.name.localeCompare(b.name));
  const chip = st => ({ active: '<span class="chip">On</span>', scheduled: '<span class="chip off">Starts later</span>', expired: '<span class="tag">Ended</span>', off: '<span class="tag">Paused</span>', invalid: '<span class="tag low">Check</span>' })[st];
  p.innerHTML = `${itemsTabs()}<div class="toolbar"><p class="hint grow">Offers apply automatically at the counter and print on the bill. The saving is a discount, so GST is charged on the lower amount.</p>
      <button class="btn pri" id="oNew">＋ New offer</button></div>
    <div class="list">${withOffer.map(x => `<button class="li" data-o="${x.id}"><div class="grow"><div class="t1">${esc(x.name)}</div>
      <div class="t2">🏷 ${esc(C.promoLabel(x.promo))} · ${money(x.pricePaise)}${x.promo.from || x.promo.to ? ` · ${x.promo.from ? esc(x.promo.from) : '…'} to ${x.promo.to ? esc(x.promo.to) : '…'}` : ''}</div></div>${chip(C.promoStatus(x.promo, today, x))}</button>`).join('')
      || '<div class="empty"><div class="empty-icon">🏷</div><b>No offers yet</b><span class="hint">Example: Buy 2 get 1 free on biscuits, or ₹5 off each on oil this week.</span></div>'}</div>`;
  bindItemsTabs(p);
  p.querySelectorAll('[data-o]').forEach(b => b.onclick = () => offerModal(S.products.find(x => x.id === b.dataset.o)));
  $('#oNew').onclick = () => {
    const items = S.products.filter(x => x.active !== false).sort((a, b) => a.name.localeCompare(b.name));
    if (!items.length) return toast('Add items first');
    const m = modal('Offer on which item?', `<input id="opq" type="search" placeholder="Search item" autofocus><div class="list" id="opl" style="margin-top:10px"></div>`);
    const draw = () => { const q = $('#opq', m).value.toLowerCase(); $('#opl', m).innerHTML = items.filter(x => !q || x.name.toLowerCase().includes(q)).slice(0, 60).map(x => `<button class="li" data-op="${x.id}"><div class="grow"><div class="t1">${esc(x.name)}</div><div class="t2">${money(x.pricePaise)}${x.promo ? ' · has an offer' : ''}</div></div>›</button>`).join(''); $('#opl', m).querySelectorAll('[data-op]').forEach(b => b.onclick = () => { m.close(); offerModal(items.find(x => x.id === b.dataset.op)); }); };
    $('#opq', m).oninput = draw; draw();
  };
}
function offerModal(pr) {
  const o = pr.promo || { kind: C.LOOSE_UNITS.has(pr.unit) ? 'price_off' : 'bxgy', buyQty: 2, getQty: 1 };
  const loose = C.LOOSE_UNITS.has(pr.unit);
  const m = modal(`Offer · ${pr.name}`, `<p class="hint">Price ${money(pr.pricePaise)}${loose ? '/' + unitShort(pr.unit) : ''}${pr.mrpPaise ? ` · MRP ${money(pr.mrpPaise)}` : ''}</p>
    <label>Offer type<select id="oKind">${Object.entries(C.PROMO_KINDS).filter(([k]) => !loose || k === 'price_off').map(([k, l]) => `<option value="${k}"${o.kind === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    <div class="grid2"><label id="oBuyL">Buy (quantity)<input id="oBuy" type="number" inputmode="numeric" min="1" max="50" value="${o.buyQty ?? 2}"></label>
    <label id="oGetL">Get free<input id="oGet" type="number" inputmode="numeric" min="1" max="20" value="${o.getQty ?? 1}"></label>
    <label id="oSaveL">Save (₹)<input id="oSave" type="number" inputmode="decimal" step="0.01" min="0" value="${o.savePaise ? C.plain(o.savePaise) : ''}"></label></div>
    <div class="grid2"><label>Starts (optional)<input id="oFrom" type="date" value="${esc(o.from || '')}"></label><label>Ends (optional)<input id="oTo" type="date" value="${esc(o.to || '')}"></label></div>
    <label class="check"><input type="checkbox" id="oOff"${o.off ? ' checked' : ''}> Pause this offer</label>
    <div class="alert ok" id="oPrev"></div><div id="oErr"></div>`,
    `${pr.promo ? '<button class="btn bad" id="oDel">Remove offer</button>' : ''}<span class="grow"></span><button class="btn pri" id="oSaveBtn">Save offer</button>`);
  const read = () => {
    const kind = $('#oKind', m).value, n = id => Number($(id, m).value);
    const r = { kind, from: $('#oFrom', m).value || '', to: $('#oTo', m).value || '', off: $('#oOff', m).checked };
    if (kind !== 'price_off') r.buyQty = Math.trunc(n('#oBuy'));
    if (kind === 'bxgy') r.getQty = Math.trunc(n('#oGet'));
    if (kind !== 'bxgy') r.savePaise = C.parsePaise($('#oSave', m).value) ?? 0;
    if (!r.from) delete r.from; if (!r.to) delete r.to; if (!r.off) delete r.off;
    return r;
  };
  const show = () => {
    const k = $('#oKind', m).value;
    $('#oBuyL', m).hidden = k === 'price_off'; $('#oGetL', m).hidden = k !== 'bxgy'; $('#oSaveL', m).hidden = k === 'bxgy';
    const r = read(), errs = C.promoErrors(r, pr);
    const eg = k === 'price_off' ? (loose ? 1 : 1) : k === 'bxgy' ? r.buyQty + r.getQty : r.buyQty;
    $('#oPrev', m).hidden = !!errs.length;
    if (!errs.length) { const save = C.promoSaving(r, { qty: eg, pricePaise: pr.pricePaise, unit: pr.unit }); $('#oPrev', m).textContent = `🏷 ${C.promoLabel(r)} — customer buying ${fmtQty(eg, pr.unit)} pays ${money(Math.round(eg * pr.pricePaise) - save)} instead of ${money(Math.round(eg * pr.pricePaise))}.`; }
  };
  m.querySelectorAll('input,select').forEach(el => { el.addEventListener('input', show); el.addEventListener('change', show); }); show();
  const save = async promo => {
    const rec = { ...pr, editedAt: Date.now() }; if (promo) rec.promo = promo; else delete rec.promo;
    await db.put('products', rec); S.products = S.products.map(x => x.id === rec.id ? rec : x);
    m.close(); toast(promo ? 'Offer saved' : 'Offer removed'); if (S.page === 'items') renderItems(); else if (S.page === 'bill') renderCart();
  };
  $('#oSaveBtn', m).onclick = () => { const r = read(), errs = C.promoErrors(r, pr); $('#oErr', m).innerHTML = errs.map(e => `<div class="alert bad">${esc(e)}</div>`).join(''); if (!errs.length) save(r); };
  $('#oDel', m)?.addEventListener('click', () => save(null));
}
function productModal(pr) {
  const isNew = !pr.id, reg = S.settings.regime === 'regular';
  const m = modal(isNew ? t('addItem') : 'Edit item', `
    <label>Item name<input id="pName" maxlength="80" value="${esc(pr.name)}" autofocus></label>
    <div class="grid2"><label>Local name (Hindi/Gujarati…)<input id="pLocal" maxlength="60" value="${esc(pr.localName)}"></label>
    <label>Barcode<input id="pBar" inputmode="numeric" maxlength="30" value="${esc(pr.barcode)}"></label></div>
    <div class="grid2"><label>Sold by (unit)<select id="pUnit">${unitOptions(pr.unit || 'PCS')}</select></label>
    <label>Department<input id="pCat" list="catList" maxlength="30" value="${esc(pr.category || 'General')}"><datalist id="catList">${departments().map(d => `<option value="${esc(d.name)}">`).join('')}</datalist></label></div>
    <div class="grid2"><label>Selling price (₹ per unit)<input id="pPrice" type="number" inputmode="decimal" step="0.01" value="${pr.pricePaise != null ? C.plain(pr.pricePaise) : ''}"></label>
    <label>MRP (₹, for packed goods)<input id="pMrp" type="number" inputmode="decimal" step="0.01" value="${pr.mrpPaise ? C.plain(pr.mrpPaise) : ''}"></label></div>
    ${reg ? `<div class="grid2"><label>GST rate<select id="pRate">${rateOptions(pr.gstRate ?? 5)}</select></label>
    <label>HSN code${S.settings.turnoverAbove5Cr ? ' (6 digits)' : ' (4+ digits)'}<input id="pHsn" inputmode="numeric" maxlength="8" value="${esc(pr.hsn)}"></label></div>
    <div class="grid2"><label>Price includes GST?<select id="pInc"><option value="1"${pr.priceIncludesTax !== false ? ' selected' : ''}>Yes (normal for shops / MRP)</option><option value="0"${pr.priceIncludesTax === false ? ' selected' : ''}>No, add GST on top</option></select></label>
    <label>Compensation cess % (usually 0)<input id="pCess" type="number" inputmode="decimal" step="0.01" value="${pr.cessRate || 0}"></label></div>`
    : `<label>HSN code (optional)<input id="pHsn" inputmode="numeric" maxlength="8" value="${esc(pr.hsn)}"></label>`}
    <div class="grid2"><label>Stock in hand<input id="pStock" type="number" inputmode="decimal" step="0.001" value="${pr.stock ?? 0}"></label>
    <label>Alert when stock below<input id="pLow" type="number" inputmode="decimal" step="0.001" value="${pr.lowStock ?? 0}"></label></div>
    <p class="hint">Check HSN and GST rate with your CA — GST 2.0 slabs are 0 / 5 / 18 / 40 % (3 % gold/silver).</p><div id="pErr"></div>`,
    `${isNew ? '' : '<button class="btn bad" id="pDel">Delete</button><button class="btn" id="pOffer">🏷 ' + (pr.promo ? 'Edit offer' : 'Add offer') + '</button>'}<span class="grow"></span><button class="btn pri" id="pSave">Save</button>`);
  // A new item picks up its department's GST rate and HSN (only while those fields are still untouched).
  let touched = false; ['#pRate', '#pHsn'].forEach(id => $(id, m)?.addEventListener('input', () => { touched = true; }));
  $('#pCat', m).addEventListener('change', () => {
    if (!isNew || touched) return;
    const d = departments().find(x => sameDept(x.name, $('#pCat', m).value)); if (!d || d.implicit) return;
    if ($('#pRate', m)) $('#pRate', m).value = String(d.gstRate);
    if (d.hsn && $('#pHsn', m)) $('#pHsn', m).value = d.hsn;
  });
  $('#pOffer', m)?.addEventListener('click', () => { m.close(); offerModal(S.products.find(x => x.id === pr.id) || pr); });
  $('#pSave', m).onclick = async () => {
    const v = id => $(id, m)?.value.trim() ?? '';
    const rec = { ...pr, editedAt: Date.now(), id: pr.id || uid(), name: v('#pName'), localName: v('#pLocal'), barcode: v('#pBar'), unit: v('#pUnit'), category: v('#pCat') || 'General',
      pricePaise: C.parsePaise(v('#pPrice')), mrpPaise: v('#pMrp') ? C.parsePaise(v('#pMrp')) : null, hsn: v('#pHsn'),
      gstRate: reg ? Number(v('#pRate')) : (pr.gstRate ?? 0), priceIncludesTax: reg ? v('#pInc') === '1' : true, cessRate: reg ? Number(v('#pCess') || 0) : 0,
      stock: Number(v('#pStock') || 0), lowStock: Number(v('#pLow') || 0), active: true };
    const errs = [];
    if (!rec.name) errs.push('Enter the item name.');
    if (rec.pricePaise == null) errs.push('Enter a valid selling price.');
    if (v('#pMrp') && rec.mrpPaise == null) errs.push('MRP is not a valid amount.');
    if (rec.hsn && !C.validHsn(rec.hsn)) errs.push('HSN code must be 4, 6 or 8 digits.');
    if (reg && S.settings.turnoverAbove5Cr && rec.hsn.length < 6) errs.push('Turnover above ₹5 crore: 6-digit HSN is required.');
    if (rec.mrpPaise && rec.pricePaise != null && C.inclusiveUnitPrice(rec, S.settings.regime) > rec.mrpPaise) errs.push('Selling price (with GST) cannot be above MRP — Legal Metrology rules.');
    if (!(rec.cessRate >= 0 && rec.cessRate <= 300)) errs.push('Cess % looks wrong.');
    if (rec.barcode && S.products.some(x => x.id !== rec.id && x.active !== false && x.barcode === rec.barcode)) errs.push('Another item already has this barcode.');
    $('#pErr', m).innerHTML = errs.map(e => `<div class="alert bad">${esc(e)}</div>`).join('');
    if (errs.length) return;
    await db.put('products', rec); S.products = S.products.filter(x => x.id !== rec.id).concat(rec);
    m.close(); toast('Saved'); if (S.page === 'items') renderItems(); else if (S.page === 'bill') { renderGrid(); if (isNew && rec.barcode) addProduct(rec); }
  };
  $('#pDel', m)?.addEventListener('click', async () => {
    if (!await confirmBox('Delete item?', `Remove ${pr.name} from the item list? Past bills are not changed.`, 'Delete', true)) return;
    const rec = { ...pr, active: false, editedAt: Date.now() }; await db.put('products', rec); S.products = S.products.map(x => x.id === pr.id ? rec : x); m.close(); renderItems();
  });
}

/* ================= reports ================= */
function renderReports() {
  const today = C.istDate();
  S.range ||= { from: today, to: today };
  if (!can('reports')) S.range = { from: today, to: today };
  const { from, to } = S.range;
  const sales = S.sales.filter(s => C.inRange(s.at, from, to));
  const cns = S.creditNotes.filter(c => C.inRange(c.at, from, to));
  const sum = C.salesSummary(sales, cns);
  const kPay = S.khata.filter(k => k.type === 'payment' && C.inRange(k.at, from, to));
  const kByMode = kPay.reduce((a, k) => (a[k.mode] = (a[k.mode] || 0) - k.amountPaise, a), {});
  const udhaarGiven = S.khata.filter(k => k.type === 'sale' && C.inRange(k.at, from, to)).reduce((a, k) => a + k.amountPaise, 0);
  const cashRefunds = cns.filter(c => c.refundMode === 'Cash' && c.status !== 'cancelled').reduce((a, c) => a + c.totals.grandTotal, 0);
  const expectedCash = (sum.modes.cash || 0) + (kByMode.cash || 0) - cashRefunds;
  const reg = S.settings.regime === 'regular';
  const allByRate = new Map();
  for (const s of sales.filter(x => x.status !== 'cancelled')) for (const r of s.bill.byRate) { const e = allByRate.get(r.rate) || { rate: r.rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 }; for (const k of ['taxable', 'cgst', 'sgst', 'igst', 'cess']) e[k] += r[k]; allByRate.set(r.rate, e); }
  const items = C.itemSummary(sales).slice(0, 15);
  const p = $('#page-reports');
  p.innerHTML = `<div class="toolbar">
      <button class="btn sm${from === today && to === today ? ' pri' : ''}" data-rg="today">${esc(t('today'))}</button>
      <button class="btn sm" data-rg="month">${lockTag('reports')}This month</button><button class="btn sm" data-rg="lastmonth">${lockTag('reports')}Last month</button>
      <input type="date" id="rFrom" value="${from}"><input type="date" id="rTo" value="${to}"></div>
    <div class="stats">
      <div class="stat"><span>Net sales</span><b class="num">${money(sum.net)}</b></div>
      <div class="stat"><span>Bills</span><b>${sum.count}${sum.cancelled ? ` <small class="hint">(${sum.cancelled} cancelled)</small>` : ''}</b></div>
      ${['cash', 'upi', 'card', 'udhaar'].map(k => `<div class="stat"><span>${esc(MODE_LABEL(k))}</span><b class="num">${money(sum.modes[k] || 0)}</b></div>`).join('')}
      <div class="stat"><span>${W().Udhaar} collected</span><b class="num clear">${money(-kPay.reduce((a, k) => a + k.amountPaise, 0))}</b></div>
      <div class="stat"><span>Returns (credit notes)</span><b class="num">${money(sum.refunds)}</b></div>
    </div>
    <div class="card section"><h2>Cash in drawer</h2>
      <p class="num">Expected cash: <b>${money(expectedCash)}</b> <span class="hint">(cash sales ${money(sum.modes.cash || 0)} + ${W().udhaar} collected in cash ${money(kByMode.cash || 0)} − cash refunds ${money(cashRefunds)}; add your opening cash)</span></p>
      ${from === to ? `<div class="row"><input id="dcCount" type="number" inputmode="decimal" placeholder="Counted cash ₹" style="max-width:200px"><button class="btn pri" id="dcSave">Close day</button></div>
      ${(() => { const d = S.dayClose.find(x => x.id === from); return d ? `<p class="hint">Closed: counted ${money(d.counted)}, difference ${money(d.counted - d.expected)}</p>` : ''; })()}` : ''}
    </div>
    ${reg ? `<div class="card section"><h2>GST collected</h2><table><tr><th>Rate</th><th class="r">Taxable</th><th class="r">CGST</th><th class="r">SGST/UTGST</th><th class="r">IGST</th><th class="r">Cess</th></tr>
      ${[...allByRate.values()].sort((a, b) => a.rate - b.rate).map(r => `<tr class="num"><td>${r.rate}%</td><td class="r">${money(r.taxable)}</td><td class="r">${money(r.cgst)}</td><td class="r">${money(r.sgst)}</td><td class="r">${money(r.igst)}</td><td class="r">${money(r.cess)}</td></tr>`).join('')}
      <tr class="num"><th>Total</th><th class="r">${money(sum.taxable)}</th><th class="r">${money(sum.cgst)}</th><th class="r">${money(sum.sgst)}</th><th class="r">${money(sum.igst)}</th><th class="r">${money(sum.cess)}</th></tr></table>
      <p class="hint">Before credit notes. GSTR-1 files below net the returns.</p>
      <h3>${lockTag('gstr1')}Export for GST return (GSTR-1)</h3><p class="hint">CSV files in the GST offline tool format. Give them to your CA or import into the offline tool. Choose the full month first.</p>
      <div class="row"><button class="btn sm" data-g="b2b">B2B</button><button class="btn sm" data-g="b2cl">B2CL</button><button class="btn sm" data-g="b2cs">B2CS</button><button class="btn sm" data-g="cdnr">Credit notes (CDNR)</button><button class="btn sm" data-g="hsn_b2b">HSN (B2B)</button><button class="btn sm" data-g="hsn_b2c">HSN (B2C)</button><button class="btn sm" data-g="docs">Documents issued</button></div></div>`
      : `<div class="card section"><h2>Turnover</h2><p>Total sales ${money(sum.net)} for the period. ${S.settings.regime === 'composition' ? 'File CMP-08 quarterly and GSTR-4 yearly on this turnover.' : 'Keep an eye on the GST registration limit (₹40 lakh for goods in most states, ₹20 lakh in special category states).'}</p></div>`}
    <div class="card section"><h2>Top items</h2><table><tr><th>Item</th><th class="r">Qty</th><th class="r">Sales</th></tr>${items.map(i => `<tr><td>${esc(i.name)}</td><td class="r num">${fmtQty(i.qty, i.unit)}</td><td class="r num">${money(i.total)}</td></tr>`).join('') || '<tr><td colspan="3" class="hint">No sales.</td></tr>'}</table></div>
    <div class="card section"><div class="row"><h2 class="grow" style="margin:0">Bills</h2><button class="btn sm ghost" id="rReg">${lockTag('register')}Sales register CSV</button></div>
      <div class="list" style="margin-top:10px">${[...sales.map(d => ({ k: 'invoice', d })), ...cns.map(d => ({ k: 'cn', d }))].sort((a, b) => b.d.at - a.d.at).slice(0, 200).map(r => receiptRow(r.d, r.k)).join('') || '<div class="empty">No bills in this period.</div>'}</div></div>`;
  const setRange = (f, tt) => { S.range = { from: f, to: tt }; renderReports(); };
  p.querySelectorAll('[data-rg]').forEach(b => b.onclick = () => {
    if (b.dataset.rg !== 'today' && !can('reports')) return planModal('Monthly and custom-date reports');
    const [y, mo] = today.split('-').map(Number);
    if (b.dataset.rg === 'today') setRange(today, today);
    if (b.dataset.rg === 'month') setRange(`${y}-${String(mo).padStart(2, '0')}-01`, today);
    if (b.dataset.rg === 'lastmonth') { const ly = mo === 1 ? y - 1 : y, lm = mo === 1 ? 12 : mo - 1, last = new Date(ly, lm, 0).getDate(); setRange(`${ly}-${String(lm).padStart(2, '0')}-01`, `${ly}-${String(lm).padStart(2, '0')}-${last}`); }
  });
  $('#rFrom').onchange = $('#rTo').onchange = () => {
    const f = $('#rFrom').value, tt = $('#rTo').value;
    if (!can('reports') && (f !== today || tt !== today)) { $('#rFrom').value = from; $('#rTo').value = to; return planModal('Monthly and custom-date reports'); }
    if (f && tt && f <= tt) setRange(f, tt);
  };
  wireReceiptRows(p);
  p.querySelectorAll('[data-g]').forEach(b => b.onclick = requirePro('GSTR-1 files for your CA', () => { const g = C.gstr1(sales, cns, S.settings); download(`gstr1-${b.dataset.g}-${from}_to_${to}.csv`, g[b.dataset.g]); }));
  $('#rReg').onclick = requirePro('Sales register (CSV)', () => download(`sales-register-${from}_to_${to}.csv`, C.toCsv(
    ['Date', 'Document', 'Number', 'Status', 'Customer', 'Customer GSTIN', 'Place of supply', 'Taxable', 'CGST', 'SGST/UTGST', 'IGST', 'Cess', 'Round off', 'Total', 'Payment'],
    [...sales.map(s => [C.gstDate(s.at), s.docType, s.number, s.status, s.customer?.name || '', s.customer?.gstin || '', C.stateLabel(s.bill.placeOfSupply), C.plain(s.bill.taxable), C.plain(s.bill.cgst), C.plain(s.bill.sgst), C.plain(s.bill.igst), C.plain(s.bill.cess), C.plain(s.bill.roundOff), C.plain(s.bill.grandTotal), s.payments.map(p => `${p.mode}:${C.plain(p.amountPaise)}`).join(' ')]),
     ...cns.map(c => { const s = S.sales.find(x => x.id === c.invoiceId); return [C.gstDate(c.at), 'CREDIT NOTE', c.number, c.status, s?.customer?.name || '', s?.customer?.gstin || '', C.stateLabel(s?.bill.placeOfSupply), '-' + C.plain(c.totals.taxable), '-' + C.plain(c.totals.cgst), '-' + C.plain(c.totals.sgst), '-' + C.plain(c.totals.igst), '-' + C.plain(c.totals.cess), C.plain(-c.totals.roundOff), '-' + C.plain(c.totals.grandTotal), c.refundMode]; })])));
  $('#dcSave')?.addEventListener('click', async () => {
    const counted = C.parsePaise($('#dcCount').value); if (counted == null) return toast('Enter counted cash');
    const rec = { id: from, at: Date.now(), expected: expectedCash, counted };
    await db.put('dayClose', rec); S.dayClose = S.dayClose.filter(x => x.id !== from).concat(rec); renderReports();
    toast(counted === expectedCash ? 'Day closed — cash matches' : `Day closed — difference ${money(counted - expectedCash)}`);
  });
}

/* ================= settings ================= */
function renderSettings() {
  const p = $('#page-settings');
  p.innerHTML = `<div class="settings-wrap">${settingsForm(S.settings)}<div id="sErr"></div>
    <button class="btn pri big" id="sSave" style="width:100%;margin-bottom:16px">Save settings</button>
    ${Metal.settingsCard()}
    <div class="card section"><h2>On-screen keypad</h2>
      <label>On-screen number keypad when ringing up a sale<select id="kpMode"><option value="auto"${(S.settings.keypad || 'auto') === 'auto' ? ' selected' : ''}>On tablets and PCs (phones use their own keyboard)</option><option value="on"${S.settings.keypad === 'on' ? ' selected' : ''}>Always, on phones too</option><option value="off"${S.settings.keypad === 'off' ? ' selected' : ''}>Off</option></select></label>
      <p class="hint">In a pop-up (cut to size, payment), tapping a number box opens a small keypad you can drag by its top bar. The register's “Any size” panel has a keypad fixed in place. A real keyboard keeps working too.</p></div>
    ${Sync.card()}
    ${gatewayCard()}
    <div class="card section"><h2>Backup</h2><p class="hint">GST law requires you to keep bills and accounts for at least 6 years (72 months). Bills are never deleted in this app — export a backup every week and keep it safe (Google Drive, pen drive, email to yourself).</p>
      <div class="row"><button class="btn" id="bExp">Export backup</button><button class="btn ghost" id="bImp">Restore backup</button><input type="file" id="bFile" accept=".json,application/json" hidden></div>
      <p class="hint">Last backup: ${esc(S.settings.lastBackup ? C.displayDateTime(S.settings.lastBackup) : 'never')}</p></div>
    <div class="card section"><h2>Rules this app follows</h2><ul class="hint" style="padding-left:18px">
      <li>GST invoice fields (Rule 46), invoice series per financial year, ≤16 characters.</li>
      <li>CGST + SGST/UTGST within the state, IGST for delivery to another state.</li>
      <li>Bill of Supply with declaration for composition dealers.</li>
      <li>No selling above MRP (Legal Metrology); metric units for loose goods.</li>
      <li>FSSAI licence number printed on bills for food sellers.</li>
      <li>No cash receipt of ₹2 lakh or more (s.269ST); PAN for bills above ₹2 lakh (Rule 114B).</li>
      <li>Buyer name, address and state for B2C value ≥ ₹50,000 (Rule 46).</li>
      <li>Returns through credit notes (s.34); cancelled bills stay in the series.</li>
      <li>Customer data kept only on this device, with consent for WhatsApp (DPDP Act).</li></ul>
      <p class="hint">This app helps with compliance but is not legal or tax advice. Confirm HSN codes, GST rates and filing with your CA.</p>
      <p class="hint"><b>Independent app — not affiliated with, endorsed by or operated by the Government of India.</b></p></div></div>`;
  wireSettingsForm(p);
  wireGatewayCard(p);
  Metal.wireSettings(p); Sync.wire(p);
  $('#kpMode').onchange = async e => { S.settings.keypad = ['on', 'off'].includes(e.target.value) ? e.target.value : 'auto'; await db.kvSet('settings', S.settings); toast('Saved'); };
  $('#sSave').onclick = async () => {
    const { s, errs } = readSettingsForm(p, S.settings); s.gstChecked = true;
    $('#sErr').innerHTML = errs.map(e => `<div class="alert bad">${esc(e)}</div>`).join('');
    if (errs.length) return;
    await db.kvSet('settings', s); S.settings = s; applyChrome(); toast('Settings saved');
    await refreshClock(); $('#gwCard').outerHTML = gatewayCard(); wireGatewayCard(p);
  };
  $('#bExp').onclick = async () => { await backupNow(); renderSettings(); };
  $('#bImp').onclick = () => $('#bFile').click();
  $('#bFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (!await confirmBox('Restore backup?', 'This replaces ALL data on this device with the backup file.', 'Restore', true)) return;
    try { if (f.size > 200 * 1024 * 1024) throw new Error('file too large'); await db.importAll(JSON.parse(await f.text())); location.reload(); } catch (err) { toast('Restore failed: ' + err.message); }
  };
}

/* ================= one-tap install of the web version (Chrome "Install app": no APK, no unknown-sources prompt) ================= */
let installPrompt = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (!NATIVE && !standalone()) $('#installBtn').hidden = false; });
addEventListener('appinstalled', () => { installPrompt = null; $('#installBtn').hidden = true; toast('Installed — open it from your home screen'); });
$('#installBtn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  if (outcome === 'accepted') $('#installBtn').hidden = true;
  installPrompt = null;
});

/* ================= Android back button: close popup → cart → go to Bill → minimise ================= */
plugin('App')?.addListener('backButton', () => {
  const top = $('#modalRoot').lastElementChild;
  if (top) { if (top.guard) return top.guard().then(ok => ok && top.close()); return top.close ? top.close() : top.remove(); }
  const cart = $('#cart');
  if (cart?.classList.contains('open')) return cart.classList.remove('open');
  if (S.settings && S.page !== 'bill') return go('bill');
  plugin('App').minimizeApp();
});

/* ================= native feel: press ripple, sliding tab pill, screen transition ================= */
const RIPPLE = '.btn,.pcard,.dept-key,.li,.quick button,.kp-keys button,.seg button,.cartbar,.cust-btn';
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
document.addEventListener('pointerdown', e => {
  const el = e.target.closest(RIPPLE); if (!el || el.disabled || reduceMotion()) return;
  const r = el.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2.2, ink = document.createElement('span');
  el.classList.add('rpl'); ink.className = 'rpl-ink';
  ink.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  el.appendChild(ink); setTimeout(() => ink.remove(), 600);
}, { passive: true });
function placePills(root = document) {
  root.querySelectorAll('.seg').forEach(seg => {
    const on = seg.querySelector('button.on'); let pill = seg.querySelector('.seg-pill');
    if (!on) { pill?.remove(); return; }
    if (!pill) { pill = document.createElement('span'); pill.className = 'seg-pill'; seg.prepend(pill); pill.style.transition = 'none'; }
    const s = seg.getBoundingClientRect(), b = on.getBoundingClientRect();
    if (!b.width) return;
    pill.style.width = b.width + 'px'; pill.style.height = b.height + 'px';
    pill.style.transform = `translate(${b.left - s.left - seg.clientLeft}px,${b.top - s.top - seg.clientTop}px)`;
    requestAnimationFrame(() => { pill.style.transition = ''; });
  });
}
// Keep the pill under the chosen tab whenever a screen re-renders or the window changes size.
new MutationObserver(() => requestAnimationFrame(() => placePills())).observe(document.body, { childList: true, subtree: true });
addEventListener('resize', () => placePills());

/* ================= on-screen number keypad (movable) for ringing up a sale ================= */
// The movable keypad opens when a number field is tapped in a pop-up while ringing up a sale (cut to size, weight, payment…).
// The register's "Any size" panel has its own keypad fixed in the panel instead (see Metal.renderKeypad).
// On narrow phones the phone's own number keyboard is used, unless the shop turns the keypad on in Settings.
const padOn = () => !!S.settings && S.settings.keypad !== 'off' && (innerWidth >= 900 || S.settings.keypad === 'on');
const padWanted = el => S.page === 'bill' && padOn() && !!el.closest('#modalRoot');
const Numpad = initNumpad({ wanted: padWanted });

/* ================= start ================= */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
// Screenshot/demo routes for store images: index.html?shots#home | #bill | #keypad | #cart | #upi | #invoice | #khata | #receipts | #reports
async function shotRoute() {
  if (!new URLSearchParams(location.search).has('shots') || !S.settings) return;
  const r = location.hash.slice(1);
  if (['home', 'khata', 'receipts', 'reports', 'items', 'more', 'settings'].includes(r)) return go(r);
  if (r === 'depts') { S.billMode = 'depts'; return go('bill'); }
  if (r === 'keypad') { S.billMode = 'keypad'; S.kp = { amt: '250', qty: 1, rate: 5 }; return go('bill'); }
  if (r === 'bill' || r === 'cart' || r === 'upi') { S.billMode = 'items'; go('bill'); if (r !== 'bill') $('#cart').classList.add('open'); }
  if (r === 'upi') { openPayment(); $('.paygrid [data-mode="upi"]').click(); }
  if (r === 'invoice') showInvoice(S.sales[0], true);
}
boot().then(shotRoute).catch(err => { document.body.innerHTML = `<pre style="padding:20px">Could not start: ${esc(err.message)}</pre>`; });
