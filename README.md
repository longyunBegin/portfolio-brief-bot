# portfolio-brief-bot

持仓股收盘涨跌定时邮件通知机器人。工作日 10:00 通过邮件推送持仓股票前一交易日的收盘涨跌情况，邮件为结构清晰的 HTML（板块涨跌图示风格），由 GLM 大模型生成。

> 零依赖：全部基于 Node.js 内置模块（https/tls/net），无需 `npm install` 即可运行。

## 功能

- 工作日 10:00 自动发送邮件（腾讯云 SCF Timer 触发）
- 内容：持仓股票收盘涨跌幅、收盘价、盈亏，附盘后点评
- HTML 邮件，板块涨跌条形图示，涨红跌绿（A 股习惯）
- 通知哪些股票可配置（券商 API 拉取 / `config/stocks.json` 兜底）
- GLM-4-Flash 生成 HTML 报告，失败时自动回退本地模板

## 目录结构

```
src/
  index.js              # SCF 入口 + 本地运行入口
  handler.js            # 主流程编排
  config.js             # 配置加载
  services/
    brokerService.js    # 券商/持仓数据（mock 占位，待对接真实 API）
    glmService.js       # GLM 大模型，生成 HTML 报告
    mailService.js      # SMTP 邮件发送
  utils/
    tradeDateUtil.js    # 交易日/工作日判断
    htmlTemplate.js     # 本地 HTML 兜底模板
    httpClient.js       # 基于 https 的 HTTP 客户端（替代 axios）
    smtpClient.js       # 基于 tls/net 的 SMTP 客户端（替代 nodemailer）
    envLoader.js        # 极简 .env 解析（替代 dotenv）
config/
  stocks.json           # 股票白/黑名单配置
scf/
  template.yaml         # 腾讯云 SCF 部署模板
```

## 快速开始（本地）

```bash
cp .env.example .env
# 编辑 .env，填写 SMTP 与 GLM 配置
node src/index.js --dry --force   # 生成预览 preview.html，不发送邮件
node src/index.js --force         # 强制发送一次（忽略交易日判断）
```

## 配置说明（.env）

| 变量 | 说明 |
| --- | --- |
| GLM_API_KEY / GLM_MODEL / GLM_BASE_URL | GLM 大模型配置 |
| SMTP_HOST / SMTP_PORT / SMTP_SECURE | SMTP 服务器 |
| SMTP_USER / SMTP_PASS | SMTP 账号与授权码 |
| MAIL_FROM / MAIL_TO | 发件人与收件人 |
| BROKER_API_BASE / BROKER_API_TOKEN | 券商/交易账户 API |
| BROKER_USE_MOCK | true 时使用 mock 数据 |
| TRADE_DAY_ONLY | 是否仅交易日发送 |
| NOTIFY_HOUR / NOTIFY_MINUTE | 发送时刻 |

## 券商 API 对接

当前 `brokerService.js` 使用 mock 数据。待提供真实 API 文档后，修改 `fetchPositionsFromBroker` 即可。预期返回字段：

```json
[{ "code": "600519", "name": "贵州茅台", "holdShares": 100, "costPrice": 1700, "prevClose": 1685.5, "close": 1702.3 }]
```

## 腾讯云 SCF 部署

1. 在 SCF 控制台配置环境变量（敏感变量不入模板）
2. `cd scf && sls deploy`
3. Timer 触发器 cron：`0 0 10 * * 1-5 *`（周一至周五 10:00），代码内再判断交易日

## 后续扩展

- 盈亏比、持仓占比图示
- 多账户支持
- 节假日日历自动同步