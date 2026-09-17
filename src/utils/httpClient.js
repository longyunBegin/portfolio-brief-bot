const https = require('https');
const http = require('http');
const { URL } = require('url');

function request(method, urlStr, { headers = {}, body = null, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch (e) {
      return reject(new Error('无效 URL: ' + urlStr));
    }
    const lib = u.protocol === 'https:' ? https : http;
    const data = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    const reqHeaders = Object.assign({}, headers);
    if (data) {
      reqHeaders['Content-Length'] = reqHeaders['Content-Length'] || data.length;
    }
    const options = {
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: reqHeaders,
    };
    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf-8');
        let json = null;
        const ct = (res.headers['content-type'] || '').toLowerCase();
        if (ct.includes('application/json') || ct.includes('text/json')) {
          try { json = JSON.parse(text); } catch (_) {}
        } else {
          try { json = JSON.parse(text); } catch (_) {}
        }
        resolve({ status: res.statusCode, headers: res.headers, data: json != null ? json : text, text });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => {
      req.destroy(new Error('请求超时 ' + timeout + 'ms'));
    });
    if (data) req.write(data);
    req.end();
  });
}

function get(url, opts) {
  return request('GET', url, opts);
}

function postJson(url, payload, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  return request('POST', url, {
    headers,
    body: JSON.stringify(payload),
    timeout: opts.timeout || 30000,
  });
}

module.exports = { request, get, postJson };