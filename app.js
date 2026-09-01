"use strict";

const STORAGE_KEY = "traffic_manager_data_v1";
const APP_VERSION = "1.7.0";
const CLOUD_ROW_ID = 2;
const RECHARGE_WORKFLOW_VERSION = "2026-08-29-v1";
const REQUIRED_ACCOUNT_NAMES = ["杭州夕雾", "MELBOURNE", "江西井意", "浏阳市关口韵帆", "ISAMORVAN", "研汁工社"];
const RECHARGE_LEDGER_META = Object.freeze({
  recharge: { title: "充值记录", dateLabel: "充值日期", accountLabel: "充值账户", amountLabel: "充值金额", addLabel: "＋ 添加充值记录" },
  payment: { title: "付款记录", dateLabel: "付款日期", accountLabel: "付款方", amountLabel: "付款金额", addLabel: "＋ 上传付款截图" },
  pending: { title: "待付款", dateLabel: "登记日期", accountLabel: "待付款账户", amountLabel: "待付金额", addLabel: "" },
});
const ZHIPU_VISION_CONFIG = Object.freeze({
  endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  model: "glm-4v-flash",
  keyStorageKey: "traffic_manager_zhipu_api_key",
  defaultApiKey: "2850c4bd97444eaf832119a49e23f54a.OojmSYrwr05W6qKm",
});
const VISION_PROMPT = "这是付款或转账截图。请识别并只输出一个 JSON 对象，不要输出任何其他文字：{\"date\":\"YYYY-MM-DD\",\"amount\":数字,\"payer\":\"付款方名称\",\"payerBank\":\"付款方银行\",\"payerAccount\":\"付款方账号\",\"payee\":\"收款方名称\",\"payeeBank\":\"收款方银行\",\"payeeAccount\":\"收款方账号\"}。date 填截图中的交易日期（没有则填空字符串）；amount 填付款金额的纯数字，不含单位和千分位逗号；payer/payee 填付款方、收款方的户名或名称；银行填开户行或支付渠道名称（如：工商银行、支付宝、微信支付）；账号填银行卡号或支付账号；识别不到的字段一律填空字符串。";
const CLOUD_CONFIG = Object.freeze({
  url: "https://mabxdkjqilulkrmqrrgo.supabase.co",
  publishableKey: "sb_publishable_lfHpd1y1gCaQIDXfRkD_8w_O1bPMWGx",
});
const QIANCHUAN_CONFIG = Object.freeze({
  startUrl: `${CLOUD_CONFIG.url}/functions/v1/qianchuan-oauth-start`,
  dataUrl: `${CLOUD_CONFIG.url}/functions/v1/qianchuan-data`,
  dashboardKeyStorageKey: "traffic_manager_qianchuan_dashboard_key",
});
const PLATFORMS = ["巨量引擎", "千川", "小红书", "视频号", "快手", "百度", "其他"];
const VIEW_META = {
  dashboard: ["查看充值、消耗与账户余额汇总", "报表端"],
  campaigns: ["管理充值、付款与待付款记录", "充值端"],
  records: ["记录每日消耗和成交数据", "消耗端"],
  qianchuan: ["管理客户授权与千川账号接入", "千川授权"],
  backup: ["导出、恢复与管理云端数据", "数据备份"],
};

let state = loadState();
let confirmResolver = null;
let cloudReady = false;
let cloudInitializationPromise = null;
let lastCloudSnapshot = "";
let lastCloudRefreshAt = 0;
let activeRechargeLedger = "recharge";
let paymentOcrResult = null;
let qianchuanDashboardLoading = false;
let qianchuanPreferredCustomer = new URLSearchParams(window.location.search).get("customer") || "";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function localDate(offset = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function createDemoState() {
  const campaigns = [
    {
      id: "cmp-001",
      name: "夏季防晒新品放量",
      platform: "千川",
      account: "品牌旗舰店-主账户",
      objective: "商品成交",
      dailyBudget: 5000,
      targetRoi: 2.8,
      owner: "林晓",
      startDate: localDate(-18),
      status: "投放中",
      createdAt: new Date().toISOString(),
    },
    {
      id: "cmp-002",
      name: "达人素材冷启动测试",
      platform: "巨量引擎",
      account: "素材测试账户-02",
      objective: "商品成交",
      dailyBudget: 2800,
      targetRoi: 2.2,
      owner: "周楠",
      startDate: localDate(-12),
      status: "投放中",
      createdAt: new Date().toISOString(),
    },
    {
      id: "cmp-003",
      name: "品牌心智人群蓄水",
      platform: "小红书",
      account: "聚光-品牌号",
      objective: "品牌曝光",
      dailyBudget: 1600,
      targetRoi: 1.6,
      owner: "陈然",
      startDate: localDate(-24),
      status: "投放中",
      createdAt: new Date().toISOString(),
    },
    {
      id: "cmp-004",
      name: "直播间夜场追投",
      platform: "视频号",
      account: "视频号-直播矩阵",
      objective: "直播间成交",
      dailyBudget: 3200,
      targetRoi: 2.5,
      owner: "林晓",
      startDate: localDate(-9),
      status: "已暂停",
      createdAt: new Date().toISOString(),
    },
  ];

  const base = [
    [2120, 73800, 1660, 51, 7980],
    [2435, 81100, 1815, 58, 9020],
    [2288, 77500, 1722, 55, 8750],
    [2760, 92400, 2130, 67, 10460],
    [2940, 96300, 2205, 72, 11760],
    [3180, 102800, 2388, 78, 12620],
    [3475, 111600, 2604, 86, 13980],
  ];
  const records = [];

  base.forEach((day, dayIndex) => {
    const date = localDate(dayIndex - 6);
    const shares = [0.42, 0.31, 0.16, 0.11];
    campaigns.forEach((campaign, campaignIndex) => {
      const modifier = 1 + (campaignIndex - 1.5) * 0.025;
      const spend = Number((day[0] * shares[campaignIndex] * modifier).toFixed(2));
      const impressions = Math.round(day[1] * shares[campaignIndex]);
      const clicks = Math.round(day[2] * shares[campaignIndex]);
      const orders = Math.max(0, Math.round(day[3] * shares[campaignIndex] * modifier));
      let revenue = day[4] * shares[campaignIndex] * modifier;
      if (campaignIndex === 2) revenue *= dayIndex === 6 ? 0.53 : 0.76;
      if (campaignIndex === 1 && dayIndex === 6) revenue *= 0.8;
      records.push({
        id: `rec-${dayIndex}-${campaignIndex}`,
        date,
        campaignId: campaign.id,
        spend,
        impressions,
        clicks,
        leads: Math.round(clicks * 0.12),
        orders,
        revenue: Number(revenue.toFixed(2)),
        notes: dayIndex === 6 && campaignIndex === 2 ? "点击成本上涨，建议检查笔记素材衰退" : "",
        createdAt: new Date().toISOString(),
      });
    });
  });

  const recharges = [];

  return {
    version: APP_VERSION,
    demo: true,
    campaigns,
    recharges,
    records,
    settings: { initializedAt: new Date().toISOString() },
  };
}

function emptyState() {
  return {
    version: APP_VERSION,
    demo: false,
    campaigns: [],
    recharges: [],
    records: [],
    settings: { initializedAt: new Date().toISOString() },
  };
}

function normalizeState(candidate) {
  if (!candidate || !Array.isArray(candidate.campaigns) || !Array.isArray(candidate.records)) {
    throw new Error("文件不是有效的投流管理系统备份");
  }
  return {
    version: APP_VERSION,
    demo: Boolean(candidate.demo),
    campaigns: candidate.campaigns.map((item) => ({ ...item })),
    recharges: Array.isArray(candidate.recharges) ? candidate.recharges.map((item) => ({ ...item })) : [],
    records: candidate.records.map((item) => ({ ...item })),
    settings: candidate.settings && typeof candidate.settings === "object" ? candidate.settings : {},
  };
}

function migrateRechargeWorkflow(candidate) {
  const normalized = normalizeState(candidate);
  if (normalized.settings.rechargeWorkflowVersion === RECHARGE_WORKFLOW_VERSION) {
    return { state: normalized, changed: false };
  }

  const accountKeys = new Set(normalized.campaigns.flatMap((campaign) => [campaign.name, campaign.account]).filter(Boolean).map((value) => String(value).trim().toLowerCase()));
  const usedIds = new Set(normalized.campaigns.map((campaign) => campaign.id));
  const createdAt = new Date().toISOString();
  const additions = REQUIRED_ACCOUNT_NAMES.filter((name) => !accountKeys.has(name.toLowerCase())).map((name, index) => {
    let id = `cmp-account-${String(index + 1).padStart(2, "0")}`;
    while (usedIds.has(id)) id = `${id}-new`;
    usedIds.add(id);
    return {
      id,
      name,
      platform: "其他",
      account: name,
      objective: "账户充值",
      dailyBudget: 0,
      targetRoi: 0,
      owner: "",
      startDate: localDate(),
      status: "投放中",
      createdAt,
      updatedAt: createdAt,
    };
  });

  return {
    changed: true,
    state: normalizeState({
      ...normalized,
      demo: false,
      campaigns: [...normalized.campaigns, ...additions],
      recharges: [],
      settings: {
        ...normalized.settings,
        rechargeWorkflowVersion: RECHARGE_WORKFLOW_VERSION,
        rechargeWorkflowMigratedAt: createdAt,
      },
    }),
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeState(JSON.parse(saved));
  } catch (error) {
    console.warn("读取本地缓存失败，已加载演示数据", error);
  }
  const demo = createDemoState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(demo));
  return demo;
}

