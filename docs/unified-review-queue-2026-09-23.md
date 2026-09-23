# 统一待审工作台 · 2026-09-23

实现基准：线上生产代码 `92a9dc1`，隔离分支 `codex/unified-review-queue-2026-09-23`。当前为本地已验证版本，未部署、未 push、未修改生产数据或配置。

## 处理流程

旧流程将 `auto_pending_review` 经 AI 初审改为 `agent_pending` / `agent_blacklist` / `agent_whitelist`，主待审列表和计数只看第一个状态。因此主待审减少不代表人工积压减少；另外三个列表也没有原待审完整的筛选与批量操作。

新流程：入队 → AI 初审（仍在统一待审）→ 最终裁决 → 离开待审。四种未终审状态均纳入列表和顶部总数，按 handle 去重；无需迁移存量数据。每行显示未初审、AI 待定、AI 建议拉黑或 AI 建议放行，AI 依据、把握、时间与模型可展开查看；原初筛判定单独标明。

| 存储状态 | 待审中的标记 | 是否计入待审 |
| --- | --- | --- |
| auto_pending_review | 未初审 | 是 |
| agent_pending | AI 待定 | 是 |
| agent_blacklist | AI 建议拉黑 | 是 |
| agent_whitelist | AI 建议放行 | 是 |
| human_confirmed / whitelisted / rejected / removed | 已终审 | 否 |

AI 已初审是后三种状态的组合筛选。正常 AI 初审不会降低统一待审总数；重新初审清除旧 AI 注释并回到未初审，总数仍不减少。最终裁决保留 AI 注释并记录人工操作来源，已被他人终审的记录会跳过。

本次解决展示口径和人工操作能力，不减少模型产生待定结果的比例，也不更改 AI runner、模型、自动发布开关或现有关键字规则自动发布路径。已有规则或其他终审入口仍可使总数减少。

## 与生产基准的功能对照

| 生产能力/问题 | 新版 |
| --- | --- |
| 普通待审 + 三个独立 AI 标签页 | 合并为一个待审模块，以初审状态筛选 |
| 普通待审搜索、维度过滤、排序、分页 | 所有未终审记录共用；可与初审状态组合 |
| AI 列表只能继续加载，无完整筛选 | 使用统一分页和准确命中数 |
| 单条拉黑、白名单、驳回、移除 | 保留并覆盖全部四类记录 |
| 已选批量与按筛选批量 | 统一支持拉黑、归类、白名单、驳回、移除 |
| AI 退回重新审查 | 保留为单条/已选“重新初审” |
| 找同类 | 保留在“更多”菜单中的 Handle、UID、显示名入口 |
| 旧 AI 标签页链接 | 映射到统一待审相应筛选，支持同页跳转 |
| 切筛选后可能残留选择 | 清空选择，加载失败不展示可操作旧列表 |
| 最后一页处理完可能空页 | 重新计数并返回有效页 |

按筛选批量包括未加载分页，确认框显示初审状态、命中数和单次 2,000 条上限；按已选批量只作用于选中记录。其余黑/白名单、申请、规则、日志入口保留。存量统计字段 `pending_raw` 保持兼容，主待审统计 `queue` 改为四种状态的去重并集。

## 验收证据

VERDICT: PASS（本地实现）。160/160 Edge 测试，其中 8 项使用真实 SQLite 执行 Worker 路由；前后端 TypeScript、Vite 构建、修改 UI/shared 文件 lint 通过；workerd 六条运行时路由检查通过。浏览器 30 项真实操作断言通过（最多 220 次命令，实际 166 次），包括分阶段筛选、组合搜索、排序、分页、批量终审、重新初审、不误操作已终审数据及旧链接兼容。

截图目录：`.ui-acceptance/2026-09-23-unified/`（本地忽略，不提交生产账号截图）。

- 生产只读基准：`baseline-queue-desktop.png`、`baseline-queue-mobile.png`、`baseline-queue-dark.png`、`baseline-agent-dark.png`。
- 新版桌面/移动/暗色：`queue-desktop.png`、`queue-mobile.png`、`queue-dark.png`。
- 确认弹窗：`queue-confirm-desktop.png`、`queue-confirm-mobile.png`；主题切换：`queue-dark-toggle.png`。
- 日志：`edge-tests.log`、`runtime.log`、`lint.log`、`browser-tests.log`、`behavior.json`。

已目视核对最终截图与生产功能基准；390×844 下无横向溢出、未禁缩放、确认弹窗位于视口内；1440×900 下文字、按钮和初审依据清楚；暗色文字对比度数值见配套验证 JSON。新版截图中的 112 个账号全部为模拟数据，实际请求走本地 Worker + SQLite。未在生产执行写操作或批量测试，未进行生产规模负载测试。

仓库全量 lint 存在生产基准已有的非空断言问题；本次修改的 UI/shared 文件 lint 均通过。

## 本地复现

使用支持 `node:sqlite` 的 Node（本次 Node 26.7.0），安装仓库及 edge 依赖后：

```sh
npm --prefix services/edge run build:app
./node_modules/.bin/tsx scripts/ui-acceptance/unified-review/server.ts
# 另一个终端，需要安装 agent-browser：
node scripts/ui-acceptance/unified-review/check.mjs
```

预览：<http://127.0.0.1:4318/admin>。服务仅监听回环地址，内存数据库、无生产凭据，最多处理 600 次请求；达到上限重启即可。测试脚本重置的也是本地模拟数据。测试与截图摘要保存在 `docs/unified-review-queue-verification-2026-09-23.json`。
