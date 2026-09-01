import { jsonResponse, redirectWithResult, verifyState } from "../_shared/qianchuan.ts";

function expiresAt(seconds) {
  return new Date(Date.now() + Math.max(0, Number(seconds || 0)) * 1000).toISOString();
}

async function exchangeAuthorizationCode(appId, appSecret, authCode) {
  const response = await fetch("https://ad.oceanengine.com/open_api/oauth2/access_token/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: Number(appId), secret: appSecret, auth_code: authCode }),
  });
  const result = await response.json();
  if (!response.ok || Number(result?.code) !== 0 || !result?.data?.access_token || !result?.data?.refresh_token) {
    console.error("qianchuan_token_exchange_rejected", { status: response.status, code: result?.code, message: result?.message });
    throw new Error("token_exchange_failed");
  }
  return result.data;
}

async function saveAuthorization(customerKey, tokenData) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) throw new Error("storage_not_configured");

  const advertiserIds = Array.isArray(tokenData.advertiser_ids)
    ? tokenData.advertiser_ids
    : tokenData.advertiser_id
      ? [tokenData.advertiser_id]
      : [];
  const record = {
    customer_key: customerKey,
    advertiser_ids: advertiserIds,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    access_expires_at: expiresAt(tokenData.expires_in),
    refresh_expires_at: expiresAt(tokenData.refresh_token_expires_in),
    authorized_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const response = await fetch(`${supabaseUrl}/rest/v1/qianchuan_authorizations?on_conflict=customer_key`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(record),
  });
  if (!response.ok) {
    console.error("qianchuan_authorization_store_failed", { status: response.status });
    throw new Error("authorization_store_failed");
  }
  return advertiserIds.length;
}

Deno.serve(async (request) => {
  if (request.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, 405);
  const requestUrl = new URL(request.url);
  const stateValue = requestUrl.searchParams.get("state") || "";
  let state;

  try {
    const stateSecret = Deno.env.get("QIANCHUAN_STATE_SECRET") || "";
    state = await verifyState(stateValue, stateSecret);
  } catch (error) {
    console.error("qianchuan_callback_state_rejected", error instanceof Error ? error.message : "unknown_error");
    return jsonResponse({ error: "invalid_or_expired_state" }, 400);
  }

  const authCode = requestUrl.searchParams.get("auth_code") || "";
  if (!authCode) return redirectWithResult(state.returnTo, { qianchuan: "error", customer: state.customer, reason: "missing_auth_code" });

  try {
    const appId = Deno.env.get("QIANCHUAN_APP_ID") || "";
    const appSecret = Deno.env.get("QIANCHUAN_APP_SECRET") || "";
    if (!/^\d+$/.test(appId) || !appSecret) throw new Error("server_not_configured");
    const tokenData = await exchangeAuthorizationCode(appId, appSecret, authCode);
    const accountCount = await saveAuthorization(state.customer, tokenData);
    return redirectWithResult(state.returnTo, {
      qianchuan: "success",
      customer: state.customer,
      accounts: accountCount,
    });
  } catch (error) {
    console.error("qianchuan_callback_failed", error instanceof Error ? error.message : "unknown_error");
    return redirectWithResult(state.returnTo, { qianchuan: "error", customer: state.customer, reason: "callback_failed" });
  }
});
