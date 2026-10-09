
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getPreviousTradeDate, toDateStr, previousUsTradeDateStr } = require('../utils/tradeDateUtil');
const { summarize } = require('../utils/summary');
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

// ---------------------------------------------------------------------------
// Throttle: IBKR MCP allows 10 requests/second and 30 requests/minute.
// We stay well below: max 2 in flight, >=250ms between request starts,
// and at most MINUTE_BUDGET starts in any rolling 60s window (queue waits).
// ---------------------------------------------------------------------------
const MAX_CONCURRENT = 2;
const MIN_SPACING_MS = 250;
const MINUTE_BUDGET = 28;
const RATE_LIMIT_CODE = -32300;
// Backoff on rate limit. The per-minute limit is enforced server-side across processes, so the
// last steps are long enough to let a full 60s window roll over.
const RETRY_DELAYS_MS = [1000, 2000, 4000, 15000, 30000, 60000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const _queue = [];
let _inFlight = 0;
let _lastStart = 0;
const _startTimes = [];
let _pumpTimer = null;
let _cooldownUntil = 0; // global pause after a rate-limit response, so queued calls don't keep hitting the limit

function _pump() {
  _pumpTimer = null;
  while (_queue.length && _inFlight < MAX_CONCURRENT) {
    const now = Date.now();
    while (_startTimes.length && now - _startTimes[0] >= 60000) _startTimes.shift();
    let waitMs = Math.max(0, _cooldownUntil - now);
    if (_startTimes.length >= MINUTE_BUDGET) waitMs = Math.max(waitMs, 60000 - (now - _startTimes[0]) + 50);
    if (now - _lastStart < MIN_SPACING_MS) waitMs = Math.max(waitMs, MIN_SPACING_MS - (now - _lastStart));
    if (waitMs > 0) {
      if (waitMs > 1000) console.log(`[ibkr] 达到每分钟请求预算，排队等待 ${Math.ceil(waitMs / 1000)}s`);
      _pumpTimer = setTimeout(_pump, waitMs);
      return;
    }
    const job = _queue.shift();
    _inFlight++;
    _lastStart = now;
    _startTimes.push(now);
    job.fn().then(job.resolve, job.reject).finally(() => {
      _inFlight--;
      if (!_pumpTimer) _pump();
    });
  }
}

function throttled(fn) {
  return new Promise((resolve, reject) => {
    _queue.push({ fn, resolve, reject });
    if (!_pumpTimer) _pump();
  });
}

class McpToolError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.isRateLimit = code === RATE_LIMIT_CODE || /rate limit/i.test(message || '');
  }
}

let _cachedAccessToken = null;
let _tokenPromise = null;

async function getAccessToken() {
  if (_cachedAccessToken) return _cachedAccessToken;
  // Single in-flight refresh: the refresh token rotates on use, so never refresh twice concurrently.
  if (!_tokenPromise) {
    _tokenPromise = exchangeToken().then((t) => { _cachedAccessToken = t; return t; }).finally(() => { _tokenPromise = null; });
  }
  return _tokenPromise;
}

async function callMcpToolOnce(name, args) {
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
  if (resp.status === 429) throw new McpToolError('HTTP 429 Too Many Requests', RATE_LIMIT_CODE);
  if (resp.status !== 200) throw new Error(`IBKR MCP HTTP ${resp.status}: ${resp.body.slice(0, 200)}`);
  const result = parseMcpResult(resp.body);
  if (!result) throw new Error('IBKR MCP 响应无法解析');
  if (result.error) {
    throw new McpToolError('IBKR MCP 错误: ' + JSON.stringify(result.error), result.error.code);
  }
  const payload = extractToolText(result);
  // Tool-level errors come back as HTTP 200 with result.isError=true and a JSON text body
  // like {"code":-32300,"message":"Rate limit reached ..."}. Never treat them as data.
  if (result.result && result.result.isError) {
    const code = payload && typeof payload === 'object' ? payload.code : undefined;
    const msg = payload && typeof payload === 'object' ? payload.message : String(payload);
    throw new McpToolError(`IBKR MCP 工具错误 ${name}: ${msg}`, code);
  }
  return payload;
}

async function callMcpTool(name, args = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await throttled(() => callMcpToolOnce(name, args));
    } catch (e) {
      if (e instanceof McpToolError && e.isRateLimit && attempt < RETRY_DELAYS_MS.length) {
        const wait = RETRY_DELAYS_MS[attempt];
        _cooldownUntil = Math.max(_cooldownUntil, Date.now() + wait);
        console.warn(`[ibkr] ${name} 触发限流，${wait}ms 后重试 (${attempt + 1}/${RETRY_DELAYS_MS.length})`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

async function getPositions() {
  const data = await callMcpTool('get_account_positions', {});
  if (!data || !Array.isArray(data.positions)) throw new Error('IBKR 持仓响应格式异常');
  return data.positions;
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
    })).filter((b) => b.close > 0).sort((a, b) => a.time - b.time);
  }
  const bars = data.data || data.bars || data.history || (Array.isArray(data) ? data : []);
  return bars.map((b) => ({
    time: b.t || b.time || b.timestamp || 0,
    open: Number(b.o || b.open || 0),
    high: Number(b.h || b.high || 0),
    low: Number(b.l || b.low || 0),
    close: Number(b.c || b.close || 0),
    volume: Number(b.v || b.volume || 0),
  })).filter((b) => b.close > 0).sort((a, b) => a.time - b.time);
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

