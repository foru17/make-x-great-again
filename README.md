<p align="center">
  <img src="./services/edge/static/mxga-hero.png" width="180" alt="Make X Great Again — 小蓝 full-body mascot">
</p>

<p align="center">
  <b style="font-size: 28px;">Make X Great Again</b>
</p>

<p align="center">
  <b>少看垃圾，多看人话。</b><br>
  你照常刷 X，社区共建的公开黑名单帮你把广告号和色情 bot 标出来 · Chrome / Firefox / Safari 扩展 · AGPL-3.0 开源
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/make-x-great-again/aeoldnecphbkkckeedfgfcdcekkljdea"><img src="https://img.shields.io/chrome-web-store/v/aeoldnecphbkkckeedfgfcdcekkljdea?style=flat-square&color=4285F4&label=chrome%20web%20store&logo=googlechrome&logoColor=white" alt="Chrome Web Store"></a>
  <a href="https://addons.mozilla.org/firefox/addon/make-x-great-again/"><img src="https://img.shields.io/amo/v/make-x-great-again?style=flat-square&color=FF7139&label=firefox%20add-ons&logo=firefoxbrowser&logoColor=white" alt="Firefox Add-ons"></a>
  <a href="https://testflight.apple.com/join/SeH4raps"><img src="https://img.shields.io/badge/TestFlight-开放测试-0D96F6?style=flat-square&logo=apple&logoColor=white" alt="TestFlight"></a>
  <a href="https://github.com/foru17/make-x-great-again/blob/main/LICENSE"><img src="https://img.shields.io/github/license/foru17/make-x-great-again?style=flat-square&color=green" alt="License: AGPL-3.0"></a>
  <a href="https://github.com/foru17/make-x-great-again/releases/latest"><img src="https://img.shields.io/github/v/release/foru17/make-x-great-again?style=flat-square&color=blue&include_prereleases&label=release" alt="Release"></a>
  <a href="https://github.com/foru17/make-x-great-again/stargazers"><img src="https://img.shields.io/github/stars/foru17/make-x-great-again?style=flat-square&color=yellow" alt="Stars"></a>
  <img src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" alt="Status: alpha">
  <a href="https://x.zuoluo.tv"><img src="https://img.shields.io/badge/live-x.zuoluo.tv-38bdf8?style=flat-square" alt="Live"></a>
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/make-x-great-again/aeoldnecphbkkckeedfgfcdcekkljdea">🟦 从 Chrome 商店安装</a> ·
  <a href="https://addons.mozilla.org/firefox/addon/make-x-great-again/">🦊 从 Firefox 商店安装</a> ·
  <a href="https://testflight.apple.com/join/SeH4raps">🍎 加入 TestFlight 测试</a> ·
  <a href="https://x.zuoluo.tv">🌐 官网门户</a> ·
  <a href="https://x.zuoluo.tv/list">📋 公共名单</a> ·
  <a href="https://github.com/foru17/make-x-great-again/releases/latest">📦 GitHub Release</a> ·
  <a href="./CHANGELOG.md">📝 Changelog</a>
</p>

---

## 支持的平台与版本

同一套名单与检测逻辑，三个平台版本，选你在用的浏览器装：

