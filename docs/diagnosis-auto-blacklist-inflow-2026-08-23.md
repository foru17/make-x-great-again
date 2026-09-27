# 自动进入黑名单几乎归零 —— 诊断与修复（2026-08-23）

> 本文档给两类读者：① 需要知道改了什么、还要做什么的维护者；② 需要在**真实
> Chrome + 真实 x.com 登录态**下验证扩展改动的另一个 AI（见 §6，那是本文档
> 存在的主要原因）。

---

## 1. 现象

线上「自动进入确认黑名单」的数量极少，上一次大批量已是约 20 小时前。

实测（近 72 小时，按 `published_tier` 分）：

| tier | 含义 | 条数 |
|---|---|---|
| `rule` | 关键字规则命中自动上榜 | 398 |
| `human` | 人工过队列 / 上报确认 | 252 |
| **`ai`** | **AI 高置信自动上榜** | **1** |

同期每天约 1300 条新账号涌入 `auto_pending_review`，队列积压 **106,969** 条，
其中 `uncertain` 就占 4.9 万条。

所谓「20 小时前那批」其实是 8-22 14:00–17:00 的关键字规则命中（114 条），
而 8-21 12:00–15:00 那批是**你自己手动过队列**。AI 通道事实上是关闭的。

---

## 2. 三个独立根因

### 根因 A（主因，扩展端）：content script 读不到 X 的 React fiber

扩展的 `readFiberUser()` 从 X 页面 DOM 节点的 `__reactFiber$…` 属性里取
**userId / bio / followersCount / accountAgeDays / accountCreatedAt**。
时间线（article）路径下，这五个字段**只有**这一个来源。

但 content script 跑在 **isolated world**，而页面主世界挂在 DOM 节点上的 JS
expando 属性对它不可见。CDP 实测（同一元素、同一页面）：

```
MAIN WORLD    : keys=["__reactFiber$abc123","__reactProps$abc123","__pageExpando"]  canReadFiber=true
ISOLATED WORLD: keys=[]                                                             canReadFiber=false
```

也就是说 **`readFiberUser()` 在任何已发布的构建里都一直返回 `{}`**，从未生效。

铁证：只有 fiber 能提供的 `accounts.account_created_at`，在全表历史上一直只有
约 1%——包括 6 月那段 uid 覆盖率 99% 的时期。那时候的 uid/账龄其实全部来自
**profile 页的 DOM 路径**（JSON-LD、`UserJoinDate`、粉丝数锚点），与 fiber 无关。

为什么现在才爆？2026-08-15 起客户端数从 12 个指纹涨到 650 个，扫描面从 profile
页转向时间线：

| 日期 | 新账号 | 带 uid | 带账龄 | `account_created_at`（=fiber 活着） |
|---|---|---|---|---|
| 07-26 | 7,021 | 99.3% | 98.8% | 1.4% |
| 08-14 | 515 | 51.5% | 45.4% | 4.5% |
| **08-15** | **16,097** | **3.6%** | **5.5%** | **0.1%** |
| 08-23 | 11,817 | 1.1% | 1.6% | 0.2% |

后果有两层：
1. AI 自动上榜要求 `uid !== null` → 98% 的载荷必然被挡；
2. LLM 只能看到一条推文正文，没有 bio / 粉丝数 / 账号年龄 → 队列里 4.9 万条
   `uncertain` 由此而来。

### 根因 B（edge 端）：置信阈值高于模型实际输出上限

`AUTO_AI_PUBLISH_CONF` 自 2026-06-13 起设为 **0.95**，但模型的高置信档实际
**量化在 0.92**。实测 24h 队列内 porn_bot 置信分布：

```
porn_bot  0.95 →     5 条
porn_bot  0.92 →   953 条   ← 模型真正的高置信档
porn_bot  0.90 →    42 条
```

阈值设在了模型够不到的位置，通道静默关闭了两个月，且**不报错**——只表现为队列变长。

### 根因 C（edge 端，运行时）：全局 LLM 熔断持续被打满

`LLM_GLOBAL_MAX_PER_WINDOW = 2000/小时`。实测 60 秒窗口内 521 次
`POST /v1/classify` 中有 **196 次**返回
`{"event":"classify.global_llm_cap_tripped","max":2000}` —— **约 38% 的请求
根本没跑到判定**。这个上限是按 8-15 之前（12 个用户）的量级设的。

