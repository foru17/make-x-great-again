// The background owns mutations shared by X tabs and extension pages.
// Per-page Promise chains cannot serialize chrome.storage read/modify/write
// across origins; one background queue also coordinates backup imports.
import type { BackupFile, BackupSection, ImportMode } from "./backup";
import type { LocalWhitelistMutation } from "./local-whitelist";
import type { BgResponse } from "./types";

export type LocalDataMutation =
  | { kind: "whitelist"; mutation: LocalWhitelistMutation }
  | { kind: "import"; file: BackupFile; mode: ImportMode; sections: Partial<Record<BackupSection, boolean>> };

export async function requestLocalDataMutation<T>(mutation: LocalDataMutation): Promise<T> {
  const response = await chrome.runtime.sendMessage({ type: "local-data", mutation }) as BgResponse;
  if (!response?.ok) throw new Error(response?.error ?? "本地数据写入失败");
  return response.data as T;
}
