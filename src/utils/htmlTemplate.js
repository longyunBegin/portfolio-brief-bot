const { buildChartBase64 } = require('./pngChart');

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
  <div style="background:#fff4e5;border:1px solid #ffcc80;border-radius:14px;padding:14px 20px;margin-bottom:10px;font-size:12px;line-height:1.6;color:#8a4b00;">
    <div style="font-weight:600;font-size:13px;margin-bottom:2px;">\u6570\u636e\u7f3a\u5931 / data missing</div>
    ${lines}
    <div style="margin-top:4px;color:#a0661b;">Missing values are shown as N/A and excluded from up/down counts.</div>
  </div>`;
}

function buildHeader(data) {
  const { tradeDate, summary } = data;
  const rows = summary.currencies.map((cur) => {
    const g = summary.byCurrency[cur];
    const sym = currencySymbol(cur);
    const pColor = changeColor(g.profitPercent);
    const mvNote = g.usesMark ? ' *' : '';
    return `
      <div style="display:flex;gap:24px;align-items:baseline;padding:8px 0;border-top:1px solid ${COLOR.border};">
        <div style="width:44px;font-size:12px;font-weight:600;color:${COLOR.sub};">${cur}</div>
        <div style="flex:1;">
          <div style="font-size:11px;color:${COLOR.sub};text-transform:uppercase;letter-spacing:0.5px;">Market Value</div>
          <div style="font-size:18px;font-weight:600;color:${COLOR.text};margin-top:2px;">${fmtMoney(g.marketValue, sym, 0)}${mvNote}</div>
        </div>
        <div style="flex:1;">
          <div style="font-size:11px;color:${COLOR.sub};text-transform:uppercase;letter-spacing:0.5px;">Total P&amp;L</div>
          <div style="font-size:18px;font-weight:600;color:${pColor};margin-top:2px;">${fmtPct(g.profitPercent)}</div>
          <div style="font-size:13px;font-weight:500;color:${pColor};margin-top:1px;" class="pnl-amt">${fmtMoney(g.profit, sym, 0, true)}</div>
        </div>
      </div>`;
  }).join('');
  const markFoot = summary.currencies.some((c) => summary.byCurrency[c].usesMark)
    ? `<div style="font-size:11px;color:${COLOR.sub};margin-top:6px;">* includes IBKR live mark price where the close was missing</div>` : '';
  return `
  <div style="background:${COLOR.card};border-radius:14px;padding:28px 24px;margin-bottom:10px;">
    <div style="font-size:24px;font-weight:600;letter-spacing:-0.5px;color:${COLOR.text};">Portfolio Brief</div>
    <div style="font-size:13px;color:${COLOR.sub};margin-top:4px;">${dateStr(tradeDate)} \u00B7 Close Summary \u00B7 per currency, no FX conversion</div>
    <div style="margin-top:16px;">${rows}</div>
    ${markFoot}
    <div style="margin-top:14px;">
      <label for="pnl-toggle" style="display:inline-block;font-size:12px;color:${COLOR.blue};cursor:pointer;user-select:none;">\u25B8 Show P&amp;L &amp; Cost</label>
    </div>
  </div>`;
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
  const blocks = sorted.map((p) => {
    const color = changeColor(p.changePercent);
    const bg = changeBg(p.changePercent);
    return `<div style="background:${bg};border-radius:8px;padding:10px 8px;text-align:center;flex:1 1 0;min-width:80px;">
      <div style="font-size:13px;font-weight:600;color:${COLOR.text};">${p.code}</div>
      <div style="font-size:13px;font-weight:600;color:${color};margin-top:2px;">${fmtPct(p.changePercent)}</div>
    </div>`;
  }).join('');
  return `
  <div style="background:${COLOR.card};border-radius:14px;padding:20px 24px;margin-bottom:10px;">
    <div style="font-size:11px;color:${COLOR.sub};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">Market Map</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;">${blocks}</div>
  </div>`;
}

function buildPositionRow(p, idx, isLast) {
  const color = changeColor(p.changePercent);
  const width = barWidth(p.changePercent);
  const sym = currencySymbol(p.currency);
  const pColor = changeColor(p.profit);
  const border = isLast ? '' : `border-bottom:1px solid ${COLOR.border};`;
  const hasChart = p.intraday && p.intraday.length > 1;
  const chart = hasChart ? buildIntradayChart(p, idx) : '';
  const priceStr = isNum(p.close)
    ? fmtMoney(p.close, sym, 2)
    : (p.valuationSource === 'mark' ? `close N/A (mark ${fmtMoney(p.valuationPrice, sym, 2)})` : 'close N/A');
  const missingTag = p.missing && p.missing.length
    ? `<div style="font-size:11px;color:#b26a00;margin-top:2px;">\u6570\u636e\u7f3a\u5931 / data missing: ${p.missing.join(', ')}</div>` : '';
  return `
  <div style="display:flex;align-items:center;padding:14px 0;${border}">
    <div style="flex:1;">
      <div style="font-size:15px;font-weight:600;color:${COLOR.text};">${p.code}</div>
      <div style="font-size:12px;color:${COLOR.sub};margin-top:1px;">${fmtShares(p.holdShares)} shares \u00B7 ${priceStr}<span class="cost-info"> \u00B7 cost ${fmtMoney(p.costPrice, sym, 2)}</span></div>
      ${missingTag}
    </div>
    <div style="width:100px;margin:0 12px;">
      <div style="background:${COLOR.bg};border-radius:3px;height:5px;overflow:hidden;">
        <div style="background:${color};height:100%;width:${width}%;border-radius:3px;"></div>
      </div>
    </div>
    <div style="width:110px;text-align:right;">
      <div style="font-size:15px;font-weight:600;color:${color};">${fmtPct(p.changePercent)}</div>
      <div style="font-size:12px;color:${pColor};margin-top:1px;"><span class="pnl-amt">${fmtMoney(p.profit, sym, 0, true)} </span>(${fmtPct(p.profitPercent)})</div>
    </div>
  </div>${chart}`;
}

function buildIntradayChart(p, idx) {
  const bars = p.intraday || [];
  if (bars.length < 2) return '';
  const dayHigh = Math.max.apply(null, bars.map((b) => b.high));
  const dayLow = Math.min.apply(null, bars.map((b) => b.low));
  const hasPrev = isNum(p.prevClose) && p.prevClose > 0;
  const sym = currencySymbol(p.currency);
  const midLine = (dayHigh + dayLow) / 2;
  let isUp;
  if (hasPrev && isNum(p.close)) isUp = p.close >= p.prevClose;
  const png64 = buildChartBase64(bars, { prevClose: hasPrev ? p.prevClose : null, dayHigh, dayLow, isUp });
  const prevLabel = hasPrev
    ? `\u00B7 prev <span style="color:${COLOR.text};">${fmtMoney(p.prevClose, sym, 2)}</span>`
    : `\u00B7 prev <span style="color:${COLOR.sub};">N/A</span>`;
  return `
    <div class="ic-${idx}" style="padding:8px 0 4px;">
      <img src="data:image/png;base64,${png64}" width="400" height="80" style="display:block;width:100%;max-width:400px;height:auto;border-radius:6px;" alt="chart"/>
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

