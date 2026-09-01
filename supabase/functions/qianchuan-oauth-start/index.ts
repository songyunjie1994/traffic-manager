import { allowedReturnTo, jsonResponse, signState } from "../_shared/qianchuan.ts";

const DEFAULT_RETURN_TO = "https://songyunjie1994.github.io/traffic-manager/";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, 405);

  try {
    const appId = Deno.env.get("QIANCHUAN_APP_ID") || "";
    const stateSecret = Deno.env.get("QIANCHUAN_STATE_SECRET") || "";
    if (!/^\d+$/.test(appId) || stateSecret.length < 32) throw new Error("server_not_configured");

    const requestUrl = new URL(request.url);
    const customer = (requestUrl.searchParams.get("customer") || "").trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(customer)) return jsonResponse({ error: "invalid_customer" }, 400);

    const allowedOrigins = (Deno.env.get("QIANCHUAN_ALLOWED_RETURN_ORIGINS") || "https://songyunjie1994.github.io")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const returnTo = allowedReturnTo(requestUrl.searchParams.get("return_to"), allowedOrigins, DEFAULT_RETURN_TO);
    const state = await signState({
      v: 1,
      customer,
      returnTo,
      nonce: crypto.randomUUID(),
      exp: Date.now() + 10 * 60 * 1000,
    }, stateSecret);

    const authorizationUrl = new URL("https://qianchuan.jinritemai.com/openapi/qc/audit/oauth.html");
    authorizationUrl.searchParams.set("app_id", appId);
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("material_auth", "1");
    return new Response(null, {
      status: 302,
      headers: { Location: authorizationUrl.toString(), "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("qianchuan_oauth_start_failed", error instanceof Error ? error.message : "unknown_error");
    return jsonResponse({ error: "authorization_start_failed" }, 500);
  }
});
