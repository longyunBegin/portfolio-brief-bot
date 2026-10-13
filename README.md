# portfolio-brief-bot

持仓股收盘涨跌定时邮件通知机器人。北京时间每日 10:00 通过邮件推送 IBKR 真实持仓股票上一个美股交易日的收盘涨跌简报，苹果设计风格 HTML 邮件，含每只股票的可展开当日走势折线图。

> 零依赖：全部基于 Node.js 内置模块（https/tls/net/crypto/fs/path），无需 `npm install` 即可运行。

## 功能

- 北京时间每日 10:00 自动发送邮件（腾讯云 SCF Timer 触发）
- 数据源：IBKR（Interactive Brokers）真实持仓 + 日K线 + 5分钟走势
- 苹果设计风格 HTML 邮件：SF Pro 字体、白色卡片、圆角、涨绿跌红（美股习惯）
- 板块涨跌概览图 + 持仓明细列表 + 每只股票可展开走势折线图
- 走势图含最高/最低/中轴三条参考线及价格标注
- 一键展开/收起全部走势图
- 盈亏金额及成本默认隐藏，点击切换显隐
- 原始币种显示（EUR 用 €，USD 用 $），总市值与总盈亏按币种分组
- 美股交易日历判断（含 2024-2027 节假日），非交易日跳过
- IBKR refresh token rotation 持久化（本地文件或腾讯云 COS）

## 效果图

Mock 数据生成的预览（苹果设计风格 HTML 邮件）：

> 本地运行 `BROKER_USE_MOCK=true node gen_mock_preview.js` 生成，打开 [docs/preview_mock.html](docs/preview_mock.html) 查看。

包含：
- 顶部概览卡片（总市值、总盈亏百分比、显隐切换）
- 板块涨跌色块图
- 持仓明细列表（股票代码、持仓量、收盘价、涨跌幅、盈亏）
- 每只股票可展开的当日走势 SVG 折线图（最高/最低/中轴线 + 价格标注）
- 一键展开/收起全部走势
- 底部摘要说明

## 目录结构

```
src/
  index.js              # SCF 入口 + 本地运行入口（--dry --force）
  handler.js            # 主流程编排（交易日判断→持仓→模板→邮件）
  config.js             # 配置加载
  services/
    brokerService.js    # 持仓服务（useMock ? mock : ibkrService）
    ibkrService.js      # IBKR MCP 调用（token rotation + 持仓 + 日K线 + 走势）
    mailService.js      # 邮件发送（SMTP；CID 内联附件）
  utils/
    tradeDateUtil.js    # 美股交易日/工作日判断（含2024-2027节假日）
    summary.js          # 按币种汇总 + 涨跌/持平/缺失计数
    htmlTemplate.js     # 苹果风格 HTML 模板（CID/data-URI 走势图 + Gmail 表格布局）
    pngChart.js         # 零依赖 PNG 编码器（Buffer + base64）
    httpClient.js       # HTTP 客户端
    smtpClient.js       # SMTP 客户端（multipart/related CID 内联图）
    cosClient.js        # 腾讯云 COS 客户端（零依赖，SHA1 签名）
    envLoader.js        # 极简 .env 解析
config/
  stocks.json           # 股票白/黑名单配置
scf/
  template.yaml         # 腾讯云 SCF 部署模板
docs/
  preview_mock.html     # Mock 数据效果图
tools/
  send-via-gmail-api.js # Gmail API 直发 + access/refresh 自动刷新（绕过 MCP 剥样式）
```

## 快速开始（本地）

```bash
cp .env.example .env
# 编辑 .env，填写 SMTP 与 IBKR 配置
node src/index.js --dry --force   # 生成预览 preview.html，不发送邮件
node src/index.js --force         # 强制发送一次（忽略交易日判断）
```

## 配置说明（.env）

