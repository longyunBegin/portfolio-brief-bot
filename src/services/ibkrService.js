const https = require('https');
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
  return config.cos.secretId && config.cos.secretKey && config.cos.bucket;
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

function httpsRequest(method, url, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body == null ? null : Buffer.from(String(body));
    const h = Object.assign({ 'Connection': 'close' }, headers);
    if (data) h['Content-Length'] = data.length;
    const req = https.request({
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: h,
    }, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c.toString());
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('IBKR 请求超时')));
    if (data) req.write(data);
    req.end();
  });
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

function toPositionRow(p, quote) {
  const code = p.contract_description || String(p.contract_id);
  const holdShares = Number(p.position) || 0;
  const costPrice = Number(p.average_price) || 0;
  const lastPrice = quote && quote['last'] ? Number(quote['last'].price) : 0;
  const close = Number(p.market_price) || lastPrice || 0;
  const prevClose = quote && quote['prior-close'] && quote['prior-close'].price ? Number(quote['prior-close'].price) : 0;
  let changePercent = 0;
  let changeAmount = 0;
  if (quote && quote['change']) {
    const ch = quote['change'];
    if (ch['change_pct'] != null) changePercent = Number(ch['change_pct']);
    if (ch['change'] != null) changeAmount = Number(ch['change']);
  }
  if (!changePercent && prevClose) changePercent = ((close - prevClose) / prevClose) * 100;
  if (!changeAmount && prevClose) changeAmount = close - prevClose;
  const marketValue = Number(p.market_value) || close * holdShares;
  const costValue = costPrice * holdShares;
  const profit = Number(p.unrealized_pnl) || marketValue - costValue;
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
  console.log('[ibkr] 刷新 token 并获取持仓...');
  const rawPositions = await getPositions();
  console.log(`[ibkr] 获取到 ${rawPositions.length} 个持仓，开始获取行情...`);
  const rows = [];
  for (const p of rawPositions) {
    let quote = null;
    try {
      quote = await getPriceChange(p.contract_id);
    } catch (e) {
      console.warn(`[ibkr] ${p.contract_description} 行情获取失败: ${e.message}`);
    }
    rows.push(toPositionRow(p, quote));
  }
  const summary = summarize(rows);
  return { tradeDate, positions: rows, summary };
}

module.exports = {
  getPositionsAndQuote,
  getPositions,
  getPriceChange,
  callMcpTool,
};
