import { toast } from "sonner";
import { api, AuthError } from "@/lib/adminApi";
import { fmtN } from "@/lib/format";
import type { Filters } from "@/lib/useFilteredList";
import { chipList } from "./FilterPanel";
import { useConfirm } from "./confirm";

/** Filter-scoped batch: acts on EVERY row matching the current filters —
 *  including pages that were never loaded. Always two-phase: a dryRun count
 *  first, then an explicit confirmation that spells out the conditions, the
 *  row count and the per-call cap. 待审队列 and 黑名单 share this hook so the
 *  most destructive control in the console reads the same in both. */
export function useFilterBatch({
  scope,
  noun,
  filters,
  onAuth,
  onDone,
}: {
  scope: "queue" | "blacklist";
  /** What the matched rows are called in the confirm copy ("待审账号" / "公榜账号"). */
  noun: string;
  filters: Filters;
  onAuth: () => void;
  onDone: () => void;
}) {
  const confirm = useConfirm();
  return (
      action: "approve" | "reject" | "remove" | "whitelist" | "categorize",
      label: string,
      category?: string,
    ) =>
    async () => {
      const active = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      if (!Object.keys(active).length) {
        toast.info("先设一个筛选条件，再对命中的全部执行操作");
        return;
      }
      let matched = 0;
      try {
        const dry = await api.decideByFilter({ action, scope, category, dryRun: true, filters: active });
        matched = dry.matched;
      } catch (e) {
        if (e instanceof AuthError) onAuth();
        else toast.error("预检失败");
        return;
      }
      if (!matched) {
        toast.info(`当前筛选没有命中任何${noun}`);
        return;
      }
      const ok = await confirm({
        title: `按筛选批量${label}`,
        body: (
          <div className="space-y-2">
            <p>
              当前筛选共命中 <b>{fmtN(matched)}</b> 条{noun}（含未加载的分页），确认全部执行「
              {label}」？
            </p>
            <p className="flex flex-wrap gap-1 text-[11.5px] text-muted-foreground">
              {chipList(filters).map((c) => (
                <span key={c.key} className="rounded-full border px-2 py-0.5">
                  {c.text}
                </span>
              ))}
            </p>
            <p className="text-[11.5px] text-muted-foreground">
              单次最多执行 2,000 条（超出会提示再执行一轮）。写 review_log，不可批量撤回。
            </p>
          </div>
        ),
        okLabel: `${label}全部 ${fmtN(matched)} 条`,
        okVariant: "destructive",
      });
      if (!ok) return;
      const tid = toast.loading("批量执行中…");
      try {
        const r = await api.decideByFilter({ action, scope, category, filters: active });
        toast.success(
          `已处理 ${fmtN(r.processed ?? 0)} 条${
            r.truncated ? "，命中超过单次上限，可再执行一轮" : ""
          }`,
          { id: tid },
        );
        onDone();
      } catch (e) {
        if (e instanceof AuthError) onAuth();
        toast.error("批量执行失败", { id: tid });
      }
    };
}
