# 2026-09-04 申诉处理与最新上报审计

## 范围与取证

- 本轮目标：处理当前 GitHub 申诉，再检查新上报是否仍存在大量误伤。没有授权修改分类算法、批量清空生产数据或恢复 AI 自动发布。
- 2026-09-04 00:32 UTC，GitHub 当前未关闭申诉共 11 个（#363–#373），均无回复。
- 同时查询生产黑名单、待审队列和完整公开白名单：11 个 handle 在三个分区中均无命中。接口读取最多 30 次，本次使用 25 次；查询结果按完整 handle 二次精确匹配。
- 通过 Wrangler 对生产 `accounts` 执行一次限定 11 个 handle、最多 33 行的只读查询，返回 14 行；结果 `success=true, rows_read=50, rows_written=0, changed_db=false`。以下结论使用原始证据文本人工审阅，不直接采纳模型理由。
- 当前 X 页面直接访问返回 403，未声称已经浏览这些账号的实时完整主页。搜索索引和 GitHub 资料只作为辅助背景，不作为实时身份或整个账号行为的证明。
- Cloudflare 账单页实查：已有一条 $10 预算提醒，1 位接收者。截图：`/tmp/xss-budget-alert-2026-09-04.png`。没有创建资源或变更计费配置。

## 逐账号证据与拟处置

所有下列账号在本轮处置前均不在当前云端黑名单、待审或白名单。

