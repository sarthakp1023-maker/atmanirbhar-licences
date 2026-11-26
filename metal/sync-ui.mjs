// "Sync devices" — keeps a shop's phone, tablet and PC on the same data through the sync server.
// The rules and encryption are in sync-core.mjs (unit-tested against the real server); this file connects them to
// the app's storage and draws the Settings card.
import * as Y from './sync-core.mjs';
import { SYNC_URL } from './sync-config.mjs';

export function createSync(x) {
  const { S, $, esc, db, modal, toast, confirmBox } = x;
  const DEV_HOST = /^(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)$/.test(location.hostname);
  const baseUrl = () => (SYNC_URL || (DEV_HOST ? location.origin + '/sync' : '')).replace(/\/+$/, '');
  let st = null, engine = null, api = null, timer = null, poll = null, status = { state: 'off', text: '' }, needReload = false;

  const setStatus = (state, text = '') => { status = { state, text, at: Date.now() }; drawChip(); const el = $('#syncStatus'); if (el) el.innerHTML = statusHtml(); };
  function drawChip() {
    const c = $('#syncChip'); if (!c) return;
    c.hidden = !st; if (!st) return;
    const label = { ok: '⇅ Synced', busy: '⇅ Syncing…', wait: '⇅ Waiting to sync', offline: '⇅ Offline — will sync', error: '⚠ Sync problem', paused: '⏸ Sync paused' }[status.state] || '⇅ Sync';
    c.textContent = label; c.classList.toggle('off', ['error', 'offline', 'paused'].includes(status.state)); c.title = status.text || '';
  }
  const statusHtml = () => !st ? '' : `<p><b>${{ ok: '✓ Up to date', busy: 'Syncing…', wait: 'Changes waiting to be sent', offline: 'Offline — changes are kept and sent when the internet is back', paused: '⏸ ' + esc(status.text || 'Sync is paused'), error: '⚠ ' + esc(status.text || 'Sync problem') }[status.state] || ''}</b>${status.state === 'ok' && status.at ? ` · ${new Date(status.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : ''} · this is device ${esc(st.device)}</p>`;

  /** The shop's subscription plan, as last told by the server. Kept on this device so features work offline until it ends. */
  async function savePlan(plan) {
    if (!plan) return;
    const same = S.plan && JSON.stringify({ ...S.plan, now: 0 }) === JSON.stringify({ ...plan, now: 0 });
    S.plan = plan; await db.localSet('plan', plan);
    if (!same) await x.planChanged();
  }
  const fmtDay = sec => new Date(sec * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const planLine = () => { const p = S.plan; if (!p) return '';
    const on = Y.planActive(p), n = Y.PAID_FEATURES.filter(k => p.features[k]).length;
    return `<p class="hint">Plan from your provider: <b class="${on ? 'clear' : 'owes'}">${p.status === 'suspended' ? 'paused' : !on ? 'ended ' + esc(fmtDay(p.until)) : p.until ? 'active till ' + esc(fmtDay(p.until)) : 'active'}</b> · ${n} of ${Y.PAID_FEATURES.length} extra features included.</p>`; };

  /** Anything arriving from the server is cleaned exactly like a restored backup before it is saved. */
  function cleanIncoming(puts) {
    const fake = { app: 'india-pos', kv: [] };
    for (const p of puts) { if (p.store === 'kv') fake.kv.push({ key: p.id, value: p.value }); else (fake[p.store] ||= []).push(p.value); }
    const c = db.cleanBackup(fake), out = [];
    for (const p of puts) {
      if (p.store === 'kv') { const r = c.kv.find(k => k.key === p.id); if (r) out.push({ store: 'kv', value: r }); }
      else { const r = (c[p.store] || []).find(v => v.id === p.id); if (r) out.push({ store: p.store, value: r }); }
    }
    return out;
  }
  const adapter = {
    state: async () => ({ shopId: st.shopId, master: st.master, device: st.device, since: st.since }),
    outbox: () => db.outboxAll(),
    get: (s, id) => (s === 'kv' ? db.kvGet(id) : db.get(s, id)),
    base: id => db.localGet('base:' + id, null),
    async apply({ puts, dels, bases, since, drop }) {
      st = { ...st, since };
      await db.syncApply({ puts: cleanIncoming(puts), dels: dels.map(d => ({ store: d.store, key: d.id })), drop, local: { sync: st, ...Object.fromEntries(Object.entries(bases).map(([id, v]) => ['base:' + id, v])) } });
    },
    async sent({ drop, bases, since }) { st = { ...st, since }; await db.syncApply({ drop, local: { sync: st, ...Object.fromEntries(Object.entries(bases).map(([id, v]) => ['base:' + id, v])) } }); },
  };
  async function start() {
    const keys = await Y.deriveKeys(st.master, st.shopId);
    api = Y.client(baseUrl(), st.shopId, keys.token);
    engine = Y.createEngine({ store: adapter, api, keys, onApplied: async () => { needReload = true; }, onPlan: savePlan });
    db.setTracking(Y.isSynced, poke);
    clearInterval(poll); poll = setInterval(() => { if (document.visibilityState === 'visible') run(); }, 30000);
    drawChip();
  }
  function stop() { db.setTracking(null); clearInterval(poll); clearTimeout(timer); engine = api = null; st = null; const had = !!S.plan; S.plan = null; setStatus('off'); if (had) x.planChanged(); }
  function poke() { if (!st) return; if (status.state !== 'busy') setStatus('wait'); clearTimeout(timer); timer = setTimeout(run, 1500); }
  let fails = 0;
  async function run() {
    if (!st || !engine) return;
    if (navigator.onLine === false) return setStatus('offline');
    setStatus('busy');
    try {
      await engine.sync(); fails = 0;
      if (needReload) { needReload = false; await x.reload(); }
      setStatus((await db.outboxAll()).length ? 'wait' : 'ok');
    } catch (e) {
      if (needReload) { needReload = false; await x.reload().catch(() => {}); }
      if (e.kind === 'suspended' || e.kind === 'nosync') { await savePlan(e.plan); setStatus('paused', e.kind === 'nosync' ? 'Sync is not part of your plan. Your data stays on this device.' : 'Your subscription has ended or is paused. Billing keeps working; syncing and extra features are off until it is renewed.'); }
      else if (e.kind === 'network' || e.kind === 'busy') { setStatus('offline', e.message); clearTimeout(timer); timer = setTimeout(run, Math.min(300000, 5000 * 2 ** Math.min(fails++, 6))); }
      else { setStatus('error', e.kind === 'auth' ? 'The sync server no longer accepts this device. Sync was probably turned off for the shop.' : e.message || 'Sync failed'); if (e.kind === 'auth' || e.kind === 'tamper') clearInterval(poll); }
    }
  }
  addEventListener('online', () => run()); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(); });

  async function init() {
    const saved = await db.localGet('sync', null);
    if (!saved || typeof saved !== 'object' || !/^[0-9a-f]{32}$/.test(saved.shopId) || typeof saved.master !== 'string' || !Number.isInteger(saved.device) || !baseUrl()) return;
    st = { shopId: saved.shopId, master: saved.master, device: saved.device, since: Number.isSafeInteger(saved.since) ? saved.since : 0 };
    S.plan = Y.cleanPlan(await db.localGet('plan', null));
    try { await start(); } catch { st = null; return; }
    setTimeout(run, 800);
  }

  /* ---------------- settings card ---------------- */
  function card() {
    const url = baseUrl();
    return `<div class="card section" id="syncCard"><h2>Sync devices & subscription</h2>
      <p class="hint">Use the same shop on your phone, tablet and PC. Each device keeps working without internet and catches up when it is back. Data is encrypted on your devices before it is sent — the sync server cannot read your bills, items or customers.</p>
      ${!url ? '<div class="alert warn">Sync is not available in this version yet.</div>'
        : st ? `<div id="syncStatus">${statusHtml()}</div>${planLine()}<div class="row"><button class="btn pri" id="syAdd">＋ Add another device</button><button class="btn" id="syNow">Sync now</button><button class="btn ghost" id="syOff">Turn off…</button></div>
          <p class="hint">Bills made on this device are numbered with its own series (${esc(Y.devicePrefix(S.settings.invoicePrefix, st.device))}/…), so two devices can never issue the same bill number.</p>`
        : `<div class="row"><button class="btn pri" id="syOn">Connect with an invite code (first device)</button><button class="btn" id="syJoin">Join with a code</button></div>
          <p class="hint">First device: you need the invite code we send you. Other devices: tap “Join with a code” and type the code shown on the first device.</p>`}</div>`;
  }
  function wire(root) {
    const redraw = () => { const c = $('#syncCard'); if (c) { c.outerHTML = card(); wire(root); } };
    $('#syOn', root)?.addEventListener('click', () => turnOnModal(redraw));
    $('#syJoin', root)?.addEventListener('click', () => joinModal(redraw));
    $('#syAdd', root)?.addEventListener('click', () => addDeviceModal());
    $('#syNow', root)?.addEventListener('click', () => run());
    $('#syOff', root)?.addEventListener('click', () => offModal(redraw));
  }
  const say = (m, html) => { $('#syMsg', m).innerHTML = html; };
  function turnOnModal(done) {
    const m = modal('Connect this shop', `<p class="hint">Type the invite code you received from your provider. It connects this shop to your subscription: the features in your plan switch on, and this device's data becomes the shop's data that your other devices can share.</p>
      <label>Invite code<input id="syInv" maxlength="14" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDE-12345" autofocus></label><div id="syMsg"></div>`, '<button class="btn pri big" id="syGo">Turn on</button>');
    $('#syGo', m).onclick = async () => {
      const invite = $('#syInv', m).value.trim(); if (invite.replace(/[^0-9a-z]/gi, '').length !== 10) return say(m, '<div class="alert bad">The invite code has 10 letters and digits.</div>');
      $('#syGo', m).disabled = true; say(m, '<p class="hint">Connecting…</p>');
      try {
        const secret = Y.newShopSecret(), keys = await Y.deriveKeys(secret.master, secret.shopId);
        const r = await Y.client(baseUrl(), secret.shopId, keys.token).register(invite, keys.tokenHash);
        st = { ...secret, device: Number.isInteger(r.device) ? r.device : 1, since: 0 };
        await db.localSet('sync', st); await start(); await savePlan(Y.cleanPlan(r.plan)); await db.markAllForSync(Y.isSynced);
        say(m, '<p class="hint">Sending your data (encrypted)…</p>'); await run();
        m.close(); toast(status.state === 'ok' ? 'Sync is on ✓' : 'Sync is on — still sending'); x.afterDeviceChange(); done();
      } catch (e) { $('#syGo', m).disabled = false; say(m, `<div class="alert bad">${esc(e.message || 'Could not turn on sync.')}</div>`); }
    };
  }
  async function addDeviceModal() {
    const m = modal('Add another device', '<div id="syMsg"><p class="hint">Making a one-time code…</p></div>');
    try {
      const p = await Y.makePairing({ shopId: st.shopId, master: st.master }); await api.pairPut(p.fileId, p.blob);
      say(m, `<p>On the other phone, tablet or PC, open Atmanirbhar → <b>Settings → Sync devices → Join with a code</b> and type:</p>
        <div class="paircode num">${esc(p.code)}</div>
        <p class="hint">Works once, for the next 15 minutes. Anyone with this code can join your shop, so share it only with your own devices.</p>`);
    } catch (e) { say(m, `<div class="alert bad">${esc(e.message || 'Could not make a code.')}</div>`); }
  }
  function joinModal(done) {
    const bills = S.sales.length, items = S.products.filter(p => p.active !== false).length;
    const m = modal('Join with a code', `<p class="hint">On a device that already has sync on, open Settings → Sync devices → “Add another device”, then type the code it shows.</p>
      ${S.settings && (bills || items) ? `<div class="alert warn"><b>This device's own data will be replaced</b> by the shop's data (${bills} bill${bills === 1 ? '' : 's'} and ${items} item${items === 1 ? '' : 's'} are on this device now). Export a backup first if you need them.</div>` : ''}
      <label>Code from the other device<input id="syCode" maxlength="16" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX" autofocus></label><div id="syMsg"></div>`, '<button class="btn pri big" id="syGo">Join</button>');
    $('#syGo', m).onclick = async () => {
      $('#syGo', m).disabled = true; say(m, '<p class="hint">Checking the code…</p>');
      try {
        const rd = await Y.readPairing($('#syCode', m).value);
        let blob; try { blob = (await Y.client(baseUrl(), '', '').pairGet(rd.fileId)).blob; } catch (e) { throw e.kind === 'notfound' ? new Y.SyncError('code', 'That code is not valid any more. Make a new one on the other device (codes work once, for 15 minutes).') : e; }
        const secret = await rd.open(blob), keys = await Y.deriveKeys(secret.master, secret.shopId);
        if (S.settings && (bills || items) && !await confirmBox('Replace this device\'s data?', `The ${bills} bills and ${items} items on this device will be removed and the shop's data downloaded instead.`, 'Replace and join', true)) { $('#syGo', m).disabled = false; return say(m, ''); }
        const dev = (await Y.client(baseUrl(), secret.shopId, keys.token).addDevice()).device;
        say(m, '<p class="hint">Downloading the shop\'s data…</p>');
        db.setTracking(null); await db.clearShared(Y.isSynced);
        st = { ...secret, device: Number.isInteger(dev) ? dev : 2, since: 0 }; await db.localSet('sync', st); await db.kvSet('counters', {}); await db.kvSet('cart', { lines: [], customerId: null, placeOfSupply: null, billDiscountPaise: 0 }); await db.kvSet('held', []);
        await start(); await engine.sync(); needReload = false;
        m.close(); location.reload();
      } catch (e) { $('#syGo', m).disabled = false; say(m, `<div class="alert bad">${esc(e.message || 'Could not join.')}</div>`); }
    };
  }
  function offModal(done) {
    const m = modal('Turn off sync', `<p>Choose what to do:</p>
      <button class="li" id="syOffHere"><div class="grow"><div class="t1">Stop syncing on this device only</div><div class="t2">This device keeps its data. Your other devices carry on.</div></div>›</button>
      <button class="li" id="syOffAll" style="margin-top:8px"><div class="grow"><div class="t1 owes">Turn off for the whole shop and delete the server copy</div><div class="t2">Every device keeps its own data but they stop sharing. Cannot be undone.</div></div>›</button><div id="syMsg"></div>`);
    $('#syOffHere', m).onclick = async () => { if (!await confirmBox('Stop syncing on this device?', 'Changes made here will no longer reach your other devices.', 'Stop syncing', true)) return; stop(); await db.syncForget(); m.close(); x.afterDeviceChange(); done(); toast('Sync is off on this device'); };
    $('#syOffAll', m).onclick = async () => {
      if (!await confirmBox('Delete the shop\'s data from the sync server?', 'All devices stop syncing. Each device keeps the data it has now.', 'Delete and turn off', true)) return;
      try { await api.deleteShop(); } catch (e) { return say(m, `<div class="alert bad">${esc(e.message)}</div>`); }
      stop(); await db.syncForget(); m.close(); x.afterDeviceChange(); done(); toast('Sync turned off and server copy deleted');
    };
  }
  return { init, card, wire, run, join: () => (baseUrl() ? joinModal(() => {}) : toast('Sync is not available in this version yet.')), device: () => (st ? st.device : 1), on: () => !!st, prefix: p => Y.devicePrefix(p, st ? st.device : 1), barPrefix: () => Y.barPrefix(st ? st.device : 1) };
}
