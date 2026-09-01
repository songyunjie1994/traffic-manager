const OCEAN_ENGINE_API = "https://api.oceanengine.com";
const MAX_DATE_RANGE_DAYS = 31;
const REPORT_FIELDS = [
  "stat_cost",
  "all_order_pay_gmv_7days",
  "all_order_pay_roi_7days",
  "pay_order_amount",
  "prepay_and_pay_order_roi",
  "pay_order_count",
  "show_cnt",
  "click_cnt",
];

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function allowedOrigins() {
  return (Deno.env.get("QIANCHUAN_ALLOWED_RETURN_ORIGINS") || "https://songyunjie1994.github.io")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  if (!origin || !allowedOrigins().includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "content-type, x-dashboard-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

async function secureEqual(left, right) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(left || ""))),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(right || ""))),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let mismatch = 0;
  for (let index = 0; index < leftBytes.length; index += 1) mismatch |= leftBytes[index] ^ rightBytes[index];
  return mismatch === 0 && String(left || "").length > 0;
}

function requiredEnv(name) {
  const value = Deno.env.get(name) || "";
  if (!value) throw new Error("server_not_configured");
  return value;
}

function serviceHeaders() {
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${requiredEnv("SUPABASE_URL")}/rest/v1/${path}`, {
    ...options,
    headers: { ...serviceHeaders(), ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error("storage_request_failed");
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function oceanError(stage, result, status) {
  const error = new Error(`${stage}_failed`);
  error.stage = stage;
  error.code = String(result?.code ?? status ?? "unknown");
  return error;
}

async function oceanGet(path, accessToken, params = {}, tokenInQuery = false) {
  const url = new URL(`${OCEAN_ENGINE_API}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  });
  if (tokenInQuery) url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, {
    headers: tokenInQuery ? {} : { "Access-Token": accessToken },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || Number(result?.code) !== 0) throw oceanError(path, result, response.status);
  return result?.data || {};
}

async function oceanPost(path, body) {
  const response = await fetch(`${OCEAN_ENGINE_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || Number(result?.code) !== 0) throw oceanError(path, result, response.status);
  return result?.data || {};
}

function expiresAt(seconds) {
  return new Date(Date.now() + Math.max(0, Number(seconds || 0)) * 1000).toISOString();
}

async function getAuthorization(customerKey) {
  const rows = await supabaseRequest(
    `qianchuan_authorizations?select=customer_key,advertiser_ids,access_token,refresh_token,access_expires_at,refresh_expires_at,authorized_at,updated_at&customer_key=eq.${customerKey}&limit=1`,
  );
  if (!Array.isArray(rows) || !rows[0]) throw new Error("customer_not_found");
  return rows[0];
}

async function refreshAuthorization(record) {
  const refreshExpiry = new Date(record.refresh_expires_at).getTime();
  if (!Number.isFinite(refreshExpiry) || refreshExpiry <= Date.now()) throw new Error("authorization_expired");
  const accessExpiry = new Date(record.access_expires_at).getTime();
  if (Number.isFinite(accessExpiry) && accessExpiry > Date.now() + 10 * 60 * 1000) return record;

  const tokenData = await oceanPost("/open_api/oauth2/refresh_token/", {
    app_id: Number(requiredEnv("QIANCHUAN_APP_ID")),
    secret: requiredEnv("QIANCHUAN_APP_SECRET"),
    refresh_token: record.refresh_token,
  });
  if (!tokenData.access_token || !tokenData.refresh_token) throw new Error("token_refresh_failed");

  const updated = {
    ...record,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    access_expires_at: expiresAt(tokenData.expires_in),
    refresh_expires_at: expiresAt(tokenData.refresh_token_expires_in),
    updated_at: new Date().toISOString(),
  };
  await supabaseRequest(`qianchuan_authorizations?customer_key=eq.${record.customer_key}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      access_token: updated.access_token,
      refresh_token: updated.refresh_token,
      access_expires_at: updated.access_expires_at,
      refresh_expires_at: updated.refresh_expires_at,
      updated_at: updated.updated_at,
    }),
  });
  return updated;
}

function accountId(value) {
  const normalized = String(value ?? "").trim();
  if (!/^\d{1,19}$/.test(normalized)) return "";
  const numeric = Number(normalized);
  return Number.isSafeInteger(numeric) ? normalized : "";
}

function addAccount(accounts, value, name = "", source = "authorized") {
  const id = accountId(value);
  if (!id) return;
  const current = accounts.get(id);
  accounts.set(id, {
    advertiserId: id,
    advertiserName: String(name || current?.advertiserName || `千川账户 ${id}`),
    source: current?.source || source,
  });
}