function buildFallbackHtml(data) {
  const positions = data.positions || [];
  const header = buildHeader(data);
  const missingNote = buildMissingNote(positions);
  const marketMap = buildMarketMap(positions);
  const rows = positions.map((p, i) => buildPositionRow(p, i, i === positions.length - 1)).join('');
  const comment = buildComment(data);
  const chartIndices = positions.map((p, i) => (p.intraday && p.intraday.length > 1 ? i : -1)).filter((i) => i >= 0);
  const chartCss = chartIndices.map((i) =>
    `.ic-${i} { display: block; }\n  #chart-all:checked ~ .pnl-wrap .ic-${i} { display: none; }`
  ).join('\n  ');
  const hasCharts = chartIndices.length > 0;
  return `
<style>
  .pnl-amt { display: none; }
  #pnl-toggle:checked ~ .pnl-wrap .pnl-amt { display: inline; }
  .cost-info { display: none; }
  #pnl-toggle:checked ~ .pnl-wrap .cost-info { display: inline; }
  .chart-all-expanded { display: none; }
  #chart-all:checked ~ .pnl-wrap .chart-all-expanded { display: inline; }
  #chart-all:checked ~ .pnl-wrap .chart-all-collapsed { display: none; }
  ${chartCss}
</style>
<input type="checkbox" id="pnl-toggle" style="display:none;">
<input type="checkbox" id="chart-all" style="display:none;">
<div class="pnl-wrap" style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;background:${COLOR.bg};color:${COLOR.text};">
  ${header}
  ${missingNote}
  ${marketMap}
  <div style="background:${COLOR.card};border-radius:14px;padding:8px 24px;margin-bottom:10px;">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0 4px;">
      <div style="font-size:11px;color:${COLOR.sub};text-transform:uppercase;letter-spacing:0.5px;">Positions</div>
      ${hasCharts ? `<label for="chart-all" style="font-size:12px;font-weight:500;color:${COLOR.blue};background:rgba(0,113,227,0.08);border-radius:999px;padding:4px 14px;cursor:pointer;user-select:none;"><span class="chart-all-collapsed">Collapse Charts</span><span class="chart-all-expanded">Expand Charts</span></label>` : ''}
    </div>
    ${rows || `<div style="padding:32px 0;text-align:center;color:${COLOR.sub};font-size:14px;">No positions</div>`}
  </div>
  <div style="background:${COLOR.card};border-radius:14px;padding:16px 24px;margin-bottom:10px;">
    <div style="font-size:11px;color:${COLOR.sub};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Summary</div>
    <div style="font-size:14px;line-height:1.5;color:${COLOR.text};">${comment}</div>
  </div>
  <div style="text-align:center;font-size:11px;color:${COLOR.sub};padding:8px 0;">portfolio-brief-bot</div>
</div>`;
}

module.exports = { buildFallbackHtml };