| 平台版本 | 安装渠道 | 状态 | 环境要求 |
|---|---|---|---|
| 🟦 **Chrome 版**（Chrome / Edge / Brave / Arc） | [Chrome 网上应用店](https://chromewebstore.google.com/detail/make-x-great-again/aeoldnecphbkkckeedfgfcdcekkljdea) | ✅ 已上架，自动更新 | Chromium 内核，MV3 |
| 🦊 **Firefox 版** | [Firefox 附加组件商店](https://addons.mozilla.org/firefox/addon/make-x-great-again/) | ✅ 已上架，自动更新 | Firefox 109+ |
| 🧭 **Safari macOS 版** | [TestFlight](https://testflight.apple.com/join/SeH4raps) | 🧪 开放测试 | macOS 15+ |
| 📱 **Safari iOS / iPadOS 版** | [TestFlight](https://testflight.apple.com/join/SeH4raps) | 🧪 开放测试 | iOS / iPadOS 18+，作用于 Safari 内的 x.com |

Safari（macOS / iOS）版由 [@tualatrix](https://github.com/tualatrix) 移植与维护，
构建说明见 [docs/SAFARI.md](./docs/SAFARI.md)（macOS）与 [docs/SAFARI-IOS.md](./docs/SAFARI-IOS.md)（iOS）。

## 这个项目要解决什么

X 现在的问题，大家都知道：

- 评论区一半是广告号和色情 bot，正常讨论被刷到底
- 想关注一个新人，分不清是真号还是水军
- 算法决定你看到谁，而不是你决定
- 看一个人聊过什么、最热几条是什么——只能手动翻几十层

**Make X Great Again (MXGA)** 装上之后，定期同步的社区共建公开黑名单帮你标出这些垃圾号，一键本地隐藏。未登录 GitHub 时只做本地名单 / 规则匹配；登录后，对尚未命中的新账号默认触发在线 AI 检测。你也可以选择用自己的 X 登录态调用 X 原生静音 / 拉黑（动作仍不经过我们的服务器）。

默认本地优先，无广告追踪，源码全开；可选在线检测的数据流完整公开。

## 五件事，分阶段做

| # | 想做的事 | 状态 | 简介 |
|---|---|:---:|---|
| **01** | **干掉刷评论的垃圾号** | ✅ Live | 扩展定时同步社区共建的公开黑名单，命中即出徽标，一键本地隐藏（默认仅本地隐藏，可随时取消；也可选用你自己的 X 登录态做原生静音 / 拉黑）。名单由关键词规则 + AI 初筛、维护者人工确认后公开。 |
| **02** | **看一眼就知道这个 KOL 靠谱不** | 🚧 计划 | 鼠标停在 @handle 上 → 浮卡：账号年龄、原创比、主题集中度、互动质量 |
| **03** | **进 profile 自动出摘要** | 🚧 计划 | 「这个人主要谈 A/B/C」「最近一个月最热的 5 条」「最佳互动时段」—— 不用手动翻 |
| **04** | **让信号穿过算法噪声** | 🚧 计划 | 在推文下提示「你关注的 3 个 KOL 转过 / 评论过」，找回算法之前的发现感 |
| **05** | **你的数据归你** | 🚧 计划 | 一键把你的关注 / 收藏 / 自己的推文导出成 JSON / Markdown，备份或迁出 |

> 现阶段只有 Pillar 01 上线；Pillar 02–05 的实现路径在 [docs/PRODUCT.md](./docs/PRODUCT.md) 里。

## Pillar 01 当前能做什么

这是已经跑在 [x.zuoluo.tv](https://x.zuoluo.tv) 上的部分。公榜数量会持续变化，实时数据请看 [/list](https://x.zuoluo.tv/list)。

- **自动同步公开名单**：安装 / 更新后立即下载，此后每 6 小时检查一次；匹配仍在本地完成，请求不会携带页面内容、X 身份、扫描结果或处理记录
- **本地徽标 + 一键隐藏**：命中名单的账号在推文旁出徽标，点「隐藏」本地隐藏该账号的帖子（5 秒可撤销）——**默认是纯本地隐藏，不调用 X 的任何接口**
- **三种处理方式（可选）**：设置页「处理方式」里可切换点「隐藏」时的默认行为——**本地隐藏**（默认，零联网，X 无感）/ **X 静音**（用你的 X 登录态调 X 原生静音，单向、对方不知情、关注关系不变）/ **X 拉黑**（X 原生屏蔽，互相看不到、解除关注）。静音 / 拉黑均为可选，且只在切换到该模式时才在运行时申请 x.com 的可选权限；这两种动作经过一个全局限速队列（跨 tab 串行、约 1.2s 间隔 + 抖动、阶段性冷却、429 退避）调用 X 自家接口，不经过我们的服务器，也不收集任何数据
- **随时取消隐藏**：设置页可查看本地隐藏列表，一键取消隐藏纠正误判（本地隐藏一侧始终可恢复）
- **误判申诉**：徽标里点「申诉」会打开 GitHub 上的申诉 issue 模板，由维护者人工复核
- **登录后的新账号检测**：GitHub 登录后，本地名单、缓存和官方规则都未命中的账号会把公开资料与当前公开文本提交到 `/v1/classify`；单页最多 40 个、最多 3 个并发，结果缓存在本机。退出 GitHub 后恢复纯本地匹配
- **最小数据流**：默认权限为 `storage`、`alarms`、`unlimitedStorage`；x.com 与 GitHub host 权限按功能申请。无统计上报，本地处理记录不上传；在线检测与白名单申请的完整字段见隐私声明
- **守门员审核台**（[/admin](https://x.zuoluo.tv/admin)，需要 ADMIN_TOKEN）：待审队列 / 黑名单 / 白名单 / 审计日志 四个 tab，全自定义弹窗
- **公开公榜**（[/list](https://x.zuoluo.tv/list)）：所有 `human_confirmed` 账号公开可查，含理由 + 举报人数
- **共建机制（在网站端，不在扩展里）**：举报 / 确认走 [x.zuoluo.tv](https://x.zuoluo.tv) 的 API（GitHub token 验证、加盐指纹存储）；alpha 阶段所有举报先进人工队列。`3 个 ≥90 天 GH 账号 + AI 置信 ≥0.9` 是保留的自动发布治理门槛，目前默认关闭

详细治理规则见 [GOVERNANCE.md](./GOVERNANCE.md)。

## 怎么用

> [!NOTE]
> **关于处理方式与 X 风控**：默认的**本地隐藏**模式只在扩展内做视觉隐藏，不调用 X 的任何接口，
> 因此**不会**触发 X 的自动化风控。但如果你在设置里主动开启 **X 静音 / X 拉黑**，
> 这两种动作会用你**真实的 X 账号**调用 X 自家接口，X 的反自动化规则就会适用——
> 短时间内连续操作大量账号（尤其是**批量拉黑**）可能被判定为异常行为，触发 Ghost Ban、
> 功能限制甚至冻结。MXGA 已对这两种动作做了限速排队来降低风险，但仍请你分批、少量操作，
> 优先用静音而非拉黑，尤其不要在新号或近期被限制过的账号上密集拉黑。

### 普通用户

**推荐**：直接从官方商店安装，会自动更新。

- 🟦 **Chrome / Edge / Brave / Arc**：[Chrome 网上应用店](https://chromewebstore.google.com/detail/make-x-great-again/aeoldnecphbkkckeedfgfcdcekkljdea)
- 🦊 **Firefox**：[Firefox 附加组件商店](https://addons.mozilla.org/firefox/addon/make-x-great-again/)
- 🍎 **iOS / iPadOS / macOS**：[加入 TestFlight 测试](https://testflight.apple.com/join/SeH4raps)

装好后，访问 x.com 扩展会自动开始工作。

<details>
<summary>想跑开发版，或从源码加载？</summary>

```bash
# 1. 从 https://github.com/foru17/make-x-great-again/releases/latest 下载最新 .zip 并解压

# Chromium 内核（Chrome / Edge / Brave / Arc）
# 2. chrome://extensions → 开启「开发者模式」
# 3. 「加载已解压的扩展程序」→ 选择解压目录

# Firefox
# 2. about:debugging → 「此 Firefox」→「临时加载附加组件」
# 3. 选择解压目录里的 manifest.json

# 4. 访问 x.com，扩展自动开始工作
```

</details>

### 开发者

```bash
# 0. 装依赖（用 pnpm；锁文件已提交）
pnpm install

# 1. 静态检查
pnpm typecheck && pnpm test && pnpm lint

# 2. 扩展（WXT + React 19 + Tailwind v4）
cd extension
pnpm dev          # Chromium：监听 + 自动重载，把 .output/chrome-mv3 加进 Chrome 即可
pnpm dev:firefox  # Firefox：同上，产物在 .output/firefox-mv3

# 3. Safari 扩展（macOS 15+ / iOS 18+，MV3 + SwiftUI 容器）
npm --prefix extension install
# 可选：复制后填写本机 Team ID；该本地文件不会提交
cp apple/Config/Signing.local.xcconfig.example apple/Config/Signing.local.xcconfig
./scripts/build-safari-app.sh      # macOS 构建；有本地 Team 时自动签名
./scripts/build-safari-ios-app.sh  # iOS Simulator 构建检查
# macOS 说明见 docs/SAFARI.md；iOS 说明见 docs/SAFARI-IOS.md

# 4. 边缘服务（Cloudflare Worker + D1 + Hono）
cd services/edge
pnpm dev         # 本地 8787

# 5. 部署（需 Cloudflare 账号 + wrangler 登录）
pnpm deploy
```

### LLM 配置

跑分类需要一个 OpenAI 兼容的 `/chat/completions` 端点。它**永远不会进仓库**：

```bash
# 本地 CLI 跑（src/cli.ts，给开发 / 调 prompt 用）
cp .env.example .env
# 编辑 .env，填 LLM_API_BASE / LLM_API_MODEL / LLM_API_KEY

# Worker 上跑（生产 + 部署）
cd services/edge
npx wrangler secret put LLM_API_BASE     # OpenAI 兼容 base，比如 https://api.openai.com/v1
npx wrangler secret put LLM_API_MODEL    # 模型 id，比如 gpt-4o-mini
npx wrangler secret put LLM_API_KEY      # bearer
npx wrangler secret put ADMIN_TOKEN      # /admin 网关
```

## 仓库结构

```
src/                  本地 LLM 分类 CLI + node:test 单测（开发用，非生产路径）
extension/            MV3 浏览器扩展：WXT + React 19 + Tailwind v4（名单下载、本地匹配）
  entrypoints/
    content.ts        X DOM 的被动观察 + 气泡 UI + 一键隐藏（5 秒可撤销；按处理方式叠加 X 静音/拉黑）
    background.ts     名单定时同步、GitHub Device Flow、本地健康检查 / 统计
    popup/ options/   React 弹窗 + 设置页（含本地隐藏列表的取消隐藏、处理方式选择）
  lib/                cache / blocklist / local-index / detect / stats / x-action（X 静音/拉黑限速队列）
apple/MXGA/           macOS 15+ / iOS 18+ 共用的 Xcode 工程（4 个平台 target）
services/edge/        Cloudflare Worker（Hono）+ D1（xss-db）
  src/index.ts        /v1/* API + scheduled cron + Env 类型
  src/pages/          SSR landing / list / admin（同套 base-ui design token）
data/                 公开数据快照（Worker 每 6h 自动同步，git history = 审计日志）
  whitelist/v1.json   维护者人工确认安全的账号
  blacklist/v1.json   维护者人工确认公开的垃圾号（含 evidence_text + reasons）
  README.md           schema 文档 + 更新机制说明
docs/                 ARCHITECTURE / PRODUCT / MODERATION / FLOW / UX / STATUS / RUNNING / MVP
GOVERNANCE.md         治理铁律 + 申诉路径（在仓库根）
SECURITY.md           漏洞披露通道
CONTRIBUTING.md       贡献指南
```

## 公开数据集（审计入口）

`data/whitelist/v1.json` 和 `data/blacklist/v1.json` 是这个项目最重要的透明度承诺 —— 它们是 D1 数据库的**只读快照**，每 6 小时由服务端自动同步到这里。**仓库的 git history 就是完整审计日志**：任何人 clone 一下就能复现"维护者在哪天加了/移除了哪个账号"。

每条 blacklist 记录都附 `evidence_text`（触发判定的那条公开 X 文本）、`reasons`（AI 给出的理由数组）、`reporters`（独立举报人数），让审计不止是"我说他是 spam"。

→ 实时浏览：[github.com/foru17/make-x-great-again/tree/main/data](https://github.com/foru17/make-x-great-again/tree/main/data)
→ 完整 schema 与使用说明：[data/README.md](./data/README.md)

## 当前进度

**v0.5.1**（最新，2026-07-31）—— 恢复 GitHub 登录后的新账号在线 AI 检测
- **自动检测恢复**：本地名单、缓存和官方规则均未命中的新增账号会默认调用 `/v1/classify`，判定写入账号级本地缓存
- **登录门控与成本边界**：未登录绝不调用分类接口；每个 SPA 页面最多 40 个账号、最多 3 个并发，服务端继续执行身份 / 全局限流
- **隐私披露**：登录页明确展示在线检测的数据流；Firefox 将 `websiteContent` 列为可选数据权限

**v0.5.0**（2026-06-10）—— 被动本地优先 + 可选 X 原生动作
- **名单下载、本地匹配**：公开黑名单与白名单由后台定时同步；命中和统计在本地完成，不上传浏览内容、扫描结果或处理记录
- **处理方式三选一**：点「隐藏」默认仅**本地隐藏**（display:none + 本地隐藏列表，零联网，可随时取消）；可选 **X 静音** / **X 拉黑**——用你自己的 X 登录态调用 X 自家接口（`mutes/users/create.json` / `blocks/create.json`），经全局限速队列调度，不经过我们的服务器
- **权限分层**：默认权限为 `storage`、`alarms`、`unlimitedStorage`；x.com 与 GitHub host 权限仅在启用对应功能时申请
- **误判申诉**：改为打开 GitHub 申诉 issue 模板，不再向服务端 POST
- **白名单自助申请**：可选 GitHub Device Flow 验证账号年龄，并向服务端提交自己的公开 X handle 与可选附言；完整数据流见隐私声明
- **服务端加固**：admin 鉴权 timing-safe、`/v1/classify` 与 `/v1/appeal` 限流、cron 拆分（R2 工件每 10 分钟 / GitHub 镜像每 6 小时）、举报人只存加盐指纹（无盐则 fail-closed）

**v0.4.0**（2026-05-28）
- **静默真拉黑**：调用 X 自己的 `blocks/create.json` 接口，不再模拟点击原生确认弹窗；后台队列带限速、重试、跨 tab 协调
- **可见进度**：右上角气泡显示固定 4 格状态（命中 / 正在 / 待拉 / 已拉）、进度条和当前拉黑队列；成功后头像和名称划掉并淡出
- **批量公榜查询**：`/v1/check?ids=...` 批量查 100 个 ID，垃圾号密集的帖子不再对服务端打出一串单账号请求
- **登录体验**：popup 点 GitHub 会直接跳设置页并启动 Device Flow；验证码卡片支持一键复制
- **Agent 审核侧路**：新增 `/v1/agent/*`、agent staging 状态和 admin 审核台页签；修复 stale agent 决策降级公榜的竞态
- **Landing 趋势图**：新增 `/v1/list/trends` 与 D1 索引迁移，用于官网展示 24h / 7d 公榜增长趋势

完整版本记录见 [CHANGELOG.md](./CHANGELOG.md)。

**v0.3.0**（2026-05-26）
- GraphQL 身份解析硬化、viewer-scoped 过滤、公榜命中自动拉黑（默认关）、浅色主题、批量勾选 UI、`escHtml` 加固

**v0.2.0**（首发，2026-05-25）
- 浏览器扩展（Chrome MV3）— 被动 AI 识别 + 一键真拉黑
- 公开服务端 — `x.zuoluo.tv` / `/list` 公榜 / `/admin` 审核台
- 维护者白名单 + 黑名单的 6h 自动同步到仓库 [`data/`](./data) 目录
- 公榜每条带 `evidence_text`（触发推文片段）+ `reasons`（AI 给出的理由）+ `reporters`（独立举报人数）

**接下来想做的（02–05）**
- 鼠标 hover @handle → KOL 信号分浮卡
- 进 profile 自动出"主要谈什么 / 最热几条 / 最佳互动时段"摘要
- 看推文时显示"你关注的 N 人转过 / 评论过"
- 一键导出你的关注 / 收藏 / 推文为 JSON / Markdown

完整 release notes：[GitHub Releases](https://github.com/foru17/make-x-great-again/releases)

## 治理与隐私

这是一份对真实账号的公开指控列表，所以治理比代码本身重要。完整规则在 [GOVERNANCE.md](./GOVERNANCE.md)，要点：

- **AI 永远不能单独公开。** alpha 阶段公榜入榜走人工维护者确认；历史设计中的自动发布门槛（AI 置信度 ≥ 0.9 + ≥3 个注册 90 天以上的 GitHub 账号独立举报）仍保留为治理红线，但当前默认关闭。
- **审核范围严格限定** 商业 spam 和色情广告 bot。**永远不判断观点、立场、政治、身份。**
- **零 PII**：库里只存 X 公开数字 ID 和举报人的**加盐 HMAC 指纹**（原始 GitHub ID 从不落库；`REPORT_SALT` 未配置时举报端点直接拒绝服务，fail-closed），不存任何邮箱、姓名、设备指纹、IP。
- **所有维护者动作都进 `review_log`**：拉黑 / 驳回 / 移除 / 加白 / 移白，全部留痕，可在 /admin 审计日志 tab 翻。
- **申诉**：在 GitHub 上[新开 issue](https://github.com/foru17/make-x-great-again/issues/new) 即可，附带 X handle + 你的理由。维护者会复核，没有承诺 SLA，通常一两天内回应。
- **维护者凭据永不进消费端构建**：审核台的 `ADMIN_TOKEN` 只在 maintainer 浏览器 localStorage，不出现在公开扩展包里。
- **LLM 供应商坐标永不进仓库**：URL + model + key 全部是 Worker secrets。
- 协议是 [AGPL-3.0](./LICENSE)，防止有人闭源套壳商用化。

安全问题请走 [SECURITY.md](./SECURITY.md) 的非公开通道，不要开公开 issue。

## 技术 stack

| 层 | 选型 | 备注 |
|---|---|---|
| 扩展 | WXT 0.20 · React 19 · Tailwind v4 · Shadow DOM · Chrome + Firefox MV3 | content-script 用 Shadow DOM 隔离样式；后台同步公开名单、本地匹配；GitHub 登录后对新增账号调用在线 AI；可选 X 静音/拉黑用 x.com 可选权限调 X 自家接口 |
| Safari | Safari Web Extension MV3 · Swift 6 · SwiftUI · macOS 15+ / iOS 18+ | 单一 Xcode 工程复用 WXT WebExtension 源码与名单同步；支持本地隐藏及可选 X 静音/拉黑。iOS 仅作用于 Safari 网页；构建见 [macOS](./docs/SAFARI.md) / [iOS](./docs/SAFARI-IOS.md) |
| 边缘 | Cloudflare Worker · Hono · D1 SQLite · R2 | 单 region，custom domain `x.zuoluo.tv` |
| LLM | 任何 OpenAI 兼容 `/chat/completions` | 仅靠 system prompt 约束，不微调；扩展只调用服务端 `/v1/classify`，不直连 LLM |
| 身份 | GitHub token 验证 | 扩展登录后用于在线 AI 检测、举报与白名单申请；X 静音/拉黑复用浏览器已有的 X 登录态，不向我们的服务上传该凭据；服务端只存加盐 HMAC 指纹 |
| 同步 | Workers Cron：`*/10 * * * *` 发布 R2 工件 · `0 */6 * * *` 镜像 data/ 仓库 | 扩展安装/更新后拉取，之后每 6 小时检查名单版本 |

更细的架构与决策记录在 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

## 贡献

欢迎 PR、issue、申诉。请先翻一下 [CONTRIBUTING.md](./CONTRIBUTING.md) 和 [GOVERNANCE.md](./GOVERNANCE.md)。
如果你想贡献新的 Pillar（02–05 任意一个）的设计或代码，先开 issue 聊一下方向，避免重复造轮子。

### 贡献者

感谢每一位让 MXGA 变得更好的人：

| 贡献者 | 贡献 |
|---|---|
| [@tualatrix](https://github.com/tualatrix) | Safari 平台移植：macOS / iOS 容器 App、触屏交互适配、名单索引内存优化（[#90](https://github.com/foru17/make-x-great-again/pull/90)） |

<a href="https://github.com/foru17/make-x-great-again/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=foru17/make-x-great-again" alt="Contributors" />
</a>

## License

[AGPL-3.0](./LICENSE)。

## Star History

<a href="https://www.star-history.com/?repos=foru17%2Fmake-x-great-again&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=foru17/make-x-great-again&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=foru17/make-x-great-again&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=foru17/make-x-great-again&type=date&legend=top-left" />
 </picture>
</a>
