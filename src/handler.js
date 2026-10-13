const config = require('./config');
const { getPositionsAndQuote } = require('./services/brokerService');
const { buildFallbackHtml } = require('./utils/htmlTemplate');
const { sendHtmlMail, buildSubject } = require('./services/mailService');
const { isTradeDate, toDateStr, holidayTableCovers } = require('./utils/tradeDateUtil');

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

  if (!holidayTableCovers(now)) {
    console.warn('[handler] 警告: 美股假期表未覆盖今年，请更新 src/utils/tradeDateUtil.js');
  }

  console.log('[handler] 开始获取持仓与行情...');
  const data = await getPositionsAndQuote(now);
  console.log(`[handler] 获取到 ${data.positions.length} 只持仓，交易日 ${toDateStr(data.tradeDate)}`);

  if (!data.positions.length) {
    const reason = '无持仓数据，跳过发送';
    console.log('[handler] ' + reason);
    return { skipped: true, reason };
  }

  const subject = buildSubject(toDateStr(data.tradeDate), data.summary);

  // SMTP: CID PNG. Gmail MCP: HTML sparklines (strips <img>). Toggles act on in-row cost/P&L and charts (checkbox+CSS).
  console.log('[handler] 生成 HTML 报告 (SMTP=cid, Gmail=html)...');
  const builtSmtp = buildFallbackHtml(data, { imageMode: 'cid' });
  const builtGmail = buildFallbackHtml(data, { imageMode: 'html' });
  console.log(`[handler] SMTP HTML length=${builtSmtp.html.length} charts=${builtSmtp.attachments.length}; Gmail HTML length=${builtGmail.html.length}`);

  const gmailPayload = {
    subject,
    body: builtGmail.text,
    htmlBody: builtGmail.html,
    attachments: [],
  };

  if (dryRun) {
    // Local preview keeps data-URI so opening preview.html in a browser shows PNG charts.
    const preview = buildFallbackHtml(data, { imageMode: 'dataUri' });
    console.log('[handler] dryRun=true，不发送邮件');
    return {
      skipped: false,
      dryRun: true,
      subject,
      html: preview.html,
      text: builtGmail.text,
      attachments: builtSmtp.attachments,
      gmailPayload,
      data,
    };
  }

  console.log(`[handler] 发送邮件至 ${config.smtp.to} (${builtSmtp.attachments.length} CID charts)...`);
  const info = await sendHtmlMail({
    subject,
    html: builtSmtp.html,
    text: builtSmtp.text,
    attachments: builtSmtp.attachments,
  });
  console.log('[handler] 邮件发送完成:', info.messageId || info.response || 'ok');

  return {
    skipped: false,
    subject,
    messageId: info.messageId,
    attachmentCount: builtSmtp.attachments.length,
    gmailPayload,
  };
}

module.exports = { run };
