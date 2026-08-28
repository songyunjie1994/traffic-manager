"use strict";

const STORAGE_KEY = "traffic_manager_data_v1";
const APP_VERSION = "1.0.0";
const PLATFORMS = ["巨量引擎", "千川", "小红书", "视频号", "快手", "百度", "其他"];
const VIEW_META = {
  dashboard: ["REPORT CENTER", "报表端"],
  campaigns: ["RECHARGE CENTER", "充值端"],
  records: ["SPEND CENTER", "消耗端"],
  backup: ["DATA CONTROL", "数据备份"],
};

let state = loadState();
let confirmResolver = null;

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

  const recharges = [
    { id: "chg-001", date: localDate(-8), campaignId: "cmp-001", amount: 15000, channel: "对公转账", status: "已到账", reference: "PAY-DEMO-0820-001", operator: "林晓", notes: "月初预算充值", createdAt: new Date().toISOString() },
    { id: "chg-002", date: localDate(-7), campaignId: "cmp-002", amount: 12000, channel: "平台代理充值", status: "已到账", reference: "AG-DEMO-0821-016", operator: "周楠", notes: "含代理返点", createdAt: new Date().toISOString() },
    { id: "chg-003", date: localDate(-5), campaignId: "cmp-003", amount: 8000, channel: "支付宝", status: "已到账", reference: "ALI-DEMO-0823-008", operator: "陈然", notes: "", createdAt: new Date().toISOString() },
    { id: "chg-004", date: localDate(-4), campaignId: "cmp-004", amount: 6000, channel: "微信支付", status: "已到账", reference: "WX-DEMO-0824-022", operator: "林晓", notes: "直播间专项预算", createdAt: new Date().toISOString() },
    { id: "chg-005", date: localDate(), campaignId: "cmp-001", amount: 10000, channel: "对公转账", status: "已到账", reference: "PAY-DEMO-TODAY-003", operator: "林晓", notes: "追加预算", createdAt: new Date().toISOString() },
    { id: "chg-006", date: localDate(), campaignId: "cmp-003", amount: 5000, channel: "支付宝", status: "待确认", reference: "ALI-DEMO-TODAY-011", operator: "陈然", notes: "等待平台开户确认", createdAt: new Date().toISOString() },
  ];

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

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeState(JSON.parse(saved));
  } catch (error) {
    console.warn("读取本地数据失败，已加载演示数据", error);
  }
  const demo = createDemoState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(demo));
  return demo;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