| Issue | Handle | 历史状态 / 标签 | 复核证据与边界 | 拟处置 |
|---|---|---|---|---|
| [#363](https://github.com/foru17/make-x-great-again/issues/363) | yyeonmihy | rejected / legit 0.70 | 留存的是普通短句，模型也未声称存在广告；尚不能确认申诉截图实际来源 | 白名单保护，明确不把 legit 当垃圾判定 |
| [#364](https://github.com/foru17/make-x-great-again/issues/364) | Felix51829805 | auto_legit / legit 0.90 | 留存的是 iPad 个人使用体验，没有商业导流；数据库仅有 handle 身份，申诉给出的数字 UID 尚未独立核实 | 只保护现有 handle 身份，不写入未验证 UID |
| [#365](https://github.com/foru17/make-x-great-again/issues/365) | ACai_sec | rejected / spam 0.90 | 单次文章分享被推断为重复/跑题推广，留存证据不能证明该推断；[X 索引资料](https://x.com/ACai_sec/with_replies)显示安全研究内容 | 撤销该历史垃圾判断并白名单保护 |
| [#366](https://github.com/foru17/make-x-great-again/issues/366) | Flowers_hurt | rejected / uncertain 0.40；另有 auto_legit | 仅有一句口语表达，没有广告证据；同 handle 有两个不同非空 UID，不能盲目合并 | 告知现状，追问原帖/截图及版本；保留 issue |
| [#367](https://github.com/foru17/make-x-great-again/issues/367) | _marulka | rejected / uncertain 0.40 | 原判定没有帖子、简介或触发评论，明确证据不足；外部作品索引与绘画活动相符，但没有实时主页核验 | 不把资料缺失当垃圾，白名单保护 |
| [#368](https://github.com/foru17/make-x-great-again/issues/368) | LuBtc888 | removed / spam 0.95；另有已移除伪 UID | 当前已移出；[旧申诉 #138](https://github.com/foru17/make-x-great-again/issues/138)曾保留持续宣发及开户导流证据。粉丝多不构成豁免，旧证据也不能自动证明当前仍应列入 | 不重加黑名单、不直接白名单；请求当前命中证据 |
| [#369](https://github.com/foru17/make-x-great-again/issues/369) | kevinhung2 | rejected / spam 0.90 | 留存为观点表达和一条 Facebook 链接，不能证明重复商业推广；政治观点不属于治理范围 | 撤销该历史垃圾判断并白名单保护 |
| [#370](https://github.com/foru17/make-x-great-again/issues/370) | btcmos | removed / porn_bot 0.92；另有 auto_legit | 成人作品讨论不等于色情广告；留存没有付费/联系方式/广告链接，但两个非空 UID 冲突，身份需核验 | 告知证据不足以支持色情广告标签，追问原帖/截图；保留 issue |
| [#371](https://github.com/foru17/make-x-great-again/issues/371) | Pluvio9yte | rejected / spam 0.92 | 分享 Codex 清理电脑空间的体验；理由直接把 triggeringComment 与 recentTweets 相同误当成重复发布。其 [GitHub 资料](https://github.com/Pluviobyte)链接同一 X handle 并公开技术项目 | 撤销该历史垃圾判断，保护现有单一身份 |
| [#372](https://github.com/foru17/make-x-great-again/issues/372) | wallen97754394 | removed / porn_bot 0.92 | 唯一留存文本为提及 `@justinsuntron`，没有色情、招揽或广告证据；模型把普通 mention、空简介和用户名外观当色情 bot 依据 | 撤销该历史色情广告判断并白名单保护 |
| [#373](https://github.com/foru17/make-x-great-again/issues/373) | fly51fly | rejected / legit 0.70 | 留存为 AI 论文标题与 arXiv 链接，模型也明确判断技术研究分享、没有推广；[X 索引资料](https://x.com/fly51fly/with_replies)相符 | 白名单保护；不称其原记录为 spam |

## 尚未能证明的事项

- 11 个申诉不是随机样本，不能直接计算全站真实误伤率。
- 云端移出不等于浏览器旧缓存已经撤销；本轮尚未验证各申诉人的实际客户端。
- `GET /v1/check` 只接受数字 `ids`，且仅查 `published_tier=human`。此前 2026-09-01 诊断中用 `?handle=...` 返回空命中排除所有公开名单的证据不成立；本轮使用管理分区和生产库查询，不复用该错误推断。
- 上表保留处置前证据。已执行动作与客户端未验证事项以下文为准。

## 白名单执行记录

2026-09-04 00:37 UTC，使用现有管理接口，逐项加入并回读 8 个账号；18 次请求，硬上限 20。公开白名单由 2,338 增至 2,346；将原有每条记录的 handle、UID、last_scored 与处置后集合逐条比较，2,338 条全部未变。

| Issue | 已保护身份 | review_log |
|---|---|---|
| #363 | yyeonmihy，handle-only | 740577 |
| #364 | felix51829805，handle-only；未采用未经核实的申诉 UID | 740578 |
| #365 | acai_sec，handle-only | 740579 |
| #367 | _marulka，handle-only | 740580 |
| #369 | kevinhung2，handle-only | 740581 |
| #371 | pluvio9yte，保留现有 UID 1667439202357899267 | 740582 |
| #372 | wallen97754394，handle-only | 740583 |
| #373 | fly51fly，handle-only | 740584 |

没有合并 #366、#370 的冲突身份，没有将 #368 重新列黑或加入白名单，没有修改其他既有白名单。

验证：生产审计只读查询返回上述 8 行，`rows_written=0`；白名单相关服务端测试 **26/26**，扩展完整白名单分页测试 **1/1**。这些测试证明身份隔离、幂等与名单分页行为，不代表每位申诉人的客户端已经刷新。

## GitHub 回帖结果

共 52 次 GitHub API 请求，硬上限 55；每条先确认没有新回复，回帖后逐条验证正文与状态，未重试写请求。

- 已关闭并加白名单：[363](https://github.com/foru17/make-x-great-again/issues/363#issuecomment-5533994808)、[364](https://github.com/foru17/make-x-great-again/issues/364#issuecomment-5533995547)、[365](https://github.com/foru17/make-x-great-again/issues/365#issuecomment-5533996404)、[367](https://github.com/foru17/make-x-great-again/issues/367#issuecomment-5533997867)、[369](https://github.com/foru17/make-x-great-again/issues/369#issuecomment-5533999316)、[371](https://github.com/foru17/make-x-great-again/issues/371#issuecomment-5534000778)、[372](https://github.com/foru17/make-x-great-again/issues/372#issuecomment-5534001604)、[373](https://github.com/foru17/make-x-great-again/issues/373#issuecomment-5534002425)。
- 保持打开并请求证据：[366](https://github.com/foru17/make-x-great-again/issues/366#issuecomment-5533997198)、[368](https://github.com/foru17/make-x-great-again/issues/368#issuecomment-5533998708)、[370](https://github.com/foru17/make-x-great-again/issues/370#issuecomment-5534000128)。等待的是申诉人补充原帖、来源截图、版本与时间，而不是把这些账号认定为垃圾。
- 回帖均明确区分“本次新增白名单”和“处置前就已移出”；说明实时主页核验限制、客户端刷新与既有 X 拉黑/静音不能自动撤销。不宣称浏览器旧标记已经消失。

## 最新上报：仍有大量低质量判定，但不能报一个虚假的“误伤率”

统计锚点 **2026-09-04 00:41:38 UTC / 08:41:38 UTC+8**；24 小时窗口起点为前一天同一时间。`scripts/diagnostics/latest-report-audit.mjs` 实跑 8 个固定只读查询，全部 `rows_written=0`；另做两次各 1 条的只读核验（补全 50 个样本显示名、核对公开发布来源）。各查询不是同一事务快照，持续流量可能使全量队列计数相差几条。原始查询没有调用 LLM 或生产 classify 接口。

| 口径 | 实测结果 |
|---|---|
| 当前待审快照 | 43,871 条记录、43,870 个不同 handle，约 4.39 万 |
| 近 24 小时收到的用户举报 | 86 条，86 个 handle，21 个举报身份；近 1 小时仅 1 条 |
| 近 72 小时收到的用户举报 | 208 条，206 个 handle，47 个举报身份 |
| 近 24 小时评分、目前仍待审 | 17,395 条，其中 auto_scan 17,348 条（99.73%） |
| 上述待审中的原始模型标签 | legit 8,546；uncertain 5,521；其余 3,328 |
| 上述非垃圾标签占比 | 14,067 / 17,395 = **80.87%**；这是排队噪声，不是误伤率 |
| 首次入库在近 24 小时、目前仍待审 | 15,237 条；不包含已进入其他审核状态的记录 |
| 最新连续 1,000 条待审 | legit 508、uncertain 337、spam 58、porn_bot 88、likely_spam 9 |
| 这 1,000 条的采样时间跨度 | 2026-09-03 20:03:25 至 2026-09-04 00:41:35 UTC |
| 这 1,000 条的资料缺失 | 918 条无粉丝数，881 条无注册时间/年龄，21 条无留存文本 |
| 近 24 小时公开黑名单新增 | 104 条直接规则 + 3 条规则提及关联；AI tier **0 条** |

因此，待审快速回填主要不是用户集中举报，而是自动扫描持续把普通/不确定内容送进队列。关闭 AI 自动发布只挡住公开名单写入，没有关闭在线标签展示。后台另有 60 次 `agent_blacklist` 审核日志，不等同于公开黑名单新增。

### 50 条最新垃圾标签样本

对同一锚点之前最新连续 50 条 spam / porn_bot / likely_spam 待审记录逐条审阅原文本、理由与显示名。以下 10 条的留存证据不能支撑其广告/色情理由，属于可复核的明显判定质量问题；**不将它们外推为全站 20% 误伤率，也不声称已验证这些账号的全部历史行为**。

| Handle | 留存文本（短摘录/概述） | 原标签 | 证据问题 |
|---|---|---|---|
| cmmm1244 | 我头晕得站都站不稳。 | porn_bot 0.92 | 普通身体感受被称为色情招揽，没有导流证据 |
| rongchunh2whj | 我还以为被封号了 | spam 0.90 | 普通回应被称为色情/垃圾放大器 |
| romanrichshing | 刚刚开始 | spam 0.92 | 一句短回复不足以证明重复导流 |
| yuzhiqiang1993 | 请更新 Antigravity IDE，谢谢 | spam 0.92 | 产品更新请求被推断为反复刷广告 |
| jy85234509 | 為啥?拍片嗎? | porn_bot 0.92 | “拍片”被直接解释为色情广告 |
| qiyueqiriqing77 | 杨幂？ | porn_bot 0.92 | 单个公众人物姓名被称为色情广告模板 |
| slhiyu247185 | 36岁！！！ | porn_bot 0.92 | 年龄感叹被当成招嫖模板 |
| travelallchina | @getxbot | porn_bot 0.92 | 普通单独 mention 被推断为色情招揽 |
| fressshhh2 | 政治性粗口 | porn_bot 0.92 | 粗口/政治立场不等于色情广告 |
| bmzxdchgqz | 对公共资金使用的讽刺 | likely_spam 0.75 | 政治讽刺和重复输入字段被当作刷广告证据 |

样本里同时有明确色情诱饵和向其他账号/平台导流的内容，不能把这 50 条一并判定为正常。本轮只是审计，未批量变更这些新样本的审核状态。

### 20 条最新用户举报样本

逐条查看最新 20 条举报的原始 snippet：13 条为日常交流、技术讨论、政治观点或争吵，未展示本项目范围内的广告；5 条包含色情诱饵/导流模板；2 条仅标点或短乱码，信息不足。举报确有范围外噪声，但样本不是随机抽样，举报也不代表已经列黑。2 条无法按安全的 UID/handle 规则关联到账号记录，未将其强行匹配。

## 根因与排除项

1. **排队条件仍把低置信度正常结果送待审。** Worker 仅对 `legit && confidence >= 0.85` 使用 `auto_legit`，其余进入 `auto_pending_review`。因此 80.87% 非垃圾标签是当前逻辑产生的队列噪声，不代表 80.87% 都被显示为垃圾。
2. **输入语义错误仍在放大模型误判。** `extractFromArticle()` 同时把当前文本填入 `triggeringComment` 和 `recentTweets[0]`，不是独立历史帖子。本轮 #371 与最新 `bmzxdchgqz` 等模型理由明确把两字段相同解释为“重复发布”。主题采集仍取页面第一个 tweetText；先前长文章误取第一条回复的路径尚未修复，但本轮没有重新打开申诉人的页面确认具体根主题。
3. **模型没有可靠遵守现有边界。** 当前提示词本来要求“性招揽 + mention 导流”等组合，也明确排除政治立场、翻译语言和成人内容本身；新样本却把普通 mention、演员名字、年龄、粗口、翻译中文泛化为色情/垃圾模板。能确认的是输出与证据/提示约束不一致，不能据此断言近期供应商或模型配置发生漂移。
4. **撤回状态没有撤回客户端判定。** 实际 Worker `/v1/classify` 对 removed/rejected 沿用无限期旧 verdict；实际客户端 `classifyAndCache()` 收到 reviewStatus 后仍保存旧垃圾标签，展示函数也只看 label。原有垃圾缓存还能跨文本复用 14/30 天。清理云端名单不能独自消除红标。
5. **排除“AI 自动发布重新打开”作为本轮新增公开名单原因。** 实查开关为 false，固定窗口公开新增仅 rule 104 + mention 3，没有 AI tier。规则与提及关联并不因此获得 100% 正确保证；本轮没有对全部新增规则条目作完整账号审查。

### 可重复的失败证据

运行 `node_modules/.bin/tsx scripts/diagnostics/terminal-verdict-replay.ts`，直接串联实际 Worker 路由与实际客户端缓存/展示函数，外部请求和数据库写入均禁止；合成输入只保留本轮生产观察到的“撤回状态 + 旧垃圾 verdict”形状，不会重新上报真实账号。

- removed → spam 0.90 → `cacheWrites=1, visible=true, storedSpam=true`
- rejected → spam 0.90 → `cacheWrites=1, visible=true, storedSpam=true`
- 唯一改变状态为 whitelisted 的对照 → legit 1.0 → `visible=false, storedSpam=false`
- 两次最小复跑与加入对照的第三次均稳定捕获前两项；断言退出码 **1**，单次小于 0.4 秒。此为**故意保留的红色诊断**，不是修复完成或整套测试通过。

本轮未修复产品代码。后续优先级应为：撤回状态/旧缓存失效 → 拆清当前文本与独立历史证据 → 把无充分证据的在线判定降为不展示、不自动处理 → 正常/不确定结果分流。仅继续清空待审不能解决这些原因。

## 最终证伪复核

- 2026-09-04 00:46 UTC 再次核对 11 个 issue：8 个 closed、#366/#368/#370 open，每个恰有本轮 1 条回复，没有重复评论或遗漏。
- 手动触发现有公开数据镜像流程返回 HTTP 200：whitelist、blacklist、lite 均 committed。仅更新独立 `data-mirror` 分支；当前仓库默认分支仍为 main，未推送本轮代码/文档提交。
- 不依赖可变分支缓存，实际下载并核对 [固定镜像版本的公开白名单](https://raw.githubusercontent.com/foru17/make-x-great-again/ae262064211275f229239e78cb83a5ff70ca5a00/data/whitelist/v1.json)：共 2,346 条，8 个申诉账号全部存在。生产 `/v1/whitelist` 另用 curl 成功复验，结果相同。
- 下载线上元数据指向的公开 lite 文件，含 172,107 条，8 个已保护账号均无黑名单命中。生产黑名单原始记录为 172,109 条；两者口径不同且存在发布延迟，未将差额当作丢失记录或声称完全相等。
- 最终实时接口：待审 43,902 个 handle（原始 43,903 条），白名单 2,346，AI 自动发布 false、近 24 小时 AI 发布 0。持续新增说明仅清理历史数据不能止住队列回填。
- 验证测试：白名单/身份相关服务端 **26/26**，发布保护/镜像分支/公开身份 **14/14**，扩展在线分类及完整白名单分页 **7/7**；共 47 个不同测试通过。撤回标签回放诊断仍按预期失败，明确保留为未修复问题。
- `git diff --check`、清单 JSON、诊断脚本语法与实际运行已检查；提交内容未包含现有配置凭据或已知密钥模式。未触碰用户原有 `.audit-*` 文件。
- 后续需要补证：#366、#370 的当前稳定身份与实际命中截图；#368 的当前命中来源及上下文。已在对应 issue 追问，未假装完成这三例的最终裁决。
