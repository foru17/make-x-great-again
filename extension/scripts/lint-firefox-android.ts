import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

interface LintFinding {
  code?: string;
  message?: string;
  description?: string;
}

interface LintReport {
  errors?: LintFinding[];
  warnings?: LintFinding[];
  summary?: {
    errors?: number;
    warnings?: number;
  };
}

const BLOCKING_WARNING_CODES = new Set([
  "ANDROID_INCOMPATIBLE_API",
  "KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION",
  "KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION",
]);

/**
 * Keep existing generic AMO warnings visible without allowing Android
 * compatibility regressions to pass CI.
 */
export function androidCompatibilityFindings(report: LintReport): LintFinding[] {
  const errors = Array.isArray(report.errors) ? report.errors : [];
  const warnings = Array.isArray(report.warnings) ? report.warnings : [];
  return [
    ...errors,
    ...warnings.filter((warning) => BLOCKING_WARNING_CODES.has(warning.code ?? "")),
  ];
}

function main() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    npm,
    [
      "exec",
      "--yes",
      "--package=web-ext@10.6.0",
      "--",
      "web-ext",
      "lint",
      "--source-dir",
      ".output/firefox-mv3",
      "--output",
      "json",
    ],
    { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] },
  );

  if (result.error) throw result.error;

  let report: LintReport;
  try {
    report = JSON.parse(result.stdout) as LintReport;
  } catch (error) {
    process.stderr.write(result.stdout);
    throw new Error(
      `web-ext returned invalid JSON: ${error instanceof Error ? error.message : error}`,
    );
  }

  const findings = androidCompatibilityFindings(report);
  const summary = report.summary ?? {};
  console.log(
    `web-ext: ${summary.errors ?? 0} errors, ${summary.warnings ?? 0} warnings; ` +
      `${findings.length} Android compatibility blockers`,
  );

  if (findings.length > 0 || result.status !== 0) {
    for (const finding of findings) {
      console.error(`${finding.code ?? "VALIDATION_ERROR"}: ${finding.message ?? "validation failed"}`);
      if (finding.description) console.error(`  ${finding.description}`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
