/* Billo logic tests — runs the pure (pre-UI) section of app/index.html in a VM. */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
const logic = script.split('/* ===== UI ===== */')[0];
if (!logic.length) { console.error('logic section not found'); process.exit(1); }

const ctx = { console, Intl, Date, Math, JSON, Object, Array, String, Number, RegExp, parseFloat, isNaN };
vm.createContext(ctx);
vm.runInContext(logic, ctx);

let pass = 0, fail = 0;
function assert(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ FAIL: ' + label + (extra ? ' — ' + extra : '')); }
}
function eq(a, b, label) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  assert(A === B, label, A + ' !== ' + B);
}
const J = expr => vm.runInContext(expr, ctx);

/* ---------- fixture ---------- */
const trip = {
  id: 't1', name: 'Manali', emoji: '🏔️', currency: 'INR',
  members: [
    { id: 'm1', name: 'Jay', self: true },
    { id: 'm2', name: 'Rahul' },
    { id: 'm3', name: 'Amit' },
    { id: 'm4', name: 'Priya' }
  ],
  expenses: [], payments: [], learn: {}
};
J('trip = ' + JSON.stringify(trip) + '; meName = "Jay";');

console.log('\nsplitEqual');
eq(J('splitEqual(100, ["a","b"])'), { a: 50, b: 50 }, '100 / 2');
eq(J('Object.values(splitEqual(100, ["a","b","c"])).reduce((s,v)=>s+v,0)'), 100, '100 / 3 sums to 100');
eq(J('splitEqual(100, ["a","b","c"])'), { a: 33.34, b: 33.33, c: 33.33 }, '100 / 3 exact paise');
eq(J('splitEqual(5, ["a","b"])'), { a: 2.5, b: 2.5 }, '5 / 2');
eq(J('splitEqual(0, ["a","b"])'), { a: 0, b: 0 }, '0 / 2');

console.log('\ncomputeTrip — basic ledger');
J('trip.expenses.push({id:"e1", desc:"Cab", cat:"cab", amount:100, currency:"INR", date:"2026-09-10", payerId:"m1", parts:["m1","m2"], custom:false, customAmts:null, settled:false, src:"form", raw:"", ai:false, img:""});');
let c = J('computeTrip(trip)');
eq(c.net, { m1: 50, m2: -50, m3: 0, m4: 0 }, 'nets after Jay pays 100 for Jay+Rahul');
eq(c.flows, [{ from: 'm2', to: 'm1', amount: 50 }], 'one flow Rahul→Jay 50');
eq(c.outstanding, 50, 'outstanding 50');
eq(c.total, 100, 'total 100');

console.log('\ncomputeTrip — payment zeroes it out');
J('trip.payments.push({id:"p1", from:"m2", to:"m1", amount:50, ts:1});');
c = J('computeTrip(trip)');
eq(c.net, { m1: 0, m2: 0, m3: 0, m4: 0 }, 'all nets zero after payment');
eq(c.flows, [], 'no flows after payment');

console.log('\ncomputeTrip — payer outside participants');
J('trip.expenses = []; trip.payments = [];');
J('trip.expenses.push({id:"e2", desc:"Food", cat:"food", amount:90, currency:"INR", date:"2026-09-10", payerId:"m1", parts:["m2","m3"], custom:false, customAmts:null, settled:false, src:"form", raw:"", ai:false, img:""});');
c = J('computeTrip(trip)');
eq(c.net, { m1: 90, m2: -45, m3: -45, m4: 0 }, 'Jay paid 90 for Amit+Rahul');
eq(c.flows.length, 2, 'two flows');
eq(c.flows.reduce((s, f) => s + f.amount, 0), 90, 'flows sum to 90');