| 变量 | 说明 |
| --- | --- |
| SMTP_HOST / SMTP_PORT / SMTP_SECURE | SMTP 服务器 |
| SMTP_USER / SMTP_PASS | SMTP 账号与授权码 |
| MAIL_FROM / MAIL_TO | 发件人与收件人 |
| BROKER_USE_MOCK | true 时使用 mock 数据 |
| IBKR_REFRESH_TOKEN | IBKR OAuth refresh token |
| IBKR_CLIENT_ID | IBKR OAuth client id |
| COS_ENABLED | 是否启用 COS 持久化 refresh_token |
| COS_SECRET_ID / COS_SECRET_KEY | 腾讯云 CAM 密钥 |
| COS_BUCKET / COS_REGION / COS_KEY | COS 存储桶信息 |
| TRADE_DAY_ONLY | 是否仅交易日发送 |
| NOTIFY_HOUR / NOTIFY_MINUTE | 发送时刻 |
| GMAIL_IMAGE_MODE | `html`（MCP 安全表格图）/ `dataUri`（API 直发 PNG） |
| GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET | Gmail 发件箱 OAuth 客户端（刷新 access token 用） |
| GMAIL_OAUTH_REFRESH_TOKEN | Gmail refresh token；有 secret 时发信前自动刷新 |
| GMAIL_OAUTH_TOKEN | Gmail access token（可由脚本自动维护） |




## Gmail 发件箱 OAuth（access / refresh 自动刷新）

例程用 **Gmail 当发件箱** 时，不要走 Grok Bot / MCP 的 `send_message`（会剥掉 `<style>` / `<img>`，折叠按钮和图表验收不过）。请用本仓库的直发脚本：

```bash
GMAIL_IMAGE_MODE=dataUri node src/index.js --dry --force   # 生成 send-payload.json
node tools/send-via-gmail-api.js send-payload.json --to ly1653812264@gmail.com
```

### 为什么能长期跑

Google **access token 约 1 小时过期**。脚本在**每次发信前**若检测到已配置 `GMAIL_OAUTH_REFRESH_TOKEN` + `GMAIL_OAUTH_CLIENT_SECRET`，会先向 `https://oauth2.googleapis.com/token` 用 `grant_type=refresh_token` 换新的 access token，再调用 `users.messages.send`。新 token 会写入：

- `.env` 的 `GMAIL_OAUTH_TOKEN`
- 本地文件 `.gmail_oauth_token`（已 gitignore）

若 Google 返回新的 refresh_token（rotation），也会写回 `GMAIL_OAUTH_REFRESH_TOKEN`。

仅刷新、不发信：

```bash
node tools/send-via-gmail-api.js --refresh-only
```

### 必配环境变量（.env）

| 变量 | 说明 |
| --- | --- |
| `GMAIL_OAUTH_CLIENT_ID` | Google Cloud OAuth 客户端 ID（与签发 refresh_token 时相同） |
| `GMAIL_OAUTH_CLIENT_SECRET` | 同一客户端的 secret（**刷新必需**） |
| `GMAIL_OAUTH_REFRESH_TOKEN` | 长期凭证；有它 + secret 时发信前自动刷新 |
| `GMAIL_OAUTH_TOKEN` | 短期 access token；可空，由脚本自动维护 |
| `GMAIL_IMAGE_MODE=dataUri` | 直发时内嵌 PNG；MCP 路径请用 `html` |

### 怎么拿到 authorization code / refresh_token

**推荐：自有 GCP 客户端（可离线刷新）**

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) 创建项目，启用 **Gmail API**。
2. 配置 OAuth 同意屏幕；创建 **OAuth 客户端 ID**（应用类型选 **Web application**）。
3. 把授权重定向 URI 加上：`https://developers.google.com/oauthplayground`
4. 打开 [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) → 右上角齿轮 →勾选 **Use your own OAuth credentials** → 填入你的 Client ID / Secret。
5. 左侧选 **Gmail API v1** → `https://www.googleapis.com/auth/gmail.send` → **Authorize APIs**（用发件邮箱登录，勾选离线权限）。
6. **Exchange authorization code for tokens**，复制 **Refresh token**（以及可选的 Access token）。
7. 写入 `.env`：

