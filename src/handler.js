const config = require('./config');
const { getPositionsAndQuote } = require('./services/brokerService');
const { buildFallbackHtml } = require('./utils/htmlTemplate');
const { sendHtmlMail, buildSubject } = require('./services/mailService');
const { isTradeDate, getPreviousTradeDate, toDateStr, shouldNotifyNow } = require('./utils/tradeDateUtil');

async function run({ force = false, now = new Date(), dryRun = false } = {}) {
  if (!force && config.notify.tradeDayOnly) {
    const yesterday = new Date(now.getTime());
    yesterday.setDate(yesterday.getDate() - 1);
    if (!isTradeDate(yesterday)) {
      const reason = `昨日 ${toDateStr(yesterday)} 非美股交易日，跳过`;
      console.log('[handler] ' + reason);
      return { skipped: true, reason };
    }
  }

  console.log('[handler] 开始获取持仓与行情...');
  const data = await getPositionsAndQuote(now);
  console.log(`[handler] 获取到 ${data.positions.length} 只持仓，交易日 ${toDateStr(data.tradeDate)}`);

  if (!data.positions.length) {
    const reason = '无持仓数据，跳过发送';
    console.log('[handler] ' + reason);
    return { skipped: true, reason };
  }

  console.log('[handler] 生成 HTML 报告...');
  const html = buildFallbackHtml(data);
  console.log(`[handler] HTML 已生成 (length=${html.length})`);

  const subject = buildSubject(toDateStr(data.tradeDate), data.summary);

  if (dryRun) {
    console.log('[handler] dryRun=true，不发送邮件');
    return { skipped: false, dryRun: true, subject, html, data };
  }

  console.log(`[handler] 发送邮件至 ${config.smtp.to} ...`);
  const info = await sendHtmlMail({ subject, html });
  console.log('[handler] 邮件发送完成:', info.messageId || info.response || 'ok');

  return { skipped: false, subject, messageId: info.messageId };
}

module.exports = { run };