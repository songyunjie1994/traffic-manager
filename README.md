# 流量罗盘 · 投流管理系统

部署在 GitHub Pages 的投流管理系统，业务数据以 Supabase 云端为主。

## 功能

- 充值端：管理充值记录、付款记录和待付款记录
- 付款识别：上传支付宝、微信或银行回单图片，云端 AI 自动填写付款日期、账户和金额
- 消耗端：录入消耗、展现、点击、线索、订单、成交金额和备注
- 报表端：自动汇总充值、消耗、账户余额、成交与 ROI，并提供账户对账
- 账户配置：平台、广告账户、日预算、目标 ROI、负责人和状态管理
- 自动指标：ROI、CPC、CPA 与各计划表现排行
- 数据筛选：日期、平台、状态和关键词筛选
- 云端存储：确认保存后的结构化业务数据同步到 Supabase，浏览器保留缓存
- 数据迁移：完整 JSON 备份/恢复，充值与消耗筛选结果 CSV 导出
- 响应式界面：支持电脑和手机浏览器
- 千川数据看板：切换已授权客户，自动展开工作台、EBP 或店铺下的千川账户，并汇总消耗、7 日归因成交金额、ROI、订单与点击

## 数据说明

本项目是 GitHub Pages 静态应用，业务数据不会写入 GitHub。付款截图会临时发送至 Supabase Edge Function，再转交智谱视觉模型识别；截图本身不写入业务数据库，确认保存后仅同步日期、账户、金额等结构化字段。请定期进入“数据备份”页面下载 JSON 备份文件。

云端不可用时页面只显示本地缓存并禁止修改，避免本地数据覆盖云端。

## 付款截图 AI 识别

智谱 API Key 只保存在 Supabase Edge Function Secrets，不得写入 `app.js`、GitHub 仓库或浏览器缓存。需要配置：

- `ZHIPU_API_KEY`（在智谱开放平台新建，旧 Key 如曾进入 Git 历史必须作废）
- `PAYMENT_ALLOWED_ORIGINS=https://songyunjie1994.github.io`
- `ZHIPU_VISION_MODEL=glm-4v-flash`

部署函数：

```powershell
supabase functions deploy payment-recognize --project-ref mabxdkjqilulkrmqrrgo --use-api
```

## 巨量千川客户授权

“千川授权”页面通过 Supabase Edge Functions 发起 OAuth，客户在巨量千川官方页面选择账户。`App Secret`、`Access Token` 和 `Refresh Token` 不进入 GitHub Pages，仅由云端回调函数写入启用 RLS 且未开放客户端策略的 `qianchuan_authorizations` 表。

需要在 Supabase 项目中配置以下函数密钥：

- `QIANCHUAN_APP_ID`
- `QIANCHUAN_APP_SECRET`
- `QIANCHUAN_STATE_SECRET`（至少 32 个随机字符）
- `QIANCHUAN_DASHBOARD_KEY`（至少 16 个字符，仅用于管理员进入数据看板）
- `QIANCHUAN_ALLOWED_RETURN_ORIGINS=https://songyunjie1994.github.io`

回调地址固定为：

`https://mabxdkjqilulkrmqrrgo.supabase.co/functions/v1/qianchuan-oauth-callback`

首次部署需执行迁移，再部署 `qianchuan-oauth-start`、`qianchuan-oauth-callback` 与 `qianchuan-data` 三个函数。`qianchuan-data` 关闭 Supabase JWT 校验，但强制校验自定义的 `X-Dashboard-Key` 请求头，并只允许配置过的前端来源跨域访问。看板密码只存入浏览器 `sessionStorage`，不会写入源码、网址或长期缓存。

数据口径：

- 消耗：`stat_cost`
- 成交金额：`all_order_pay_gmv_7days`（7 日归因总成交金额）
- ROI：7 日归因总成交金额 ÷ 消耗
- 明细同时展示 `pay_order_amount`（直接成交金额）

任何日志、报错或前端页面都不得输出 Token 或 `App Secret`。

## 本地运行

可以直接打开 `index.html`，也可以在本目录启动任意静态文件服务器。

```powershell
python -m http.server 4173
```

然后访问 `http://localhost:4173/`。

## GitHub Pages

仓库包含 `.github/workflows/deploy.yml`。推送到 `main` 分支后，工作流会自动把仓库根目录部署到 GitHub Pages。
