// On-screen number keypads.
//   initNumpad({ wanted })      one small keypad that FLOATS over the page and can be dragged; it opens when a wanted
//                               number field is tapped (pop-ups while ringing up a sale).
//   dockNumpad(box, scope, on)  a keypad FIXED inside a panel (the register's "Any size" panel); it types into whichever
//                               number field of that panel was tapped last.
// A physical keyboard keeps working in both. On touch screens the device's own keyboard is held back while a keypad is in use.
const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'];
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const modeOf = el => el.dataset.npMode ?? el.inputMode ?? '';
export const isNumField = el => el instanceof HTMLInputElement && !el.readOnly && !el.disabled && (el.type === 'number' || ['numeric', 'decimal'].includes(modeOf(el)));
const decimals = el => { if (modeOf(el) === 'numeric' || el.step === '1') return 0; const d = (el.step || '').split('.')[1]; return d ? Math.min(d.length, 3) : 2; };
const fieldName = el => (el.closest('label')?.childNodes[0]?.textContent || el.getAttribute('aria-label') || el.placeholder || '').trim().slice(0, 34);
const keysHtml = () => `<div class="np-keys">${KEYS.map(k => `<button type="button" data-np="${k}">${k}</button>`).join('')}</div>
  <div class="np-row"><button type="button" data-np="clear">Clear</button><button type="button" data-np="next" class="np-next">Next ›</button></div>`;

/** The typing logic shared by both keypads. onChange(target, buffer) redraws the display. */
function typist({ fields, onChange, onNone = () => {} }) {
  let target = null, buf = '';
  const hold = el => { if (coarse() && el.dataset.npMode === undefined) { el.dataset.npMode = el.inputMode || ''; el.inputMode = 'none'; } };
  const free = el => { if (el && el.dataset.npMode !== undefined) { el.inputMode = el.dataset.npMode; delete el.dataset.npMode; } };
  function attach(el) {
    if (target === el) return;
    target?.classList.remove('np-target'); free(target);
    target = el; buf = el ? el.value || '' : '';
    if (el) { el.classList.add('np-target'); hold(el); }
    onChange(target, buf);
  }
  function write() {
    // a number field refuses "12." while typing, so the dot waits in the keypad until the next digit
    const v = buf.endsWith('.') ? buf.slice(0, -1) : buf;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(target, v);
    target.dispatchEvent(new Event('input', { bubbles: true })); target.dispatchEvent(new Event('change', { bubbles: true }));
    onChange(target, buf);
  }
  function press(k) {
    if (target && (!target.isConnected || target.offsetParent === null)) attach(null);
    if (!target) { const first = fields().find(f => !f.value) || fields()[0]; if (!first) return onNone(); first.focus(); attach(first); if (k === 'next') return; }
    const dec = decimals(target);
    if (k === 'clear') buf = '';
    else if (k === '⌫') buf = buf.slice(0, -1);
    else if (k === '.') { if (!dec || buf.includes('.')) return; buf = (buf || '0') + '.'; }
    else if (k === 'next') { const all = fields(), nx = all[all.indexOf(target) + 1] || all[0]; if (nx && nx !== target) { nx.focus(); attach(nx); } return; }
    else if (/^\d$/.test(k)) {
      const frac = buf.split('.')[1];
      if ((frac !== undefined && frac.length >= dec) || buf.replace('.', '').length >= 9) return;
      buf = (buf === '0' ? '' : buf) + k;
    } else return;
    write();
  }
  const typed = el => { if (el === target) { buf = target.value || ''; onChange(target, buf); } };   // changed on a real keyboard
  return { attach, press, typed, get target() { return target; } };
}
const buzz = () => { if (navigator.vibrate) try { navigator.vibrate(8); } catch {} };

