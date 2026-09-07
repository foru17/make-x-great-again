import { applyBackupImport, parseBackup } from "./backup";
import { applyLocalWhitelistMutation } from "./local-whitelist";
import type { LocalDataMutation } from "./local-data";

let writes: Promise<unknown> = Promise.resolve();

/** Background-only entry point; callers always go through runtime messaging. */
export function handleLocalDataMutation(mutation: LocalDataMutation): Promise<unknown> {
  const run = writes.then(async () => {
    if (mutation.kind === "whitelist") return applyLocalWhitelistMutation(mutation.mutation);
    if (mutation.kind === "import") {
      const parsed = parseBackup(JSON.stringify(mutation.file));
      if (!parsed.ok) throw new Error(parsed.error);
      if (mutation.mode !== "merge" && mutation.mode !== "replace") throw new Error("无效的导入方式");
      return applyBackupImport(parsed.file, mutation.mode, mutation.sections);
    }
    throw new Error("未知的本地数据操作");
  });
  writes = run.catch(() => {});
  return run;
}
