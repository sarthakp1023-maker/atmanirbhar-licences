// PhonePe card machine (Integrated EDC) using the shop's OWN PhonePe merchant credentials. No server of ours:
// the app pushes the sale to the shop's terminal, then polls the status API (PhonePe allows status polling
// instead of callbacks) and accepts only a SUCCESS for exactly this merchant, transaction and amount.
// `http({ method, url, headers, data })` -> { status, data } (native CapacitorHttp in the app).

export const EDC_HOSTS = { uat: 'https://mercury-uat.phonepe.com/enterprise-sandbox', prod: 'https://mercury-t2.phonepe.com' };
const ID = /^[A-Za-z0-9_]{1,64}$/;
export const validEdcCreds = c => !!c && ID.test(c.merchantId || '') && ID.test(c.storeId || '') && ID.test(c.terminalId || '') &&
  /^[A-Za-z0-9-]{8,128}$/.test(c.saltKey || '') && /^\d{1,3}$/.test(String(c.saltIndex ?? '')) && (c.env === 'uat' || c.env === 'prod');

const utf8b64 = s => { const b = new TextEncoder().encode(s); let x = ''; for (const c of b) x += String.fromCharCode(c); return btoa(x); };
async function sha256hex(s) { const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); return Array.from(h, x => x.toString(16).padStart(2, '0')).join(''); }

export class EdcError extends Error { constructor(kind, message, code) { super(message); this.kind = kind; this.code = code; } }

/** New transaction id: letters/digits/underscore, under 40 characters, unique per attempt. */
export function newEdcTxnId(now = Date.now()) {
  const r = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(36).padStart(2, '0')).join('');
  return `AN_${now.toString(36)}_${r}`.slice(0, 39);
}

const FRIENDLY = {
  UNAUTHORIZED: ['keys', 'PhonePe rejected the salt key / index.'],
  INVALID_MERCHANT_ID: ['keys', 'PhonePe does not recognise this merchant ID.'],
  INVALID_STORE_ID: ['keys', 'PhonePe does not recognise this store ID.'],
  INVALID_TERMINAL_ID: ['keys', 'PhonePe does not recognise this terminal ID.'],
  SOLUTION_NOT_ENABLED: ['feature', 'The card-machine integration is not turned on for your PhonePe account yet — ask PhonePe to enable “Integrated EDC”.'],
  INTEGRATEDMODE_NOT_ENABLED_ON_TERMINAL: ['feature', 'Your PhonePe machine is not in “integrated” mode — ask PhonePe to switch it on for this terminal.'],
  INVALID_AMOUNT: ['amount', 'PhonePe did not accept this amount.'],
};

