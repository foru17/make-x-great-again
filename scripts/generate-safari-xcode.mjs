#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = process.cwd();
const extDir = path.join(rootDir, "extension");
const defaultProjectLocation = path.join(rootDir, "safari-xcode");

function usage() {
  console.log(`用法:
  node scripts/generate-safari-xcode.mjs [--project-location <路径>] [--app-name <项目名>] [--bundle-id <Bundle ID>] [--skip-install] [--skip-build] [--copy-resources]

参数说明:
  --project-location   Xcode 工程输出目录，默认: safari-xcode
  --app-name           Xcode 工程 App 名称，默认: make-x-great-again-safari
  --bundle-id          App Bundle ID，默认: com.mxga.extension
  --skip-install       跳过 extension 依赖安装
  --skip-build         跳过 extension build:safari
  --copy-resources     显式复制前端资源到 Xcode 工程（默认关闭）
  --help               查看帮助

环境变量:
  MXGA_XCODE_PACKAGER  指定 converter 可执行文件，默认: xcrun safari-web-extension-packager
  MXGA_XCODE_SKIP_INSTALL=1 自动跳过安装
`);
  process.exit(0);
}

function parseArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

const opts = {
  projectLocation: parseArg("--project-location", defaultProjectLocation),
  appName: parseArg("--app-name", "make-x-great-again-safari"),
  bundleId: parseArg("--bundle-id", "com.mxga.extension"),
};
if (process.argv.includes("--help") || process.argv.includes("-h")) usage();

const includeCopyResources = process.argv.includes("--copy-resources");
const skipInstall = process.argv.includes("--skip-install") || process.env.MXGA_XCODE_SKIP_INSTALL === "1";
const skipBuild = process.argv.includes("--skip-build");

function run(cmd, args, cwd = rootDir) {
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`[${cmd}] failed with code ${result.status}`);
  }
}

function commandExists(cmd) {
  const r = spawnSync("which", [cmd], { stdio: "ignore" });
  return r.status === 0;
}

function findSafariOutput() {
  const outDir = path.join(extDir, ".output");
  if (!existsSync(outDir)) {
    throw new Error(
      `未找到 ${outDir}，请先执行 npm/pnpm build:safari 生成 Safari 产物。`
    );
  }

  const candidates = readdirSync(outDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => name.includes("safari"));

  if (candidates.length === 0) {
    throw new Error(`未在 ${outDir} 找到 Safari build 目录`);
  }

  if (candidates.includes("safari-mv2-safari")) {
    return path.join(outDir, "safari-mv2-safari");
  }

  if (candidates.includes("safari-mv3-safari")) {
    return path.join(outDir, "safari-mv3-safari");
  }

  return path.join(outDir, candidates[0]);
}

function resolvePackager() {
  const override = process.env.MXGA_XCODE_PACKAGER;
  if (override) return { cmd: override, args: [] };

  const finder = spawnSync("xcrun", ["--find", "safari-web-extension-packager"]);
  if (finder.status === 0) return { cmd: "xcrun", args: ["safari-web-extension-packager"] };
  if (commandExists("safari-web-extension-packager")) {
    return { cmd: "safari-web-extension-packager", args: [] };
  }
  throw new Error("未找到 safari-web-extension-packager，建议安装 Xcode Command Line Tools 并确保命令可用。");
}

function readExtensionDisplayName(webextDir) {
  const manifestPath = path.join(webextDir, "manifest.json");
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (typeof manifest.name === "string" && manifest.name.trim()) {
      return manifest.name.trim();
    }
  } catch {
    // Keep the generated project usable even if the manifest cannot be parsed.
  }
  return opts.appName;
}

function setPlistValue(plistPath, key, value) {
  if (!existsSync(plistPath)) return;

  const print = spawnSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plistPath], {
    stdio: "ignore",
  });
  const command = print.status === 0 ? `Set :${key} ${value}` : `Add :${key} string ${value}`;
  const result = spawnSync("/usr/libexec/PlistBuddy", ["-c", command, plistPath], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`更新 ${plistPath} 的 ${key} 失败`);
  }
}

function normalizeBundleDisplayNames(displayName) {
  const projectDir = path.join(opts.projectLocation, opts.appName);
  const plistPaths = [
    path.join(projectDir, "iOS (App)", "Info.plist"),
    path.join(projectDir, "macOS (App)", "Info.plist"),
    path.join(projectDir, "iOS (Extension)", "Info.plist"),
    path.join(projectDir, "macOS (Extension)", "Info.plist"),
  ];

  for (const plistPath of plistPaths) {
    setPlistValue(plistPath, "CFBundleDisplayName", displayName);
    setPlistValue(plistPath, "CFBundleName", displayName);
  }

  const pbxprojPath = path.join(projectDir, `${opts.appName}.xcodeproj`, "project.pbxproj");
  if (existsSync(pbxprojPath)) {
    const quotedDisplayName = displayName.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    const pbxproj = readFileSync(pbxprojPath, "utf8")
      .replaceAll(
        /INFOPLIST_KEY_CFBundleDisplayName = ".*?";/g,
        `INFOPLIST_KEY_CFBundleDisplayName = "${quotedDisplayName}";`
      );
    writeFileSync(pbxprojPath, pbxproj);
  }
}

async function main() {
  if (!existsSync(path.join(extDir, "node_modules"))) {
    if (skipInstall) {
      console.warn("未检测到 extension/node_modules，且 --skip-install 已开启；将直接尝试使用现有环境。");
    } else {
      run("pnpm", ["install", "--ignore-scripts"], extDir);
    }
  }

  if (!skipBuild) {
    run("pnpm", ["run", "build:safari"], extDir);
  }

  const webextDir = findSafariOutput();
  const packager = resolvePackager();

  const args = [
    ...packager.args,
    webextDir,
    "--project-location",
    opts.projectLocation,
    "--app-name",
    opts.appName,
    "--bundle-identifier",
    opts.bundleId,
    "--force",
    "--no-open",
    "--no-prompt",
  ];
  if (includeCopyResources) args.push("--copy-resources");

  run(packager.cmd, args);
  normalizeBundleDisplayNames(readExtensionDisplayName(webextDir));

  console.log("Safari 工程已生成（未复制资源）");
  console.log(`项目路径: ${opts.projectLocation}`);
  console.log("后续可直接在仓库目录打开并构建：");
  console.log("  open", opts.projectLocation);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
