const ZHIPU_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const DEFAULT_MODEL = "glm-4v-flash";
const RECEIPT_BUCKET = "payment-receipts";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const RATE_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT = 12;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DEFAULT_ALLOWED_ORIGINS = [
  "https://songyunjie1994.github.io",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
];
const VISION_PROMPT = `这是付款或转账截图。请识别并只输出一个 JSON 对象，不要输出其他文字：
{"date":"YYYY-MM-DD","receivedCnyAmount":数字,"foreignDebitAmount":数字,"foreignDebitCurrency":"USD","cnyPerForeignUnit":数字,"payer":"付款方名称","payerBank":"付款方银行","payerAccount":"付款方账号","payee":"收款方名称","payeeBank":"收款方银行","payeeAccount":"收款方账号"}。
金额规则非常重要：receivedCnyAmount 只能填写收款方实际收到、“付给收款方”或人民币到账的金额，CNY、CNH、RMB、人民币、¥、￥均视为人民币。foreignDebitAmount 只能填写付款方被扣除或“您支付”的外币金额；foreignDebitCurrency 填对应外币币种；cnyPerForeignUnit 统一填写 1 单位该外币可兑换的人民币数。绝对不能把 USD 等外币金额填入 receivedCnyAmount。例如“您支付 14,959.15 USD，付给收款方 100,000.00 CNH”，receivedCnyAmount 必须填 100000，foreignDebitAmount 填 14959.15，foreignDebitCurrency 填 USD。没有对应金额或汇率时数字字段填 0。date 填交易日期，没有则为空字符串；payer/payee 填户名或名称；银行填开户行或支付渠道；账号填银行卡号或支付账号；识别不到的文字字段一律为空字符串。`;

type RateBucket = { startedAt: number; count: number };
type RecognitionResult = {
  date: string;
  amount: number;
  currency: "CNY";
  payer: string;
  payerBank: string;
  payerAccount: string;
  payee: string;
  payeeBank: string;
  payeeAccount: string;
  confidence: number;
  imagePath?: string;
};

const rateBuckets = new Map<string, RateBucket>();

function configuredOrigins() {
  const configured = String(Deno.env.get("PAYMENT_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set(configured.length ? configured : DEFAULT_ALLOWED_ORIGINS);
}

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
}

function json(origin: string, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

function publishableKeys() {
  const keys: string[] = [];
  try {
    const parsed = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    Object.values(parsed).forEach((value) => {
      if (typeof value === "string" && value) keys.push(value);
    });
  } catch {
    // Hosted projects also expose the legacy anon key during migration.
  }
  const legacyKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacyKey) keys.push(legacyKey);
  return keys;
}

function callerIp(request: Request) {
  return String(
    request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-real-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0] ||
      "unknown",
  ).trim();
}

