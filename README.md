<p align="center">
  <img src="./services/edge/static/mxga-hero.png" width="180" alt="Make X Great Again — 小蓝 full-body mascot">
</p>

<p align="center">
  <b style="font-size: 28px;">Make X Great Again</b>
</p>

<p align="center">
  <b>少看垃圾，多看人话。</b><br>
  你照常刷 X，AI 在后台把广告号和色情 bot 挑出来 · Chrome 扩展 · AGPL-3.0 开源
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/make-x-great-again/aeoldnecphbkkckeedfgfcdcekkljdea"><img src="https://img.shields.io/chrome-web-store/v/aeoldnecphbkkckeedfgfcdcekkljdea?style=flat-square&color=4285F4&label=chrome%20web%20store&logo=googlechrome&logoColor=white" alt="Chrome Web Store"></a>
  <a href="https://github.com/foru17/make-x-great-again/blob/main/LICENSE"><img src="https://img.shields.io/github/license/foru17/make-x-great-again?style=flat-square&color=green" alt="License: AGPL-3.0"></a>
  <a href="https://github.com/foru17/make-x-great-again/releases/latest"><img src="https://img.shields.io/github/v/release/foru17/make-x-great-again?style=flat-square&color=blue&include_prereleases&label=release" alt="Release"></a>
  <a href="https://github.com/foru17/make-x-great-again/stargazers"><img src="https://img.shields.io/github/stars/foru17/make-x-great-again?style=flat-square&color=yellow" alt="Stars"></a>
  <img src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" alt="Status: alpha">
  <a href="https://x.zuoluo.tv"><img src="https://img.shields.io/badge/live-x.zuoluo.tv-38bdf8?style=flat-square" alt="Live"></a>
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/make-x-great-again/aeoldnecphbkkckeedfgfcdcekkljdea">🟦 从 Chrome 商店安装</a> ·
  <a href="https://x.zuoluo.tv">🌐 官网门户</a> ·
  <a href="https://x.zuoluo.tv/list">📋 公共名单</a> ·
  <a href="https://github.com/foru17/make-x-great-again/releases/latest">📦 GitHub Release</a>
</p>

---

## 这个项目要解决什么

X 现在的问题，大家都知道：

- 评论区一半是广告号和色情 bot，正常讨论被刷到底
- 想关注一个新人，分不清是真号还是水军
- 算法决定你看到谁，而不是你决定
- 看一个人聊过什么、最热几条是什么——只能手动翻几十层

**Make X Great Again (MXGA)** 装上之后，AI 在后台帮你识别这些垃圾号，一键拉黑——驱动 X 自己的屏蔽接口，不是隐藏。

不收集你的信息，不要注册，源码全开。

## 五件事，分阶段做

| # | 想做的事 | 状态 | 简介 |
|---|---|:---:|---|
| **01** | **干掉刷评论的垃圾号** | ✅ Live | AI 自动识别色情广告 / 营销 bot，给你一个一键拉黑按钮（驱动 X 自己的屏蔽 UI，是真拉黑）。维护者社区共建公开黑/白名单。 |
| **02** | **看一眼就知道这个 KOL 靠谱不** | 🚧 计划 | 鼠标停在 @handle 上 → 浮卡：账号年龄、原创比、主题集中度、互动质量 |
| **03** | **进 profile 自动出摘要** | 🚧 计划 | 「这个人主要谈 A/B/C」「最近一个月最热的 5 条」「最佳互动时段」—— 不用手动翻 |
| **04** | **让信号穿过算法噪声** | 🚧 计划 | 在推文下提示「你关注的 3 个 KOL 转过 / 评论过」，找回算法之前的发现感 |
| **05** | **你的数据归你** | 🚧 计划 | 一键把你的关注 / 收藏 / 自己的推文导出成 JSON / Markdown，备份或迁出 |

> 现阶段只有 Pillar 01 上线；Pillar 02–05 的实现路径在 [docs/PRODUCT.md](./docs/PRODUCT.md) 里。

## Pillar 01 当前能做什么