console.log('\ncomputeTrip — flows always settle exactly (invariant)');
J('trip.expenses = []; trip.payments = [];');
const seedExpenses = [
  { payerId: 'm1', parts: ['m1', 'm2', 'm3'], amount: 1000 },
  { payerId: 'm2', parts: ['m1', 'm2', 'm3', 'm4'], amount: 878 },
  { payerId: 'm3', parts: ['m2', 'm4'], amount: 55.55 },
  { payerId: 'm4', parts: ['m1', 'm4'], amount: 1234.56 },
  { payerId: 'm2', parts: ['m3'], amount: 99.99 }
];
seedExpenses.forEach((s2, i) => {
  J('trip.expenses.push({id:"s'+i+'", desc:"x", cat:"other", amount:'+s2.amount+', currency:"INR", date:"2026-09-10", payerId:"'+s2.payerId+'", parts:'+JSON.stringify(s2.parts)+', custom:false, customAmts:null, settled:false, src:"form", raw:"", ai:false, img:""});');
});
c = J('computeTrip(trip)');
const sumNet = Object.values(c.net).reduce((s, v) => s + v, 0);
assert(Math.abs(sumNet) < 0.01, 'sum of nets ≈ 0', String(sumNet));
// applying flows to nets must zero everything
const apply = c.net.slice ? {} : {};
let nets = Object.assign({}, c.net);
c.flows.forEach(f => { nets[f.from] = Math.round((nets[f.from] + f.amount) * 100) / 100; nets[f.to] = Math.round((nets[f.to] - f.amount) * 100) / 100; });
assert(Object.values(nets).every(v => Math.abs(v) < 0.01), 'applying flows zeros all nets', JSON.stringify(nets));
assert(c.flows.length <= Object.keys(c.net).length - 1, 'flow count ≤ n-1', 'got ' + c.flows.length);

console.log('\nparseExpenseText');
function parse(text) { return J('parseExpenseText(' + JSON.stringify(text) + ', trip, "Jay")'); }

let r = parse('Paid ₹800 cab for me and Rahul');
eq(r.amount, 800, 'amount ₹800');
eq(r.cat, 'cab', 'cat cab');
eq(r.payerId, 'm1', 'payer = me');
assert(r.parts.includes('m1') && r.parts.includes('m2') && r.parts.length === 2, 'parts = me + Rahul', JSON.stringify(r.parts));

r = parse('Rahul paid 2,000 for the Airbnb');
eq(r.amount, 2000, 'amount 2,000');
eq(r.payerId, 'm2', 'payer Rahul');
eq(r.cat, 'hotel', 'cat hotel (airbnb)');
eq(r.desc, 'Airbnb', 'desc Airbnb');
assert(r.everyone === true || r.parts.length === 4, 'defaults to everyone', JSON.stringify(r.parts));

r = parse('dinner 1200');
eq(r.amount, 1200, 'amount 1200');
eq(r.cat, 'food', 'cat food');
eq(r.desc, 'Dinner', 'desc Dinner');
eq(r.parts.length, 4, 'everyone by default');

r = parse('₹4800 hotel bill for everyone');
eq(r.amount, 4800, 'amount 4800');
eq(r.cat, 'hotel', 'cat hotel');
assert(r.everyone === true, 'explicit everyone');

r = parse('sirf mere liye petrol 500');
assert(r.onlyMe === true, 'onlyMe detected');
eq(r.parts, ['m1'], 'parts = just me');
eq(r.cat, 'fuel', 'cat fuel');
eq(r.amount, 500, 'amount 500');

r = parse('1.5k tickets for all');
eq(r.amount, 1500, '1.5k → 1500');
eq(r.cat, 'travel', 'cat travel (tickets)');
eq(r.desc, 'Tickets', 'desc Tickets');

r = parse('i paid 350 chai with amit');
eq(r.payerId, 'm1', 'payer me (i paid)');
eq(r.cat, 'food', 'cat food (chai)');
assert(r.parts.includes('m1') && r.parts.includes('m3') && !r.parts.includes('m2'), 'parts = me + Amit', JSON.stringify(r.parts));

