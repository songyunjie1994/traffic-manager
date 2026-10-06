const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { create } = require('../finance-auth');
const config = { url: 'https://example.supabase.co', publishableKey: 'public-test-key' };
function harness(handler, existing = {}) {
  const store = new Map(Object.entries(existing));
  const localStorage = { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
  const env = { localStorage, sessionStorage: { getItem() {}, setItem() {}, removeItem() {} }, fetch: handler };
  return { auth: create(config, env), store };
}
const signedIn = token => ({ ok: true, status: 200, json: async () => ({ access_token: token, refresh_token: 'test-refresh', expires_in: 3600, user: { email: 'admin@example.test' } }) });
test('anonymous financial requests never send public key as authorization', async () => {
  let calls = 0; const { auth } = harness(async () => { calls++; });
  await assert.rejects(auth.cloud('read'), { code: 'login_required' }); assert.equal(calls, 0);
});
test('password is sent only to auth, not stored; business request uses user token', async () => {
  const { auth, store } = harness(async (url, options) => {
    if (url.includes('/auth/v1/token')) return signedIn('user-jwt-test');
    assert.equal(options.headers.Authorization, 'Bearer user-jwt-test');
    assert.equal(JSON.parse(options.body).action, 'read');
    return { ok: true, status: 200, json: async () => [{ data: { financeRecords: [] } }] };
  });
  await auth.signIn('admin@example.test', 'password-test-only'); await auth.cloud('read');
  assert.ok(!JSON.stringify([...store]).includes('password-test-only'));
});
test('non-admin authorization hides data and clears finance session', async () => {
  const { auth } = harness(async url => url.includes('/auth/v1/token') ? signedIn('user-jwt-test') : { ok: false, status: 403 });
  await auth.signIn('user@example.test', 'password-test-only');
  await assert.rejects(auth.cloud('read'), { code: 'login_required' }); assert.equal(auth.hasSession(), false);
});
test('401 refresh is single flight and retried once without anonymous fallback', async () => {
  let refreshes = 0;
  const { auth } = harness(async (url, options) => {
    if (url.includes('grant_type=password')) return signedIn('expired-test');
    if (url.includes('grant_type=refresh_token')) { refreshes++; return signedIn('refreshed-test'); }
    return options.headers.Authorization.includes('expired-test') ? { status: 401, ok: false } : { status: 200, ok: true, json: async () => [] };
  });
  await auth.signIn('admin@example.test', 'password-test-only'); await Promise.all([auth.cloud('read'), auth.cloud('read')]); assert.equal(refreshes, 1);
});
test('logout during in-flight read cannot show old session financial data', async () => {
  let finish;
  const { auth } = harness(async url => url.includes('/auth/v1/token') ? signedIn('user-test') : new Promise(resolve => { finish = resolve; }));
  await auth.signIn('admin@example.test', 'password-test-only');
  const read = auth.cloud('read'); await new Promise(resolve => setImmediate(resolve));
  auth.signOut(); finish({ ok: true, status: 200, json: async () => [{ private: true }] });
  await assert.rejects(read, { code: 'login_required' });
});
test('valid console login can be reused without rotating or storing its refresh token', async () => {
  const { auth, store } = harness(async () => ({ ok: true, status: 200, json: async () => [] }), {
    'qca-console-session': JSON.stringify({ accessToken: 'console-test', refreshToken: 'console-refresh-test', expiresAt: Date.now() + 3600000 })
  });
  assert.equal(await auth.token(), 'console-test'); await auth.cloud('read');
  assert.equal(store.has('traffic-finance-session-v1'), false);
  auth.signOut(); assert.ok(store.has('qca-console-session'));
});
test('source has no direct anonymous document/CAS or arbitrary receipt path', () => {
  const app = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');
  assert.doesNotMatch(app, /\/rest\/v1\/(?:app_data|rpc\/traffic_manager_compare_and_swap)/);
  assert.match(app, /action: "get-image", recordId/);
  assert.match(app, /financeAuth\.token\(\)/);
  assert.match(fs.readFileSync(require('node:path').join(__dirname, '../styles.css'), 'utf8'), /\[hidden\]\s*\{\s*display:\s*none !important/);
});
