# Chrome Web Store 提交清单

> **目的**：上架 MXGA 浏览器扩展。本文档把上架需要填的所有字段集中放好，
> 复制粘贴即可。涉及合规风险点也明确标出。

> ✅ **已上架** —— [`chromewebstore.google.com/detail/make-x-great-again/aeoldnecphbkkckeedfgfcdcekkljdea`](https://chromewebstore.google.com/detail/make-x-great-again/aeoldnecphbkkckeedfgfcdcekkljdea)。
> 本文档保留作为后续更新（新版本提交、字段调整、被驳回重提）的参考底稿。
> 任何字段改动以 Chrome Web Store Developer Dashboard 的实际状态为准。
>
> **当前文案版本：v0.6.0**（2026-08-14，共建回路版；商店在架为 v0.5.0，见第 12 节
> 更新 checklist）。v0.2–v0.4 的历史文案见 git history。每次新版上架前请同步更新
> 本文档对应字段。

---

## 1. 基本信息

| 字段 | 内容 |
|---|---|
| Name (Listing) | MXGA — X spam shield |
| Summary / Manifest description (单行，132 字符内) | 社区共建公开黑名单的 X 旁路扩展 · 本地匹配色情/广告 spam 机器人，默认一键隐藏，可选 X 静音/拉黑。不开启浏览数据上报。 |
| Category | Productivity |
| Language | 中文 (简体) — primary，可后加英语 |

## 2. Description（详细描述，可粘贴到商店）

> Chrome Web Store 会同时展示上面的 Summary 和这里的详细描述。不要把
> Summary 原样粘到 Description，否则商店「概述」里会出现两段重复文案。

```
MXGA 是一个开源的 X (Twitter) 旁路防 spam 扩展。你正常刷 X 时,它把页面上已经公开显示的账号跟本机缓存的社区共建公开黑名单做本地比对,把色情引流号、广告推广号和明显模板化 spam bot 标在评论区旁边。你可以逐个复核,点「隐藏」后该账号的帖子会在你本机被隐藏(默认是本地隐藏,不调用 X 的任何接口),设置页可随时取消隐藏。

主要功能:

- 被动扫描当前 X 页面,不需要改变你的浏览习惯。
- 安装 / 更新后下载公开黑名单与白名单,之后每 6 小时检查版本;命中判定全部本地完成,不上传页面内容、扫描结果或处理记录。
- 一键隐藏命中账号的帖子,带 5 秒撤销窗口;设置页可查看隐藏列表并随时取消隐藏,纠正误判。
- 处理方式三选一(可选):默认仅在本机隐藏;也可选择用你自己的 X 登录态调用 X 原生「静音」或「拉黑」,经限速队列发起,只发往 x.com、不经过我们的服务器。x.com 访问权限只有在你切换到静音/拉黑时才会在运行时弹窗申请。
- 误判申诉:一键打开 GitHub 申诉 issue 模板,由维护者人工复核。
- 支持浅色 / 深色主题,设置页可查看检测统计和本地数据。

隐私与治理:

MXGA 扩展不上传你的浏览历史、页面内容、扫描结果、隐藏列表或本地统计。后台只从 x.zuoluo.tv 下载所有用户共用的公开名单。默认本地隐藏不联系 X;可选静音/拉黑请求只发往 x.com。只有用户主动发起白名单申请时,才会使用 GitHub Device Flow 并向 x.zuoluo.tv 提交自己的公开 X handle 与可选附言。

公开黑名单不是 AI 单独决定。账号入榜需要维护者人工确认;高置信 AI 判定和社区举报只是审核信号,不会单独公开发布。项目严格只处理商业垃圾推广和色情广告机器人,不判断观点、立场、政治或身份。名单的举报与共建流程在网站端(x.zuoluo.tv)进行,与扩展无关。

源码:https://github.com/foru17/make-x-great-again
公榜:https://x.zuoluo.tv/list
隐私政策:https://github.com/foru17/make-x-great-again/blob/main/docs/PRIVACY.md
```

## 3. Permissions Justification（提交表单里有一栏一栏的）

| Permission | 用途 |
|---|---|
| `storage` | 本地保存判定缓存、用户的隐藏列表、设置和本地统计。所有内容仅存于 chrome.storage.local，不上传。 |
| `alarms` | 每 6 小时检查一次公开名单版本，避免浏览时按账号请求服务端。 |
| `unlimitedStorage` | 保存约数 MB 的公开名单缓存以及本地记录，避免接近浏览器默认配额后保护失效。 |
| content_scripts `https://x.com/*` / `https://twitter.com/*` | 读取页面上 X 渲染好的公开账号信息、跟本机缓存的黑名单做本地比对、在每条推文旁挂载一个 shadow-DOM 徽章、显示右上角气泡。 |
| **可选** host 权限 `*://x.com/*` / `*://twitter.com/*`（`optional_host_permissions`，Firefox 为 `optional_permissions`） | **仅在用户主动开启 X 静音 / 拉黑时**由 `chrome.permissions.request` 在运行时申请。用途单一：用用户已有的 X 登录态调用 X 自家的静音 / 拉黑接口（`mutes/users/create.json` / `blocks/create.json`），对用户自己选中的账号生效。不申请则不存在；默认安装不申请。不用于任何数据收集,请求只发往 x.com、绝不发往我们的服务器或第三方。 |
| **可选** host 权限 `https://github.com/*` | 仅当用户主动发起白名单申请时请求，用于 GitHub Device Flow；授权范围为 `read:user`。 |

> v0.5.0 使用 `alarms` 做低频名单同步，使用 `unlimitedStorage` 保存名单缓存。
> x.com / twitter.com 与 GitHub host 权限都是可选权限，仅在用户启用对应功能时申请。

## 4. Single Purpose 声明

**v0.5.0 起更新（扩展默认是被动本地版,single purpose 是「标注 + 本地隐藏」;
X 静音 / 拉黑是用户主动选择、由用户自己 X 账号经 X 接口发起的可选动作,
没有任何「自动」拉黑能力——所有动作都由用户逐条点「隐藏」触发）**：

英文版（提交时主用,审核员主要看这版）：

> Identify commercial-spam and pornographic-advertising bot accounts on
> X (Twitter), passively on pages the user is already viewing, by matching
> against a locally cached community-curated public blocklist, and let the user act
> on flagged accounts. The default mode is a reversible, on-device visual
> hide that never calls X's APIs or uploads browsing data. The extension
> periodically downloads the same public list for every user. The user
> may optionally switch to muting or blocking the account on X, which uses the
> user's own existing X session to call X's first-party mute/block endpoints
> (requested only via an optional, runtime-granted x.com host permission);
> no action history is sent to our servers. An optional, user-initiated
> whitelist application uses GitHub identity verification and submits the
> user's own public X handle to the service.

中文版（如果商店表单是中文,粘这一版）：

> 在用户已经访问的 X (Twitter) 页面上,用本机缓存的社区共建公开黑名单
> 被动识别商业垃圾推广账号和色情广告 bot 账号,并让用户对命中账号采取动作。
> 默认是可随时取消的本地视觉隐藏(不调用 X 的任何接口、不上传浏览数据);扩展会
> 低频下载所有用户共用的公开名单。用户可
> 选择切换为对该账号执行 X 原生静音 / 拉黑——这会用用户自己已有的 X 登录态
> 调用 X 自家的静音 / 拉黑接口(仅通过可选、运行时授权的 x.com host 权限),
> 不向我们的服务器发送处理记录。可选的白名单申请会在用户主动发起后使用
> GitHub 身份验证，并提交用户自己的公开 X handle。

**关键设计**：v0.4 及以前的「**自动**拉黑」(无人值守批量驱动 X API)已全部废弃 ——
当前版本没有任何自动化操作:静音 / 拉黑必须用户逐条主动触发,且默认根本不申请
x.com 权限。审核员最敏感的「无感知自动化操作用户账号」风险点已从根上移除。

## 5. Privacy Practices 声明（表单里一栏一栏的）

Chrome 商店现在要求逐项勾选/解释。对应答案：

| 问题 | 答案 |
|---|---|
| Does this item collect any user data? | **Yes, only for the optional whitelist application** — GitHub authentication is used to verify account age; the user's public X handle and optional note are submitted for review. Routine protection uploads no browsing or scan data. |
| Personally identifiable information | **Yes, optional** — the applicant's public X handle and optional note are submitted only when they request whitelist review. |
| Health information | No |
| Financial and payment information | No |
| Authentication information | **Yes, optional and transient** — a GitHub OAuth token is transmitted to the service for whitelist identity verification and is not stored server-side. The X session credential is never sent to us. |
| Personal communications | No |
| Location | No |
| Web history | No (only x.com / twitter.com pages, read-only, processed locally) |
| User activity | No — hides and stats are recorded only in local chrome.storage; never transmitted. |
| Website content | No — page content is matched against the bundled blocklist locally; nothing is transmitted to us or any third party. |

> **关于 host 权限 / "Are you using permissions for…?"**：v0.5.0 起存在一个**可选**的
> x.com / twitter.com host 权限,只有用户在设置里开启 X 静音 / 拉黑时才会在运行时申请。
> 它驱动的是**用户对自己 X 账号**的静音 / 拉黑动作(调用 X 自家接口),**不是**数据收集——
> 不会有任何用户数据因此流向我们或第三方。回答相关问题时如实说明这一点即可。

### 数据用途承诺（要勾的三个 box，都应勾上）

- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.
- [x] I do not sell user data to third parties (outside of the approved use cases).

### Privacy policy URL

```
https://github.com/foru17/make-x-great-again/blob/main/docs/PRIVACY.md
```

## 6. 截图清单（5 张，1280×800 / 640×400 PNG）

| # | 内容 | 来源 |
|---|---|---|
| 1 | X 评论区里气泡显示「本页命中 N 个账号」+ 账号列表 | content-script 实际运行截图 |
| 2 | 单个推文旁的红色公榜命中 badge + popover（含「隐藏」「申诉」按钮） | content-script |
| 3 | 点「隐藏」后的「5 秒后隐藏 / 撤销」pending 状态 | content-script |
| 4 | popup 主面板（本地统计） | popup |
| 5 | options 设置（本地隐藏列表 + 取消隐藏 + 数据与隐私 + 清除） | options |

> 还没准备好？参考 https://x.zuoluo.tv/list 公榜的视觉风格做。

> **v0.5 截图需要重出**：「拉黑」已全部改为「隐藏」,GitHub 登录 / 拉黑队列 /
> 自动拉黑开关已移除。原 v0.4 截图里出现旧按钮、4 格拉黑进度或登录卡片的
> 都跟当前 build 不一致。新截图建议:
> - #2 / #3：badge popover 的「隐藏」按钮 + 5 秒撤销提示
> - #5：设置页的隐藏列表（含「取消隐藏」）入镜
> - 至少出 1 张浅色主题 + 1 张深色主题,展示双主题支持

## 7. 已知合规风险点

| 风险 | 严重度 | 处理 |
|---|---|---|
| 名字含 "Make X Great Again" 联想 MAGA 政治口号 | 中 | listing name 已改成 `MXGA — X spam shield`；manifest 内部名照旧。如果还被审拒，可考虑改成 "MXGA Spam Shield" |
| 描述提到 "X (Twitter)" — 涉及他人商标 | 低 | Chrome 上很多 X-相关工具都用这套写法，问题不大；如审核要求，改成 "the X platform" |
| auto-publish 路径已关 — 没有"3 人举报自动公榜"的滥用入口 | — | 这是 alpha 阶段加固，给审核员讲故事时正面提及 |
| 服务端 LLM 供应商不在仓库 | — | 写明在 `services/edge/src/index.ts` Env interface 注释里；隐私声明也说明了 |

## 8. 上架前 checklist（已完成 ✅）

- [x] 用 `pnpm zip` 出 production .zip（在 `.output/chrome-mv3-0.2.0.zip`）
- [x] 在干净 Chrome profile 加载该 zip 解压目录，跑一遍：
  - [x] popup 打开正常、登录引导显示
  - [x] 进 x.com → 看到气泡 pill「守护中」/「已扫 N」
  - [x] 进 https://x.com/imwsl90/status/2058805164749050313（有 spam 的 thread） → 看到 badge + 气泡列表
  - [x] 点单条「拉黑」 → 通过 X 屏蔽接口静默完成 → 记录
  - [x] options 页 → GitHub 登录 → Device Flow 跑通
- [x] 截图 5 张
- [x] 准备好商店付款（一次性 $5 注册费）
- [x] 提交并通过审核

## 9. 后续版本更新流程

1. 把新版本号写进 `extension/package.json`（WXT 会同步生成 manifest version）
2. `cd extension && pnpm zip` 出新的 .zip
3. 登录 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)，找到 MXGA item
4. 「Package → Upload new package」，把 zip 拖进去
5. 如果 listing 文案 / 截图 / 权限有变，同步更新本文档第 1–7 节并保存
6. 提交审核（通常 1–3 天；敏感品类可能 7–14 天）
7. 通过后同步把 GitHub Release 也打一份，让两边版本号一致

