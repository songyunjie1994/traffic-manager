const { test } = require("node:test");
const assert = require("node:assert/strict");
const { amount, validDate, projectWallets, defaultFinanceRange } = require("../wallet-summary");

const now = Date.parse("2026-10-02T12:00:00Z");
const wallet = (overrides = {}) => ({ kind: "self", openingDate: "2026-09-30", openingBalance: 100, accounts: [{ advertiserId: "1872570326520138", openingDate: "2026-09-30", openingBalance: 100 }], ...overrides });
const row = (date = "2026-10-01", overrides = {}) => ({
  advertiserId: "1872570326520138", date, sourceRangeStart: "2026-09-30", sourceRangeEnd: "2026-10-02", sourceRunId: "verified-run",
  updatedAt: "2026-10-02T10:00:00Z", columns: { "余额总消耗(元)": "20.00", "共享钱包消耗(元)": "0.00", "总余额(元)": "80.00", "总存入(元)": "0.00", "总转入(元)": "0.00", "总转出(元)": "0.00" }, ...overrides
});
const project = (w, rows, options = {}) => projectWallets({ wallets: [w], financeRecords: rows, walletsUpdatedAt: "2026-09-29T15:17:39.989Z" }, { now, ...options })[0];

test("amounts reject blanks, dashes, booleans, invalid grouping and unsafe amounts", () => {
  for (const value of [null, undefined, "", "--", "NaN", true, "12,34", "Infinity", "9007199254740999", "0junk", "1.234"]) assert.equal(amount(value), null);
  assert.equal(amount("¥1,234.56元"), 1234.56);
  assert.equal(amount("0.00"), 0);
});
test("dates validate actual calendar days", () => {
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2026-10-01"), true);
});
test("self wallet derives latest actual daily balance, not old stored summary", () => {
  const result = project(wallet({ balance: 999, difference: 999, periodSpend: 999 }), [row()]);
  assert.equal(result.balance, 80);
  assert.equal(result.balanceDate, "2026-10-01");
  assert.equal(result.periodSpend, 20);
  assert.equal(result.difference, 0);
});
test("net credit includes deposits, grants and both transfer directions", () => {
  const result = project(wallet(), [row("2026-10-01", { columns: { ...row().columns, "总存入(元)": "20.00", "总转入(元)": "30.00", "总转出(元)": "5.00", "总余额(元)": "125.00" } })]);
  assert.equal(result.periodCredit, 45);
  assert.equal(result.difference, 0);
});

test("legacy daily balance without a read timestamp doesn't invent a 1970 timestamp", () => {
  assert.equal(project(wallet(), [row("2026-10-01", { updatedAt: null })]).balanceReadAt, null);
});

test("missing shared balance has no invented wallet archive read time", () => {
  const result = project(wallet({ kind: "shared", balance: null }), [row()]);
  assert.equal(result.balanceReadAt, null);
  assert.equal(result.balanceDate, null);
});

