const { get } = require('../utils/httpClient');
const config = require('../config');
const { getPreviousTradeDate, toDateStr } = require('../utils/tradeDateUtil');

function buildMockPositions(tradeDate) {
  const dateStr = toDateStr(tradeDate);
  const seed = (parseInt(dateStr.replace(/-/g, ''), 10) % 100) / 100;
  const rnd = (base, range) => Number((base + (seed - 0.5) * range).toFixed(2));
  const items = [
    { code: '600519', name: '贵州茅台', holdShares: 100, costPrice: 1700.0, prevClose: 1685.5 },
    { code: '000858', name: '五粮液', holdShares: 300, costPrice: 150.0, prevClose: 148.2 },
    { code: '300750', name: '宁德时代', holdShares: 50, costPrice: 200.0, prevClose: 198.6 },
    { code: '601318', name: '中国平安', holdShares: 500, costPrice: 45.0, prevClose: 44.8 },
    { code: '000001', name: '平安银行', holdShares: 1000, costPrice: 11.0, prevClose: 10.9 },
  ];
  return items.map((it) => {
    const close = rnd(it.prevClose * 1.01, it.prevClose * 0.04);
    const changePercent = Number((((close - it.prevClose) / it.prevClose) * 100).toFixed(2));
    const changeAmount = Number((close - it.prevClose).toFixed(2));
    const marketValue = Number((close * it.holdShares).toFixed(2));
    const costValue = Number((it.costPrice * it.holdShares).toFixed(2));
    const profit = Number((marketValue - costValue).toFixed(2));
    const profitPercent = Number(((profit / costValue) * 100).toFixed(2));
    return {
      code: it.code,
      name: it.name,
      holdShares: it.holdShares,
      costPrice: it.costPrice,
      prevClose: it.prevClose,
      close,
      changeAmount,
      changePercent,
      marketValue,
      costValue,
      profit,
      profitPercent,
      intraday: buildMockIntraday(it.prevClose, close, seed),
    };
  });
}

function buildMockIntraday(prevClose, close, seed) {
  const bars = [];
  const numBars = 78;
  const baseTime = 570;
  for (let i = 0; i < numBars; i++) {
    const progress = i / (numBars - 1);
    const trend = prevClose + (close - prevClose) * progress;
    const wave = Math.sin(progress * Math.PI * 4 + seed * 6) * prevClose * 0.003;
    const noise = (Math.sin(i * 2.7 + seed * 10) + Math.cos(i * 1.3)) * prevClose * 0.0015;
    const price = Number((trend + wave + noise).toFixed(2));
    const high = Number((price + Math.abs(noise) + 0.01).toFixed(2));
    const low = Number((price - Math.abs(noise) - 0.01).toFixed(2));
    bars.push({
      time: (baseTime + i * 5) * 60,
      open: price,
      high,
      low,
      close: price,
      volume: Math.floor(10000 + Math.sin(i * 3.1) * 5000 + 5000),
    });
  }
  return bars;
}

function summarize(positions) {
  const totalMarketValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const totalCostValue = positions.reduce((s, p) => s + p.costValue, 0);
  const totalProfit = Number((totalMarketValue - totalCostValue).toFixed(2));
  const totalProfitPercent = Number(((totalProfit / totalCostValue) * 100).toFixed(2));
  const upCount = positions.filter((p) => p.changePercent > 0).length;
  const downCount = positions.filter((p) => p.changePercent < 0).length;
  const flatCount = positions.filter((p) => p.changePercent === 0).length;
  return {
    totalMarketValue: Number(totalMarketValue.toFixed(2)),
    totalCostValue: Number(totalCostValue.toFixed(2)),
    totalProfit,
    totalProfitPercent,
    upCount,
    downCount,
    flatCount,
  };
}

async function fetchPositionsFromBroker(tradeDate) {
  const base = config.broker.apiBase;
  const token = config.broker.apiToken;
  const dateStr = toDateStr(tradeDate);
  // TODO: 待用户提供真实券商/交易机器人 API 文档后，按文档调整以下请求。
  // 预期返回字段与 mock 保持一致：code/name/holdShares/costPrice/prevClose/close 等。
  const resp = await get(`${base}/api/positions?date=${encodeURIComponent(dateStr)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    timeout: 10000,
  });
  const list = Array.isArray(resp.data) ? resp.data : (resp.data && resp.data.data) || [];
  return list.map((p) => ({
    code: p.code,
    name: p.name,
    holdShares: Number(p.holdShares),
    costPrice: Number(p.costPrice),
    prevClose: Number(p.prevClose),
    close: Number(p.close),
    changeAmount: Number((p.close - p.prevClose).toFixed(2)),
    changePercent: Number((((p.close - p.prevClose) / p.prevClose) * 100).toFixed(2)),
    marketValue: Number((p.close * p.holdShares).toFixed(2)),
    costValue: Number((p.costPrice * p.holdShares).toFixed(2)),
    profit: Number(((p.close - p.costPrice) * p.holdShares).toFixed(2)),
    profitPercent: Number((((p.close - p.costPrice) / p.costPrice) * 100).toFixed(2)),
  }));
}

async function getPositionsAndQuote(referenceDate) {
  if (!config.broker.useMock) {
    const ibkr = require('./ibkrService');
    const result = await ibkr.getPositionsAndQuote(referenceDate);
    const blacklist = new Set((config.stocks.blacklist || []).map((b) => b.code || b));
    result.positions = result.positions.filter((p) => !blacklist.has(p.code));
    return result;
  }

  const tradeDate = getPreviousTradeDate(referenceDate || new Date());
  let positions = buildMockPositions(tradeDate);

  const blacklist = new Set((config.stocks.blacklist || []).map((b) => b.code || b));
  positions = positions.filter((p) => !blacklist.has(p.code));

  const watch = config.stocks.watch || [];
  if (watch.length && positions.length === 0) {
    positions = watch.map((w) => ({
      code: w.code,
      name: w.name,
      holdShares: w.holdShares,
      costPrice: w.costPrice,
      prevClose: w.costPrice,
      close: w.costPrice,
      changeAmount: 0,
      changePercent: 0,
      marketValue: Number((w.costPrice * w.holdShares).toFixed(2)),
      costValue: Number((w.costPrice * w.holdShares).toFixed(2)),
      profit: 0,
      profitPercent: 0,
      intraday: [],
    }));
  }

  const summary = summarize(positions);
  return { tradeDate, positions, summary };
}

module.exports = {
  getPositionsAndQuote,
  summarize,
};