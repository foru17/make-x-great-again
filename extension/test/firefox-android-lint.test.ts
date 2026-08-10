import assert from "node:assert/strict";
import test from "node:test";
import { androidCompatibilityFindings } from "../scripts/lint-firefox-android";

test("Android lint gate ignores generic warnings", () => {
  const findings = androidCompatibilityFindings({
    errors: [],
    warnings: [{ code: "UNSAFE_VAR_ASSIGNMENT", message: "existing warning" }],
  });

  assert.deepEqual(findings, []);
});

test("Android lint gate rejects Android API and minimum-version findings", () => {
  const findings = androidCompatibilityFindings({
    errors: [],
    warnings: [
      { code: "ANDROID_INCOMPATIBLE_API", message: "unsupported API" },
      {
        code: "KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION",
        message: "Android minimum too low",
      },
      {
        code: "KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION",
        message: "desktop minimum too low",
      },
    ],
  });

  assert.deepEqual(
    findings.map((finding) => finding.code),
    [
      "ANDROID_INCOMPATIBLE_API",
      "KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION",
      "KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION",
    ],
  );
});

test("Android lint gate rejects validator errors", () => {
  const findings = androidCompatibilityFindings({
    errors: [{ code: "MANIFEST_INVALID", message: "invalid manifest" }],
    warnings: [],
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.code, "MANIFEST_INVALID");
});
