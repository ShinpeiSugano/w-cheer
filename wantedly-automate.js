const http = require('http');
const { exec } = require('child_process');
const fs = require('fs');
const axios = require('axios');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function createConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const config = {
    port: Number(env.PORT || 3000),
    host: env.HOST || (nodeEnv === 'production' ? '0.0.0.0' : '127.0.0.1'),
    nodeEnv,
    basicAuthUser: env.BASIC_AUTH_USER || '',
    basicAuthPass: env.BASIC_AUTH_PASS || '',
    requireAuth: parseBoolean(env.REQUIRE_AUTH, nodeEnv === 'production'),
    headless: parseBoolean(env.HEADLESS, nodeEnv === 'production'),
    autoOpenBrowser: parseBoolean(env.AUTO_OPEN_BROWSER, nodeEnv !== 'production'),
    chromeExecutablePath: env.CHROME_EXECUTABLE_PATH || '',
    proxyServer: env.PROXY_SERVER || '',
  };

  if (config.requireAuth && (!config.basicAuthUser || !config.basicAuthPass)) {
    throw new Error('BASIC_AUTH_USER と BASIC_AUTH_PASS を設定してください');
  }

  if (!Number.isInteger(config.port) || config.port <= 0) {
    throw new Error('PORT は正の整数で指定してください');
  }

  if (!config.host || typeof config.host !== 'string') {
    throw new Error('HOST は文字列で指定してください');
  }

  return config;
}

