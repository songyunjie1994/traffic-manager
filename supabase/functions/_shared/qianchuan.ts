const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export async function signState(payload, secret) {
  const encodedPayload = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = encodeBase64Url(await hmac(encodedPayload, secret));
  return `${encodedPayload}.${signature}`;
}

export async function verifyState(value, secret, now = Date.now()) {
  const [encodedPayload, signature, extra] = String(value || "").split(".");
  if (!encodedPayload || !signature || extra) throw new Error("invalid_state");
  const expected = encodeBase64Url(await hmac(encodedPayload, secret));
  if (!constantTimeEqual(signature, expected)) throw new Error("invalid_state");
  const payload = JSON.parse(decoder.decode(decodeBase64Url(encodedPayload)));
  if (!payload || payload.v !== 1 || typeof payload.exp !== "number" || payload.exp < now) throw new Error("expired_state");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(payload.customer || "")) throw new Error("invalid_customer");
  return payload;
}

export function allowedReturnTo(value, allowedOrigins, fallback) {
  const candidate = new URL(value || fallback);
  if (!allowedOrigins.includes(candidate.origin)) throw new Error("invalid_return_to");
  candidate.hash = "";
  return candidate.toString();
}

export function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export function redirectWithResult(returnTo, values) {
  const target = new URL(returnTo);
  Object.entries(values).forEach(([key, value]) => target.searchParams.set(key, String(value)));
  return new Response(null, { status: 302, headers: { Location: target.toString(), "Cache-Control": "no-store" } });
}
