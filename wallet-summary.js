(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TrafficWalletSummary = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  // Read-only projections. Never save derived balances or missing dates to app_data.
  function validDate(value) {
    return /^20\d{2}-\d{2}-\d{2}$/.test(String(value || ""))
      && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
      && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  }

  function amount(value) {
    if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
    const text = String(value).trim().replace(/^[¥￥]\s*/, "").replace(/\s*元$/, "");
    if (!/^-?(?:\d+|\d{1,3}(?:[,，]\d{3})+)(?:\.\d{1,2})?$/.test(text)) return null;
    const cents = Math.round(Number(text.replace(/[,，]/g, "")) * 100);
    return Number.isSafeInteger(cents) ? cents / 100 : null;
  }

  function metric(record, field, column) {
    const value = record?.columns?.[column];
    return value === undefined ? amount(record?.[field]) : amount(value);
  }

  function rounded(value) { return Math.round(value * 100) / 100; }
  function shifted(date, days) {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  }
  function chinaDate(now) { return new Date(now + 8 * 3600000).toISOString().slice(0, 10); }
  function recordDate(record) { return String(record?.date || record?.columns?.日期 || ""); }
  function recordTime(record) {
    const value = Date.parse(record?.updatedAt || record?.createdAt || "");
    return Number.isFinite(value) ? value : 0;
  }

  function uniqueRecords(records, endDate) {
    const index = new Map();
    for (const record of records || []) {
      const date = recordDate(record);
      const id = String(record?.advertiserId || "");
      if (!id || !validDate(date) || date > endDate) continue;
      const key = `${id}|${date}`;
      const previous = index.get(key);
      if (!previous || recordTime(record) > recordTime(previous)) index.set(key, record);
      else if (recordTime(record) === recordTime(previous)
        && JSON.stringify(record.columns || {}) !== JSON.stringify(previous.columns || {})) {
        index.set(key, { ...record, columns: {}, ambiguous: true });
      }
    }
    return [...index.values()];
  }

  function sumMetric(records, field, column) {
    if (!records.length || records.some((record) => record.ambiguous)) return null;
    const values = records.map((record) => metric(record, field, column));
    return values.some((value) => value === null) ? null : rounded(values.reduce((total, value) => total + value, 0));
  }

  function coversRange(records, start, end) {
    if (!validDate(start) || !validDate(end) || end < start || Date.parse(end) - Date.parse(start) > 3660 * 86400000) return false;
    // A verified collected range can have sparse day rows; absence alone isn't zero.
    // Legacy/manual rows without a source range only attest their actual date.
    const ranges = records.filter((record) => !record.ambiguous).map((record) => {
      const from = record.sourceRangeStart;
      const to = record.sourceRangeEnd;
      const date = recordDate(record);
      return record.sourceRunId && validDate(from) && validDate(to) && from <= date && date <= to
        ? [from, to] : [date, date];
    });
    for (let date = start; date <= end; date = shifted(date, 1)) {
      if (!ranges.some(([from, to]) => from <= date && date <= to)) return false;
    }
    return true;
  }

  function projectWallet(wallet, records, endDate, now, offline, walletsUpdatedAt) {
    const accounts = Array.isArray(wallet.accounts) ? wallet.accounts : [];
    const ids = [...new Set(accounts.map((account) => String(account?.advertiserId || "")).filter(Boolean))];
    const openingDate = validDate(wallet.openingDate) ? wallet.openingDate : null;
    const startDate = openingDate ? shifted(openingDate, 1) : null;
    const allRows = records.filter((record) => ids.includes(String(record.advertiserId)));
    const periodRows = startDate && endDate ? allRows.filter((record) => recordDate(record) >= startDate && recordDate(record) <= endDate) : [];
    const coveredIds = new Set(periodRows.map((record) => String(record.advertiserId)));
    const shared = wallet.kind === "shared";
    const periodSpend = sumMetric(periodRows, shared ? "sharedWalletSpend" : "balanceTotalSpend", shared ? "共享钱包消耗(元)" : "余额总消耗(元)");
    const latestReadAt = Math.max(0, ...periodRows.map(recordTime));
    const complete = ids.length > 0 && ids.every((id) => coversRange(periodRows.filter((record) => String(record.advertiserId) === id), startDate, endDate));
    const messages = [];
    if (!startDate) messages.push("缺少有效期初日期");
    if (!periodRows.length) messages.push("没有可核验的财务日结，不按零处理");
    if (!complete) messages.push(`已采 ${coveredIds.size}/${ids.length} 个挂靠账户；未核验范围不按零处理`);
    if (periodRows.length && periodSpend === null) messages.push("消耗字段缺失或冲突，待核验");

    let periodCredit = null;
    let balance = null;
    let balanceDate = null;
    let balanceReadAt = null;
    let difference = null;
    let balanceStatus = "missing";
    if (!shared) {
      const deposits = sumMetric(periodRows, "deposit", "总存入(元)");
      const transfersIn = sumMetric(periodRows, "transferIn", "总转入(元)");
      const transfersOut = sumMetric(periodRows, "transferOut", "总转出(元)");
      if ([deposits, transfersIn, transfersOut].every((value) => value !== null)) {
        periodCredit = rounded(deposits + transfersIn - transfersOut);
      } else if (periodRows.length) messages.push("存入/转入/转出字段未齐，不能核算净入金");
      const closingRows = ids.map((id) => allRows.find((record) => String(record.advertiserId) === id && recordDate(record) === endDate));
      if (ids.length && closingRows.every(Boolean)) {
        balance = sumMetric(closingRows, "balance", "总余额(元)");
        if (balance !== null) {
          balanceDate = endDate;
          balanceStatus = "daily";
          const closingReadTime = Math.max(...closingRows.map(recordTime));
          balanceReadAt = closingReadTime ? new Date(closingReadTime).toISOString() : null;
        }
      }
      if (balance === null) messages.push("同一天的账户收盘余额未齐");
      const opening = amount(wallet.openingBalance ?? wallet.balanceAug31);
      if (complete && [opening, periodCredit, periodSpend, balance].every((value) => value !== null)) {
        difference = rounded(opening + periodCredit - periodSpend - balance);
      }
    } else {
      // Account day-end balances and deposits belong to the advertiser, NOT to
      // its shared wallet. Do not turn them into a wallet balance or credit.
      balance = amount(wallet.balanceLive);
      balanceReadAt = wallet.liveReadAt || null;
      if (balance === null) {
        balance = amount(wallet.balance);
        balanceReadAt = balance === null ? null : walletsUpdatedAt || null;
      }
      const timestamp = Date.parse(balanceReadAt || "");
      if (!Number.isFinite(timestamp)) balanceReadAt = null;
      balanceDate = Number.isFinite(timestamp) ? chinaDate(timestamp) : null;
      const age = now - timestamp;
      balanceStatus = balance === null ? "missing"
        : !offline && Number.isFinite(timestamp) && age >= 0 && age <= 5 * 60000 ? "recent" : "stale";
      messages.push(balanceStatus === "missing" ? "共享钱包余额未采到" : balanceStatus === "stale" ? "旧钱包余额快照，不能作为当前余额" : "近期钱包余额快照，不是日结余额");
      messages.push("共享钱包入金流水与同口径余额未核验，差额待核验");
    }
    if (offline) messages.unshift("云端未连接，当前为缓存数据");
    return {
      wallet, startDate, endDate, periodSpend, periodCredit, balance, balanceDate, balanceReadAt,
      balanceStatus, difference, complete, coveredAccountCount: coveredIds.size, accountCount: ids.length,
      recordCount: periodRows.length, latestReadAt: latestReadAt ? new Date(latestReadAt).toISOString() : null,
      messages
    };
  }

  function projectWallets(data, options = {}) {
    const now = options.now ?? Date.now();
    const settledDay = shifted(chinaDate(now), -1);
    const records = uniqueRecords(Array.isArray(data.financeRecords) ? data.financeRecords : [], settledDay);
    const endDate = records.map(recordDate).sort().at(-1) || null;
    return (Array.isArray(data.wallets) ? data.wallets : []).map((wallet) => projectWallet(wallet, records, endDate, now, Boolean(options.offline), data.walletsUpdatedAt));
  }

  function defaultFinanceRange(records, selection = {}) {
    const dates = (records || []).map(recordDate).filter(validDate).sort();
    return {
      start: selection.startTouched ? selection.start || "" : dates[0] || "",
      end: selection.endTouched ? selection.end || "" : dates.at(-1) || ""
    };
  }

  return { amount, validDate, projectWallets, defaultFinanceRange };
});