## 10. v0.4.0 更新 checklist（2026-05-28）

- [x] `extension/package.json` 版本号 0.3.0 → 0.4.0
- [x] `npm run compile`
- [x] `npm run zip` 产出 `.output/mxga-extension-0.4.0-chrome.zip` (143.44 KB)
- [x] zip 内 `manifest.json` 确认为 `version: 0.4.0`、MV3、无 localhost dev 权限
- [x] `README.md`、`docs/STATUS.md`、`CHANGELOG.md` 同步 v0.4.0
- [ ] **真机冒烟** —— 装新 zip 到日常 Chrome,跑一遍：
  - [ ] 未登录时 popup 点 GitHub → options 设置 tab 自动启动 Device Flow，验证码可复制
  - [ ] 打开有多个 spam 的单条推文 → 气泡自动展开后台拉黑队列
  - [ ] 顶部 4 格状态稳定展示，不随「已拉」数量出现/消失而换行
  - [ ] 开启「对已确认的垃圾号自动拉黑」后，公榜命中进入静默拉黑队列
  - [ ] 单个账号成功拉黑后，队列行头像/名称划掉淡出，本地记录页出现该账号
  - [ ] 系统切到浅色/深色模式 → bubble 与 options 视觉正常
- [ ] 出 v0.4 新截图（参考第 6 节注释）
- [ ] 上传 zip + 必要时更新 Description / Screenshot 到 CWS Dashboard
- [ ] 提交审核,等 1-3 天
- [x] GitHub Release `v0.4.0` 与 CWS zip 对齐

