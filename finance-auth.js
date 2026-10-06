(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrafficFinanceAuth = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const KEY = 'traffic-finance-session-v1';
  function create(config, environment = globalThis) {
    const request = environment.fetch.bind(environment), storage = environment.localStorage;
    let session = null, refreshing = null, epoch = 0;
    const read = key => { try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; } };
    session = read(KEY);
    // Use only a still-valid console access token. Never rotate another app's
    // refresh token or read/record passwords, and keep sign-outs independent.
    if (!session && !environment.sessionStorage?.getItem('traffic-finance-signedout')) {
      const consoleSession = read('qca-console-session');
      if (consoleSession?.accessToken && consoleSession.expiresAt > Date.now() + 120000) session = { accessToken: consoleSession.accessToken, expiresAt: consoleSession.expiresAt, email: consoleSession.email };
    }
    function save(next) {
      session = next; epoch++;
      try { if (next?.refreshToken) storage.setItem(KEY, JSON.stringify(next)); else storage.removeItem(KEY); } catch { /* memory-only session */ }
    }
    const fromResponse = body => ({ accessToken: body.access_token, refreshToken: body.refresh_token, email: body.user?.email || '', expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000 });
    async function signIn(email, password) {
      const started = epoch;
      const response = await request(`${config.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: config.publishableKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      if (epoch !== started) throw Object.assign(new Error('登录状态已变化'), { code: 'login_required' });
      if (!response.ok || !body.access_token) throw new Error('登录失败，请检查采集中心管理员账号和密码');
      save(fromResponse(body));
      environment.sessionStorage?.removeItem('traffic-finance-signedout');
      return session;
    }
    async function token(force = false) {
      if (!session?.accessToken) throw Object.assign(new Error('请先登录采集中心管理员账号'), { code: 'login_required' });
      if (!force && session.expiresAt > Date.now() + 60000) return session.accessToken;
      if (!session.refreshToken) { save(null); throw Object.assign(new Error('登录已过期，请重新登录'), { code: 'login_required' }); }
      if (!refreshing) {
        const current = session, started = epoch;
        refreshing = (async () => {
          const response = await request(`${config.url}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: config.publishableKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: current.refreshToken }), signal: AbortSignal.timeout(15000) });
          const body = await response.json();
          if (epoch !== started) throw Object.assign(new Error('登录状态已变化'), { code: 'login_required' });
          if (!response.ok || !body.access_token) { save(null); throw Object.assign(new Error('登录已过期，请重新登录'), { code: 'login_required' }); }
          save(fromResponse(body)); return session.accessToken;
        })().finally(() => { refreshing = null; });
      }
      return refreshing;
    }
    async function cloud(action, payload = {}) {
      let requestEpoch;
      const call = async bearer => {
        requestEpoch = epoch;
        return request(`${config.url}/functions/v1/traffic-finance`, { method: 'POST', headers: { apikey: config.publishableKey, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }), cache: 'no-store', signal: AbortSignal.timeout(15000) });
      };
      let response = await call(await token());
      if (requestEpoch !== epoch) throw Object.assign(new Error('登录状态已变化，已忽略旧会话响应'), { code: 'login_required' });
      if (response.status === 401 && session?.refreshToken) response = await call(await token(true));
      if (requestEpoch !== epoch) throw Object.assign(new Error('登录状态已变化，已忽略旧会话响应'), { code: 'login_required' });
      if (response.status === 401 || response.status === 403) {
        save(null); throw Object.assign(new Error(response.status === 403 ? '此账号不是采集中心管理员，不能读取财务数据' : '登录已过期，请重新登录'), { code: 'login_required' });
      }
      if (!response.ok) throw new Error(`财务云端请求失败（${response.status}）`);
      const body = await response.json();
      if (requestEpoch !== epoch) throw Object.assign(new Error('登录状态已变化，未加载旧会话数据'), { code: 'login_required' });
      return body;
    }
    function signOut() {
      save(null);
      environment.sessionStorage?.setItem('traffic-finance-signedout', '1');
      try { storage.removeItem('traffic_manager_data_v1'); } catch { /* no cache */ }
    }
    return { signIn, signOut, token, cloud, hasSession: () => !!session?.accessToken, email: () => session?.email || '' };
  }
  return { create };
});