function campaignById(id) {
  return state.campaigns.find((item) => item.id === id);
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

  ["#campaignPlatformFilter", "#recordPlatformFilter", "#rechargePlatformFilter"].forEach((selector) => {
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
  rechargeSelect.innerHTML = activeFirst.length
    ? activeFirst.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.platform)}</option>`).join("")
    : `<option value="">请先新建广告账户/投流计划</option>`;
  if (state.campaigns.some((item) => item.id === currentRechargeCampaign)) rechargeSelect.value = currentRechargeCampaign;
}

function renderDashboard() {
  const date = $("#dashboardDate").value || localDate();
  const todayRecords = recordsForDate(date);
  const previousRecords = recordsForDate(offsetDate(date, -1));
  const todayRecharges = state.recharges.filter((item) => item.date === date);
  const previousRecharges = state.recharges.filter((item) => item.date === offsetDate(date, -1));
  const cumulativeRecharges = state.recharges.filter((item) => item.date <= date && item.status === "已到账");
  const cumulativeRecords = state.records.filter((item) => item.date <= date);
  const recharge = sum(todayRecharges.filter((item) => item.status === "已到账"), "amount");
  const previousRecharge = sum(previousRecharges.filter((item) => item.status === "已到账"), "amount");
  const pendingRecharge = sum(todayRecharges.filter((item) => item.status === "待确认"), "amount");
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
      label: "当日到账充值",
      icon: "+",
      value: money(recharge),
      note: pendingRecharge ? `<span class="trend-down">待确认 ${money(pendingRecharge)}</span>` : trendNote(recharge, previousRecharge, "较前一日"),
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
      note: `<span>累计到账减累计消耗</span>`,
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
  $("#dataModeBadge").textContent = state.demo ? "演示数据" : "本地数据";

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
    const recharges = state.recharges.filter((item) => item.date === date && item.status === "已到账");
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
    const metrics = grouped.get(campaign.id);
    const accountRecharge = sum(state.recharges.filter((item) => item.campaignId === campaign.id && item.date <= date && item.status === "已到账"), "amount");
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
    const recharge = sum(state.recharges.filter((item) => item.campaignId === campaign.id && item.date <= date && item.status === "已到账"), "amount");
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
  const query = $("#rechargeSearch").value.trim().toLowerCase();
  const start = $("#rechargeStartDate").value;
  const end = $("#rechargeEndDate").value;
  const platform = $("#rechargePlatformFilter").value;
  const status = $("#rechargeStatusFilter").value;
  return state.recharges.filter((recharge) => {
    const campaign = campaignById(recharge.campaignId);
    const haystack = [campaign?.name, campaign?.account, recharge.reference, recharge.operator, recharge.notes].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (!start || recharge.date >= start) && (!end || recharge.date <= end) &&
      (platform === "all" || campaign?.platform === platform) && (status === "all" || recharge.status === status);
  }).sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

function renderRecharges() {
  const rows = filteredRecharges();
  const arrived = sum(rows.filter((item) => item.status === "已到账"), "amount");
  const pending = sum(rows.filter((item) => item.status === "待确认"), "amount");
  const rejected = sum(rows.filter((item) => item.status === "已驳回"), "amount");
  const summary = [
    ["筛选范围已到账", money(arrived)],
    ["待确认金额", money(pending)],
    ["已驳回金额", money(rejected)],
    ["充值笔数", `${rows.length} 笔`],
  ];
  $("#rechargeSummary").innerHTML = summary.map(([label, value]) => `<div class="summary-chip"><span>${label}</span><strong>${value}</strong></div>`).join("");
  $("#rechargeTableBody").innerHTML = rows.map((recharge) => {
    const campaign = campaignById(recharge.campaignId);
    return `<tr>
      <td>${formatDate(recharge.date)}</td>
      <td>${campaign ? campaignNameCell(campaign, recharge.notes || campaign.account) : `<span>已删除的账户</span>`}</td>
      <td class="number-cell"><strong>${money(recharge.amount, 2)}</strong></td>
      <td>${escapeHtml(recharge.channel)}</td>
      <td>${escapeHtml(recharge.reference || "—")}</td>
      <td>${escapeHtml(recharge.operator || "—")}</td>
      <td>${statusBadge(recharge.status)}</td>
      <td class="action-cell"><div class="table-actions"><button class="small-action" data-action="edit-recharge" data-id="${escapeHtml(recharge.id)}">编辑</button><button class="small-action delete" data-action="delete-recharge" data-id="${escapeHtml(recharge.id)}">删除</button></div></td>
    </tr>`;
  }).join("");
  $("#rechargeEmptyState").classList.toggle("hidden", rows.length > 0);
  $("#rechargeTableBody").closest(".table-scroll").classList.toggle("hidden", rows.length === 0);
}

function renderCampaigns() {
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
  $("#rechargeForm").reset();
  $("#rechargeId").value = recharge?.id || "";
  $("#rechargeModalTitle").textContent = recharge ? "编辑充值记录" : "登记账户充值";
  $("#rechargeDate").value = recharge?.date || localDate();
  $("#rechargeCampaign").value = recharge?.campaignId || campaignId || state.campaigns[0].id;
  $("#rechargeAmount").value = recharge?.amount ?? "";
  $("#rechargeChannel").value = recharge?.channel || "对公转账";
  $("#rechargeStatus").value = recharge?.status || "已到账";
  $("#rechargeReference").value = recharge?.reference || "";
  $("#rechargeOperator").value = recharge?.operator || "";
  $("#rechargeNotes").value = recharge?.notes || "";
  showModal("rechargeModal");
  setTimeout(() => $("#rechargeAmount").focus(), 60);
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

function handleCampaignSubmit(event) {
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
  saveState();
  closeModal("campaignModal");
  renderAll();
  toast(id ? "账户/投流计划已更新" : "账户/投流计划已创建");
}

function handleRechargeSubmit(event) {
  event.preventDefault();
  const id = $("#rechargeId").value;
  const item = {
    id: id || uid("chg"),
    date: $("#rechargeDate").value,
    campaignId: $("#rechargeCampaign").value,
    amount: Number($("#rechargeAmount").value),
    channel: $("#rechargeChannel").value,
    status: $("#rechargeStatus").value,
    reference: $("#rechargeReference").value.trim(),
    operator: $("#rechargeOperator").value.trim(),
    notes: $("#rechargeNotes").value.trim(),
    createdAt: state.recharges.find((recharge) => recharge.id === id)?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (id) state.recharges = state.recharges.map((recharge) => recharge.id === id ? item : recharge);
  else state.recharges.unshift(item);
  markAsRealData();
  saveState();
  closeModal("rechargeModal");
  renderAll();
  toast(id ? "充值记录已更新" : "充值记录已保存");
}

function handleRecordSubmit(event) {
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
  saveState();
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
  saveState();
  renderAll();
  toast("账户/计划及关联数据已删除");
}

async function deleteRecharge(id) {
  const confirmed = await askConfirm("删除这笔充值？", "删除后将影响账户余额和报表汇总，此操作无法撤销。", "删除充值");
  if (!confirmed) return;
  state.recharges = state.recharges.filter((item) => item.id !== id);
  markAsRealData();
  saveState();
  renderAll();
  toast("充值记录已删除");
}

async function deleteRecord(id) {
  const confirmed = await askConfirm("删除这条数据？", "删除后将影响对应日期的看板汇总，此操作无法撤销。", "删除数据");
  if (!confirmed) return;
  state.records = state.records.filter((item) => item.id !== id);
  markAsRealData();
  saveState();
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
    const parsed = normalizeState(JSON.parse(await file.text()));
    const confirmed = await askConfirm("导入并覆盖当前数据？", `备份中包含 ${parsed.campaigns.length} 个账户、${parsed.recharges.length} 笔充值和 ${parsed.records.length} 条消耗。导入后当前数据会被覆盖。`, "确认导入");
    if (!confirmed) return;
    state = parsed;
    state.demo = false;
    saveState();
    renderAll();
    toast("备份数据已恢复");
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
  $("#addRechargeButton").addEventListener("click", () => openRechargeModal());
  $("#addCampaignButton").addEventListener("click", () => openCampaignModal());
  $("#addRecordButton").addEventListener("click", () => openRecordModal());
  $("#rechargeForm").addEventListener("submit", handleRechargeSubmit);
  $("#campaignForm").addEventListener("submit", handleCampaignSubmit);
  $("#recordForm").addEventListener("submit", handleRecordSubmit);
  ["#recordSpend", "#recordClicks", "#recordOrders", "#recordRevenue"].forEach((selector) => $(selector).addEventListener("input", updateLiveMetrics));

  ["#campaignSearch", "#campaignPlatformFilter", "#campaignStatusFilter"].forEach((selector) => $(selector).addEventListener("input", renderCampaigns));
  ["#rechargeSearch", "#rechargeStartDate", "#rechargeEndDate", "#rechargePlatformFilter", "#rechargeStatusFilter"].forEach((selector) => $(selector).addEventListener("input", renderRecharges));
  ["#recordSearch", "#recordStartDate", "#recordEndDate", "#recordPlatformFilter"].forEach((selector) => $(selector).addEventListener("input", renderRecords));

  $("#campaignTableBody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const campaign = campaignById(button.dataset.id);
    if (button.dataset.action === "edit-campaign") openCampaignModal(campaign);
    if (button.dataset.action === "recharge-campaign") openRechargeModal(null, button.dataset.id);
    if (button.dataset.action === "record-campaign") openRecordModal(null, button.dataset.id);
    if (button.dataset.action === "delete-campaign") deleteCampaign(button.dataset.id);
  });

  $("#rechargeTableBody").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const recharge = state.recharges.find((item) => item.id === button.dataset.id);
    if (button.dataset.action === "edit-recharge") openRechargeModal(recharge);
    if (button.dataset.action === "delete-recharge") deleteRecharge(button.dataset.id);
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
  $("#exportRechargeCsvButton").addEventListener("click", exportRechargeCsv);
  $("#exportCsvButton").addEventListener("click", exportCsv);
  $("#importJsonInput").addEventListener("change", (event) => importJson(event.target.files[0]));
  $("#resetDemoButton").addEventListener("click", async () => {
    const confirmed = await askConfirm("恢复演示数据？", "当前浏览器中的数据将被演示计划和最近 7 天示例记录覆盖。", "恢复演示数据");
    if (!confirmed) return;
    state = createDemoState();
    saveState();
    renderAll();
    toast("已恢复演示数据");
  });
  $("#clearDataButton").addEventListener("click", async () => {
    const confirmed = await askConfirm("清空全部数据？", "所有账户、充值记录和消耗数据都会从当前浏览器中删除，且无法恢复。建议先导出备份。", "确认清空");
    if (!confirmed) return;
    state = emptyState();
    saveState();
    renderAll();
    toast("全部数据已清空");
  });
}

function initialize() {
  $("#dashboardDate").value = localDate();
  $("#rechargeStartDate").value = localDate(-30);
  $("#rechargeEndDate").value = localDate();
  $("#recordStartDate").value = localDate(-6);
  $("#recordEndDate").value = localDate();
  bindEvents();
  renderAll();
}

initialize();
