"use strict";

const STORAGE_KEY = "traffic_manager_data_v1";
const APP_VERSION = "2.1.0";
const CLOUD_ROW_ID = 2;
const RECHARGE_WORKFLOW_VERSION = "2026-08-29-v1";
// 早期版本会在首次迁移时补建这 6 个手工账户；现在账户全部来自千川采集，
// 用户已确认删除，这里留空避免它们被自动重建（2026-09-13）。
const REQUIRED_ACCOUNT_NAMES = [];
const RECHARGE_LEDGER_META = Object.freeze({
  recharge: { title: "充值记录", dateLabel: "充值日期", accountLabel: "充值账户", amountLabel: "充值金额", addLabel: "＋ 添加充值记录" },
  payment: { title: "付款记录", dateLabel: "付款日期", accountLabel: "付款方", amountLabel: "付款金额", addLabel: "＋ 上传付款截图" },
  pending: { title: "待付款", dateLabel: "登记日期", accountLabel: "待付款账户", amountLabel: "待付金额", addLabel: "" },
});
const ZHIPU_VISION_CONFIG = Object.freeze({
  // 识图统一走 Supabase 边缘函数（智谱 Key 存在服务端，前端不再持有 Key）
  url: "https://mabxdkjqilulkrmqrrgo.supabase.co/functions/v1/payment-recognize",
});
const CLOUD_CONFIG = Object.freeze({
  url: "https://mabxdkjqilulkrmqrrgo.supabase.co",
  publishableKey: "sb_publishable_lfHpd1y1gCaQIDXfRkD_8w_O1bPMWGx",
});
const PLATFORMS = ["巨量引擎", "千川", "小红书", "视频号", "快手", "百度", "其他"];
const VIEW_META = {
  dashboard: ["查看云端财务汇总与原始明细", "报表端"],
  campaigns: ["管理充值、付款与待付款记录", "充值端"],
  records: ["记录每日消耗和成交数据", "消耗端"],
  accounts: ["维护广告账户与所属投流中介", "账户配置"],
  backup: ["导出、恢复与管理云端数据", "数据备份"],
};

let state = loadState();
let confirmResolver = null;
let cloudReady = false;
let cloudInitializationPromise = null;
let lastCloudSnapshot = "";
let lastCloudRawState = null;
let lastCloudRefreshAt = 0;
let activeRechargeLedger = "recharge";
let paymentOcrResult = null;
let receiptImageObjectUrl = "";

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
    financeRecords: [],
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
    financeRecords: [],
    settings: { initializedAt: new Date().toISOString() },
  };
}