r = parse('Rahul paid 800 for Amit and Priya');
eq(r.payerId, 'm2', 'payer Rahul');
assert(r.parts.includes('m2') && r.parts.includes('m3') && r.parts.includes('m4') && !r.parts.includes('m1'), 'parts = Rahul, Amit, Priya', JSON.stringify(r.parts));

r = parse('20,000');
eq(r.amount, 20000, 'amount 20,000');
eq(r.cat, 'other', 'cat other');

r = parse('Priya had paid 750 for paragliding with me');
eq(r.payerId, 'm4', 'payer Priya (had paid)');
eq(r.cat, 'fun', 'cat fun (paragliding)');
assert(r.parts.includes('m1') && r.parts.includes('m4') && r.parts.length === 2, 'parts = Priya + me', JSON.stringify(r.parts));

console.log('\nparseExpenseTextAll — multi-expense messages');
function parseAll(text) { return J('parseExpenseTextAll(' + JSON.stringify(text) + ', trip, "Jay")'); }

let arr = parseAll('I paid 2200 for booze and 1388 for food');
eq(arr.length, 2, 'two expenses detected');
eq(arr[0].amount, 2200, 'first amount 2200');
eq(arr[0].cat, 'food', 'booze → food');
eq(arr[0].desc, 'Booze', 'first desc Booze', arr[0].desc);
eq(arr[1].amount, 1388, 'second amount 1388');
eq(arr[1].cat, 'food', 'second cat food');
eq(arr[0].payerId, 'm1', 'first payer = me');
eq(arr[1].payerId, 'm1', 'second inherits payer');
eq(arr[1].parts.length, 4, 'second splits everyone');

arr = parseAll('Paid ₹800 cab for me and Rahul');
eq(arr.length, 1, 'single message stays single');
eq(arr[0].amount, 800, 'single amount 800');

arr = parseAll('dinner 1200');
eq(arr.length, 1, 'dinner 1200 is single');

arr = parseAll('paid 500 on 12 march');
eq(arr.length, 1, 'no false multi from a date');
eq(arr[0].amount, 500, 'picks the bill amount, not the date');

arr = parseAll('800 cab and 300 chai');
eq(arr.length, 2, 'and-connector multi');
eq(arr[0].amount, 800, 'multi first 800');
eq(arr[1].amount, 300, 'multi second 300');
eq(arr[0].cat, 'cab', 'multi first cat cab');
eq(arr[1].cat, 'food', 'multi second cat food');

arr = parseAll('₹800 cab; ₹300 chai');
eq(arr.length, 2, 'two currency-marked amounts = multi');

arr = parseAll('Rahul paid 2000 for the airbnb and me for chai 350');
eq(arr.length, 2, 'named payer + two amounts');
eq(arr[0].payerId, 'm2', 'named payer Rahul on first');
eq(arr[1].payerId, 'm2', 'payer inherited to second');

console.log('\nparseExpenseText — OCR / GPay-style text');
let r2 = parse('Google Pay ₹1,240.00 Paid to Rahul Transaction successful 16 Sep 2026');
eq(r2.amount, 1240, 'GPay amount ₹1,240.00');
eq(r2.payerId, 'm1', 'GPay payer = me');
assert(r2.parts.includes('m2') && r2.parts.includes('m1'), '"Paid to Rahul" → Rahul + me', JSON.stringify(r2.parts));
r2 = parse('Zomato order 456.00 dinner');
eq(r2.cat, 'food', 'Zomato → food');
r2 = parse('Uber cab 245');
eq(r2.cat, 'cab', 'Uber → cab');

