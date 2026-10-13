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

function buildHeader(data, opts = {}) {
  const { tradeDate, summary } = data;
  const useToggles = opts.toggles !== false;
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
          <div class="pnl-amt" style="font-size:13px;font-weight:500;color:${pColor};margin-top:1px;">${fmtMoney(g.profit, sym, 0, true)}</div>
        </td>
      </tr>`;
  }).join('');
  const markFoot = summary.currencies.some((c) => summary.byCurrency[c].usesMark)
    ? `<div style="font-size:11px;color:${COLOR.sub};margin-top:6px;">* includes IBKR live mark price where the close was missing</div>` : '';
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-bottom:10px;">
    <tr><td bgcolor="${COLOR.card}" style="background:${COLOR.card};border-radius:14px;padding:20px 16px;">
    <div style="font-size:24px;font-weight:600;letter-spacing:-0.5px;color:${COLOR.text};">Portfolio Brief</div>
    <div style="font-size:13px;color:${COLOR.sub};margin-top:4px;">${dateStr(tradeDate)} \u00B7 Close Summary \u00B7 per currency, no FX conversion</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:16px;">${rows}</table>
    ${markFoot}
            <div style="margin-top:14px;">
      ${useToggles ? `<label for="pnl-toggle" class="cb-ui" style="display:none;font-size:12px;color:${COLOR.blue};cursor:pointer;user-select:none;">\u25B8 Show P&amp;L &amp; Cost</label>` : ''}
    </div>
    </div>
    </td></tr>
  </table>`;
}

