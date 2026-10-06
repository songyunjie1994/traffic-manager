const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const refresh = source.slice(source.indexOf("async function refreshCloudState()"), source.indexOf("async function saveState()"));
function context(overrides = {}) {
  const value = {
    cloudReady: true, cloudInitializationFinished: true, cloudRefreshInFlight: false, cloudSaveInFlight: false,
    lastCloudRefreshAt: 0, lastCloudSnapshot: "old", lastCloudRawState: { old: true }, state: { old: true },
    modal: false, statuses: [], renders: 0, writes: 0,
    $$() { return this?.modal ? [1] : []; },
    setCloudStatus(state, text) { value.statuses.push([state, text]); },
    normalizeState(data) { return { ...data }; },
    $() { return value.badge; }, badge: { textContent: "云端数据" },
    cacheState() {}, renderAll() { value.renders++; }, renderWallets() { value.renders++; },
    readCloudDocument: async () => ({ financeRecords: [{ date: "2026-10-01" }] }),
    updateCloudState: async () => { value.writes++; },
    Date, JSON, structuredClone, console: { error() {} }, ...overrides
  };
  value.$$ = () => value.modal ? [1] : [];
  vm.createContext(value);
  vm.runInContext(refresh, value);
  return value;
}
test("passive refresh reads fresh finance and never writes any cloud document", async () => {
  const value = context();
  await value.refreshCloudState();
  assert.equal(value.state.financeRecords[0].date, "2026-10-01");
  assert.equal(value.writes, 0);
  assert.equal(value.cloudReady, true);
  assert.equal(value.cloudRefreshInFlight, false);
});
test("in-flight refresh won't replace editor state or CAS base after modal opens", async () => {
  const value = context();
  value.readCloudDocument = async () => { value.modal = true; return { newer: true }; };
  await value.refreshCloudState();
  assert.equal(value.state.old, true);
  assert.equal(value.lastCloudRawState.old, true);
  assert.equal(value.writes, 0);
});
test("in-flight refresh won't replace state after a save starts or completes", async () => {
  for (const change of [v => { v.cloudSaveInFlight = true; }, v => { v.lastCloudSnapshot = "saved"; }]) {
    const value = context();
    value.readCloudDocument = async () => { change(value); return { newer: true }; };
    await value.refreshCloudState();
    assert.equal(value.state.old, true);
    assert.equal(value.lastCloudRawState.old, true);
  }
});
test("network failure preserves financial data and flags offline cache", async () => {
  const value = context({ readCloudDocument: async () => { throw new Error("offline"); } });
  await value.refreshCloudState();
  assert.equal(value.state.old, true);
  assert.equal(value.cloudReady, false);
  assert.equal(value.badge.textContent, "本地缓存");
  assert.equal(value.cloudRefreshInFlight, false);
});
test("offline cache recovers with read-only refresh", async () => {
  const value = context({ cloudReady: false });
  await value.refreshCloudState();
  assert.equal(value.cloudReady, true);
  assert.equal(value.writes, 0);
});
test("overlapping refreshes, saves, editor and initialization are skipped", async () => {
  for (const overrides of [{ cloudRefreshInFlight: true }, { cloudSaveInFlight: true }, { modal: true }, { cloudInitializationFinished: false }]) {
    const value = context({ ...overrides, readCloudDocument: async () => { throw new Error("must not fetch"); } });
    await value.refreshCloudState();
    assert.equal(value.renders, 0);
    assert.equal(value.state.old, true);
  }
});
test("browser timer only refreshes visible page, with a bounded read timeout", () => {
  assert.match(source, /setInterval\(\(\) => \{\s*if \(!document\.hidden && financeAuth\.hasSession\(\)\) refreshCloudState\(\);\s*\}, 60000\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '../finance-auth.js'), 'utf8'), /signal: AbortSignal\.timeout\(15000\)/);
});
