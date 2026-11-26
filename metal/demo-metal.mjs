// A fictional metal-cutting shop ("Madhur Steel Corporation"): the material list with nothing in stock.
// Used by tools/seed-metal.html (testing on this Mac) and by the customer website's first visit (DEMO_SHOP in build-config.mjs).
import * as C from './india-core.mjs';
import * as M from './metal-core.mjs';
export function metalDemoData() {
  const uid = () => crypto.randomUUID();
  const g = '24AAKFS4321M1Z'; const gstin = g + C.gstinCheckChar(g);
  const settings = { shopType: 'metal', metal: { kerfMm: 2, minOffcutMm: 100, cutChargePaise: 2000, fees: { loading: { name: 'Loading fee', feePaise: 15000, gstRate: 18 }, cartage: { name: 'Cartage fee', feePaise: 40000, gstRate: 18 } } },
    shopName: 'Madhur Steel Corporation', address: 'Plot 22, GIDC Aji Industrial Estate, Rajkot, Gujarat 360003', stateCode: '24', phone: '9825012345', fssai: '',
    regime: 'regular', gstin, turnoverAbove5Cr: false, upiVpa: 'madhursteel@bank', upiName: 'Madhur Steel Corporation', merchantUpi: false, mcc: '',
    invoicePrefix: 'INV', cnPrefix: 'CN', paper: 'a4', footer: 'Goods once cut will not be taken back.', lang: 'en', createdAt: Date.now() - 40 * 864e5, lastBackup: Date.now() - 864e5 };
  const rates = { 'M.S.': 6200, 'E.N.8': 7200, 'E.N.19 ROLLED': 9800, 'E.N.19 FORGED': 10900, 'E.N.24 ROLLED': 12500, 'E.N.24 FORGED': 13800, 'E.N.41.B': 16500 };
  const grades = M.DEFAULT_GRADES.map(x => ({ id: uid(), ...x, ratePaise: rates[x.name] || 0 }));
  const G = n => grades.find(x => x.name === n);
  const products = [], bars = []; let seq = 0;
  const mat = (shape, dims, gradeName, lengths, barcode = '') => {
    const gr = G(gradeName), id = uid();
    const p = { id, name: M.materialName(shape, dims, gr.name), localName: '', barcode, barcodes: [], unit: 'KGS', category: gr.name, pricePaise: gr.ratePaise, mrpPaise: null,
      hsn: gr.hsn, gstRate: gr.gstRate, cessRate: 0, priceIncludesTax: false, stock: 0, lowStock: 20, active: true, metal: { shape, dims, gradeId: gr.id } };
    for (const [len, orig] of lengths) bars.push({ id: uid(), code: M.nextBarCode(++seq), materialId: id, lengthMm: len, origLengthMm: orig || len, status: 'stock', receivedAt: Date.now() - 5 * 864e5, supplierCode: barcode, supplier: len === 3000 ? 'KOLKATA' : (orig || len) === 6000 ? 'IMPORTED' : 'PUNJAB' });
    p.stock = M.stockSummary(bars, p, gr.density).kg; products.push(p); return p;
  };
  mat('round', [25], 'E.N.8', [[6000], [6000], [1840, 6000]], 'EN8-RD-25');
  mat('round', [40], 'E.N.8', [[6000], [6000], [1300, 6000], [420, 6000]], 'EN8-RD-40');
  mat('hex', [24], 'E.N.8', [[3000], [3000]]);
  mat('round', [50], 'M.S.', [[5800], [2250, 5800]]);
  mat('square', [25], 'M.S.', [[6000], [6000]]);
  mat('flat', [50, 10], 'M.S.', [[6000], [6000], [900, 6000]]);
  mat('round', [32], 'E.N.19 ROLLED', [[5500]]);
  mat('round', [63], 'E.N.19 FORGED', [[3000], [3000]]);
  mat('round', [40], 'E.N.24 ROLLED', [[6000], [1250, 6000]]);
  mat('round', [80], 'E.N.24 FORGED', [[3000]]);
  mat('round', [50], 'E.N.41.B', [[5600]]);
  // The demo starts with the material list only: nothing in stock, and no non-metal items.
  bars.length = 0; seq = 0; for (const p of products) p.stock = 0;
  const cg = '24AAACP7788K1Z';
  const customers = [
    { id: uid(), name: 'Patel Engineering Works', phone: '9879011223', gstin: cg + C.gstinCheckChar(cg), address: 'Shed 7, Metoda GIDC, Rajkot', stateCode: '24', pan: '', waConsent: true, createdAt: Date.now() - 30 * 864e5, creditLimitPaise: 20000000 },
    { id: uid(), name: 'Kiran Fabricators', phone: '9898044556', gstin: '', address: 'Bhaktinagar, Rajkot', stateCode: '24', pan: '', waConsent: true, createdAt: Date.now() - 20 * 864e5, creditLimitPaise: null },
  ];
  return { app: 'india-pos', kv: [{ key: 'settings', value: settings }, { key: 'counters', value: {} }, { key: 'cart', value: { lines: [], customerId: null, placeOfSupply: null, billDiscountPaise: 0 } }, { key: 'held', value: [] },
  { key: 'grades', value: grades }, { key: 'barSeq', value: seq }], products, customers, sales: [], creditNotes: [], khata: [], dayClose: [], bars };
}
