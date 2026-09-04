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