function normalizeState(candidate) {
  if (!candidate || !Array.isArray(candidate.campaigns) || !Array.isArray(candidate.records)) {
    throw new Error("文件不是有效的投流管理系统备份");
  }
  const { campaigns, recharges, records, financeRecords, settings, demo, version, ...rest } = candidate;
  return {
    version: APP_VERSION,
    demo: Boolean(demo),
    campaigns: campaigns.map((item) => ({ ...item })),
    recharges: Array.isArray(recharges) ? recharges.map((item) => ({ ...item })) : [],
    records: records.map((item) => ({ ...item })),
    financeRecords: Array.isArray(financeRecords) ? financeRecords.map((item) => ({ ...item, columns: item?.columns && typeof item.columns === "object" ? { ...item.columns } : {} })) : [],
    settings: settings && typeof settings === "object" ? settings : {},
    // 云端未知字段仍原样带回，避免整份状态回写时冲掉其他采集模块的数据。
    ...rest,
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
  if (!rows[0]?.data) return null;
  lastCloudRawState = structuredClone(rows[0].data);
  return normalizeState(rows[0].data);
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
  lastCloudRawState = structuredClone(rows[0]?.data || migrated);
  return rows[0]?.data ? normalizeState(rows[0].data) : migrated;
}

async function updateCloudState(candidate) {
  if (!lastCloudRawState) throw new Error("缺少云端版本快照，未保存修改");
  const expected = structuredClone(lastCloudRawState);
  const response = await fetch(`${CLOUD_CONFIG.url}/rest/v1/rpc/traffic_manager_compare_and_swap`, {
    method: "POST",
    headers: cloudHeaders(),
    body: JSON.stringify({ p_row_id: String(CLOUD_ROW_ID), p_expected: expected, p_next: candidate }),
  });
  if (!response.ok) throw new Error(`云端保存失败（${response.status}）`);
  if (await response.json() !== true) {
    const error = new Error("云端数据已被其他端修改，本次未覆盖");
    error.code = "cloud_conflict";
    throw error;
  }
  lastCloudRawState = structuredClone(candidate);
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
    if (error.code === "cloud_conflict") {
      try {
        const latest = await fetchCloudState();
        if (latest) {
          state = latest;
          cacheState(state);
          lastCloudSnapshot = JSON.stringify(state);
          lastCloudRefreshAt = Date.now();
          setCloudStatus("synced", "云端已更新");
          renderAll();
          return;
        }
      } catch (refreshError) { console.error(refreshError); }
    }
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
    if (error.code === "cloud_conflict") {
      let refreshed = false;
      try {
        const latest = await fetchCloudState();
        if (latest) {
          state = latest;
          cacheState(state);
          lastCloudSnapshot = JSON.stringify(state);
          lastCloudRefreshAt = Date.now();
          refreshed = true;
        }
      } catch (refreshError) { console.error(refreshError); }
      if (!refreshed && lastCloudSnapshot) state = normalizeState(JSON.parse(lastCloudSnapshot));
    } else if (lastCloudSnapshot) state = normalizeState(JSON.parse(lastCloudSnapshot));
    setCloudStatus(error.code === "cloud_conflict" ? "synced" : "offline", error.code === "cloud_conflict" ? "云端已更新" : "云端保存失败");
    console.error(error);
    renderAll();
    toast(error.code === "cloud_conflict" ? "云端数据已变化，本次修改未覆盖，请重新操作" : "云端保存失败，本次修改已回退", "error");
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
  renderBackup();
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

  // 投流中介下拉：来自账户里已填过的中介名（账户页筛选 + 消耗端筛选 + 表单建议）
  const brokers = [...new Set(state.campaigns.map((item) => String(item.broker || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh"));
  for (const [selector, allLabel] of [["#campaignBrokerFilter", "全部投流中介"], ["#recordBrokerFilter", "全部投流中介"]]) {
    const select = $(selector);
    if (!select) continue;
    const current = select.value;
    select.innerHTML = `<option value="all">${allLabel}</option>${brokers.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}`;
    select.value = brokers.includes(current) ? current : "all";
  }
  const brokerOptions = $("#campaignBrokerOptions");
  if (brokerOptions) brokerOptions.innerHTML = brokers.map((item) => `<option value="${escapeHtml(item)}"></option>`).join("");

  const financeAccountFilter = $("#financeAccountFilter");
  if (financeAccountFilter) {
    const current = financeAccountFilter.value;
    const accounts = [...new Map((state.financeRecords || []).map((item) => [financeAccountKey(item), financeAccountLabel(item)])).entries()]
      .filter(([key]) => key)
      .sort((a, b) => a[1].localeCompare(b[1], "zh"));
    financeAccountFilter.innerHTML = `<option value="all">全部账户</option>${accounts.map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join("")}`;
    financeAccountFilter.value = accounts.some(([key]) => key === current) ? current : "all";
  }

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

const FINANCE_COLUMN_ORDER = [
  "余额总消耗(元)", "非赠款消耗(元)", "赠款消耗(元)",
  "总余额(元)", "非赠款余额(元)", "赠款余额(元)",
  "总存入(元)", "总转入(元)", "总转出(元)",
  "共享钱包消耗(元)", "共享赠款消耗", "消返红包消耗(元)", "立减红包消耗(元)",
];

function financeAccountKey(record) {
  return String(record?.advertiserId || record?.campaignId || record?.advertiserName || "").trim();
}

function financeAccountLabel(record) {
  const campaign = campaignById(record?.campaignId);
  return String(record?.advertiserName || campaign?.name || campaign?.account || record?.advertiserId || "未命名账户").trim();
}

function financeNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? "").replaceAll(",", "").replaceAll("，", "").replace(/[^0-9.\-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function financeMetric(record, field, columnName) {
  if (record?.[field] !== undefined && record?.[field] !== null && record?.[field] !== "") return financeNumber(record[field]);
  return financeNumber(record?.columns?.[columnName]);
}

function filteredFinanceRecords() {
  const start = $("#financeStartDate")?.value || "";
  const end = $("#financeEndDate")?.value || "";
  const account = $("#financeAccountFilter")?.value || "all";
  return (state.financeRecords || []).filter((record) => {
    const date = String(record.date || record.columns?.日期 || "");
    return (!start || date >= start) && (!end || date <= end) && (account === "all" || financeAccountKey(record) === account);
  });
}

function financeDetailColumns(records) {
  const available = new Set(records.flatMap((record) => Object.keys(record.columns || {})).filter((key) => key && key !== "日期"));
  return [...FINANCE_COLUMN_ORDER.filter((key) => available.has(key)), ...[...available].filter((key) => !FINANCE_COLUMN_ORDER.includes(key)).sort((a, b) => a.localeCompare(b, "zh"))];
}

function financeAccountRows(records) {
  const groups = new Map();
  records.forEach((record) => {
    const key = financeAccountKey(record) || financeAccountLabel(record);
    const row = groups.get(key) || { key, label: financeAccountLabel(record), totalSpend: 0, nonGrantSpend: 0, giftSpend: 0, latest: null };
    row.totalSpend += financeMetric(record, "balanceTotalSpend", "余额总消耗(元)");
    row.nonGrantSpend += financeMetric(record, "nonGrantSpend", "非赠款消耗(元)");
    row.giftSpend += financeMetric(record, "giftSpend", "赠款消耗(元)");
    if (!row.latest || String(record.date || "") > String(row.latest.date || "")) row.latest = record;
    groups.set(key, row);
  });
  return [...groups.values()].sort((a, b) => b.totalSpend - a.totalSpend || a.label.localeCompare(b.label, "zh"));
}

function renderDashboard() {
  const badge = $("#dataModeBadge");
  if (badge) badge.textContent = cloudReady ? (state.demo ? "云端演示数据" : "云端数据") : "本地缓存";

  const allRecords = state.financeRecords || [];
  const allDates = allRecords.map((record) => String(record.date || record.columns?.日期 || "")).filter(Boolean).sort();
  if (allDates.length) {
    if (!$("#financeStartDate").value) $("#financeStartDate").value = allDates[0];
    if (!$("#financeEndDate").value) $("#financeEndDate").value = allDates[allDates.length - 1];
  }

  const rows = filteredFinanceRecords().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || financeAccountLabel(a).localeCompare(financeAccountLabel(b), "zh"));
  const accounts = financeAccountRows(rows);
  const totalSpend = rows.reduce((total, record) => total + financeMetric(record, "balanceTotalSpend", "余额总消耗(元)"), 0);
  const nonGrantSpend = rows.reduce((total, record) => total + financeMetric(record, "nonGrantSpend", "非赠款消耗(元)"), 0);
  const giftSpend = rows.reduce((total, record) => total + financeMetric(record, "giftSpend", "赠款消耗(元)"), 0);
  const start = $("#financeStartDate").value;
  const end = $("#financeEndDate").value;
  const rangeText = start || end ? `${start ? formatDate(start) : "最早"} — ${end ? formatDate(end) : "最新"}` : "全部日期";

  $("#dashboardSummary").textContent = rows.length ? `${rangeText}，共 ${accounts.length} 个账户、${rows.length} 条云端财务明细。` : "当前筛选范围暂无财务数据。";
  $("#financeRangeLabel").textContent = rangeText;
  $("#financeTotalSpend").textContent = money(totalSpend, 2);
  $("#financeNonGrantSpend").textContent = money(nonGrantSpend, 2);
  $("#financeGiftSpend").textContent = money(giftSpend, 2);
  $("#financeAccountCount").textContent = number(accounts.length);
  $("#financeRecordCount").textContent = `${number(rows.length)} 条财务明细`;

  $("#financeAccountSummaryBody").innerHTML = accounts.map((account) => {
    const latest = account.latest || {};
    const columns = latest.columns || {};
    return `<tr>
      <td class="cell-main"><span class="cell-value"><strong>${escapeHtml(account.label)}</strong>${latest.advertiserId ? `<small>${escapeHtml(latest.advertiserId)}</small>` : ""}</span></td>
      <td class="number-cell"><span class="cell-value">${money(account.totalSpend, 2)}</span></td>
      <td class="number-cell"><span class="cell-value">${money(account.nonGrantSpend, 2)}</span></td>
      <td class="number-cell"><span class="cell-value">${money(account.giftSpend, 2)}</span></td>
      <td class="number-cell"><span class="cell-value">${money(financeNumber(columns["总余额(元)"]), 2)}</span></td>
      <td class="number-cell"><span class="cell-value">${money(financeNumber(columns["非赠款余额(元)"]), 2)}</span></td>
      <td class="number-cell"><span class="cell-value">${money(financeNumber(columns["赠款余额(元)"]), 2)}</span></td>
      <td><span class="cell-value">${formatDate(latest.date || columns.日期)}</span></td>
    </tr>`;
  }).join("");

  const columns = financeDetailColumns(rows);
  $("#financeDetailHead").innerHTML = `<th>日期</th><th>广告账户</th>${columns.map((column) => `<th class="number-cell">${escapeHtml(column)}</th>`).join("")}`;
  $("#financeDetailBody").innerHTML = rows.map((record) => `<tr>
    <td>${formatDate(record.date || record.columns?.日期)}</td>
    <td class="cell-main"><strong>${escapeHtml(financeAccountLabel(record))}</strong></td>
    ${columns.map((column) => `<td class="number-cell">${money(financeNumber(record.columns?.[column]), 2)}</td>`).join("")}
  </tr>`).join("");

  const hasRows = rows.length > 0;
  $("#financeAccountPanel").classList.toggle("hidden", !hasRows);
  $("#financeDetailPanel").classList.toggle("hidden", !hasRows);
  $("#financeEmptyState").classList.toggle("hidden", hasRows);
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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

// 识图：POST 到 Supabase 边缘函数（服务端持有智谱 Key，并顺手把凭证图存进私有空间）
async function callPaymentRecognition(dataUrl) {
  const response = await fetch(ZHIPU_VISION_CONFIG.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CLOUD_CONFIG.publishableKey,
    },
    body: JSON.stringify({ imageDataUrl: dataUrl }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessages = {
      AI_NOT_CONFIGURED: "云端 AI Key 尚未配置，请联系管理员",
      AI_AUTH_FAILED: "云端 AI Key 无效或已过期",
      AI_RATE_LIMITED: "AI 调用过于频繁，请稍后再试",
      RATE_LIMITED: "上传过于频繁，请稍后再试",
      INVALID_IMAGE: "图片格式无效，请重新选择",
      IMAGE_TOO_LARGE: "图片不能超过 8MB",
      IMAGE_STORAGE_FAILED: "凭证图片保存失败，请稍后重试",
      AI_OUTPUT_INVALID: "没有识别出完整付款信息，请换一张清晰截图",
      ORIGIN_NOT_ALLOWED: "当前网址不允许调用图片识别",
    };
    throw new Error(errorMessages[payload?.error] || "云端识别暂时不可用，请稍后重试");
  }
  if (!payload?.result || typeof payload.result !== "object") throw new Error("云端识别返回格式异常");
  return payload.result;
}

// 查看已保存的付款凭证（图片存在 Supabase 私有空间，按路径取回）
async function showPaymentReceiptImage(imagePath) {
  if (!imagePath) return;
  try {
    const response = await fetch(ZHIPU_VISION_CONFIG.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: CLOUD_CONFIG.publishableKey,
      },
      body: JSON.stringify({ action: "get-image", imagePath }),
    });
    if (!response.ok) throw new Error("凭证图片读取失败");
    const blob = await response.blob();
    if (receiptImageObjectUrl) URL.revokeObjectURL(receiptImageObjectUrl);
    receiptImageObjectUrl = URL.createObjectURL(blob);
    $("#receiptImage").src = receiptImageObjectUrl;
    showModal("receiptImageModal");
  } catch (error) {
    toast(error.message || "凭证图片读取失败", "error");
  }
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
  $("#paymentImageName").textContent = file.name;
  $("#paymentUploadButton").disabled = true;
  setPaymentOcrStatus("正在上传截图…", 0.2);
  try {
    const dataUrl = await fileToDataUrl(file);
    setPaymentOcrStatus("云端 AI 正在识别付款信息…", 0.5);
    const parsed = await callPaymentRecognition(dataUrl);
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
    setPaymentOcrStatus(missing.length ? `识别完成，请补充${missing.join("、")}` : "已按人民币金额识别，请确认后保存", 1, "success");
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
    // 付款记录：有凭证图显示「凭证」（可查看），没有则显示「补图片」
    const receiptAction = activeRechargeLedger === "payment"
      ? recharge.imagePath
        ? `<button class="small-action receipt-action" data-action="view-payment-image" data-id="${escapeHtml(recharge.id)}">凭证</button>`
        : `<button class="small-action receipt-action" data-action="attach-payment-image" data-id="${escapeHtml(recharge.id)}">补图片</button>`
      : "";
    const actions = activeRechargeLedger !== "pending" ? `<div class="table-actions">${receiptAction}<button class="small-action" data-action="edit-ledger" data-id="${escapeHtml(recharge.id)}">编辑</button><button class="small-action delete" data-action="delete-ledger" data-id="${escapeHtml(recharge.id)}">删除</button></div>` : "—";
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
  const broker = $("#campaignBrokerFilter") ? $("#campaignBrokerFilter").value : "all";
  const rows = state.campaigns.filter((item) => {
    const haystack = [item.name, item.account, item.owner, item.broker].join(" ").toLowerCase();
    return (!query || haystack.includes(query))
      && (platform === "all" || item.platform === platform)
      && (status === "all" || item.status === status)
      && (broker === "all" || String(item.broker || "") === broker);
  });
  const spendByCampaign = new Map();
  for (const record of state.records) {
    const key = String(record.campaignId || "");
    const metrics = recordMetrics(record);
    spendByCampaign.set(key, (spendByCampaign.get(key) || 0) + metrics.totalSpend);
  }
  $("#campaignTableBody").innerHTML = rows.map((campaign) => `
    <tr>
      <td>${campaignNameCell(campaign, `开始于 ${formatDate(campaign.startDate)}`)}</td>
      <td>${escapeHtml(campaign.platform || "—")}</td>
      <td>${campaign.broker ? `<span class="broker-tag">${escapeHtml(campaign.broker)}</span>` : `<span class="muted-cell">未填写</span>`}</td>
      <td class="number-cell">${money(spendByCampaign.get(campaign.id) || 0, 2)}</td>
      <td>${escapeHtml(campaign.owner || "—")}</td>
      <td>${statusBadge(campaign.status)}</td>
      <td class="action-cell">
        <div class="table-actions">
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
  const broker = $("#recordBrokerFilter") ? $("#recordBrokerFilter").value : "all";
  return state.records.filter((record) => {
    const campaign = campaignById(record.campaignId);
    const haystack = [campaign?.name, campaign?.account, record.notes].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (!start || record.date >= start) && (!end || record.date <= end) && (platform === "all" || campaign?.platform === platform) && (broker === "all" || String(campaign?.broker || "") === broker);
  });
}

// 消耗端统一口径：日期 / 达人昵称 / 抖音号 / 整体ROI / 整体消耗 / 整体成交金额 / 净ROI / 净成交金额
// 新数据直接取千川同步写入的字段；旧数据从 spend/revenue 兜底换算，保证不显示空白。
function recordMetrics(record) {
  const totalSpend = Number(record.totalSpend ?? record.spend ?? 0) || 0;
  const totalRevenue = Number(record.totalRevenue ?? record.revenue ?? 0) || 0;
  const netRevenue = Number(record.netRevenue ?? 0) || 0;
  const roi = record.roi != null ? Number(record.roi) : (totalSpend > 0 ? totalRevenue / totalSpend : 0);
  const netRoi = record.netRoi != null ? Number(record.netRoi) : (totalSpend > 0 ? netRevenue / totalSpend : 0);
  return { totalSpend, totalRevenue, netRevenue, roi: Number.isFinite(roi) ? roi : 0, netRoi: Number.isFinite(netRoi) ? netRoi : 0 };
}

// 消耗端展示口径（2026-09-12）：同一天 + 同达人昵称 + 同抖音号的多条记录
// （来自不同账户或不同投放口径）合并成一行展示，数值相加、ROI 用合计重算；
// 整行为 0 的记录（该日期本来就没有数据）不展示。
function displayRecordGroups(rows) {
  const groups = new Map();
  for (const record of rows) {
    const metrics = recordMetrics(record);
    if (!metrics.totalSpend && !metrics.totalRevenue && !metrics.netRevenue) continue;
    const key = [record.date, record.douyinName || "", record.douyinNumber || ""].join("|");
    const group = groups.get(key) || {
      key,
      date: record.date,
      douyinName: record.douyinName || "",
      douyinNumber: record.douyinNumber || "",
      ids: [],
      totalSpend: 0,
      totalRevenue: 0,
      netRevenue: 0,
    };
    group.ids.push(record.id);
    group.totalSpend += metrics.totalSpend;
    group.totalRevenue += metrics.totalRevenue;
    group.netRevenue += metrics.netRevenue;
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    roi: group.totalSpend > 0 ? group.totalRevenue / group.totalSpend : 0,
    netRoi: group.totalSpend > 0 ? group.netRevenue / group.totalSpend : 0,
  }));
}

function renderRecords() {
  const groups = displayRecordGroups(filteredRecords());
  const totalSpend = groups.reduce((acc, item) => acc + item.totalSpend, 0);
  const totalRevenue = groups.reduce((acc, item) => acc + item.totalRevenue, 0);
  const netRevenue = groups.reduce((acc, item) => acc + item.netRevenue, 0);
  const totalRoi = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const totalNetRoi = totalSpend > 0 ? netRevenue / totalSpend : 0;
  const summary = [
    ["整体消耗", money(totalSpend)],
    ["整体成交金额", money(totalRevenue)],
    ["整体ROI", totalRoi.toFixed(2)],
    ["净成交金额", money(netRevenue)],
    ["净ROI", totalNetRoi.toFixed(2)],
  ];
  $("#recordSummary").innerHTML = summary.map(([label, value]) => `<div class="summary-chip"><span>${label}</span><strong>${value}</strong></div>`).join("");

  $("#recordTableBody").innerHTML = groups.map((group) => {
    const { totalSpend: spend, totalRevenue: revenue, netRevenue: net, roi, netRoi } = group;
    const merged = group.ids.length > 1;
    // data-label 供手机端把每行折成卡片时显示字段名（PC 端表格不显示）
    const actions = merged
      ? `<span class="merge-badge">合并 ${group.ids.length} 条</span>
         <button class="small-action delete" data-action="delete-record" data-ids="${escapeHtml(group.ids.join(","))}">删除</button>`
      : `<button class="small-action" data-action="edit-record" data-id="${escapeHtml(group.ids[0])}">编辑</button>
         <button class="small-action delete" data-action="delete-record" data-ids="${escapeHtml(group.ids[0])}">删除</button>`;
    return `
      <tr>
        <td data-label="日期"><span class="cell-value">${formatDate(group.date)}</span></td>
        <td data-label="达人昵称" class="cell-main"><span class="cell-value">${escapeHtml(group.douyinName || "—")}</span></td>
        <td data-label="抖音号"><span class="cell-value">${escapeHtml(group.douyinNumber || "—")}</span></td>
        <td data-label="整体ROI" class="number-cell"><span class="cell-value"><span class="roi-value ${roi >= 1 ? "roi-good" : "roi-warn"}">${roi.toFixed(2)}</span></span></td>
        <td data-label="整体消耗" class="number-cell"><span class="cell-value">${money(spend, 2)}</span></td>
        <td data-label="整体成交金额" class="number-cell"><span class="cell-value">${money(revenue, 2)}</span></td>
        <td data-label="净ROI" class="number-cell"><span class="cell-value"><span class="roi-value ${netRoi >= 1 ? "roi-good" : "roi-warn"}">${netRoi.toFixed(2)}</span></span></td>
        <td data-label="净成交金额" class="number-cell"><span class="cell-value">${money(net, 2)}</span></td>
        <td data-label="操作" class="action-cell">
          <div class="table-actions">${actions}</div>
        </td>
      </tr>`;
  }).join("");
  $("#recordEmptyState").classList.toggle("hidden", groups.length > 0);
  $("#recordTableBody").closest(".table-scroll").classList.toggle("hidden", groups.length === 0);
}

function renderBackup() {
  const dataBytes = new Blob([JSON.stringify(state)]).size;
  const stats = [
    ["账户/计划", `${state.campaigns.length} 个`],
    ["充值/消耗/财务", `${state.recharges.length}/${state.records.length}/${(state.financeRecords || []).length} 条`],
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
  $("#campaignBroker").value = campaign?.broker || "";
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
  if (id === "receiptImageModal" && receiptImageObjectUrl) {
    URL.revokeObjectURL(receiptImageObjectUrl);
    receiptImageObjectUrl = "";
  }
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
    broker: $("#campaignBroker").value.trim(),
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
    amountCurrency: "CNY",
    // 识图时边缘函数会把凭证图存进 Supabase 私有空间，这里只记路径，列表里点「凭证」可查看
    imagePath: paymentOcrResult?.imagePath || existing?.imagePath || "",
    source: paymentOcrResult ? "supabase-vision" : (existing?.source || "manual"),
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

async function deleteRecords(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return;
  const confirmed = list.length > 1
    ? await askConfirm("删除这一行的合并数据？", `这一行由 ${list.length} 条记录合并展示（同一达人不同账户/口径），会一起删除，无法撤销。`, `删除 ${list.length} 条`)
    : await askConfirm("删除这条数据？", "删除后将影响对应日期的看板汇总，此操作无法撤销。", "删除数据");
  if (!confirmed) return;
  state.records = state.records.filter((item) => !list.includes(item.id));
  markAsRealData();
  if (!(await saveState())) return;
  renderAll();
  toast(list.length > 1 ? `已删除 ${list.length} 条合并数据` : "数据记录已删除");
}

async function deleteRecord(id) {
  return deleteRecords([id]);
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
  const groups = displayRecordGroups(filteredRecords());
  if (!groups.length) {
    toast("当前范围没有可导出的数据");
    return;
  }
  // 云端还没同步完时导出的是浏览器本地缓存，先明确提示，避免拿旧数据对账。
  if (!cloudReady && !confirm("云端数据还在加载，现在导出的是浏览器本地缓存，可能不是最新数据。仍要导出吗？")) return;
  const summary = groups.reduce((acc, item) => ({
    spend: acc.spend + item.totalSpend,
    revenue: acc.revenue + item.totalRevenue,
    net: acc.net + item.netRevenue,
  }), { spend: 0, revenue: 0, net: 0 });
  // 与界面口径一致：合并后的行 + 只保留有数据的日期
  const rows = [
    ["日期", "达人昵称", "抖音号", "整体ROI", "整体消耗", "整体成交金额", "净ROI", "净成交金额"],
    ...groups
      .slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.douyinName).localeCompare(String(b.douyinName)))
      .map((group) => [
        group.date,
        group.douyinName || "—",
        group.douyinNumber || "—",
        Number(group.roi.toFixed(4)),
        Number(group.totalSpend.toFixed(2)),
        Number(group.totalRevenue.toFixed(2)),
        Number(group.netRoi.toFixed(4)),
        Number(group.netRevenue.toFixed(2)),
      ]),
    [],
    ["合计", "", "", summary.spend > 0 ? Number((summary.revenue / summary.spend).toFixed(4)) : 0,
      Number(summary.spend.toFixed(2)), Number(summary.revenue.toFixed(2)),
      summary.spend > 0 ? Number((summary.net / summary.spend).toFixed(4)) : 0, Number(summary.net.toFixed(2))],
  ];
  // 第二张表保留未合并的原始记录，便于对账追溯
  const raw = [
    ["日期", "达人昵称", "抖音号", "整体消耗", "整体成交金额", "净成交金额", "记录ID", "广告账户ID"],
    ...filteredRecords()
      .slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map((record) => {
        const metrics = recordMetrics(record);
        return [
          record.date,
          record.douyinName || "—",
          record.douyinNumber || "—",
          Number(metrics.totalSpend.toFixed(2)),
          Number(metrics.totalRevenue.toFixed(2)),
          Number(metrics.netRevenue.toFixed(2)),
          String(record.id || ""),
          String(record.advertiserId || (campaignById(record.campaignId) || {}).advertiserId || ""),
        ];
      }),
  ];
  if (!window.TrafficExcel?.downloadWorkbook) {
    toast("Excel 组件未加载，请刷新页面后重试");
    return;
  }
  window.TrafficExcel.downloadWorkbook(`投流消耗-${localDate()}.xlsx`, [
    { name: "消耗端", rows },
    { name: "原始明细", rows: raw },
  ]);
  toast(`已导出 Excel（${groups.length} 行，另附 ${raw.length - 1} 条原始明细）`);
}

function exportFinanceExcel() {
  const records = filteredFinanceRecords().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || financeAccountLabel(a).localeCompare(financeAccountLabel(b), "zh"));
  if (!records.length) {
    toast("当前范围没有可导出的财务数据");
    return;
  }
  if (!cloudReady && !confirm("云端数据还在加载，现在导出的是浏览器本地缓存，可能不是最新数据。仍要导出吗？")) return;
  if (!window.TrafficExcel?.downloadWorkbook) {
    toast("Excel 组件未加载，请刷新页面后重试", "error");
    return;
  }

  const accounts = financeAccountRows(records);
  const columns = financeDetailColumns(records);
  const summaryRows = [
    ["广告账户", "财务总消耗", "非赠款消耗", "赠款消耗", "最新总余额", "非赠款余额", "赠款余额", "余额日期"],
    ...accounts.map((account) => {
      const latest = account.latest || {};
      const source = latest.columns || {};
      return [
        account.label,
        Number(account.totalSpend.toFixed(2)),
        Number(account.nonGrantSpend.toFixed(2)),
        Number(account.giftSpend.toFixed(2)),
        Number(financeNumber(source["总余额(元)"]).toFixed(2)),
        Number(financeNumber(source["非赠款余额(元)"]).toFixed(2)),
        Number(financeNumber(source["赠款余额(元)"]).toFixed(2)),
        latest.date || source.日期 || "",
      ];
    }),
    [],
    [
      "合计",
      Number(records.reduce((total, record) => total + financeMetric(record, "balanceTotalSpend", "余额总消耗(元)"), 0).toFixed(2)),
      Number(records.reduce((total, record) => total + financeMetric(record, "nonGrantSpend", "非赠款消耗(元)"), 0).toFixed(2)),
      Number(records.reduce((total, record) => total + financeMetric(record, "giftSpend", "赠款消耗(元)"), 0).toFixed(2)),
      "", "", "", "",
    ],
  ];
  const detailRows = [
    ["日期", "广告账户", ...columns],
    ...records.map((record) => [
      record.date || record.columns?.日期 || "",
      financeAccountLabel(record),
      ...columns.map((column) => Number(financeNumber(record.columns?.[column]).toFixed(2))),
    ]),
  ];
  window.TrafficExcel.downloadWorkbook(`财务报表-${localDate()}.xlsx`, [
    { name: "财务汇总", rows: summaryRows },
    { name: "财务明细", rows: detailRows },
  ]);
  toast(`已导出 ${accounts.length} 个账户、${records.length} 条财务明细`);
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
  ["#financeStartDate", "#financeEndDate", "#financeAccountFilter"].forEach((selector) => $(selector).addEventListener("change", renderDashboard));
  $("#exportFinanceButton").addEventListener("click", exportFinanceExcel);
  $("#quickRecordButton").addEventListener("click", () => openRecordModal());
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
  ["#recordSearch", "#recordStartDate", "#recordEndDate", "#recordPlatformFilter", "#recordBrokerFilter"].forEach((selector) => {
    const element = $(selector);
    if (element) element.addEventListener("input", renderRecords);
  });

  // 账户配置页：新建/编辑/删除账户 + 筛选（账户里维护"投流中介"，消耗端可按中介筛）
  const addCampaignButton = $("#addCampaignButton");
  if (addCampaignButton) addCampaignButton.addEventListener("click", () => openCampaignModal());
  ["#campaignSearch", "#campaignPlatformFilter", "#campaignStatusFilter", "#campaignBrokerFilter"].forEach((selector) => {
    const element = $(selector);
    if (element) element.addEventListener("input", renderCampaigns);
  });
  const campaignTableBody = $("#campaignTableBody");
  if (campaignTableBody) campaignTableBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    if (button.dataset.action === "edit-campaign") {
      const campaign = campaignById(button.dataset.id);
      if (campaign) openCampaignModal(campaign);
    }
    if (button.dataset.action === "delete-campaign") deleteCampaign(button.dataset.id);
  });

  $("#rechargeTableBody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const recharge = state.recharges.find((item) => item.id === button.dataset.id);
    if (button.dataset.action === "edit-ledger") recharge?.recordType === "payment" ? openPaymentModal(recharge) : openRechargeModal(recharge);
    if (button.dataset.action === "delete-ledger") deleteRecharge(button.dataset.id);
    if (button.dataset.action === "view-payment-image") showPaymentReceiptImage(recharge?.imagePath);
    if (button.dataset.action === "attach-payment-image" && recharge) openPaymentModal(recharge);
  });

  $("#recordTableBody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    if (button.dataset.action === "edit-record") {
      const record = state.records.find((item) => item.id === button.dataset.id);
      if (record) openRecordModal(record);
      return;
    }
    if (button.dataset.action === "delete-record") {
      deleteRecords(String(button.dataset.ids || button.dataset.id || "").split(","));
    }
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
  $("#financeStartDate").value = "";
  $("#financeEndDate").value = "";
  $("#recordStartDate").value = localDate(-6);
  $("#recordEndDate").value = localDate();
  bindEvents();
  renderAll();
  cloudInitializationPromise = initializeCloud();
}

initialize();
