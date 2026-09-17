function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return Number(n).toFixed(digits);
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
  if (pct > 0) return COLOR.up;
  if (pct < 0) return COLOR.down;
  return COLOR.flat;
}

function changeBg(pct) {
  if (pct > 0) return COLOR.upBg;
  if (pct < 0) return COLOR.downBg;
  return COLOR.flatBg;
}

function barWidth(pct) {
  return (Math.min(Math.abs(pct) / 10, 1) * 100).toFixed(1);
}

function currencySymbol(currency) {
  if (currency === 'EUR') return '\u20AC';
  if (currency === 'GBP') return '\u00A3';
  if (currency === 'HKD') return 'HK$';
  if (currency === 'CNY' || currency === 'RMB') return '\u00A5';
  return '$';
}

function groupByCurrency(positions) {
  const groups = {};
  positions.forEach((p) => {
    const cur = p.currency || 'USD';
    if (!groups[cur]) groups[cur] = { marketValue: 0, costValue: 0, profit: 0 };
    groups[cur].marketValue += p.marketValue || 0;
    groups[cur].costValue += p.costValue || 0;
    groups[cur].profit += p.profit || 0;
  });
  return groups;
}

function formatMultiCurrency(groups, field, digits = 0) {
  const parts = [];
  for (const cur of Object.keys(groups).sort()) {
    const val = groups[cur][field];
    const sym = currencySymbol(cur);
    const sign = val >= 0 && field === 'profit' ? '+' : '';
    parts.push(`${sign}${sym}${fmt(val, digits)}`);
  }
  return parts.join(' / ');
}

function buildHeader(data) {
  const { tradeDate, summary, positions } = data;
  const pColor = summary.totalProfitPercent >= 0 ? COLOR.up : COLOR.down;
  const pSign = summary.totalProfitPercent >= 0 ? '+' : '';
  const groups = groupByCurrency(positions);
  const mvStr = formatMultiCurrency(groups, 'marketValue', 0);
  const pnlStr = formatMultiCurrency(groups, 'profit', 0);
  return `
  <div style="background:${COLOR.card};border-radius:14px;padding:28px 24px;margin-bottom:10px;">
    <div style="font-size:24px;font-weight:600;letter-spacing:-0.5px;color:${COLOR.text};">Portfolio Brief</div>
    <div style="font-size:13px;color:${COLOR.sub};margin-top:4px;">${dateStr(tradeDate)} \u00B7 Close Summary</div>
    <div style="margin-top:20px;display:flex;gap:32px;">
      <div>
        <div style="font-size:11px;color:${COLOR.sub};text-transform:uppercase;letter-spacing:0.5px;">Market Value</div>
        <div style="font-size:20px;font-weight:600;color:${COLOR.text};margin-top:2px;">${mvStr}</div>
      </div>
      <div>
        <div style="font-size:11px;color:${COLOR.sub};text-transform:uppercase;letter-spacing:0.5px;">Total P&amp;L</div>
        <div style="font-size:20px;font-weight:600;color:${pColor};margin-top:2px;">${pSign}${fmt(summary.totalProfitPercent)}%</div>
        <div style="font-size:14px;font-weight:500;color:${pColor};margin-top:1px;" class="pnl-amt">${pnlStr}</div>
      </div>
    </div>
    <div style="margin-top:14px;">
      <label for="pnl-toggle" style="display:inline-block;font-size:12px;color:${COLOR.blue};cursor:pointer;user-select:none;">\u25B8 显示盈亏金额</label>
    </div>
  </div>`;
}

function buildMarketMap(positions) {
  const sorted = [...positions].sort((a, b) => b.changePercent - a.changePercent);
  const blocks = sorted.map((p) => {
    const color = changeColor(p.changePercent);
    const bg = changeBg(p.changePercent);
    const sign = p.changePercent > 0 ? '+' : '';
    return `<div style="background:${bg};border-radius:8px;padding:10px 8px;text-align:center;flex:1 1 0;min-width:80px;">
      <div style="font-size:13px;font-weight:600;color:${COLOR.text};">${p.code}</div>
      <div style="font-size:13px;font-weight:600;color:${color};margin-top:2px;">${sign}${fmt(p.changePercent)}%</div>
    </div>`;
  }).join('');
  return `
  <div style="background:${COLOR.card};border-radius:14px;padding:20px 24px;margin-bottom:10px;">
    <div style="font-size:11px;color:${COLOR.sub};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">Market Map</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;">${blocks}</div>
  </div>`;
}

function buildPositionRow(p, isLast) {
  const color = changeColor(p.changePercent);
  const width = barWidth(p.changePercent);
  const sign = p.changePercent > 0 ? '+' : '';
  const sym = currencySymbol(p.currency);
  const pColor = p.profit >= 0 ? COLOR.up : COLOR.down;
  const pSign = p.profit >= 0 ? '+' : '';
  const border = isLast ? '' : `border-bottom:1px solid ${COLOR.border};`;
  return `
  <div style="display:flex;align-items:center;padding:14px 0;${border}">
    <div style="flex:1;">
      <div style="font-size:15px;font-weight:600;color:${COLOR.text};">${p.code}</div>
      <div style="font-size:12px;color:${COLOR.sub};margin-top:1px;">${fmt(p.holdShares, 0)} shares \u00B7 ${sym}${fmt(p.close)}</div>
    </div>
    <div style="width:100px;margin:0 12px;">
      <div style="background:${COLOR.bg};border-radius:3px;height:5px;overflow:hidden;">
        <div style="background:${color};height:100%;width:${width}%;border-radius:3px;"></div>
      </div>
    </div>
    <div style="width:100px;text-align:right;">
      <div style="font-size:15px;font-weight:600;color:${color};">${sign}${fmt(p.changePercent)}%</div>
      <div style="font-size:12px;color:${pColor};margin-top:1px;"><span class="pnl-amt">${pSign}${sym}${fmt(p.profit, 0)} </span>(${pSign}${fmt(p.profitPercent)}%)</div>
    </div>
  </div>`;
}

function buildComment(data) {
  const { positions, summary } = data;
  if (!positions.length) return 'No positions today.';
  const sorted = [...positions].sort((a, b) => b.changePercent - a.changePercent);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  const parts = [];
  parts.push(`${positions.length} positions`);
  parts.push(`${summary.upCount} up / ${summary.downCount} down`);
  if (top.changePercent > 0) parts.push(`top ${top.code} ${fmt(top.changePercent)}%`);
  if (bottom.changePercent < 0) parts.push(`low ${bottom.code} ${fmt(bottom.changePercent)}%`);
  return parts.join(' \u00B7 ');
}

function buildFallbackHtml(data) {
  const positions = data.positions || [];
  const header = buildHeader(data);
  const marketMap = buildMarketMap(positions);
  const rows = positions.map((p, i) => buildPositionRow(p, i === positions.length - 1)).join('');
  const comment = buildComment(data);
  return `
<style>
  .pnl-amt { display: none; }
  #pnl-toggle:checked ~ .pnl-wrap .pnl-amt { display: inline; }
</style>
<input type="checkbox" id="pnl-toggle" style="display:none;">
<div class="pnl-wrap" style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;background:${COLOR.bg};color:${COLOR.text};">
  ${header}
  ${marketMap}
  <div style="background:${COLOR.card};border-radius:14px;padding:8px 24px;margin-bottom:10px;">
    <div style="font-size:11px;color:${COLOR.sub};text-transform:uppercase;letter-spacing:0.5px;padding:8px 0 4px;">Positions</div>
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
