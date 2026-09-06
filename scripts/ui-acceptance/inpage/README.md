# 页内 UI 验收台（徽章 / 弹层 / 气泡）

真实构建产物 + 仿真 X 页面：Playwright 拦截 `https://x.com/*` 返回 `fixture.mjs`
生成的页面（DOM 形态与 content script 依赖的 data-testid 一致），扩展按生产
方式注入；三种 X 主题（Default / Dim / Lights out）× 桌面 1440×900 / 移动 390×844。

```bash
cd extension && pnpm build            # 产物 .output/chrome-mv3
cd ../scripts/ui-acceptance/inpage
npm i playwright-core@1.49             # 一次性；不进仓库
CHROME="/path/to/Google Chrome for Testing" node run.mjs
# 截图落在 .ui-acceptance/<date>-inpage/
```

种子数据（通过扩展 service worker 写 chrome.storage.local）：公榜命中（人工/自动）、
官方规则命中、检测缓存命中、本地白名单、未命中 ghost；`edgeBase` 指向死地址，
避免后台同步用真实名单覆盖种子。仿真页不是 X 的像素复刻，只用来验收扩展自己
注入的元素在三主题下的对比度、定位与交互；X 自身布局差异（如 profile 头部
UserName 的 flex 方向）以 `.ui-acceptance/2026-07-24-store/` 的真机截图为准。
