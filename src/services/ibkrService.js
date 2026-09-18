
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const config = require('../config');
const { getPreviousTradeDate, toDateStr } = require('../utils/tradeDateUtil');
const { cosGet, cosPut } = require('../utils/cosClient');

const MCP_URL = 'https://api.ibkr.com/v1/api/mcp-public';
const TOKEN_ENDPOINT = 'https://api.ibkr.com/oauth2/api/v1/token';
const RT_FILE = path.resolve(process.cwd(), '.ibkr_refresh_token');

function hasCos() {
  return config.cos.enabled && config.cos.secretId && config.cos.secretKey && config.cos.bucket;
}

async function getRefreshToken() {
  if (hasCos()) {
    try {
      const resp = await cosGet({
        secretId: config.cos.secretId,
        secretKey: config.cos.secretKey,
        bucket: config.cos.bucket,
        region: config.cos.region,
        key: config.cos.key,
      });
      if (resp.status === 200 && resp.body.trim()) return resp.body.trim();
    } catch (e) {
      console.warn('[ibkr] COS 读取 refresh_token 失败:', e.message);
    }
  }
  if (fs.existsSync(RT_FILE)) {
    const rt = fs.readFileSync(RT_FILE, 'utf-8').trim();
    if (rt) return rt;
  }
  return config.ibkr.refreshToken;
}

async function saveRefreshToken(rt) {
  if (!rt) return;
  if (hasCos()) {
    try {
      await cosPut({
        secretId: config.cos.secretId,
        secretKey: config.cos.secretKey,
        bucket: config.cos.bucket,
        region: config.cos.region,
        key: config.cos.key,
        content: rt,
      });
    } catch (e) {
      console.warn('[ibkr] COS 写入 refresh_token 失败:', e.message);
    }
  }
  fs.writeFileSync(RT_FILE, rt, 'utf-8');
}

async function httpsRequest(method, url, { headers = {}, body = null } = {}) {
  const opts = { method, headers: Object.assign({}, headers) };
  if (body != null) opts.body = String(body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  opts.signal = controller.signal;
  try {
    const resp = await fetch(url, opts);
    const text = await resp.text();
    return { status: resp.status, headers: Object.fromEntries(resp.headers.entries()), body: text };
  } finally {
    clearTimeout(timer);
  }
}

async function exchangeToken() {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) throw new Error('缺少 IBKR_REFRESH_TOKEN 配置');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'mcp.read mcp.write',
    resource: MCP_URL,
  });
  if (config.ibkr.clientId) body.set('client_id', config.ibkr.clientId);
  const resp = await httpsRequest('POST', TOKEN_ENDPOINT, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'User-Agent': 'mcp-remote/0.14.2 node',
    },
    body: body.toString(),
  });
  if (resp.status !== 200) throw new Error('IBKR token 刷新失败: ' + resp.status + ' ' + resp.body.slice(0, 200));
  const tokens = JSON.parse(resp.body);
  if (!tokens.access_token) throw new Error('IBKR token 刷新响应无 access_token');
  if (tokens.refresh_token) await saveRefreshToken(tokens.refresh_token);
  return tokens.access_token;
}

function parseMcpResult(body) {
  const lines = body.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('data:')) {
      try { return JSON.parse(t.slice(5).trim()); } catch (_) {}
    }
    if (t.startsWith('{')) {
      try { return JSON.parse(t); } catch (_) {}
    }
  }
  return null;
}

function extractToolText(result) {
  if (!result || !result.result || !result.result.content) return null;
  const text = result.result.content.find((c) => c.type === 'text');
  if (!text) return null;
  try { return JSON.parse(text.text); } catch (_) { return text.text; }
}

let _cachedAccessToken = null;

async function getAccessToken() {
  if (_cachedAccessToken) return _cachedAccessToken;
  _cachedAccessToken = await exchangeToken();
  return _cachedAccessToken;
}

async function callMcpTool(name, args = {}) {
  const accessToken = await getAccessToken();
  const resp = await httpsRequest('POST', MCP_URL, {
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: args }, id: 1 }),
  });
  if (resp.status === 401) {
    _cachedAccessToken = null;
    throw new Error('IBKR access_token 无效');
  }
  const result = parseMcpResult(resp.body);
  if (result && result.error) throw new Error('IBKR MCP 错误: ' + JSON.stringify(result.error));
  return extractToolText(result);
}

async function getPositions() {
  const data = await callMcpTool('get_account_positions', {});
  return (data && data.positions) || [];
}

async function getPriceChange(contractId) {
  const data = await callMcpTool('get_price_snapshot', {
    contract_id: contractId,
    market_data_names: ['last', 'change', 'prior_close'],
  });
  return data;
}

function normalizePriceHistory(data) {
  if (!data) return [];
  if (Array.isArray(data.time) && Array.isArray(data.close)) {
    return data.time.map((t, i) => ({
      time: new Date(t).getTime() / 1000,
      open: Number(data.open ? data.open[i] : 0),
      high: Number(data.high ? data.high[i] : 0),
      low: Number(data.low ? data.low[i] : 0),
      close: Number(data.close[i]),
      volume: Number(data.volume ? data.volume[i] : 0),
    })).filter((b) => b.close > 0);
  }
  const bars = data.data || data.bars || data.history || (Array.isArray(data) ? data : []);
  return bars.map((b) => ({
    time: b.t || b.time || b.timestamp || 0,
    open: Number(b.o || b.open || 0),
    high: Number(b.h || b.high || 0),
    low: Number(b.l || b.low || 0),
    close: Number(b.c || b.close || 0),
    volume: Number(b.v || b.volume || 0),
  })).filter((b) => b.close > 0);
}