test("invalid shared snapshot timestamp is disclosed as unavailable", () => {
  const result = project(wallet({ kind: "shared", balanceLive: 50, liveReadAt: "invalid" }), [row()]);
  assert.equal(result.balanceReadAt, null);
  assert.equal(result.balanceStatus, "stale");
});
test("request range cannot certify sparse financial dates or add zero rows", () => {
  const source = [row()];
  const before = JSON.stringify(source);
  const result = project(wallet({ openingDate: "2026-09-29" }), source);
  assert.equal(result.complete, false);
  assert.equal(result.coverageComplete, false);
  assert.equal(JSON.stringify(source), before);
  assert.equal(source.length, 1);
});
test("unverified missing days suppress differences instead of declaring zero", () => {
  const result = project(wallet({ openingDate: "2026-09-29" }), [row("2026-10-01", { sourceRunId: null })]);
  assert.equal(result.complete, false);
  assert.equal(result.difference, null);
});
test("missing wallet accounts don't silently count as zero", () => {
  const result = project(wallet({ accounts: [...wallet().accounts, { advertiserId: "another" }] }), [row()]);
  assert.equal(result.coveredAccountCount, 1);
  assert.equal(result.accountCount, 2);
  assert.equal(result.balance, null);
  assert.equal(result.difference, null);
});
test("empty finance doesn't use stale summaries as new zero data", () => {
  const result = project(wallet({ balance: 0, periodSpend: 0 }), []);
  assert.equal(result.periodSpend, null);
  assert.equal(result.balance, null);
  assert.equal(result.difference, null);
});
test("missing or invalid spend and balance fields are not zero", () => {
  const result = project(wallet(), [row("2026-10-01", { columns: { ...row().columns, "余额总消耗(元)": "--", "总余额(元)": "--" } })]);
  assert.equal(result.periodSpend, null);
  assert.equal(result.balance, null);
  assert.equal(result.difference, null);
});
test("missing transfer fields suppress net credit and difference", () => {
  const result = project(wallet(), [row("2026-10-01", { columns: { "余额总消耗(元)": "0.00", "总余额(元)": "100.00" } })]);
  assert.equal(result.periodCredit, null);
  assert.equal(result.difference, null);
});
test("shared wallet uses shared spend only, never advertiser balance or grant spend", () => {
  const result = project(wallet({ kind: "shared", balanceLive: 77, liveReadAt: "2026-09-28T00:28:43Z", difference: -49421.7 }), [row("2026-10-01", { columns: { ...row().columns, "共享钱包消耗(元)": "12.34" } })]);
  assert.equal(result.periodSpend, 12.34);
  assert.equal(result.balance, 77);
  assert.equal(result.periodCredit, null);
  assert.equal(result.balanceStatus, "stale");
  assert.equal(result.difference, null);
});
test("fresh shared snapshot is recent but never a fabricated closed-day reconciliation", () => {
  const result = project(wallet({ kind: "shared", balanceLive: 0, liveReadAt: new Date(now - 60000).toISOString() }), [row()]);
  assert.equal(result.balanceStatus, "recent");
  assert.equal(result.balance, 0);
  assert.equal(result.difference, null);
});
test("offline shared snapshot cannot be classified fresh", () => {
  const result = project(wallet({ kind: "shared", balanceLive: 0, liveReadAt: new Date(now - 60000).toISOString() }), [row()], { offline: true });
  assert.equal(result.balanceStatus, "stale");
  assert.match(result.messages[0], /缓存/);
});
test("future snapshot timestamp doesn't pass freshness check", () => {
  assert.equal(project(wallet({ kind: "shared", balanceLive: 0, liveReadAt: new Date(now + 60000).toISOString() }), [row()]).balanceStatus, "stale");
});
test("snapshot without read timestamp is stale and disclosed", () => {
  const result = project(wallet({ kind: "shared", balanceLive: 0 }), [row()]);
  assert.equal(result.balanceReadAt, null);
  assert.equal(result.balanceStatus, "stale");
});
test("unknown shared balance stays null instead of extrapolating from credits", () => {
  const result = project(wallet({ kind: "shared", periodCredit: 1000 }), [row()]);
  assert.equal(result.balance, null);
  assert.equal(result.balanceStatus, "missing");
});
test("no-wallet accounts aren't added to a shared wallet's debit total", () => {
  const result = project(wallet({ kind: "shared", noWalletAccounts: [{ advertiserId: "unbound" }] }), [row(), row("2026-10-01", { advertiserId: "unbound", columns: { ...row().columns, "共享钱包消耗(元)": "1000.00" } })]);
  assert.equal(result.accountCount, 1);
  assert.equal(result.periodSpend, 0);
});
test("latest duplicate is used once, never double counts", () => {
  const result = project(wallet(), [row("2026-10-01", { updatedAt: "2026-10-02T09:00:00Z" }), row("2026-10-01", { columns: { ...row().columns, "余额总消耗(元)": "10.00", "总余额(元)": "90.00" } })]);
  assert.equal(result.periodSpend, 10);
  assert.equal(result.difference, 0);
  assert.equal(result.recordCount, 1);
});
test("conflicting same-time duplicates suppress apparent reconciliation", () => {
  const result = project(wallet(), [row(), row("2026-10-01", { columns: { ...row().columns, "余额总消耗(元)": "10.00" } })]);
  assert.equal(result.periodSpend, null);
  assert.equal(result.difference, null);
});
test("same-date close required for every self account", () => {
  const result = project(wallet({ accounts: [...wallet().accounts, { advertiserId: "other" }] }), [row(), row("2026-09-30", { advertiserId: "other" })]);
  assert.equal(result.balance, null);
  assert.equal(result.difference, null);
});
test("current day isn't accepted as settled finance even if accidentally present", () => {
  const result = project(wallet(), [row(), row("2026-10-02", { columns: { ...row().columns, "余额总消耗(元)": "1000.00" } })]);
  assert.equal(result.endDate, "2026-10-01");
  assert.equal(result.periodSpend, 20);
});
test("China midnight uses Chinese day, independent of execution timezone", () => {
  const result = project(wallet(), [row(), row("2026-10-02")], { now: Date.parse("2026-10-02T16:01:00Z") });
  assert.equal(result.endDate, "2026-10-02");
});
test("unknown opening date never guesses an August opening", () => {
  const result = project(wallet({ openingDate: undefined }), [row()]);
  assert.equal(result.startDate, null);
  assert.equal(result.periodSpend, null);
  assert.equal(result.difference, null);
});
test("default date range follows fresh cloud instead of stale first cache", () => {
  assert.deepEqual(defaultFinanceRange([row("2026-09-01"), row()]), { start: "2026-09-01", end: "2026-10-01" });
});
test("user-selected date filters (including cleared fields) survive cloud refresh", () => {
  assert.deepEqual(defaultFinanceRange([row()], { startTouched: true, endTouched: true, start: "", end: "2026-09-20" }), { start: "", end: "2026-09-20" });
});
test("cloud input, recharge records and legacy wallet snapshots are never mutated", () => {
  const data = { wallets: [wallet()], financeRecords: [row()], walletSnapshots: [{ balance: 999 }], recharges: [{ amount: 123 }] };
  const before = JSON.stringify(data);
  projectWallets(data, { now });
  assert.equal(JSON.stringify(data), before);
});