```bash
GMAIL_OAUTH_CLIENT_ID=xxxx.apps.googleusercontent.com
GMAIL_OAUTH_CLIENT_SECRET=xxxx
GMAIL_OAUTH_REFRESH_TOKEN=1//xxxx
GMAIL_IMAGE_MODE=dataUri
```

也可以把 Playground Step 2 里的 **authorization code** 交给脚本兑换（同样不打印密钥）：

```bash
# .env 里先写好 CLIENT_ID / CLIENT_SECRET
node tools/send-via-gmail-api.js --exchange-code '4/0A...'   --redirect-uri https://developers.google.com/oauthplayground
```

脚本会把得到的 `GMAIL_OAUTH_TOKEN` / `GMAIL_OAUTH_REFRESH_TOKEN` 写进 `.env`。

> **注意**：若 refresh_token 是用 OAuth Playground **默认**客户端（`407408718192.apps.googleusercontent.com`）签发的，离线刷新需要该客户端的 secret（Playground 服务端持有，不建议依赖）。长期例程请按上面步骤用**自有 GCP 客户端**重新授权一次，再更新 `.env`。

### 与 MCP 路径的区别

| 路径 | 样式/图片 | Token |
| --- | --- | --- |
| `tools/send-via-gmail-api.js`（本脚本） | 完整 HTML + data-URI 图，折叠可用 | access/refresh **自动刷新** |
| Grok Bot Gmail MCP `send_message` | 剥 `<style>` / `<img>`，验收失败 | MCP 自管，不能用于直发 raw MIME |

## 邮件发送：Gmail vs SMTP

**同一套 HTML**同时兼容 163.com 与 Gmail.com 收件；发送路径只决定图表载体：

| 路径 | 图表方式 | 说明 |
| --- | --- | --- |
| **Gmail API / Grok Bot**（`GMAIL_IMAGE_MODE=html`，默认） | `imageMode=html`：table + `bgcolor` 柱状 sparkline | **无附件**（MCP 会剥光所有 `<img>`） |
| **Gmail API 直接发送**（`GMAIL_IMAGE_MODE=dataUri`） | PNG 以 data-URI 内嵌 | Gmail 网页/手机端正常显示；**仅直接调 Gmail API 时用**，MCP 路径会剥掉图片变空白 |
| **SMTP**（`node src/index.js --force`） | `imageMode=cid`：`<img src="cid:chart-N.png">` + MIME `multipart/related` | 真内联 PNG（163/QQ 等；需 SMTP 可达） |
| **本地预览**（`--dry`） | `data:image/...` → `preview.html`；`send-payload.json` 为 Gmail html 版 | 浏览器看 PNG |

### 折叠开关（Show P&L & Cost / Collapse Charts）

渐进增强，**不是假按钮**：

1. **SMTP → 163 等保留 `<style>` 的客户端**：checkbox + CSS（`#pnl-toggle` / `#chart-all`）。标签默认 `display:none`，由 `<style>` 显示；P&L$ / cost 默认隐藏，勾选后显示；Collapse Charts 隐藏全部 `.ic-N` 走势块。
2. **Gmail API（会剥 `<style>` / 弄死 checkbox）**：同一 HTML 里的 `<details>` / `<summary>` 接手——「Show P&L & Cost」展开盈亏表；「Collapse Charts」收起 Intraday Charts 整块。成本/盈亏金额仍用内联 `display:none` 藏在持仓行里，避免剥样式后全裸奔。
3. 有 `<style>` 时会隐藏 details 回退 UI（`.details-only` / `.df-pnl-wrap`），避免两套控件叠在一起。

### Gmail 调用方

