# 流量罗盘 · 投流管理系统

部署在 GitHub Pages 的投流管理系统，业务数据以 Supabase 云端为主。

## 功能

- 充值端：管理充值记录、付款记录和待付款记录
- 付款识别：上传支付宝、微信或银行回单图片，云端 AI 自动填写付款日期、账户和金额
- 消耗端：按日期和达人查看抖音号、达人昵称、整体消耗、整体成交金额和整体 ROI
- 报表端：在消耗数据、财务数据、数据比对三个页面之间切换；消耗页保留四种投放类型的完整下载字段
- 账户配置：平台、广告账户、日预算、目标 ROI、负责人和状态管理
- 自动指标：整体 ROI 按整体成交金额 ÷ 整体消耗实时计算
- 数据筛选：日期、平台、状态和关键词筛选
- 云端存储：确认保存后的结构化业务数据同步到 Supabase，浏览器保留缓存
- 数据迁移：完整 JSON 备份/恢复，消耗端与报表端支持 Excel 导出
- 响应式界面：支持电脑和手机浏览器
- 千川数据看板：切换已授权客户，自动展开工作台、EBP 或店铺下的千川账户，并汇总消耗、7 日归因成交金额、ROI、订单与点击

## 数据说明

本项目是 GitHub Pages 静态应用，业务数据不会写入 GitHub。付款截图会临时发送至 Supabase Edge Function，再转交智谱视觉模型识别；截图本身不写入业务数据库，确认保存后仅同步日期、账户、金额等结构化字段。请定期进入“数据备份”页面下载 JSON 备份文件。

云端不可用时页面只显示本地缓存并禁止修改，避免本地数据覆盖云端。

## 钱包日结同步与余额口径

- 钱包的已采日结消耗、自有账户日结净入金和同日收盘余额直接从最新 `financeRecords` 只读计算，不再读取过期的预计算汇总；页面可见时每 60 秒读取云端，也可点击“刷新财务”。
- 默认日期随最新云端财务更新，用户手工选择的日期不会被自动刷新改掉。钱包独立按各自期初至最新已采日结汇总，不跟随明细筛选缩短。
- 自有账户净入金 = 总存入（含赠款）+ 总转入 − 总转出。共享钱包仅汇总“共享钱包消耗”，不把广告账户余额/入金混作钱包资金。
- 共享钱包余额仍需真实钱包快照：标注北京时间读取时间，超过 5 分钟或离线时明确显示旧快照；账户日结不能反推真实钱包余额。钱包入金或余额日期口径未核验时，差额显示“待核验”，不显示旧差额或虚构零值。
- 缺失账户、无日结行、无效金额不按零处理。投影不会改写历史 `wallets`、`walletSnapshots`、充值或财务数据，后台刷新不写入云端，也不影响采集机。

回归测试：`node --test test/*.test.js`；语法检查：`node --check app.js`、`node --check wallet-summary.js`。

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

### 财务对账与访问权限（2.8.3）

- 对账端、明细和Excel按广告账户+日期采用同一最新版本；同时间/未知时间的金额冲突保持待核验，不合计为零。原始云端记录不被页面删除或重写。
- 财务请求起止不能证明缺失日期已核验；缺日期不补零。自有钱包先逐账户逐日核验，再检查钱包汇总；反推期初只用于检查后续连续性，不是独立期初凭据。
- 钱包余额核验不等同充值/凭证对账。登记本金与返点、平台现金与赠款分列；未分配账户、重复流水、缺付款链接、外币等列待处理。共享钱包缺入金流水和日结余额时保持待核验。
- 中介返点不自动等同平台赠款。充值编辑可明确填写到账现金/平台赠款、关联付款和平台流水；留空保持未知。未归属记录不默认选第一个账户，编辑保留原凭证、历史金额和待到账状态。
- 页面使用采集中心现有管理员账号登录，服务器复核用户身份及管理员白名单。公开密钥不是财务读取权限；业务文档和CAS通过受保护traffic-finance接口访问。
- 先部署受保护接口、前端及采集端并实测回传，随后执行20261006160000_protect_traffic_finance.sql。禁止先关闭匿名旧通道造成运行中的旧采集任务无法回传。该迁移只保护业务文档2，保留其他app_data应用的原有行为。
- 付款凭证按已保存的付款记录ID读取，不接受浏览器提供的任意存储路径。登录失败或退出后不展示财务缓存。

可以直接打开 `index.html`，也可以在本目录启动任意静态文件服务器。

```powershell
python -m http.server 4173
```

然后访问 `http://localhost:4173/`。

## GitHub Pages

当前仓库没有 `.github/workflows/deploy.yml`。推送到 `main` 后需等待 Pages 部署，并用 `node test/verify-live-page.js` 读回页面及三个脚本核验，不把推送成功当作已上线。
