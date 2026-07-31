# MXGA 隐私声明

最后更新：2026-07-31

> 一句话概括：MXGA 默认只在本机匹配公开名单；当你主动用 GitHub 登录后，未命中本地名单、缓存与规则的新账号会把其公开资料和当前公开文本提交到 x.zuoluo.tv 做在线 AI 检测。
> 本地隐藏 / 静音 / 拉黑记录和本地统计不会上传；在线判定结果会缓存在你的浏览器里，避免重复检测。
> 如果你**主动**在设置里开启 X 静音 / 拉黑，扩展会用你自己的 X 登录态调用 X 自家接口对账号生效——
> 请求只发往 x.com，不经过我们的服务器、不收集任何数据（见下文 A.6）。
> 网站端（x.zuoluo.tv）的举报/共建流程是独立、可选的，下面单独说明。

---

## A. 浏览器扩展（你装在 Chrome / Firefox 里的部分）

### 1. 扩展 **不** 做的

- **默认不上传浏览数据**：未登录 GitHub 时，「本地隐藏」不会调用 X 的接口，也不会上传页面内容或扫描结果；后台只会向 x.zuoluo.tv 下载公开名单（见 A.3）
- **不收集个人身份信息（PII）**：姓名、邮箱、电话、地址 —— 全部不读、不存、不传
- **不收集设备指纹**：浏览器 UA、屏幕分辨率、字体列表、Canvas 指纹 —— 全部不收集
- **不上传处理记录**：本地隐藏列表、静音 / 拉黑处理记录和本地统计不会上传。GitHub 登录后的在线 AI 检测会提交目标账号的公开字段（见 A.4）；白名单申请的数据流见 A.7
- **不读你的浏览历史 / 其它 tab 内容**：content script 只对 `https://x.com/*` 和 `https://twitter.com/*` 生效
- **GitHub 登录是可选的**：不登录仍可使用本地名单和规则；登录后会启用新账号在线 AI 检测，也可申请白名单
- **不嵌任何统计/追踪 SDK**：没有 Google Analytics、Sentry、Mixpanel

Firefox 版把 `authenticationInfo`、`personallyIdentifyingInfo` 与 `websiteContent` 声明为可选数据权限；只有用户主动执行 GitHub 登录时才请求。未授权时仍只使用本地名单和规则。

### 2. 扩展 **本地** 存的（永不上传）

存于你浏览器自己的 `chrome.storage.local`，清空浏览器数据或卸载扩展即清空：

- **公开黑名单 / 白名单缓存**：从 x.zuoluo.tv 下载后存储，本地读取、本地匹配
- **本地「已隐藏」账号列表**：你点过「隐藏」的 X 账号 ID；设置页可逐条「取消隐藏」恢复
- **本地判定缓存**：避免重复扫描同一账号
- **你自己的本地统计**：扫了多少 / 隐藏了多少 / 命中公榜多少 —— 纯本机计数器
- **设置项**：总开关、气泡开关与位置等

### 3. 公开名单下载

扩展安装或更新后会立即从 `https://x.zuoluo.tv` 下载公开黑名单和白名单，之后通过 `alarms` 每 6 小时检查更新。请求不携带当前页面、X 账号、扫描结果或处理记录；服务端返回的只是所有用户共用的公开名单。名单缓存使用 `storage` / `unlimitedStorage` 保存在本机。

### 4. GitHub 登录后的在线 AI 检测

GitHub 登录后，扩展会对未命中本地公开名单、本地缓存和官方规则的新账号自动调用 `POST https://x.zuoluo.tv/v1/classify`：

- **发送什么**：目标账号在 X 页面公开显示的 handle、显示名、bio、头像地址、账号年龄 / 关注数据（页面可获得时）以及当前公开评论或推文文本；同时发送 GitHub bearer token 用于服务端身份验证和限流
- **为什么发送**：让服务端分类器判断 `spam` / `porn_bot` / `likely_spam` / `uncertain` / `legit`，弥补公开名单尚未收录新账号的时间差
- **限制**：客户端每个 SPA 页面最多自动提交 40 个账号、最多 3 个并发；服务端另有身份级和全局限流
- **结果**：判定结果保存在本机账号级缓存；同一账号再次出现时优先复用缓存，不重复调用 AI
- **退出**：在设置页清除 GitHub 登录信息后，新增账号立即回到本地名单 / 规则模式，不再自动提交在线检测

### 5. 扩展会打开的外部页面

点徽标里的「申诉」时，扩展会在新标签页打开 GitHub 上的申诉 issue 模板
（`github.com/foru17/make-x-great-again/issues/new?template=appeal.yml`）。
这只是打开一个链接，由你决定是否在 GitHub 上提交；扩展自身不向任何服务器 POST 数据。

### 6. 可选的 X 静音 / 拉黑（仅在你主动开启时）

设置页「处理方式」里默认是**本地隐藏**（不会联系 X）。如果你把它切换到 **X 静音**或 **X 拉黑**，扩展会先用 `chrome.permissions.request` 在运行时弹窗申请 x.com 的可选 host 权限（你拒绝就停留在本地模式）。此后你点「隐藏」时，除了本地隐藏，扩展还会：