function cacheState(candidate = state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(candidate));
}

function setCloudStatus(status, label) {
  const indicator = $("#cloudSyncStatus");
  const text = $("#cloudSyncText");
  if (!indicator || !text) return;
  indicator.dataset.state = status;
  text.textContent = label;
}

function cloudHeaders(prefer = "") {
  const headers = {
    "Content-Type": "application/json",
    apikey: CLOUD_CONFIG.publishableKey,
    Authorization: `Bearer ${CLOUD_CONFIG.publishableKey}`,
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function fetchCloudState() {
  const response = await fetch(`${CLOUD_CONFIG.url}/rest/v1/app_data?select=data&id=eq.${CLOUD_ROW_ID}`, {
    headers: cloudHeaders(),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`云端读取失败（${response.status}）`);
  const rows = await response.json();
  return rows[0]?.data ? normalizeState(rows[0].data) : null;
}

async function createCloudState(candidate) {
  const migrated = normalizeState({
    ...candidate,
    settings: {
      ...candidate.settings,
      cloudInitializedAt: new Date().toISOString(),
      cloudSource: "traffic-manager",
    },
  });
  const response = await fetch(`${CLOUD_CONFIG.url}/rest/v1/app_data`, {
    method: "POST",
    headers: cloudHeaders("return=representation"),
    body: JSON.stringify({ id: CLOUD_ROW_ID, data: migrated }),
  });
  if (response.status === 409) return (await fetchCloudState()) || migrated;
  if (!response.ok) throw new Error(`云端初始化失败（${response.status}）`);
  const rows = await response.json();
  return rows[0]?.data ? normalizeState(rows[0].data) : migrated;
}

async function updateCloudState(candidate) {
  const response = await fetch(`${CLOUD_CONFIG.url}/rest/v1/app_data?id=eq.${CLOUD_ROW_ID}`, {
    method: "PATCH",
    headers: cloudHeaders("return=minimal"),
    body: JSON.stringify({ data: candidate }),
  });
  if (!response.ok) throw new Error(`云端保存失败（${response.status}）`);
}

async function initializeCloud() {
  setCloudStatus("syncing", "正在连接云端");
  try {
    const cloudState = await fetchCloudState();
    if (cloudState?.settings?.bootstrapPending) {
      const localMigration = migrateRechargeWorkflow({
        ...state,
        settings: {
          ...state.settings,
          bootstrapPending: false,
          cloudInitializedAt: new Date().toISOString(),
          cloudSource: "traffic-manager",
        },
      });
      state = localMigration.state;
      await updateCloudState(state);
    } else if (cloudState) {
      const cloudMigration = migrateRechargeWorkflow(cloudState);
      state = cloudMigration.state;
      if (cloudMigration.changed) await updateCloudState(state);
    } else {
      state = migrateRechargeWorkflow(state).state;
      state = await createCloudState(state);
    }
    cloudReady = true;
    cacheState(state);
    lastCloudSnapshot = JSON.stringify(state);
    lastCloudRefreshAt = Date.now();
    setCloudStatus("synced", "云端已同步");
    renderAll();
    return true;
  } catch (error) {
    cloudReady = false;
    lastCloudSnapshot = JSON.stringify(state);
    setCloudStatus("offline", "云端连接失败");
    console.error(error);
    toast("云端连接失败，当前仅显示本地缓存，暂时不能修改数据", "error");
    return false;
  }
}

async function refreshCloudState() {
  if (!cloudReady || Date.now() - lastCloudRefreshAt < 15000) return;
  if ($$(".modal-backdrop:not(.hidden), .confirm-backdrop:not(.hidden)").length) return;
  setCloudStatus("syncing", "正在刷新云端");
  try {
    const cloudState = await fetchCloudState();
    if (!cloudState || cloudState.settings?.bootstrapPending) return;
    const migration = migrateRechargeWorkflow(cloudState);
    state = migration.state;
    if (migration.changed) await updateCloudState(state);
    cacheState(state);
    lastCloudSnapshot = JSON.stringify(state);
    lastCloudRefreshAt = Date.now();
    setCloudStatus("synced", "云端已同步");
    renderAll();
  } catch (error) {
    setCloudStatus("offline", "云端刷新失败");
    console.error(error);
  }
}

async function saveState() {
  if (cloudInitializationPromise) await cloudInitializationPromise;
  if (!cloudReady) {
    if (lastCloudSnapshot) state = normalizeState(JSON.parse(lastCloudSnapshot));
    renderAll();
    toast("云端未连接，本次修改没有保存", "error");
    return false;
  }

  setCloudStatus("syncing", "正在同步云端");
  try {
    await updateCloudState(state);
    cacheState(state);
    lastCloudSnapshot = JSON.stringify(state);
    lastCloudRefreshAt = Date.now();
    setCloudStatus("synced", "云端已同步");
    return true;
  } catch (error) {
    if (lastCloudSnapshot) state = normalizeState(JSON.parse(lastCloudSnapshot));
    setCloudStatus("offline", "云端保存失败");
    console.error(error);
    renderAll();
    toast("云端保存失败，本次修改已回退", "error");
    return false;
  }
}

function markAsRealData() {
  if (state.demo) state.demo = false;
}

function uid(prefix) {
  if (window.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] || 0), 0);
}

function money(value, decimals = 0) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(value || 0));
}

