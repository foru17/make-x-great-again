import { SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Filters } from "@/lib/useFilteredList";
import { cn } from "@/lib/utils";
import { DIM_KEYS, DimFilterFields, dimChipList } from "./DimFilterFields";

/** The whole filter surface for a list tab: 搜索 + 排序 + 更多筛选 panel +
 *  applied-condition chips + the filter-scoped batch entry. 待审队列 and 黑名单
 *  render this same component, so the two tabs cannot drift in layout, copy or
 *  filter grammar — which is exactly how they drifted before. */

const TEXT_FIELDS: { k: string; label: string; ph: string }[] = [
  { k: "handle", label: "Handle 包含", ph: "如 spam_" },
  { k: "uid", label: "UID 前缀", ph: "如 2056413" },
  { k: "evidence", label: "推文内容包含", ph: "如 比她好看" },
  { k: "display_name", label: "显示名包含", ph: "如 Mary" },
  { k: "reasons", label: "判定理由包含", ph: "如 导流模板" },
];
const TEXT_CHIP_LABEL: Record<string, string> = {
  q: "搜索",
  uid: "UID 前缀",
  handle: "Handle",
  evidence: "推文内容",
  display_name: "显示名",
  reasons: "判定理由",
};

export const FILTER_KEYS = ["q", ...TEXT_FIELDS.map((f) => f.k), ...DIM_KEYS];
export const EMPTY_FILTERS: Filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, ""]));

/** Human-readable chips for the currently applied conditions. */
export function chipList(filters: Filters): { key: string; text: string }[] {
  return [
    ...Object.keys(TEXT_CHIP_LABEL)
      .filter((k) => filters[k])
      .map((k) => ({ key: k, text: `${TEXT_CHIP_LABEL[k]}：${filters[k]}` })),
    ...dimChipList(filters),
  ];
}

export function FilterPanel({
  mode,
  filters,
  sort,
  sortOptions,
  searchPlaceholder,
  onApply,
  quick,
  batchMenu,
}: {
  mode: "queue" | "blacklist";
  filters: Filters;
  sort: string;
  sortOptions: { value: string; label: string }[];
  searchPlaceholder: string;
  onApply: (f: Filters, sort?: string) => void;
  /** One-click chips over a single dimension (判定 for 待审, 类别 for 黑名单). */
  quick?: { key: string; allLabel: string; options: { value: string; zh: string }[] };
  /** Items for the 「对命中的全部…」 dropdown; omitted = no filter-scoped batch. */
  batchMenu?: React.ReactNode;
}) {
  const [adv, setAdv] = useState(false);
  const [draft, setDraft] = useState<Filters>(filters);
  const searchRef = useRef<HTMLInputElement>(null);

  // The tab can apply filters without going through this panel (「找同类」 sets a
  // handle/uid straight off a row). Keep the draft in step so opening 更多筛选
  // afterwards shows what is actually applied, not a stale draft.
  useEffect(() => setDraft(filters), [filters]);

  // The panel edits a draft; 应用筛选 (or Enter) commits every field at once so
  // a multi-condition combo lands as a single reload.
  const applyDraft = (over: Filters = {}) =>
    onApply({ ...draft, q: searchRef.current?.value.trim() ?? filters.q ?? "", ...over });
  const applyOne = (over: Filters) => {
    const next = { ...filters, ...over };
    setDraft(next);
    onApply(next);
  };
  const allChips = chipList(filters);
  const advCount = allChips.filter((c) => c.key !== "q").length;
  // The quick-chip row already shows that dimension's state; don't also list it
  // as a removable chip.
  const chips = allChips.filter((c) => c.key !== quick?.key);

  return (
    <div>
      <form
        className="mb-3 grid grid-cols-1 items-end gap-2.5 sm:grid-cols-[minmax(220px,1fr)_180px_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          applyDraft();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label className="text-[11.5px] font-normal text-muted-foreground">搜索</Label>
          <Input
            ref={searchRef}
            type="search"
            key={filters.q || ""}
            defaultValue={filters.q || ""}
            placeholder={searchPlaceholder}
            className="h-9"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-[11.5px] font-normal text-muted-foreground">排序</Label>
          <Select value={sort} onValueChange={(s) => onApply(filters, s)}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" variant="outline" size="sm" className="h-9">
            搜索
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => setAdv((v) => !v)}
          >
            <SlidersHorizontal className="size-3.5" /> 更多筛选{advCount > 0 && ` · ${advCount}`}
          </Button>
        </div>
      </form>

      {adv && (
        <div className="mb-3 rounded-lg border bg-muted/40 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TEXT_FIELDS.map((f) => (
              <div key={f.k} className="flex flex-col gap-1.5">
                <Label className="text-[11.5px] font-normal text-muted-foreground">{f.label}</Label>
                <Input
                  value={draft[f.k] || ""}
                  placeholder={f.ph}
                  className="h-8"
                  onChange={(e) => setDraft((d) => ({ ...d, [f.k]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyDraft();
                    }
                  }}
                />
              </div>
            ))}
            <DimFilterFields
              mode={mode}
              draft={draft}
              setDraft={setDraft}
              onEnter={() => applyDraft()}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              文本字段是「包含」匹配（UID 是「前缀」）；所有条件 AND 组合。回车或「应用筛选」生效。
            </span>
            <div className="flex items-center gap-2">
              {chips.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    setDraft(EMPTY_FILTERS);
                    onApply(EMPTY_FILTERS);
                  }}
                >
                  清空筛选
                </Button>
              )}
              <Button size="sm" className="h-8" onClick={() => applyDraft()}>
                应用筛选
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Shown whenever ANY condition is applied — including a lone quick chip.
          Gating on the removable-chip list alone hid the batch entry in the
          most obvious flow there is: pick 类别 → 对命中的全部归类. */}
      {allChips.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <button
              type="button"
              key={chip.key}
              title="点击移除该条件"
              onClick={() => applyOne({ [chip.key]: "" })}
              className="group flex items-center gap-1 rounded-full border border-ring/40 bg-accent/60 px-2.5 py-1 text-[11.5px] text-foreground transition hover:border-destructive/50 hover:text-destructive"
            >
              {chip.text}
              <X className="size-3 opacity-60 transition group-hover:opacity-100" />
            </button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11.5px] text-muted-foreground"
            onClick={() => {
              setDraft(EMPTY_FILTERS);
              onApply(EMPTY_FILTERS);
            }}
          >
            全部清除
          </Button>
          {batchMenu && (
            <div className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7">
                    对命中的全部批量操作 ▾
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">{batchMenu}</DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      )}

      {quick && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {[{ value: "", zh: quick.allLabel }, ...quick.options].map((o) => {
            const active = (filters[quick.key] || "") === o.value;
            return (
              <button
                type="button"
                key={o.value || "all"}
                onClick={() => applyOne({ [quick.key]: o.value })}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {o.zh}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