- **发送什么**：向 x.com 发一个针对你选中那个账号的静音 / 拉黑请求（`POST /i/api/1.1/mutes/users/create.json` 或 `POST /i/api/1.1/blocks/create.json`），带上你浏览器里**已有**的 X 登录态（页面的 `ct0` CSRF cookie + X 网页端公开 bearer）。这等同于你自己在 X 上点「静音 / 拉黑」，只是由扩展代为发起。请求经过一个限速队列（跨 tab 串行、间隔 + 抖动、阶段性冷却、429 退避）以降低触发 X 风控的概率
- **不发送什么**：这个请求**只**发往 x.com，**绝不**发往我们的服务器（x.zuoluo.tv）或任何第三方。我们看不到、也不记录你静音 / 拉黑了谁。除了本地隐藏列表里早已保存的公开 X 数字 ID 外，不额外存储任何 PII，也不读取或外传你的 X 凭据

换句话说：静音 / 拉黑是**你用自己的 X 账号**经 X 自家接口做的操作，扩展只是帮你按下按钮，数据流向与你手动操作完全一致。

### 7. 可选的白名单自助申请

只有你在设置页主动发起该流程时，扩展才会请求 `github.com` 可选权限并使用 GitHub Device Flow：

- 向 GitHub 发送公开 OAuth client id，获得设备码并轮询授权结果；权限范围为 `read:user`
- 将 GitHub access token 保存在扩展本地存储，用于验证申请人；可在设置页退出并删除
- 从当前 x.com 会话识别你自己的公开 handle
- 向 `https://x.zuoluo.tv/v1/whitelist/apply` 提交该 handle、可选附言和 GitHub bearer token
- 服务端验证 GitHub 账号年龄，只保存加盐 HMAC 身份指纹、公开 X handle、账号年龄、附言和审核状态；不保存 GitHub token

---

## B. 网站端（x.zuoluo.tv 的举报 / 共建流程，与扩展无关、完全可选）

公开名单的共建发生在网站和服务端管线上，不在扩展里。只有当你**主动**使用网站的这些功能时才会产生请求：

### B.1 举报 / 确认 `POST /v1/report` / `POST /v1/confirm`
- 提交内容：目标 X 账号的公开信息（handle、数字 ID、触发判定的公开文本片段，**≤240 字**）
- 身份：需要 GitHub token 验证。服务端只用它读取你的 GitHub 数字 ID，然后立刻换算成**加盐 HMAC 指纹**入库 —— 原始 GitHub ID 从不落库；服务端未配置 `REPORT_SALT` 时这些端点直接返回 503（fail-closed），宁可不收举报也不存原始身份
- 限流：每身份每小时有举报上限；举报**绝不**自动公开，全部进人工审核队列

### B.2 AI 判定 `POST /v1/classify`
- 提交内容：目标账号在 X 上**公开**渲染的字段（handle、显示名、bio、公开推文文本等），转给 OpenAI 兼容 LLM 做 spam / 色情广告 bot 分类
- 限流：每身份（或匿名时按 IP 的加盐指纹）每小时 20 次；同样要求 `REPORT_SALT` 配置，否则 fail-closed
- 持久化：只保留判定结果（label / 置信度 / reasons）+ 公开头像 / 显示名 + 触发文本前 240 字（`evidence_text`，公榜审计需要）。X 公开推文本身是公开内容，存放公开内容不构成 PII 收集

### B.3 网页申诉 `POST /v1/appeal`
- 匿名可用，按 IP 的加盐指纹限流（每小时 5 次），同一 handle 每 24 小时去重
- 申诉理由只以哈希形式进审计日志，不存原文

### B.4 我们不可能关联的

- 我们看不到你的 X 账号是谁 —— 任何流程都不上传你自己的 X 身份
- 举报人在库里只是一串加盐哈希指纹，没有 Worker secret 无法反查
- 没有 IP 日志策略 / 不与第三方分享数据 / 不卖广告

## C. AI 供应商

服务端策展管线调用的是 OpenAI 兼容的 `/chat/completions` 端点，具体供应商坐标作为 Cloudflare Worker secret 保存，不出现在源码或日志中。供应商按其自身条款短期保留请求内容（通常 ≤30 天），用于滥用检测。**我们不会主动把请求归档到任何长期存储。**

## D. 数据删除

- **扩展本地数据**：设置页清除，或直接卸载扩展
- **服务端举报记录**：去 https://github.com/foru17/make-x-great-again/issues 开 issue 要求删除（注意：库里只有加盐指纹，我们需要你配合确认身份）
- **被误判的目标账号**：用扩展里的「申诉」入口（GitHub issue 模板），或网站的申诉通道，维护者人工复核

## E. 安全披露

发现漏洞请走 [SECURITY.md](../SECURITY.md) 的非公开通道，不要开公开 issue。

## F. 协议变更

本声明的变更会写到这个 Markdown 文件的 git 历史里，可在 [commit log](https://github.com/foru17/make-x-great-again/commits/main/docs/PRIVACY.md) 公开查询。

---

不放心？读源码：https://github.com/foru17/make-x-great-again 全部 AGPL-3.0。
扩展的 manifest（`extension/wxt.config.ts`）默认权限为 `storage`、`alarms`、`unlimitedStorage`；x.com / twitter.com 与 github.com 是运行时申请的可选 host 权限。Firefox 还把白名单流程声明为可选的 `authenticationInfo` 与 `personallyIdentifyingInfo` 数据传输，并在流程开始时申请同意。联网代码集中在 `extension/entrypoints/background.ts`、`extension/lib/list-sync.ts`、`extension/lib/x-action.ts` 和白名单申请界面，任何人都可以审计上述数据流。