function sortByChange(positions) {
  return [...positions].sort((a, b) => {
    const am = isNum(a.changePercent), bm = isNum(b.changePercent);
    if (am && bm) return b.changePercent - a.changePercent;
    if (am) return -1;
    if (bm) return 1;
    return 0;
  });
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildMarketMap(positions) {
  const sorted = sortByChange(positions);
  const COLS = 4;
  const rowHtml = chunk(sorted, COLS).map((group) => {
    const cells = [];
    for (let i = 0; i < COLS; i++) {
      const p = group[i];
      if (!p) {
        cells.push(`<td width="25%" style="width:25%;padding:3px;font-size:0;line-height:0;">&nbsp;</td>`);
        continue;
      }
      const color = changeColor(p.changePercent);
      const bg = changeBg(p.changePercent);
      cells.push(`<td width="25%" style="width:25%;padding:3px;vertical-align:top;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;">
          <tr><td bgcolor="${bg}" style="background:${bg};border-radius:8px;padding:10px 4px;text-align:center;">
            <div style="font-size:12px;font-weight:600;color:${COLOR.text};">${p.code}</div>
            <div style="font-size:12px;font-weight:600;color:${color};margin-top:2px;">${fmtPct(p.changePercent)}</div>
          </td></tr>
        </table>
      </td>`);
    }
    return `<tr>${cells.join('')}</tr>`;
  }).join('');
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-bottom:10px;">
    <tr><td bgcolor="${COLOR.card}" style="background:${COLOR.card};border-radius:14px;padding:16px;">
    <div style="font-size:11px;color:${COLOR.sub};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Market Map</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;">${rowHtml}</table>
    </td></tr>
  </table>`;
}

function buildPositionRow(p, idx, isLast, ctx) {
  const color = changeColor(p.changePercent);
  const width = barWidth(p.changePercent);
  const sym = currencySymbol(p.currency);
  const pColor = changeColor(p.profit);
  const border = isLast ? '' : `border-bottom:1px solid ${COLOR.border};`;
  const priceStr = isNum(p.close)
    ? fmtMoney(p.close, sym, 2)
    : (p.valuationSource === 'mark' ? `close N/A (mark ${fmtMoney(p.valuationPrice, sym, 2)})` : 'close N/A');
  const missingTag = p.missing && p.missing.length
    ? `<div style="font-size:11px;color:#b26a00;margin-top:2px;">\u6570\u636e\u7f3a\u5931 / data missing: ${p.missing.join(', ')}</div>` : '';
  const barFill = Number(width) > 0
    ? `<td bgcolor="${color}" width="${width}%" style="background:${color};height:6px;font-size:0;line-height:0;">&nbsp;</td>`
    : '';
  // Compact progress bar, right-aligned above the percentages (screenshot style).
  const barHtml = `
    <table role="presentation" width="140" cellpadding="0" cellspacing="0" border="0" align="right" style="border-collapse:collapse;width:140px;max-width:140px;margin:0 0 8px auto;">
      <tr>${barFill}
        <td bgcolor="#e8e8ed" style="background:#e8e8ed;height:6px;font-size:0;line-height:0;">&nbsp;</td>
      </tr>
    </table>`;
  // cost + absolute P&L: hidden via <style> only (no inline display:none) so
  // SMTP/163 checkbox can reveal them; Gmail without CSS shows them on the row.
  const chart = (p.intraday && p.intraday.length > 1) ? buildIntradayChartInner(p, idx, ctx) : '';
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;">
    <tr>
      <td style="padding:12px 0;${border}vertical-align:top;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;">
          <tr>
            <td style="vertical-align:top;">
              <div style="font-size:20px;font-weight:700;color:${COLOR.text};letter-spacing:-0.3px;">${p.code}</div>
              <div style="font-size:13px;color:${COLOR.sub};margin-top:3px;line-height:1.4;">${fmtShares(p.holdShares)} shares \u00B7 ${priceStr}<span class="cost-info"> \u00B7 cost ${fmtMoney(p.costPrice, sym, 2)}</span></div>
              ${missingTag}
            </td>
            <td width="150" style="width:150px;text-align:right;vertical-align:top;padding-left:8px;">
              ${barHtml}
              <div style="font-size:18px;font-weight:700;color:${color};clear:both;">${fmtPct(p.changePercent)}</div>
              <div style="font-size:12px;color:${pColor};margin-top:2px;line-height:1.35;"><span class="pnl-amt">${fmtMoney(p.profit, sym, 0, true)} </span>(${fmtPct(p.profitPercent)})</div>
            </td>
          </tr>
        </table>
        ${chart}
      </td>
    </tr>
  </table>`;
}

function chartContentId(idx) {
  return `chart-${idx}.png`;
}

/** Gmail MCP strips ALL <img> (cid / data / https). Nested tables + bgcolor only. */
function buildHtmlSparkline(bars, opts) {
  const { prevClose, dayHigh, dayLow, isUp } = opts;
  const prices = bars.map((b) => b.close).filter(isNum);
  if (prices.length < 2) return '';
  const maxBars = 36;
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
  const H = 52;
  let up = isUp;
  if (typeof up !== 'boolean') up = sampled[sampled.length - 1] >= sampled[0];
  const col = up ? COLOR.up : COLOR.down;
  const soft = up ? COLOR.upBg : COLOR.downBg;
  const n = sampled.length;
  const pct = (100 / n).toFixed(2);
  const cells = sampled.map((p) => {
    const h = Math.max(3, Math.round(((p - min) / range) * (H - 2)));
    return `<td width="${pct}%" valign="bottom" height="${H}" bgcolor="${soft}" style="width:${pct}%;height:${H}px;vertical-align:bottom;padding:0 1px 0 0;font-size:0;line-height:0;background:${soft};">`
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;"><tr>`
      + `<td bgcolor="${col}" height="${h}" style="background:${col};height:${h}px;font-size:0;line-height:0;border-radius:1px 1px 0 0;">&nbsp;</td>`
      + `</tr></table></td>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${soft}" style="border-collapse:collapse;width:100%;background:${soft};border-radius:8px;">
    <tr>${cells}</tr>
  </table>`;
}

function buildIntradayChartInner(p, idx, ctx) {
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
      imgSrc = `cid:${contentId}`;
      ctx.attachments.push({
        filename: contentId,
        contentId,
        mimeType: 'image/png',
        inline: true,
        content: pngBuf.toString('base64'),
      });
    }
    chartInner = `<img src="${imgSrc}" width="520" height="150" style="display:block;width:100%;max-width:520px;height:auto;border-radius:6px;" alt="${p.code} chart"/>`;
  }

  const prevLabel = hasPrev
    ? `prev <span style="color:${COLOR.text};">${fmtMoney(p.prevClose, sym, 2)}</span>`
    : `prev <span style="color:${COLOR.sub};">N/A</span>`;
  // Under the position row. Checkbox (#chart-all) hides .ic-N when <style> works.
  // <details open> lets Gmail-without-CSS collapse this chart; summary is hidden while CSS works.
  const meta = `<div style="font-size:11px;color:${COLOR.sub};margin-top:6px;line-height:1.5;">
        H <span style="color:${COLOR.up};font-weight:700;">${fmtMoney(dayHigh, sym, 2)}</span>
        \u00B7 M <span style="color:${COLOR.sub};">${fmtMoney(midLine, sym, 2)}</span>
        \u00B7 L <span style="color:${COLOR.down};font-weight:700;">${fmtMoney(dayLow, sym, 2)}</span>
        \u00B7 ${prevLabel}
      </div>`;
  const useToggles = ctx.toggles !== false;
  const body = useToggles
    ? `<details class="chart-details" open>
      <summary class="details-only" style="font-size:11px;color:${COLOR.blue};cursor:pointer;user-select:none;list-style:none;margin:0 0 4px;">Collapse chart</summary>
      ${chartInner}
      ${meta}
    </details>`
    : `${chartInner}${meta}`;
  return `
    <div class="ic-${idx}" style="padding:8px 0 2px;">
      ${body}
    </div>`;
}

/** Chart indices for CSS collapse (charts render under each position row). */
function collectChartIndices(positions) {
  const chartIndices = [];
  positions.forEach((p, i) => {
    if (p.intraday && p.intraday.length > 1) chartIndices.push(i);
  });
  return chartIndices;
}

function buildPositionsCard(positions, ctx, chartIndices) {
  const rows = positions.map((p, i) => buildPositionRow(p, i, i === positions.length - 1, ctx)).join('');
  const hasCharts = chartIndices.length > 0;
  const useToggles = ctx.toggles !== false;
  // Checkbox label when <style> kept. Expand uses inline display:none so a style-strip
  // never shows both "Collapse Charts" and "Expand Charts" as dead text.
  // Per-chart <details> (in buildIntradayChartInner) covers Gmail when CSS is gone.
  const collapseLabel = (hasCharts && useToggles)
    ? `<label for="chart-all" class="cb-ui" style="display:none;font-size:12px;font-weight:500;color:${COLOR.blue};background:rgba(0,113,227,0.08);border-radius:999px;padding:4px 14px;cursor:pointer;user-select:none;"><span class="chart-all-collapsed">Collapse Charts</span><span class="chart-all-expanded" style="display:none;">Expand Charts</span></label>`
    : '';
  const body = rows || `<div style="padding:32px 0;text-align:center;color:${COLOR.sub};font-size:14px;">No positions</div>`;
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-bottom:10px;">
    <tr><td bgcolor="${COLOR.card}" style="background:${COLOR.card};border-radius:14px;padding:8px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;">
      <tr>
        <td style="padding:8px 0 4px;font-size:11px;color:${COLOR.sub};text-transform:uppercase;letter-spacing:0.5px;">Positions</td>
        <td style="padding:8px 0 4px;text-align:right;">${collapseLabel}</td>
      </tr>
    </table>
    ${body}
    </td></tr>
  </table>`;
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

function buildToggleCss(chartIndices) {
  const chartCss = chartIndices.map((i) =>
    `.ic-${i} { display: block; }\n  #chart-all:checked ~ .pnl-wrap .ic-${i} { display: none !important; }`
  ).join('\n  ');
  return `<style type="text/css">
  /* Dual client (one markup, no second P&L list):
     - SMTP→163 / Gmail (style kept): checkbox labels control in-row cost/P&L + charts.
     - Style stripped but <details> kept (some Gmail paths): per-chart <details> works;
       cost/P&L stay visible on the same rows (CSS-only hide).
     - Gmail MCP (strips style+details+label): build with toggles:false — no dead buttons. */
  .cb-ui { display: inline-block !important; }
  .details-only { display: none !important; }
  .details-ui { display: none !important; }
  .pnl-amt { display: none; }
  #pnl-toggle:checked ~ .pnl-wrap .pnl-amt { display: inline !important; }
  #pnl-toggle:checked ~ .pnl-wrap div.pnl-amt { display: block !important; }
  .cost-info { display: none; }
  #pnl-toggle:checked ~ .pnl-wrap .cost-info { display: inline !important; }
  .chart-all-expanded { display: none !important; }
  #chart-all:checked ~ .pnl-wrap .chart-all-expanded { display: inline !important; }
  #chart-all:checked ~ .pnl-wrap .chart-all-collapsed { display: none !important; }
  ${chartCss}
</style>`;
}