这是已经跑在 [x.zuoluo.tv](https://x.zuoluo.tv) 上的部分。公榜数量会持续变化，实时数据请看 [/list](https://x.zuoluo.tv/list)。

- **被动 AI 扫描**：你在 X 看到的每个评论作者，扩展静默判定 → spam / 色情广告号 / 疑似垃圾 / 不确定 / 正常
- **一键真拉黑**：点扩展气泡里的「拉黑」，调起 X 自己的屏蔽菜单完成屏蔽（不是 hide，不伪造请求）
- **零网络命中**：本地缓存维护者白名单 + 公榜，每 6 小时增量同步；命中直接出结果，不调任何接口
- **守门员审核台**（[/admin](https://x.zuoluo.tv/admin)，需要 ADMIN_TOKEN）：待审队列 / 黑名单 / 白名单 / 审计日志 四个 tab，全自定义弹窗
- **公开公榜**（[/list](https://x.zuoluo.tv/list)）：所有 `human_confirmed` 账号公开可查，含理由 + 举报人数
- **共建机制**：GitHub 登录后任何人都能举报；3 个 ≥90 天的 GH 账号 + AI 置信 ≥0.9 才能自动进公榜，否则进人工队列

详细治理规则见 [GOVERNANCE.md](./GOVERNANCE.md)。

## 怎么用

### 普通用户

**推荐**：直接从 Chrome Web Store 安装。

👉 [chromewebstore.google.com/detail/make-x-great-again/aeoldnecphbkkckeedfgfcdcekkljdea](https://chromewebstore.google.com/detail/make-x-great-again/aeoldnecphbkkckeedfgfcdcekkljdea)

装好后，访问 x.com 扩展会自动开始工作。

<details>
<summary>用 Edge / Brave / Arc，或想跑开发版？</summary>

```bash
# 1. 从 https://github.com/foru17/make-x-great-again/releases/latest 下载最新 .zip 并解压
# 2. chrome://extensions → 开启「开发者模式」
# 3. 「加载已解压的扩展程序」→ 选择解压目录
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
pnpm dev         # 监听 + 自动重载，把 .output/chrome-mv3 加进 Chrome 即可

# 3. 边缘服务（Cloudflare Worker + D1 + Hono）
cd services/edge
pnpm dev         # 本地 8787

# 4. 部署（需 Cloudflare 账号 + wrangler 登录）
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
extension/            MV3 浏览器扩展：WXT + React 19 + Tailwind v4
  entrypoints/
    content.ts        X DOM 的被动观察 + 气泡 UI + 一键拉黑
    background.ts     全部 fetch / GitHub OAuth / 白名单同步发生在这
    popup/ options/   React 弹窗 + 设置页
  lib/                cache / blocklist / whitelist-cache / detect / stats
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

**v0.3.0**（最新，2026-05-26）
- **身份解析硬化**：拦截 X 自家 `/i/api/graphql/*` 拿真 `rest_id`；JSON-LD / follow-button `data-testid` / React fiber 多源交叉校验；`rest_id ≠ id_str` 或 avatar-id 撞 uid 直接丢弃
- **viewer-scoped 过滤**：自己 / 已关注 / 已 mute / 已拉黑的号一律绕过，扩展端 + 服务端双层短路
- **公榜命中自动拉黑**（默认关）：开启后扫到已确认的垃圾号自动拉黑，无需点击；同时覆盖本地缓存确认过的号
- **UI 重写**：浅色主题、每行可勾选的批量拉黑、异步上报状态机；防 prompt-injection 的 `escHtml` 加固
- 管理面板左上角换成小蓝吉祥物

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

- **AI 永远不能自动公开。** 公榜入榜必须满足两条：AI 置信度 ≥ 0.9（仅限 spam / porn_bot 标签）+ ≥3 个注册 90 天以上的 GitHub 账号独立举报。任何一条不满足都只进人工队列。
- **审核范围严格限定** 商业 spam 和色情广告 bot。**永远不判断观点、立场、政治、身份。**
- **零 PII**：库里只存 X 公开数字 ID 和 GitHub reporter fingerprint（`gh:<numeric_id>`），不存任何邮箱、姓名、设备指纹、IP。
- **所有维护者动作都进 `review_log`**：拉黑 / 驳回 / 移除 / 加白 / 移白，全部留痕，可在 /admin 审计日志 tab 翻。
- **申诉**：在 GitHub 上[新开 issue](https://github.com/foru17/make-x-great-again/issues/new) 即可，附带 X handle + 你的理由。维护者会复核，没有承诺 SLA，通常一两天内回应。
- **维护者凭据永不进消费端构建**：审核台的 `ADMIN_TOKEN` 只在 maintainer 浏览器 localStorage，不出现在公开扩展包里。
- **LLM 供应商坐标永不进仓库**：URL + model + key 全部是 Worker secrets。
- 协议是 [AGPL-3.0](./LICENSE)，防止有人闭源套壳商用化。

安全问题请走 [SECURITY.md](./SECURITY.md) 的非公开通道，不要开公开 issue。

## 技术 stack

| 层 | 选型 | 备注 |
|---|---|---|
| 扩展 | WXT 0.20 · React 19 · Tailwind v4 · Shadow DOM | content-script 用 Shadow DOM 隔离样式，不污染 X |
| 边缘 | Cloudflare Worker · Hono · D1 SQLite | 单 region，custom domain `x.zuoluo.tv` |
| LLM | 任何 OpenAI 兼容 `/chat/completions` | 仅靠 system prompt 约束，不微调 |
| 身份 | GitHub Device Flow OAuth | 无 client secret，无回调地址 |
| 同步 | Workers Cron `0 */6 * * *` + chrome.alarms | 维护者列表 6h 周期增量推到扩展 + 镜像仓库 |

更细的架构与决策记录在 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

## 贡献

欢迎 PR、issue、申诉。请先翻一下 [CONTRIBUTING.md](./CONTRIBUTING.md) 和 [GOVERNANCE.md](./GOVERNANCE.md)。
如果你想贡献新的 Pillar（02–05 任意一个）的设计或代码，先开 issue 聊一下方向，避免重复造轮子。

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
