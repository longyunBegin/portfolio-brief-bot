const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');

function hmacSha1(key, data) {
  return crypto.createHmac('sha1', key).update(data).digest('hex');
}

function sha1(data) {
  return crypto.createHash('sha1').update(data).digest('hex');
}

function buildAuth(method, host, uri, secretId, secretKey) {
  const now = Math.floor(Date.now() / 1000);
  const expire = now + 600;
  const keyTime = now + ';' + expire;
  const canonicalHeaders = 'host:' + host + '\n';
  const signedHeaders = 'host';
  const formatString = method + '\n' + uri + '\n\n' + canonicalHeaders + '\n' + signedHeaders + '\n';
  const stringToSign = 'sha1\n' + keyTime + '\n' + sha1(formatString) + '\n';
  const signKey = hmacSha1(secretKey, keyTime);
  const signature = hmacSha1(signKey, stringToSign);
  return 'q-sign-algorithm=sha1&q-ak=' + secretId + '&q-sign-time=' + keyTime + '&q-key-time=' + keyTime + '&q-header-list=' + signedHeaders + '&q-url-param-list=&q-signature=' + signature;
}

function request(method, host, uri, { headers = {}, body = null, secretId, secretKey, timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const auth = buildAuth(method, host, uri, secretId, secretKey);
    const allHeaders = Object.assign({ host, Authorization: auth }, headers);
    const data = body == null ? null : Buffer.from(String(body));
    if (data) allHeaders['Content-Length'] = data.length;
    const req = https.request({ method, hostname: host, path: uri, headers: allHeaders }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('COS 请求超时')));
    if (data) req.write(data);
    req.end();
  });
}

function cosGet({ secretId, secretKey, bucket, region, key }) {
  const host = bucket + '.cos.' + region + '.myqcloud.com';
  const uri = '/' + encodeURIComponent(key);
  return request('GET', host, uri, { secretId, secretKey });
}

function cosPut({ secretId, secretKey, bucket, region, key, content }) {
  const host = bucket + '.cos.' + region + '.myqcloud.com';
  const uri = '/' + encodeURIComponent(key);
  return request('PUT', host, uri, {
    secretId, secretKey,
    headers: { 'Content-Type': 'text/plain' },
    body: content,
  });
}

module.exports = { cosGet, cosPut };