/**
 * 直发 Gmail：绕过 MCP 的 <img> 清洗，直接调 Gmail REST API 发送原始邮件。
 *
 * 用法：
 *   GMAIL_OAUTH_TOKEN=<token> node tools/send-via-gmail-api.js send-payload.json \
 *     --to a@x.com,b@y.com [--subject "override"]
 *
 * 读取 send-payload.json（`node src/index.js --dry` 生成，需 GMAIL_IMAGE_MODE=dataUri），
 * 取其中的 subject / htmlBody，以 raw MIME 经 users.messages.send 发出。
 * data-URI 图片完整保留，Gmail 网页/手机端正常显示。
 *
 * 零依赖：只用 Node.js 内置模块。token 需含 gmail.send scope。
 */
const fs = require('fs');
const https = require('https');

function parseArgs(argv) {
  const out = { payload: null, to: null, subject: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--to') out.to = argv[++i];
    else if (a === '--subject') out.subject = argv[++i];
    else if (!out.payload) out.payload = a;
  }
  return out;
}

function postJson(url, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = Buffer.from(JSON.stringify(body));
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': data.length,
        } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch { /* ignore */ }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error(`Gmail API ${res.statusCode}: ${raw.slice(0, 300)}`));
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const token = process.env.GMAIL_OAUTH_TOKEN;
  if (!token) {
    console.error('缺少 GMAIL_OAUTH_TOKEN（需含 gmail.send scope 的 OAuth access token）');
    process.exit(1);
  }
  if (!args.payload || !args.to) {
    console.error('用法: GMAIL_OAUTH_TOKEN=<token> node tools/send-via-gmail-api.js send-payload.json --to a@x.com [--subject "..."]');
    process.exit(1);
  }
  const payload = JSON.parse(fs.readFileSync(args.payload, 'utf8'));
  const subject = args.subject || payload.subject || '(no subject)';
  const html = payload.htmlBody || '';
  const eml = [
    `To: ${args.to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
  ].join('\r\n');
  const raw = Buffer.from(eml, 'utf8').toString('base64url');
  const res = await postJson(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    token,
    { raw }
  );
  console.log('已发送:', res.id, '->', args.to);
}

main().catch((e) => { console.error('发送失败:', e.message); process.exit(1); });
