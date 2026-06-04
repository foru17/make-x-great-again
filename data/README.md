# MXGA · 公开数据集

> 这个目录是 MXGA 服务端**自动生成**的公开数据快照。
> 通过 Cloudflare Worker 的定时任务（每 6 小时）从 D1 数据库导出 →
> 用 GitHub Contents API 写入这里。git history 即审计日志。

完整治理规则：[GOVERNANCE.md](../GOVERNANCE.md) · 隐私承诺：[docs/PRIVACY.md](../docs/PRIVACY.md)

---

## 📁 文件清单

| 路径 | 内容 | 包含字段 |
|---|---|---|
| `whitelist/v1.json` | 维护者人工确认安全的账号 | handle / X 数字 ID / 最近更新时间 |
| `blacklist/v1.json` | 维护者人工确认公开的垃圾账号 | handle / X 数字 ID / verdict / 置信度 / AI 理由 / 触发文本 / 独立举报人数 / 公开时间 |

---

## 🧬 JSON Schema (v1)

### whitelist/v1.json

```json
{
  "schema": 1,
  "generatedAt": 1779687500000,
  "count": 5,
  "list": [
    {
      "handle": "hylarucoder",
      "x_user_id": "1725593465",
      "last_scored": 1779677512030
    }
  ]
}
```

### blacklist/v1.json

```json
{
  "schema": 1,
  "generatedAt": 1779687500000,
  "count": 108,
  "list": [
    {
      "handle": "hardway14309",
      "x_user_id": "2058678312587993088",
      "verdict_label": "porn_bot",
      "confidence": 0.97,
      "reasons": [
        "短回复+@mention 导流模板",
        "displayName 含「真实约见」",
        "无原创推文"
      ],
      "evidence_text": "真实约见附近好友匹配主页进群 @xxx 🍄",
      "reporters": 4,
      "published_at": 1779681234000
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 含义 |
|---|---|---|
| `schema` | int | 数据 schema 版本号。未来字段增删会 bump 这里。 |
| `generatedAt` | ms 时间戳 | 这份快照生成时间。每 6 小时一次。 |
| `count` | int | `list` 数组的长度。 |
| `handle` | string | X 平台的 handle（公开值）。 |
| `x_user_id` | string \| null | X 平台的数字 ID（公开但不可变；如已知则强烈推荐用此匹配，因为 handle 可改）。 |
| `verdict_label` | enum | `spam` / `porn_bot` / `likely_spam` / `uncertain` / `legit`。 |
| `confidence` | 0–1 | AI 判定置信度。 |
| `reasons` | string[] | AI 给出的 1–6 条短理由（来源：LLM 输出）。 |
| `evidence_text` | string \| null | **触发该判定的具体公开 X 文本**（≤240 字）。是这条回复 / 第一条 recent tweet / bio 的择优。空字段意味着抓取时上下文不够。 |
| `reporters` | int | 独立举报过此账号的注册满 90 天的 GitHub 用户数。 |
| `published_at` | ms 时间戳 | 被维护者公开确认的时间。 |
| `last_scored` | ms 时间戳 | 数据最近一次被服务端写入的时间。 |

---

## 🔄 更新机制

```
┌──────────────────────────┐         ┌──────────────────────┐
│ Cloudflare Worker (cron) │ 每 6h → │ D1 SQLite (xss-db)   │
└──────────────────────────┘         └──────────────────────┘
              │
              │ 拉数据 + diff 比对
              ▼
