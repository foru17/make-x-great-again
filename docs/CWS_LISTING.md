# Chrome Web Store 提交清单

> **目的**：上架 MXGA 浏览器扩展。本文档把上架需要填的所有字段集中放好，
> 复制粘贴即可。涉及合规风险点也明确标出。

> ✅ **已上架** —— [`chromewebstore.google.com/detail/make-x-great-again/aeoldnecphbkkckeedfgfcdcekkljdea`](https://chromewebstore.google.com/detail/make-x-great-again/aeoldnecphbkkckeedfgfcdcekkljdea)。
> 本文档保留作为后续更新（新版本提交、字段调整、被驳回重提）的参考底稿。
> 任何字段改动以 Chrome Web Store Developer Dashboard 的实际状态为准。
>
> **当前文案版本：v0.3.0**（2026-05-26 提交）。v0.2 的历史文案见
> git history。每次新版上架前请同步更新本文档对应字段。

---

## 1. 基本信息

| 字段 | 内容 |
|---|---|
| Name (Listing) | MXGA — X spam shield |
| Summary (单行，132 字符内) | AI 静默识别 X 上的色情 / 广告 spam bot，给你一键真拉黑（可选自动模式）。完全开源、零数据收集。 |
| Category | Productivity |
| Language | 中文 (简体) — primary，可后加英语 |

## 2. Description（长描述，可粘贴到商店）

```
你是不是也觉得 X 越来越没法刷了?

随便点开一条热门推文,评论区一半是「比她好看的没她骚 @xxx 🍄🌳」这种
导流模板色情 bot,正常讨论沉到下面五十层。MXGA 帮你被动地把这些号
识别出来,并一键拉黑(驱动 X 自己的屏蔽 UI,不是 hide,不伪造请求,
拉黑跨你所有设备同步)。

完全开源 (AGPL-3.0):github.com/foru17/make-x-great-again
官网 / 公榜:https://x.zuoluo.tv

═══════════════════════════════════════

【它怎么工作】

你正常刷 X,扩展在后台静默把每个评论作者过一遍:

• 维护者白名单 → 绿勾「白名单」,跳过,不动它
• 公开黑名单(人工确认过) → 红色「公榜」标记
• 本地缓存 → 灰色「缓存」标记
• AI 实时判定 → 琥珀「AI」标记
  (spam / porn_bot / likely_spam / uncertain / legit)

发现可疑账号时,右上角气泡会列出本页所有可疑号:

• 每行可勾选 / 取消勾选 —— 挑着拉,不强制全拉
• 一键批量拉黑(限速队列,不会被 X 反垃圾误伤)
• 单条手动复核,跳转到该账号 X 主页
• 上报按钮带状态:上报中 → 已上报 / 失败

═══════════════════════════════════════

【v0.3 新增】

✅ 对已确认的垃圾号自动拉黑(默认关)
  开启后,扫到公榜确认 / 本机此前判过 spam 的号会被
  静默后台拉黑,不再需要逐个点。开关在「设置 → 检测行为」。

✅ 自己人不打架
  你自己、你关注的人、你 mute 或 block 的人,
  扩展完全跳过 —— 不会被自己 / 朋友的号污染公榜信任分。

✅ 浅色 / 深色主题
  自动跟随系统主题,深夜刷 X 不刺眼。

✅ 身份解析硬化
  从 X 自家的接口拿真账号 ID,不再被头像 URL 误导,
  把误伤同名账号的可能性降到接近零。

✅ 安全加固
  即便恶意账号在 bio 里写 prompt injection 试图劫持 AI 输出,
  扩展端会做严格的 HTML 转义,不会被 RCE。

═══════════════════════════════════════

【它不做什么】

✗ 不收集你的 X 账号 / 邮箱 / 设备指纹 / IP
  唯一上传的标识是公开的 X 数字 ID + 你的 GitHub 数字 ID
  (后者仅用于防滥用计数,GitHub OAuth 范围严格 read:user)。

✗ 不爬 X 隐藏数据
  只读 X 已经渲染在页面上给你看的公开内容。

✗ 默认不自动屏蔽任何账号
  「自动拉黑」开关默认关闭。打开后也只对已经社区 / 维护者
  确认过的 spam 账号生效,不会自动屏蔽 AI 一手判定的号。

✗ 不读你 GitHub 私有内容
  OAuth Device Flow 登录,scope 仅 read:user,
  只为读取你的 GitHub 数字 ID。

═══════════════════════════════════════

【治理 —— 公榜不是 AI 说了算】

入榜双门:
  • AI 置信度 ≥ 0.9(且标签是 spam / porn_bot)
  • ≥ 3 个注册超过 90 天的 GitHub 账号独立举报

任一条件不满足,只进人工审核队列,**永远不会自动公开**。

严格只判商业 spam 和色情广告 bot,
**不碰** 任何观点、立场、政治、身份。

误判申诉:开 GitHub issue,维护者会复核并支持移除。

═══════════════════════════════════════

【关于 LLM】

后端用 OpenAI 兼容的 /chat/completions 接口。
扩展只传 X 公开页面上已经渲染的字段(handle、显示名、bio、
本次触发的那条公开推文)。供应商坐标、API key 全部存在
Cloudflare Worker secret,不入仓库、不进客户端。

═══════════════════════════════════════

开源 · AGPL-3.0
源码:https://github.com/foru17/make-x-great-again
公榜:https://x.zuoluo.tv/list
申诉:https://github.com/foru17/make-x-great-again/issues
```

## 3. Permissions Justification（提交表单里有一栏一栏的）

| Permission | 用途 |
|---|---|
| `storage` | 本地缓存 AI 判定结果（避免重复调 LLM）、用户的隐藏列表、登录态、本地处理统计。所有内容仅存于 chrome.storage.local，不上传。 |
| `alarms` | 每 6 小时唤醒一次 service worker 增量同步维护者白名单（从 `/v1/whitelist?since=`），避免 SW 长驻浪费内存。 |
| host `https://x.zuoluo.tv/*` | 扩展的服务端 API：公榜命中查询、AI 判定、举报、白名单增量同步。 |
| host `https://x-spam-sentinel-edge.zuoluotv.workers.dev/*` | 同上的 Cloudflare workers.dev 备用 URL（自定义域名故障时的兜底）。 |
| host `https://github.com/login/*` | GitHub OAuth Device Flow 登录：申请 device code + 兑换 access token。 |
| host `https://api.github.com/user` | 登录后读取你的 GitHub 数字 ID（防滥用计数用），**仅** 此端点。 |
| content_scripts `https://x.com/*` / `https://twitter.com/*` | 唯一执行点 — 读取页面上 X 渲染好的公开账号信息、在每条推文旁挂载一个 shadow-DOM 徽章、显示右上角气泡。 |

## 4. Single Purpose 声明

**v0.3 起更新（明确把 user-enabled 自动模式写进 single purpose,避免审核员
看到自动拉黑设置时怀疑越界）**：

英文版（提交时主用,审核员主要看这版）：

> Identify commercial-spam and pornographic-advertising bot accounts on
> X (Twitter), passively on pages the user is already viewing, and let
> the user block them — either one-by-one or, when the user explicitly
> enables it, automatically for accounts the community has already
> confirmed.

中文版（如果商店表单是中文,粘这一版）：

> 在用户已经访问的 X (Twitter) 页面上,被动识别商业垃圾推广账号和色情
> 广告 bot 账号,并让用户屏蔽它们(手动逐个,或在用户主动开启自动模式后
> 由扩展自动屏蔽社区已确认的账号)。

**关键设计**：把 auto-block 写进单一用途,并强调两点:
1. *user explicitly enables* —— 默认关,需要用户主动开
2. *community already confirmed* —— 只对公榜 / 本地缓存确认过的号生效,不是 AI 单方面

这两点是 Chrome Web Store 审核员对扩展自动化最敏感的红线,先在 Single
Purpose 里写明白,省得 v0.3 提交后被怀疑越界。

## 5. Privacy Practices 声明（表单里一栏一栏的）

Chrome 商店现在要求逐项勾选/解释。对应答案：

| 问题 | 答案 |
|---|---|
| Does this item collect any user data? | **Yes**, see below. |
| Personally identifiable information | No |
| Health information | No |
| Financial and payment information | No |
| Authentication information | **Yes** — GitHub OAuth access token (stored locally; never shared with third parties; used only to call api.github.com/user for the reporter ID). |
| Personal communications | No |
| Location | No |
| Web history | No (only x.com / twitter.com pages, read-only) |
| User activity | **Yes** — when the user actively reports / blocks an account, the target X numeric ID + the user's GitHub numeric ID is transmitted to our backend. No other behavioral data. |
| Website content | **Yes** — public X content rendered on the page (handle, display name, bio, recent public tweet text) is transmitted to our backend for the AI classifier. No private content. |

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
| 1 | X 评论区里气泡显示「本页发现 N 个可疑账号」+ 列表（含每行 checkbox） | content-script 实际运行截图 |
| 2 | 单个推文旁的红色公榜命中 badge + popover | content-script |
| 3 | 一键拉黑 + 进度（已完成 M / 选中 N） | 气泡卡片 |
| 4 | popup 主面板（成就 hero + 三栏统计 + 登录状态） | popup |
| 5 | options 设置（GitHub 登录 + 检测行为 含 v0.3「自动拉黑」开关 + 数据与隐私 + 清除） | options |

> 还没准备好？参考 https://x.zuoluo.tv/list 公榜的视觉风格做。

> **v0.3 截图需要重出**：UI 改了浅色主题 + 每行 checkbox + 雷达进度环 +
> 设置页加了「自动拉黑」开关。原 v0.2 截图跟当前 build 视觉对不上,审核员
> 一比对会减分或要求补材料。新截图建议:
> - #1 / #3：bubble 气泡新雷达环 + per-row checkbox（这是 v0.3 视觉标志）
> - #4：管理面板左上角小蓝吉祥物（不再是通用盾牌 SVG）
> - #5：设置页务必把「对已确认的垃圾号自动拉黑」开关入镜（OFF 状态即可,
>   重点是让审核员看到默认关闭 + 说明文案,呼应 Single Purpose 里的承诺）
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
  - [x] 点单条「拉黑」 → 真的调起 X 屏蔽确认 → 完成
  - [x] options 页 → GitHub 登录 → Device Flow 跑通
- [x] 截图 5 张
- [x] 准备好商店付款（一次性 $5 注册费）
- [x] 提交并通过审核

## 9. 后续版本更新流程

1. 把新版本号写进 `extension/package.json` + `extension/wxt.config.ts` 的 `manifest.version`
2. `cd extension && pnpm zip` 出新的 .zip
3. 登录 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)，找到 MXGA item
4. 「Package → Upload new package」，把 zip 拖进去
5. 如果 listing 文案 / 截图 / 权限有变，同步更新本文档第 1–7 节并保存
6. 提交审核（通常 1–3 天；敏感品类可能 7–14 天）
7. 通过后同步把 GitHub Release 也打一份，让两边版本号一致

