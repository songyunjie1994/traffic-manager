const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFinance, projectWallets, projectFunding } = require('../wallet-summary');
const now = Date.parse('2026-10-04T04:00:00Z');
const row = (id, date, spend, balance, extra = {}) => ({ advertiserId: id, date, updatedAt: '2026-10-04T00:00:00Z', sourceRunId: 'requested-only', sourceRangeStart: '2026-10-01', sourceRangeEnd: '2026-10-03',
  columns: { '总存入(元)': 0, '总转入(元)': 0, '总转出(元)': 0, '余额总消耗(元)': spend, '总余额(元)': balance, ...extra } });
const wallet = ids => ({ kind: 'self', openingDate: '2026-09-30', openingBalance: ids.length * 100, accounts: ids.map(advertiserId => ({ advertiserId, openingDate: '2026-09-30', openingBalance: 100 })) });
const project = (w, rows, options = {}) => projectWallets({ wallets: [w], financeRecords: rows }, { now, ...options })[0];
test('opposing account errors cannot become a passing wallet', () => {
  const result = project(wallet(['A', 'B']), [row('A', '2026-10-01', 0, 110), row('B', '2026-10-01', 0, 90)]);
  assert.equal(result.aggregateDifference, 0);
  assert.deepEqual(result.accountChecks.map(check => check.difference), [-10, 10]);
  assert.equal(result.complete, false); assert.equal(result.difference, null);
  assert.equal(result.reconciliationStatus, 'mismatch');
});
test('missing date is not certified by requested source range', () => {
  const result = project(wallet(['A']), [row('A', '2026-10-01', 20, 80), row('A', '2026-10-03', 0, 80)]);
  assert.equal(result.coverageComplete, false); assert.equal(result.difference, null);
  assert.deepEqual(result.accountChecks[0].missingDates, ['2026-10-02']);
});
test('inferred opening is disclosed, not independent first-day evidence', () => {
  const w = wallet(['A']); delete w.accounts[0].openingBalance;
  const result = project(w, [row('A', '2026-10-01', 20, 80)]);
  assert.equal(result.aggregateDifference, 0); assert.equal(result.complete, false);
  assert.equal(result.accountChecks[0].openingSource, 'inferred'); assert.equal(result.difference, null);
});
test('same account opening requires the exact opening date', () => {
  const w = wallet(['A']); w.accounts[0].openingDate = '2026-09-29';
  assert.equal(project(w, [row('A', '2026-10-01', 20, 80)]).accountChecks[0].openingSource, 'inferred');
});
test('real previous-day financial balance provides independent opening', () => {
  const w = wallet(['A']); delete w.accounts[0].openingBalance;
  const result = project(w, [row('A', '2026-09-30', 0, 100), row('A', '2026-10-01', 20, 80)]);
  assert.equal(result.complete, true); assert.equal(result.accountChecks[0].openingSource, 'platform');
});
test('daily errors cannot cancel across days either', () => {
  const result = project(wallet(['A']), [row('A', '2026-10-01', 0, 110), row('A', '2026-10-02', 0, 100)]);
  assert.equal(result.aggregateDifference, 0); assert.equal(result.accountChecks[0].difference, 0);
  assert.equal(result.accountChecks[0].errors.length, 2); assert.equal(result.complete, false);
});
test('component mismatches block apparent balance passing', () => {
  const result = project(wallet(['A']), [row('A', '2026-10-01', 0, 100, { '非赠款余额(元)': 99, '赠款余额(元)': 5 })]);
  assert.equal(result.complete, false); assert.equal(result.accountChecks[0].errors[0].type, 'balanceComponents');
});
test('same-time top-level conflicts cannot pick the first financial amount', () => {
  const a = { ...row('A', '2026-10-01', 0, 0), columns: {}, balanceTotalSpend: 20, balance: 80, deposit: 0, transferIn: 0, transferOut: 0 };
  const normalized = normalizeFinance([a, { ...a, balanceTotalSpend: 30, balance: 70 }]);
  assert.equal(normalized.conflicts.length, 1); assert.equal(normalized.records[0].ambiguous, true);
  const result = project(wallet(['A']), normalized.records);
  assert.equal(result.periodSpend, null); assert.equal(result.difference, null);
});
test('unknown-time conflicting record is not discarded in favor of timestamp', () => {
  const a = row('A', '2026-10-01', 20, 80);
  assert.equal(normalizeFinance([a, { ...row('A', '2026-10-01', 30, 70), updatedAt: null }]).conflicts.length, 1);
});
test('duplicate column order and monetary formatting do not invent conflicts', () => {
  const a = row('A', '2026-10-01', 20, 80), b = { ...a, columns: Object.fromEntries(Object.entries(a.columns).reverse().map(([k, v]) => [k, Number(v).toFixed(2)])) };
  const n = normalizeFinance([a, b]); assert.equal(n.conflicts.length, 0); assert.equal(n.duplicatesRemoved, 1);
});
test('all consumers can normalize twice without losing ambiguity', () => {
  const n = normalizeFinance([row('A', '2026-10-01', 20, 80), row('A', '2026-10-01', 30, 70)]);
  assert.equal(normalizeFinance(n.records).records[0].ambiguous, true);
});
test('invalid calendar dates and missing stable identity are disclosed', () => {
  assert.equal(normalizeFinance([{ date: '2026-10-01' }, { advertiserId: 'A', date: '2026-02-30' }]).invalidRecords.length, 2);
});
test('offline and repeated wallet ownership cannot pass', () => {
  const data = { wallets: [wallet(['A']), wallet(['A'])], financeRecords: [row('A', '2026-10-01', 20, 80)] };
  assert.ok(projectWallets(data, { now }).every(result => !result.complete));
  assert.equal(project(wallet(['A']), data.financeRecords, { offline: true }).complete, false);
});
const fundingData = () => ({ wallets: [wallet(['A'])], campaigns: [{ id: 'c', advertiserId: 'A' }], financeRecords: [row('A', '2026-10-01', 0, 100, { '总存入(元)': 110, '现金存入(元)': 100, '赠款存入(元)': 10 })], recharges: [
  { id: 'p', recordType: 'payment', status: '已付款', date: '2026-10-01', amount: 100, amountCurrency: 'CNY' },
  { id: 'r', recordType: 'recharge', status: '已充值', campaignId: 'c', date: '2026-10-01', baseAmount: 100, rebateAmount: 10, amount: 110, sourcePaymentId: 'p' }
] });
test('cash and grant are independently compared, equality is not receipt proof', () => {
  const result = projectFunding(fundingData());
  assert.equal(result.issues.length, 0); assert.equal(result.groups[0].difference, 0);
  assert.equal(result.groups[0].status, 'amount-only'); assert.equal(result.status, 'pending');
});
test('real cash mismatch is visible', () => {
  const d = fundingData(); d.financeRecords[0].columns['现金存入(元)'] = 99; d.financeRecords[0].columns['总存入(元)'] = 109;
  const result = projectFunding(d); assert.equal(result.groups[0].difference, 1); assert.equal(result.groups[0].status, 'mismatch');
});
test('unknown cash breakdown cannot use total deposit as cash', () => {
  const d = fundingData(); delete d.financeRecords[0].columns['现金存入(元)'];
  assert.equal(projectFunding(d).groups[0].difference, null);
});
test('unassigned ledger does not get guessed by broker name', () => {
  const d = fundingData(); delete d.recharges[1].campaignId; d.recharges[1].broker = 'same broker';
  const result = projectFunding(d); assert.equal(result.unallocated, 1); assert.equal(result.groups[0].difference, null);
  assert.ok(result.issues.some(row => /猜分摊/.test(row.reason)));
});
test('shared wallet cannot be reconciled with advertiser deposits', () => {
  const d = fundingData(); d.wallets[0].kind = 'shared';
  assert.equal(projectFunding(d).unallocated, 1);
});
test('missing payment, wrong currency, duplicate references and splits are disclosed', () => {
  const d = fundingData(); d.recharges[0].amountCurrency = 'USD'; d.recharges[1].reference = 'flow'; d.recharges.push({ ...d.recharges[1], id: 'r2' });
  const result = projectFunding(d);
  assert.ok(result.issues.some(row => /人民币/.test(row.reason)));
  assert.ok(result.issues.some(row => /重复到账/.test(row.reason)));
  assert.ok(result.issues.some(row => /拆分/.test(row.reason)));
  assert.equal(result.groups[0].difference, null);
});
test('funding and wallet projections preserve all input business data', () => {
  const d = fundingData(), before = JSON.stringify(d); projectFunding(d); projectWallets(d, { now }); assert.equal(JSON.stringify(d), before);
});