async function getAuthorizedRoots(accessToken) {
  const data = await oceanGet("/open_api/oauth2/advertiser/get/", accessToken, {}, true);
  return Array.isArray(data.list) ? data.list.filter((item) => item?.is_valid !== false) : [];
}

async function getWorkbenchAccounts(accessToken, rootId) {
  const accounts = [];
  let page = 1;
  do {
    const data = await oceanGet("/open_api/v3.0/customer_center/account/list/", accessToken, {
      account_id: Number(rootId),
      filter: { account_type: "QIANCHUAN" },
      page,
      page_size: 100,
    });
    accounts.push(...(Array.isArray(data.accounts) ? data.accounts : []));
    const totalPage = Math.max(1, Number(data?.page_info?.total_page || 1));
    if (page >= totalPage || page >= 100) break;
    page += 1;
  } while (true);
  return accounts;
}

async function getShopAccounts(accessToken, shopId) {
  const accounts = [];
  let page = 1;
  do {
    const data = await oceanGet("/open_api/v1.0/qianchuan/shop/advertiser/list/", accessToken, {
      shop_id: Number(shopId),
      page,
      page_size: 100,
    });
    const current = Array.isArray(data.adv_id_list) && data.adv_id_list.length
      ? data.adv_id_list.map((item) => item?.adv_id)
      : (Array.isArray(data.list) ? data.list : []);
    accounts.push(...current);
    const totalPage = Math.max(1, Number(data?.page_info?.total_page || 1));
    if (page >= totalPage || page >= 100) break;
    page += 1;
  } while (true);
  return accounts;
}

async function fillAccountNames(accessToken, accounts) {
  const missingIds = [...accounts.values()]
    .filter((item) => !item.advertiserName || item.advertiserName.startsWith("千川账户 "))
    .map((item) => Number(item.advertiserId));
  for (let start = 0; start < missingIds.length; start += 100) {
    try {
      const data = await oceanGet("/open_api/2/advertiser/public_info/", accessToken, {
        advertiser_ids: missingIds.slice(start, start + 100),
      });
      const rows = Array.isArray(data) ? data : (Array.isArray(data.list) ? data.list : []);
      rows.forEach((row) => {
        const id = accountId(row?.id);
        if (id && accounts.has(id) && row?.name) accounts.get(id).advertiserName = String(row.name);
      });
    } catch (error) {
      console.error("qianchuan_account_name_lookup_failed", { code: error?.code || "unknown" });
    }
  }
}

async function discoverAccounts(record) {
  const accounts = new Map();
  (Array.isArray(record.advertiser_ids) ? record.advertiser_ids : []).forEach((id) => addAccount(accounts, id));
  const roots = await getAuthorizedRoots(record.access_token);
  const unsupportedTypes = new Set();

  for (const root of roots) {
    const id = accountId(root?.account_id ?? root?.advertiser_id);
    const type = String(root?.account_type || "");
    if (!id) continue;
    if (type === "CUSTOMER_ADMIN" || type === "CUSTOMER_OPERATOR") {
      const workbenchAccounts = await getWorkbenchAccounts(record.access_token, id);
      workbenchAccounts.forEach((item) => addAccount(accounts, item?.account_id, item?.account_name, "workbench"));
    } else if (type === "PLATFORM_ROLE_SHOP_ACCOUNT") {
      const shopAccounts = await getShopAccounts(record.access_token, id);
      shopAccounts.forEach((advertiserId) => addAccount(accounts, advertiserId, "", "shop"));
    } else if (type === "ADVERTISER") {
      addAccount(accounts, id, root?.account_name ?? root?.advertiser_name, "direct");
    } else {
      unsupportedTypes.add(type || "UNKNOWN");
    }
  }
  await fillAccountNames(record.access_token, accounts);
  return { accounts, roots, unsupportedTypes: [...unsupportedTypes] };
}

