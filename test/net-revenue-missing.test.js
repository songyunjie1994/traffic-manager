const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
const section = code.slice(code.indexOf('function recordMetrics('), code.indexOf('function renderRecords('));
const context = vm.createContext({});
vm.runInContext(section, context);
test('missing net values remain unknown, true zero remains zero, and mixed groups cannot silently understate totals', () => {
  const base = {date:'2026-10-14',douyinName:'A',douyinNumber:'123',spend:100,revenue:1000};
  assert.equal(context.recordMetrics(base).netRevenue, null);
  assert.equal(context.recordMetrics({...base,netRevenue:0}).netRevenue, 0);
  assert.equal(context.recordMetrics({...base,netRevenue:800,netRoi:0}).netRoi, 8);
  const group = context.displayRecordGroups([{...base,netRevenue:800},{...base,netRevenue:null}])[0];
  assert.equal(group.netRevenue, null);
  assert.equal(group.netRoi, null);
});
