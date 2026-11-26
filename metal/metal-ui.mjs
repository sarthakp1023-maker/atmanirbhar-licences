// Screens for the "Metal cutting" shop type: grades, materials (shape + size + grade), bar stock with offcuts,
// receiving by barcode, the cut planner at the counter, and importing items / parties from Miracle or Excel.
// The maths lives in metal-core.mjs and data-import.mjs (both unit-tested); this file only draws and saves.
import * as M from './metal-core.mjs';
import { ONLY_SHOP_TYPE } from './build-config.mjs';
import { readTable, detectColumns, itemsFromRows, partiesFromRows, FIELDS } from './data-import.mjs';

export function createMetal(x) {
  const { S, $, esc, C, db, uid, money, modal, toast, confirmBox } = x;
  const isMetal = () => S.settings?.shopType === 'metal' && (!x.can || x.can('metal'));
  const cfg = () => { const m = S.settings?.metal || {}; return { kerfMm: m.kerfMm >= 0 && m.kerfMm <= 20 ? m.kerfMm : 0, minOffcutMm: m.minOffcutMm >= 0 && m.minOffcutMm <= 5000 ? m.minOffcutMm : 100, cutChargePaise: Number.isSafeInteger(m.cutChargePaise) && m.cutChargePaise >= 0 && m.cutChargePaise <= 1e9 ? m.cutChargePaise : 0,
    cutBasis: m.cutBasis === 'kg' ? 'kg' : 'cut', cutGstRate: typeof m.cutGstRate === 'number' && C.GST_RATES.includes(m.cutGstRate) ? m.cutGstRate : 18, cutSac: C.validHsn(m.cutSac) ? String(m.cutSac) : '',
    fees: M.cleanFees(m.fees, C.GST_RATES), suppliers: M.cleanSuppliers(m.suppliers), shapes: M.cleanShapes(m.shapes) }; };
  // shapes: a material keeps the built-in shape it is calculated as (metal.shape) and, for a shop's own shape, its id (metal.kind)
  const shapes = () => cfg().shapes;
  const shapeId = mt => (typeof mt?.kind === 'string' && shapes().some(s => s.id === mt.kind && s.base === mt.shape) ? mt.kind : mt?.shape);
  const shapeLabel = mt => shapes().find(s => s.id === shapeId(mt))?.label || M.SHAPES[mt?.shape]?.label || '';
  const nameOf = (mt, gradeName) => M.materialName(mt.shape, mt.dims, gradeName, shapeLabel(mt));
  const shapeList = keepId => shapes().filter(s => !s.off || s.id === keepId);
  const grade = id => S.grades.find(g => g.id === id);
  const gradeOf = mat => grade(mat.metal?.gradeId) || { id: '', name: '', density: 7850, ratePaise: 0, hsn: '', gstRate: 18 };
  const materials = () => S.products.filter(p => p.active !== false && p.metal && Object.hasOwn(M.SHAPES, p.metal.shape));
  const barsOf = mat => S.bars.filter(b => b.materialId === mat.id && b.status === 'stock' && b.lengthMm > 0).sort((a, b) => a.lengthMm - b.lengthMm);
  const summary = mat => M.stockSummary(S.bars, mat, gradeOf(mat).density);
  const kgm = mat => M.kgPerMetre(mat.metal.shape, mat.metal.dims, gradeOf(mat).density);
  const opt = (v, label, sel) => `<option value="${esc(v)}"${String(sel) === String(v) ? ' selected' : ''}>${esc(label)}</option>`;
  const errBox = (el, errs) => { el.innerHTML = errs.map(e => `<div class="alert bad">${esc(e)}</div>`).join(''); return errs.length; };

  /** First run in metal mode: starter grades. */
  async function ensureDefaults() {
    if (!isMetal() || S.grades.length) return;
    S.grades = M.DEFAULT_GRADES.map(g => ({ id: uid(), ...g, ratePaise: 0 }));
    await db.kvSet('grades', S.grades);
  }
  /** Bars still free for a new line: stock minus what other lines in the open bill already plan to cut. */
  function availableBars(mat, exceptUid) {
    const map = new Map(barsOf(mat).map(b => [b.id, { ...b }]));
    for (const l of S.cart.lines) if (l.metal && l.productId === mat.id && l.uid !== exceptUid)
      for (const c of l.metal.cuts || []) { const b = c.barId && map.get(c.barId); if (b) { if (c.afterMm <= 0 || c.scrap) map.delete(b.id); else { b.lengthMm = c.afterMm; b.inBill = true; } } }
    return [...map.values()].sort((a, b) => a.lengthMm - b.lengthMm);
  }
  const withStock = mat => ({ ...mat, stock: summary(mat).kg });

  /* ============================== cut form (used by tiles and by the keypad) ============================== */
  /**
   * Draws the cut form into `el`. mat may be unsaved (no id) when it comes from the keypad; ensureSaved() stores it first.
   * opts: { barId, ensureSaved, onDone }
   */
  function cutForm(el, mat, { barId = null, ensureSaved = async m => m, onDone = () => {} } = {}) {
    const g = gradeOf(mat), c = cfg(), reg = S.settings.regime === 'regular';
    const avail = mat.id ? availableBars(mat) : [];
    const fulls = avail.filter(b => b.inBill || M.isFullBar(b)), offs = avail.filter(b => !b.inBill && !M.isFullBar(b));
    const fullLen = fulls.filter(M.isFullBar).reduce((a, b) => Math.max(a, b.lengthMm), 0) || (fulls[0]?.lengthMm ?? 0);
    // Choosing a material means cutting from its full bars. An offcut is used only when the cashier picks it.
    const gstKnown = C.GST_RATES.includes(Number(mat.gstRate));
    const src0 = barId && avail.some(b => b.id === barId) ? barId : fulls.length ? 'full' : avail.length ? '' : 'other';
    const barLabel = b => `${b.code} · ${M.fmtMm(b.lengthMm)}${M.isFullBar(b) ? '' : b.inBill ? ' (being cut in this bill)' : ' (offcut)'}${b.heatNo ? ' · heat ' + b.heatNo : ''}`;
    el.innerHTML = `<div class="cutform">
      <div class="cf-head"><b>${esc(mat.name)}</b><span class="hint">${kgm(mat).toFixed(3)} kg/m · ${fulls.length ? `${fulls.length} full bar${fulls.length > 1 ? 's' : ''}${fullLen ? ' of ' + esc(M.fmtMm(fullLen)) : ''}` : 'no full bar in stock'}${offs.length ? ` · ${offs.length} offcut${offs.length > 1 ? 's' : ''}` : ''}</span></div>
      <label>Customer's piece length (mm)<input id="cfPiece" type="number" inputmode="decimal" step="0.1" min="0" autofocus></label>
      <label>Number of pieces<span class="cf-qty"><input id="cfQty" type="number" inputmode="numeric" step="1" min="1" value="1"><button type="button" class="btn sm" id="cfMax">Max</button></span></label>
      <div class="cf-src"><span class="cf-lbl">Cut from</span><input type="hidden" id="cfSrc" value="${esc(src0)}">
        <div class="chips" id="cfSrcChips">${fulls.length ? `<button type="button" data-src="full">▮ Full bar${fullLen ? ' · ' + esc(M.fmtMm(fullLen)) : ''}</button>` : ''}
          ${avail.filter(b => !M.isFullBar(b) || b.id === barId).map(b => `<button type="button" data-src="${esc(b.id)}" class="${M.isFullBar(b) ? '' : 'offc'}">${M.isFullBar(b) ? '▮' : '✂'} ${esc(b.code)} · ${esc(M.fmtMm(b.lengthMm))}${b.inBill ? ' (in this bill)' : M.isFullBar(b) ? '' : ' leftover'}</button>`).join('')}
          <button type="button" data-src="other">＋ Bar not in stock</button></div></div>
      <label id="cfRawL">Length of that bar (mm)<input id="cfRaw" type="number" inputmode="decimal" step="0.1" min="0"></label>
      <div class="grid2"><label>Rate (₹ per kg${reg ? (mat.priceIncludesTax === false ? ', + GST' : ', incl. GST') : ''})<input id="cfRate" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(mat.pricePaise ? C.plain(mat.pricePaise) : '')}"></label>
        ${reg ? `<label>GST on material<select id="cfGst">${gstKnown ? '' : '<option value="" selected>Choose…</option>'}${x.rateOptions(gstKnown ? mat.gstRate : -1)}</select></label>` : '<span></span>'}</div>
      <label>Weighed weight (kg) — optional<input id="cfWt" type="number" inputmode="decimal" step="0.001" min="0" placeholder="uses calculated weight"></label>
      <div class="grid2"><label>Cutting labour (₹ per ${c.cutBasis === 'kg' ? 'kg' : 'cut'}, 0 = none)<input id="cfLab" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(c.cutChargePaise ? C.plain(c.cutChargePaise) : '0')}"></label>
        ${reg ? `<label>GST on cutting labour<select id="cfLabGst">${x.rateOptions(c.cutGstRate)}</select></label>` : '<span></span>'}</div>
      <div id="cfSum"></div>
      <button class="btn pri big" id="cfAdd" style="width:100%" disabled>Add to bill</button></div>`;
    const q = id => $(id, el); let last = null, maxNow = 0;
    const calc = () => {
      const src = q('#cfSrc').value, pieceMm = M.parseMm(q('#cfPiece').value), rate = C.parsePaise(q('#cfRate').value || '0');
      q('#cfRawL').hidden = src !== 'other';
      el.querySelectorAll('[data-src]').forEach(b => b.classList.toggle('on', b.dataset.src === src));
      const rawMm = src === 'other' ? M.parseMm(q('#cfRaw').value) : null;
      const want = Math.max(1, Math.floor(Number(q('#cfQty').value)) || 1);
      const sum = q('#cfSum'); last = null; maxNow = 0; q('#cfAdd').disabled = true;
      if (!pieceMm) { sum.innerHTML = '<p class="hint">Enter the length the customer wants. The app works out how many pieces come out of the bar and what is left over.</p>'; return; }
      // how many pieces the chosen bar can give — shown whatever number is asked for
      let plan = null, yieldLine = '';
      const yieldOf = len => { const n = M.maxPieces(len, pieceMm, c.kerfMm), cut = M.cutFromBar(len, pieceMm, n, c.kerfMm); return n ? `${M.fmtMm(len)} bar → <b>${n} piece${n > 1 ? 's' : ''}</b> of ${M.fmtMm(pieceMm)}, ${cut.leftoverMm > 0 ? M.fmtMm(cut.leftoverMm) + ' left over' : 'nothing left over'}` : `${M.fmtMm(len)} bar is too short for a ${M.fmtMm(pieceMm)} piece`; };
      if (src === 'other') {
        if (rawMm) { maxNow = M.maxPieces(rawMm, pieceMm, c.kerfMm); yieldLine = yieldOf(rawMm); const cut = M.cutFromBar(rawMm, pieceMm, want, c.kerfMm);
          plan = { cuts: cut.pieces ? [{ barId: null, code: '', beforeMm: rawMm, pieces: cut.pieces, usedMm: cut.usedMm, afterMm: cut.leftoverMm, scrap: cut.leftoverMm > 0 && cut.leftoverMm < c.minOffcutMm }] : [], pieces: cut.pieces, shortfall: Math.max(0, want - cut.pieces) }; }
      } else if (src) {
        const only = src === 'full' ? null : src, pool = src === 'full' ? fulls : avail.filter(b => b.id === only);
        maxNow = pool.reduce((a, b) => a + M.maxPieces(b.lengthMm, pieceMm, c.kerfMm), 0);
        plan = M.planCuts(avail, pieceMm, want, { kerfMm: c.kerfMm, minOffcutMm: c.minOffcutMm, onlyBarId: only, prefer: 'full' });
        const refLen = plan.cuts[0]?.beforeMm ?? pool[0]?.lengthMm; if (refLen) yieldLine = yieldOf(refLen);   // the bar that will actually be cut first
        const oneBar = refLen ? M.maxPieces(refLen, pieceMm, c.kerfMm) : 0, allBars = maxNow; if (src === 'full' && oneBar) maxNow = oneBar; plan.allBars = allBars;
        for (const k of plan.cuts) k.heat = avail.find(b => b.id === k.barId)?.heatNo || '';
      }
      const tips = src === 'full' ? M.usableOffcuts(avail, pieceMm, c.kerfMm).slice(0, 3) : [];
      const tipHtml = tips.length ? `<p class="hint cf-tips">💡 Offcut${tips.length > 1 ? 's' : ''} in stock long enough for this: ${tips.map(b => `<button type="button" class="btn sm" data-use="${esc(b.id)}">${esc(b.code)} · ${esc(M.fmtMm(b.lengthMm))}</button>`).join(' ')}</p>` : '';
      const lefts = plan?.pieces ? plan.cuts.map(k => (k.afterMm > 0 ? M.fmtMm(k.afterMm) + (k.scrap ? ' (scrap)' : '') : null)).filter(Boolean) : [];
      const head = plan?.pieces
        ? `<p class="cf-yield">✂ Cutting <b>${plan.pieces} piece${plan.pieces > 1 ? 's' : ''}</b> of ${esc(M.fmtMm(pieceMm))}${plan.cuts.length > 1 ? ` from ${plan.cuts.length} bars` : ''} → <b>${lefts.length ? esc(lefts.join(' and ')) + ' left over' : 'nothing left over'}</b>${maxNow > plan.pieces ? `<small>One bar gives up to ${maxNow} pieces — tap Max for that${src === 'full' && plan.allBars > maxNow ? `. Type more to carry on to the next bar (${plan.allBars} possible in all)` : ''}.</small>` : ''}</p>`
        : yieldLine ? `<p class="cf-yield">📏 ${yieldLine}</p>` : '';
      if (!plan || !plan.pieces) {
        sum.innerHTML = head + `<div class="alert warn">${!src ? 'Tap which piece to cut from (above), or “Bar not in stock” to type a length.' : src === 'other' && !rawMm ? 'Enter the length of the bar you are cutting.' : src === 'full' ? `No full bar is long enough for a ${esc(M.fmtMm(pieceMm))} piece.` : `This piece is too short for a ${esc(M.fmtMm(pieceMm))} piece.`}</div>` + tipHtml;
      } else {
        const calcKg = M.weightKg(mat.metal.shape, mat.metal.dims, pieceMm * plan.pieces, g.density);
        const wRaw = q('#cfWt').value.trim(), weighed = wRaw ? Number(wRaw) : null, badW = wRaw && !(weighed > 0 && weighed <= 100000);
        const weight = weighed > 0 && !badW ? Math.round(weighed * 1000) / 1000 : calcKg;
        const sawCuts = plan.cuts.reduce((a, k) => a + k.pieces - (k.afterMm <= 0 && Math.abs(k.usedMm - k.pieces * pieceMm) < 0.05 ? 1 : 0), 0);
        const labRate = C.parsePaise(q('#cfLab').value || '0'), gstRaw = reg ? q('#cfGst').value : '', gst = reg && gstRaw !== '' ? Number(gstRaw) : null, labGst = reg ? Number(q('#cfLabGst').value) : null;
        const labQty = c.cutBasis === 'kg' ? weight : sawCuts;
        const matAmt = Math.round(weight * (rate || 0)), cutAmt = Math.round(labQty * (labRate || 0));
        sum.innerHTML = head + `<div class="cutplan">${plan.cuts.map(k => `<div><span>${k.barId ? esc(k.code) : 'This bar'} · ${esc(M.fmtMm(k.beforeMm))}${k.heat ? ` · heat ${esc(k.heat)}` : ''}</span><span><b>${k.pieces} pc</b> → ${k.afterMm <= 0 ? 'nothing left' : `${esc(M.fmtMm(k.afterMm))} left ${k.scrap ? '<i class="tag low">scrap</i>' : '<i class="tag">back to stock</i>'}`}</span></div>`).join('')}</div>
          ${plan.shortfall ? `<div class="alert warn">Only ${plan.pieces} of ${plan.pieces + plan.shortfall} pieces can be cut from ${src === 'full' ? 'the full bars in stock' : 'this bar'}.</div>` : ''}${tipHtml}
          <div class="totals num" style="padding:6px 0"><div><span>${plan.pieces} × ${esc(M.fmtMm(pieceMm))}${weight !== calcKg ? ` · calculated ${calcKg.toFixed(3)} kg` : ''}</span><span>${weight.toFixed(3)} kg${weight !== calcKg ? ' weighed' : ''}</span></div>
            <div><span>Material @ ${money(rate || 0)}/kg${gst != null ? ` · GST ${gst}%` : ''}</span><span>${money(matAmt)}</span></div>
            ${cutAmt ? `<div><span>Cutting labour · ${c.cutBasis === 'kg' ? `${weight.toFixed(3)} kg` : `${sawCuts} cut${sawCuts > 1 ? 's' : ''}`} × ${money(labRate)}${reg ? ` · GST ${labGst}%` : ''}</span><span>${money(cutAmt)}</span></div>` : ''}
            <div class="grand"><span>Amount${reg && mat.priceIncludesTax === false ? ' (before GST)' : ''}</span><span>${money(matAmt + cutAmt)}</span></div></div>
          ${badW ? '<div class="alert bad">Weighed weight is not a valid number.</div>' : weight !== calcKg && Math.abs(weight - calcKg) > calcKg * 0.1 ? `<div class="alert warn">The weighed weight is ${Math.round(Math.abs(weight - calcKg) / calcKg * 100)}% ${weight > calcKg ? 'more' : 'less'} than the calculated ${calcKg.toFixed(3)} kg — check the scale, size and grade.</div>` : ''}
          ${!rate ? '<div class="alert warn">Enter the rate per kg.</div>' : ''}${reg && gst == null ? '<div class="alert warn">Choose the GST rate for this material.</div>' : ''}${labRate == null ? '<div class="alert bad">Cutting labour is not a valid amount.</div>' : ''}`;
        const ok = weight > 0 && rate > 0 && !badW && labRate != null && (!reg || (gst != null && C.GST_RATES.includes(gst) && C.GST_RATES.includes(labGst)));
        q('#cfAdd').disabled = !ok;
        if (ok) last = { plan, pieceMm, weight, calcKg, weighed: weight !== calcKg, rate, sawCuts, gst, labRate, labGst, labQty };
      }
      sum.querySelectorAll('[data-use]').forEach(b => b.onclick = () => pick(b.dataset.use));
    };
    const pick = v => { q('#cfSrc').value = v; calc(); if (v === 'other') q('#cfRaw').focus(); };
    el.querySelectorAll('[data-src]').forEach(b => b.onclick = () => pick(b.dataset.src));
    el.querySelectorAll('input,select').forEach(i => { i.addEventListener('input', calc); i.addEventListener('change', calc); }); calc();
    q('#cfMax').onclick = () => { if (maxNow > 0) { q('#cfQty').value = maxNow; calc(); } else toast('Enter the piece length first'); };
    q('#cfAdd').onclick = async () => {
      if (!last) return; q('#cfAdd').disabled = true;
      let saved; try { saved = await ensureSaved({ ...mat, pricePaise: mat.pricePaise || last.rate }); } catch (e) { q('#cfAdd').disabled = false; return toast(e.message); }
      const lineUid = uid(), c2 = cfg();
      S.cart.lines.push({ uid: lineUid, productId: saved.id, name: `${saved.name} — ${last.plan.pieces} pc × ${M.fmtMm(last.pieceMm)}`, hsn: saved.hsn || '', unit: 'KGS', qty: last.weight, pricePaise: last.rate, mrpPaise: null,
        gstRate: reg ? last.gst : saved.gstRate, cessRate: 0, priceIncludesTax: saved.priceIncludesTax !== false, discountPaise: 0,
        metal: { pieces: last.plan.pieces, pieceMm: last.pieceMm, kerfMm: c2.kerfMm, calcKg: last.calcKg, weighed: last.weighed, cuts: last.plan.cuts.map(k => ({ ...k, heat: M.cleanHeat(k.heat) })) } });
      if (last.labRate > 0 && last.labQty > 0) S.cart.lines.push({ uid: uid(), productId: null, linkedTo: lineUid, labour: true, name: 'Cutting labour', hsn: c2.cutSac || saved.hsn || '', unit: c2.cutBasis === 'kg' ? 'KGS' : 'NOS', qty: last.labQty, pricePaise: last.labRate, mrpPaise: null,
        gstRate: reg ? last.labGst : saved.gstRate, cessRate: 0, priceIncludesTax: saved.priceIncludesTax !== false, discountPaise: 0 });
      if (navigator.vibrate) navigator.vibrate(15);
      S.newLine = lineUid; x.saveCart(); onDone(); x.renderCart();
    };
  }
  function cutModal(mat, barId = null) {
    const m = modal('Cut to size', '<div id="cutBox"></div>', '', { wide: false });
    cutForm($('#cutBox', m), mat, { barId, onDone: () => m.close() });
  }
  /** A scanned or typed stock label such as B-0042 → open the cut form on that piece. */
  function cutByBarCode(code) {
    const b = S.bars.find(k => k.status === 'stock' && String(k.code).toUpperCase() === String(code).toUpperCase());
    const mat = b && materials().find(p => p.id === b.materialId);
    if (!mat) { toast(`Stock piece ${code} not found`); return false; }
    cutModal(mat, b.id); return true;
  }
  function editLine(l) {
    const m = modal(l.name, `<div class="cutplan">${(l.metal.cuts || []).map(k => `<div><span>${k.barId ? esc(k.code) : 'Typed bar'} · ${esc(M.fmtMm(k.beforeMm))}${k.heat ? ` · heat ${esc(k.heat)}` : ''}</span><span><b>${esc(Number(k.pieces) || 0)} pc</b> → ${k.afterMm <= 0 ? 'nothing left' : `${esc(M.fmtMm(k.afterMm))} left${k.scrap ? ' (scrap)' : ''}`}</span></div>`).join('')}</div>
      <p class="hint">${Number(l.qty).toFixed(3)} kg${l.metal.weighed ? ' (weighed)' : ''} @ ${money(l.pricePaise)}/kg. To change the length or pieces, remove this line and add it again.</p>`, '<button class="btn bad" id="mlDel">Remove from bill</button>');
    $('#mlDel', m).onclick = () => { S.cart.lines = S.cart.lines.filter(k => k !== l && k.linkedTo !== l.uid); m.close(); x.saveCart(); x.renderCart(); };
  }

  /** Loading fee / cartage fee on the open bill: one line each, amount and GST typed by the shopkeeper. */
  function feeModal(key) {
    const f = cfg().fees.find(k => k.key === key); if (!f) return false;
    const reg = S.settings.regime === 'regular', cur = S.cart.lines.find(l => l.charge === key);
    const m = modal(f.name, `<label>${esc(f.name)} (₹${reg ? ', before GST' : ''})<input id="feAmt" type="number" inputmode="decimal" step="0.01" min="0" autofocus value="${esc(cur ? C.plain(cur.pricePaise * cur.qty) : f.feePaise ? C.plain(f.feePaise) : '')}"></label>
      ${reg ? `<label>GST on this fee<select id="feGst">${x.rateOptions(cur && C.GST_RATES.includes(Number(cur.gstRate)) ? cur.gstRate : f.gstRate)}</select></label>` : ''}
      <p class="hint">Added as its own line on the bill. The usual amount and GST rate can be set in Settings → Type of shop.</p>`,
      `${cur ? '<button class="btn bad" id="feDel">Remove</button>' : ''}<span class="grow"></span><button class="btn pri" id="feSave">${cur ? 'Save' : 'Add to bill'}</button>`);
    const done = () => { m.close(); x.saveCart(); x.renderCart(); };
    $('#feDel', m)?.addEventListener('click', () => { S.cart.lines = S.cart.lines.filter(l => l.charge !== key); done(); });
    $('#feSave', m).onclick = () => {
      const amt = C.parsePaise($('#feAmt', m).value || ''), gst = reg ? Number($('#feGst', m).value) : 0;
      if (!(amt > 0) || amt > 1e9 || (reg && !C.GST_RATES.includes(gst))) return toast('Enter the fee amount');
      const hsn = S.cart.lines.find(l => !l.charge && C.validHsn(l.hsn))?.hsn || '';
      const line = { uid: cur?.uid || uid(), productId: null, charge: key, name: f.name, hsn: cur?.hsn || hsn, unit: 'NOS', qty: 1, pricePaise: amt, mrpPaise: null, gstRate: gst, cessRate: 0, priceIncludesTax: !reg, discountPaise: 0 };
      S.cart.lines = cur ? S.cart.lines.map(l => l === cur ? line : l) : [...S.cart.lines, line];
      S.newLine = line.uid; done();
    };
    return true;
  }
  /** Buttons for the bill panel. */
  const feeButtons = () => cfg().fees.filter(f => !S.cart.lines.some(l => l.charge === f.key)).map(f => `<button class="btn sm" data-fee="${esc(f.key)}">＋ ${esc(f.name)}</button>`).join('');   // once added, the fee is edited by tapping its line

  /** Sheet for the person at the saw: which piece to take, how many to cut, what should be left. */
  function slipHtml(lines, title = '') {
    const jobs = lines.filter(l => l.metal && Array.isArray(l.metal.cuts));
    return `<div class="invoice a4 cutslip"><h4>CUTTING SLIP</h4><div class="c">${esc(S.settings.shopName)} · ${esc(C.displayDateTime(Date.now()))}${title ? ' · ' + esc(title) : ''}</div><hr>
      ${jobs.map((l, i) => `<div class="slipjob"><div><b>${i + 1}. ${esc(String(l.name).split(' — ')[0])}</b></div>
        <div style="font-size:16px">Cut <b>${esc(Number(l.metal.pieces) || 0)}</b> piece${l.metal.pieces > 1 ? 's' : ''} of <b>${esc(M.fmtMm(l.metal.pieceMm))}</b></div>
        <table><tr><th></th><th>Take piece</th><th>Heat</th><th class="r">Length now</th><th class="r">Cut</th><th class="r">Should be left</th></tr>
        ${l.metal.cuts.map(k => `<tr><td>☐</td><td><b>${k.barId ? esc(k.code) : 'bar given'}</b></td><td>${esc(k.heat || '')}</td><td class="r">${esc(M.fmtMm(k.beforeMm))}</td><td class="r"><b>${esc(Number(k.pieces) || 0)} pc</b></td><td class="r">${k.afterMm <= 0 ? '—' : esc(M.fmtMm(k.afterMm)) + (k.scrap ? ' (scrap)' : ' → back to rack')}</td></tr>`).join('')}</table></div>`).join('<hr>')}
      <hr><div class="small">Cut by: ____________   Checked by: ____________</div></div>`;
  }
  const printSlip = (lines, title) => x.printDoc(slipHtml(lines, title), 'Cutting slip');

  /* ============================== keypad: any size, any grade ============================== */
  function renderKeypad(k, opts = {}) {
    S.mk ??= { shape: 'round', dims: [], gradeId: S.grades[0]?.id || '' };
    const st = S.mk; let list = shapeList(st.kind || st.shape); if (!list.length) list = shapes();
    { const now = list.find(s => s.id === (st.kind || st.shape)) || list.find(s => !s.off) || list[0]; if (now.id !== (st.kind || st.shape)) st.dims = []; st.kind = now.id; st.shape = now.base; }
    k.classList.add('metalpad');
    k.innerHTML = `<div class="mk-wrap"><div class="mk-form"><div class="chips" id="mkShapes">${list.map(s => `<button data-shape="${esc(s.id)}" class="${st.kind === s.id ? 'on' : ''}">${esc(M.SHAPES[s.base].sym)} ${esc(s.label)}</button>`).join('')}</div>
      <div class="mk-dims">${M.SHAPES[st.shape].dims.map((d, i) => `<label>${esc(d)} (mm)<input data-dim="${i}" type="number" inputmode="decimal" step="0.1" min="0" value="${esc(st.dims[i] ?? '')}"></label>`).join('')}</div>
      <div class="chips" id="mkGrades">${S.grades.map(g => `<button data-grade="${esc(g.id)}" class="${st.gradeId === g.id ? 'on' : ''}">${esc(g.name)}</button>`).join('') || '<span class="hint">Add material names in Items → Material names.</span>'}</div>
      <div id="mkCut"></div></div><div class="mk-pad" id="mkPad" hidden></div></div>`;
    const draw = () => {
      const box = $('#mkCut', k), dims = M.SHAPES[st.shape].dims.map((_, i) => M.parseMm(st.dims[i], 5000)), g = grade(st.gradeId);
      if (dims.some(d => d == null) || !g) { box.innerHTML = '<p class="hint" style="text-align:center">Choose the shape, type the size in mm and pick the material.</p>'; return; }
      const errs = M.sectionErrors(st.shape, dims); if (errs.length) { box.innerHTML = errs.map(e => `<div class="alert warn">${esc(e)}</div>`).join(''); return; }
      const found = materials().find(p => p.metal.shape === st.shape && shapeId(p.metal) === st.kind && p.metal.gradeId === g.id && p.metal.dims.length === dims.length && p.metal.dims.every((d, i) => Math.abs(d - dims[i]) < 0.05));
      const mat = found || newMaterial({ shape: st.shape, kind: st.kind, dims, gradeId: g.id });
      cutForm(box, mat, { ensureSaved: async m => (m.id ? m : saveMaterial({ ...m, id: uid() })), onDone: () => { draw(); } });
      if (!found) box.insertAdjacentHTML('afterbegin', '<p class="hint">New size — it will be saved to your materials when you add it to the bill.</p>');
    };
    k.querySelectorAll('[data-shape]').forEach(b => b.onclick = () => { const s = shapes().find(q => q.id === b.dataset.shape); if (!s) return; st.kind = s.id; st.shape = s.base; st.dims = []; renderKeypad(k); });
    k.querySelectorAll('[data-grade]').forEach(b => b.onclick = () => { st.gradeId = b.dataset.grade; k.querySelectorAll('[data-grade]').forEach(o => o.classList.toggle('on', o === b)); draw(); });
    k.querySelectorAll('[data-dim]').forEach(i => i.oninput = () => { st.dims[Number(i.dataset.dim)] = i.value; draw(); });
    draw();
    // a keypad fixed in the panel (tablets and PCs; phones use their own keyboard unless turned on in Settings)
    const dock = x.dockPad?.($('#mkPad', k), k);
    if (dock) { $('#mkPad', k).hidden = false; k.classList.add('has-pad'); if (opts.focus !== false) setTimeout(() => dock.focusFirst(), 60); } else k.classList.remove('has-pad');
  }

  /* ============================== materials and grades ============================== */
  const metalOf = (shape, kind, dims, gradeId) => ({ shape, dims, gradeId, ...(kind && kind !== shape ? { kind } : {}) });
  function newMaterial({ shape, kind, dims, gradeId }) {
    const g = grade(gradeId) || {}, mt = metalOf(shape, kind, dims, gradeId);
    return { id: null, name: nameOf(mt, g.name), localName: '', barcode: '', barcodes: [], unit: 'KGS', category: g.name || '', pricePaise: g.ratePaise || 0, mrpPaise: null,
      hsn: g.hsn || '', gstRate: C.GST_RATES.includes(Number(g.gstRate)) ? Number(g.gstRate) : 18, cessRate: 0, priceIncludesTax: false, stock: 0, lowStock: 0, active: true, metal: mt };
  }
  async function saveMaterial(rec) {
    rec = { ...withStock(rec), editedAt: Date.now() };
    await db.put('products', rec); S.products = S.products.filter(p => p.id !== rec.id).concat(rec); return rec;
  }
  function materialModal(pr, done) {
    const isNew = !pr?.id, cur = pr?.metal || { shape: 'round', dims: [], gradeId: S.grades[0]?.id || '' }, reg = S.settings.regime === 'regular';
    let shape = Object.hasOwn(M.SHAPES, cur.shape) ? cur.shape : 'round', kind = pr?.metal ? shapeId({ ...cur, shape }) : (shapeList()[0] || shapes()[0]).id;
    if (!pr?.metal) shape = shapes().find(s => s.id === kind).base;
    const m = modal(isNew ? 'New material' : 'Edit material', '<div id="mmBody"></div><div id="mmErr"></div>', `${isNew ? '' : '<button class="btn bad" id="mmDel">Delete</button>'}<span class="grow"></span><button class="btn pri" id="mmSave">Save</button>`);
    const body = $('#mmBody', m);
    const draw = keep => {
      const g = grade(keep?.gradeId ?? cur.gradeId) || S.grades[0] || {};
      body.innerHTML = `<div class="grid2"><label>Shape<select id="mmShape">${shapeList(kind).map(s => opt(s.id, s.label, kind)).join('')}</select></label>
        <label>Material name<select id="mmGrade">${S.grades.map(k => opt(k.id, k.name, g.id)).join('')}</select></label></div>
        <div class="mk-dims">${M.SHAPES[shape].dims.map((d, i) => `<label>${esc(d)} (mm)<input data-dim="${i}" type="number" inputmode="decimal" step="0.1" value="${esc(keep ? (keep.dims[i] ?? '') : (shape === cur.shape ? cur.dims[i] ?? '' : ''))}"></label>`).join('')}</div>
        <div class="grid2"><label>Rate (₹ per kg)<input id="mmRate" type="number" inputmode="decimal" step="0.01" value="${esc(keep?.rate ?? (pr?.pricePaise ? C.plain(pr.pricePaise) : g.ratePaise ? C.plain(g.ratePaise) : ''))}"></label>
        <label>Alert when stock below (kg)<input id="mmLow" type="number" inputmode="decimal" step="0.001" value="${esc(keep?.low ?? (Number(pr?.lowStock) || 0))}"></label></div>
        ${reg ? `<div class="grid2"><label>GST rate<select id="mmGst">${x.rateOptions(keep?.gst ?? pr?.gstRate ?? g.gstRate ?? 18)}</select></label>
        <label>HSN code<input id="mmHsn" inputmode="numeric" maxlength="8" value="${esc(keep?.hsn ?? pr?.hsn ?? g.hsn ?? '')}"></label></div>
        <label>Rate includes GST?<select id="mmInc">${opt('0', 'No — GST is added on top (usual for metal)', (keep?.inc ?? (pr ? pr.priceIncludesTax !== false : false)) ? '1' : '0')}${opt('1', 'Yes', (keep?.inc ?? (pr ? pr.priceIncludesTax !== false : false)) ? '1' : '0')}</select></label>` : `<label>HSN code (optional)<input id="mmHsn" inputmode="numeric" maxlength="8" value="${esc(keep?.hsn ?? pr?.hsn ?? '')}"></label>`}
        <label>Supplier barcode (optional — scan it when a delivery arrives)<input id="mmBar" maxlength="60" value="${esc(keep?.bar ?? pr?.barcode ?? '')}"></label>
        <p class="hint">Check the HSN code and GST rate with your CA. Weight is worked out from size × length × the material's density.</p>`;
      $('#mmShape', m).onchange = () => { const k = read(), s = shapes().find(q => q.id === $('#mmShape', m).value); if (!s) return; const same = s.base === shape; kind = s.id; shape = s.base; draw(same ? k : { ...k, dims: [] }); };
    };
    const read = () => ({ gradeId: $('#mmGrade', m).value, dims: [...m.querySelectorAll('[data-dim]')].map(i => i.value), rate: $('#mmRate', m).value, low: $('#mmLow', m).value, gst: $('#mmGst', m)?.value, hsn: $('#mmHsn', m).value.trim(), inc: $('#mmInc', m)?.value === '1', bar: $('#mmBar', m).value.trim() });
    draw();
    $('#mmSave', m).onclick = async () => {
      const k = read(), dims = k.dims.map(d => M.parseMm(d, 5000)), g = grade(k.gradeId), errs = [];
      if (!g) errs.push('Choose a material name (add them in Items → Material names).');
      if (dims.some(d => d == null)) errs.push('Enter every size in mm.'); else errs.push(...M.sectionErrors(shape, dims));
      const rate = k.rate ? C.parsePaise(k.rate) : 0; if (rate == null) errs.push('Rate is not a valid amount.');
      if (k.hsn && !C.validHsn(k.hsn)) errs.push('HSN code must be 4, 6 or 8 digits.');
      if (k.bar && S.products.some(p => p.id !== pr?.id && p.active !== false && (p.barcode === k.bar || (p.barcodes || []).includes(k.bar)))) errs.push('Another item already has this barcode.');
      if (!errs.length && materials().some(p => p.id !== pr?.id && p.metal.shape === shape && shapeId(p.metal) === kind && p.metal.gradeId === g.id && p.metal.dims.every((d, i) => Math.abs(d - dims[i]) < 0.05))) errs.push('This shape, size and material is already in your list.');
      if (errBox($('#mmErr', m), errs)) return;
      const base = isNew ? newMaterial({ shape, kind, dims, gradeId: g.id }) : pr, mt = metalOf(shape, kind, dims, g.id);
      const rec = await saveMaterial({ ...base, id: pr?.id || uid(), name: nameOf(mt, g.name), category: g.name, pricePaise: rate || 0, lowStock: Math.max(0, Number(k.low) || 0), barcode: k.bar.slice(0, 60),
        hsn: k.hsn, gstRate: S.settings.regime === 'regular' ? Number(k.gst) : (pr?.gstRate ?? 0), priceIncludesTax: S.settings.regime === 'regular' ? k.inc : true, metal: mt });
      m.close(); toast('Saved'); done ? done(rec) : x.refresh();
    };
    $('#mmDel', m)?.addEventListener('click', async () => {
      if (barsOf(pr).length) return toast('This material still has stock pieces. Use them or mark them scrap first.');
      if (!await confirmBox('Delete material?', `Remove ${pr.name}? Past bills are not changed.`, 'Delete', true)) return;
      const rec = { ...pr, active: false }; await db.put('products', rec); S.products = S.products.map(p => p.id === pr.id ? rec : p); m.close(); x.refresh();
    });
  }
  function renderGrades(p) {
    p.innerHTML = `${x.itemsTabs()}<div class="toolbar"><p class="hint grow">Each material name (grade) has a density (for weight), a usual rate per kg, and a default HSN and GST rate for new materials.</p><button class="btn pri" id="gNew">＋ New grade</button></div>
      <div class="list">${S.grades.map(g => `<button class="li" data-g="${esc(g.id)}"><div class="grow"><div class="t1">${esc(g.name)}</div><div class="t2">${esc(Number(g.density) || 0)} kg/m³ · ${g.ratePaise ? money(g.ratePaise) + '/kg' : 'no rate set'}${g.hsn ? ' · HSN ' + esc(g.hsn) : ''} · GST ${esc(Number(g.gstRate) || 0)}%</div></div><span class="tag">${materials().filter(m => m.metal.gradeId === g.id).length} sizes</span></button>`).join('') || '<div class="empty">No grades yet.</div>'}</div>`;
    x.bindItemsTabs(p);
    $('#gNew', p).onclick = () => gradeModal({});
    p.querySelectorAll('[data-g]').forEach(b => b.onclick = () => gradeModal(grade(b.dataset.g)));
  }
  function gradeModal(g) {
    const isNew = !g.id, used = isNew ? [] : materials().filter(m => m.metal.gradeId === g.id);
    const m = modal(isNew ? 'New material name' : 'Material name', `<label>Material name (grade)<input id="grName" maxlength="20" value="${esc(g.name)}" placeholder="e.g. E.N.8, M.S." autofocus></label>
      <div class="grid2"><label>Density (kg/m³)<input id="grDen" type="number" inputmode="decimal" value="${esc(Number(g.density) || 7850)}"></label>
      <label>Usual rate (₹ per kg)<input id="grRate" type="number" inputmode="decimal" step="0.01" value="${g.ratePaise ? C.plain(g.ratePaise) : ''}"></label></div>
      <div class="grid2"><label>Default GST rate<select id="grGst">${x.rateOptions(g.gstRate ?? 18)}</select></label><label>Default HSN<input id="grHsn" inputmode="numeric" maxlength="8" value="${esc(g.hsn)}"></label></div>
      ${used.length ? `<label class="check"><input type="checkbox" id="grApply"> Set this rate on all ${used.length} material${used.length > 1 ? 's' : ''} with this name</label>` : ''}
      <p class="hint">Steel is about 7850, stainless 7930–8000, aluminium 2700, brass 8500, copper 8960.</p><div id="grErr"></div>`,
      `${!isNew && !used.length ? '<button class="btn bad" id="grDel">Delete</button>' : ''}<span class="grow"></span><button class="btn pri" id="grSave">Save</button>`);
    $('#grSave', m).onclick = async () => {
      const name = $('#grName', m).value.trim(), den = Number($('#grDen', m).value), rate = $('#grRate', m).value ? C.parsePaise($('#grRate', m).value) : 0, hsn = $('#grHsn', m).value.trim(), errs = [];
      if (!name) errs.push('Enter the grade name.'); else if (S.grades.some(k => k.id !== g.id && k.name.toLowerCase() === name.toLowerCase())) errs.push('This grade already exists.');
      if (!(den >= 500 && den <= 25000)) errs.push('Density should be between 500 and 25000 kg/m³.');
      if (rate == null) errs.push('Rate is not a valid amount.'); if (hsn && !C.validHsn(hsn)) errs.push('HSN code must be 4, 6 or 8 digits.');
      if (errBox($('#grErr', m), errs)) return;
      const rec = { id: g.id || uid(), name, density: den, ratePaise: rate || 0, hsn, gstRate: Number($('#grGst', m).value) };
      S.grades = S.grades.filter(k => k.id !== rec.id).concat(rec).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const writes = [{ store: 'kv', value: { key: 'grades', value: S.grades } }];
      for (const mat of used) { const up = withStock({ ...mat, name: nameOf(mat.metal, name), category: name, ...($('#grApply', m)?.checked ? { pricePaise: rec.ratePaise } : {}) }); writes.push({ store: 'products', value: up }); }
      await db.writeAll(writes); for (const w of writes.slice(1)) S.products = S.products.map(p => p.id === w.value.id ? w.value : p);
      m.close(); toast('Saved'); x.refresh();
    };
    $('#grDel', m)?.addEventListener('click', async () => { S.grades = S.grades.filter(k => k.id !== g.id); await db.kvSet('grades', S.grades); m.close(); x.refresh(); });
  }

  /* ============================== stock: receive, list, labels ============================== */
  function labelHtml(bars) {
    return bars.map(b => { const mat = S.products.find(p => p.id === b.materialId);
      return `<div class="invoice w58 barlabel"><div class="c"><b style="font-size:20px">${esc(b.code)}</b></div><div class="qr">${x.qrSvg(b.code, { label: b.code })}</div><div class="c"><b>${esc(mat?.name || '')}</b><br>${esc(M.fmtMm(b.lengthMm))}${b.heatNo ? `<br>Heat ${esc(b.heatNo)}` : ''}</div></div>`; }).join('<hr>');
  }
  function receiveModal(startCode = '') {
    const mats = () => materials().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const sups = cfg().suppliers, supOf = () => sups.find(s => s.id === q('#rcSup').value) || null;
    const m = modal('Receive material', `<div class="grid2"><label>Supplier<select id="rcSup"><option value="">Other / not listed</option>${sups.map(s => opt(s.id, `${s.name} — ${s.barMm ? 'every piece ' + M.fmtMm(s.barMm) : 'length typed in'}`, S.lastSupplier || '')).join('')}</select></label>
      <label>Total length received (mm)<input id="rcTot" type="number" inputmode="decimal" step="0.1" min="0"></label></div>
      <label>Scan the supplier barcode (or leave empty)<input id="rcCode" maxlength="60" autocomplete="off" value="${esc(startCode)}"></label><div id="rcHint" class="hint"></div>
      <label>Material<select id="rcMat"></select></label>
      <label>Length of each piece (mm)<input id="rcLen" type="number" inputmode="decimal" step="0.1" min="0"></label><div id="rcLenHint" class="hint"></div>
      <label>Heat / batch number from the test certificate (optional)<input id="rcHeat" maxlength="24" autocomplete="off" autocapitalize="characters"></label>
      <label class="check" id="rcLearnL" hidden><input type="checkbox" id="rcLearn" checked> Remember this barcode for this material</label>
      <div id="rcSum" class="hint"></div><div id="rcErr"></div><div id="rcDone"></div>`,
      '<button class="btn ghost" id="rcNew">＋ New material</button><span class="grow"></span><button class="btn pri big" id="rcSave">Add to stock</button>');
    const q = id => $(id, m); let justAdded = [];
    const fill = sel => { q('#rcMat').innerHTML = `<option value="">Choose…</option>` + mats().map(p => opt(p.id, `${p.name} — ${summary(p).pieces} pc in stock`, sel)).join(''); };
    const lookup = () => {
      const code = q('#rcCode').value.trim(), hint = q('#rcHint'); q('#rcLearnL').hidden = true; hint.textContent = '';
      if (!code) return;
      const known = M.materialForBarcode(code, mats());
      if (known) { fill(known.id); hint.innerHTML = `✓ Known barcode: <b>${esc(known.name)}</b> (grade ${esc(gradeOf(known).name)})`; q('#rcLen').focus(); return sum(); }
      const parsed = M.parseMaterialName(code, S.grades), g = parsed?.grade || M.gradeInText(code, S.grades);
      const guess = parsed && g && mats().find(p => p.metal.shape === parsed.shape && p.metal.gradeId === g.id && p.metal.dims.every((d, i) => Math.abs(d - parsed.dims[i]) < 0.05));
      if (guess) { fill(guess.id); hint.innerHTML = `Looks like <b>${esc(guess.name)}</b> — check it is right.`; }
      else if (g) { const first = mats().find(p => p.metal.gradeId === g.id); fill(first?.id || ''); hint.innerHTML = `Grade <b>${esc(g.name)}</b> read from the barcode — choose the size.`; }
      else hint.textContent = 'New barcode — choose the material once and the app will remember it.';
      q('#rcLearnL').hidden = false; sum();
    };
    const count = () => { const tot = M.parseMm(q('#rcTot').value, 5e7), len = M.parseMm(q('#rcLen').value); return { tot, len, ...M.piecesFromTotal(tot, len) }; };
    const sum = () => { const mat = mats().find(p => p.id === q('#rcMat').value), k = count(), box = q('#rcSum');
      if (!k.tot || !k.len) { box.textContent = ''; return; }
      box.innerHTML = k.pieces ? `<b>${esc(k.tot.toLocaleString('en-IN'))} mm ÷ ${esc(M.fmtMm(k.len))} = ${k.pieces} piece${k.pieces > 1 ? 's' : ''}</b>${mat ? ` · ${M.weightKg(mat.metal.shape, mat.metal.dims, k.len * k.pieces, gradeOf(mat).density).toFixed(3)} kg of ${esc(mat.name)}` : ''}${k.extraMm > 0 ? `<div class="alert warn">${esc(M.fmtMm(k.extraMm))} does not make a full piece and will not be added. Check the total and the piece length.</div>` : ''}`
        : `<div class="alert warn">The total is shorter than one piece of ${esc(M.fmtMm(k.len))}.</div>`; };
    // a supplier with a fixed bar length fills it in; otherwise it is typed
    const supChanged = () => { const s = supOf(), len = q('#rcLen'); S.lastSupplier = s?.id || '';
      if (s?.barMm) { len.value = s.barMm; len.dataset.auto = '1'; q('#rcLenHint').textContent = `${s.name} pieces are ${M.fmtMm(s.barMm)} each. Change it here if this delivery is different.`; }
      else { if (len.dataset.auto) len.value = ''; delete len.dataset.auto; q('#rcLenHint').textContent = s ? `No fixed length is set for ${s.name} — type the length of each piece.` : ''; }
      sum(); };
    fill(''); supChanged(); if (startCode) lookup();
    q('#rcSup').addEventListener('change', supChanged); q('#rcLen').addEventListener('input', e => { if (e.isTrusted) delete e.target.dataset.auto; });
    q('#rcCode').addEventListener('change', lookup); q('#rcCode').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } });
    ['#rcMat', '#rcLen', '#rcTot'].forEach(id => { q(id).addEventListener('input', sum); q(id).addEventListener('change', sum); });
    q('#rcNew').onclick = () => materialModal(null, rec => { fill(rec.id); sum(); });
    q('#rcSave').onclick = async () => {
      const mat = mats().find(p => p.id === q('#rcMat').value), k = count(), len = k.len, n = k.pieces, sup = supOf(), code = q('#rcCode').value.trim().slice(0, 60), errs = [];
      if (!mat) errs.push('Choose the material.'); if (!k.tot) errs.push('Enter the total length received in mm.'); if (!len) errs.push('Enter the length of each piece in mm.');
      if (k.tot && len && n < 1) errs.push('The total is shorter than one piece.'); if (n > 500) errs.push('Up to 500 pieces can be added at one time.');
      if (errBox(q('#rcErr'), errs)) return;
      const now = Date.now(), fresh = [];
      for (let i = 0; i < n; i++) fresh.push({ id: uid(), code: M.nextBarCode(S.barSeq + 1 + i, x.barPrefix()), materialId: mat.id, lengthMm: len, origLengthMm: len, status: 'stock', receivedAt: now, supplierCode: code, supplier: sup?.name || '', heatNo: M.cleanHeat(q('#rcHeat').value) });
      let prod = mat;
      if (code && q('#rcLearn').checked && !q('#rcLearnL').hidden && !M.materialForBarcode(code, mats())) prod = { ...mat, barcodes: [...new Set([...(mat.barcodes || []), code])].slice(-50) };
      S.bars.push(...fresh); S.barSeq += n; prod = withStock(prod);
      try { await db.writeAll([...fresh.map(b => ({ store: 'bars', value: b })), { store: 'products', value: prod }, { store: 'kv', value: { key: 'barSeq', value: S.barSeq } }]); }
      catch (e) { S.bars = S.bars.filter(b => !fresh.includes(b)); S.barSeq -= n; return toast('Could not save: ' + e.message); }
      S.products = S.products.map(p => p.id === prod.id ? prod : p); justAdded = justAdded.concat(fresh);
      q('#rcDone').innerHTML = `<div class="alert ok">✓ Added ${n} piece${n > 1 ? 's' : ''} of ${esc(M.fmtMm(len))}${sup ? ' from ' + esc(sup.name) : ''}: ${esc(fresh[0].code)}${n > 1 ? ' – ' + esc(fresh.at(-1).code) : ''}. <button class="btn sm" id="rcPrint">Print ${justAdded.length} label${justAdded.length > 1 ? 's' : ''}</button></div>`;
      $('#rcPrint', m).onclick = () => x.printDoc(labelHtml(justAdded), 'Stock labels');
      q('#rcCode').value = ''; q('#rcHeat').value = ''; q('#rcTot').value = ''; if (!q('#rcLen').dataset.auto) q('#rcLen').value = ''; q('#rcHint').textContent = ''; q('#rcLearnL').hidden = true; fill(prod.id); sum(); q('#rcTot').focus();
      x.refresh(true);
    };
  }
  /** Inventory: full bars by material. Its "Stock" view lists the leftover pieces from earlier orders. */
  function renderInventory(p) {
    S.invTab = S.invTab === 'left' ? 'left' : 'full';
    const f = (S.stockFilter || '').toLowerCase().trim(), mats = materials().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const all = mats.flatMap(mt => barsOf(mt).map(b => ({ b, mt }))), fullsAll = all.filter(r => M.isFullBar(r.b)), leftAll = all.filter(r => !M.isFullBar(r.b));
    const kgOf = r => M.weightKg(r.mt.metal.shape, r.mt.metal.dims, r.b.lengthMm, gradeOf(r.mt).density), sumKg = rows => rows.reduce((a, r) => a + kgOf(r), 0);
    const low = mats.filter(mt => mt.lowStock > 0 && summary(mt).kg <= mt.lowStock).length;
    const hit = r => !f || r.mt.name.toLowerCase().includes(f) || r.b.code.toLowerCase().includes(f) || (r.b.heatNo || '').toLowerCase().includes(f);
    let body;
    if (S.invTab === 'full') {
      const groups = new Map();
      for (const mt of mats) { if (f && !mt.name.toLowerCase().includes(f) && !barsOf(mt).some(b => b.code.toLowerCase().includes(f) || (b.heatNo || '').toLowerCase().includes(f))) continue; const k = gradeOf(mt).name || 'Other'; (groups.get(k) || groups.set(k, []).get(k)).push(mt); }
      const gAt = n => { const i = S.grades.findIndex(g => g.name === n); return i < 0 ? 1e6 : i; };
      body = [...groups].sort((a, b) => gAt(a[0]) - gAt(b[0])).map(([shape, list]) => `<h3 class="inv-h">${esc(shape)}</h3><div class="inv-table"><div class="inv-row inv-head"><span>Material</span><span>Full bars</span><span class="r">Length</span><span class="r">Weight</span><span class="r">Leftovers</span></div>
        ${list.map(mt => { const bars = barsOf(mt), fb = bars.filter(M.isFullBar), lo = bars.length - fb.length, mm = fb.reduce((a, b) => a + b.lengthMm, 0), kg = M.weightKg(mt.metal.shape, mt.metal.dims, mm, gradeOf(mt).density), isLow = mt.lowStock > 0 && summary(mt).kg <= mt.lowStock;
          return `<div class="inv-row"><span class="inv-name"><b>${esc(mt.name)}</b>${isLow ? ' <i class="tag low">Low</i>' : ''}${!fb.length ? ' <i class="tag low">No full bar</i>' : ''}<small>${kgm(mt).toFixed(3)} kg/m · ${mt.pricePaise ? money(mt.pricePaise) + '/kg' : 'no rate'}</small></span>
            <span class="barchips">${fb.map(b => `<button data-bar="${esc(b.id)}"><b>${esc(b.code)}</b> ${esc(M.fmtMm(b.lengthMm))}${b.heatNo ? ` <small>H ${esc(b.heatNo)}</small>` : ''}</button>`).join('') || '<span class="hint">—</span>'}</span>
            <span class="r num">${fb.length ? esc(M.fmtMm(mm)) : '—'}</span><span class="r num">${fb.length ? kg.toFixed(1) + ' kg' : '—'}</span>
            <span class="r">${lo ? `<button class="btn sm" data-left="${esc(mt.name)}">${lo} piece${lo > 1 ? 's' : ''} ›</button>` : '<span class="hint">—</span>'}</span></div>`; }).join('')}</div>`).join('')
        || '<div class="empty"><div class="empty-icon">📥</div><b>No materials found</b><span class="hint">Tap “Receive material” when a delivery arrives.</span></div>';
    } else {
      const rows = leftAll.filter(hit).sort((a, b) => a.mt.name.localeCompare(b.mt.name, undefined, { numeric: true }) || b.b.lengthMm - a.b.lengthMm);
      body = `<p class="hint">Leftover pieces from earlier orders. They are not used automatically: pick one at the counter (“Cut from”), or tap a piece here and choose “Cut from this piece”.</p>
        ${rows.length ? `<div class="inv-table"><div class="inv-row left inv-head"><span>Piece</span><span>Material</span><span class="r">Length</span><span class="r">Weight</span><span>Heat</span><span class="r">From</span></div>
        ${rows.map(r => `<button class="inv-row left" data-bar="${esc(r.b.id)}"><span><b>${esc(r.b.code)}</b></span><span>${esc(r.mt.name)}</span><span class="r num"><b>${esc(M.fmtMm(r.b.lengthMm))}</b></span><span class="r num">${kgOf(r).toFixed(2)} kg</span><span>${esc(r.b.heatNo || '—')}</span><span class="r hint">${esc(M.fmtMm(r.b.origLengthMm))} bar</span></button>`).join('')}</div>`
        : '<div class="empty"><div class="empty-icon">✂</div><b>No leftover pieces</b><span class="hint">When a bar is cut for an order, what is left over appears here.</span></div>'}`;
    }
    p.innerHTML = `<div class="stats inv-stats"><div class="stat"><span>Total in store</span><b class="num">${sumKg(all).toFixed(0)} kg</b></div><div class="stat"><span>Full bars</span><b class="num">${fullsAll.length}</b></div>
        <div class="stat"><span>Leftover pieces</span><b class="num">${leftAll.length}</b><span>${sumKg(leftAll).toFixed(0)} kg</span></div><div class="stat"><span>Low materials</span><b class="num${low ? ' owes' : ''}">${low}</b></div></div>
      <div class="toolbar"><div class="seg pagetabs inv-seg" role="tablist"><button data-inv="full" class="${S.invTab === 'full' ? 'on' : ''}">📦 Inventory</button><button data-inv="left" class="${S.invTab === 'left' ? 'on' : ''}">✂ Stock · leftover pieces (${leftAll.length})</button></div>
        <span class="grow"></span><button class="btn pri" id="stRecv">📥 Receive material</button></div>
      <div class="toolbar"><input id="stQ" type="search" placeholder="Search material, piece code (B-0042) or heat number" value="${esc(S.stockFilter || '')}"></div>
      ${body}`;
    p.querySelectorAll('[data-inv]').forEach(b => b.onclick = () => { S.invTab = b.dataset.inv; renderInventory(p); });
    p.querySelectorAll('[data-left]').forEach(b => b.onclick = () => { S.invTab = 'left'; S.stockFilter = b.dataset.left; renderInventory(p); });
    $('#stQ', p).oninput = e => { S.stockFilter = e.target.value; renderInventory(p); const i = $('#stQ', p); i.focus(); i.setSelectionRange(999, 999); };
    $('#stRecv', p).onclick = () => receiveModal();
    p.querySelectorAll('[data-bar]').forEach(b => b.onclick = () => barModal(S.bars.find(k => k.id === b.dataset.bar)));
  }
  function barModal(b) {
    if (!b) return; const mat = S.products.find(p => p.id === b.materialId);
    const m = modal(`${b.code} · ${mat?.name || ''}`, `<p>${esc(M.fmtMm(b.lengthMm))}${b.lengthMm < b.origLengthMm ? ` <span class="hint">(offcut of a ${esc(M.fmtMm(b.origLengthMm))} bar)</span>` : ''} · ${mat ? M.weightKg(mat.metal.shape, mat.metal.dims, b.lengthMm, gradeOf(mat).density).toFixed(3) : '?'} kg</p>
      <p class="hint">Received ${esc(C.displayDateTime(b.receivedAt))}${b.supplier ? ' · from ' + esc(b.supplier) : ''}${b.supplierCode ? ' · supplier code ' + esc(b.supplierCode) : ''}${b.heatNo ? ' · heat ' + esc(b.heatNo) : ''}</p>
      <label>Correct the length after measuring (mm)<input id="bmLen" type="number" inputmode="decimal" step="0.1" value="${esc(Number(b.lengthMm) || 0)}"></label>`,
      '<button class="btn bad" id="bmScrap">Mark as scrap</button><button class="btn" id="bmLabel">🖨 Label</button><button class="btn" id="bmCut">✂ Cut from this piece</button><span class="grow"></span><button class="btn pri" id="bmSave">Save</button>');
    $('#bmCut', m).onclick = () => { m.close(); x.go('bill'); if (mat) cutModal(mat, b.id); };
    const save = async upd => { if (S.cart.lines.some(l => l.metal?.cuts?.some(c => c.barId === b.id))) return toast('This piece is on the open bill. Finish or clear the bill first.');
      const prod = mat && { ...mat }; S.bars = S.bars.map(k => k.id === b.id ? upd : k); const np = prod && withStock(prod);
      await db.writeAll([{ store: 'bars', value: upd }, ...(np ? [{ store: 'products', value: np }] : [])]); if (np) S.products = S.products.map(p => p.id === np.id ? np : p); m.close(); x.refresh(); };
    $('#bmLabel', m).onclick = () => x.printDoc(labelHtml([b]), 'Stock label');
    $('#bmSave', m).onclick = () => { const len = M.parseMm($('#bmLen', m).value); if (!len) return toast('Enter the length in mm'); save({ ...b, lengthMm: len, origLengthMm: Math.max(b.origLengthMm, len) }); };
    $('#bmScrap', m).onclick = async () => { if (await confirmBox('Mark as scrap?', `${b.code} (${M.fmtMm(b.lengthMm)}) will leave your stock.`, 'Scrap it', true)) save({ ...b, status: 'scrap' }); };
  }

  /* ============================== stock changes when a bill is saved / cancelled ============================== */
  /**
   * Works out the stock changes for the metal lines of a bill. Nothing is saved here: the caller writes
   * `writes` together with the sale (one transaction) and then calls commit().
   * Returns { ok:false, error } if a bar was changed since the line was added.
   */
  function applySale(lines) {
    const metalLines = lines.filter(l => l.metal && Array.isArray(l.metal.cuts));
    if (!metalLines.length) return { ok: true, writes: [], commit() {} };
    const map = new Map(S.bars.map(b => [b.id, b])), changed = new Map(), fresh = [], mats = new Set(); let seq = S.barSeq;
    for (const l of metalLines) {
      const mat = S.products.find(p => p.id === l.productId); if (!mat?.metal) return { ok: false, error: `${l.name}: material no longer exists. Remove the line and add it again.` };
      mats.add(mat.id);
      for (const c of l.metal.cuts) {
        if (c.barId) {
          const b = changed.get(c.barId) || map.get(c.barId);
          if (!b || b.status !== 'stock' || Math.abs(b.lengthMm - c.beforeMm) > 0.05) return { ok: false, error: `${l.name}: stock piece ${c.code || ''} has changed. Remove the line and add it again.` };
          changed.set(b.id, { ...b, lengthMm: c.afterMm > 0 ? c.afterMm : 0, status: c.afterMm <= 0 ? 'used' : c.scrap ? 'scrap' : 'stock', lastCutAt: Date.now() });
        } else if (c.afterMm > 0 && !c.scrap) {
          const nb = { id: uid(), code: M.nextBarCode(++seq, x.barPrefix()), materialId: mat.id, lengthMm: c.afterMm, origLengthMm: c.beforeMm, status: 'stock', receivedAt: Date.now(), supplierCode: '' };
          fresh.push(nb); c.newBarId = nb.id; c.newCode = nb.code;
        }
      }
    }
    const after = S.bars.map(b => changed.get(b.id) || b).concat(fresh);
    const prods = [...mats].map(id => { const mat = S.products.find(p => p.id === id); return { ...mat, stock: M.stockSummary(after, mat, gradeOf(mat).density).kg }; });
    return { ok: true, fresh, products: prods,
      writes: [...[...changed.values(), ...fresh].map(b => ({ store: 'bars', value: b })), ...prods.map(p => ({ store: 'products', value: p })), ...(fresh.length ? [{ store: 'kv', value: { key: 'barSeq', value: seq } }] : [])],
      commit() { S.bars = after; S.barSeq = seq; for (const p of prods) S.products = S.products.map(k => k.id === p.id ? p : k); } };
  }
  /** Cancelling a bill: put bars back to their length before the cut, but only where nothing else has touched them since. */
  function cancelSale(sale) {
    const changed = new Map(), mats = new Set(); let skipped = 0;
    for (const l of sale.bill.lines) for (const c of l.metal?.cuts || []) {
      const id = c.barId || c.newBarId, b = id && (changed.get(id) || S.bars.find(k => k.id === id));
      if (!b || Math.abs(b.lengthMm - (c.afterMm > 0 ? c.afterMm : 0)) > 0.05) { if (id) skipped++; continue; }
      mats.add(b.materialId);
      changed.set(b.id, c.barId ? { ...b, lengthMm: c.beforeMm, status: 'stock' } : { ...b, status: 'void', lengthMm: 0 });
    }
    const after = S.bars.map(b => changed.get(b.id) || b);
    const prods = [...mats].map(id => S.products.find(p => p.id === id)).filter(p => p?.metal).map(mat => ({ ...mat, stock: M.stockSummary(after, mat, gradeOf(mat).density).kg }));
    return { skipped, writes: [...[...changed.values()].map(b => ({ store: 'bars', value: b })), ...prods.map(p => ({ store: 'products', value: p }))],
      commit() { S.bars = after; for (const p of prods) S.products = S.products.map(k => k.id === p.id ? p : k); } };
  }

  /* ============================== settings card ============================== */
  function settingsCard() {
    const c = cfg(), reg = S.settings.regime === 'regular';
    return `<div class="card section" id="metalCard"><h2>Type of shop</h2>
      <label${ONLY_SHOP_TYPE && S.settings.shopType === ONLY_SHOP_TYPE ? ' hidden' : ''}>This shop is a<select id="mtType">${opt('retail', 'General / kirana / retail shop', S.settings.shopType || 'retail')}${opt('metal', 'Metal cutting — bars, pipes and plates cut to size', S.settings.shopType || 'retail')}</select></label>
      ${S.settings.shopType === 'metal' && !isMetal() ? '<div class="alert warn">Metal cutting mode is not part of your plan. Ask your provider to turn it on.</div>' : ''}${isMetal() ? `<div class="grid2"><label>Blade loss per cut (mm)<input id="mtKerf" type="number" inputmode="decimal" step="0.1" min="0" max="20" value="${c.kerfMm}"></label>
        <label>Leftover shorter than this is scrap (mm)<input id="mtMin" type="number" inputmode="decimal" step="1" min="0" value="${c.minOffcutMm}"></label></div>
        <p class="hint">Blade loss: a 2 mm blade turns a 6,000 mm bar into five 1,000 mm pieces, not six. Leave 0 if you allow for it yourself.</p>
        <h3 class="mt-h">Cutting labour</h3>
        <div class="grid2"><label>Usual labour rate (₹, 0 = none)<input id="mtCut" type="number" inputmode="decimal" step="0.01" min="0" value="${c.cutChargePaise ? C.plain(c.cutChargePaise) : 0}"></label>
          <label>Charged<select id="mtBasis">${opt('cut', 'per cut', c.cutBasis)}${opt('kg', 'per kg of material', c.cutBasis)}</select></label></div>
        ${reg ? `<div class="grid2"><label>GST on cutting labour<select id="mtCutGst">${x.rateOptions(c.cutGstRate)}</select></label>
          <label>SAC / HSN code for labour (optional)<input id="mtSac" inputmode="numeric" maxlength="8" value="${esc(c.cutSac)}" placeholder="same as the material"></label></div>` : ''}
        <p class="hint">These are starting values. The labour rate${reg ? ', its GST and the GST on the material' : ''} can be changed on every bill, in the cut screen.</p>
        <h3 class="mt-h">Fees added to the final bill</h3>
        ${c.fees.map(f => `<div class="${reg ? 'grid3' : 'grid2'} mt-fee" data-fee="${esc(f.key)}"><label>Name<input data-f="name" maxlength="24" value="${esc(f.name)}"></label>
          <label>Usual amount (₹)<input data-f="amt" type="number" inputmode="decimal" step="0.01" min="0" value="${f.feePaise ? C.plain(f.feePaise) : 0}"></label>
          ${reg ? `<label>GST<select data-f="gst">${x.rateOptions(f.gstRate)}</select></label>` : ''}</div>`).join('')}
        <p class="hint">On the bill, tap the fee's button to add it. The amount${reg ? ' and GST' : ''} can be changed there each time.</p>
        <h3 class="mt-h">Suppliers</h3>
        <div id="mtSups">${[...c.suppliers, { name: '', barMm: 0 }].map(s => `<div class="grid2 mt-sup" data-id="${esc(s.id || '')}"><label>Supplier name<input data-f="name" maxlength="30" value="${esc(s.name)}" placeholder="Add another supplier"></label>
          <label>Length of every piece (mm)<input data-f="mm" type="number" inputmode="decimal" step="0.1" min="0" value="${s.barMm || ''}" placeholder="empty = typed at delivery"></label></div>`).join('')}</div>
        <p class="hint">These names appear when you receive a delivery. With a length set, the app divides the total received by it to count the pieces. Leave the length empty if it differs each time. Clear a name to remove that supplier.</p>
        <h3 class="mt-h">Shapes</h3>
        <div id="mtShapes">${c.shapes.map(s => `<div class="grid2 mt-shape" data-id="${esc(s.id)}" data-base="${esc(s.base)}"><label>${s.id === s.base ? `Name for “${esc(M.SHAPES[s.base].label)}”` : 'Your shape'}<input data-f="label" maxlength="24" value="${esc(s.label)}"></label>
          ${s.id === s.base ? `<label>Show at the counter<select data-f="off">${opt('0', 'Yes', s.off ? '1' : '0')}${opt('1', 'No — hide it', s.off ? '1' : '0')}</select></label>` : `<label>Weight calculated like<select data-f="base">${Object.entries(M.SHAPES).map(([id, sh]) => opt(id, sh.label, s.base)).join('')}</select></label>`}</div>`).join('')}
          <div class="grid2 mt-shape" data-id="" data-base=""><label>Add your own shape<input data-f="label" maxlength="24" placeholder="for example: Bright bar"></label>
          <label>Weight calculated like<select data-f="base">${Object.entries(M.SHAPES).map(([id, sh]) => opt(id, sh.label, 'round')).join('')}</select></label></div></div>
        <p class="hint">Rename a shape, hide the ones you do not sell, or add your own. Your own shape uses the sizes and weight formula of the shape you pick. Clear the name of your own shape to remove it. Materials already saved are renamed to match; past bills are not changed.</p>
        <button class="btn pri" id="mtSave">Save metal shop settings</button>` : '<p class="hint">Choose “Metal cutting” to bill by weight, track every bar and offcut, and plan cuts at the counter.</p>'}</div>`;
  }
  function wireSettings(root) {
    $('#mtType', root).onchange = async e => {
      S.settings.shopType = e.target.value === 'metal' ? 'metal' : 'retail'; await db.kvSet('settings', S.settings); await ensureDefaults();
      $('#metalCard').outerHTML = settingsCard(); wireSettings(root); toast(isMetal() ? 'Metal cutting turned on' : 'Saved');
    };
    $('#mtSave', root)?.addEventListener('click', async () => {
      const kerf = Number($('#mtKerf', root).value), min = Number($('#mtMin', root).value), cut = C.parsePaise($('#mtCut', root).value || '0');
      if (!(kerf >= 0 && kerf <= 20) || !(min >= 0 && min <= 5000) || cut == null) return toast('Check the numbers');
      const old = cfg(), fees = {};
      for (const row of root.querySelectorAll('.mt-fee')) { const amt = C.parsePaise($('[data-f=amt]', row).value || '0'), g = $('[data-f=gst]', row); if (amt == null) return toast('Check the fee amounts');
        fees[row.dataset.fee] = { name: C.cleanText($('[data-f=name]', row).value).trim().slice(0, 24), feePaise: amt, gstRate: g ? Number(g.value) : old.fees.find(f => f.key === row.dataset.fee)?.gstRate ?? 18 }; }
      const sups = [];
      for (const row of root.querySelectorAll('.mt-sup')) { const name = C.cleanText($('[data-f=name]', row).value).trim(), raw = $('[data-f=mm]', row).value.trim(), mm = raw ? M.parseMm(raw) : 0; if (!name) continue;
        if (raw && !mm) return toast(`Check the piece length for ${name}`); sups.push({ id: row.dataset.id || uid(), name, barMm: mm || 0 }); }
      const shp = [];
      for (const row of root.querySelectorAll('.mt-shape')) { const label = C.cleanText($('[data-f=label]', row).value).trim().slice(0, 24), own = row.dataset.id !== row.dataset.base || !row.dataset.id;
        if (own) { if (label) shp.push({ id: row.dataset.id || 'c' + uid(), base: $('[data-f=base]', row).value, label }); }
        else shp.push({ id: row.dataset.id, label, off: $('[data-f=off]', row).value === '1' }); }
      if (!shp.some(s => !s.off)) return toast('Keep at least one shape showing');
      const sac = $('#mtSac', root)?.value.trim() ?? old.cutSac; if (sac && !C.validHsn(sac)) return toast('The SAC / HSN code must be 4, 6 or 8 digits');
      S.settings.metal = { kerfMm: Math.round(kerf * 10) / 10, minOffcutMm: Math.round(min), cutChargePaise: cut, cutBasis: $('#mtBasis', root).value === 'kg' ? 'kg' : 'cut', cutGstRate: $('#mtCutGst', root) ? Number($('#mtCutGst', root).value) : old.cutGstRate, cutSac: sac,
        fees: Object.fromEntries(M.cleanFees(fees, C.GST_RATES).map(f => [f.key, { name: f.name, feePaise: f.feePaise, gstRate: f.gstRate }])), suppliers: M.cleanSuppliers(sups), shapes: M.cleanShapes(shp) };
      // materials take the new shape names
      const writes = [{ store: 'kv', value: { key: 'settings', value: S.settings } }];
      for (const mat of materials()) { const nm = nameOf(mat.metal, gradeOf(mat).name); if (nm !== mat.name) writes.push({ store: 'products', value: { ...mat, name: nm, editedAt: Date.now() } }); }
      await db.writeAll(writes); for (const w of writes.slice(1)) S.products = S.products.map(p => p.id === w.value.id ? w.value : p); $('#metalCard').outerHTML = settingsCard(); wireSettings(root); toast('Saved');
    });
  }

  /* ============================== import from Miracle / Excel ============================== */
  function importModal() {
    let kind = 'items', rows = null, det = null;
    const m = modal('Import from Miracle / Excel', '<div id="imBody"></div>', '<span class="grow"></span><button class="btn pri big" id="imGo" disabled>Import</button>', { wide: true });
    const body = $('#imBody', m), go = $('#imGo', m);
    const step1 = () => {
      rows = det = null; go.disabled = true;
      body.innerHTML = `<div class="seg"><button data-kind="items" class="${kind === 'items' ? 'on' : ''}">📦 Items & prices</button><button data-kind="parties" class="${kind === 'parties' ? 'on' : ''}">👥 Customers (parties)</button></div>
        <div class="alert ok"><b>In Miracle:</b> open the ${kind === 'items' ? '<b>Item / Product list</b> (with rate, HSN and GST columns)' : '<b>Account list</b> or <b>Outstanding</b> report for Sundry Debtors'} → <b>Export → Excel</b>. If it saves an old <i>.xls</i> file, open it in Excel and choose <i>Save As → .xlsx</i> or <i>CSV</i>.</div>
        <p class="hint">Works with Excel (.xlsx) and CSV / text files from Miracle, Tally, Busy, Marg or your own sheet. The file is read on this device only — nothing is uploaded.</p>
        <input type="file" id="imFile" accept=".xlsx,.csv,.txt,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><div id="imErr"></div>`;
      body.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { kind = b.dataset.kind; step1(); });
      $('#imFile', m).onchange = async e => {
        const f = e.target.files[0]; if (!f) return;
        try { if (f.size > 15 * 1024 * 1024) throw new Error('File is too large (15 MB limit).'); rows = await readTable(await f.arrayBuffer(), f.name); }
        catch (err) { return errBox($('#imErr', m), [err.message || 'Could not read this file.']); }
        if (rows.length < 2) return errBox($('#imErr', m), ['This file has no rows to import.']);
        det = detectColumns(rows, kind);
        if (det.headerRow < 0) det = { headerRow: 0, map: {} };
        step2();
      };
    };
    const LABEL = { name: 'Name *', category: 'Group / category', unit: 'Unit', hsn: 'HSN code', gstRate: 'GST %', price: 'Sale rate', mrp: 'MRP', stock: 'Stock quantity', barcode: 'Barcode / code',
      drcr: 'Dr / Cr column (if separate)', debit: 'Debit amount (if no balance column)', credit: 'Credit amount', phone: 'Mobile', gstin: 'GSTIN', address: 'Address', city: 'City', state: 'State', pan: 'PAN', balance: 'Balance due (Dr)', group: 'Account group' };
    const build = () => kind === 'items' ? itemsFromRows(rows, det) : partiesFromRows(rows, det, { validateGstin: C.validateGstin, validatePhone: C.validatePhone, validatePan: C.validatePan });
    const step2 = () => {
      const head = rows[det.headerRow] || [], fields = Object.keys(FIELDS[kind]).filter(f => f !== 'group');
      const res = det.map.name != null ? build() : null, list = res ? (res.items || res.parties) : [];
      body.innerHTML = `<p class="hint">Check that each field points at the right column of your file (row ${det.headerRow + 1} is the heading row).</p>
        <div class="grid2">${fields.map(f => `<label>${esc(LABEL[f])}<select data-f="${f}"><option value="">— not in file —</option>${head.map((h, i) => `<option value="${i}"${det.map[f] === i ? ' selected' : ''}>${esc(h || 'Column ' + (i + 1))}</option>`).join('')}</select></label>`).join('')}</div>
        ${res ? `<h3>${list.length} ${kind === 'items' ? 'item' : 'customer'}${list.length === 1 ? '' : 's'} ready${res.skipped.length ? ` · ${res.skipped.length} skipped` : ''}</h3>
          <div style="overflow:auto;max-height:38vh"><table><tr>${kind === 'items' ? '<th>Item</th><th>Unit</th><th>HSN</th><th>GST</th><th class="r">Rate</th><th class="r">Stock</th>' : '<th>Name</th><th>Mobile</th><th>GSTIN</th><th>State</th><th class="r">Due</th>'}<th>Note</th></tr>
          ${list.slice(0, 40).map(r => kind === 'items' ? `<tr><td>${esc(r.name)}${isMetal() && M.parseMaterialName(r.name, S.grades)?.grade ? ' <span class="tag">bar material</span>' : ''}</td><td>${esc(r.unit)}</td><td>${esc(r.hsn)}</td><td>${r.gstRate == null ? '?' : esc(r.gstRate) + '%'}</td><td class="r">${money(r.pricePaise)}</td><td class="r">${esc(r.stock)}</td><td class="hint">${esc(r.notes.join('; '))}</td></tr>`
            : `<tr><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td>${esc(r.gstin)}</td><td>${esc(r.stateCode ? C.STATES[r.stateCode] || '' : '')}</td><td class="r">${r.balancePaise ? money(r.balancePaise) : ''}</td><td class="hint">${esc(r.notes.join('; '))}</td></tr>`).join('')}</table></div>
          ${list.length > 40 ? `<p class="hint">…and ${list.length - 40} more.</p>` : ''}
          ${res.skipped.length ? `<div class="alert warn">${res.skipped.slice(0, 8).map(s => esc(`Row ${s.row}: ${s.why}`)).join('<br>')}</div>` : ''}
          ${kind === 'items' ? '<p class="hint">Items with the same name as one you already have are updated (price, HSN, GST), not added twice. Items whose GST % is missing must have it set before they can be billed.</p>' : '<p class="hint">Customers with the same name or mobile are updated. A “Dr” balance is added to the customer’s credit account as an opening balance (new customers only).</p>'}`
          : '<div class="alert warn">Choose which column holds the name.</div>'}
        <button class="btn ghost sm" id="imBack">‹ Choose another file</button>`;
      go.disabled = !list.length; go.textContent = list.length ? `Import ${list.length}` : 'Import';
      body.querySelectorAll('[data-f]').forEach(s => s.onchange = () => { const f = s.dataset.f; if (s.value === '') delete det.map[f]; else det.map[f] = Number(s.value); step2(); });
      $('#imBack', m).onclick = step1;
    };
    go.onclick = async () => {
      go.disabled = true; const res = build(), writes = []; let added = 0, updated = 0, asMetal = 0;
      if (kind === 'items') {
        const reg = S.settings.regime === 'regular', byName = new Map(S.products.filter(p => p.active !== false).map(p => [p.name.toLowerCase(), p]));
        for (const r of res.items) {
          const parsed = isMetal() ? M.parseMaterialName(r.name, S.grades) : null;
          if (parsed?.grade) {
            const name = nameOf({ shape: parsed.shape, dims: parsed.dims }, parsed.grade.name);
            const old = materials().find(p => p.metal.shape === parsed.shape && p.metal.gradeId === parsed.grade.id && p.metal.dims.every((d, i) => Math.abs(d - parsed.dims[i]) < 0.05)) || byName.get(name.toLowerCase());
            const base = old || newMaterial({ shape: parsed.shape, dims: parsed.dims, gradeId: parsed.grade.id });
            const rec = { ...base, id: old?.id || uid(), name, pricePaise: r.unit === 'KGS' && r.pricePaise ? r.pricePaise : base.pricePaise, hsn: r.hsn || base.hsn, gstRate: reg ? (r.gstRate ?? base.gstRate) : (base.gstRate ?? 0), importedName: r.name, editedAt: Date.now() };
            writes.push({ store: 'products', value: rec }); byName.set(name.toLowerCase(), rec); old ? updated++ : added++; asMetal++; continue;
          }
          const old = byName.get(r.name.toLowerCase()) || (r.barcode && S.products.find(p => p.active !== false && p.barcode === r.barcode));
          const rec = { ...(old || { id: uid(), localName: '', cessRate: 0, lowStock: 0, active: true, priceIncludesTax: !isMetal() }), name: r.name, category: r.category, unit: r.unit, pricePaise: r.pricePaise, mrpPaise: r.mrpPaise,
            hsn: r.hsn || old?.hsn || '', gstRate: reg ? (r.gstRate ?? old?.gstRate ?? -1) : (old?.gstRate ?? 0), barcode: r.barcode || old?.barcode || '', stock: old ? old.stock : r.stock, editedAt: Date.now() };
          writes.push({ store: 'products', value: rec }); byName.set(r.name.toLowerCase(), rec); old ? updated++ : added++;
        }
      } else {
        const now = Date.now();
        for (const r of res.parties) {
          const old = S.customers.find(c => c.name.toLowerCase() === r.name.toLowerCase() || (r.phone && c.phone === r.phone));
          const rec = { ...(old || { id: uid(), createdAt: now, waConsent: false, creditLimitPaise: null }), name: r.name, phone: r.phone || old?.phone || '', gstin: r.gstin || old?.gstin || '', address: r.address || old?.address || '', stateCode: r.stateCode || old?.stateCode || '', pan: r.pan || old?.pan || '' };
          writes.push({ store: 'customers', value: rec });
          if (!old && r.balancePaise) writes.push({ store: 'khata', value: { id: uid(), customerId: rec.id, at: now, amountPaise: r.balancePaise, type: 'opening', ref: 'Opening balance (imported)' } });
          old ? updated++ : added++;
        }
      }
      try { for (let i = 0; i < writes.length; i += 400) await db.writeAll(writes.slice(i, i + 400)); } catch (e) { go.disabled = false; return toast('Import failed: ' + e.message); }
      for (const w of writes) {
        if (w.store === 'products') S.products = S.products.filter(p => p.id !== w.value.id).concat(w.value);
        else if (w.store === 'customers') S.customers = S.customers.filter(c => c.id !== w.value.id).concat(w.value);
        else if (w.store === 'khata') S.khata.push(w.value);
      }
      body.innerHTML = `<div class="done-hero"><div class="done-tick">✓</div><b>${added + updated}</b><span>${added} added · ${updated} updated</span>
        ${asMetal ? `<small>${asMetal} recognised as bar materials. Their stock was not imported: receive each bar with its real length in Items → Stock.</small>` : ''}
        ${res.skipped.length ? `<small>${res.skipped.length} row${res.skipped.length > 1 ? 's' : ''} skipped</small>` : ''}</div>`;
      go.hidden = true; x.refresh(true);
    };
    step1();
  }

  /** Sample materials for a new metal shop (setup screen). */
  async function addSamples() {
    await ensureDefaults();
    const g = n => S.grades.find(k => k.name === n)?.id;
    for (const [shape, dims, gr, rate] of [['round', [25], 'M.S.', 6200], ['round', [50], 'M.S.', 6200], ['square', [25], 'M.S.', 6200], ['flat', [50, 10], 'M.S.', 6200], ['round', [25], 'E.N.8', 7200], ['round', [40], 'E.N.8', 7200], ['hex', [24], 'E.N.8', 7200], ['round', [32], 'E.N.19 ROLLED', 9800], ['round', [63], 'E.N.19 FORGED', 10900], ['round', [40], 'E.N.24 ROLLED', 12500], ['round', [80], 'E.N.24 FORGED', 13800], ['round', [50], 'E.N.41.B', 16500]])
      if (g(gr)) await saveMaterial({ ...newMaterial({ shape, dims, gradeId: g(gr) }), id: uid(), pricePaise: rate });
  }

  return { isMetal, printSlip, ensureDefaults, summary, kgm, gradeOf, cutModal, cutByBarCode, editLine, feeModal, feeButtons, renderKeypad, materialModal, renderGrades, renderInventory, receiveModal, applySale, cancelSale, settingsCard, wireSettings, importModal, addSamples, fmtMm: M.fmtMm, BAR_CODE_RE: M.BAR_CODE_RE, materialForBarcode: code => M.materialForBarcode(code, materials()) };
}
