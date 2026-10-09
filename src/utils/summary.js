// Portfolio summary. Amounts are NEVER added across currencies (no FX conversion):
// totals and P&L % are reported per currency.

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function round2(v) {
  return Number(v.toFixed(2));
}

function summarize(positions) {
  const byCurrency = {};
  for (const p of positions) {
    const cur = p.currency || 'USD';
    if (!byCurrency[cur]) byCurrency[cur] = { marketValue: 0, costValue: 0, profit: 0, count: 0, usesMark: false };
    const g = byCurrency[cur];
    g.count += 1;
    if (isNum(p.marketValue)) g.marketValue += p.marketValue;
    if (isNum(p.costValue)) g.costValue += p.costValue;
    if (isNum(p.profit)) g.profit += p.profit;
    if (p.valuationSource === 'mark') g.usesMark = true;
  }
  for (const cur of Object.keys(byCurrency)) {
    const g = byCurrency[cur];
    g.marketValue = round2(g.marketValue);
    g.costValue = round2(g.costValue);
    g.profit = round2(g.profit);
    g.profitPercent = g.costValue ? round2((g.profit / g.costValue) * 100) : null;
  }
  const hasChange = (p) => isNum(p.changePercent);
  return {
    byCurrency,
    currencies: Object.keys(byCurrency).sort(),
    upCount: positions.filter((p) => hasChange(p) && p.changePercent > 0).length,
    downCount: positions.filter((p) => hasChange(p) && p.changePercent < 0).length,
    flatCount: positions.filter((p) => hasChange(p) && p.changePercent === 0).length,
    missingCount: positions.filter((p) => !hasChange(p)).length,
  };
}

module.exports = { summarize, isNum };
