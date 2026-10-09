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
    mailService.js      # SMTP 邮件发送
  utils/
    tradeDateUtil.js    # 美股交易日/工作日判断（含2024-2027节假日）
    summary.js          # 按币种汇总 + 涨跌/持平/缺失计数
    htmlTemplate.js     # 苹果风格 HTML 模板（板块图+明细+走势图+显隐切换）
    pngChart.js         # 零依赖 PNG 编码器（走势折线图渲染）
    httpClient.js       # HTTP 客户端
    smtpClient.js       # SMTP 客户端（base64 折叠修复）
    cosClient.js        # 腾讯云 COS 客户端（零依赖，SHA1 签名）
    envLoader.js        # 极简 .env 解析
config/
  stocks.json           # 股票白/黑名单配置
scf/
  template.yaml         # 腾讯云 SCF 部署模板
docs/
  preview_mock.html     # Mock 数据效果图
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

## 腾讯云 SCF 部署

1. 在 SCF 控制台配置环境变量（敏感变量不入模板）
2. `cd scf && sls deploy`
3. Timer 触发器 cron：`0 0 10 * * * *`（每日 10:00），代码内再判断交易日

## 更新日志

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

- **PNG 走势图**：零依赖 PNG 编码器（`zlib` + CRC32 + Bresenham 直线算法），生成 400×80 折线图以 `<img src="data:image/png;base64,...">` 嵌入邮件，所有邮件客户端兼容
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