/**
 * Build portfolio brief HTML (one markup for 163 + Gmail recipients).
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
  // toggles:false for Gmail MCP sends (API strips <style>/<label>/<details>/<input>).
  // toggles:true (default) for SMTP→163 and SMTP→Gmail where checkbox+CSS survive.
  const useToggles = opts.toggles !== false;
  const ctx = { imageMode, attachments: [], toggles: useToggles };
  const positions = data.positions || [];
  const header = buildHeader(data, { toggles: useToggles });
  const missingNote = buildMissingNote(positions);
  const marketMap = buildMarketMap(positions);
  const chartIndices = collectChartIndices(positions);
  const positionsCard = buildPositionsCard(positions, ctx, chartIndices);
  const comment = buildComment(data);
  const toggleCss = useToggles ? buildToggleCss(chartIndices) : '';
  const toggleInputs = useToggles
    ? `<input type="checkbox" id="pnl-toggle" style="display:none !important;max-height:0;overflow:hidden;">
<input type="checkbox" id="chart-all" style="display:none !important;max-height:0;overflow:hidden;">`
    : '';

  // Checkboxes are previous siblings of .pnl-wrap so :checked ~ .pnl-wrap works.
  const html = `${toggleCss}
${toggleInputs}
<table role="presentation" class="pnl-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.bg}" style="border-collapse:collapse;background:${COLOR.bg};">
  <tr><td align="center" style="padding:12px 8px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.bg}" style="border-collapse:collapse;width:100%;max-width:600px;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Arial,sans-serif;background:${COLOR.bg};color:${COLOR.text};">
  <tr><td style="padding:8px 8px 16px;">
  ${header}
  ${missingNote}
  ${marketMap}
  ${positionsCard}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-bottom:10px;">
    <tr><td bgcolor="${COLOR.card}" style="background:${COLOR.card};border-radius:14px;padding:14px 16px;">
    <div style="font-size:11px;color:${COLOR.sub};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Summary</div>
    <div style="font-size:14px;line-height:1.5;color:${COLOR.text};">${comment}</div>
    </td></tr>
  </table>
  <div style="text-align:center;font-size:11px;color:${COLOR.sub};padding:8px 0;">portfolio-brief-bot \u00B7 in-row toggles (checkbox when CSS kept; per-chart details otherwise)</div>
  </td></tr>
  </table>
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
function buildGmailPayload(data, { subject, imageMode } = {}) {
  // Gmail MCP strips interactive tags — omit toggle chrome (no dead Collapse/Expand text).
  // imageMode: 'html' (default, MCP-safe tables) or 'dataUri' (embedded PNGs, direct Gmail API only;
  //   <style> survives there, so toggles stay on).
  const direct = imageMode === 'dataUri';
  const built = buildFallbackHtml(data, {
    imageMode: direct ? 'dataUri' : 'html',
    toggles: direct,
  });
  return {
    subject: subject || '',
    body: built.text,
    htmlBody: built.html,
    attachments: [],
  };
}

module.exports = { buildFallbackHtml, buildGmailPayload, buildPlainText };
