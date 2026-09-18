const config = require('../config');
const { smtpDialog } = require('../utils/smtpClient');

function buildSubject(tradeDate, summary) {
  const sign = summary.totalProfitPercent >= 0 ? '+' : '';
  return `[Portfolio Brief] ${tradeDate} P&L ${sign}${summary.totalProfitPercent}%`;
}

async function sendHtmlMail({ subject, html, to }) {
  const recipients = to || config.smtp.to;
  const info = await smtpDialog({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    user: config.smtp.user,
    pass: config.smtp.pass,
    from: config.smtp.from,
    to: recipients,
    subject,
    html,
  });
  return info;
}

module.exports = {
  sendHtmlMail,
  buildSubject,
};