console.log('\nlearn — pattern memory');
J('trip.learn = {};');
for (let i = 0; i < 4; i++) J('learnRecord(trip, {payerId:"m1", cat:"cab", parts:["m1","m2"]});');
let sg = J('learnSuggest(trip, "m1", "cab")');
assert(sg && JSON.stringify(sg.ids) === JSON.stringify(['m1', 'm2']), 'suggests frequent pair', JSON.stringify(sg));
sg = J('learnSuggest(trip, "m1", "food")');
assert(sg === null, 'no suggestion without history');
J('trip.learn = {}; learnRecord(trip, {payerId:"m1", cat:"food", parts:["m1"]}); learnRecord(trip, {payerId:"m1", cat:"food", parts:["m1"]});');
sg = J('learnSuggest(trip, "m1", "food")');
assert(sg === null, 'needs ≥3 occurrences');

console.log('\nbuildShareText');
J('trip.expenses = []; trip.payments = [];');
J('trip.expenses.push({id:"e9", desc:"Hotel", cat:"hotel", amount:4800, currency:"INR", date:"2026-09-10", payerId:"m1", parts:["m1","m2","m3","m4"], custom:false, customAmts:null, settled:false, src:"photo", raw:"", ai:true, img:""});');
const txt = J('buildShareText(trip, computeTrip(trip))');
assert(txt.includes('Manali'), 'has trip name');
assert(txt.includes('₹4,800'), 'has total', txt.split('\n')[0]);
assert(txt.includes('Who pays whom:'), 'has settlements header');
assert(!/[\u{1F300}-\u{1FAFF}]/u.test(txt), 'no emoji in share text');
assert(txt.includes('→'), 'has arrows');
assert(txt.includes('billo.app'), 'has store CTA');

console.log('\nfmtMoney');
eq(J('fmtMoney(1240, "INR")'), '₹1,240', 'INR format');
eq(J('fmtMoney(9456.5, "INR")'), '₹9,456.50', 'INR with paisa');
eq(J('fmtMoney(1000, "USD")'), '$1,000', 'USD format');
eq(J('fmtMoney(999.99, "USD")'), '$999.99', 'USD with cents');


/* ===================== v1.2 ===================== */
console.log('\nUPI');
assert(J('isVpa("rahul.k@okaxis")'), 'valid vpa');
assert(J('isVpa("9876543210@ybl")'), 'phone vpa');
assert(!J('isVpa("rahul@")'), 'rejects missing provider');
assert(!J('isVpa("rahul okaxis")'), 'rejects no @');
assert(!J('isVpa("a@b@c")'), 'rejects double @');
eq(J('upiLink({ vpa: "Rahul@OkAxis", name: "Rahul K", amount: 1240.5, note: "Manali" })'),
  'upi://pay?pa=rahul%40okaxis&pn=Rahul%20K&am=1240.50&cu=INR&tn=Manali', 'deep link format');
eq(J('upiLink({ vpa: "nope", amount: 10 })'), '', 'bad vpa → no link');
assert(!J('upiLink({ vpa: "a@ybl", amount: 0 })').includes('am='), 'zero amount omitted');
J('trip.members[0].upi = "jay@okicici";');
const req = J('buildUpiRequest(trip, { from: "m2", to: "m1", amount: 1240 })');
assert(req.includes('Hi Rahul') && req.includes('₹1,240') && req.includes('UPI: jay@okicici'), 'request text', req);
const st2 = J('buildShareText(trip, { total: 100, receipts: 0, flows: [{ from: "m2", to: "m1", amount: 100 }] })');
assert(st2.includes('on UPI: jay@okicici'), 'share text carries payee UPI');
const st3 = J('buildShareText(trip, { total: 3678, receipts: 0, flows: [{ from: "m2", to: "m1", amount: 1225.99 }] })');
assert(st3.includes('₹1,226') && !st3.includes('1,225.99'), 'whole rupees in chat', st3);
J('delete trip.members[0].upi;');

