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
assert(txt.includes('Settlements:'), 'has settlements header');
assert(txt.includes('→'), 'has arrows');
assert(txt.includes('billo.app'), 'has store CTA');

console.log('\nfmtMoney');
eq(J('fmtMoney(1240, "INR")'), '₹1,240', 'INR format');
eq(J('fmtMoney(9456.5, "INR")'), '₹9,456.5', 'INR with paisa');
eq(J('fmtMoney(1000, "USD")'), '$1,000', 'USD format');
eq(J('fmtMoney(999.99, "USD")'), '$999.99', 'USD with cents');

console.log('\n' + (fail ? '❌ ' + fail + ' FAILED, ' : '') + pass + ' passed');
process.exit(fail ? 1 : 0);