1. 跑 `node src/index.js --dry --force`，得到 `send-payload.json`（`gmailPayload`）。
2. 用 Gmail `send_message` 发送 `to` / `subject` / `body` / `htmlBody`。
3. **不要**再传 chart PNG 附件。
4. Market Map / 进度条 / sparkline 均 table + `bgcolor`。

### SMTP 路径说明

本机/盒子若连不上 SMTP（常见 465 出网限制），用 Gmail API 验收 toggles + sparkline；CID PNG 请在 SMTP 可达环境跑 `node src/index.js --force`，或把 `--dry` 的 CID 版交给可达 SMTP 的发送端。

## 腾讯云 SCF 部署

1. 在 SCF 控制台配置环境变量（敏感变量不入模板）
2. `cd scf && sls deploy`
3. Timer 触发器 cron：`0 0 10 * * * *`（每日 10:00），代码内再判断交易日

## 更新日志

### 2026-10-13

- **Gmail 发件箱自动刷新**：`tools/send-via-gmail-api.js` 在发信前用 `GMAIL_OAUTH_REFRESH_TOKEN` + client_id/secret 换新 access token，并持久化到 `.env` / `.gmail_oauth_token`；支持 `--exchange-code` / `--refresh-only`
- **截图风格图表**：PNG 重画为 520×150（折线 + 浅色面积填充 + H绿/M灰/L红三条虚线）；持仓行改成大 ticker 在左、进度条 + 百分比在右；图表下标注行改为 `H/M/L/prev`（H 绿、L 红加粗）
- **Gmail data-URI 图片模式**：`GMAIL_IMAGE_MODE=dataUri` 时 Gmail 版直接内嵌 PNG（data-URI），走 Gmail API 直发图片正常显示；默认 `html` 保持表格迷你图（MCP 安全，Grok Bot 剥 `<img>` 时用）
- **开关按发送路径区分**：`dataUri`（API 直发，`<style>` 保留）带 Show P&L & Cost / Collapse Charts 开关；`html`（MCP 路径）保持无开关，避免死按钮
- **新增 `tools/send-via-gmail-api.js`**：零依赖直发脚本，读 `send-payload.json`、拼 raw MIME、直调 Gmail API 发送，绕过 MCP 的 `<img>` 清洗；支持 refresh_token 自动刷新与 authorization code 兑换（gmail.send scope）
- **双端可用折叠**：同一 HTML 恢复 Show P&L & Cost / Collapse Charts——SMTP/163 走 checkbox+CSS；Gmail（剥 style）走 `<details>`/`<summary>`；有 style 时隐藏 details 回退，避免假按钮叠层
- **Gmail 版式（~600px）**：外层 `width=600` + `max-width:600px`；Market Map 每行 4 格；持仓与走势分区，避免左右滑
- **图表双路径**：Gmail API = HTML table sparkline（无附件）；SMTP = CID PNG；`--dry` preview = data-URI
- **样式降级**：Market Map / 进度条 / 卡片 / sparkline 均 table + `bgcolor`

### 2026-10-09

- **限流不再吞成空数据**：IBKR 返回 `isError` / `-32300`（限流）/ HTTP 429 时按错误处理，整队暂停后按 1、2、4、15、30、60 秒退避重试；此前约一半请求静默返回空数据，导致昨收丢失、涨跌显示 0.00%、走势图缺失
- **请求限速队列**：最多 2 个并发、间隔 ≥250ms、每分钟 ≤28 次，取代原来的 `Promise.all` 全并发
- **日K线改 TWO_WEEKS 并严格对日期**：只认目标交易日那一根；美股昨收必须是上一个美股交易日，否则标"昨收缺失"；不再用实时 `market_price` 冒充收盘价
- **缺数据显式标注**：顶部橙色"数据缺失 / data missing"提示，对应字段显示 N/A，邮件标题追加 `· N data missing`
- **总盈亏按币种分开**：EUR、USD 各自计算市值与收益率，不再把两种货币直接相加；邮件标题改为 `P&L EUR x% · USD y%`
- **过滤 0 股持仓**；碎股最多显示 4 位小数；金额格式改为 `-€6,298`
- **走势图**：仅在有真实昨收时画 prev 线；纵轴范围包含昨收；线色按收盘价 vs 昨收判断
- **摘要**：显示上涨 / 下跌 / 持平 / 缺失四项计数；中轴标签改为 `Mid (H+L)/2`
- **交易日历**：新增 2027 年美股假期（已对照 NYSE 官网），新增"上一个美股交易日"判断，假期表过期时打印警告
- **清理**：删除未使用的 `getPriceChange`、`shouldNotifyNow`、`fmtTime`；新增 `src/utils/summary.js` 统一汇总逻辑