/* ---------------- floating, movable keypad ---------------- */
export function initNumpad({ wanted }) {
  let pos = null, drag = null;
  const pad = document.createElement('div');
  pad.className = 'numpad'; pad.hidden = true; pad.setAttribute('role', 'group'); pad.setAttribute('aria-label', 'Number keypad');
  pad.innerHTML = `<div class="np-head" data-np="drag"><span class="np-grip">⠿</span><span class="np-label"></span><button type="button" data-np="close" aria-label="Close keypad">×</button></div><div class="np-disp"></div>${keysHtml()}`;
  document.body.appendChild(pad);
  const label = pad.querySelector('.np-label'), disp = pad.querySelector('.np-disp');
  const ok = el => isNumField(el) && wanted(el);
  const T = typist({ fields: () => [...document.querySelectorAll('input')].filter(el => ok(el) && el.offsetParent !== null), onChange: (el, buf) => { label.textContent = el ? fieldName(el) || 'Number' : ''; disp.textContent = buf || '0'; } });

  function place() {
    const w = pad.offsetWidth || 232, h = pad.offsetHeight || 340;
    pos = { x: Math.min(Math.max(8, pos?.x ?? innerWidth - w - 16), Math.max(8, innerWidth - w - 8)), y: Math.min(Math.max(8, pos?.y ?? innerHeight - h - 16), Math.max(8, innerHeight - h - 8)) };
    pad.style.left = pos.x + 'px'; pad.style.top = pos.y + 'px';
  }
  /** When the keypad opens, make sure it is not lying on top of the pop-up (or field) it is typing into. */
  function avoid(el) {
    const box = (el.closest('.modal') || el).getBoundingClientRect(), w = pad.offsetWidth || 232, h = pad.offsetHeight || 340;
    const over = pos && pos.x < box.right && pos.x + w > box.left && pos.y < box.bottom && pos.y + h > box.top;
    if (pos && !over) return;
    const y = Math.min(Math.max(8, box.top + 40), innerHeight - h - 8);
    if (box.right + 12 + w <= innerWidth) pos = { x: box.right + 12, y };
    else if (box.left - 12 - w >= 0) pos = { x: box.left - 12 - w, y };
    else pos = { x: innerWidth - w - 8, y: innerHeight - h - 8 };     // no room beside it (phone): bottom corner
  }
  function show(el) { T.attach(el); const was = pad.hidden; pad.hidden = false; if (was) avoid(el); place(); }
  function hide() { T.attach(null); pad.hidden = true; }

  // Keys act on press, and never take focus away from the field.
  pad.addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-np]'); if (!b) return;
    e.preventDefault();
    if (b.dataset.np === 'drag') { drag = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, id: e.pointerId }; pad.setPointerCapture(e.pointerId); pad.classList.add('dragging'); return; }
    if (b.dataset.np === 'close') return hide();
    T.press(b.dataset.np); buzz();
  });
  pad.addEventListener('pointermove', e => { if (!drag || e.pointerId !== drag.id) return; pos = { x: e.clientX - drag.dx, y: e.clientY - drag.dy }; place(); });
  const drop = e => { if (drag && e.pointerId === drag.id) { drag = null; pad.classList.remove('dragging'); } };
  pad.addEventListener('pointerup', drop); pad.addEventListener('pointercancel', drop);
  pad.addEventListener('mousedown', e => e.preventDefault());   // Safari: keep the field focused

  document.addEventListener('focusin', e => { const el = e.target; if (pad.contains(el)) return; if (ok(el)) show(el); else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) hide(); });
  document.addEventListener('input', e => { if (e.isTrusted) T.typed(e.target); });
  document.addEventListener('pointerdown', e => { if (!pad.hidden && !pad.contains(e.target) && e.target !== T.target && !ok(e.target) && !e.target.closest('button, .chips, label')) hide(); }, true);
  new MutationObserver(() => { const t = T.target; if (t && (!t.isConnected || t.offsetParent === null)) hide(); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  addEventListener('resize', () => { if (!pad.hidden) place(); });
  return { show, hide, isOpen: () => !pad.hidden };
}

/* ---------------- fixed keypad inside a panel ---------------- */
/**
 * Draws a keypad into `box`. It types into the number field of `scope` that was tapped last (or the first empty one).
 * Safe to call again after the panel is redrawn: `scope` keeps one set of listeners.
 */
export function dockNumpad(box, scope) {
  box.classList.add('numpad-dock');
  box.innerHTML = `<div class="np-head"><span class="np-label"></span></div><div class="np-disp"></div>${keysHtml()}`;
  const label = box.querySelector('.np-label'), disp = box.querySelector('.np-disp');
  const fields = () => [...scope.querySelectorAll('input')].filter(el => isNumField(el) && el.offsetParent !== null);
  const T = typist({ fields, onChange: (el, buf) => { label.textContent = el ? fieldName(el) || 'Number' : 'Tap a box, then type'; disp.textContent = el ? buf || '0' : ''; } });
  T.attach(null);
  scope._npDock = T;                                    // the panel's current keypad (replaced on every redraw)
  box.addEventListener('pointerdown', e => { const b = e.target.closest('[data-np]'); if (!b) return; e.preventDefault(); T.press(b.dataset.np); buzz(); });
  box.addEventListener('mousedown', e => e.preventDefault());
  if (!scope._npBound) {
    scope._npBound = true;
    scope.addEventListener('focusin', e => { if (isNumField(e.target) && !e.target.closest('.numpad-dock')) scope._npDock?.attach(e.target); });
    scope.addEventListener('input', e => { if (e.isTrusted) scope._npDock?.typed(e.target); });
  }
  return { focusFirst() { const f = fields().find(x => !x.value) || fields()[0]; if (f) { f.focus(); T.attach(f); } } };
}