async function getPriceHistory(contractId) {
  const data = await callMcpTool('get_price_history', {
    contract_id: contractId,
    security_type: 'STK',
    period: 'ONE_DAY',
    step: 'FIVE_MINS',
    outside_rth: false,
  });
  return normalizePriceHistory(data);
}

async function getDailyHistory(contractId) {
  const data = await callMcpTool('get_price_history', {
    contract_id: contractId,
    security_type: 'STK',
    period: 'THREE_DAYS',
    step: 'ONE_DAY',
    outside_rth: false,
  });
  return normalizePriceHistory(data);
}

function barToDateStr(time) {
  let date;
  if (typeof time === 'string') {
    date = new Date(time);
  } else if (time > 1e12) {
    date = new Date(time);
  } else if (time > 1e9) {
    date = new Date(time * 1000);
  } else {
    return null;
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year').value;
    const m = parts.find((p) => p.type === 'month').value;
    const d = parts.find((p) => p.type === 'day').value;
    return `${y}-${m}-${d}`;
  } catch (_) {
    return null;
  }
}

function toPositionRow(p, dailyBars, tradeDateStr) {
  const code = p.contract_description || String(p.contract_id);
  const holdShares = Number(p.position) || 0;
  const costPrice = Number(p.average_price) || 0;
  let close = 0;
  let prevClose = 0;
  if (dailyBars && dailyBars.length >= 1) {
    let targetIdx = dailyBars.length - 1;
    if (tradeDateStr) {
      for (let i = dailyBars.length - 1; i >= 0; i--) {
        if (barToDateStr(dailyBars[i].time) === tradeDateStr) {
          targetIdx = i;
          break;
        }
      }
      const matched = barToDateStr(dailyBars[targetIdx].time);
      if (matched && matched !== tradeDateStr) {
        console.warn(`[ibkr] ${code} 日K线日期 ${matched} 与期望交易日 ${tradeDateStr} 不匹配，使用最近一根`);
      }
    }
    close = dailyBars[targetIdx].close;
    if (targetIdx > 0) {
      prevClose = dailyBars[targetIdx - 1].close;
    }
  }
  if (!close) close = Number(p.market_price) || 0;
  let changeAmount = 0;
  let changePercent = 0;
  if (prevClose) {
    changeAmount = close - prevClose;
    changePercent = (changeAmount / prevClose) * 100;
  }
  const marketValue = close * holdShares;
  const costValue = costPrice * holdShares;
  const profit = marketValue - costValue;
  const profitPercent = costValue ? (profit / costValue) * 100 : 0;
  return {
    code,
    name: code,
    holdShares,
    costPrice,
    prevClose,
    close,
    changeAmount: Number(changeAmount.toFixed(4)),
    changePercent: Number(changePercent.toFixed(2)),
    marketValue: Number(marketValue.toFixed(2)),
    costValue: Number(costValue.toFixed(2)),
    profit: Number(profit.toFixed(2)),
    profitPercent: Number(profitPercent.toFixed(2)),
    currency: p.currency || 'USD',
    contractId: p.contract_id,
  };
}

function summarize(positions) {
  const totalMarketValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const totalCostValue = positions.reduce((s, p) => s + p.costValue, 0);
  const totalProfit = positions.reduce((s, p) => s + p.profit, 0);
  const totalProfitPercent = totalCostValue ? (totalProfit / totalCostValue) * 100 : 0;
  return {
    totalMarketValue: Number(totalMarketValue.toFixed(2)),
    totalCostValue: Number(totalCostValue.toFixed(2)),
    totalProfit: Number(totalProfit.toFixed(2)),
    totalProfitPercent: Number(totalProfitPercent.toFixed(2)),
    upCount: positions.filter((p) => p.changePercent > 0).length,
    downCount: positions.filter((p) => p.changePercent < 0).length,
    flatCount: positions.filter((p) => p.changePercent === 0).length,
  };
}

async function getPositionsAndQuote(referenceDate) {
  const tradeDate = getPreviousTradeDate(referenceDate || new Date());
  const tradeDateStr = toDateStr(tradeDate);
  console.log('[ibkr] 刷新 token 并获取持仓... 期望交易日:', tradeDateStr);
  const rawPositions = await getPositions();
  console.log(`[ibkr] 获取到 ${rawPositions.length} 个持仓，并行获取日K线与走势...`);
  const tasks = rawPositions.map(async (p) => {
    const [dailyBars, history] = await Promise.all([
      getDailyHistory(p.contract_id).catch((e) => {
        console.warn(`[ibkr] ${p.contract_description} 日K线获取失败: ${e.message}`);
        return [];
      }),
      getPriceHistory(p.contract_id).catch((e) => {
        console.warn(`[ibkr] ${p.contract_description} 走势获取失败: ${e.message}`);
        return [];
      }),
    ]);
    const row = toPositionRow(p, dailyBars, tradeDateStr);
    row.intraday = history;
    return row;
  });
  const rows = await Promise.all(tasks);
  const summary = summarize(rows);
  return { tradeDate, positions: rows, summary };
}

module.exports = {
  getPositionsAndQuote,
  getPositions,
  getPriceChange,
  getPriceHistory,
  getDailyHistory,
  callMcpTool,
  toPositionRow,
  summarize,
};
