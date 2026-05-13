const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough, Writable } = require('node:stream');
const {
  createRequestHandler,
  createConfig,
  getPreferredChromeExecutablePath,
  isIgnorableFailedRequest,
  validateRunPayload,
} = require('../wantedly-automate');

function authHeader(username, password) {
  return 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
}

function createMockRequest({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const req = new PassThrough();
  req.method = method;
  req.url = url;
  req.headers = headers;
  if (body !== undefined) {
    req.end(typeof body === 'string' ? body : JSON.stringify(body));
  } else {
    req.end();
  }
  return req;
}

function createMockResponse() {
  const chunks = [];
  const res = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      callback();
    },
  });

  res.headers = {};
  res.statusCode = 200;
  res.headersSent = false;

  res.setHeader = (name, value) => {
    res.headers[name.toLowerCase()] = value;
  };

  res.getHeader = name => res.headers[name.toLowerCase()];

  res.writeHead = (statusCode, headers = {}) => {
    res.statusCode = statusCode;
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
    res.headersSent = true;
    return res;
  };

  res.write = chunk => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    res.headersSent = true;
    return true;
  };

  res.end = chunk => {
    if (chunk) res.write(chunk);
    res.emit('finish');
    return res;
  };

  res.body = () => Buffer.concat(chunks).toString('utf8');
  return res;
}

async function invokeHandler(handler, requestOptions) {
  const req = createMockRequest(requestOptions);
  const res = createMockResponse();
  await handler(req, res);
  return res;
}

test('createConfig requires basic auth credentials in production by default', () => {
  assert.throws(
    () => createConfig({ NODE_ENV: 'production', PORT: '3000' }),
    /BASIC_AUTH_USER と BASIC_AUTH_PASS/
  );
});

test('createConfig defaults host by environment', () => {
  assert.equal(createConfig({ PORT: '3000', REQUIRE_AUTH: 'false' }).host, '127.0.0.1');
  assert.equal(
    createConfig({
      NODE_ENV: 'production',
      PORT: '3000',
      REQUIRE_AUTH: 'false',
      BASIC_AUTH_USER: 'admin',
      BASIC_AUTH_PASS: 'secret',
    }).host,
    '0.0.0.0'
  );
});

test('getPreferredChromeExecutablePath prefers explicit config path', () => {
  assert.equal(
    getPreferredChromeExecutablePath({ chromeExecutablePath: '/tmp/custom-chrome' }),
    '/tmp/custom-chrome'
  );
});

test('isIgnorableFailedRequest filters analytics noise', () => {
  assert.equal(isIgnorableFailedRequest('https://analytics.google.com/g/collect?v=2'), true);
  assert.equal(isIgnorableFailedRequest('https://www.google-analytics.com/g/collect?v=2'), true);
  assert.equal(isIgnorableFailedRequest('https://apm.yahoo.co.jp/rt/?p=1'), true);
  assert.equal(isIgnorableFailedRequest('https://www.facebook.com/x/oauth/status?client_id=1'), true);
  assert.equal(isIgnorableFailedRequest('https://www.wantedly.com/projects/123'), false);
});

test('validateRunPayload sanitizes valid payloads', () => {
  const payload = validateRunPayload({
    accounts: [{ email: ' user@example.com ', password: 'secret' }],
    urls: [' https://www.wantedly.com/projects/123 '],
  });

  assert.deepEqual(payload, {
    accounts: [{ email: 'user@example.com', password: 'secret' }],
    urls: ['https://www.wantedly.com/projects/123'],
  });
});

test('root route is protected when basic auth is enabled', async () => {
  const config = createConfig({
    PORT: '3000',
    REQUIRE_AUTH: 'true',
    BASIC_AUTH_USER: 'admin',
    BASIC_AUTH_PASS: 'secret',
  });
  const handler = createRequestHandler({ config });
  const res = await invokeHandler(handler, { url: '/' });

  assert.equal(res.statusCode, 401);
  assert.match(res.getHeader('www-authenticate') || '', /Basic/);
});

test('root route returns HTML when authorized', async () => {
  const config = createConfig({
    PORT: '3000',
    REQUIRE_AUTH: 'true',
    BASIC_AUTH_USER: 'admin',
    BASIC_AUTH_PASS: 'secret',
  });
  const handler = createRequestHandler({ config });
  const res = await invokeHandler(handler, {
    url: '/',
    headers: { authorization: authHeader('admin', 'secret') },
  });

  assert.equal(res.statusCode, 200);
  assert.match(res.getHeader('content-type') || '', /text\/html/);
  assert.match(res.body(), /Wantedly 自動応援/);
});

test('run endpoint streams events with mock handler', async () => {
  const config = createConfig({
    PORT: '3000',
    REQUIRE_AUTH: 'false',
  });

  const handler = createRequestHandler({
    config,
    runHandler: async ({ accounts, urls, send }) => {
      assert.equal(accounts.length, 1);
      assert.equal(urls.length, 1);
      send('log', { text: 'started' });
      send('result', { data: { account: accounts[0].email, url: urls[0], status: 'success' } });
    },
  });

  const res = await invokeHandler(handler, {
    method: 'POST',
    url: '/run',
    headers: { 'content-type': 'application/json' },
    body: {
      accounts: [{ email: 'user@example.com', password: 'secret' }],
      urls: ['https://www.wantedly.com/projects/123'],
    },
  });

  assert.equal(res.statusCode, 200);
  assert.match(res.getHeader('content-type') || '', /text\/event-stream/);
  assert.match(res.body(), /"type":"log"/);
  assert.match(res.body(), /"type":"result"/);
  assert.match(res.body(), /"type":"done"/);
});