// TWO_WEEKS: shorter windows (THREE_DAYS / step_count) were observed to return only 2 bars
// or to silently skip days; TWO_WEEKS returned a gap-free list in testing.
async function getDailyHistory(contractId) {
  const data = await callMcpTool('get_price_history', {
    contract_id: contractId,
    security_type: 'STK',
    period: 'TWO_WEEKS',
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

function round(v, digits) {
  return v == null ? null : Number(v.toFixed(digits));
}

// US-listed heuristic: IBKR positions do not carry the listing exchange; USD stocks here are US listings.
function isUsListed(p) {
  return (p.currency || 'USD') === 'USD';
}

function toPositionRow(p, dailyBars, tradeDateStr, opts = {}) {
  const code = p.contract_description || String(p.contract_id);
  const holdShares = Number(p.position) || 0;
  const costPrice = Number(p.average_price) || 0;
  const missing = [];
  let close = null;
  let prevClose = null;
  let closeDate = null;
  let prevDate = null;

  if (opts.dailyError) {
    missing.push('daily bars');
  } else {
    const bars = dailyBars || [];
    const targetIdx = bars.findIndex((b) => barToDateStr(b.time) === tradeDateStr);
    if (targetIdx < 0) {
      const dates = bars.map((b) => barToDateStr(b.time)).join(',');
      console.warn(`[ibkr] ${code} 日K线中没有交易日 ${tradeDateStr} 的数据 (有: ${dates || '无'})，收盘价标记缺失`);
      missing.push('close');
    } else {
      close = bars[targetIdx].close;
      closeDate = tradeDateStr;
      if (targetIdx === 0) {
        console.warn(`[ibkr] ${code} 日K线中没有 ${tradeDateStr} 之前的K线，昨收标记缺失`);
        missing.push('prev close');
      } else {
        const prevBarDate = barToDateStr(bars[targetIdx - 1].time);
        if (isUsListed(p)) {
          const expected = previousUsTradeDateStr(tradeDateStr);
          if (prevBarDate === expected) {
            prevClose = bars[targetIdx - 1].close;
            prevDate = prevBarDate;
          } else {
            console.warn(`[ibkr] ${code} 前一根K线是 ${prevBarDate}，应为 ${expected}，昨收标记缺失`);
            missing.push('prev close');
          }
        } else {
          prevClose = bars[targetIdx - 1].close;
          prevDate = prevBarDate;
          console.log(`[ibkr] ${code} (${p.currency}) 非美股，昨收取前一根K线 ${prevBarDate}`);
        }
      }
    }
  }

  let changeAmount = null;
  let changePercent = null;
  if (close != null && prevClose) {
    changeAmount = close - prevClose;
    changePercent = (changeAmount / prevClose) * 100;
  }

  // Market value: trade-date close when available; otherwise IBKR's live mark price (labelled).
  let valuationSource = 'close';
  let valuationPrice = close;
  if (valuationPrice == null) {
    const mark = Number(p.market_price);
    if (mark > 0) {
      valuationSource = 'mark';
      valuationPrice = mark;
    } else {
      valuationSource = 'none';
    }
  }
  const marketValue = valuationPrice != null ? valuationPrice * holdShares : null;
  const costValue = costPrice * holdShares;
  const profit = marketValue != null ? marketValue - costValue : null;
  const profitPercent = profit != null && costValue ? (profit / costValue) * 100 : null;

  return {
    code,
    name: code,
    holdShares,
    costPrice,
    prevClose,
    prevDate,
    close,
    closeDate,
    changeAmount: round(changeAmount, 4),
    changePercent: round(changePercent, 2),
    valuationSource,
    valuationPrice,
    marketValue: round(marketValue, 2),
    costValue: round(costValue, 2),
    profit: round(profit, 2),
    profitPercent: round(profitPercent, 2),
    currency: p.currency || 'USD',
    contractId: p.contract_id,
    missing,
  };
}

async function getPositionsAndQuote(referenceDate) {
  const tradeDate = getPreviousTradeDate(referenceDate || new Date());
  const tradeDateStr = toDateStr(tradeDate);
  console.log('[ibkr] 刷新 token 并获取持仓... 期望交易日:', tradeDateStr);
  const allPositions = await getPositions();
  const rawPositions = allPositions.filter((p) => Math.abs(Number(p.position) || 0) > 1e-9);
  const dropped = allPositions.length - rawPositions.length;
  console.log(`[ibkr] 获取到 ${allPositions.length} 个持仓${dropped ? `（过滤 ${dropped} 个 0 股）` : ''}，限速获取日K线与走势...`);
  const tasks = rawPositions.map(async (p) => {
    let dailyError = null;
    let chartError = null;
    const [dailyBars, history] = await Promise.all([
      getDailyHistory(p.contract_id).catch((e) => {
        dailyError = e;
        console.warn(`[ibkr] ${p.contract_description} 日K线获取失败: ${e.message}`);
        return [];
      }),
      getPriceHistory(p.contract_id).catch((e) => {
        chartError = e;
        console.warn(`[ibkr] ${p.contract_description} 走势获取失败: ${e.message}`);
        return [];
      }),
    ]);
    const row = toPositionRow(p, dailyBars, tradeDateStr, { dailyError });
    // Only keep intraday bars from the target trade date (avoids showing a later/partial session).
    row.intraday = history.filter((b) => barToDateStr(b.time) === tradeDateStr);
    if (row.intraday.length < 2) {
      if (!chartError) console.warn(`[ibkr] ${row.code} 走势中没有 ${tradeDateStr} 的数据`);
      row.missing.push('chart');
    }
    return row;
  });
  const rows = await Promise.all(tasks);
  const summary = summarize(rows);
  return { tradeDate, positions: rows, summary };
}

module.exports = {
  getPositionsAndQuote,
  getPositions,
  getPriceHistory,
  getDailyHistory,
  callMcpTool,
  toPositionRow,
  summarize,
  barToDateStr,
};