### 2026-09-18（下午）

- **PNG 走势图**：零依赖 PNG 编码器（`zlib` + CRC32 + Bresenham 直线算法），生成 400×80 折线图；发送时用 CID 内联（Gmail/SMTP），本地预览仍可用 data-URI
- **面积填充修复**：逐列插值填充，无间隙，alpha 提高到 200
- **价格标注 HTML 化**：PNG 不画文字，H/M/L/prev 价格用 HTML 文字标注在图片下方，字体与外部一致
- **全英文**：邮件主题、按钮文案、切换标签全部改为英文
- **走势图默认展开**：不依赖 checkbox hack，不支持的邮件客户端也能直接看到走势图

### 2026-09-18（上午）

- **走势图加三条参考线**：最高价线（绿色虚线）、最低价线（红色虚线）、中轴线（灰色点线），左端标注价格
- **一键展开/收起**：Positions 标题行右侧添加苹果风格胶囊按钮，一键展开或收起全部走势图
- **盈亏金额及成本**：切换文案改为 Show P&L & Cost，点击后每只股票显示成本价
- **并行获取优化**：8 只股票的日K线与5分钟走势改为 `Promise.all` 并行获取，总耗时大幅降低
- **COS 开关**：新增 `COS_ENABLED` 环境变量，本地关闭 COS 仅用文件存储 refresh_token
- **fetch 替换 https**：ibkrService.js 的 HTTP 请求从 `https` 模块改为 `fetch`（undici），解决请求挂起问题
- **导出工具函数**：ibkrService.js 导出 `toPositionRow` 和 `summarize`，支持外部脚本调用

### 2026-09-17

- **真实 IBKR 数据接入**：通过 IBKR MCP 端点获取持仓、日K线（THREE_DAYS/ONE_DAY）、5分钟走势（ONE_DAY/FIVE_MINS）
- **盈亏基于正式收盘价**：从日K线提取上一个交易日正式收盘价计算盈亏，不再用实时盘后数据
- **日K线日期校验**：用 `Intl.DateTimeFormat` 转美东时区校验日K线日期匹配目标交易日
- **SVG 顺滑折线走势图**：`<polyline>` + `stroke-linejoin:round` + 面积填充 + prevClose 虚线基线
- **checkbox hack 修复**：`display:none` 从内联移到 CSS，`:checked` 规则可正常覆盖
- **normalizePriceHistory 更新**：支持 IBKR 列式格式（`time:[]`, `close:[]`）

### 2026-09-16 及更早

- 完整项目结构搭建（零依赖）
- 配置加载、美股交易日判断、SMTP 客户端、HTTP 客户端、env 解析
- IBKR MCP 接入：mcp-remote 桥接 + OAuth 授权 + 权限缩紧
- 苹果设计风格 HTML 模板：板块涨跌图 + 持仓明细列表 + 盈亏金额显隐 + 原始币种显示
- 腾讯云 COS 客户端（零依赖，SHA1 签名）
- GitHub 仓库创建并推送
- SCF 部署模板（cron `0 0 10 * * * *`，COS 环境变量配置）
