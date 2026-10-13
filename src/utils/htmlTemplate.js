const { buildChartPng } = require('./pngChart');

function isNum(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function fmt(n, digits = 2) {
  if (!isNum(n)) return 'N/A';
  return Number(n).toFixed(digits);
}

function fmtThousands(abs, digits) {
  return abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Money: '-€6,298', '+$651', '$0'. signed=true adds '+' for positive values.
function fmtMoney(n, sym, digits = 2, signed = false) {
  if (!isNum(n)) return 'N/A';
  const rounded = Number(n.toFixed(digits));
  if (rounded === 0) return `${sym}${fmtThousands(0, digits)}`;
  const sign = rounded < 0 ? '-' : (signed ? '+' : '');
  return `${sign}${sym}${fmtThousands(Math.abs(rounded), digits)}`;
}

// Percent: '+1.23%', '-4.56%', '0.00%', 'N/A'.
function fmtPct(n) {
  if (!isNum(n)) return 'N/A';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

// Shares: integers as-is, fractional shares with up to 4 decimals.
function fmtShares(n) {
  if (!isNum(n)) return 'N/A';
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(4)));
}

function dateStr(d) {
  if (!d) return '';
  if (typeof d === 'string') return d;
  const pad = (x) => (x < 10 ? '0' + x : '' + x);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const COLOR = {
  up: '#34c759',
  down: '#ff3b30',
  flat: '#8e8e93',
  text: '#1d1d1f',
  sub: '#86868b',
  bg: '#f5f5f7',
  card: '#ffffff',
  border: '#d2d2d7',
  upBg: '#e8f8ed',
  downBg: '#fcebeb',
  flatBg: '#f0f0f2',
  blue: '#0071e3',
};

function changeColor(pct) {
  if (!isNum(pct)) return COLOR.flat;
  if (pct > 0) return COLOR.up;
  if (pct < 0) return COLOR.down;
  return COLOR.flat;
}

function changeBg(pct) {
  if (!isNum(pct)) return COLOR.flatBg;
  if (pct > 0) return COLOR.upBg;
  if (pct < 0) return COLOR.downBg;
  return COLOR.flatBg;
}

function barWidth(pct) {
  if (!isNum(pct)) return '0.0';
  return (Math.min(Math.abs(pct) / 10, 1) * 100).toFixed(1);
}

function currencySymbol(currency) {
  if (currency === 'EUR') return '\u20AC';
  if (currency === 'GBP') return '\u00A3';
  if (currency === 'HKD') return 'HK$';
  if (currency === 'CNY' || currency === 'RMB') return '\u00A5';
  return '$';
}

const MISSING_LABEL = {
  'close': 'close',
  'prev close': 'prev close',
  'daily bars': 'daily bars',
  'chart': 'chart',
};

function buildMissingNote(positions) {
  const items = positions.filter((p) => p.missing && p.missing.length);
  if (!items.length) return '';
  const lines = items.map((p) => {
    const what = p.missing.map((m) => MISSING_LABEL[m] || m).join(', ');
    const mark = p.valuationSource === 'mark' ? ' (value uses IBKR live mark price)' : '';
    return `<div>${p.code}: ${what}${mark}</div>`;
  }).join('');
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-bottom:10px;">
    <tr><td bgcolor="#fff4e5" style="background:#fff4e5;border:1px solid #ffcc80;border-radius:14px;padding:14px 20px;font-size:12px;line-height:1.6;color:#8a4b00;">
    <div style="font-weight:600;font-size:13px;margin-bottom:2px;">\u6570\u636e\u7f3a\u5931 / data missing</div>
    ${lines}
    <div style="margin-top:4px;color:#a0661b;">Missing values are shown as N/A and excluded from up/down counts.</div>
    </td></tr>
  </table>`;
}

function buildHeader(data) {
  const { tradeDate, summary } = data;
  const rows = summary.currencies.map((cur) => {
    const g = summary.byCurrency[cur];
    const sym = currencySymbol(cur);
    const pColor = changeColor(g.profitPercent);
    const mvNote = g.usesMark ? ' *' : '';
    return `
      <tr>
        <td width="44" style="padding:8px 0;border-top:1px solid ${COLOR.border};font-size:12px;font-weight:600;color:${COLOR.sub};vertical-align:baseline;">${cur}</td>
        <td style="padding:8px 12px 8px 0;border-top:1px solid ${COLOR.border};vertical-align:baseline;">
          <div style="font-size:11px;color:${COLOR.sub};text-transform:uppercase;letter-spacing:0.5px;">Market Value</div>
          <div style="font-size:18px;font-weight:600;color:${COLOR.text};margin-top:2px;">${fmtMoney(g.marketValue, sym, 0)}${mvNote}</div>
        </td>
        <td style="padding:8px 0;border-top:1px solid ${COLOR.border};vertical-align:baseline;">
          <div style="font-size:11px;color:${COLOR.sub};text-transform:uppercase;letter-spacing:0.5px;">Total P&amp;L</div>
          <div style="font-size:18px;font-weight:600;color:${pColor};margin-top:2px;">${fmtPct(g.profitPercent)}</div>
          <div style="font-size:13px;font-weight:500;color:${pColor};margin-top:1px;" >${fmtMoney(g.profit, sym, 0, true)}</div>
        </td>
      </tr>`;
  }).join('');
  const markFoot = summary.currencies.some((c) => summary.byCurrency[c].usesMark)
    ? `<div style="font-size:11px;color:${COLOR.sub};margin-top:6px;">* includes IBKR live mark price where the close was missing</div>` : '';
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-bottom:10px;">
    <tr><td bgcolor="${COLOR.card}" style="background:${COLOR.card};border-radius:14px;padding:28px 24px;">
    <div style="font-size:24px;font-weight:600;letter-spacing:-0.5px;color:${COLOR.text};">Portfolio Brief</div>
    <div style="font-size:13px;color:${COLOR.sub};margin-top:4px;">${dateStr(tradeDate)} \u00B7 Close Summary \u00B7 per currency, no FX conversion</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:16px;">${rows}</table>
    ${markFoot}
    </td></tr>
  </table>`;
}

function sortByChange(positions) {
  // Rows with a real change first (desc), rows with missing change last.
  return [...positions].sort((a, b) => {
    const am = isNum(a.changePercent), bm = isNum(b.changePercent);
    if (am && bm) return b.changePercent - a.changePercent;
    if (am) return -1;
    if (bm) return 1;
    return 0;
  });
}

function buildMarketMap(positions) {
  const sorted = sortByChange(positions);
  // Table grid survives Gmail better than flex + background-only tiles.
  const cells = sorted.map((p) => {
    const color = changeColor(p.changePercent);
    const bg = changeBg(p.changePercent);
    return `<td bgcolor="${bg}" style="background:${bg};border-radius:8px;padding:10px 8px;text-align:center;min-width:80px;">
      <div style="font-size:13px;font-weight:600;color:${COLOR.text};">${p.code}</div>
      <div style="font-size:13px;font-weight:600;color:${color};margin-top:2px;">${fmtPct(p.changePercent)}</div>
    </td>`;
  }).join('<td width="8" style="font-size:0;line-height:0;">&nbsp;</td>');
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-bottom:10px;">
    <tr><td bgcolor="${COLOR.card}" style="background:${COLOR.card};border-radius:14px;padding:20px 24px;">
    <div style="font-size:11px;color:${COLOR.sub};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">Market Map</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;"><tr>${cells}</tr></table>
    </td></tr>
  </table>`;
}

function buildPositionRow(p, idx, isLast, ctx) {
  const color = changeColor(p.changePercent);
  const width = barWidth(p.changePercent);
  const sym = currencySymbol(p.currency);
  const pColor = changeColor(p.profit);
  const border = isLast ? '' : `border-bottom:1px solid ${COLOR.border};`;
  const hasChart = p.intraday && p.intraday.length > 1;
  const chart = hasChart ? buildIntradayChart(p, idx, ctx) : '';
  const priceStr = isNum(p.close)
    ? fmtMoney(p.close, sym, 2)
    : (p.valuationSource === 'mark' ? `close N/A (mark ${fmtMoney(p.valuationPrice, sym, 2)})` : 'close N/A');
  const missingTag = p.missing && p.missing.length
    ? `<div style="font-size:11px;color:#b26a00;margin-top:2px;">\u6570\u636e\u7f3a\u5931 / data missing: ${p.missing.join(', ')}</div>` : '';
  // Progress bar: nested table + bgcolor (Gmail strips many CSS backgrounds on divs).
  const barInner = Number(width) > 0
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>
        <td bgcolor="${color}" width="${width}%" style="background:${color};height:5px;font-size:0;line-height:0;border-radius:3px;">&nbsp;</td>
        <td bgcolor="${COLOR.bg}" style="background:${COLOR.bg};height:5px;font-size:0;line-height:0;">&nbsp;</td>
      </tr></table>`
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>
        <td bgcolor="${COLOR.bg}" style="background:${COLOR.bg};height:5px;font-size:0;line-height:0;border-radius:3px;">&nbsp;</td>
      </tr></table>`;
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
    <tr>
      <td style="padding:14px 0;${border}vertical-align:middle;">
        <div style="font-size:15px;font-weight:600;color:${COLOR.text};">${p.code}</div>
        <div style="font-size:12px;color:${COLOR.sub};margin-top:1px;">${fmtShares(p.holdShares)} shares \u00B7 ${priceStr}<span> \u00B7 cost ${fmtMoney(p.costPrice, sym, 2)}</span></div>
        ${missingTag}
      </td>
      <td width="100" style="padding:14px 12px;${border}vertical-align:middle;">${barInner}</td>
      <td width="110" style="padding:14px 0;${border}text-align:right;vertical-align:middle;">
        <div style="font-size:15px;font-weight:600;color:${color};">${fmtPct(p.changePercent)}</div>
        <div style="font-size:12px;color:${pColor};margin-top:1px;"><span>${fmtMoney(p.profit, sym, 0, true)} </span>(${fmtPct(p.profitPercent)})</div>
      </td>
    </tr>
  </table>${chart}`;
}

function chartContentId(idx) {
  return `chart-${idx}.png`;
}

/** Gmail MCP strips ALL <img> (cid / data / https). Use nested tables + bgcolor. */
function buildHtmlSparkline(bars, opts) {
  const { prevClose, dayHigh, dayLow, isUp } = opts;
  const prices = bars.map((b) => b.close).filter(isNum);
  if (prices.length < 2) return '';
  const maxBars = 56;
  let sampled = prices;
  if (prices.length > maxBars) {
    const step = prices.length / maxBars;
    sampled = [];
    for (let i = 0; i < maxBars; i++) sampled.push(prices[Math.min(prices.length - 1, Math.floor(i * step))]);
  }
  let min = Math.min(dayLow, Math.min.apply(null, prices));
  let max = Math.max(dayHigh, Math.max.apply(null, prices));
  if (isNum(prevClose) && prevClose > 0) {
    min = Math.min(min, prevClose);
    max = Math.max(max, prevClose);
  }
  const range = max - min || 1;
  const H = 48;
  const barW = 4;
  const gap = 1;
  let up = isUp;
  if (typeof up !== 'boolean') up = sampled[sampled.length - 1] >= sampled[0];
  const col = up ? COLOR.up : COLOR.down;
  const cells = sampled.map((p) => {
    const h = Math.max(2, Math.round(((p - min) / range) * (H - 2)));
    return `<td valign="bottom" height="${H}" style="height:${H}px;vertical-align:bottom;padding:0;font-size:0;line-height:0;">`
      + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>`
      + `<td bgcolor="${col}" width="${barW}" height="${h}" style="width:${barW}px;height:${h}px;font-size:0;line-height:0;">&nbsp;</td>`
      + `</tr></table></td>`
      + `<td width="${gap}" style="font-size:0;line-height:0;width:${gap}px;">&nbsp;</td>`;
  }).join('');
  // prevClose marker as thin gray column height
  let prevMark = '';
  if (isNum(prevClose) && prevClose > 0) {
    const ph = Math.max(2, Math.round(((prevClose - min) / range) * (H - 2)));
    prevMark = `<td valign="bottom" height="${H}" style="height:${H}px;vertical-align:bottom;padding:0 0 0 4px;font-size:0;line-height:0;">`
      + `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`
      + `<td bgcolor="${COLOR.flat}" width="2" height="${ph}" style="width:2px;height:${ph}px;font-size:0;line-height:0;">&nbsp;</td>`
      + `</tr></table></td>`;
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;max-width:400px;"><tr>${cells}${prevMark}</tr></table>`;
}

function buildIntradayChart(p, idx, ctx) {
  const bars = p.intraday || [];
  if (bars.length < 2) return '';
  const dayHigh = Math.max.apply(null, bars.map((b) => b.high));
  const dayLow = Math.min.apply(null, bars.map((b) => b.low));
  const hasPrev = isNum(p.prevClose) && p.prevClose > 0;
  const sym = currencySymbol(p.currency);
  const midLine = (dayHigh + dayLow) / 2;
  let isUp;
  if (hasPrev && isNum(p.close)) isUp = p.close >= p.prevClose;
  const chartOpts = { prevClose: hasPrev ? p.prevClose : null, dayHigh, dayLow, isUp };

  let chartInner;
  if (ctx.imageMode === 'html') {
    chartInner = buildHtmlSparkline(bars, chartOpts);
  } else {
    const pngBuf = buildChartPng(bars, chartOpts);
    const contentId = chartContentId(idx);
    let imgSrc;
    if (ctx.imageMode === 'dataUri') {
      imgSrc = `data:image/png;base64,${pngBuf.toString('base64')}`;
    } else {
      // SMTP path: cid + multipart/related (Gmail MCP cannot use this — strips all <img>)
      imgSrc = `cid:${contentId}`;
      ctx.attachments.push({
        filename: contentId,
        contentId,
        mimeType: 'image/png',
        inline: true,
        content: pngBuf.toString('base64'),
      });
    }
    chartInner = `<img src="${imgSrc}" width="400" height="80" style="display:block;width:100%;max-width:400px;height:auto;border-radius:6px;" alt="${p.code} chart"/>`;
  }

  const prevLabel = hasPrev
    ? `\u00B7 prev <span style="color:${COLOR.text};">${fmtMoney(p.prevClose, sym, 2)}</span>`
    : `\u00B7 prev <span style="color:${COLOR.sub};">N/A</span>`;
  return `
    <div style="padding:8px 0 4px;">
      ${chartInner}
      <div style="font-size:9px;color:${COLOR.sub};margin-top:3px;">
        High <span style="color:${COLOR.up};font-weight:600;">${fmtMoney(dayHigh, sym, 2)}</span>
        \u00B7 Mid (H+L)/2 <span style="color:${COLOR.sub};">${fmtMoney(midLine, sym, 2)}</span>
        \u00B7 Low <span style="color:${COLOR.down};font-weight:600;">${fmtMoney(dayLow, sym, 2)}</span>
        ${prevLabel}
      </div>
    </div>`;
}

function buildComment(data) {
  const { positions, summary } = data;
  if (!positions.length) return 'No positions today.';
  const sorted = sortByChange(positions).filter((p) => isNum(p.changePercent));
  const parts = [];
  parts.push(`${positions.length} positions`);
  parts.push(`${summary.upCount} up / ${summary.downCount} down / ${summary.flatCount} flat / ${summary.missingCount} missing`);
  if (sorted.length) {
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    if (top.changePercent > 0) parts.push(`top ${top.code} ${fmtPct(top.changePercent)}`);
    if (bottom.changePercent < 0) parts.push(`low ${bottom.code} ${fmtPct(bottom.changePercent)}`);
  }
  return parts.join(' \u00B7 ');
}

function buildPlainText(data) {
  const trade = dateStr(data.tradeDate);
  return `Portfolio Brief for trade day ${trade}.\n\n${buildComment(data)}\n\nOpen the HTML version to see charts and details.`;
}

/**
 * Build portfolio brief HTML.
 * @param {object} data
 * @param {object} [opts]
 * @param {'html'|'cid'|'dataUri'} [opts.imageMode='html']
 *   - html: table+bgcolor sparklines (Gmail MCP-safe; MCP strips ALL <img>)
 *   - cid: <img src="cid:chart-N.png"> + attachments[] for SMTP multipart/related
 *   - dataUri: embed base64 (local --dry preview.html only)
 * @returns {{ html: string, attachments: Array, text: string }}
 */
function buildFallbackHtml(data, opts = {}) {
  const mode = opts.imageMode;
  const imageMode = mode === 'cid' || mode === 'dataUri' ? mode : 'html';
  const ctx = { imageMode, attachments: [] };
  const positions = data.positions || [];
  const header = buildHeader(data);
  const missingNote = buildMissingNote(positions);
  const marketMap = buildMarketMap(positions);
  const rows = positions.map((p, i) => buildPositionRow(p, i, i === positions.length - 1, ctx)).join('');
  const comment = buildComment(data);
  // No checkbox toggles: Gmail strips <style>/input/label, leaving fake "Show P&L" text.
  // P&L amounts and cost are always visible; charts always expanded.
  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.bg}" style="border-collapse:collapse;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;background:${COLOR.bg};color:${COLOR.text};">
  <tr><td style="padding:20px;">
  ${header}
  ${missingNote}
  ${marketMap}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-bottom:10px;">
    <tr><td bgcolor="${COLOR.card}" style="background:${COLOR.card};border-radius:14px;padding:8px 24px;">
    <div style="padding:8px 0 4px;font-size:11px;color:${COLOR.sub};text-transform:uppercase;letter-spacing:0.5px;">Positions</div>
    ${rows || `<div style="padding:32px 0;text-align:center;color:${COLOR.sub};font-size:14px;">No positions</div>`}
    </td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-bottom:10px;">
    <tr><td bgcolor="${COLOR.card}" style="background:${COLOR.card};border-radius:14px;padding:16px 24px;">
    <div style="font-size:11px;color:${COLOR.sub};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Summary</div>
    <div style="font-size:14px;line-height:1.5;color:${COLOR.text};">${comment}</div>
    </td></tr>
  </table>
  <div style="text-align:center;font-size:11px;color:${COLOR.sub};padding:8px 0;">portfolio-brief-bot</div>
  </td></tr>
</table>`;
  return {
    html,
    attachments: ctx.attachments,
    text: buildPlainText(data),
  };
}

/**
 * Gmail MCP payload. MCP strips every <img> (cid/data/https), so charts are HTML
 * table sparklines — no attachments. Do not pass CID PNG attachments here.
 */
function buildGmailPayload(data, { subject } = {}) {
  const built = buildFallbackHtml(data, { imageMode: 'html' });
  return {
    subject: subject || '',
    body: built.text,
    htmlBody: built.html,
    // intentionally empty: MCP treats "inline" PNGs as downloadable files and drops <img>
    attachments: [],
  };
}

module.exports = { buildFallbackHtml, buildGmailPayload, buildPlainText };
