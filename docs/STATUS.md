# Project status

Public snapshot of what exists today, what it depends on, and what still
needs hardening.

## 1. One-liner

AI-driven, public-good X(Twitter) anti-spam: a passive consumer **browser
extension** + a deployed **Cloudflare edge service** (curation DB + public
list + gated reporting + standalone admin console), with a **local dev
toolchain** for the classifier.

## 2. Architecture

```
 ┌── Consumer extension (WXT/MV3, public) ──────────────┐
 │ passive scan X DOM → fiber bio → local heuristic →   │
 │ L2 cache / blocklist short-circuit → (miss) edge     │
 │ /v1/classify → inline badge + bubble + 1-click block │
 │ (DOM-drives X's own block) + durable block queue +   │
 │ mgmt panel (overview/blocklist/cache/settings) +     │
 │ GitHub Device-Flow login                             │
 └──────────────┬───────────────────────────────────────┘
        /v1/check (anon) · /v1/classify·report·confirm (gh)
                ▼
 ┌── Cloudflare Worker (Hono) — DEPLOYED ───────────────┐
 │ x.zuoluo.tv  (custom domain; *.workers.dev fallback) │
 │ D1 (accounts/reports/review_log) · LLM classify ·    │
 │ report→AI+≥3 gh reporters→auto / else queue ·        │
 │ /admin standalone console (ADMIN_TOKEN)              │
 └──────────────────────────────────────────────────────┘
 ┌── Local dev toolchain (src/, not user-facing) ───────┐
 │ tsx CLI classify + node:test fixtures + a localhost  │
 │ /classify shim (pre-Cloudflare; now superseded)      │
 └──────────────────────────────────────────────────────┘
```

## 3. Components

| 组件 | 作用 | 栈 | 状态 |
|---|---|---|---|
| `extension/` | 消费端 MV3 扩展（检测/拉黑/面板/登录） | WXT, React, Shadow DOM | 可用 |
| `services/edge/` | 边缘 API + D1 + /admin | Hono, Zod, Wrangler | **已部署**线上 |
| `src/` | 本地分类器/CLI/旧 localhost 服务 | tsx, Zod, node:test | 早期，部分被 edge 取代 |
| `docs/` | ARCHITECTURE/UX/FLOW/PRODUCT/MODERATION/MVP/RUNNING/STATUS | — | 较全 |

## 4. 依赖

**技术栈**：WXT 0.20 · Hono 4 · Zod 3 · TypeScript 5 · tsx · Biome ·
Wrangler 4 · @cloudflare/workers-types · @types/chrome。

**外部服务依赖（关键，含风险）**：

| 依赖 | 用途 | 风险 |
|---|---|---|
| **LLM 推理（外部 OpenAI 兼容供应商）** | 服务端分类 | 第三方、单点、经常性成本；`LLM_API_BASE` / `LLM_API_MODEL` / `LLM_API_KEY` 全部 Worker secret，**不入仓** |
| **Cloudflare**（Workers + D1） | 边缘服务 / 数据库 | 平台依赖，需要备份和交接预案 |
| **GitHub OAuth App** | 上报 / 分类鉴权 | client_id 公开常量；REQUIRE_AUTH 开启后强依赖 |
| **X 内部接口/DOM** | 真·拉黑 + 页面解析 | `blocks/create.json`+不可伪造 transaction-id→只能 DOM 驱动；X 改版即坏，**最脆环节** |
| **unavatar.io** | 审核台老数据头像兜底 | 第三方，仅维护者侧、非关键 |

## 5. 数据与存储

- **D1 `xss-db`**（线上，真源）：`accounts`(x_user_id/handle/avatar_url/
  verdict/confidence/status/source/…)、`reports`(reporter_fp 唯一索引去重)、
  `review_log`、`publications`。状态机：auto_pending_review → human_confirmed
  / rejected / removed。`/v1/check` 只返回 human_confirmed。
- **chrome.storage.local**：`xss:v1:*` 账号判定缓存、`xss:blocklist:v2`
  拉黑记录、`xss:stats` 统计、`xss:blockQueue` 拉黑队列、`xss:ghToken/
  ghLogin/ghClientId`、`xss:edgeBase`。仅本机、无 PII。

## 6. 部署/运行现状

- Worker 已部署，对外通过自定义域 `https://x.zuoluo.tv`；
  历史 URL `*.workers.dev` 仍可用作 fallback。
  Secrets：`LLM_API_BASE` / `LLM_API_MODEL` / `LLM_API_KEY` / `ADMIN_TOKEN`。
- GitHub 登录用于上报和防滥用计数；上线前后需要持续确认鉴权和限流配置。
- 审核台：`/admin`（ADMIN_TOKEN 进入）。
- 扩展主分发渠道：[Chrome Web Store](https://chromewebstore.google.com/detail/make-x-great-again/aeoldnecphbkkckeedfgfcdcekkljdea)；GitHub Release zip 作为非-Chrome 浏览器和开发版的备用通道。

## 7. 安全/治理姿态

信任分层（匿名只读 / GitHub 上报 / 维护者审核）；AI 单独永不自动公开，
人工信号=≥3 独立 GitHub 上报人或管理员；除公开数字 ID 外无 PII。相关红线已在
[GOVERNANCE.md](../GOVERNANCE.md) 和 [MODERATION.md](./MODERATION.md) 成文。

## 8. 已知缺口 / 技术债 / 风险

1. **数据契约仍需收敛** —— D1 schema、公开快照字段、申诉流程需要保持一致。
2. **Bloom-first 模型未落地** —— 仍走 `/v1/check` 逐 id 查；
   [ARCHITECTURE.md](./ARCHITECTURE.md) 设计的低成本/可缓存模型尚未落地。
3. **分类器逻辑双份**：`src/llm.ts` 与 `services/edge` 各一套 SYSTEM 提示，
   易漂移（已发生过需两处同改）。
4. **无 CI / 扩展与 edge 无测试**：只有 `src/` 早期 node:test。
5. **X DOM/接口脆弱**：选择器与拉黑流程随 X 改版会坏，需持续维护。
6. **管理端鉴权较轻**：当前以维护者密钥保护，后续可升级到多人身份和轮换机制。

## 9. 后续杠杆

收敛数据契约（含统一 schema + 消除分类器双份）→ 发布 Bloom/快照 artifact →
补齐 CI/测试基线 → 强化管理端鉴权与运维交接。