## 11. v0.5.0 更新 checklist（2026-07-11，名单同步 + 本地匹配版）

- [x] `extension/package.json` 版本号 0.4.0 → 0.5.0
- [ ] `cd extension && pnpm zip` 产出 v0.5.0 zip
- [ ] zip 内 `manifest.json` 确认：`version: 0.5.0`、MV3、`permissions` 为 `storage` / `alarms` / `unlimitedStorage`，可选 host 权限含 X / Twitter / GitHub
- [ ] Dashboard 同步：
  - [ ] Summary / Description 换成本文档第 1–2 节的 v0.5.0 文案（默认本地隐藏 + 可选 X 静音/拉黑）
  - [ ] Permissions justification 按第 3 节填写 storage / alarms / unlimitedStorage 与可选 X / GitHub 权限
  - [ ] Privacy practices 按第 5 节披露可选白名单申请的数据流；不得再选择「不收集」
  - [ ] Single purpose 换成第 4 节 v0.5.0 版本
- [ ] 真机冒烟：装新 zip,确认名单同步 / badge / 隐藏 / 5 秒撤销 / 取消隐藏 / 申诉跳 GitHub 全部正常；默认模式仅出现公开名单 GET；切到 X 静音/拉黑会先弹 x.com 权限请求,授权后动作请求只发往 x.com；白名单申请单独验证 GitHub 与服务端请求
- [ ] 出 v0.5 新截图（参考第 6 节注释）
- [ ] 提交审核
- [ ] GitHub Release `v0.5.0` 与 CWS zip 对齐

