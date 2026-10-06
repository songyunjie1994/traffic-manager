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
  console.log(JSON.stringify({ at: new Date().toISOString(), status: response.status, script, matches,
    sharedExport: remote.includes('financeExportNumber(account.walletSpend)'), unknownNotZero: remote.includes('financeMoney(value)') }));
  if (!matches || script !== 'app.js?v=2.8.2') process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