> ⚠️ **这条需要你拍板，我没有动它**：提高上限会直接增加 LLM 按量花费。
> 现状等于用「拒绝 38% 的流量」换成本封顶。

---

## 3. 已经改了什么（edge 端：**已部署上线**）

版本 `904082df`，从 `feat/rules-visibility-telemetry` 部署（血统已复核，
见 §5）。

1. **阈值校准** `AUTO_AI_PUBLISH_CONF` 0.95 → **0.92**，注释里写清了实测直方图，
   以后再动之前要先重新测分布。
2. **handle-only 佐证通道**：uid 不再是唯一凭据。同一个 handle 被
   `AUTO_PUBLISH_MIN_WITNESSES`（默认 2，**可用 secret 覆盖，无需改代码**）个
   **不同的、账龄 ≥90 天的 GitHub 身份**独立判定为 publish 级 porn_bot 时，
   也可自动上榜。
   - 佐证在**缓存路径上也累计**——同一个垃圾号的第二个观察者本来只会拿到缓存，
     只在 LLM 真跑时计数的话永远凑不齐。
   - 两条路径共用同一个 fingerprint scope，否则同一个人会给自己作证
     （写测试时抓到的真 bug）。
   - 新表 `classify_witness`（只存加盐指纹，无 PII），30 天保留期，由 10 分钟
     cron 有界清理。migration 已在 remote D1 执行。
3. **高粉守卫修补**：改为回落到行上已存的 `followers_count`。handle-only 载荷
   自己不带粉丝数，否则 ≥10 万粉的守卫会被静默绕过（写测试时抓到的第二个真 bug）。
4. **可观测性**：`/v1/admin/stats` 新增
   `auto_lane_published_24h` / `auto_lane_blocked_24h`。部署后立刻读到：

   ```json
   { "auto_lane_published_24h": 0, "auto_lane_blocked_24h": 989 }
   ```

   —— 近 24h 有 989 条够格判定被挡下、0 条上榜。以后 published 塌向 0 而
   blocked 攀升，就是阈值又脱离现实了。
5. 顺带把 8-17 的 `743c219`（porn_bot 口径收敛为「评论区色情广告 bot」、高粉审慎
   从 10 万下探到 1 万粉）一并部署了——它此前一直没上线，正好是这次放宽自动上榜
   的配套误伤防护。

**没做**：积压 3000 条的批量回补 sweep。按设计取消——这些行会在被再次遇到时经
佐证通道自然上榜；而 2026-08-17 存量审计的结论恰恰是「ai tier 高粉行普遍缺人工
佐证」，盲目批量发布 3000 行正是该审计警告的动作。

---

## 4. 还需要做什么：**扩展必须改 + 重新发版**

**是的，根因 A 只能在扩展里修，且必须重新发布到 Chrome 应用商店（以及 Firefox /
Safari）。** edge 端的改动只是把伤害降低，无法替代它。

### 改动内容（已在分支 `feat/rules-visibility-telemetry` 提交 `72df17f`）

| 文件 | 说明 |
|---|---|
| `extension/entrypoints/x-bridge.content.ts` | **新增**。`world: "MAIN"` + `run_at: "document_start"` 的内容脚本。在**页面世界**做同一次 fiber 读取，把结果盖成 DOM 属性。 |
| `extension/lib/x-user-bridge.ts` | **新增**。跨 world 协议：`data-mxga-u`（JSON 载荷）+ `data-mxga-uh`（所属 handle）。编码/解码/防串号。 |
| `extension/lib/detect.ts` | `extractFromArticle` / `extractProfile` 合并桥接数据；导出 `handleFromArticle` / `profileHandle` 供桥接复用。 |
| `extension/entrypoints/content.ts` | 删掉重复的 `handleFromArticle`，改为 import。 |
| `extension/lib/types.ts` | `Signals` 补上 `accountCreatedAt`（此前实际在发但没类型）。 |

**核心思路**：DOM **属性**跨 world 共享，JS **expando** 不共享。所以让 MAIN world
读 fiber、写属性，isolated world 同步读属性——`scan()` 因此不用改成异步。

**降级安全**：不支持 `world: "MAIN"` 的浏览器会忽略该 manifest 键，脚本退化到
isolated world、什么也不盖，行为与今天完全一致，不会更差。

