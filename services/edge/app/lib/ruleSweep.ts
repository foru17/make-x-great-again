import type { api, RuleSweepCursor } from "./adminApi";

type SweepBatch = Awaited<ReturnType<typeof api.rulesApply>>;
export class RuleSweepError extends Error {}

/** A finite emergency ceiling, not a normal pause after a few pages. */
const MAX_SWEEP_REQUESTS = 10_000;

export async function sweepAllRules(
  scope: "queue" | "all",
  initialCursor: RuleSweepCursor | undefined,
  request: typeof api.rulesApply,
  onBatch: (result: SweepBatch) => void,
): Promise<void> {
  let cursor = initialCursor;
  for (let round = 0; round < MAX_SWEEP_REQUESTS; round++) {
    const result = await request(scope, cursor);
    if (!result.ok) throw new RuleSweepError("扫描请求失败，已保留此前进度。");
    if (!result.complete) {
      const next = result.nextCursor;
      const previous = cursor ?? { partition: 0, after: 0 };
      if (
        !next ||
        (cursor && next.fingerprint !== cursor.fingerprint) ||
        !(
          next.partition > previous.partition ||
          (next.partition === previous.partition && next.after > previous.after)
        )
      ) {
        throw new RuleSweepError("扫描进度未推进，已停止重复请求；请重试剩余记录。");
      }
    }
    onBatch(result);
    if (result.complete) return;
    cursor = result.nextCursor ?? undefined;
  }
  throw new RuleSweepError("扫描请求次数异常，已停止并保留进度；请检查后重试。");
}