function number(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${year}/${month}/${day}`;
}

function platformClass(platform) {
  if (["千川", "巨量引擎"].includes(platform)) return "red";
  if (["小红书", "百度"].includes(platform)) return "blue";
  return "gray";
}

function platformShort(platform) {
  const map = { 巨量引擎: "巨", 千川: "千", 小红书: "红", 视频号: "视", 快手: "快", 百度: "百", 其他: "其" };
  return map[platform] || String(platform).slice(0, 1);
}

function statusBadge(status) {
  const className = ["已暂停", "待确认"].includes(status) ? "paused" : ["已结束", "已驳回"].includes(status) ? "ended" : "";
  return `<span class="status-badge ${className}">${escapeHtml(status)}</span>`;
}

function isFundedRecharge(recharge) {
  return (recharge.recordType || "recharge") === "recharge";
}

function campaignById(id) {
  return state.campaigns.find((item) => item.id === id);
}

function rechargeAccountLabel(campaign) {
  return String(campaign?.name || campaign?.account || "").trim();
}

function resolveRechargeAccount(value) {
  const keyword = String(value || "").trim().toLowerCase();
  if (!keyword) return null;
  return state.campaigns.find((campaign) => {
    const labels = [rechargeAccountLabel(campaign), campaign.account].filter(Boolean).map((item) => String(item).trim().toLowerCase());
    return labels.includes(keyword);
  }) || null;
}

function recordsForDate(date) {
  return state.records.filter((item) => item.date === date);
}

function aggregateCampaignRecords(records) {
  const aggregate = new Map();
  records.forEach((record) => {
    if (!aggregate.has(record.campaignId)) {
      aggregate.set(record.campaignId, { spend: 0, revenue: 0, orders: 0, clicks: 0, impressions: 0 });
    }
    const row = aggregate.get(record.campaignId);
    ["spend", "revenue", "orders", "clicks", "impressions"].forEach((key) => {
      row[key] += Number(record[key] || 0);
    });
  });
  return aggregate;
}

function renderAll() {
  renderSelectOptions();
  renderDashboard();
  renderRecharges();
  renderCampaigns();
  renderRecords();
  renderQianchuanResult();
  renderBackup();
}

function buildQianchuanAuthorizationLink(customerKey) {
  const returnTo = `${window.location.origin}${window.location.pathname}`;
  const url = new URL(QIANCHUAN_CONFIG.startUrl);
  url.searchParams.set("customer", customerKey);
  url.searchParams.set("return_to", returnTo);
  return url.toString();
}

function renderQianchuanResult() {
  const resultCard = $("#qianchuanResultCard");
  if (!resultCard) return;
  const params = new URLSearchParams(window.location.search);
  const result = params.get("qianchuan");
  if (!result) return;

  const customer = params.get("customer") || "当前客户";
  const accountCount = Math.max(0, Number(params.get("accounts") || 0));
  const success = result === "success";
  resultCard.classList.remove("hidden", "is-error");
  resultCard.classList.toggle("is-error", !success);
  $("#qianchuanResultIcon").textContent = success ? "✓" : "!";
  $("#qianchuanResultTitle").textContent = success ? "千川授权成功" : "千川授权未完成";
  $("#qianchuanResultMessage").textContent = success
    ? `${customer} 已完成授权${accountCount ? `，共接入 ${accountCount} 个账户` : ""}。`
    : "授权信息未能安全保存，请重新生成链接后再试。";
  switchView("qianchuan");

  const cleanUrl = new URL(window.location.href);
  ["qianchuan", "customer", "accounts", "reason"].forEach((key) => cleanUrl.searchParams.delete(key));
  window.history.replaceState({}, "", cleanUrl);
}

function handleQianchuanAuthorize(event) {
  event.preventDefault();
  const input = $("#qianchuanCustomerKey");
  const customerKey = input.value.trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(customerKey)) {
    input.setCustomValidity("仅支持字母、数字、短横线和下划线");
    input.reportValidity();
    return;
  }
  input.setCustomValidity("");
  const authorizationLink = buildQianchuanAuthorizationLink(customerKey);
  $("#qianchuanAuthorizationLink").value = authorizationLink;
  $("#openQianchuanLinkButton").href = authorizationLink;
  $("#qianchuanLinkPanel").classList.remove("hidden");
  toast("客户授权链接已生成");
}

async function copyQianchuanAuthorizationLink() {
  const link = $("#qianchuanAuthorizationLink").value;
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    toast("授权链接已复制，可发送给客户");
  } catch (error) {
    $("#qianchuanAuthorizationLink").select();
    toast("请按 Ctrl+C 复制授权链接", "error");
  }
}

function getQianchuanDashboardKey() {
  try {
    return sessionStorage.getItem(QIANCHUAN_CONFIG.dashboardKeyStorageKey) || "";
  } catch (error) {
    return "";
  }
}

function saveQianchuanDashboardKey(value) {
  try {
    sessionStorage.setItem(QIANCHUAN_CONFIG.dashboardKeyStorageKey, value);
    return true;
  } catch (error) {
    return false;
  }
}

function clearQianchuanDashboardKey() {
  try {
    sessionStorage.removeItem(QIANCHUAN_CONFIG.dashboardKeyStorageKey);
  } catch (error) {
    // sessionStorage may be disabled; the key is never persisted elsewhere.
  }
}

function setQianchuanDashboardUnlocked(unlocked) {
  $("#qianchuanDashboardAccessForm").classList.toggle("hidden", unlocked);
  $("#qianchuanDashboard").classList.toggle("hidden", !unlocked);
  $("#qianchuanLockButton").classList.toggle("hidden", !unlocked);
  if (!unlocked) {
    $("#qianchuanDashboardKey").value = "";
    $("#qianchuanDashboardKey").focus();
  }
}

function setQianchuanDashboardStatus(message, stateName = "idle") {
  const status = $("#qianchuanDashboardStatus");
  status.textContent = message;
  status.dataset.state = stateName;
}

function qianchuanErrorMessage(errorCode) {
  const messages = {
    unauthorized: "看板访问密码不正确，请重新输入。",
    customer_not_found: "没有找到该客户的授权记录，请让客户重新授权。",
    authorization_expired: "该客户授权已过期，请重新发送授权链接。",
    invalid_customer: "客户编号格式不正确。",
    invalid_date_range: "日期范围需为 1 至 31 天。",
    server_not_configured: "云端看板尚未配置完成。",
    upstream_request_failed: "千川接口暂时未能返回数据，请稍后重试或检查账户权限。",
  };
  return messages[errorCode] || "数据读取失败，请稍后重试。";
}

async function qianchuanRequest(payload) {
  const dashboardKey = getQianchuanDashboardKey();
  if (!dashboardKey) throw new Error("unauthorized");
  const response = await fetch(QIANCHUAN_CONFIG.dataUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dashboard-Key": dashboardKey,
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorCode = result?.error || "request_failed";
    if (response.status === 401) {
      clearQianchuanDashboardKey();
      setQianchuanDashboardUnlocked(false);
    }
    throw new Error(errorCode);
  }
  return result;
}

function renderQianchuanCustomers(customers) {
  const select = $("#qianchuanCustomerSelect");
  const current = select.value || qianchuanPreferredCustomer;
  select.innerHTML = customers.map((customer) => {
    const count = Math.max(0, Number(customer.accountCount || 0));
    const label = `${customer.customerKey}${count ? ` · ${count} 个账户` : ""}`;
    return `<option value="${escapeHtml(customer.customerKey)}">${escapeHtml(label)}</option>`;
  }).join("");
  const matched = customers.some((customer) => customer.customerKey === current);
  if (matched) select.value = current;
  select.disabled = customers.length === 0;
  $("#qianchuanRefreshButton").disabled = customers.length === 0;
  qianchuanPreferredCustomer = select.value || "";
}

function renderQianchuanDashboard(data) {
  const summary = data?.summary || {};
  const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
  $("#qianchuanMetricSpend").textContent = money(summary.spend, 2);
  $("#qianchuanMetricGmv").textContent = money(summary.gmv, 2);
  $("#qianchuanMetricRoi").textContent = Number(summary.roi || 0).toFixed(2);
  $("#qianchuanMetricAccounts").textContent = number(summary.accountCount || 0);
  $("#qianchuanMetricAccountHint").textContent = summary.failedAccountCount
    ? `${number(summary.successfulAccountCount || 0)} 个读取成功`
    : "全部读取成功";

  $("#qianchuanAccountTableBody").innerHTML = accounts.map((account) => {
    const failed = account.status !== "ok";
    const metric = (value, formatter) => failed ? "—" : formatter(value);
    return `<tr>
      <td><div class="qianchuan-account-cell"><strong>${escapeHtml(account.advertiserName || "未命名账户")}</strong><span>${escapeHtml(account.advertiserId)}</span></div></td>
      <td>${metric(account.spend, (value) => money(value, 2))}</td>
      <td>${metric(account.gmv, (value) => money(value, 2))}</td>
      <td>${metric(account.roi, (value) => Number(value || 0).toFixed(2))}</td>
      <td>${metric(account.directGmv, (value) => money(value, 2))}</td>
      <td>${metric(account.orders, number)}</td>
      <td>${metric(account.clicks, number)}</td>
      <td><span class="qianchuan-row-status ${failed ? "is-error" : ""}">${failed ? "读取失败" : "正常"}</span></td>
    </tr>`;
  }).join("");
  $("#qianchuanAccountEmptyState").classList.toggle("hidden", accounts.length > 0);

  const refreshTime = data?.refreshedAt ? new Date(data.refreshedAt).toLocaleString("zh-CN", { hour12: false }) : "刚刚";
  const unsupported = data?.warnings?.unsupportedAuthorizationTypes || [];
  const notes = [`数据来自巨量引擎 Marketing API，更新时间 ${refreshTime}`];
  if (data?.warnings?.partial) notes.push("部分账户读取失败，汇总只包含读取成功的账户");
  if (unsupported.length) notes.push(`另有 ${unsupported.length} 类管理账号暂不支持自动展开`);
  $("#qianchuanDataNote").textContent = `${notes.join("；")}。`;
}

async function loadQianchuanCustomers(autoLoad = true) {
  setQianchuanDashboardStatus("正在读取已授权客户…", "loading");
  try {
    const result = await qianchuanRequest({ action: "customers" });
    const customers = Array.isArray(result.customers) ? result.customers : [];
    renderQianchuanCustomers(customers);
    if (!customers.length) {
      setQianchuanDashboardStatus("还没有客户授权记录，请先生成授权链接。", "error");
      renderQianchuanDashboard({ summary: {}, accounts: [], warnings: {} });
      return;
    }
    setQianchuanDashboardStatus(`已读取 ${customers.length} 个授权客户。`, "success");
    if (autoLoad) await loadQianchuanDashboard();
  } catch (error) {
    const message = qianchuanErrorMessage(error.message);
    setQianchuanDashboardStatus(message, "error");
    toast(message, "error");
  }
}

async function loadQianchuanDashboard() {
  if (qianchuanDashboardLoading) return;
  const customerKey = $("#qianchuanCustomerSelect").value;
  const startDate = $("#qianchuanStartDate").value;
  const endDate = $("#qianchuanEndDate").value;
  if (!customerKey) return;

  const rangeDays = Math.floor((new Date(`${endDate}T00:00:00`) - new Date(`${startDate}T00:00:00`)) / 86400000) + 1;
  if (!Number.isFinite(rangeDays) || rangeDays < 1 || rangeDays > 31) {
    setQianchuanDashboardStatus("日期范围需为 1 至 31 天。", "error");
    return;
  }

  qianchuanDashboardLoading = true;
  $("#qianchuanRefreshButton").disabled = true;
  setQianchuanDashboardStatus(`正在读取 ${customerKey} 的千川账户和报表…`, "loading");
  try {
    const data = await qianchuanRequest({ action: "dashboard", customerKey, startDate, endDate });
    renderQianchuanDashboard(data);
    const failedCount = Number(data?.summary?.failedAccountCount || 0);
    setQianchuanDashboardStatus(
      failedCount ? `数据已更新，其中 ${failedCount} 个账户读取失败。` : "千川数据已更新。",
      failedCount ? "error" : "success",
    );
  } catch (error) {
    const message = qianchuanErrorMessage(error.message);
    setQianchuanDashboardStatus(message, "error");
    toast(message, "error");
  } finally {
    qianchuanDashboardLoading = false;
    $("#qianchuanRefreshButton").disabled = !$("#qianchuanCustomerSelect").value;
  }
}

async function handleQianchuanDashboardAccess(event) {
  event.preventDefault();
  const input = $("#qianchuanDashboardKey");
  const dashboardKey = input.value;
  if (dashboardKey.length < 16) {
    input.setCustomValidity("访问密码至少 16 个字符");
    input.reportValidity();
    return;
  }
  input.setCustomValidity("");
  if (!saveQianchuanDashboardKey(dashboardKey)) {
    toast("浏览器无法保存本次会话密码，请检查隐私设置。", "error");
    return;
  }
  input.value = "";
  setQianchuanDashboardUnlocked(true);
  await loadQianchuanCustomers(true);
}

function lockQianchuanDashboard() {
  clearQianchuanDashboardKey();
  setQianchuanDashboardUnlocked(false);
  renderQianchuanDashboard({ summary: {}, accounts: [], warnings: {} });
  toast("千川数据看板已锁定");
}

function initializeQianchuanDashboard() {
  $("#qianchuanStartDate").value = localDate(-6);
  $("#qianchuanEndDate").value = localDate();
  const unlocked = Boolean(getQianchuanDashboardKey());
  setQianchuanDashboardUnlocked(unlocked);
  if (unlocked) loadQianchuanCustomers(true);
}

function renderSelectOptions() {
  const currentCampaignPlatform = $("#campaignPlatform").value;
  $("#campaignPlatform").innerHTML = PLATFORMS.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
  if (PLATFORMS.includes(currentCampaignPlatform)) $("#campaignPlatform").value = currentCampaignPlatform;

  ["#recordPlatformFilter"].forEach((selector) => {
    const select = $(selector);
    const current = select.value;
    select.innerHTML = `<option value="all">全部平台</option>${PLATFORMS.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}`;
    select.value = PLATFORMS.includes(current) ? current : "all";
  });

  const recordSelect = $("#recordCampaign");
  const rechargeSelect = $("#rechargeCampaign");
  const currentRecordCampaign = recordSelect.value;
  const currentRechargeCampaign = rechargeSelect.value;
  const activeFirst = [...state.campaigns].sort((a, b) => (a.status === "投放中" ? -1 : 1) - (b.status === "投放中" ? -1 : 1));
  recordSelect.innerHTML = activeFirst.length
    ? activeFirst.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.platform)}</option>`).join("")
    : `<option value="">请先新建投流计划</option>`;
  if (state.campaigns.some((item) => item.id === currentRecordCampaign)) recordSelect.value = currentRecordCampaign;
  $("#rechargeAccountOptions").innerHTML = activeFirst.map((item) => {
    const accountDetail = item.account && item.account !== item.name ? `${item.account} · ${item.platform}` : item.platform;
    return `<option value="${escapeHtml(rechargeAccountLabel(item))}" label="${escapeHtml(accountDetail)}"></option>`;
  }).join("");
  rechargeSelect.value = state.campaigns.some((item) => item.id === currentRechargeCampaign) ? currentRechargeCampaign : "";
}

