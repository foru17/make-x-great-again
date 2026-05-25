<div align="center">

# Make X Great Again 🛡️

### 让 X 重新能用 · 一个被动的 X 旁路扩展

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](./LICENSE)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](#状态--路线图)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)
[![Live](https://img.shields.io/badge/live-x.zuoluo.tv-38bdf8.svg)](https://x.zuoluo.tv)

🌐 **Live**：[x.zuoluo.tv](https://x.zuoluo.tv) · 📋 [公开 spam 榜单](https://x.zuoluo.tv/list) · 📦 [安装扩展](https://github.com/foru17/make-x-great-again/releases/latest)

[做什么](#做什么) · [5 个支柱](#5-个支柱) · [怎么用](#怎么用) · [状态--路线图](#状态--路线图) · [架构](./docs/ARCHITECTURE.md) · [治理](./docs/GOVERNANCE.md) · [贡献](./CONTRIBUTING.md)

</div>

---

## 做什么

X(Twitter) 现在的问题不止于"色情/广告机器人刷评论"——它整体在变得不好用：

- 评论区被 bot 淹没；正常讨论很难被看到
- 想关注一个新 KOL，搞不清是真号还是营销号
- 想知道某个账号历史上谈过什么、最热的几条是什么——只能手动翻
- 算法决定了你看到谁，而不是反过来

**Make X Great Again (MXGA)** 是一个**被动的、嵌进 X 浏览体验里的旁路扩展**。AI 在你正常刷 X 时静默工作，做下面 5 件事（部分已上线，其它在路上）。

完全开源（AGPL-3.0），不收集任何用户数据；公开公榜数据仅含 X 公开数字 ID。

## 5 个支柱

| # | 支柱 | 状态 | 一句话 |
|---|---|---|---|
| **01** | **Spam 净化** | ✅ Live | 评论区色情/广告 bot 被动检测 + 一键真·拉黑（驱动 X 自身屏蔽接口） + 公开共建黑名单 |
| **02** | **KOL 信号分** | 🚧 Next | 鼠标停 @handle → 浮卡：账号年龄、原创比、主题集中度、互动质量 |
| **03** | **KOL 历史摘要** | 🚧 Soon | 进 profile 页 → 自动侧栏：「主要谈 A/B/C」「本月最热 5 条」「最佳互动时段」 |
| **04** | **社交图谱提示** | 🚧 Soon | 看推文时显示「被你关注的 3 个 KOL 转过 / 评论过」，让信号穿过算法噪声 |
| **05** | **个人数据导出** | 🚧 Soon | 一键导出你的关注 / 收藏 / 推文为 JSON / Markdown，备份或迁出 |

## 怎么用

### 普通用户（Chrome）

```bash
# 即将上 Chrome Web Store；当前需要开发者模式手动加载：
1. 从 https://github.com/foru17/make-x-great-again/releases/latest 下载 .zip
2. 打开 chrome://extensions，开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选解压后的目录
4. 访问 x.com 即可（扩展被动工作）
```

完整门户：[https://x.zuoluo.tv](https://x.zuoluo.tv)（含治理铁律、实时公榜数据）

### 开发者 / 本地

```bash
cp .env.example .env       # OpenAI-compatible LLM endpoint
pnpm install
pnpm typecheck && pnpm test && pnpm lint

# 扩展
cd extension && npx wxt build
# → 加载 extension/.output/chrome-mv3

# 边缘服务
cd services/edge && npx wrangler dev
# 部署：见 services/edge/DEPLOY.md
```

## 状态 / 路线图

- ✅ **Wave 1-6**：MVP → WXT 重建 → Cloudflare 部署 → /admin 审核台 → 公开 landing + /list → base-ui 视觉
- ✅ **Wave 7**：迁出公司 GitHub，启用个人域名 `x.zuoluo.tv`
- ✅ **Wave 8**（本次）：rebrand 为 Make X Great Again，重新定位为 X 社交辅助平台
- 🚧 **Wave 9**：Pillar 02 KOL 信号分 mini badge
- 🚧 **Wave 10**：Pillar 03 KOL profile 摘要侧栏
- 🚧 **Wave 11**：Pillar 04 社交图谱碎片
- 🚧 **Wave 12**：Pillar 05 用户数据导出

## 仓库结构

```
src/                  本地 LLM 分类器 + 私有策展库（T3 spike）
extension/            MV3 浏览器扩展（WXT + React 19 + Tailwind v4）
services/edge/        Cloudflare Worker + D1 + SSR pages (/、/list、/admin)
docs/
  ARCHITECTURE.md     系统设计
  GOVERNANCE.md       治理红线
  PRIVACY.md          隐私承诺
  STATUS.md           as-built audit
```

## 治理与隐私（重要）

这是一份对真实账号的公开指控列表。请先读 [docs/GOVERNANCE.md](./docs/GOVERNANCE.md)：

- 置信度阈值 + 公开前人工/社区双重审核
- 申诉/移除通道（GitHub issue + 48h 内复核）
- 除公开数字 ID 外不存任何 PII
- 范围严格限定 spam / 色情广告 bot，**不碰观点立场**
- 透明版本化变更，所有决策写入 review_log

## 贡献

欢迎 PR。请先读 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [docs/GOVERNANCE.md](./docs/GOVERNANCE.md)。
安全问题请走 [SECURITY.md](./SECURITY.md)，不要开公开 issue。

## License

[AGPL-3.0](./LICENSE) — 公益开源，防止闭源商用派生。
