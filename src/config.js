const path = require('path');
const fs = require('fs');
const { loadDotenv } = require('./utils/envLoader');

loadDotenv(process.cwd());

function getEnv(key, defaultValue) {
  const v = process.env[key];
  if (v === undefined || v === '') return defaultValue;
  return v;
}

function getEnvRequired(key) {
  const v = process.env[key];
  if (v === undefined || v === '') {
    throw new Error(`缺少必填环境变量: ${key}`);
  }
  return v;
}

function getBool(key, defaultValue) {
  const v = process.env[key];
  if (v === undefined || v === '') return defaultValue;
  return v === 'true' || v === '1' || v === 'yes';
}

function getInt(key, defaultValue) {
  const v = process.env[key];
  if (v === undefined || v === '') return defaultValue;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? defaultValue : n;
}

function loadStocksConfig() {
  const cfgPath = path.resolve(process.cwd(), 'config', 'stocks.json');
  if (!fs.existsSync(cfgPath)) return { watch: [], blacklist: [] };
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  } catch (e) {
    console.warn('[config] stocks.json 解析失败，忽略:', e.message);
    return { watch: [], blacklist: [] };
  }
}

const config = {

  smtp: {
    host: getEnv('SMTP_HOST', ''),
    port: getInt('SMTP_PORT', 465),
    secure: getBool('SMTP_SECURE', true),
    user: getEnv('SMTP_USER', ''),
    pass: getEnv('SMTP_PASS', ''),
    from: getEnv('MAIL_FROM', ''),
    to: getEnv('MAIL_TO', ''),
  },
  broker: {
    apiBase: getEnv('BROKER_API_BASE', ''),
    apiToken: getEnv('BROKER_API_TOKEN', ''),
    useMock: getBool('BROKER_USE_MOCK', true),
  },
  ibkr: {
    refreshToken: getEnv('IBKR_REFRESH_TOKEN', ''),
    clientId: getEnv('IBKR_CLIENT_ID', ''),
  },
  cos: {
    enabled: getBool('COS_ENABLED', false),
    secretId: getEnv('COS_SECRET_ID', ''),
    secretKey: getEnv('COS_SECRET_KEY', ''),
    bucket: getEnv('COS_BUCKET', ''),
    region: getEnv('COS_REGION', 'ap-guangzhou'),
    key: getEnv('COS_KEY', 'ibkr_refresh_token'),
  },
  notify: {
    tradeDayOnly: getBool('TRADE_DAY_ONLY', true),
    hour: getInt('NOTIFY_HOUR', 10),
    minute: getInt('NOTIFY_MINUTE', 0),
  },
  stocks: loadStocksConfig(),
};

config.validate = function validate(options) {
  const requireSmtp = !(options && options.skipSmtp);
  const errors = [];

  if (requireSmtp) {
    if (!config.smtp.host) errors.push('SMTP_HOST');
    if (!config.smtp.user) errors.push('SMTP_USER');
    if (!config.smtp.pass) errors.push('SMTP_PASS');
    if (!config.smtp.from) errors.push('MAIL_FROM');
    if (!config.smtp.to) errors.push('MAIL_TO');
  }
  if (errors.length) {
    throw new Error('配置校验失败，缺少: ' + errors.join(', '));
  }
};

module.exports = config;