function renderDashboard() {
  const date = $("#dashboardDate").value || localDate();
  const todayRecords = recordsForDate(date);
  const previousRecords = recordsForDate(offsetDate(date, -1));
  const todayRecharges = state.recharges.filter((item) => item.date === date);
  const previousRecharges = state.recharges.filter((item) => item.date === offsetDate(date, -1));
  const cumulativeRecharges = state.recharges.filter((item) => item.date <= date && isFundedRecharge(item));
  const cumulativeRecords = state.records.filter((item) => item.date <= date);
  const recharge = sum(todayRecharges.filter(isFundedRecharge), "amount");
  const previousRecharge = sum(previousRecharges.filter(isFundedRecharge), "amount");
  const spend = sum(todayRecords, "spend");
  const revenue = sum(todayRecords, "revenue");
  const orders = sum(todayRecords, "orders");
  const balance = sum(cumulativeRecharges, "amount") - sum(cumulativeRecords, "spend");
  const roi = ratio(revenue, spend);
  const previousSpend = sum(previousRecords, "spend");
  const previousRevenue = sum(previousRecords, "revenue");
  const previousRoi = ratio(previousRevenue, previousSpend);

  const cards = [
    {
      label: "当日充值金额",
      icon: "+",
      value: money(recharge),
      note: trendNote(recharge, previousRecharge, "较前一日"),
    },
    {
      label: "当日消耗",
      icon: "↗",
      value: money(spend),
      note: trendNote(spend, previousSpend, "较前一日"),
    },
    {
      label: "账户总余额",
      icon: "¥",
      value: money(balance),
      note: `<span>累计充值减累计消耗</span>`,
    },
    {
      label: "当日整体 ROI",
      icon: "◎",
      value: roi.toFixed(2),
      note: previousRoi ? trendNote(roi, previousRoi, "较前一日") : `<span>${orders} 单 · 成交 ${money(revenue)}</span>`,
    },
  ];

  $("#kpiGrid").innerHTML = cards.map((card) => `
    <article class="kpi-card">
      <div class="kpi-label"><span>${card.label}</span><span class="kpi-icon">${card.icon}</span></div>
      <div class="kpi-value">${card.value}</div>
      <div class="kpi-footnote">${card.note}</div>
    </article>
  `).join("");

  $("#dashboardSummary").textContent = todayRecords.length || todayRecharges.length
    ? `${formatDate(date)}：充值 ${todayRecharges.length} 笔、消耗 ${todayRecords.length} 条，账户总余额 ${money(balance)}。`
    : `${formatDate(date)} 暂无充值和消耗数据，可前往对应业务端开始录入。`;
  $("#dataModeBadge").textContent = cloudReady ? (state.demo ? "云端演示数据" : "云端数据") : "本地缓存";

  renderTrend(date);
  renderAlerts(todayRecords, date);
  renderRanking(todayRecords, date);
}

function trendNote(current, previous, label) {
  if (!previous) return `<span>${label}暂无数据</span>`;
  const change = (current - previous) / previous;
  const direction = change >= 0 ? "trend-up" : "trend-down";
  const arrow = change >= 0 ? "↑" : "↓";
  return `<span class="${direction}">${arrow} ${Math.abs(change * 100).toFixed(1)}%</span><span>${label}</span>`;
}

