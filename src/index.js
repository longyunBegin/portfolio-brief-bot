const config = require('./config');
const { run } = require('./handler');

function scfHandler(event, context, callback) {
  run({ now: new Date() })
    .then((result) => {
      callback(null, { code: 0, msg: 'ok', result });
    })
    .catch((err) => {
      console.error('[scf] 执行失败:', err);
      callback(err, { code: 1, msg: err.message });
    });
}

async function runLocal() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dryRun = args.includes('--dry');
  try {
    config.validate({ skipSmtp: dryRun });
  } catch (e) {
    console.error('[local] 配置校验失败:', e.message);
    console.error('[local] 请复制 .env.example 为 .env 并填写后重试');
    process.exit(1);
  }
  try {
    const result = await run({ force, dryRun, now: new Date() });
    if (dryRun && result.html) {
      const fs = require('fs');
      const path = require('path');
      const out = path.resolve(process.cwd(), 'preview.html');
      fs.writeFileSync(out, result.html, 'utf-8');
      console.log(`[local] 预览已写入 ${out} (data-URI charts for browser)`);

      // Gmail-ready payload: htmlBody uses cid:chart-N.png; attachments are inline base64.
      if (result.gmailPayload) {
        const payloadPath = path.resolve(process.cwd(), 'send-payload.json');
        fs.writeFileSync(payloadPath, JSON.stringify(result.gmailPayload), 'utf-8');
        console.log(`[local] Gmail payload 已写入 ${payloadPath} (${(result.gmailPayload.attachments || []).length} inline charts)`);
      }
    }
    console.log('[local] 完成:', JSON.stringify({
      skipped: result.skipped,
      dryRun: result.dryRun,
      attachmentCount: result.attachmentCount || (result.attachments && result.attachments.length) || 0,
    }));
  } catch (e) {
    console.error('[local] 执行失败:', e);
    process.exit(1);
  }
}

if (require.main === module) {
  runLocal();
}

module.exports = { scfHandler, runLocal };