function isRateLimited(request: Request) {
  const now = Date.now();
  const limit = Math.max(1, Math.min(60, Number(Deno.env.get("PAYMENT_RATE_LIMIT_PER_MINUTE")) || DEFAULT_RATE_LIMIT));
  const key = callerIp(request);
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

function normalizeDate(value: unknown) {
  const text = String(value || "").trim();
  if (/^20\d{2}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  return match
    ? `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`
    : "";
}

function cleanText(value: unknown, maxLength = 80) {
  return String(value || "").trim().slice(0, maxLength);
}

function storageConfig() {
  const url = String(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const serviceKey = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
  if (!url || !serviceKey) throw new Error("STORAGE_NOT_CONFIGURED");
  return { url, serviceKey };
}

function storageHeaders(contentType = "application/json") {
  const { serviceKey } = storageConfig();
  return {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    "Content-Type": contentType,
  };
}

function encodedStoragePath(path: string) {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

async function ensureReceiptBucket() {
  const { url } = storageConfig();
  const lookup = await fetch(`${url}/storage/v1/bucket/${RECEIPT_BUCKET}`, { headers: storageHeaders() });
  if (lookup.ok) return;
  const lookupText = cleanText(await lookup.text(), 160);
  const bucketMissing = lookup.status === 404 || /NoSuchBucket|Bucket_not_found/i.test(lookupText);
  if (!bucketMissing) {
    const detail = lookupText.replace(/\s+/g, "_");
    throw new Error(`STORAGE_BUCKET_LOOKUP_FAILED_${lookup.status}_${detail}`);
  }
  const created = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: storageHeaders(),
    body: JSON.stringify({
      id: RECEIPT_BUCKET,
      name: RECEIPT_BUCKET,
      public: false,
      file_size_limit: MAX_IMAGE_BYTES,
      allowed_mime_types: [...ALLOWED_IMAGE_TYPES],
    }),
  });
  if (!created.ok && created.status !== 409) {
    const detail = cleanText(await created.text(), 160).replace(/\s+/g, "_");
    throw new Error(`STORAGE_BUCKET_CREATE_FAILED_${created.status}_${detail}`);
  }
}

async function storeReceiptImage(mimeType: string, base64: string) {
  await ensureReceiptBucket();
  const { url } = storageConfig();
  const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const path = `payments/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
  const bytes = Uint8Array.from(atob(base64.replace(/\s/g, "")), (character) => character.charCodeAt(0));
  const response = await fetch(`${url}/storage/v1/object/${RECEIPT_BUCKET}/${encodedStoragePath(path)}`, {
    method: "POST",
    headers: { ...storageHeaders(mimeType), "x-upsert": "false", "cache-control": "3600" },
    body: bytes,
  });
  if (!response.ok) {
    const detail = cleanText(await response.text(), 160).replace(/\s+/g, "_");
    throw new Error(`STORAGE_UPLOAD_FAILED_${response.status}_${detail}`);
  }
  return path;
}

async function readReceiptImage(path: string) {
  if (!/^payments\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.(?:jpg|png|webp)$/.test(path)) return null;
  const { url } = storageConfig();
  const response = await fetch(`${url}/storage/v1/object/${RECEIPT_BUCKET}/${encodedStoragePath(path)}`, {
    headers: storageHeaders(),
  });
  return response.ok ? response : null;
}

function parseRecognition(answer: string): RecognitionResult | null {
  const text = answer.replace(/```json|```/gi, "").trim();
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText);
    const receivedCnyAmount = Number(String(parsed.receivedCnyAmount ?? "").replace(/[^\d.]/g, "")) || 0;
    const foreignDebitAmount = Number(String(parsed.foreignDebitAmount ?? "").replace(/[^\d.]/g, "")) || 0;
    const cnyPerForeignUnit = Number(String(parsed.cnyPerForeignUnit ?? "").replace(/[^\d.]/g, "")) || 0;
    const calculatedCnyAmount = foreignDebitAmount > 0 && cnyPerForeignUnit > 0
      ? Math.round(foreignDebitAmount * cnyPerForeignUnit * 100) / 100
      : 0;
    const amount = receivedCnyAmount > 0 ? receivedCnyAmount : calculatedCnyAmount;
    const result: RecognitionResult = {
      date: normalizeDate(parsed.date),
      amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
      currency: "CNY",
      payer: cleanText(parsed.payer),
      payerBank: cleanText(parsed.payerBank),
      payerAccount: cleanText(parsed.payerAccount, 48),
      payee: cleanText(parsed.payee),
      payeeBank: cleanText(parsed.payeeBank),
      payeeAccount: cleanText(parsed.payeeAccount, 48),
      confidence: 0,
    };
    const found = [result.date, result.amount, result.payer, result.payee].filter(Boolean).length;
    result.confidence = Math.round((found / 4) * 100);
    return found ? result : null;
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  const origin = String(request.headers.get("origin") || "");
  if (!configuredOrigins().has(origin)) {
    return json(origin || "null", 403, { error: "ORIGIN_NOT_ALLOWED" });
  }
  if (request.method === "OPTIONS") return json(origin, 200, { ok: true });
  if (request.method !== "POST") return json(origin, 405, { error: "METHOD_NOT_ALLOWED" });

  const suppliedKey = String(request.headers.get("apikey") || "");
  if (!suppliedKey || !publishableKeys().includes(suppliedKey)) {
    return json(origin, 401, { error: "INVALID_CLIENT_KEY" });
  }
  if (isRateLimited(request)) return json(origin, 429, { error: "RATE_LIMITED" });

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) return json(origin, 413, { error: "IMAGE_TOO_LARGE" });

  let body: { action?: unknown; imageDataUrl?: unknown; imagePath?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(origin, 400, { error: "INVALID_REQUEST" });
  }

  if (body.action === "get-image") {
    try {
      const storedImage = await readReceiptImage(cleanText(body.imagePath, 240));
      if (!storedImage) return json(origin, 404, { error: "IMAGE_NOT_FOUND" });
      return new Response(storedImage.body, {
        status: 200,
        headers: {
          ...corsHeaders(origin),
          "Content-Type": storedImage.headers.get("content-type") || "application/octet-stream",
          "Cache-Control": "private, max-age=300",
          "Content-Disposition": "inline",
        },
      });
    } catch (error) {
      console.error("Payment receipt read failed", error instanceof Error ? error.message : "UnknownError");
      return json(origin, 502, { error: "IMAGE_READ_FAILED" });
    }
  }

  const imageDataUrl = String(body?.imageDataUrl || "");
  const imageMatch = imageDataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!imageMatch || !ALLOWED_IMAGE_TYPES.has(imageMatch[1])) {
    return json(origin, 400, { error: "INVALID_IMAGE" });
  }
  const padding = imageMatch[2].endsWith("==") ? 2 : imageMatch[2].endsWith("=") ? 1 : 0;
  const estimatedBytes = Math.floor((imageMatch[2].length * 3) / 4) - padding;
  if (estimatedBytes <= 0 || estimatedBytes > MAX_IMAGE_BYTES) {
    return json(origin, 413, { error: "IMAGE_TOO_LARGE" });
  }

  const apiKey = String(Deno.env.get("ZHIPU_API_KEY") || "").trim();
  if (!apiKey) return json(origin, 503, { error: "AI_NOT_CONFIGURED" });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const model = String(Deno.env.get("ZHIPU_VISION_MODEL") || DEFAULT_MODEL).trim();
    const providerResponse = await fetch(ZHIPU_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageDataUrl } },
            { type: "text", text: VISION_PROMPT },
          ],
        }],
      }),
      signal: controller.signal,
    });

    if (!providerResponse.ok) {
      console.error("Payment AI provider request failed", providerResponse.status);
      if (providerResponse.status === 401) return json(origin, 502, { error: "AI_AUTH_FAILED" });
      if (providerResponse.status === 429) return json(origin, 429, { error: "AI_RATE_LIMITED" });
      return json(origin, 502, { error: "AI_REQUEST_FAILED" });
    }

    const providerData = await providerResponse.json();
    const answer = String(providerData?.choices?.[0]?.message?.content || "");
    const result = parseRecognition(answer);
    if (!result) return json(origin, 422, { error: "AI_OUTPUT_INVALID" });
    try {
      result.imagePath = await storeReceiptImage(imageMatch[1], imageMatch[2]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "UnknownError";
      console.error("Payment receipt upload failed", detail);
      return json(origin, 502, { error: "IMAGE_STORAGE_FAILED" });
    }
    return json(origin, 200, { result, model, recognitionVersion: "cny-v2" });
  } catch (error) {
    console.error("Payment AI function failed", error instanceof Error ? error.name : "UnknownError");
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return json(origin, timedOut ? 504 : 502, { error: timedOut ? "AI_TIMEOUT" : "AI_REQUEST_FAILED" });
  } finally {
    clearTimeout(timeout);
  }
});