function getPreferredChromeExecutablePath(config) {
  if (config.chromeExecutablePath) {
    return config.chromeExecutablePath;
  }

  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ]
    : [];

  return candidates.find(candidate => fs.existsSync(candidate)) || '';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderHtml() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wantedly 自動応援</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #f7f5f0; --surface: #ffffff; --surface2: #f0ebe2;
    --border: #ddd5c8; --accent: #c43d3d; --text: #1f2933;
    --muted: #7b8794; --success: #b53a3a; --error: #d64545; --warn: #c98a00;
  }
  body { background: linear-gradient(180deg, #fcfbf8 0%, var(--bg) 100%); color: var(--text); font-family: 'IBM Plex Mono', monospace; min-height: 100vh; padding: 24px; }
  h1 { font-family: 'Syne', sans-serif; font-size: 22px; font-weight: 800; color: var(--accent); margin-bottom: 4px; letter-spacing: 0.05em; }
  .sub { font-size: 11px; color: var(--muted); margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; box-shadow: 0 12px 30px rgba(31, 41, 51, 0.06); }
  .card-header { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
  .card-title { font-family: 'Syne', sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: var(--muted); }
  .count { font-size: 10px; background: var(--surface2); border: 1px solid var(--border); border-radius: 20px; padding: 2px 8px; color: var(--muted); }
  .input-area { padding: 12px 16px; border-bottom: 1px solid var(--border); }
  .row { display: flex; gap: 6px; margin-bottom: 6px; }
  .row:last-child { margin-bottom: 0; }
  input { flex: 1; background: #fffdf8; border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-family: 'IBM Plex Mono', monospace; font-size: 12px; padding: 8px 10px; outline: none; transition: border-color 0.15s, box-shadow 0.15s; }
  input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(196, 61, 61, 0.14); }
  input::placeholder { color: var(--muted); }
  .btn-add { background: var(--surface2); border: 1px solid var(--border); border-radius: 4px; color: var(--accent); cursor: pointer; font-size: 18px; padding: 0 14px; transition: all 0.15s; }
  .btn-add:hover { background: var(--accent); border-color: var(--accent); color: #fff; }
  .list { padding: 8px; min-height: 80px; max-height: 180px; overflow-y: auto; }
  .item { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 4px; border: 1px solid var(--border); margin-bottom: 4px; background: #fcfaf5; font-size: 11px; }
  .item-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item-sub { font-size: 10px; color: var(--muted); }
  .btn-del { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 15px; transition: color 0.1s; }
  .btn-del:hover { color: var(--error); }
  .empty { text-align: center; padding: 20px; color: var(--muted); font-size: 11px; }
  .log-card { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; margin-bottom: 16px; box-shadow: 0 12px 30px rgba(31, 41, 51, 0.06); }
  .log-body { padding: 10px 16px; font-size: 11px; line-height: 1.9; max-height: 200px; overflow-y: auto; background: #fffdfa; }
  .log-line { color: var(--muted); }
  .log-line.s { color: var(--success); }
  .log-line.e { color: var(--error); }
  .log-line.w { color: var(--warn); }
  .log-line.i { color: var(--text); }
  .run-bar { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .btn-run { background: var(--accent); border: none; border-radius: 4px; color: #fff; cursor: pointer; font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700; padding: 12px 32px; text-transform: uppercase; transition: opacity 0.15s; letter-spacing: 0.05em; box-shadow: 0 10px 24px rgba(196, 61, 61, 0.22); }
  .btn-run:hover { opacity: 0.85; }
  .btn-run:disabled { background: var(--surface2); color: var(--muted); cursor: not-allowed; box-shadow: none; }
  .status { font-size: 11px; color: var(--muted); }
  .summary { display: flex; gap: 16px; font-size: 11px; }
  .hint { margin-bottom: 16px; font-size: 11px; color: var(--muted); line-height: 1.7; }
  .ss { color: var(--success); } .se { color: var(--error); } .sw { color: var(--warn); }
  @media (max-width: 820px) {
    body { padding: 16px; }
    .grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<h1>W· CHEER</h1>
<div class="sub">Wantedly 自動応援ツール</div>
<div class="hint">公開環境では Basic 認証と HTTPS 配下での運用を推奨します。送信データは URL ではなく POST ボディで送信されます。</div>

<div class="grid">
  <div class="card">
    <div class="card-header"><div class="card-title">アカウント</div><div class="count" id="ac">0 件</div></div>
    <div class="input-area">
      <div class="row"><input type="email" id="email" placeholder="メールアドレス"></div>
      <div class="row">
        <input type="password" id="pass" placeholder="パスワード">
        <button class="btn-add" id="add-account" type="button">＋</button>
      </div>
    </div>
    <div class="list" id="account-list"><div class="empty">アカウントを追加してください</div></div>
  </div>
  <div class="card">
    <div class="card-header"><div class="card-title">応援URL</div><div class="count" id="uc">0 件</div></div>
    <div class="input-area">
      <div class="row">
        <input type="text" id="url" placeholder="https://www.wantedly.com/projects/...">
        <button class="btn-add" id="add-url" type="button">＋</button>
      </div>
    </div>
    <div class="list" id="url-list"><div class="empty">URLを追加してください</div></div>
  </div>
</div>

<div class="log-card">
  <div class="card-header">
    <div class="card-title">ログ</div>
    <button class="btn-del" id="clear-log" type="button" style="font-size:11px">クリア</button>
  </div>
  <div class="log-body" id="log">
    <div class="log-line">準備完了。アカウントとURLを追加して実行してください。</div>
  </div>
</div>

<div class="run-bar">
  <button class="btn-run" id="btn-run" type="button">実行</button>
  <div class="status" id="status">待機中</div>
  <div class="summary" id="summary" style="display:none">
    <span class="ss">成功 <b id="sc">0</b></span>
    <span class="sw">未検出 <b id="wc">0</b></span>
    <span class="se">エラー <b id="ec">0</b></span>
  </div>
</div>

<script>
let accounts = [];
let urls = [];
let running = false;

document.getElementById('add-account').addEventListener('click', addAccount);
document.getElementById('add-url').addEventListener('click', addUrl);
document.getElementById('clear-log').addEventListener('click', clearLog);
document.getElementById('btn-run').addEventListener('click', run);
document.getElementById('pass').addEventListener('keydown', e => { if (e.key === 'Enter') addAccount(); });
document.getElementById('url').addEventListener('keydown', e => { if (e.key === 'Enter') addUrl(); });
document.getElementById('account-list').addEventListener('click', e => {
  const button = e.target.closest('[data-remove-account]');
  if (!button) return;
  removeAccount(Number(button.dataset.removeAccount));
});
document.getElementById('url-list').addEventListener('click', e => {
  const button = e.target.closest('[data-remove-url]');
  if (!button) return;
  removeUrl(Number(button.dataset.removeUrl));
});

function addAccount() {
  const email = document.getElementById('email').value.trim();
  const pass = document.getElementById('pass').value;
  if (!email) {
    log('⚠️ メールアドレスを入力してください');
    document.getElementById('email').focus();
    return;
  }
  if (!pass) {
    log('⚠️ パスワードを入力してください');
    document.getElementById('pass').focus();
    return;
  }
  if (accounts.find(account => account.email === email)) {
    log('⚠️ すでに追加済みです');
    return;
  }
  accounts.push({ email, password: pass });
  document.getElementById('email').value = '';
  document.getElementById('pass').value = '';
  renderAccounts();
  log('✅ アカウントを追加しました');
  document.getElementById('email').focus();
}

function removeAccount(index) {
  accounts.splice(index, 1);
  renderAccounts();
}

function renderAccounts() {
  document.getElementById('ac').textContent = accounts.length + ' 件';
  const el = document.getElementById('account-list');
  if (!accounts.length) {
    el.innerHTML = '<div class="empty">アカウントを追加してください</div>';
    return;
  }
  el.innerHTML = accounts.map((account, index) => (
    '<div class="item"><div style="flex:1;overflow:hidden"><div class="item-text">' +
    escapeHtml(account.email) +
    '</div><div class="item-sub">' +
    '•'.repeat(account.password.length) +
    '</div></div><button class="btn-del" type="button" data-remove-account="' +
    index +
    '">×</button></div>'
  )).join('');
}

function addUrl() {
  const url = document.getElementById('url').value.trim();
  if (!url) {
    log('⚠️ URLを入力してください');
    document.getElementById('url').focus();
    return;
  }
  if (!url.includes('wantedly.com')) {
    log('⚠️ WantedlyのURLを入力してください');
    return;
  }
  if (urls.includes(url)) {
    log('⚠️ すでに追加済みです');
    return;
  }
  urls.push(url);
  document.getElementById('url').value = '';
  renderUrls();
  log('✅ URLを追加しました');
  document.getElementById('url').focus();
}

function removeUrl(index) {
  urls.splice(index, 1);
  renderUrls();
}

function renderUrls() {
  document.getElementById('uc').textContent = urls.length + ' 件';
  const el = document.getElementById('url-list');
  if (!urls.length) {
    el.innerHTML = '<div class="empty">URLを追加してください</div>';
    return;
  }
  el.innerHTML = urls.map((url, index) => (
    '<div class="item"><div class="item-text" style="color:var(--accent)">' +
    escapeHtml(url) +
    '</div><button class="btn-del" type="button" data-remove-url="' +
    index +
    '">×</button></div>'
  )).join('');
}

function log(msg) {
  const area = document.getElementById('log');
  const line = document.createElement('div');
  line.className = 'log-line ' + (
    msg.includes('✅') || msg.includes('🎉') ? 's' :
    msg.includes('❌') ? 'e' :
    msg.includes('⚠️') ? 'w' :
    'i'
  );
  line.textContent = msg;
  area.appendChild(line);
  area.scrollTop = area.scrollHeight;
}

function clearLog() {
  document.getElementById('log').innerHTML = '';
}

function parseSseChunk(buffer, onMessage) {
  let boundary = buffer.indexOf('\\n\\n');
  while (boundary !== -1) {
    const eventBlock = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    const dataLine = eventBlock.split('\\n').find(line => line.startsWith('data: '));
    if (dataLine) {
      onMessage(JSON.parse(dataLine.slice(6)));
    }
    boundary = buffer.indexOf('\\n\\n');
  }
  return buffer;
}

async function run() {
  if (running) return;
  if (!accounts.length) {
    log('❌ アカウントを追加してください');
    return;
  }
  if (!urls.length) {
    log('❌ URLを追加してください');
    return;
  }

  running = true;
  document.getElementById('btn-run').disabled = true;
  document.getElementById('status').textContent = '実行中...';
  document.getElementById('summary').style.display = 'none';
  log('🚀 開始！ ' + accounts.length + 'アカウント × ' + urls.length + 'URL');

  try {
    const response = await fetch('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accounts, urls }),
    });

    if (!response.ok || !response.body) {
      throw new Error('サーバーエラー: ' + response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const results = [];

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = parseSseChunk(buffer, msg => {
        if (msg.type === 'log') log(msg.text);
        if (msg.type === 'result') results.push(msg.data);
        if (msg.type === 'done') {
          const success = results.filter(result => result.status === 'success').length;
          const notFound = results.filter(result => result.status === 'not_found').length;
          const error = results.filter(result => result.status === 'error').length;
          document.getElementById('sc').textContent = success;
          document.getElementById('wc').textContent = notFound;
          document.getElementById('ec').textContent = error;
          document.getElementById('summary').style.display = 'flex';
          document.getElementById('status').textContent = '完了！';
          log('✅ 完了！ 成功:' + success + ' 未検出:' + notFound + ' エラー:' + error);
        }
      });
    }
  } catch (error) {
    log('❌ ' + error.message);
    document.getElementById('status').textContent = 'エラー';
  } finally {
    running = false;
    document.getElementById('btn-run').disabled = false;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
</script>
</body>
</html>`;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendUnauthorized(res) {
  res.writeHead(401, {
    'Content-Type': 'text/plain; charset=utf-8',
    'WWW-Authenticate': 'Basic realm="wantedly-automate"',
    'Cache-Control': 'no-store',
  });
  res.end('Authentication required');
}

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
}

function isAuthorized(req, config) {
  if (!config.requireAuth) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return false;
  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  return username === config.basicAuthUser && password === config.basicAuthPass;
}

async function parseJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function validateEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validateWantedlyUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname.endsWith('wantedly.com');
  } catch {
    return false;
  }
}

function validateRunPayload(body) {
  if (!body || !Array.isArray(body.accounts) || !Array.isArray(body.urls)) {
    throw new Error('accounts と urls を配列で指定してください');
  }

  if (body.accounts.length === 0 || body.urls.length === 0) {
    throw new Error('accounts と urls は 1 件以上必要です');
  }

  if (body.accounts.length > 20 || body.urls.length > 50) {
    throw new Error('件数が多すぎます');
  }

  const accounts = body.accounts.map(account => {
    const email = typeof account?.email === 'string' ? account.email.trim() : '';
    const password = typeof account?.password === 'string' ? account.password : '';
    if (!validateEmail(email) || !password) {
      throw new Error('アカウント情報が不正です');
    }
    return { email, password };
  });

  const urls = body.urls.map(url => {
    const normalized = typeof url === 'string' ? url.trim() : '';
    if (!validateWantedlyUrl(normalized)) {
      throw new Error('Wantedly の URL を指定してください');
    }
    return normalized;
  });

  return { accounts, urls };
}

const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
};

function parseCookies(setCookieHeaders) {
  if (!setCookieHeaders) return '';
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  return headers.map(c => c.split(';')[0]).join('; ');
}

async function loginWithHttp(email, password) {
  const pageRes = await axios.get('https://www.wantedly.com/signin_or_signup', {
    headers: HTTP_HEADERS,
    maxRedirects: 5,
  });

  const csrfMatch = pageRes.data.match(/<meta[^>]+name="csrf-token"[^>]+content="([^"]+)"/);
  if (!csrfMatch) throw new Error('CSRF トークンが見つかりませんでした');
  const csrfToken = csrfMatch[1];

  const pageCookieHeaders = pageRes.headers['set-cookie'] || [];
  const cookieString = parseCookies(pageCookieHeaders);

  const loginRes = await axios.post(
    'https://www.wantedly.com/user/sign_in',
    new URLSearchParams({
      'user[email]': email,
      'user[password]': password,
      'authenticity_token': csrfToken,
    }).toString(),
    {
      headers: {
        ...HTTP_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieString,
        'Referer': 'https://www.wantedly.com/signin_or_signup',
        'Origin': 'https://www.wantedly.com',
      },
      maxRedirects: 5,
      validateStatus: s => s < 500,
    }
  );

  if (loginRes.status === 401) {
    throw new Error('メールアドレスまたはパスワードが違います');
  }

  const allCookieHeaders = [...pageCookieHeaders, ...(loginRes.headers['set-cookie'] || [])];
  return allCookieHeaders;
}

function cookieHeadersToPuppeteer(cookieHeaders) {
  return cookieHeaders.flatMap(header => {
    const parts = header.split(';').map(s => s.trim());
    const [name, ...valueParts] = parts[0].split('=');
    const value = valueParts.join('=');
    if (!name) return [];
    const cookie = { name: name.trim(), value, domain: '.wantedly.com', path: '/' };
    const pathPart = parts.find(p => p.toLowerCase().startsWith('path='));
    if (pathPart) cookie.path = pathPart.split('=')[1] || '/';
    return [cookie];
  });
}

async function login(page, email, password) {
  const maskedEmail = email.replace(/(^.).+(@.*$)/, '$1***$2');

  try {
    await page.goto('https://www.wantedly.com/signin_or_signup', { waitUntil: 'networkidle2' });
  } catch (error) {
    throw new Error('ログイン画面への移動に失敗しました: ' + error.message);
  }

  try {
    await delay(2000);
    await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 30000 });
  } catch (error) {
    throw new Error('メールアドレス入力欄の検出に失敗しました: ' + error.message);
  }

  const emailInput = await page.$('input[type="email"]') || await page.$('input[name="email"]');
  if (!emailInput) {
    throw new Error('メールアドレス入力欄が見つかりません');
  }

  try {
    await emailInput.click({ clickCount: 3 });
    await emailInput.type(email, { delay: 50 });
    await delay(500);
    await page.keyboard.press('Enter');
  } catch (error) {
    throw new Error('メールアドレス送信に失敗しました (' + maskedEmail + '): ' + error.message);
  }

  try {
    await delay(2000);
    await page.waitForSelector('input[type="password"], input[name="password"]', { timeout: 30000 });
  } catch (error) {
    throw new Error('パスワード入力欄の検出に失敗しました: ' + error.message);
  }

  const passwordInput = await page.$('input[type="password"]') || await page.$('input[name="password"]');
  if (!passwordInput) {
    throw new Error('パスワード入力欄が見つかりません');
  }

  try {
    await passwordInput.click({ clickCount: 3 });
    await passwordInput.type(password, { delay: 50 });
    await delay(500);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
      page.keyboard.press('Enter'),
    ]);
  } catch (error) {
    throw new Error('パスワード送信またはログイン完了待ちに失敗しました: ' + error.message);
  }
}

function isRetryableNetworkError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('socket hang up') ||
    message.includes('econnreset') ||
    message.includes('net::err_') ||
    message.includes('navigation timeout')
  );
}

function isIgnorableFailedRequest(url) {
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname.endsWith('wantedly.com')) return false;
    if (hostname.endsWith('facebook.com') && !pathname.startsWith('/x/oauth/status') && !pathname.startsWith('/privacy_sandbox/')) return false;
    return true;
  } catch {
    return true;
  }
}

async function waitForLoginTransition(page) {
  try {
    await page.waitForFunction(
      () => {
        const path = location.pathname;
        const hasPassword = !!document.querySelector('input[type="password"]');
        const hasEmail = !!document.querySelector('input[type="email"], input[name="email"]');
        return path !== '/signin_or_signup' || (!hasPassword && !hasEmail);
      },
      { timeout: 30000 }
    );
  } catch (error) {
    throw new Error('ログイン後の遷移待機に失敗しました: ' + error.message);
  }

  const currentUrl = new URL(page.url());
  if (currentUrl.pathname === '/signin_or_signup') {
    throw new Error('ログイン後もサインイン画面に留まっています。認証に失敗した可能性があります');
  }
}

async function gotoWantedlyPage(page, url) {
  let navigationAborted = false;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (error) {
    const currentUrl = page.url();
    const isAborted = String(error?.message || '').includes('net::ERR_ABORTED');
    if (!isAborted || !currentUrl.startsWith('https://www.wantedly.com/')) {
      throw error;
    }
    navigationAborted = true;
  }

  // domcontentloaded が正常に完了した場合、readyState はすでに interactive/complete
  // ERR_ABORTED（リダイレクト等）の場合のみ明示的に待機する
  if (navigationAborted) {
    await page.waitForFunction(() => document.readyState === 'interactive' || document.readyState === 'complete', {
      timeout: 30000,
    });
  }
}

function attachPageDiagnostics(page, send, accountEmail) {
  const maskedEmail = accountEmail.replace(/(^.).+(@.*$)/, '$1***$2');

  page.on('requestfailed', request => {
    const failure = request.failure();
    const url = request.url();
    if (isIgnorableFailedRequest(url)) return;
    send('log', {
      text: '⚠️ 通信失敗 [' + maskedEmail + '] ' + request.method() + ' ' + url + ' (' + (failure?.errorText || 'unknown') + ')',
    });
  });

  page.on('pageerror', error => {
    send('log', { text: '⚠️ ページエラー [' + maskedEmail + ']: ' + error.message });
  });

  page.on('error', error => {
    send('log', { text: '⚠️ ブラウザページエラー [' + maskedEmail + ']: ' + error.message });
  });
}

async function loginWithDiagnostics(page, email, password, send) {
  send('log', { text: '  ・ログイン画面へ移動します' });
  await gotoWantedlyPage(page, 'https://www.wantedly.com/signin_or_signup');
  const landedUrl = page.url();
  const landedTitle = await page.title();
  send('log', { text: '  ・現在のURL: ' + landedUrl });
  send('log', { text: '  ・ページタイトル: ' + landedTitle });
  send('log', { text: '  ・メールアドレス入力欄を待機します' });
  await delay(2000);
  let emailInput;
  try {
    await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 30000 });
    emailInput = await page.$('input[type="email"]') || await page.$('input[name="email"]');
  } catch (err) {
    const inputs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input')).map(el => `type="${el.type}" name="${el.name}" id="${el.id}"`).join(' / ')
    );
    send('log', { text: '  ⚠️ 検出されたinput要素: ' + (inputs || 'なし') });
    throw err;
  }
  send('log', { text: '  ・メールアドレスを送信します' });
  await emailInput.click({ clickCount: 3 });
  await emailInput.type(email, { delay: 50 });
  await delay(500);
  await page.keyboard.press('Enter');
  send('log', { text: '  ・パスワード入力欄を待機します' });
  await delay(2000);
  await page.waitForSelector('input[type="password"], input[name="password"]', { timeout: 30000 });
  const passwordInput = await page.$('input[type="password"]') || await page.$('input[name="password"]');
  send('log', { text: '  ・パスワード送信後の遷移を待機します' });
  await passwordInput.click({ clickCount: 3 });
  await passwordInput.type(password, { delay: 50 });
  await delay(500);
  await page.keyboard.press('Enter');
  await waitForLoginTransition(page);
  send('log', { text: '  ・ログイン後のページに到達しました: ' + page.url() });
}

async function loginWithRetry(page, email, password, send, maxAttempts = 2) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (attempt > 1) {
        send('log', { text: '  ⚠️ ログインを再試行します (' + attempt + '/' + maxAttempts + ')' });
      }
      await loginWithDiagnostics(page, email, password, send);
      return;
    } catch (error) {
      send('log', { text: '  ⚠️ ログイン試行失敗 (' + attempt + '/' + maxAttempts + '): ' + error.message });
      if (attempt >= maxAttempts || !isRetryableNetworkError(error)) {
        throw error;
      }
      try {
        await page.goto('about:blank', { waitUntil: 'load', timeout: 10000 });
      } catch {
      }
      await delay(2000);
    }
  }
}

async function cheerProject(page, url) {
  await gotoWantedlyPage(page, url);
  await delay(2000);
  if (page.url().includes('/signin_or_signup')) {
    throw new Error('未ログイン状態のため、募集ページへ遷移できませんでした');
  }

  const cheerButton = (await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('button, a')).find(el => el.textContent.trim() === '応援する')
  )).asElement();
  if (!cheerButton) {
    const pageInfo = await page.evaluate(() => ({
      url: location.href,
      buttons: Array.from(document.querySelectorAll('button')).map(el => el.textContent.trim()).filter(Boolean).slice(0, 10),
    }));
    throw new Error('応援するボタンが見つかりません。URL: ' + pageInfo.url + ' / ボタン一覧: ' + pageInfo.buttons.join(', '));
  }

  await cheerButton.click();
  await delay(2000);

  const facebookButton = (await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('button, a')).find(el => el.textContent.includes('Facebook') && el.textContent.includes('応援'))
  )).asElement();
  if (!facebookButton) return 'not_found';

  await facebookButton.click();
  await delay(2000);

  for (const currentPage of await page.browser().pages()) {
    if (currentPage.url().includes('facebook.com')) {
      await currentPage.close();
      break;
    }
  }

  await delay(1000);
  const closeButton = (await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll('button, a')).find(el => el.textContent.trim() === '閉じる')
  )).asElement();
  if (closeButton) await closeButton.click();

  return 'success';
}

function createAutomationRuntime(config) {
  return {
    async withPage(task) {
      const preferredExecutablePath = getPreferredChromeExecutablePath(config);
      const launchOptions = {
        headless: config.headless ? 'new' : false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-blink-features=AutomationControlled',
          ...(config.proxyServer ? [`--proxy-server=${config.proxyServer}`] : []),
        ],
      };

      if (preferredExecutablePath) {
        launchOptions.executablePath = preferredExecutablePath;
      }

      const browser = await puppeteer.launch(launchOptions);
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(45000);
      page.setDefaultTimeout(20000);
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.setViewport({ width: 1280, height: 800 });
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });

      try {
        return await task(page);
      } finally {
        await browser.close();
      }
    },
  };
}

async function runAutomation({ accounts, urls, send, automation }) {
  for (const account of accounts) {
    await automation.withPage(async page => {
      attachPageDiagnostics(page, send, account.email);
      send('log', { text: '🔑 ログイン中: ' + account.email });

      try {
        send('log', { text: '  ・HTTP でログインを試みます' });
        const cookieHeaders = await loginWithHttp(account.email, account.password);
        const puppeteerCookies = cookieHeadersToPuppeteer(cookieHeaders);
        await page.setCookie(...puppeteerCookies);
        send('log', { text: '✅ ログイン完了 (HTTP): ' + account.email });
      } catch (httpError) {
        send('log', { text: '  ⚠️ HTTP ログイン失敗、ブラウザで再試行: ' + httpError.message });
        await loginWithRetry(page, account.email, account.password, send)
          .catch(async diagnosticError => {
            send('log', { text: '  ⚠️ 詳細ログ取得付きログインで失敗: ' + diagnosticError.message });
            await login(page, account.email, account.password);
          });
        send('log', { text: '✅ ログイン完了: ' + account.email });
      }

      for (const url of urls) {
        send('log', { text: '📣 応援中: ' + url });
        try {
          const result = await cheerProject(page, url);
          send('log', { text: result === 'success' ? '  🎉 応援完了！' : '  ⚠️ ボタンが見つかりませんでした' });
          send('result', { data: { account: account.email, url, status: result } });
        } catch (error) {
          send('log', { text: '  ❌ エラー: ' + error.message });
          send('result', { data: { account: account.email, url, status: 'error' } });
        }
        await delay(2000);
      }
    }).catch(error => {
      send('log', { text: '❌ ログインエラー: ' + error.message });
    });
  }
}

function createRequestHandler({
  config = createConfig(),
  automation = createAutomationRuntime(config),
  runHandler = runAutomation,
  logger = console,
} = {}) {
  return async (req, res) => {
    applySecurityHeaders(res);

    if (!isAuthorized(req, config)) {
      sendUnauthorized(res);
      return;
    }

    const requestUrl = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml());
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/health') {
      sendJson(res, 200, { ok: true, env: config.nodeEnv });
      return;
    }

    if (req.method === 'GET' && requestUrl.pathname === '/test-wantedly') {
      try {
        const https = require('https');
        const status = await new Promise((resolve, reject) => {
          const r = https.get('https://www.wantedly.com/signin_or_signup', {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
            },
          }, res => resolve(res.statusCode));
          r.on('error', reject);
        });
        sendJson(res, 200, { status, blocked: status === 403 });
      } catch (error) {
        sendJson(res, 200, { error: error.message });
      }
      return;
    }

    if (req.method === 'POST' && requestUrl.pathname === '/run') {
      try {
        const body = await parseJsonBody(req);
        const { accounts, urls } = validateRunPayload(body);

        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Connection': 'keep-alive',
          'Cache-Control': 'no-cache, no-transform',
        });

        const send = (type, data) => {
          res.write('data: ' + JSON.stringify({ type, ...data }) + '\n\n');
        };

        await runHandler({ accounts, urls, send, automation });
        send('done', {});
        res.end();
      } catch (error) {
        logger.error?.(error);
        if (!res.headersSent) {
          sendJson(res, 400, { error: error.message });
        } else {
          res.write('data: ' + JSON.stringify({ type: 'log', text: '❌ ' + error.message }) + '\n\n');
          res.write('data: ' + JSON.stringify({ type: 'done' }) + '\n\n');
          res.end();
        }
      }
      return;
    }

    sendJson(res, 404, { error: 'Not Found' });
  };
}

function createServer(options = {}) {
  return http.createServer(createRequestHandler(options));
}

function formatListenUrl(config) {
  return 'http://' + (config.host === '0.0.0.0' ? 'localhost' : config.host) + ':' + config.port;
}

async function startServer() {
  const config = createConfig();
  const server = createServer({ config });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  console.log('');
  console.log('✅ Wantedly 自動応援ツール 起動');
  console.log('🌐 ' + formatListenUrl(config));
  console.log('🔒 Basic 認証: ' + (config.requireAuth ? '有効' : '無効'));
  console.log('🧪 Headless: ' + (config.headless ? '有効' : '無効'));
  console.log('');

  if (config.autoOpenBrowser) {
    exec('open ' + formatListenUrl(config), error => {
      if (error) {
        console.error('ブラウザを自動で開けませんでした:', error.message);
      }
    });
  }

  return server;
}

if (require.main === module) {
  const config = createConfig();
  startServer().catch(error => {
    if (error?.code === 'EADDRINUSE') {
      console.error('起動エラー: ' + config.port + ' 番ポートはすでに使用中です');
    } else if (error?.code === 'EACCES' || error?.code === 'EPERM') {
      console.error('起動エラー: ' + config.host + ':' + config.port + ' で待ち受けできません');
    } else {
      console.error('起動エラー:', error.message);
    }
    process.exitCode = 1;
  });
}

module.exports = {
  cheerProject,
  createConfig,
  createRequestHandler,
  createServer,
  getPreferredChromeExecutablePath,
  isIgnorableFailedRequest,
  isAuthorized,
  login,
  renderHtml,
  runAutomation,
  startServer,
  validateRunPayload,
};