function offsetDate(dateString, offset) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function renderTrend(endDate) {
  const days = Array.from({ length: 7 }, (_, index) => offsetDate(endDate, index - 6));
  const points = days.map((date) => {
    const rows = recordsForDate(date);
    const recharges = state.recharges.filter((item) => item.date === date && isFundedRecharge(item));
    return { date, spend: sum(rows, "spend"), recharge: sum(recharges, "amount") };
  });
  const svg = $("#trendChart");
  const width = 760;
  const height = 270;
  const pad = { top: 20, right: 28, bottom: 35, left: 30 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const maxValue = Math.max(...points.flatMap((item) => [item.spend, item.recharge]), 1) * 1.12;
  const x = (index) => pad.left + (index * innerWidth) / (points.length - 1);
  const y = (value) => pad.top + innerHeight - (value / maxValue) * innerHeight;
  const line = (key) => points.map((item, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(item[key]).toFixed(1)}`).join(" ");
  const area = `${line("recharge")} L${x(points.length - 1)},${pad.top + innerHeight} L${x(0)},${pad.top + innerHeight} Z`;
  const grid = Array.from({ length: 4 }, (_, index) => {
    const gridY = pad.top + (innerHeight * index) / 3;
    return `<line class="chart-grid-line" x1="${pad.left}" y1="${gridY}" x2="${width - pad.right}" y2="${gridY}" />`;
  }).join("");
  const labels = points.map((item, index) => `<text class="chart-label" x="${x(index)}" y="${height - 10}" text-anchor="middle">${item.date.slice(5).replace("-", "/")}</text>`).join("");
  const dots = points.map((item, index) => `
    <circle class="chart-dot" cx="${x(index)}" cy="${y(item.recharge)}" r="4" stroke="var(--pine)"><title>${item.date} 充值 ${money(item.recharge, 0)}</title></circle>
    <circle class="chart-dot" cx="${x(index)}" cy="${y(item.spend)}" r="3.5" stroke="var(--orange)"><title>${item.date} 消耗 ${money(item.spend, 0)}</title></circle>
  `).join("");
  svg.innerHTML = `
    <defs>
      <linearGradient id="chartAreaGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#173f35" stop-opacity=".16" />
        <stop offset="100%" stop-color="#173f35" stop-opacity="0" />
      </linearGradient>
    </defs>
    ${grid}
    <path class="chart-area" d="${area}" />
    <path class="chart-line-revenue" d="${line("recharge")}" />
    <path class="chart-line-spend" d="${line("spend")}" />
    ${dots}
    ${labels}
  `;
}

function renderAlerts(records, date) {
  const grouped = aggregateCampaignRecords(records);
  const alerts = [];
  state.campaigns.filter((item) => item.status === "投放中").forEach((campaign) => {
    if (campaign.objective === "账户充值" && Number(campaign.dailyBudget) === 0) return;
    const metrics = grouped.get(campaign.id);
    const accountRecharge = sum(state.recharges.filter((item) => item.campaignId === campaign.id && item.date <= date && isFundedRecharge(item)), "amount");
    const accountSpend = sum(state.records.filter((item) => item.campaignId === campaign.id && item.date <= date), "spend");
    const accountBalance = accountRecharge - accountSpend;
    if (accountBalance < campaign.dailyBudget * 0.5) {
      alerts.push({ title: `${campaign.name} 账户余额偏低`, detail: `当前余额 ${money(accountBalance)}，不足日预算的 50%，建议及时充值` });
    }
    if (!metrics) {
      alerts.push({ title: `${campaign.name} 尚未录入数据`, detail: `${formatDate(date)} 没有找到该计划的数据记录` });
      return;
    }
    const roi = ratio(metrics.revenue, metrics.spend);
    if (metrics.spend > 0 && roi < campaign.targetRoi * 0.8) {
      alerts.push({ title: `${campaign.name} ROI 低于目标`, detail: `当前 ${roi.toFixed(2)}，目标 ${Number(campaign.targetRoi).toFixed(2)}，建议检查素材与定向` });
    }
    if (metrics.spend > campaign.dailyBudget * 0.95) {
      alerts.push({ title: `${campaign.name} 接近日预算上限`, detail: `已消耗 ${money(metrics.spend)}，日预算 ${money(campaign.dailyBudget)}` });
    }
  });
  $("#alertCount").textContent = String(alerts.length);
  $("#alertList").innerHTML = alerts.length
    ? alerts.slice(0, 4).map((alert) => `
        <div class="alert-item">
          <span class="alert-icon">!</span>
          <div><strong>${escapeHtml(alert.title)}</strong><span>${escapeHtml(alert.detail)}</span></div>
        </div>
      `).join("")
    : `<div class="all-good"><b>✓</b>当前没有需要立即处理的异常</div>`;
}

function renderRanking(records, date) {
  const grouped = aggregateCampaignRecords(records);
  const rows = state.campaigns.map((campaign) => {
    const metrics = grouped.get(campaign.id) || { spend: 0, revenue: 0, orders: 0 };
    const recharge = sum(state.recharges.filter((item) => item.campaignId === campaign.id && item.date <= date && isFundedRecharge(item)), "amount");
    const cumulativeSpend = sum(state.records.filter((item) => item.campaignId === campaign.id && item.date <= date), "spend");
    return { campaign, recharge, cumulativeSpend, balance: recharge - cumulativeSpend, roi: ratio(metrics.revenue, metrics.spend) };
  }).sort((a, b) => b.cumulativeSpend - a.cumulativeSpend);
  $("#rankingTableBody").innerHTML = rows.length
    ? rows.map((row) => `
      <tr>
        <td>${campaignNameCell(row.campaign)}</td>
        <td>${escapeHtml(row.campaign.platform)}</td>
        <td class="number-cell">${money(row.recharge, 0)}</td>
        <td class="number-cell">${money(row.cumulativeSpend, 0)}</td>
        <td class="number-cell"><span class="roi-value ${row.balance >= 0 ? "roi-good" : "roi-warn"}">${money(row.balance, 0)}</span></td>
        <td class="number-cell"><span class="roi-value ${row.roi >= row.campaign.targetRoi ? "roi-good" : "roi-warn"}">${row.roi.toFixed(2)}</span></td>
        <td>${statusBadge(row.campaign.status)}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:40px">还没有投流计划</td></tr>`;
}

function campaignNameCell(campaign, subtitle) {
  return `<div class="campaign-name">
    <span class="platform-avatar ${platformClass(campaign.platform)}">${platformShort(campaign.platform)}</span>
    <div><strong>${escapeHtml(campaign.name)}</strong><span>${escapeHtml(subtitle || campaign.account || "未填写账户")}</span></div>
  </div>`;
}

function filteredRecharges() {
  return state.recharges.filter((recharge) => {
    const recordType = recharge.recordType || "recharge";
    return recordType === activeRechargeLedger;
  }).sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

function normalizeReceiptText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function matchCampaignFromReceipt(text) {
  const normalizedText = normalizeReceiptText(text);
  return state.campaigns.find((campaign) => {
    const labels = [rechargeAccountLabel(campaign), campaign.account].filter(Boolean);
    return labels.some((label) => {
      const normalizedLabel = normalizeReceiptText(label);
      return normalizedLabel.length >= 3 && normalizedText.includes(normalizedLabel);
    });
  }) || null;
}


function setPaymentOcrStatus(message, progress = 0, stateName = "working") {
  const status = $("#paymentOcrStatus");
  status.classList.remove("hidden", "success", "error");
  if (stateName !== "working") status.classList.add(stateName);
  $("#paymentOcrMessage").textContent = message;
  const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
  $("#paymentOcrPercent").textContent = `${percent}%`;
  $("#paymentOcrProgress").style.width = `${percent}%`;
}

function getZhipuApiKey() {
  const saved = String(localStorage.getItem(ZHIPU_VISION_CONFIG.keyStorageKey) || "").trim();
  return saved || ZHIPU_VISION_CONFIG.defaultApiKey;
}

function saveZhipuApiKey(value) {
  try {
    localStorage.setItem(ZHIPU_VISION_CONFIG.keyStorageKey, String(value || "").trim());
  } catch (error) {
    console.warn("保存 API Key 失败", error);
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

async function callZhipuVision(apiKey, dataUrl) {
  const response = await fetch(ZHIPU_VISION_CONFIG.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: ZHIPU_VISION_CONFIG.model,
      temperature: 0.1,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text", text: VISION_PROMPT },
        ],
      }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 401) throw new Error("API Key 无效，请检查后重新填写");
    if (response.status === 429) throw new Error("调用过于频繁，请稍后再试");
    throw new Error(`接口错误 ${response.status} ${detail.slice(0, 100)}`);
  }
  const data = await response.json();
  return String(data?.choices?.[0]?.message?.content || "");
}

function parseVisionAnswer(answer) {
  const text = String(answer || "").replace(/```json|```/gi, "").trim();
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || "";
  let date = "";
  let amount = 0;
  let payer = "";
  let payerBank = "";
  let payerAccount = "";
  let payee = "";
  let payeeBank = "";
  let payeeAccount = "";
  try {
    const parsed = JSON.parse(jsonText || "{}");
    date = String(parsed.date || "").trim();
    amount = Number(String(parsed.amount ?? "").replace(/[^\d.]/g, "")) || 0;
    payer = String(parsed.payer || "").trim();
    payerBank = String(parsed.payerBank || "").trim();
    payerAccount = String(parsed.payerAccount || "").trim();
    payee = String(parsed.payee || "").trim();
    payeeBank = String(parsed.payeeBank || "").trim();
    payeeAccount = String(parsed.payeeAccount || "").trim();
  } catch (error) {
    const amountMatch = text.match(/([1-9][\d,]*(?:\.\d{1,2})?)/);
    if (amountMatch) amount = Number(amountMatch[1].replaceAll(",", "")) || 0;
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const m = date.match(/(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
    date = m ? `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}` : "";
  }
  return { date, amount, payer, payerBank, payerAccount, payee, payeeBank, payeeAccount, confidence: 100 };
}

async function recognizePaymentImage(file) {
  if (!file?.type?.startsWith("image/")) {
    toast("请选择付款截图图片", "error");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    toast("图片不能超过 8MB", "error");
    return;
  }
  const apiKey = getZhipuApiKey();
  if (!apiKey) {
    setPaymentOcrStatus("请先在下方填写智谱 API Key（bigmodel.cn 免费申请）", 1, "error");
    $("#zhipuApiKey").focus();
    return;
  }
  $("#paymentImageName").textContent = file.name;
  $("#paymentUploadButton").disabled = true;
  setPaymentOcrStatus("正在上传截图…", 0.2);
  try {
    const dataUrl = await fileToDataUrl(file);
    setPaymentOcrStatus("智谱 GLM-4V 正在识别付款信息…", 0.5);
    const answer = await callZhipuVision(apiKey, dataUrl);
    const parsed = parseVisionAnswer(answer);
    paymentOcrResult = parsed;
    if (parsed.date) $("#paymentDate").value = parsed.date;
    if (parsed.amount) $("#paymentAmount").value = parsed.amount;
    $("#paymentPayer").value = parsed.payer;
    $("#paymentPayerBank").value = parsed.payerBank;
    $("#paymentPayerAccount").value = parsed.payerAccount;
    $("#paymentPayee").value = parsed.payee;
    $("#paymentPayeeBank").value = parsed.payeeBank;
    $("#paymentPayeeAccount").value = parsed.payeeAccount;
    const missing = [!parsed.amount && "金额", !parsed.payer && "付款方", !parsed.payee && "收款方"].filter(Boolean);
    setPaymentOcrStatus(missing.length ? `识别完成，请补充${missing.join("、")}` : "识别完成，请确认后保存", 1, "success");
  } catch (error) {
    console.error(error);
    setPaymentOcrStatus(`识别失败：${error.message || "请重试或手动填写"}`, 1, "error");
  } finally {
    $("#paymentUploadButton").disabled = false;
  }
}

function partyCellHtml(name, bank, account, fallbackCampaign) {
  const displayName = name || (fallbackCampaign ? fallbackCampaign.name : "");
  const detail = [bank, account].filter(Boolean).join(" · ");
  if (!displayName && !detail) return `<span>—</span>`;
  return `<div class="stacked-cell"><strong>${escapeHtml(displayName || "—")}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ""}</div>`;
}

function renderRecharges() {
  const rows = filteredRecharges();
  const meta = RECHARGE_LEDGER_META[activeRechargeLedger];
  $$('[data-recharge-ledger]').forEach((button) => button.classList.toggle("active", button.dataset.rechargeLedger === activeRechargeLedger));
  $("#rechargeLedgerTitle").textContent = meta.title;
  $("#rechargeDateHeading").textContent = meta.dateLabel;
  $("#rechargeAccountHeading").textContent = meta.accountLabel;
  $("#rechargePayeeHeading").textContent = activeRechargeLedger === "payment" ? "收款方" : "";
  $("#rechargeAmountHeading").textContent = meta.amountLabel;
  $("#addRechargeButton").classList.toggle("hidden", !meta.addLabel);
  $("#addRechargeButton").textContent = meta.addLabel;
  $("#rechargeTableBody").innerHTML = rows.map((recharge) => {
    const campaign = campaignById(recharge.campaignId);
    const actions = activeRechargeLedger !== "pending" ? `<div class="table-actions"><button class="small-action" data-action="edit-ledger" data-id="${escapeHtml(recharge.id)}">编辑</button><button class="small-action delete" data-action="delete-ledger" data-id="${escapeHtml(recharge.id)}">删除</button></div>` : "—";
    if (activeRechargeLedger === "payment") {
      return `<tr>
        <td>${formatDate(recharge.date)}</td>
        <td>${partyCellHtml(recharge.payer, recharge.payerBank, recharge.payerAccount, campaign)}</td>
        <td>${partyCellHtml(recharge.payee, recharge.payeeBank, recharge.payeeAccount, null)}</td>
        <td class="number-cell"><strong>${money(recharge.amount, 2)}</strong></td>
        <td class="action-cell">${actions}</td>
      </tr>`;
    }
    return `<tr>
      <td>${formatDate(recharge.date)}</td>
      <td colspan="2">${campaign ? campaignNameCell(campaign, campaign.account) : `<span>已删除的账户</span>`}</td>
      <td class="number-cell"><strong>${money(recharge.amount, 2)}</strong></td>
      <td class="action-cell">${actions}</td>
    </tr>`;
  }).join("");
  $("#rechargeEmptyState").classList.toggle("hidden", rows.length > 0);
  $("#rechargeEmptyTitle").textContent = `还没有${meta.title}`;
  $("#rechargeEmptyCopy").textContent = activeRechargeLedger === "recharge"
    ? "点击“添加充值记录”开始登记。"
    : activeRechargeLedger === "payment" ? "点击“上传付款截图”自动识别生成记录。" : "当前没有待付款记录。";
  $("#rechargeTableBody").closest(".table-scroll").classList.toggle("hidden", rows.length === 0);
}

function renderCampaigns() {
  if (!$("#campaignTableBody")) return;
  const query = $("#campaignSearch").value.trim().toLowerCase();
  const platform = $("#campaignPlatformFilter").value;
  const status = $("#campaignStatusFilter").value;
  const rows = state.campaigns.filter((item) => {
    const haystack = [item.name, item.account, item.owner].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (platform === "all" || item.platform === platform) && (status === "all" || item.status === status);
  });
  $("#campaignTableBody").innerHTML = rows.map((campaign) => `
    <tr>
      <td>${campaignNameCell(campaign, `开始于 ${formatDate(campaign.startDate)}`)}</td>
      <td><div class="stacked-cell"><strong>${escapeHtml(campaign.platform)}</strong><span>${escapeHtml(campaign.account || "未填写账户")}</span></div></td>
      <td>${escapeHtml(campaign.objective)}</td>
      <td class="number-cell">${money(campaign.dailyBudget, 0)}</td>
      <td class="number-cell"><strong>${Number(campaign.targetRoi || 0).toFixed(2)}</strong></td>
      <td>${escapeHtml(campaign.owner || "—")}</td>
      <td>${statusBadge(campaign.status)}</td>
      <td class="action-cell">
        <div class="table-actions">
          <button class="small-action" data-action="recharge-campaign" data-id="${escapeHtml(campaign.id)}">充值</button>
          <button class="small-action" data-action="record-campaign" data-id="${escapeHtml(campaign.id)}">录数据</button>
          <button class="small-action" data-action="edit-campaign" data-id="${escapeHtml(campaign.id)}">编辑</button>
          <button class="small-action delete" data-action="delete-campaign" data-id="${escapeHtml(campaign.id)}">删除</button>
        </div>
      </td>
    </tr>
  `).join("");
  $("#campaignEmptyState").classList.toggle("hidden", rows.length > 0);
  $("#campaignTableBody").closest(".table-scroll").classList.toggle("hidden", rows.length === 0);
}

function filteredRecords() {
  const query = $("#recordSearch").value.trim().toLowerCase();
  const start = $("#recordStartDate").value;
  const end = $("#recordEndDate").value;
  const platform = $("#recordPlatformFilter").value;
  return state.records.filter((record) => {
    const campaign = campaignById(record.campaignId);
    const haystack = [campaign?.name, campaign?.account, record.notes].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (!start || record.date >= start) && (!end || record.date <= end) && (platform === "all" || campaign?.platform === platform);
  }).sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

function renderRecords() {
  const rows = filteredRecords();
  const spend = sum(rows, "spend");
  const revenue = sum(rows, "revenue");
  const orders = sum(rows, "orders");
  const summary = [
    ["筛选范围消耗", money(spend)],
    ["筛选范围成交", money(revenue)],
    ["订单数", number(orders)],
    ["整体 ROI", ratio(revenue, spend).toFixed(2)],
  ];
  $("#recordSummary").innerHTML = summary.map(([label, value]) => `<div class="summary-chip"><span>${label}</span><strong>${value}</strong></div>`).join("");

  $("#recordTableBody").innerHTML = rows.map((record) => {
    const campaign = campaignById(record.campaignId);
    const roi = ratio(record.revenue, record.spend);
    const cpa = ratio(record.spend, record.orders);
    return `
      <tr>
        <td>${formatDate(record.date)}</td>
        <td>${campaign ? campaignNameCell(campaign, record.notes || campaign.account) : `<span>已删除的计划</span>`}</td>
        <td class="number-cell">${money(record.spend, 2)}</td>
        <td class="number-cell">${number(record.impressions)}</td>
        <td class="number-cell">${number(record.clicks)}</td>
        <td class="number-cell">${money(record.revenue, 2)}</td>
        <td class="number-cell">${number(record.orders)}</td>
        <td class="number-cell"><span class="roi-value ${campaign && roi >= campaign.targetRoi ? "roi-good" : "roi-warn"}">${roi.toFixed(2)}</span></td>
        <td class="number-cell">${record.orders ? money(cpa, 2) : "—"}</td>
        <td class="action-cell">
          <div class="table-actions">
            <button class="small-action" data-action="edit-record" data-id="${escapeHtml(record.id)}">编辑</button>
            <button class="small-action delete" data-action="delete-record" data-id="${escapeHtml(record.id)}">删除</button>
          </div>
        </td>
      </tr>`;
  }).join("");
  $("#recordEmptyState").classList.toggle("hidden", rows.length > 0);
  $("#recordTableBody").closest(".table-scroll").classList.toggle("hidden", rows.length === 0);
}

function renderBackup() {
  const dataBytes = new Blob([JSON.stringify(state)]).size;
  const stats = [
    ["账户/计划", `${state.campaigns.length} 个`],
    ["充值/消耗", `${state.recharges.length}/${state.records.length} 条`],
    ["占用空间", dataBytes < 1024 ? `${dataBytes} B` : `${(dataBytes / 1024).toFixed(1)} KB`],
  ];
  $("#storageStats").innerHTML = stats.map(([label, value]) => `<div class="storage-stat"><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function switchView(viewName) {
  const meta = VIEW_META[viewName] || VIEW_META.dashboard;
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === viewName));
  $$(".view").forEach((view) => view.classList.remove("active"));
  $(`#${viewName}View`).classList.add("active");
  $("#viewEyebrow").textContent = meta[0];
  $("#viewTitle").textContent = meta[1];
  $("#sidebar").classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openCampaignModal(campaign = null) {
  $("#campaignForm").reset();
  $("#campaignId").value = campaign?.id || "";
  $("#campaignModalTitle").textContent = campaign ? "编辑账户/投流计划" : "新建账户/投流计划";
  $("#campaignName").value = campaign?.name || "";
  $("#campaignPlatform").value = campaign?.platform || PLATFORMS[0];
  $("#campaignAccount").value = campaign?.account || "";
  $("#campaignObjective").value = campaign?.objective || "商品成交";
  $("#campaignBudget").value = campaign?.dailyBudget ?? "";
  $("#campaignTargetRoi").value = campaign?.targetRoi ?? "";
  $("#campaignOwner").value = campaign?.owner || "";
  $("#campaignStartDate").value = campaign?.startDate || localDate();
  $("#campaignStatus").value = campaign?.status || "投放中";
  showModal("campaignModal");
  setTimeout(() => $("#campaignName").focus(), 60);
}

function openRechargeModal(recharge = null, campaignId = null) {
  if (!state.campaigns.length) {
    toast("请先新建一个广告账户/投流计划", "error");
    switchView("campaigns");
    openCampaignModal();
    return;
  }
  activeRechargeLedger = "recharge";
  renderRecharges();
  $("#rechargeForm").reset();
  $("#rechargeId").value = recharge?.id || "";
  $("#rechargeModalTitle").textContent = recharge ? "编辑充值记录" : "添加充值记录";
  $("#rechargeDate").value = recharge?.date || localDate();
  const selectedCampaign = campaignById(recharge?.campaignId || campaignId) || state.campaigns[0];
  $("#rechargeCampaign").value = selectedCampaign.id;
  $("#rechargeAccountSearch").value = rechargeAccountLabel(selectedCampaign);
  $("#rechargeAccountSearch").setCustomValidity("");
  $("#rechargeAmount").value = recharge?.amount ?? "";
  showModal("rechargeModal");
  setTimeout(() => $("#rechargeDate").focus(), 60);
}

function openPaymentModal(payment = null) {
  $("#paymentForm").reset();
  paymentOcrResult = null;
  $("#paymentId").value = payment?.id || "";
  $("#paymentModalTitle").textContent = payment ? "编辑付款记录" : "上传付款截图";
  $("#paymentUploadTitle").textContent = payment ? "重新上传截图识别" : "选择付款截图";
  $("#paymentImageName").textContent = "支持支付宝、微信和银行回单图片";
  $("#paymentOcrStatus").classList.add("hidden");
  $("#paymentOcrProgress").style.width = "0%";
  $("#paymentDate").value = payment?.date || localDate();
  $("#paymentAmount").value = payment?.amount ?? "";
  $("#paymentPayer").value = payment?.payer || "";
  $("#paymentPayerBank").value = payment?.payerBank || "";
  $("#paymentPayerAccount").value = payment?.payerAccount || "";
  $("#paymentPayee").value = payment?.payee || "";
  $("#paymentPayeeBank").value = payment?.payeeBank || "";
  $("#paymentPayeeAccount").value = payment?.payeeAccount || "";
  $("#zhipuApiKey").value = getZhipuApiKey();
  showModal("paymentModal");
}

function openRecordModal(record = null, campaignId = null) {
  if (!state.campaigns.length) {
    toast("请先新建一个投流计划", "error");
    switchView("campaigns");
    return;
  }
  $("#recordForm").reset();
  $("#recordId").value = record?.id || "";
  $("#recordModalTitle").textContent = record ? "编辑投流数据" : "录入投流数据";
  $("#recordDate").value = record?.date || $("#dashboardDate").value || localDate();
  $("#recordCampaign").value = record?.campaignId || campaignId || state.campaigns.find((item) => item.status === "投放中")?.id || state.campaigns[0].id;
  $("#recordSpend").value = record?.spend ?? "";
  $("#recordImpressions").value = record?.impressions ?? "";
  $("#recordClicks").value = record?.clicks ?? "";
  $("#recordLeads").value = record?.leads ?? "";
  $("#recordOrders").value = record?.orders ?? "";
  $("#recordRevenue").value = record?.revenue ?? "";
  $("#recordNotes").value = record?.notes || "";
  updateLiveMetrics();
  showModal("recordModal");
  setTimeout(() => $("#recordSpend").focus(), 60);
}

function showModal(id) {
  $(`#${id}`).classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  $(`#${id}`).classList.add("hidden");
  if (!$$(".modal-backdrop:not(.hidden), .confirm-backdrop:not(.hidden)").length) document.body.style.overflow = "";
}

async function handleCampaignSubmit(event) {
  event.preventDefault();
  const id = $("#campaignId").value;
  const item = {
    id: id || uid("cmp"),
    name: $("#campaignName").value.trim(),
    platform: $("#campaignPlatform").value,
    account: $("#campaignAccount").value.trim(),
    objective: $("#campaignObjective").value,
    dailyBudget: Number($("#campaignBudget").value),
    targetRoi: Number($("#campaignTargetRoi").value),
    owner: $("#campaignOwner").value.trim(),
    startDate: $("#campaignStartDate").value,
    status: $("#campaignStatus").value,
    createdAt: state.campaigns.find((campaign) => campaign.id === id)?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (id) {
    state.campaigns = state.campaigns.map((campaign) => campaign.id === id ? item : campaign);
  } else {
    state.campaigns.unshift(item);
  }
  markAsRealData();
  if (!(await saveState())) return;
  closeModal("campaignModal");
  renderAll();
  toast(id ? "账户/投流计划已更新" : "账户/投流计划已创建");
}

async function handleRechargeSubmit(event) {
  event.preventDefault();
  const accountInput = $("#rechargeAccountSearch");
  const selectedCampaign = resolveRechargeAccount(accountInput.value);
  if (!selectedCampaign) {
    accountInput.setCustomValidity("请从搜索结果中选择一个充值账户");
    accountInput.reportValidity();
    return;
  }
  accountInput.setCustomValidity("");
  $("#rechargeCampaign").value = selectedCampaign.id;
  const id = $("#rechargeId").value;
  const item = {
    id: id || uid("chg"),
    date: $("#rechargeDate").value,
    campaignId: selectedCampaign.id,
    amount: Number($("#rechargeAmount").value),
    recordType: "recharge",
    status: "已充值",
    channel: "",
    reference: "",
    operator: "",
    notes: "",
    createdAt: state.recharges.find((recharge) => recharge.id === id)?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (id) state.recharges = state.recharges.map((recharge) => recharge.id === id ? item : recharge);
  else state.recharges.unshift(item);
  markAsRealData();
  if (!(await saveState())) return;
  closeModal("rechargeModal");
  renderAll();
  toast(id ? "充值记录已更新" : "充值记录已保存");
}

async function handlePaymentSubmit(event) {
  event.preventDefault();
  const id = $("#paymentId").value;
  const existing = state.recharges.find((item) => item.id === id);
  const item = {
    id: id || uid("pay"),
    date: $("#paymentDate").value,
    amount: Number($("#paymentAmount").value),
    payer: $("#paymentPayer").value.trim(),
    payerBank: $("#paymentPayerBank").value.trim(),
    payerAccount: $("#paymentPayerAccount").value.trim(),
    payee: $("#paymentPayee").value.trim(),
    payeeBank: $("#paymentPayeeBank").value.trim(),
    payeeAccount: $("#paymentPayeeAccount").value.trim(),
    recordType: "payment",
    status: "已付款",
    source: paymentOcrResult ? "glm-4v" : (existing?.source || "manual"),
    ocrConfidence: paymentOcrResult?.confidence || existing?.ocrConfidence || 0,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (id) state.recharges = state.recharges.map((record) => record.id === id ? item : record);
  else state.recharges.unshift(item);
  markAsRealData();
  if (!(await saveState())) return;
  closeModal("paymentModal");
  renderAll();
  toast(id ? "付款记录已更新" : "付款记录已保存");
}

async function handleRecordSubmit(event) {
  event.preventDefault();
  const id = $("#recordId").value;
  const item = {
    id: id || uid("rec"),
    date: $("#recordDate").value,
    campaignId: $("#recordCampaign").value,
    spend: Number($("#recordSpend").value),
    impressions: Number($("#recordImpressions").value || 0),
    clicks: Number($("#recordClicks").value || 0),
    leads: Number($("#recordLeads").value || 0),
    orders: Number($("#recordOrders").value || 0),
    revenue: Number($("#recordRevenue").value),
    notes: $("#recordNotes").value.trim(),
    createdAt: state.records.find((record) => record.id === id)?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (item.clicks > item.impressions && item.impressions > 0) {
    toast("点击次数不能大于展现次数", "error");
    return;
  }
  if (id) {
    state.records = state.records.map((record) => record.id === id ? item : record);
  } else {
    state.records.unshift(item);
  }
  markAsRealData();
  if (!(await saveState())) return;
  closeModal("recordModal");
  renderAll();
  toast(id ? "投流数据已更新" : "今日数据已保存");
}

function updateLiveMetrics() {
  const spend = Number($("#recordSpend").value || 0);
  const revenue = Number($("#recordRevenue").value || 0);
  const clicks = Number($("#recordClicks").value || 0);
  const orders = Number($("#recordOrders").value || 0);
  $("#liveMetrics").innerHTML = `
    <span>预计 ROI <strong>${ratio(revenue, spend).toFixed(2)}</strong></span>
    <span>预计 CPC <strong>${clicks ? money(ratio(spend, clicks), 2) : "¥0.00"}</strong></span>
    <span>预计 CPA <strong>${orders ? money(ratio(spend, orders), 2) : "¥0.00"}</strong></span>
  `;
}

function askConfirm(title, message, acceptLabel = "确认") {
  $("#confirmTitle").textContent = title;
  $("#confirmMessage").textContent = message;
  $("#confirmAccept").textContent = acceptLabel;
  showModal("confirmDialog");
  return new Promise((resolve) => { confirmResolver = resolve; });
}

function resolveConfirm(value) {
  closeModal("confirmDialog");
  if (confirmResolver) confirmResolver(value);
  confirmResolver = null;
}

async function deleteCampaign(id) {
  const campaign = campaignById(id);
  if (!campaign) return;
  const spendCount = state.records.filter((record) => record.campaignId === id).length;
  const rechargeCount = state.recharges.filter((recharge) => recharge.campaignId === id).length;
  const linkedCount = spendCount + rechargeCount;
  const confirmed = await askConfirm(
    "删除投流计划？",
    linkedCount ? `“${campaign.name}”关联了 ${rechargeCount} 条充值和 ${spendCount} 条消耗数据。删除账户时这些数据也会一并删除。` : `确认删除“${campaign.name}”吗？`,
    "删除计划"
  );
  if (!confirmed) return;
  state.campaigns = state.campaigns.filter((item) => item.id !== id);
  state.recharges = state.recharges.filter((item) => item.campaignId !== id);
  state.records = state.records.filter((item) => item.campaignId !== id);
  markAsRealData();
  if (!(await saveState())) return;
  renderAll();
  toast("账户/计划及关联数据已删除");
}

async function deleteRecharge(id) {
  const record = state.recharges.find((item) => item.id === id);
  const isPayment = record?.recordType === "payment";
  const confirmed = await askConfirm(isPayment ? "删除这笔付款？" : "删除这笔充值？", "删除后将影响相关汇总，此操作无法撤销。", isPayment ? "删除付款" : "删除充值");
  if (!confirmed) return;
  state.recharges = state.recharges.filter((item) => item.id !== id);
  markAsRealData();
  if (!(await saveState())) return;
  renderAll();
  toast(isPayment ? "付款记录已删除" : "充值记录已删除");
}

async function deleteRecord(id) {
  const confirmed = await askConfirm("删除这条数据？", "删除后将影响对应日期的看板汇总，此操作无法撤销。", "删除数据");
  if (!confirmed) return;
  state.records = state.records.filter((item) => item.id !== id);
  markAsRealData();
  if (!(await saveState())) return;
  renderAll();
  toast("数据记录已删除");
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function exportJson() {
  const payload = { ...state, exportedAt: new Date().toISOString(), app: "流量罗盘" };
  downloadFile(`投流管理备份-${localDate()}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  toast("完整备份已下载");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function exportCsv() {
  const rows = filteredRecords();
  const header = ["日期", "计划名称", "平台", "广告账户", "消耗", "展现", "点击", "线索", "订单", "成交金额", "ROI", "CPC", "CPA", "备注"];
  const dataRows = rows.map((record) => {
    const campaign = campaignById(record.campaignId) || {};
    return [
      record.date, campaign.name || "已删除的计划", campaign.platform || "", campaign.account || "", record.spend,
      record.impressions, record.clicks, record.leads, record.orders, record.revenue,
      ratio(record.revenue, record.spend).toFixed(2), ratio(record.spend, record.clicks).toFixed(2),
      ratio(record.spend, record.orders).toFixed(2), record.notes || "",
    ].map(csvEscape).join(",");
  });
  const csv = `\ufeff${header.join(",")}\n${dataRows.join("\n")}`;
  downloadFile(`投流每日数据-${localDate()}.csv`, csv, "text/csv;charset=utf-8");
  toast(`已导出 ${rows.length} 条数据`);
}

function exportRechargeCsv() {
  const rows = filteredRecharges();
  const header = ["充值日期", "计划名称", "平台", "广告账户", "充值金额", "付款渠道", "到账状态", "交易流水号", "经办人", "备注"];
  const dataRows = rows.map((recharge) => {
    const campaign = campaignById(recharge.campaignId) || {};
    return [recharge.date, campaign.name || "已删除的账户", campaign.platform || "", campaign.account || "", recharge.amount, recharge.channel, recharge.status, recharge.reference || "", recharge.operator || "", recharge.notes || ""].map(csvEscape).join(",");
  });
  downloadFile(`投流充值记录-${localDate()}.csv`, `\ufeff${header.join(",")}\n${dataRows.join("\n")}`, "text/csv;charset=utf-8");
  toast(`已导出 ${rows.length} 笔充值记录`);
}

async function importJson(file) {
  if (!file) return;
  try {
    const parsed = migrateRechargeWorkflow(JSON.parse(await file.text())).state;
    const confirmed = await askConfirm("导入并覆盖当前数据？", `备份中包含 ${parsed.campaigns.length} 个账户、${parsed.recharges.length} 笔充值和 ${parsed.records.length} 条消耗。导入后当前数据会被覆盖。`, "确认导入");
    if (!confirmed) return;
    state = parsed;
    state.demo = false;
    if (!(await saveState())) return;
    renderAll();
    toast("备份数据已恢复到云端");
  } catch (error) {
    toast(error.message || "导入失败，请检查文件格式", "error");
  } finally {
    $("#importJsonInput").value = "";
  }
}

function toast(message, type = "success") {
  const element = document.createElement("div");
  element.className = `toast ${type === "error" ? "error" : ""}`;
  element.textContent = message;
  $("#toastRegion").appendChild(element);
  setTimeout(() => element.remove(), 2800);
}

function bindEvents() {
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $$('[data-jump-view]').forEach((button) => button.addEventListener("click", () => switchView(button.dataset.jumpView)));
  $("#menuButton").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#dashboardDate").addEventListener("change", renderDashboard);
  $("#quickRecordButton").addEventListener("click", () => openRecordModal());
  $("#qianchuanAuthorizeForm").addEventListener("submit", handleQianchuanAuthorize);
  $("#qianchuanCustomerKey").addEventListener("input", (event) => event.target.setCustomValidity(""));
  $("#copyQianchuanLinkButton").addEventListener("click", copyQianchuanAuthorizationLink);
  $("#qianchuanDashboardAccessForm").addEventListener("submit", handleQianchuanDashboardAccess);
  $("#qianchuanDashboardKey").addEventListener("input", (event) => event.target.setCustomValidity(""));
  $("#qianchuanRefreshButton").addEventListener("click", loadQianchuanDashboard);
  $("#qianchuanCustomerSelect").addEventListener("change", loadQianchuanDashboard);
  $("#qianchuanLockButton").addEventListener("click", lockQianchuanDashboard);
  $("#addRechargeButton").addEventListener("click", () => activeRechargeLedger === "payment" ? openPaymentModal() : openRechargeModal());
  $("#addRecordButton").addEventListener("click", () => openRecordModal());
  $("#rechargeForm").addEventListener("submit", handleRechargeSubmit);
  $("#paymentForm").addEventListener("submit", handlePaymentSubmit);
  $("#campaignForm").addEventListener("submit", handleCampaignSubmit);
  $("#recordForm").addEventListener("submit", handleRecordSubmit);
  ["#recordSpend", "#recordClicks", "#recordOrders", "#recordRevenue"].forEach((selector) => $(selector).addEventListener("input", updateLiveMetrics));

  $$('[data-recharge-ledger]').forEach((button) => button.addEventListener("click", () => {
    activeRechargeLedger = button.dataset.rechargeLedger;
    renderRecharges();
  }));
  $("#rechargeAccountSearch").addEventListener("input", (event) => {
    const campaign = resolveRechargeAccount(event.target.value);
    $("#rechargeCampaign").value = campaign?.id || "";
    event.target.setCustomValidity("");
  });
  $("#paymentUploadButton").addEventListener("click", () => $("#paymentImageInput").click());
  $("#zhipuApiKey").addEventListener("input", (event) => saveZhipuApiKey(event.target.value));
  $("#paymentImageInput").addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) recognizePaymentImage(file);
    event.target.value = "";
  });
  $("#paymentUploadButton").addEventListener("dragover", (event) => {
    event.preventDefault();
    event.currentTarget.classList.add("dragging");
  });
  $("#paymentUploadButton").addEventListener("dragleave", (event) => event.currentTarget.classList.remove("dragging"));
  $("#paymentUploadButton").addEventListener("drop", (event) => {
    event.preventDefault();
    event.currentTarget.classList.remove("dragging");
    const [file] = [...event.dataTransfer.files].filter((item) => item.type.startsWith("image/"));
    if (file) recognizePaymentImage(file);
  });
  ["#recordSearch", "#recordStartDate", "#recordEndDate", "#recordPlatformFilter"].forEach((selector) => $(selector).addEventListener("input", renderRecords));

  $("#rechargeTableBody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const recharge = state.recharges.find((item) => item.id === button.dataset.id);
    if (button.dataset.action === "edit-ledger") recharge?.recordType === "payment" ? openPaymentModal(recharge) : openRechargeModal(recharge);
    if (button.dataset.action === "delete-ledger") deleteRecharge(button.dataset.id);
  });

  $("#recordTableBody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const record = state.records.find((item) => item.id === button.dataset.id);
    if (button.dataset.action === "edit-record") openRecordModal(record);
    if (button.dataset.action === "delete-record") deleteRecord(button.dataset.id);
  });

  $$('[data-close-modal]').forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.closeModal)));
  $$(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) closeModal(backdrop.id);
  }));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      $$(".modal-backdrop:not(.hidden)").forEach((modal) => closeModal(modal.id));
      if (!$("#confirmDialog").classList.contains("hidden")) resolveConfirm(false);
    }
  });

  $("#confirmCancel").addEventListener("click", () => resolveConfirm(false));
  $("#confirmAccept").addEventListener("click", () => resolveConfirm(true));
  $("#exportJsonButton").addEventListener("click", exportJson);
  $("#exportCsvButton").addEventListener("click", exportCsv);
  $("#importJsonInput").addEventListener("change", (event) => importJson(event.target.files[0]));
  $("#resetDemoButton").addEventListener("click", async () => {
    const confirmed = await askConfirm("恢复演示数据？", "云端数据将被演示计划和最近 7 天示例记录覆盖。", "恢复演示数据");
    if (!confirmed) return;
    state = migrateRechargeWorkflow(createDemoState()).state;
    if (!(await saveState())) return;
    renderAll();
    toast("云端已恢复演示数据");
  });
  $("#clearDataButton").addEventListener("click", async () => {
    const confirmed = await askConfirm("清空全部数据？", "所有云端账户、充值记录和消耗数据都会被删除，且无法恢复。建议先导出备份。", "确认清空");
    if (!confirmed) return;
    state = emptyState();
    if (!(await saveState())) return;
    renderAll();
    toast("云端数据已清空");
  });
  window.addEventListener("focus", refreshCloudState);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshCloudState();
  });
}

function initialize() {
  $("#dashboardDate").value = localDate();
  $("#recordStartDate").value = localDate(-6);
  $("#recordEndDate").value = localDate();
  bindEvents();
  renderAll();
  initializeQianchuanDashboard();
  cloudInitializationPromise = initializeCloud();
}

initialize();