async function persistAdvertiserIds(customerKey, accounts) {
  await supabaseRequest(`qianchuan_authorizations?customer_key=eq.${customerKey}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ advertiser_ids: [...accounts.keys()].map(Number), updated_at: new Date().toISOString() }),
  });
}

function numberValue(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function emptyMetrics() {
  return { spend: 0, gmv: 0, roi: 0, directGmv: 0, directRoi: 0, orders: 0, impressions: 0, clicks: 0 };
}

function aggregateReport(rows) {
  const metrics = emptyMetrics();
  rows.forEach((row) => {
    metrics.spend += numberValue(row?.stat_cost);
    metrics.gmv += numberValue(row?.all_order_pay_gmv_7days);
    metrics.directGmv += numberValue(row?.pay_order_amount);
    metrics.orders += numberValue(row?.pay_order_count);
    metrics.impressions += numberValue(row?.show_cnt);
    metrics.clicks += numberValue(row?.click_cnt);
  });
  metrics.roi = metrics.spend > 0 ? metrics.gmv / metrics.spend : 0;
  metrics.directRoi = metrics.spend > 0 ? metrics.directGmv / metrics.spend : 0;
  return metrics;
}

async function getAccountReport(accessToken, account, startDate, endDate) {
  const data = await oceanGet("/open_api/v1.0/qianchuan/report/advertiser/get/", accessToken, {
    advertiser_id: Number(account.advertiserId),
    start_date: startDate,
    end_date: endDate,
    fields: REPORT_FIELDS,
    filtering: { marketing_goal: "ALL" },
    page: 1,
    page_size: 500,
  });
  return { ...account, ...aggregateReport(Array.isArray(data.list) ? data.list : []), status: "ok" };
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const output = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, values.length)) }, worker));
  return output;
}

function validateDateRange(startDate, endDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error("invalid_date_range");
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  const days = Math.floor((end - start) / 86400000) + 1;
  if (!Number.isFinite(days) || days < 1 || days > MAX_DATE_RANGE_DAYS) throw new Error("invalid_date_range");
}

async function listCustomers() {
  const rows = await supabaseRequest(
    "qianchuan_authorizations?select=customer_key,advertiser_ids,access_expires_at,refresh_expires_at,authorized_at,updated_at&order=updated_at.desc",
  );
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    customerKey: row.customer_key,
    accountCount: Array.isArray(row.advertiser_ids) ? row.advertiser_ids.length : 0,
    accessExpiresAt: row.access_expires_at,
    refreshExpiresAt: row.refresh_expires_at,
    authorizedAt: row.authorized_at,
    updatedAt: row.updated_at,
  }));
}

function safeError(error) {
  const key = error instanceof Error ? error.message : "request_failed";
  const allowed = new Set([
    "customer_not_found",
    "authorization_expired",
    "invalid_customer",
    "invalid_date_range",
    "server_not_configured",
  ]);
  return allowed.has(key) ? key : "upstream_request_failed";
}

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, cors);

  try {
    const dashboardKey = requiredEnv("QIANCHUAN_DASHBOARD_KEY");
    if (dashboardKey.length < 16) throw new Error("server_not_configured");
    if (!(await secureEqual(request.headers.get("X-Dashboard-Key") || "", dashboardKey))) {
      return jsonResponse({ error: "unauthorized" }, 401, cors);
    }

    const body = await request.json().catch(() => ({}));
    if (body?.action === "customers") return jsonResponse({ customers: await listCustomers() }, 200, cors);
    if (body?.action !== "dashboard") return jsonResponse({ error: "invalid_action" }, 400, cors);

    const customerKey = String(body?.customerKey || "").trim();
    const startDate = String(body?.startDate || "");
    const endDate = String(body?.endDate || "");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(customerKey)) throw new Error("invalid_customer");
    validateDateRange(startDate, endDate);

    const record = await refreshAuthorization(await getAuthorization(customerKey));
    const discovery = await discoverAccounts(record);
    await persistAdvertiserIds(customerKey, discovery.accounts);

    const reportRows = await mapWithConcurrency([...discovery.accounts.values()], 4, async (account) => {
      try {
        return await getAccountReport(record.access_token, account, startDate, endDate);
      } catch (error) {
        console.error("qianchuan_account_report_failed", {
          advertiserId: account.advertiserId,
          code: error?.code || "unknown",
        });
        return { ...account, ...emptyMetrics(), status: "error" };
      }
    });
    const successfulRows = reportRows.filter((row) => row.status === "ok");
    const summary = aggregateReport(successfulRows);

    return jsonResponse({
      customer: {
        customerKey,
        authorizedAt: record.authorized_at,
        accessExpiresAt: record.access_expires_at,
        refreshExpiresAt: record.refresh_expires_at,
      },
      dateRange: { startDate, endDate },
      summary: {
        ...summary,
        accountCount: reportRows.length,
        successfulAccountCount: successfulRows.length,
        failedAccountCount: reportRows.length - successfulRows.length,
      },
      accounts: reportRows.sort((left, right) => right.spend - left.spend),
      warnings: {
        unsupportedAuthorizationTypes: discovery.unsupportedTypes,
        partial: successfulRows.length !== reportRows.length,
      },
      refreshedAt: new Date().toISOString(),
    }, 200, cors);
  } catch (error) {
    console.error("qianchuan_dashboard_failed", {
      error: error instanceof Error ? error.message : "unknown",
      code: error?.code || "unknown",
    });
    const safe = safeError(error);
    const status = safe === "customer_not_found" ? 404 : safe.startsWith("invalid_") ? 400 : 502;
    return jsonResponse({ error: safe }, status, cors);
  }
});