### 已完成的验证

- 构建产物 manifest 已含 `"world": "MAIN"`（chrome-mv3 与 firefox-mv3 都有）。
- 单元测试 7 项（`extension/test/x-user-bridge.test.ts`）：盖章往返、回收节点
  串号防护、坏 JSON 降级、大小写、bio 截断上限、MAIN 侧盖章契约。
- **真实 Chrome 端到端**（Chrome for Testing 149 + 真实构建产物 + 伪装成 x.com
  的本地 https 页面，页面里放了真实形状的 React fiber）：

  | world | 能看到 fiber | 读到桥接属性 |
  |---|---|---|
  | 扩展 isolated world | `[]` ← 就是这个 bug | ✅ userId/bio/粉丝/账龄全有 |
  | 页面 MAIN world | `['__reactFiber$…']` | ✅ |

### ⚠️ 尚未验证的部分（§6 就是要解决这个）

上面的端到端用的是**我自己构造的** fiber 形状。**没有验证过 x.com 线上当前的
真实 React 内部结构是否仍然匹配 `findUser()` 的判定条件**
（`__typename === "User"` 且 `legacy.description` 是字符串 且
`legacy` 里有 `followers_count` 或 `screen_name`）。

X 随时可能改内部结构。如果形状已经变了，这座桥会正确运行但读不到东西——
必须在**真实登录态的 x.com** 上确认。

---

## 5. 部署血统（重要，勿踩）

prod 跑的是 `feat/rules-visibility-telemetry`，**不是 main**。从 main 部署会回滚
prod。本次复核手法：curl 一个只存在于目标分支的端点看是否 404 ——
`POST https://x.zuoluo.tv/v1/rule-hits` 返回 **400**（而非 404）即证明线上有该分支的代码。

---

## 6. 给验证 AI 的任务书

### 6.1 目标

在**真实 Chrome + 真实 x.com 登录态**下，回答三个问题：

1. **桥接是否真的拿到数据**：时间线里的 `article` 节点上，
   `data-mxga-u` 是否被盖上，且内容包含真实的 `userId`（纯数字）、
   `followersCount`、`accountAgeDays`、`bio`？
2. **isolated 侧是否真的用上了**：扩展发往 `POST https://x.zuoluo.tv/v1/classify`
   的请求体里，是否出现了 `userId` / `followersCount` / `accountAgeDays` /
   `accountCreatedAt`？（这是最终判据——修复的全部意义就在这里。）
3. **有没有把 X 弄坏**：时间线滚动、点赞/转推、SPA 路由切换、暗色模式是否一切正常？
   有没有控制台报错？CPU 有没有异常占用？

### 6.2 环境准备

```bash
cd /Users/luolei/DEV/x-spam-sentinel/extension
npm run build          # 产出 .output/chrome-mv3
```

**加载扩展的坑**：系统 Chrome 151 **已经忽略 `--load-extension`**
（实测：`chrome://extensions` 列表为空，且 `--disable-features=DisableLoadExtensionCommandLineSwitch` 也无效）。两条可行路径：

- **路径 A（推荐，可自动化）**：用 Chrome for Testing。本机已有
  `~/.cache/puppeteer/chrome/mac_arm-149.0.7827.22/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`。
  实测 `--load-extension` 在它上面仍然有效。
  但它是干净 profile，**需要人工登录一次 x.com**（登录属于人工步骤，AI 不要代做）。
- **路径 B**：让**用户本人**在自己的 Chrome 里 `chrome://extensions` → 开发者模式
  → 「加载已解压的扩展程序」→ 选 `.output/chrome-mv3`，然后由用户提供 CDP 端口
  或人工截图/粘贴结果。

### 6.3 验证步骤

**Step 1 — 桥接盖章（回答问题 1）**

登录后打开任意一条中文热门推文的**回复区**（垃圾号密度最高的地方），
在 DevTools Console（**Page 上下文**，不是扩展上下文）执行：

```js
[...document.querySelectorAll('article[data-testid="tweet"]')]
  .slice(0, 20)
  .map(a => ({
    handle: a.querySelector('[data-testid="User-Name"] a[href^="/"]')?.getAttribute('href'),
    stampedFor: a.getAttribute('data-mxga-uh'),
    payload: a.getAttribute('data-mxga-u'),
  }));
```

