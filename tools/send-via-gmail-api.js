/**
 * 直发 Gmail：绕过 MCP 的 <img>/<style> 清洗，直接调 Gmail REST API 发送原始 MIME。
 *
 * 用法：
 *   # 发信（有 refresh_token + client 时自动刷新 access token）
 *   node tools/send-via-gmail-api.js send-payload.json --to a@x.com [--subject "..."]
 *
 *   # 用 authorization code 换取 refresh_token / access_token 并写入 .env
 *   node tools/send-via-gmail-api.js --exchange-code '4/0A...' \
 *     [--redirect-uri https://developers.google.com/oauthplayground]
 *
 *   # 仅刷新 access token（不发信）
 *   node tools/send-via-gmail-api.js --refresh-only
 *
 * 环境变量见 README「Gmail 发件箱 OAuth（自动刷新）」与 .env.example。
 * 零依赖：只用 Node.js 内置模块。scope 需含 gmail.send。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL, URLSearchParams } = require('url');

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const TOKEN_FILE = path.join(ROOT, '.gmail_oauth_token');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const DEFAULT_REDIRECT = 'https://developers.google.com/oauthplayground';
/** OAuth Playground 公共 client_id（仅当你的 refresh_token 由默认 Playground 签发时用；secret 仍须自备或改用自有 GCP client） */
const PLAYGROUND_CLIENT_ID = '407408718192.apps.googleusercontent.com';

function loadEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return;
  for (const raw of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

function upsertEnv(key, value) {
  if (!value) return;
  let text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const re = new RegExp('^' + key + '=.*$', 'm');
  const line = key + '=' + value;
  if (re.test(text)) text = text.replace(re, line);
  else text = (text.endsWith('\n') || !text ? text : text + '\n') + line + '\n';
  fs.writeFileSync(ENV_PATH, text, 'utf8');
  process.env[key] = value;
}

function persistAccessToken(accessToken) {
  if (!accessToken) return;
  fs.writeFileSync(TOKEN_FILE, accessToken, { encoding: 'utf8', mode: 0o600 });
  upsertEnv('GMAIL_OAUTH_TOKEN', accessToken);
}

function readCachedAccessToken() {
  if (process.env.GMAIL_OAUTH_TOKEN) return process.env.GMAIL_OAUTH_TOKEN.trim();
  if (fs.existsSync(TOKEN_FILE)) {
    const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (t) return t;
  }
  return '';
}

function parseArgs(argv) {
  const out = {
    payload: null,
    to: null,
    subject: null,
    exchangeCode: null,
    redirectUri: DEFAULT_REDIRECT,
    refreshOnly: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--to') out.to = argv[++i];
    else if (a === '--subject') out.subject = argv[++i];
    else if (a === '--exchange-code') out.exchangeCode = argv[++i];
    else if (a === '--redirect-uri') out.redirectUri = argv[++i];
    else if (a === '--refresh-only') out.refreshOnly = true;
    else if (!out.payload) out.payload = a;
  }
  return out;
}

function httpsRequest(method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body == null ? null : Buffer.from(String(body));
    const h = Object.assign({}, headers);
    if (data) h['Content-Length'] = data.length;
    const req = https.request(
      { method, hostname: u.hostname, path: u.pathname + u.search, headers: h },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json = null;
          try { json = raw ? JSON.parse(raw) : null; } catch { /* ignore */ }
          resolve({ status: res.statusCode, raw, json });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}

function postForm(url, params) {
  const body = new URLSearchParams(params).toString();
  return httpsRequest('POST', url, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
}

function postJson(url, token, bodyObj) {
  return httpsRequest('POST', url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyObj),
  }).then((res) => {
    if (res.status >= 200 && res.status < 300) return res.json;
    throw new Error(`Gmail API ${res.status}: ${(res.raw || '').slice(0, 300)}`);
  });
}

function getClientCreds() {
  const clientId = (process.env.GMAIL_OAUTH_CLIENT_ID || PLAYGROUND_CLIENT_ID).trim();
  const clientSecret = (process.env.GMAIL_OAUTH_CLIENT_SECRET || '').trim();
  return { clientId, clientSecret };
}

/**
 * 用 refresh_token 换 access_token。成功后写入 .gmail_oauth_token 与 .env 的 GMAIL_OAUTH_TOKEN。
 * 若 Google 返回新的 refresh_token（rotation），同步更新 GMAIL_OAUTH_REFRESH_TOKEN。
 */
async function refreshAccessToken() {
  const refreshToken = (process.env.GMAIL_OAUTH_REFRESH_TOKEN || '').trim();
  if (!refreshToken) {
    throw new Error('缺少 GMAIL_OAUTH_REFRESH_TOKEN：长期发信需要 refresh_token');
  }
  const { clientId, clientSecret } = getClientCreds();
  if (!clientSecret) {
    throw new Error(
      '缺少 GMAIL_OAUTH_CLIENT_SECRET。请在 Google Cloud 创建 OAuth 客户端，' +
      '或把与签发 refresh_token 时相同的 client_id/secret 写入 .env（见 README）'
    );
  }
  const res = await postForm(TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (res.status !== 200 || !res.json || !res.json.access_token) {
    throw new Error(
      'Gmail access token 刷新失败: ' + res.status + ' ' + (res.raw || '').slice(0, 300)
    );
  }
  persistAccessToken(res.json.access_token);
  if (res.json.refresh_token) {
    upsertEnv('GMAIL_OAUTH_REFRESH_TOKEN', res.json.refresh_token);
  }
  console.log('Gmail access token 已刷新（expires_in=' + (res.json.expires_in || '?') + 's）');
  return res.json.access_token;
}

/**
 * authorization_code → access_token + refresh_token，写入 .env（不打印密钥）。
 */
async function exchangeAuthorizationCode(code, redirectUri) {
  const { clientId, clientSecret } = getClientCreds();
  if (!clientSecret) {
    throw new Error('兑换 authorization code 需要 GMAIL_OAUTH_CLIENT_SECRET');
  }
  if (!process.env.GMAIL_OAUTH_CLIENT_ID) {
    upsertEnv('GMAIL_OAUTH_CLIENT_ID', clientId);
  }
  const res = await postForm(TOKEN_URL, {
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri || DEFAULT_REDIRECT,
  });
  if (res.status !== 200 || !res.json || !res.json.access_token) {
    throw new Error(
      'authorization code 兑换失败: ' + res.status + ' ' + (res.raw || '').slice(0, 300)
    );
  }
  persistAccessToken(res.json.access_token);
  if (res.json.refresh_token) {
    upsertEnv('GMAIL_OAUTH_REFRESH_TOKEN', res.json.refresh_token);
    console.log('已写入 GMAIL_OAUTH_REFRESH_TOKEN 与 GMAIL_OAUTH_TOKEN（.env / .gmail_oauth_token）');
  } else {
    console.log(
      '已写入 GMAIL_OAUTH_TOKEN；响应无 refresh_token（需 access_type=offline 且 prompt=consent 重新授权）'
    );
  }
  return res.json;
}

/**
 * 发信前解析可用 access token：
 * 1) 若配置了 GMAIL_OAUTH_REFRESH_TOKEN + CLIENT_SECRET → 先刷新（保证例程长期可跑）
 * 2) 否则退回现有 GMAIL_OAUTH_TOKEN / .gmail_oauth_token（约 1 小时过期）
 */
async function resolveAccessToken() {
  const hasRefresh = !!(process.env.GMAIL_OAUTH_REFRESH_TOKEN || '').trim();
  const hasSecret = !!(process.env.GMAIL_OAUTH_CLIENT_SECRET || '').trim();
  if (hasRefresh && hasSecret) {
    return refreshAccessToken();
  }
  const cached = readCachedAccessToken();
  if (cached) {
    if (hasRefresh && !hasSecret) {
      console.warn(
        '[gmail] 有 GMAIL_OAUTH_REFRESH_TOKEN 但缺少 GMAIL_OAUTH_CLIENT_SECRET，本次使用现有 access token（约 1h 过期）'
      );
    }
    return cached;
  }
  throw new Error(
    '缺少可用 Gmail token：请配置 GMAIL_OAUTH_REFRESH_TOKEN + GMAIL_OAUTH_CLIENT_ID/SECRET，' +
    '或提供未过期的 GMAIL_OAUTH_TOKEN'
  );
}

/** RFC 2047 encode Subject when it contains non-ASCII (e.g. middle dot ·). */
function encodeSubject(subject) {
  const s = String(subject ?? '');
  if (!/[^\x00-\x7F]/.test(s)) return s;
  return '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
}

async function sendMail(args, token) {
  const payload = JSON.parse(fs.readFileSync(args.payload, 'utf8'));
  const subject = args.subject || payload.subject || '(no subject)';
  const html = payload.htmlBody || '';
  const eml = [
    `To: ${args.to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
  ].join('\r\n');
  const raw = Buffer.from(eml, 'utf8').toString('base64url');
  const res = await postJson(SEND_URL, token, { raw });
  console.log('已发送:', res.id, '->', args.to);
}

async function main() {
  loadEnvFile();
  const args = parseArgs(process.argv);

  if (args.exchangeCode) {
    await exchangeAuthorizationCode(args.exchangeCode, args.redirectUri);
    return;
  }
  if (args.refreshOnly) {
    await refreshAccessToken();
    return;
  }
  if (!args.payload || !args.to) {
    console.error(
      '用法:\n' +
      '  node tools/send-via-gmail-api.js send-payload.json --to a@x.com [--subject "..."]\n' +
      '  node tools/send-via-gmail-api.js --exchange-code <AUTH_CODE> [--redirect-uri URL]\n' +
      '  node tools/send-via-gmail-api.js --refresh-only'
    );
    process.exit(1);
  }
  const token = await resolveAccessToken();
  await sendMail(args, token);
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