console.log('\nsplitItems');
let si = J('splitItems([{ name: "Pizza", price: 600, who: ["a","b","c"] }, { name: "Beer", price: 400, who: ["a"] }], 0)');
eq(si.shares, { a: 600, b: 200, c: 200 }, 'item shares');
eq(si.amount, 1000, 'amount = items');
si = J('splitItems([{ price: 600, who: ["a","b","c"] }, { price: 400, who: ["a"] }], 100)');
eq(si.shares, { a: 660, b: 220, c: 220 }, 'tax spread by consumption');
eq(si.amount, 1100, 'amount includes tax');
si = J('splitItems([{ price: 100, who: ["a","b","c"] }], 10)');
eq(Math.round(Object.values(si.shares).reduce((s, v) => s + v, 0) * 100), 11000, 'paise-exact with thirds + tax');
si = J('splitItems([{ price: 999.99, who: ["a","b","c"] }, { price: 1.01, who: ["b"] }], -77.77)');
eq(Math.round(Object.values(si.shares).reduce((s, v) => s + v, 0) * 100), Math.round(si.amount * 100), 'discount stays exact');
eq(si.amount, 923.23, 'discount applied');
eq(J('splitItems([{ price: 100, who: [] }], 0)').amount, 0, 'unassigned item ignored');
eq(J('splitItems([{ price: 50, who: ["a"] }], -500)').amount, 0, 'discount floors at zero');
// random invariant check
let okInv = true;
for (let k = 0; k < 300; k++) {
  const ids = ['a','b','c','d','e'];
  const items = Array.from({ length: 1 + (k % 6) }, (_, i) => ({ price: ((k * 37 + i * 101) % 5000) / 7, who: ids.filter((_, j) => (k + i + j) % 3 !== 0) }));
  const ex = ((k * 13) % 400) - 150;
  const r = J('splitItems(' + JSON.stringify(items) + ', ' + ex + ')');
  const sum = Math.round(Object.values(r.shares).reduce((s, v) => s + v, 0) * 100);
  if (sum !== Math.round(r.amount * 100)) { okInv = false; break; }
}
assert(okInv, 'shares always sum to amount (300 random bills)');

console.log('\nparseReceiptItems');
const rc = J('parseReceiptItems(' + JSON.stringify([
  'THE BIRYANI HOUSE', 'Koramangala, Bengaluru 560034', 'GSTIN 29ABCDE1234F1Z5', 'Date 12/09/2026 21:14', 'Table 7',
  '2 Chicken Biryani 2 560.00', 'Paneer Tikka 280.00', 'Butter Naan 4 x 60 240', 'Coke 60',
  'Sub Total 1140.00', 'CGST 2.5% 28.50', 'SGST 2.5% 28.50', 'Service Charge 57.00', 'Grand Total 1254.00', 'UPI 1254.00', 'Thank you visit again'
].join('\n')) + ')');
assert(rc && rc.items.length === 4, 'finds 4 items', JSON.stringify(rc));
eq(rc.items.map(i => i.name), ['Chicken Biryani', 'Paneer Tikka', 'Butter Naan', 'Coke'], 'item names cleaned');
eq(rc.items.map(i => i.price), [560, 280, 240, 60], 'item prices');
eq(rc.extra, 114, 'tax + service collected');
eq(rc.total, 1254, 'grand total read');
const rc2 = J('parseReceiptItems("Pasta 450\\nTiramisu 300\\nDiscount 75\\nTotal 675")');
eq(rc2.extra, -75, 'discount negative');
eq(J('parseReceiptItems("Paid to Rahul\\n₹500")'), null, 'UPI screenshot is not itemized');
const rc3 = J('parseReceiptItems("Dosa 120\\nIdli 80\\nTotal 220")');
eq(rc3.extra, 20, 'printed total wins over missing tax line');