┌──────────────────────────────────────────────┐
│ 内容未变？ → 跳过（不污染 git history）         │
│ 内容变了？ → PUT data/*/v1.json (Contents API)│
│                                              │
│ commit message: data(blacklist): sync ·       │
│                  113 total · 2026-05-25      │
└──────────────────────────────────────────────┘
```

- **触发**：Workers Cron `0 */6 * * *`（UTC），可通过 admin endpoint `POST /v1/admin/sync-mirror` 手动提前
- **diff-aware**：内容哈希不变就完全不写，避免 24h × 4 次 = 96 次/月 的空提交
- **commit 消息**：`data(blacklist): sync · N total · YYYY-MM-DD`，git log 可读
- **认证**：fine-grained PAT，scope 只有 `Contents: Read and write`，仅限本仓库

---

## 🆕 公开名单（Public List）—— 分片 + Bloom 索引

从 2026-06 起，MXGA 同时发布一种 **CDN 友好**的公开名单格式，位于 `public-list/data/`：

| 文件 | 内容 | 体积目标 |
|---|---|---|
| `meta.json` | 版本、时间戳、总条数、source commit | < 1 KB |
| `index.json` | Bloom 过滤器成员索引 | < 50 KB（10k 条目约 12 KB） |
| `shards/00.json` … `ff.json` | 按 userId 哈希分桶的条目 | 每 shard 数十 KB |

### 为什么分片？

- 浏览器扩展只需拉取 **一个 shard**（256 分之一），避免全量下载。
- Bloom 索引在客户端实现 **零网络泄露的预检**：先查本地 bloom，命中再拉对应 shard。
- 每个 shard 是独立 JSON，CDN 缓存友好；jsDelivr / raw GitHub 均可直接消费。

### 消费方式

```bash
# 1. 拉 meta（最新版本号）
curl https://cdn.jsdelivr.net/gh/foru17/make-x-great-again@latest/public-list/data/meta.json

# 2. 拉 bloom 索引（客户端预检）
curl https://cdn.jsdelivr.net/gh/foru17/make-x-great-again@latest/public-list/data/index.json

# 3. 按需拉 shard（FNV-1a hash bucket）
BUCKET=$(node -e "let h=2166136261;for(const c of '123456789'){h^=c.charCodeAt(0);h+=(h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)}console.log((Math.abs(h|0)%256).toString(16).padStart(2,'0'))")
curl "https://cdn.jsdelivr.net/gh/foru17/make-x-great-again@latest/public-list/data/shards/${BUCKET}.json"
```

完整生成逻辑见 [`src/public-list/`](../src/public-list/)，CI 发布见
[`.github/workflows/publish-public-list.yml`](../.github/workflows/publish-public-list.yml)。

---

## ✅ 怎么程序化使用这份数据

### 拉取最新快照（旧版 v1 全量 JSON）

```bash
# 最稳的入口（GitHub raw）
curl https://raw.githubusercontent.com/foru17/make-x-great-again/main/data/blacklist/v1.json
curl https://raw.githubusercontent.com/foru17/make-x-great-again/main/data/whitelist/v1.json
```

### 或者用我们的 Worker（带 CDN 缓存）

```bash
# 公开端点，无需鉴权
curl https://x.zuoluo.tv/v1/list?limit=100
curl https://x.zuoluo.tv/v1/whitelist?limit=2000
```

差别：仓库里的快照是 **6 小时一次**的全量；Worker 端点是 **实时**且支持游标分页。审计选仓库；做实时拉黑工具选 Worker。

---

## 🧹 数据删除 / 修改流程

1. **某账号被误判**：开 [GitHub issue](https://github.com/foru17/make-x-great-again/issues/new) 附 handle 和申诉理由
2. 维护者复核 → 在 `/admin` 把该账号 status 改为 `rejected` 或 `whitelisted`
3. **下个 6 小时周期**，该账号从这两个 JSON 自动消失（黑名单变小）/ 移到白名单
4. **下个公开名单发布周期**，该账号从 `public-list/` 中消失，git tag diff 即为审计 trail
5. 历史 commit 仍然存在 → 任何人可以从 git log 复原"该账号曾经在公榜上"的事实，但**当前快照**反映最新决定

这就是用 git history 作为审计 trail 的核心价值：**不可篡改 + 时间序列完整**。

---

## ⚖️ 这份数据是 PII 吗？

**不是**。所有字段都是 X 平台上**公开广播**的内容（账号 ID / handle / 公开推文文本）。
我们**没有**收集任何用户的：邮箱 / 密码 / IP / 设备指纹 / 私信 / 浏览历史。

详细分析见 [docs/PRIVACY.md](../docs/PRIVACY.md)。