export function phonepeEdc({ merchantId, storeId, terminalId, saltKey, saltIndex, env, http, now = () => Date.now() }) {
  const creds = { merchantId, storeId, terminalId, saltKey, saltIndex: String(saltIndex), env };
  if (!validEdcCreds(creds)) throw new EdcError('keys', 'PhonePe details are not in the right format.');
  const base = EDC_HOSTS[env];
  const verify = async s => (await sha256hex(s + saltKey)) + '###' + creds.saltIndex;

  async function send(path, body) {
    let res;
    try { res = await http({ method: 'POST', url: base + path, headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-VERIFY': body.xv }, data: body.data }); }
    catch { throw new EdcError('network', 'No internet — could not reach PhonePe.'); }
    let j = res?.data; if (typeof j === 'string') { try { j = JSON.parse(j); } catch { j = null; } }
    if (!j || typeof j !== 'object') throw new EdcError('api', `Unexpected reply from PhonePe (${res?.status ?? 'no response'}).`);
    return j;
  }
  const fail = j => { const [kind, msg] = FRIENDLY[j.code] || ['api', 'PhonePe: ' + String(j.message || j.code || 'request failed').slice(0, 160)]; return new EdcError(kind, msg, j.code); };

  return {
    env,
    /** Push a sale to the terminal. Returns { transactionId }. */
    async startSale({ amountPaise, orderId, transactionId = newEdcTxnId(now()), modes = ['DQR', 'CARD'] }) {
      if (!Number.isInteger(amountPaise) || amountPaise < 100 || amountPaise > 1e9) throw new EdcError('amount', 'Amount must be between ₹1 and ₹1 crore.');
      if (!/^[A-Za-z0-9_]{1,39}$/.test(transactionId)) throw new EdcError('api', 'Bad transaction id.');
      const payload = { merchantId, storeId, terminalId, orderId: String(orderId || transactionId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40),
        transactionId, amount: amountPaise, paymentModes: modes.filter(m => m === 'DQR' || m === 'CARD'), timeAllowedForHandoverToTerminalSeconds: 60, integrationMappingType: 'ONE_TO_ONE' };
      const b64 = utf8b64(JSON.stringify(payload)), path = '/v1/edc/transaction/init';
      const j = await send(path, { xv: await verify(b64 + path), data: { request: b64 } });
      if (j.success !== true || j.code !== 'SUCCESS') throw fail(j);
      if (j.data && (j.data.transactionId !== transactionId || j.data.amount !== amountPaise)) throw new EdcError('api', 'PhonePe confirmed a different sale.');
      return { transactionId };
    },

    /**
     * { state: 'pending'|'paid'|'failed'|'expired', mode:'upi'|'card', reference, last4, message }.
     * 'paid' only for SUCCESS on this merchant + transaction with exactly the expected amount.
     */
    async status(transactionId, amountPaise) {
      if (!/^[A-Za-z0-9_]{1,39}$/.test(transactionId)) throw new EdcError('api', 'Bad transaction id.');
      const path = `/v1/edc/transaction/${merchantId}/${transactionId}/status`;
      const j = await send(path, { xv: await verify(path), data: {} });
      if (['UNAUTHORIZED', 'INVALID_MERCHANT_ID'].includes(j.code)) throw fail(j);
      const d = j.data && typeof j.data === 'object' ? j.data : null;
      if (!d) return { state: 'pending' };
      if (d.merchantId !== merchantId || d.transactionId !== transactionId) throw new EdcError('api', 'PhonePe returned a different transaction.');
      const st = String(d.status || '').toUpperCase();
      if (st === 'FAILED') return { state: 'failed', message: String(d.responseCode && d.responseCode !== 'null' ? d.responseCode : 'Payment failed').slice(0, 80) };
      if (st === 'EXPIRED') return { state: 'expired' };
      if (st !== 'SUCCESS' || j.success !== true || j.code !== 'SUCCESS') return { state: 'pending' };
      // Some PhonePe samples show data.amount 0 with the real amount on the instruments: accept either, never less/more.
      const inst = Array.isArray(d.paymentInstruments) ? d.paymentInstruments : [];
      const instSum = inst.reduce((a, x) => a + (Number.isInteger(x?.amount) ? x.amount : 0), 0);
      if (d.amount !== amountPaise && instSum !== amountPaise) return { state: 'failed', message: 'Amount on the machine did not match the bill — check with the customer.' };
      const card = String(d.paymentMode).toUpperCase() === 'CARD';
      const ref = String(d.referenceNumber ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 30);
      const last4 = String(inst.find(x => x?.last4Digits)?.last4Digits ?? '').replace(/\D/g, '').slice(-4);
      return { state: 'paid', mode: card ? 'card' : 'upi', reference: ref, last4 };
    },

    /** Cancel an unfinished sale. Returns 'cancelled' | 'already_paid' | 'unknown'. */
    async cancel(transactionId) {
      if (!/^[A-Za-z0-9_]{1,39}$/.test(transactionId)) return 'unknown';
      const path = `/v3/charge/${merchantId}/${transactionId}/cancel`;
      try {
        const j = await send(path, { xv: await verify(path), data: {} });
        return j.code === 'PAYMENT_ALREADY_COMPLETED' ? 'already_paid' : j.success === true ? 'cancelled' : 'unknown';
      } catch { return 'unknown'; }
    },

    /** Check the details without moving money: ask the status of a transaction that doesn't exist. */
    async test() {
      const path = `/v1/edc/transaction/${merchantId}/AN_connection_check/status`;
      const j = await send(path, { xv: await verify(path), data: {} });
      if (['UNAUTHORIZED', 'INVALID_MERCHANT_ID'].includes(j.code)) throw fail(j);
      return true;
    }
  };
}
