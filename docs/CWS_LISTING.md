# Chrome Web Store 提交清单

> **目的**：上架 MXGA 浏览器扩展。本文档把上架需要填的所有字段集中放好，
> 复制粘贴即可。涉及合规风险点也明确标出。

> ✅ **已上架** —— [`chromewebstore.google.com/detail/make-x-great-again/aeoldnecphbkkckeedfgfcdcekkljdea`](https://chromewebstore.google.com/detail/make-x-great-again/aeoldnecphbkkckeedfgfcdcekkljdea)。
> 本文档保留作为后续更新（新版本提交、字段调整、被驳回重提）的参考底稿。
> 任何字段改动以 Chrome Web Store Developer Dashboard 的实际状态为准。

---

## 1. 基本信息

| 字段 | 内容 |
|---|---|
| Name (Listing) | MXGA — X spam shield |
| Summary (单行，132 字符内) | 静默识别 X 上的色情/广告 spam bot，给你一键拉黑。开源、零数据收集。 |
| Category | Productivity |
| Language | 中文 (简体) — primary，可后加英语 |

## 2. Description（长描述，可粘贴到商店）

```
你是不是也觉得 X 越来越没法刷了？

随便点开一条热门推文，评论区一半是「比她好看的没她骚 @xxx 🍄🌳」这种
导流模板色情 bot，正常讨论沉到下面五十层。MXGA 帮你被动地把这些号
识别出来，并一键拉黑（驱动 X 自己的屏蔽 UI，不是 hide，不伪造请求）。

## 它做什么

- 你正常刷 X，扩展在后台 **静默** 把每个评论作者过一遍：
  - 维护者白名单 → 绿勾，跳过
  - 公开黑名单（人工确认过） → 红色「公榜」标记，立刻可拉黑
  - 本地缓存 → 灰色「缓存」标记
  - AI 实时判定（spam / porn_bot / likely_spam / uncertain / legit）
    → 琥珀「AI」标记
- 发现可疑时右上角气泡列出本页所有可疑账号，可以
  - 单独勾选 / 取消勾选
  - 一键批量拉黑（真拉黑 X 账号，不是隐藏）
  - 单条手动复核
  - 进入 X 该账号的主页

## 它不做什么

- **不收集** 你的 X 账号 / 邮箱 / 设备指纹 / IP
- **不爬** X 的隐藏数据，只读 X 已经渲染给你看的公开信息
- **不会** 自动屏蔽任何账号；扩展只在你按"拉黑"时才动 X 的屏蔽 API
- **不读** 你 GitHub 上的私有内容（OAuth 范围仅 read:user，只为防滥用计数）

## 治理

- 公榜入榜不是 AI 单方面说了算 —— 全部经过维护者人工确认
- 严格只判定商业 spam 和色情广告 bot，**不碰** 观点、立场、政治、身份
- 误判？开 GitHub issue 申诉：https://github.com/foru17/make-x-great-again/issues

完全开源 (AGPL-3.0)，源码：https://github.com/foru17/make-x-great-again
官网：https://x.zuoluo.tv
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

> The single purpose of this extension is to identify and let the user
> block commercial-spam and pornographic-advertising bot accounts on
> X (Twitter), passively, on the pages the user is already viewing.

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
| 1 | X 评论区里气泡显示「本页发现 N 个可疑账号」+ 列表 | content-script 实际运行截图 |
| 2 | 单个推文旁的红色公榜命中 badge + popover | content-script |
| 3 | 一键拉黑 + 进度（已完成 M / 选中 N） | 气泡卡片 |
| 4 | popup 主面板（成就 hero + 三栏统计 + 登录状态） | popup |
| 5 | options 设置（GitHub 登录 + 检测行为 + 数据与隐私 + 清除） | options |

> 还没准备好？参考 https://x.zuoluo.tv/list 公榜的视觉风格做。

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
