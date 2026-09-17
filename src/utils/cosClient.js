const crypto = require('crypto');
const https = require('https');

function camSafeUrlEncode(str) {
  return encodeURIComponent(str).replace(/!/g, '%21').replace(/\*/g, '%2A').replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function buildAuth(method, host, uri, secretId, secretKey) {
  const now = Math.floor(Date.now() / 1000);
  const expire = now + 900;
  const keyTime = now + ';' + expire;
  const headerStr = 'host=' + camSafeUrlEncode(host);
  const formatString = [method.toLowerCase(), uri, '', headerStr, ''].join('\n');
  const signKey = crypto.createHmac('sha1', secretKey).update(keyTime).digest('hex');
  const hashedFormat = crypto.createHash('sha1').update(formatString).digest('hex');
  const stringToSign = ['sha1', keyTime, hashedFormat, ''].join('\n');
  const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex');
  return [
    'q-sign-algorithm=sha1',
    'q-ak=' + secretId,
    'q-sign-time=' + keyTime,
    'q-key-time=' + keyTime,
    'q-header-list=host',
    'q-url-param-list=',
    'q-signature=' + signature,
  ].join('&');
}

function request(method, host, uri, { headers = {}, body = null, secretId, secretKey, timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const auth = buildAuth(method, host, uri, secretId, secretKey);
    const allHeaders = Object.assign({ Host: host, Authorization: auth }, headers);
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
  const uri = '/' + camSafeUrlEncode(key);
  return request('GET', host, uri, { secretId, secretKey });
}

function cosPut({ secretId, secretKey, bucket, region, key, content }) {
  const host = bucket + '.cos.' + region + '.myqcloud.com';
  const uri = '/' + camSafeUrlEncode(key);
  return request('PUT', host, uri, {
    secretId, secretKey,
    headers: { 'Content-Type': 'text/plain' },
    body: content,
  });
}

module.exports = { cosGet, cosPut };
