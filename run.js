const { runAutomation, createAutomationRuntime } = require('./wantedly-automate');

const email = process.env.WANTEDLY_EMAIL;
const password = process.env.WANTEDLY_PASSWORD;
const urls = (process.env.WANTEDLY_URLS || '').split(',').map(u => u.trim()).filter(Boolean);

if (!email || !password) {
  console.error('GitHub Secrets に WANTEDLY_EMAIL と WANTEDLY_PASSWORD を設定してください');
  process.exit(1);
}

if (urls.length === 0) {
  console.error('WANTEDLY_URLS を指定してください');
  process.exit(1);
}

const config = {
  headless: true,
  chromeExecutablePath: process.env.CHROME_EXECUTABLE_PATH || '',
  proxyServer: process.env.PROXY_SERVER || '',
};
const automation = createAutomationRuntime(config);

const results = [];
const send = (type, data) => {
  if (type === 'log') console.log(data.text);
  if (type === 'result') results.push(data.data);
};

runAutomation({ accounts: [{ email, password }], urls, send, automation })
  .then(() => {
    const success = results.filter(r => r.status === 'success').length;
    const notFound = results.filter(r => r.status === 'not_found').length;
    const error = results.filter(r => r.status === 'error').length;
    console.log(`\n完了 — 成功:${success} 未検出:${notFound} エラー:${error}`);
    process.exit(error > 0 ? 1 : 0);
  })
  .catch(err => {
    console.error('エラー:', err.message);
    process.exit(1);
  });
