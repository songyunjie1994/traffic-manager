const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const url = 'https://songyunjie1994.github.io/traffic-manager/';
  const response = await fetch(url + '?verify=' + Date.now(), { signal: AbortSignal.timeout(20000) });
  const html = await response.text();
  const script = html.match(/src="(app\.js\?v=[^"]+)"/)?.[1];
  const remote = await (await fetch(url + (script || 'app.js') + '&verify=' + Date.now(), { signal: AbortSignal.timeout(20000) })).text();
  const local = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const matches = remote.replace(/\r\n/g, '\n') === local.replace(/\r\n/g, '\n');
  const assets = [];
  for (const name of ['wallet-summary.js', 'finance-auth.js']) {
    const asset = html.match(new RegExp('src="(' + name.replace('.', '\\.') + '\\?v=[^"]+)"'))?.[1];
    if (!asset) throw Error('Protected frontend asset missing: ' + name);
    const expected = name === 'finance-auth.js' ? 'finance-auth.js?v=1.0.1' : 'wallet-summary.js?v=1.1.1';
    if (asset !== expected) process.exitCode = 1;
    const res = await fetch(url + asset + '&verify=' + Date.now(), { signal: AbortSignal.timeout(20000) });
    const body = await res.text();
    const same = body.replace(/\r\n/g, '\n') === fs.readFileSync(path.join(__dirname, '..', name), 'utf8').replace(/\r\n/g, '\n');
    assets.push({ asset, status: res.status, matches: same });
    if (res.status !== 200 || !same) process.exitCode = 1;
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), status: response.status, script, matches,
    assets,
    sharedExport: remote.includes('financeExportNumber(account.walletSpend)'), unknownNotZero: remote.includes('financeMoney(value)') }));
  if (!matches || script !== 'app.js?v=2.8.3') process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
