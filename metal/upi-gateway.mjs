// UPI auto-confirm through the shop's OWN Razorpay account (money goes straight to the shop; no server of ours).
// Flow: create a single-use, fixed-amount UPI QR for the bill -> poll its payments every few seconds ->
// accept only a captured INR UPI payment of exactly that amount on exactly that QR -> close the QR if abandoned.
// `http({ method, url, headers, data })` must resolve to { status, data } (native CapacitorHttp in the app).

export const RZP_API = 'https://api.razorpay.com/v1';
const QR_ID = /^qr_[A-Za-z0-9]{14}$/, PAY_ID = /^pay_[A-Za-z0-9]{14}$/;
export const QR_LIFETIME_S = 20 * 60; // Razorpay docs say min 2 or 15 min, max 2 h; 20 min satisfies both

export function keyMode(keyId) { const m = /^rzp_(test|live)_[A-Za-z0-9]{8,32}$/.exec(String(keyId || '').trim()); return m ? m[1] : null; }
export const validSecret = s => /^[A-Za-z0-9]{12,64}$/.test(String(s || '').trim());
export const maskKey = k => (k ? String(k).slice(0, 9) + '••••' + String(k).slice(-4) : '');

/** Only Razorpay's own hosts may serve the QR image. */
export function safeImageUrl(u) {
  try { const x = new URL(u); return x.protocol === 'https:' && (x.hostname === 'rzp.io' || x.hostname.endsWith('.rzp.io') || x.hostname === 'razorpay.com' || x.hostname.endsWith('.razorpay.com')) ? x.href : null; } catch { return null; }
}

export class GatewayError extends Error { constructor(kind, message) { super(message); this.kind = kind; } }

export function razorpay({ keyId, keySecret, http, now = () => Date.now() }) {
  if (!keyMode(keyId) || !validSecret(keySecret)) throw new GatewayError('keys', 'Razorpay Key ID or Key Secret is not in the right format.');
  const auth = 'Basic ' + btoa(`${keyId.trim()}:${keySecret.trim()}`);
  async function call(method, path, data) {
    let res;
    try { res = await http({ method, url: RZP_API + path, headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' }, data }); }
    catch { throw new GatewayError('network', 'No internet — could not reach Razorpay.'); }
    let body = res?.data;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    if (res?.status === 401) throw new GatewayError('keys', 'Razorpay did not accept these API keys.');
    if (!res || res.status < 200 || res.status >= 300) {
      const d = String(body?.error?.description || '').slice(0, 200);
      throw new GatewayError(/not.*enabled|feature/i.test(d) ? 'feature' : 'api', d ? 'Razorpay: ' + d : `Razorpay error (${res?.status ?? 'no response'}).`);
    }
    if (!body || typeof body !== 'object') throw new GatewayError('api', 'Unexpected reply from Razorpay.');
    return body;
  }

  return {
    mode: keyMode(keyId),
    /** Check the keys (lists 1 payment; moves no money). */
    async test() { await call('GET', '/payments?count=1'); return true; },

    async createQr({ amountPaise, billRef, shopName }) {
      if (!Number.isInteger(amountPaise) || amountPaise < 100 || amountPaise > 1e9) throw new GatewayError('amount', 'Amount must be between ₹1 and ₹1 crore.');
      const ref = String(billRef || '').replace(/[^A-Za-z0-9/-]/g, '').slice(0, 40);
      const qr = await call('POST', '/payments/qr_codes', {
        type: 'upi_qr', name: String(shopName || 'Shop').slice(0, 40), usage: 'single_use', fixed_amount: true,
        payment_amount: amountPaise, description: `Bill ${ref}`.slice(0, 60), close_by: Math.floor(now() / 1000) + QR_LIFETIME_S,
        notes: { bill: ref, app: 'atmanirbhar' }
      });
      const image = safeImageUrl(qr.image_url);
      if (!QR_ID.test(qr.id) || qr.payment_amount !== amountPaise || qr.status !== 'active' || !image) throw new GatewayError('api', 'Razorpay returned an unexpected QR code.');
      return { id: qr.id, imageUrl: image, closeBy: Number(qr.close_by) * 1000 || now() + QR_LIFETIME_S * 1000 };
    },

    /**
     * Has this QR been paid? Accepts only: captured, INR, UPI, exactly amountPaise, a payment id we haven't used before.
     * Returns { paid:true, paymentId, utr, vpa } or { paid:false, closed? }.
     */
    async check(qrId, amountPaise, usedIds = new Set()) {
      if (!QR_ID.test(qrId)) throw new GatewayError('api', 'Bad QR id.');
      const list = await call('GET', `/payments/qr_codes/${qrId}/payments?count=10`);
      const items = Array.isArray(list.items) ? list.items : [];
      const p = items.find(x => x && PAY_ID.test(x.id) && x.status === 'captured' && x.captured === true && x.currency === 'INR' &&
        x.method === 'upi' && x.amount === amountPaise && !(x.amount_refunded > 0) && !usedIds.has(x.id));
      if (p) {
        const rrn = String(p.acquirer_data?.rrn ?? '');
        return { paid: true, paymentId: p.id, utr: /^\d{12}$/.test(rrn) ? rrn : '', vpa: String(p.vpa || '').slice(0, 100) };
      }
      return { paid: false };
    },
    async status(qrId) {
      if (!QR_ID.test(qrId)) throw new GatewayError('api', 'Bad QR id.');
      const q = await call('GET', `/payments/qr_codes/${qrId}`);
      return { closed: q.status === 'closed', reason: q.close_reason || null, received: Number(q.payments_amount_received) || 0 };
    },
    async findRecent(amountPaise, sinceMs, usedIds = new Set()) {
      const from = Math.floor(sinceMs / 1000) - 10;
      const list = await call('GET', `/payments?from=${from}&count=50`);
      const items = (Array.isArray(list.items) ? list.items : []).filter(x => x && PAY_ID.test(x.id) && x.status === 'captured' && x.captured === true &&
        x.currency === 'INR' && x.method === 'upi' && x.amount === amountPaise && !(x.amount_refunded > 0) && !usedIds.has(x.id) &&
        Number(x.created_at) * 1000 >= sinceMs - 10000).sort((a, b) => a.created_at - b.created_at);
      const p = items[0];
      if (!p) return { paid: false };
      const rrn = String(p.acquirer_data?.rrn ?? '');
      return { paid: true, paymentId: p.id, utr: /^\d{12}$/.test(rrn) ? rrn : '', vpa: String(p.vpa || '').slice(0, 100) };
    },
    /** Close an unpaid QR so a late payment can't land on a bill that was paid another way. */
    async close(qrId) { if (QR_ID.test(qrId)) await call('POST', `/payments/qr_codes/${qrId}/close`).catch(() => {}); }
  };
}