**期望**：大多数 article 的 `payload` 非 null，解析出来含纯数字 `userId`、
`followersCount`、`accountAgeDays`。

**如果全是 null** → 说明 X 的 fiber 形状已变（§4 结尾的风险）。此时请：
在 Page 上下文里 dump 一个 article 的 fiber，找到真实的用户对象结构并记录下来：

```js
const el = document.querySelector('article[data-testid="tweet"]');
const k = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
let n = el[k], out = [];
for (let i = 0; n && i < 24; i++, n = n.return) {
  out.push({ i, props: n.memoizedProps && Object.keys(n.memoizedProps) });
}
console.log(JSON.stringify(out, null, 1));
```
把结果贴回来，`extension/lib/detect.ts` 里的 `findUser()` 判定条件需要按新形状调整。

**Step 2 — 落到请求体（回答问题 2，最关键）**

扩展的在线判定需要**已用 GitHub 登录**（扩展设置页里登录）。登录后，
在 DevTools **Network** 面板过滤 `classify`，看 `POST /v1/classify` 的
Request Payload。

**期望**：payload 里出现
```json
{ "userId": "1450…", "handle": "...", "bio": "...", "followersCount": 42,
  "accountAgeDays": 53, "accountCreatedAt": "2026-…" }
```
**修复前**的对照组是：只有 `handle` / `displayName` / `avatarUrl` /
`recentTweets` / `triggeringComment`，没有 `userId`、没有粉丝数、没有账龄。

请**同时**测两个页面类型：
- 推文详情页的回复区（`/<user>/status/<id>`）—— 这是根因所在的路径，**必测**；
- 某个账号的 profile 页（`/<user>`）—— 这条路径本来就有 DOM 兜底，用作对照。

**Step 3 — 副作用（回答问题 3）**

- 快速滚动 200+ 条时间线，观察是否卡顿；Performance 面板看 `x-bridge.js` 的占用。
  （桥接对已盖章节点会跳过，稳态应该接近零成本；单次 sweep 上限 60 个元素。）
- SPA 路由来回切（首页 ↔ 推文详情 ↔ profile），确认盖章跟得上、且不串号
  （X 会回收 `article` 节点，`data-mxga-uh` 就是防串号的，重点看**同一个节点
  换了作者之后**是否更新或清除）。
- Console 有无 `[MXGA]` 报错或未捕获异常。
- 暗色 / 亮色各看一遍扩展 UI 有无异常（项目约定：任何改动都要双主题验一遍）。

### 6.4 产出

请输出一份 md 指引文档，包含：
- 每一步的**实际**结果（贴真实数据，不要只写「通过」）；
- 修复前 / 修复后 classify 请求体的对照（可以卸载扩展换成商店版做对照组）；
- 如果 Step 1 全 null，附上 fiber 结构 dump 与建议的 `findUser()` 改法；
- 明确的 PASS / FAIL 结论。

---

## 7. 现状与预期

edge 侧改动已上线并生效（`auto_lane_blocked_24h` 已经能读到 989）。但要注意：

**佐证通道恢复得慢**，因为它要求同一个 handle 被 2 个**不同**用户撞见。部署后
15 分钟内 `classify_witness` 只累积到个位数。它是**扩展发版前的过渡手段**，不是终局。

**真正的解药是扩展发版**：uid 一旦回来，每条 porn_bot@0.92 的新鲜判定都能立刻上榜，
按当前流量约 **950 条/天**。

再叠加根因 C（38% 的请求被全局熔断挡掉）——那条需要你在成本上拍板。

---

## 附：验证过的事实清单（避免重复劳动）

- isolated world 看不到 DOM expando：CDP `Page.createIsolatedWorld` 实测，`Object.keys(el) === []`。
- DOM 属性双向跨 world 可见：同上手法实测，isolated↔MAIN 互读成功。
- 构建产物 manifest 含 `world: "MAIN"`（chrome + firefox）。
- 真实 Chrome for Testing + 真实构建产物 + **合成** fiber：桥接盖章成功，
  isolated world 读到完整 payload。
- edge 测试 128 项全绿（新增 6 项佐证通道），扩展测试 48 项全绿（新增 7 项桥接）。
- prod 血统 = `feat/rules-visibility-telemetry`（`/v1/rule-hits` 返回 400 非 404）。
