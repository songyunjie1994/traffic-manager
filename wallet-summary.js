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
    if (record?.ambiguous) return null;
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

  function identity(record) {
    return String(record?.advertiserId || record?.campaignId || "").trim();
  }
  function financialSignature(record) {
    const fields = {
      "余额总消耗(元)": "balanceTotalSpend", "共享钱包消耗(元)": "sharedWalletSpend",
      "非赠款消耗(元)": "nonGrantSpend", "赠款消耗(元)": "giftSpend",
      "总余额(元)": "balance", "总存入(元)": "deposit", "总转入(元)": "transferIn",
      "总转出(元)": "transferOut", "非赠款余额(元)": "nonGrantBalance", "赠款余额(元)": "giftBalance",
      "现金存入(元)": "cashDeposit", "赠款存入(元)": "giftDeposit"
    };
    const keys = [...new Set([...Object.keys(fields), ...Object.keys(record.columns || {}).filter(key => key !== "日期")])].sort();
    return JSON.stringify(keys.map(key => {
      const raw = record.columns?.[key] === undefined ? record[fields[key]] : record.columns[key];
      return [key, amount(raw) ?? (raw === undefined ? null : String(raw).trim())];
    }));
  }
  // One identity policy shared by the page, account totals, exports and wallets.
  // Equal/unknown-time conflicting versions must never silently select an amount.
  function normalizeFinance(records, endDate = "2099-12-31") {
    const index = new Map(), invalidRecords = [];
    for (const record of records || []) {
      const date = recordDate(record);
      const id = identity(record);
      if (!id || !validDate(date)) { invalidRecords.push(record); continue; }
      if (date > endDate) continue;
      const key = `${id}|${date}`;
      index.set(key, [...(index.get(key) || []), record]);
    }
    const result = [], conflicts = [];
    let duplicatesRemoved = 0;
    for (const [key, versions] of index) {
      duplicatesRemoved += versions.length - 1;
      const latestTime = Math.max(...versions.map(recordTime));
      const candidates = versions.filter(record => recordTime(record) === latestTime || recordTime(record) === 0);
      const conflict = candidates.some(record => record.ambiguous) || new Set(candidates.map(financialSignature)).size > 1;
      const selected = versions.find(record => recordTime(record) === latestTime);
      result.push(conflict ? { ...selected, date: recordDate(selected), ambiguous: true, conflictVersions: versions.length } : selected);
      if (conflict) conflicts.push(key);
    }
    return { records: result, conflicts, invalidRecords, duplicatesRemoved };
  }

  function sumMetric(records, field, column) {
    if (!records.length || records.some((record) => record.ambiguous)) return null;
    const values = records.map((record) => metric(record, field, column));
    return values.some((value) => value === null) ? null : rounded(values.reduce((total, value) => total + value, 0));
  }

  function coversRange(records, start, end) {
    if (!validDate(start) || !validDate(end) || end < start || Date.parse(end) - Date.parse(start) > 3660 * 86400000) return false;
    // A request range is NOT a financial coverage certificate. Sparse days stay
    // pending until independently attested; never create zero rows for gaps.
    const dates = new Set(records.filter(record => !record.ambiguous).map(recordDate));
    for (let date = start; date <= end; date = shifted(date, 1)) {
      if (!dates.has(date)) return false;
    }
    return true;
  }

  function accountCheck(account, rows, openingDate, startDate, endDate) {
    const advertiserId = String(account.advertiserId || "");
    const all = rows.filter(row => String(row.advertiserId) === advertiserId).sort((a, b) => recordDate(a).localeCompare(recordDate(b)));
    const period = all.filter(row => startDate && recordDate(row) >= startDate && recordDate(row) <= endDate);
    const errors = [], missingDates = [];
    if (startDate && endDate && Date.parse(endDate) - Date.parse(startDate) <= 3660 * 86400000) {
      const dates = new Set(period.filter(row => !row.ambiguous).map(recordDate));
      for (let date = startDate; date <= endDate; date = shifted(date, 1)) if (!dates.has(date)) missingDates.push(date);
    }
    const movements = row => {
      const values = [metric(row, "deposit", "总存入(元)"), metric(row, "transferIn", "总转入(元)"), metric(row, "transferOut", "总转出(元)"), metric(row, "balanceTotalSpend", "余额总消耗(元)")];
      return values.includes(null) ? null : rounded(values[0] + values[1] - values[2] - values[3]);
    };
    const openingRow = all.find(row => recordDate(row) === openingDate);
    let opening = openingRow ? metric(openingRow, "balance", "总余额(元)") : null;
    let openingSource = opening !== null ? "platform" : "missing";
    if (opening === null && account.openingDate === openingDate) {
      opening = amount(account.openingBalance);
      if (opening !== null) openingSource = "account";
    }
    if (opening === null && period.length && recordDate(period[0]) === startDate) {
      const closing = metric(period[0], "balance", "总余额(元)"), movement = movements(period[0]);
      if (closing !== null && movement !== null) { opening = rounded(closing - movement); openingSource = "inferred"; }
    }
    let previousBalance = opening, previousDate = openingDate, transitions = 0, unknownDays = 0;
    for (const row of period) {
      const date = recordDate(row), closing = metric(row, "balance", "总余额(元)"), movement = movements(row);
      if (closing === null || movement === null || row.ambiguous) unknownDays++;
      if (previousDate && date === shifted(previousDate, 1) && previousBalance !== null && closing !== null && movement !== null) {
        const difference = rounded(previousBalance + movement - closing);
        transitions++;
        if (difference !== 0) errors.push({ date, type: "dailyBalance", difference });
      }
      for (const [totalField, totalColumn, aField, aColumn, bField, bColumn, type] of [
        ["balance", "总余额(元)", "nonGrantBalance", "非赠款余额(元)", "giftBalance", "赠款余额(元)", "balanceComponents"],
        ["balanceTotalSpend", "余额总消耗(元)", "nonGrantSpend", "非赠款消耗(元)", "giftSpend", "赠款消耗(元)", "spendComponents"]
      ]) {
        const values = [metric(row, totalField, totalColumn), metric(row, aField, aColumn), metric(row, bField, bColumn)];
        if (!values.includes(null)) {
          const difference = rounded(values[0] - values[1] - values[2]);
          if (difference !== 0) errors.push({ date, type, difference });
        }
      }
      previousBalance = closing; previousDate = date;
    }
    const complete = coversRange(period, startDate, endDate) && unknownDays === 0;
    const closingRow = period.find(row => recordDate(row) === endDate);
    const closing = closingRow ? metric(closingRow, "balance", "总余额(元)") : null;
    const net = period.map(movements);
    const difference = complete && opening !== null && closing !== null && !net.includes(null) ? rounded(opening + net.reduce((sum, value) => sum + value, 0) - closing) : null;
    return { advertiserId, name: account.name || advertiserId, opening, openingSource, closing, difference,
      complete, missingDates, errors, transitions, unknownDays,
      status: errors.length || (difference !== null && difference !== 0) ? "mismatch"
        : complete && difference === 0 && ["account", "platform"].includes(openingSource) ? "balanced" : "pending" };
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
    const coverageComplete = ids.length > 0 && ids.every((id) => coversRange(periodRows.filter((record) => String(record.advertiserId) === id), startDate, endDate));
    const accountChecks = shared ? [] : accounts.map(account => accountCheck(account, records, openingDate, startDate, endDate));
    let complete = false, aggregateDifference = null;
    const messages = [];
    if (!startDate) messages.push("缺少有效期初日期");
    if (!periodRows.length) messages.push("没有可核验的财务日结，不按零处理");
    if (!coverageComplete) messages.push(`已采 ${coveredIds.size}/${ids.length} 个挂靠账户；日期缺口/冲突未核验，不按零处理`);
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
      if (coverageComplete && [opening, periodCredit, periodSpend, balance].every((value) => value !== null)) {
        aggregateDifference = rounded(opening + periodCredit - periodSpend - balance);
      }
      complete = !offline && aggregateDifference === 0 && accountChecks.length > 0 && accountChecks.every(check => check.status === "balanced");
      if (complete) difference = aggregateDifference;
      else if (aggregateDifference !== null && aggregateDifference !== 0) difference = aggregateDifference;
      const mismatches = accountChecks.filter(check => check.status === "mismatch");
      const inferred = accountChecks.filter(check => check.openingSource === "inferred");
      if (mismatches.length) messages.push(`${mismatches.length} 个账户余额核验异常；不以正负抵消后的汇总判通过`);
      if (inferred.length) messages.push(`${inferred.length} 个账户期初仅由首日日结反推，尚缺独立期初凭据`);
      if (aggregateDifference === 0 && !complete) messages.push("仅钱包汇总差额为0，不代表逐账户核验通过");
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
      balanceStatus, difference, aggregateDifference, complete, coverageComplete, accountChecks,
      reconciliationStatus: accountChecks.some(check => check.status === "mismatch") || (difference !== null && difference !== 0) ? "mismatch" : complete ? "balanced" : "pending",
      coveredAccountCount: coveredIds.size, accountCount: ids.length,
      recordCount: periodRows.length, latestReadAt: latestReadAt ? new Date(latestReadAt).toISOString() : null,
      messages
    };
  }

  function projectWallets(data, options = {}) {
    const now = options.now ?? Date.now();
    const settledDay = shifted(chinaDate(now), -1);
    const records = normalizeFinance(Array.isArray(data.financeRecords) ? data.financeRecords : [], settledDay).records;
    const endDate = records.map(recordDate).sort().at(-1) || null;
    const wallets = Array.isArray(data.wallets) ? data.wallets : [];
    const owners = new Map();
    for (const wallet of wallets) for (const account of wallet.accounts || []) owners.set(String(account.advertiserId), (owners.get(String(account.advertiserId)) || 0) + 1);
    return wallets.map(wallet => {
      const result = projectWallet(wallet, records, endDate, now, Boolean(options.offline), data.walletsUpdatedAt);
      if ((wallet.accounts || []).some(account => owners.get(String(account.advertiserId)) > 1)) {
        result.complete = false; result.difference = null; result.reconciliationStatus = "pending";
        result.messages.push("账户重复挂靠钱包，归属待确认");
      }
      return result;
    });
  }

  function defaultFinanceRange(records, selection = {}) {
    const dates = (records || []).map(recordDate).filter(validDate).sort();
    return {
      start: selection.startTouched ? selection.start || "" : dates[0] || "",
      end: selection.endTouched ? selection.end || "" : dates.at(-1) || ""
    };
  }

  // Payment -> recharge registration -> advertiser cash deposit are different
  // events. Amount equality is a candidate, never proof of a bank/platform flow.
  function projectFunding(data, options = {}) {
    const finance = normalizeFinance(data.financeRecords || []).records.filter(row => (!options.start || recordDate(row) >= options.start) && (!options.end || recordDate(row) <= options.end));
    const ledger = (data.recharges || []).filter(row => (!options.start || row.date >= options.start) && (!options.end || row.date <= options.end));
    const payments = new Map((data.recharges || []).filter(row => row.recordType === "payment").map(row => [row.id, row]));
    const groups = new Map(), issues = [], references = new Set();
    const campaigns = new Map((data.campaigns || []).map(row => [row.id, row]));
    const accountWallets = new Map();
    for (const wallet of data.wallets || []) for (const account of wallet.accounts || []) accountWallets.set(String(account.advertiserId), [...(accountWallets.get(String(account.advertiserId)) || []), wallet]);
    const group = (id, date) => {
      const key = `${id}|${date}`;
      if (!groups.has(key)) groups.set(key, { advertiserId: id, date, name: id, registeredPrincipal: 0, registeredRebate: 0, registeredCash: 0, registeredGrant: 0, registeredTotal: 0, registrationCount: 0, issueCount: 0, platformDeposit: null, platformCash: null, platformGrant: null, difference: null, status: "pending" });
      return groups.get(key);
    };
    for (const row of finance) {
      const result = group(identity(row), recordDate(row));
      result.name = row.advertiserName || identity(row);
      result.platformDeposit = metric(row, "deposit", "总存入(元)");
      result.platformCash = metric(row, "cashDeposit", "现金存入(元)");
      result.platformGrant = metric(row, "giftDeposit", "赠款存入(元)");
      if (result.platformCash !== null && result.platformGrant !== null && result.platformDeposit !== null && rounded(result.platformCash + result.platformGrant - result.platformDeposit) !== 0) {
        issues.push({ id: row.id, date: row.date, reason: "平台现金/赠款存入合计不等于总存入" }); result.issueCount++;
      }
    }
    let unallocated = 0, paymentCount = 0;
    for (const row of ledger) {
      const type = row.recordType || "recharge";
      if (type === "payment") { paymentCount++; continue; }
      if (type !== "recharge") continue;
      const id = String(row.advertiserId || campaigns.get(row.campaignId)?.advertiserId || "");
      const wallets = accountWallets.get(id) || [];
      const problems = [];
      if (!validDate(row.date)) problems.push("充值日期无效");
      if (row.status !== "已充值" && row.status !== "已到账") problems.push("登记未确认到账，不计入已核验入金");
      if (row.amountCurrency && row.amountCurrency !== "CNY") problems.push("非人民币登记，需确认实际人民币到账");
      if (!id || wallets.length !== 1 || wallets[0].kind === "shared") {
        unallocated++;
        problems.push(!id ? "未指定广告账户/钱包，不能按中介名称猜分摊" : wallets.length !== 1 ? "账户钱包归属不唯一" : "共享钱包充值不能与广告账户存入混用");
      }
      const total = amount(row.amount), principal = amount(row.baseAmount), rebate = amount(row.rebateAmount);
      // Broker rebate is not necessarily a platform grant: it may arrive as
      // ordinary cash. Require an explicit credited cash/grant allocation.
      const cash = amount(row.cashCreditAmount), grant = amount(row.giftCreditAmount);
      if (total === null || principal === null || rebate === null || rounded(principal + rebate - total) !== 0) problems.push("登记本金/返点/总到账金额缺失或不一致");
      if (cash === null || grant === null || total === null || rounded(cash + grant - total) !== 0) problems.push("到账现金/平台赠款未明确拆分；中介返点不自动视为赠款");
      const ref = String(row.reference || "").trim();
      if (ref) {
        const key = `${id}|${ref}`;
        if (references.has(key)) problems.push("重复到账流水号");
        references.add(key);
      }
      if (row.sourcePaymentId) {
        const payment = payments.get(row.sourcePaymentId);
        if (!payment || payment.status !== "已付款") problems.push("关联付款不存在或未确认付款");
        else if (payment.amountCurrency !== "CNY" || amount(payment.amount) !== principal) problems.push("关联付款人民币金额与登记本金不一致");
        if ((data.recharges || []).filter(other => other.recordType === "recharge" && other.sourcePaymentId === row.sourcePaymentId).length !== 1) problems.push("同一付款关联多笔充值，需要拆分凭据");
      } else problems.push("未关联付款凭证");
      if (id && validDate(row.date) && wallets.length === 1 && wallets[0].kind !== "shared") {
        const result = group(id, row.date);
        result.registrationCount++;
        result.issueCount += problems.length;
        result.registeredPrincipal = result.registeredPrincipal === null || principal === null ? null : rounded(result.registeredPrincipal + principal);
        result.registeredRebate = result.registeredRebate === null || rebate === null ? null : rounded(result.registeredRebate + rebate);
        result.registeredCash = result.registeredCash === null || cash === null ? null : rounded(result.registeredCash + cash);
        result.registeredGrant = result.registeredGrant === null || grant === null ? null : rounded(result.registeredGrant + grant);
        result.registeredTotal = result.registeredTotal === null || total === null ? null : rounded(result.registeredTotal + total);
      }
      for (const reason of problems) issues.push({ id: row.id, date: row.date, broker: row.broker || "", reason });
    }
    for (const payment of ledger.filter(row => row.recordType === "payment")) {
      if (!(data.recharges || []).some(row => row.recordType === "recharge" && row.sourcePaymentId === payment.id)) issues.push({ id: payment.id, date: payment.date, broker: payment.broker || "", reason: "已付款但未关联到账登记" });
    }
    for (const result of groups.values()) {
      if (!unallocated && result.platformCash !== null && result.registeredCash !== null && result.issueCount === 0) {
        result.difference = rounded(result.registeredCash - result.platformCash);
        result.status = result.difference !== 0 ? "mismatch" : "amount-only";
      }
    }
    return { groups: [...groups.values()], issues, unallocated, paymentCount, status: "pending",
      message: "现金到账与平台赠款分开，中介返点不自动视为赠款；未分配充值不猜分摊，金额一致也不是逐笔到账凭证。" };
  }

  return { amount, validDate, metric, recordTime, normalizeFinance, coversRange, projectWallets, projectFunding, defaultFinanceRange };
});