## 12. v0.6.0 更新 checklist（2026-08-14，共建回路版）

相对在架 v0.5.0 的用户可见变化：检测规则板块（查看官方规则/总开关/单条停用）、
自定义本地规则、官方规则命中匿名回传（默认开、可关，PRIVACY A.4b）、概览共建
状态卡、GitHub 登录后的在线 AI 检测与一键上报、白名单全量同步修复。权限集合
**无变化**（仍为 storage / alarms / unlimitedStorage + 可选 X / GitHub host）。

- [x] `extension/package.json` 版本号 → 0.6.0（Safari MARKETING_VERSION 同步 0.6.0）
- [ ] `cd extension && pnpm zip` 产出 v0.6.0 zip（Firefox 用 `pnpm zip -b firefox`）
- [ ] zip 内 `manifest.json` 确认：`version: 0.6.0`、权限集合与 v0.5.0 一致
- [ ] Dashboard 同步：
  - [ ] Description 追加下方「v0.6.0 文案增补」段落
  - [ ] **Privacy practices 必须更新**：新增「官方规则命中匿名回传」的数据收集披露——
        仅收集垃圾账号的公开标识（handle / 数字 ID）与命中的规则关键词，不含用户身份、
        浏览历史或页面内容；默认开启、设置页可一键关闭。这属于 CWS 问卷里的
        「User activity → 否 / Website content → 否」范畴之外的第三方账号公开数据，
        照实在 disclosure 文本里写明即可，勿勾选收集用户个人数据
  - [ ] Single purpose 无需变化（仍是「标注 + 本地隐藏」）
- [ ] 真机冒烟：规则板块开关/停用/自定义规则、回传开关（关闭后无 /v1/rule-hits 请求）、
      共建卡登录跳转、白名单同步后 count ≥ 2000（options 概览白名单计数）
- [ ] 出 v0.6 新增截图：设置页检测规则板块、概览共建卡
- [ ] 提交审核；AMO（Firefox）同步提交
- [ ] GitHub Release `v0.6.0` 与 CWS zip 对齐

**v0.6.0 文案增补**（追加到 Description 功能列表后）：

```
新增（v0.6.0）：
- 检测规则透明化:在设置页直接查看同步的官方关键词规则,可整体停用或逐条停用
- 自定义规则:添加你自己的关键词规则(仅本机生效,不上传)
- 共建回路:GitHub 登录后,本地名单未命中的新账号可自动送在线 AI 检测,一键上报进入公共人工审核队列;官方规则命中默认匿名回传「命中规则+垃圾账号公开标识」帮助社区收录新垃圾号(不含你的任何身份信息,设置页可一键关闭,详见隐私声明)
```
