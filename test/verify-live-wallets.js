"use strict";
// Read-only production acceptance. Never prints credentials or writes business data.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { projectWallets, defaultFinanceRange } = require("../wallet-summary");

async function main() {
  const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
  const configBlock = source.match(/const CLOUD_CONFIG = Object\.freeze\(\{([\s\S]*?)\}\);/)[1];
  const url = configBlock.match(/url:\s*"([^"]+)"/)[1];
  const key = configBlock.match(/publishableKey:\s*"([^"]+)"/)[1];
  assert.equal(url, "https://mabxdkjqilulkrmqrrgo.supabase.co");
  const response = await fetch(`${url}/rest/v1/app_data?select=data&id=eq.2`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store", signal: AbortSignal.timeout(20000)
  });
  assert.equal(response.status, 200);
  const [document] = await response.json();
  assert.ok(document?.data?.financeRecords?.length);
  const before = JSON.stringify(document.data);
  const projections = projectWallets(document.data);
  assert.equal(JSON.stringify(document.data), before);
  for (const row of projections) {
    if (row.wallet.kind === "shared") assert.equal(row.difference, null);
    if (row.balanceStatus === "daily") assert.equal(row.balanceDate, row.endDate);
  }
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(), financeRows: document.data.financeRecords.length,
    defaultDateRange: defaultFinanceRange(document.data.financeRecords), sourceUnchanged: true,
    wallets: projections.map(row => ({ broker: row.wallet.broker, kind: row.wallet.kind,
      settledThrough: row.endDate, records: row.recordCount,
      accounts: `${row.coveredAccountCount}/${row.accountCount}`,
      balance: row.balance, balanceStatus: row.balanceStatus, balanceReadAt: row.balanceReadAt,
      periodCredit: row.periodCredit, periodSpend: row.periodSpend, difference: row.difference,
      complete: row.complete
    }))
  }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
