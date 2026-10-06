const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const fn = source.slice(source.indexOf('async function handleRechargeSubmit('), source.indexOf('\nasync function handlePaymentSubmit('));
function fixture(overrides = {}, existing) {
  const input = { rechargeAccountSearch: 'Exact account', rechargeId: existing?.id || '', rechargeAmount: '100', rechargeDate: '2026-10-05', rechargeCashCredit: '', rechargeGiftCredit: '', rechargeReference: existing?.reference || '', rechargeSourcePayment: existing?.sourcePaymentId || '', ...overrides };
  const nodes = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, { value, setCustomValidity() {}, reportValidity() {} }]));
  nodes.rechargeCampaign = { value: '' };
  const stats = { saved: 0, errors: [] };
  const context = vm.createContext({ state: { recharges: existing ? [existing] : [] },
    $: selector => nodes[selector.slice(1)], resolveRechargeAccount: value => value ? { id: 'campaign-exact' } : null,
    rechargeAmounts: () => ({ baseAmount: 100, rebateRate: 0.1, rebateAmount: 10, creditedAmount: 110 }),
    window: { TrafficWalletSummary: require('../wallet-summary') }, uid: () => 'new-charge',
    markAsRealData() {}, async saveState() { stats.saved++; return true; }, closeModal() {}, renderAll() {}, money: value => String(value),
    toast(message, kind) { if (kind === 'error') stats.errors.push(message); } });
  vm.runInContext(fn, context);
  return { context, stats, run: () => context.handleRechargeSubmit({ preventDefault() {} }) };
}
test('new recharge leaves unknown cash/grant null and requires explicit account', async () => {
  const f = fixture(); await f.run();
  assert.equal(f.stats.saved, 1); const row = f.context.state.recharges[0];
  assert.equal(row.cashCreditAmount, null); assert.equal(row.giftCreditAmount, null); assert.equal(row.amountCurrency, 'CNY');
  assert.equal(row.campaignId, 'campaign-exact');
  const empty = fixture({ rechargeAccountSearch: '' }); await empty.run(); assert.equal(empty.stats.saved, 0);
});
test('assigning historical recharge preserves money, evidence and pending status', async () => {
  const old = { id: 'old', baseAmount: 100, rebateAmount: 33, rebateRate: 0.33, amount: 133, sourcePaymentId: 'payment', reference: 'flow',
    status: '待到账', recordType: 'recharge', payer: 'original', imagePath: 'private-preserved', notes: 'original note', createdAt: '2026-09-01T00:00:00Z' };
  const f = fixture({}, old); await f.run(); const row = f.context.state.recharges[0];
  assert.equal(row.amount, 133); assert.equal(row.rebateAmount, 33); assert.equal(row.sourcePaymentId, 'payment');
  assert.equal(row.reference, 'flow'); assert.equal(row.imagePath, 'private-preserved'); assert.equal(row.payer, 'original');
  assert.equal(row.notes, old.notes); assert.equal(row.status, '待到账'); assert.equal(row.createdAt, old.createdAt);
});
test('explicit all-cash rebate preserves zero platform grant without guessing', async () => {
  const f = fixture({ rechargeCashCredit: '110', rechargeGiftCredit: '0', rechargeSourcePayment: 'payment-exact' }); await f.run();
  const row = f.context.state.recharges[0]; assert.equal(row.cashCreditAmount, 110); assert.equal(row.giftCreditAmount, 0);
  assert.equal(row.sourcePaymentId, 'payment-exact');
});
test('invalid cash/grant split never writes or mutates records', async () => {
  for (const values of [{ rechargeCashCredit: '100', rechargeGiftCredit: '0' }, { rechargeCashCredit: '-1' }, { rechargeCashCredit: 'invalid' }]) {
    const f = fixture(values); await f.run(); assert.equal(f.stats.saved, 0); assert.equal(f.context.state.recharges.length, 0); assert.equal(f.stats.errors.length, 1);
  }
});
test('unallocated editor never silently defaults to the first campaign', () => {
  const editor = source.slice(source.indexOf('function openRechargeModal('), source.indexOf('\nfunction openPaymentModal('));
  assert.doesNotMatch(editor, /state\.campaigns\[0\]/);
  assert.match(editor, /sourcePaymentId/);
});
