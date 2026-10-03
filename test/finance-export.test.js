const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
function harness(records) {
  let output;
  const value = { TrafficWalletSummary: require('../wallet-summary'), state: { financeRecords: records }, cloudReady: true,
    campaignById: () => null, money: value => Number(value).toFixed(2), $: () => null,
    localDate: () => '2026-10-03', toast() {}, window: { TrafficExcel: { downloadWorkbook: (_name, sheets) => { output = sheets; } } } };
  vm.createContext(value);
  vm.runInContext(source.slice(source.indexOf('const FINANCE_COLUMN_ORDER'), source.indexOf('function renderDashboard()')), value);
  vm.runInContext(source.slice(source.indexOf('function exportFinanceExcel()'), source.indexOf('\nfunction ', source.indexOf('function exportFinanceExcel()') + 1)), value);
  return { value, export: () => { value.exportFinanceExcel(); return output; } };
}
const row = (columns = {}) => ({ date: '2026-10-02', advertiserId: '123', advertiserName: '测试', columns: {
  '余额总消耗(元)': 10, '共享钱包消耗(元)': 25.3, '非赠款消耗(元)': 10, '赠款消耗(元)': 0, '总余额(元)': 100, ...columns } });
test('finance export includes shared wallet spend in each account and grand total', () => {
  const sheets = harness([row()]).export();
  assert.deepEqual(Array.from(sheets[0].rows[0]).slice(0, 4), ['广告账户', '账户余额消耗', '共享钱包消耗', '财务总消耗']);
  assert.deepEqual(Array.from(sheets[0].rows[1]).slice(1, 4), [10, 25.3, 35.3]);
  assert.deepEqual(Array.from(sheets[0].rows.at(-1)).slice(1, 4), [10, 25.3, 35.3]);
  assert.equal(sheets[0].rows[1].length, sheets[0].rows[0].length);
});
test('missing/invalid finance is unknown, never a fabricated zero; explicit zero survives', () => {
  const h = harness([row({ '共享钱包消耗(元)': '--', '赠款余额(元)': 0 })]);
  for (const value of [undefined, null, '', '--', false, '错误123', Infinity]) assert.equal(h.value.financeNumber(value), null);
  assert.equal(h.value.financeNumber('0.00'), 0);
  assert.equal(h.value.financeNumber('1,234.50'), 1234.5);
  assert.equal(h.value.financeMoney(null), '待核验');
  assert.equal(h.value.financeMoney(0), '0.00');
  const sheets = h.export();
  assert.equal(sheets[0].rows[1][2], '');
  assert.equal(sheets[0].rows[1][3], '');
  assert.equal(sheets[0].rows[1][7], '');
  assert.equal(sheets[0].rows[1][8], 0);
  assert.equal(h.value.financeSum([], 'x', 'x'), null);
});
test('raw missing column cannot be overridden by a stale top-level zero', () => {
  const h = harness([]);
  assert.equal(h.value.financeMetric({ sharedWalletSpend: 0, columns: {'共享钱包消耗(元)': '--'} }, 'sharedWalletSpend', '共享钱包消耗(元)'), null);
  assert.equal(h.value.financeMetric({ sharedWalletSpend: 12.34 }, 'sharedWalletSpend', '共享钱包消耗(元)'), 12.34);
});
