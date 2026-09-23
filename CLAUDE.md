# x-spam-sentinel (MXGA)

X(Twitter) 反垃圾/色情机器人浏览器扩展（`extension/`，WXT+MV3）+ Cloudflare Workers 边缘服务（`services/edge/`）。

## UI 基准

- **扩展管理面板（options 页）**：基准 = `main` 分支构建 + `.ui-acceptance/2026-07-23/` 截图集（处理记录/设置/概览/检测缓存 × 桌面/移动/暗色/亮色）。改动 options 页后跑 `/ui-acceptance` 并与该截图集 diff。
- **admin console（/admin，services/edge SPA）**：基准 = `.ui-acceptance/2026-07-24-admin-category/` 截图集（待审队列/黑名单 × 桌面/移动/暗色/亮色）。验收方法：`npm run build:app` 后用 stub API 伺服（scratchpad ui-acc/stub-server.mjs 模式：静态伺服 static/app + 假 /v1/admin/* 种子数据 + POST 落 requests.log 做行为断言），agent-browser headless 截图。已知既有问题：390px 下 tab 列第三行与页面标题轻微重叠（待修）。
- 验收环境：`.ui-acceptance/` 内截图由 chrome-devtools 对本地构建 + chrome API stub（种子数据）截取；stub 方法见 ui-acceptance 运行记录（scratchpad `ui-acc/__stub.js` 模式：拷贝 `.output/chrome-mv3`、注入 `__stub.js`、http.server 伺服）。
- 暗色为默认主题（`prefers-color-scheme` + `html[data-theme]` 覆盖），任何 options/popup 改动必须双主题各验一遍。

- **统一待审基准（2026-09-24 已部署）**：以生产 `92a9dc1` 和 `.ui-acceptance/2026-09-23-unified/baseline-*` 对照，候选截图 `queue-{desktop,mobile,dark}.png`；复现脚本 `scripts/ui-acceptance/unified-review/`（真实 Worker + 本地 SQLite，模拟数据）。验收报告 `docs/unified-review-queue-2026-09-23.md`，生产发布证据 `docs/unified-review-release-2026-09-24.md`。

## 术语口径（用户可见文案）

- 「自动处理策略」：设置页分类别动作配置的统一名称（内部代码/注释仍可叫 per-category policy / 分级策略，但用户可见文案统一用前者）。
- 处理记录的「来源」列回答"这条处理谁触发的"：手动处理 / 自动处理 / 一键处理（legacy）/ 名单命中（legacy）/ 缓存命中（legacy）。
- 不用黑话：PII → 个人信息；LLM → AI 判定；「现场」→「查看推文」。
- 处理动作四档统一叫法（手动/自动两处一致）：仅标记 / 本地隐藏 / X 静音 / X 拉黑；不要再造「自动隐藏/自动拉黑」这类前缀变体。「自动收录」= AI/规则自动上榜的公榜条目 + 本地官方规则命中（都受 autoTierMode 门禁约束；本地规则命中另外在任何模式下都封顶为本地隐藏，2026-09-06 起）。本地白名单（用户自己的名单）优先级高于一切，含公榜命中。
