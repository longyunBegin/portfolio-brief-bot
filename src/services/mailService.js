const config = require('../config');
const { smtpDialog } = require('../utils/smtpClient');

// Per-currency P&L, never mixed across currencies: "[Portfolio Brief] 2026-10-08 P&L EUR -41.47% · USD +19.22%"
function buildSubject(tradeDate, summary) {
  const parts = (summary.currencies || []).map((cur) => {
    const pct = summary.byCurrency[cur].profitPercent;
    if (typeof pct !== 'number') return `${cur} N/A`;
    return `${cur} ${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
  });
  const missing = summary.missingCount ? ` · ${summary.missingCount} data missing` : '';
  return `[Portfolio Brief] ${tradeDate} P&L ${parts.join(' · ')}${missing}`;
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