## 10. v0.3.0 更新 checklist（2026-05-26）

- [x] `extension/package.json` 版本号 0.2.0 → 0.3.0
- [x] `pnpm zip` 产出 `.output/mxga-extension-0.3.0-chrome.zip`(139.63 KB)
- [x] 本文档第 1 节 Summary、第 2 节 Description、第 4 节 Single Purpose 已按 v0.3 更新
- [x] `docs/STATUS.md` + `README.md` 同步 v0.3 增量
- [ ] **真机冒烟** —— 装新 zip 到日常 Chrome,跑一遍：
  - [ ] 进自己 profile / follow 的 KOL profile → 不出现 badge(viewer-scoped 过滤生效)
  - [ ] 设置 → 检测行为 → 看到「对已确认的垃圾号自动拉黑」开关,默认 OFF
  - [ ] 打开开关,刷过 Mary @Mary1463962 / Mark @Mark76056378472 → 被自动拉黑
  - [ ] 管理面板拉黑记录 → 看到来源标签「公榜命中」/「缓存命中」
  - [ ] 系统切到浅色模式 → bubble 跟着变浅色
  - [ ] 悬浮卡 reasons 显示纯文本(没有 HTML 元素被渲染,验证 escHtml 加固)
- [ ] 出 v0.3 新截图(参考第 6 节注释,至少含双主题)
- [ ] 上传 zip + 粘新版 Description + 新版 Single Purpose 到 CWS Dashboard
- [ ] 提交审核,等 1-3 天
- [ ] 审核通过后:`gh release create v0.3.0 --file mxga-extension-0.3.0-chrome.zip`,GitHub Release 跟 CWS 对齐
