// Free UPI auto-confirm: read the "₹250 received" alerts that the shop's own payment apps already show
// (Google Pay for Business, PhonePe Business, Paytm for Business…). No gateway, no keys, no fees.
// The Android side (PaymentAlertsService) only forwards alerts from the apps below, identified by the
// package name Android attaches to each notification (another app cannot fake it), and keeps them in memory only.

/** Apps whose alerts we read. Package name → label. */
export const ALERT_APPS = Object.freeze({
  'com.google.android.apps.nbu.paisa.merchant': 'Google Pay for Business',
  'com.google.android.apps.nbu.paisa.user': 'Google Pay',
  'com.phonepe.app.business': 'PhonePe Business',
  'com.phonepe.app': 'PhonePe',
  'com.paytm.business': 'Paytm for Business',
  'net.one97.paytm': 'Paytm',
  'in.org.npci.upiapp': 'BHIM',
});

// Words that mean money came IN …
const IN = /\b(received|receive[sd]?|credited|paid you|has paid|have paid you|sent you|got)\b|payment (of .{0,20})?received|प्राप्त|मिले|મળ્યા/i;
// … and words that mean anything else (money out, requests, failures, offers, reminders).
const NOT = /\b(sent to|paid to|you paid|debited|request(ed|s)?|collect|failed|declined|unsuccessful|pending|processing|cashback|reward|scratch|refund(ed)?|offer|win|reminder|due|bill payment|recharge|auto-?pay|mandate|settle(d|ment)|withdraw|limit|balance)\b/i;
const AMT = String.raw`(?:₹|\brs\.?|\binr)\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?`;
const TIED = new RegExp(String.raw`(?:\b(?:received|credited|paid you|has paid(?: you)?|have paid you|sent you)\s*(?:a\s+)?(?:payment\s+of\s+)?${AMT})|(?:${AMT}\s*(?:has been\s+|was\s+|is\s+)?(?:received|credited))|(?:payment of\s+${AMT}\s+received)`, 'i');
const AMOUNT = /(?:₹|\brs\.?|\binr)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)(?![0-9,])/gi;

/**
 * One alert → { id, app, amountPaise, at } or null when it is not clearly "money received".
 * alert: { pkg, title, text, postedAt, key }
 */
export function parseAlert(alert) {
  if (!alert || typeof alert !== 'object' || !Object.hasOwn(ALERT_APPS, alert.pkg)) return null;
  const text = `${String(alert.title || '').slice(0, 300)} ${String(alert.text || '').slice(0, 600)}`.replace(/\s+/g, ' ');
  if (!IN.test(text) || NOT.test(text)) return null;
  const amounts = [...new Set([...text.matchAll(AMOUNT)].map(m => Math.round(Number(m[1].replace(/,/g, '')) * 100)))];
  if (amounts.length !== 1) return null;                         // none, or ambiguous ("₹250 of ₹500")
  // The amount must sit right next to the "money in" words ("received ₹250", "₹250 credited", "paid you ₹250"),
  // so a payer's name or note that merely contains an amount ("from ₹774 Traders") can't set the amount.
  if (!TIED.test(text)) return null;
  const amountPaise = amounts[0];
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 100 || amountPaise > 1e9) return null;
  const at = Number(alert.postedAt);
  if (!Number.isFinite(at) || at <= 0) return null;
  return { id: `alert:${alert.pkg}:${at}:${String(alert.key || '').slice(0, 80)}`, app: ALERT_APPS[alert.pkg], pkg: alert.pkg, amountPaise, at };
}

/**
 * The first alert for exactly this amount that arrived after the bill's QR was shown and has not been used for another bill.
 * Small grace before `sinceMs` covers a phone clock a few seconds out.
 */
export function matchAlert(alerts, amountPaise, sinceMs, usedIds = new Set(), now = Date.now()) {
  const list = (Array.isArray(alerts) ? alerts : []).map(parseAlert).filter(a => a && a.amountPaise === amountPaise && a.at >= sinceMs - 5000 && a.at <= now + 60000 && !usedIds.has(a.id));
  list.sort((a, b) => a.at - b.at);
  return list[0] || null;
}
