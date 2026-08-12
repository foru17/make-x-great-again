# Safari Web Extension（macOS 15+）

> iOS / iPadOS 18+ 的工程、构建和验证流程见 [SAFARI-IOS.md](./SAFARI-IOS.md)。

MXGA 的 Safari 版本复用 `extension/` 中的 WXT/React/TypeScript 源码，并以
Manifest V3 Safari Web Extension 的形式嵌入 SwiftUI macOS 容器应用。

## 范围

Safari 版本与 Chrome 版本保持相同的处理能力：

- 支持 x.com 与 twitter.com 的被动检测、徽标、分类自动处理、本地隐藏、X 原生静音/拉黑、撤销、popup 和设置页；
- 应用内置构建时的公开名单快照，后台再只读同步更新；匹配、统计和处理记录均在本地完成，不上传浏览或扫描数据；
- 使用 WebExtension `storage`、`alarms` 和 `unlimitedStorage` 权限保存并定时刷新名单；
- X 静音/拉黑使用 Safari 为内容脚本管理的 x.com 与 twitter.com 网站访问权限，并使用当前登录态直连 X 自有接口，不经过 MXGA 后端；
- GitHub 白名单自助申请仅在用户主动登录时请求 `github.com` 可选权限。

用户仍需在 Safari 中启用扩展，并允许它读取和修改 x.com；这是内容脚本运行所需的
网站访问权限，不代表扩展会上传浏览数据。

## 技术结构

```text
extension/ (WXT + React + TypeScript)
  └─ npm run build:safari
      └─ extension/.output/safari-mv3 (生成，不提交)
          └─ apple/MXGA/Shared (Extension)（两个平台 target 共用）

apple/MXGA/MXGA.xcodeproj
  ├─ MXGA (macOS)                    SwiftUI macOS 容器
  ├─ MXGA Extension (macOS)          macOS Safari 扩展
  ├─ MXGA (iOS)                      SwiftUI iOS / iPadOS 容器
  └─ MXGA Extension (iOS)            iOS / iPadOS Safari 扩展
```

- 最低系统：macOS 15.0 / Safari 18.0
- Manifest：V3
- Swift：Swift 6，严格并发检查
- 默认 App Bundle ID：`tv.zuoluo.mxga`
- 默认 Extension Bundle ID：`tv.zuoluo.mxga.SafariExtension`
- 可通过 `APP_BUNDLE_IDENTIFIER` 同时切换 App 与扩展的 Bundle ID 前缀

## 本地签名配置

唯一的 Apple Xcode 工程继承 `apple/Config/Signing.xcconfig`，其中四个 target 共用本地签名设置。首次开发时创建一份不会被 Git 跟踪的本地配置：

```bash
cp apple/Config/Signing.local.xcconfig.example \
  apple/Config/Signing.local.xcconfig
# 编辑 Signing.local.xcconfig，填写 Team ID 与 App Bundle ID
# DEVELOPMENT_TEAM = 你的 Team ID
# APP_BUNDLE_IDENTIFIER = studio.tutu.mxga
```

`APP_BUNDLE_IDENTIFIER` 默认为 `tv.zuoluo.mxga`，扩展 ID 会自动派生为
`$(APP_BUNDLE_IDENTIFIER).SafariExtension`。之后直接在 Xcode 运行 `MXGA (macOS)` 或 `MXGA (iOS)` scheme 都会自动使用本地 Team 与 Bundle ID。没有本地配置时，无签名命令行构建继续使用默认 Bundle ID；命令行传入 `DEVELOPMENT_TEAM=... APP_BUNDLE_IDENTIFIER=...` 时则以命令行值为准。

## 本地构建

要求：Node.js 20+、Xcode 26 或更新版本。

```bash
npm --prefix extension install

# 构建；没有本地 Team 配置时生成未签名产物
./scripts/build-safari-app.sh

# 开发使用：签名、安装到 /Applications 并启动
DEVELOPMENT_TEAM=<你的 Apple Team ID> INSTALL_APP=1 \
  ./scripts/build-safari-app.sh
```

脚本会先拉取 `data-mirror` 分支上的最新 `data/blacklist/v2-lite.json`（离线或拉取失败时回退到本地 checkout 的副本，`--offline` 或 `MXGA_LIST_OFFLINE=1` 可强制离线），压缩为 Safari 的首屏/离线回退快照并生成 `.output/safari-mv3`，随后清理临时 public 文件并构建容器应用。后台同步成功后会热替换这份快照。产物位置固定为：

```text
.build/safari/Build/Products/Debug/MXGA.app
```

没有 `Signing.local.xcconfig` 且未设置 `DEVELOPMENT_TEAM` 时，脚本只生成用于编译检查的未签名产物。即使手动复制到
`/Applications`，Safari 也无法管理其中的扩展。设置开发团队后默认启用签名；
`INSTALL_APP=1` 还会复制应用、刷新 Launch Services/PlugInKit 注册并启动应用。

也可以分开执行：

```bash
cd extension
npm run build:safari
open ../apple/MXGA/MXGA.xcodeproj
```

> Xcode 工程引用被忽略的 `.output/safari-mv3`，因此全新 checkout 后必须先执行一次
> `npm run build:safari`。WXT 的 `chunks/`、`assets/` 使用文件夹引用，哈希文件名变化
> 不需要重新运行 converter。

## 运行与手动验证

1. 在 Xcode 的 Signing & Capabilities 中选择开发团队。
2. 运行 `MXGA (macOS)` scheme。
3. 在容器应用中点击“打开 Safari 扩展设置”。
4. 启用 Make X Great Again。
5. 打开 x.com，并允许扩展读取和修改该网站。
6. 在网络同步完成前先验证内置名单可以命中，再在 popup 确认同步成功并验证热更新、分类自动处理、本地隐藏、5 秒撤销和设置页恢复。

7. 在设置页选择 X 静音或拉黑；若 X 上没有徽标或动作未执行，请在 Safari → 设置 → 扩展 → Make X Great Again 中允许访问 x.com，然后使用测试账号验证手动处理与分类自动处理。

至少覆盖：内置回退名单、首次名单同步及热更新、离线启动、普通/无痕窗口、网站权限拒绝与允许、多标签页、深浅色模式、应用升级后本地数据保留、X 静音/拉黑的授权与限速重试，以及 Safari 回收后台 Service Worker 后的恢复。

## Release 构建

```bash
DEVELOPMENT_TEAM=<你的 Apple Team ID> \
  CONFIGURATION=Release CODE_SIGNING_ALLOWED=YES \
  ./scripts/build-safari-app.sh
```

正式归档仍应在 Xcode 中配置团队、App Store provisioning、版本号和商店元数据后执行。
发布前检查最终 extension manifest 的可选 host 权限仅包含 x.com、twitter.com 与 GitHub，并根据只读名单同步、可选 X 原生动作与可选白名单申请数据流核对 App Privacy 声明。