console.log('\ntripInsights');
const it = {
  id: 'ti', name: 'Goa', emoji: '🏖️', currency: 'INR', budget: 10000, days: 4,
  members: [{ id: 'a', name: 'A', self: true }, { id: 'b', name: 'B' }],
  expenses: [
    { amount: 3000, cat: 'hotel', date: '2026-09-01', payerId: 'a', parts: ['a', 'b'] },
    { amount: 1000, cat: 'food', date: '2026-09-01', payerId: 'b', parts: ['a', 'b'] },
    { amount: 600, cat: 'food', date: '2026-09-02', payerId: 'a', parts: ['a'], settled: true }
  ], payments: []
};
const ins = J('tripInsights(' + JSON.stringify(it) + ')');
eq(ins.total, 4600, 'total incl. settled bills');
eq(ins.cats.map(c => c.cat), ['hotel', 'food'], 'cats sorted');
eq(ins.cats[1].amount, 1600, 'food sum');
eq(ins.nDays, 2, 'days');
eq(ins.perDay, 2300, 'per day');
eq(ins.paid, { a: 3600, b: 1000 }, 'paid by');
eq(ins.share, { a: 2600, b: 2000 }, 'consumed by');
eq(ins.budget.left, 5400, 'budget left');
eq(ins.budget.pct, 46, 'budget pct');
eq(ins.budget.projected, 9200, 'projection at burn rate');
eq(J('tripInsights({ members: [], expenses: [] })').budget, null, 'no budget');
it.expenses.forEach(e => { e.date = '2026-09-01'; });
eq(J('tripInsights(' + JSON.stringify(it) + ')').budget.projected, null, 'no projection from a single day');

console.log('\nvoice bills');
const vt = { id: 'v1', name: 'Goa', currency: 'INR',
  members: [{ id: 'j', name: 'Jay', self: true }, { id: 'r', name: 'Rahul' }, { id: 'a', name: 'Ajay' }],
  expenses: [], payments: [], learn: {} };
J('vt = ' + JSON.stringify(vt));
eq(J('voiceNormalize("I paid 6 hazaar for food")'), 'I paid 6000 for food', '6 hazaar → 6000');
eq(J('voiceNormalize("2.5 lakh")').indexOf('250000') >= 0, true, '2.5 lakh → 250000');
eq(J('voiceNormalize("saat sau for cab")').indexOf('700') >= 0, true, 'saat sau → 700');
eq(J('voiceNormalize("Maine 6 hazaar diye khane ke liye Rahul aur Krish ke saath")'), 'Maine 6000 diya khana with Rahul and Krish', 'Hinglish reorder');
let vr = J('parseExpenseText(voiceNormalize("I paid 6000 for food with Rahul, Ajay and Krish"), vt, "Jay")');
eq(vr.amount, 6000, 'amount 6000');
eq(vr.payerId, 'j', 'I paid → me');
eq(vr.parts.slice().sort(), ['a', 'j', 'r'], 'known people in the split');
eq(J('detectNewNames(voiceNormalize("I paid 6000 for food with Rahul, Ajay and Krish"), vt, "Jay")'), ['Krish'], 'Krish is new');
eq(J('detectNewNames("Rahul paid 1200 for petrol", vt, "Jay")'), [], 'no new names');
eq(J('voiceDesc(parseExpenseText("I paid 6000 for food with Rahul and Krish", vt, "Jay"), vt, "Jay", ["Krish"])').toLowerCase().indexOf('krish'), -1, 'description has no names');

console.log('\ncircleOf');
const ct = JSON.parse(JSON.stringify(vt));
ct.expenses.push({ id: 'x', amount: 300, currency: 'INR', payerId: 'j', parts: ['j', 'r', 'a'], date: '2026-09-01' });
const circ = J('circleOf([' + JSON.stringify(ct) + '], "Jay", "INR")');
eq(circ.map(p => p.name).sort(), ['Ajay', 'Rahul'], 'both friends in the circle');
eq(circ.find(p => p.name === 'Rahul').amount, 100, 'Rahul pays you 100');

console.log('\n' + (fail ? '❌ ' + fail + ' FAILED, ' : '') + pass + ' passed');
process.exit(fail ? 1 : 0);
