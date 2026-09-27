import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CATEGORIES, VERDICTS } from "@/lib/format";

/** Structured dimension filters shared by 待审队列 / 黑名单.
 *  Draft values are plain strings ("" = off) keyed by the server's query
 *  param names, so the tab can pass them straight through to the API. */

export type DimDraft = Record<string, string>;

export const DIM_KEYS = [
  "followers_min",
  "followers_max",
  "following_min",
  "following_max",
  "created_after",
  "created_before",
  "category",
  "verdict",
  "source",
  "tier",
] as const;

export const SOURCE_OPTIONS: { value: string; zh: string }[] = [
  { value: "report", zh: "手动举报" },
  { value: "block", zh: "X 屏蔽确认" },
  { value: "auto_scan", zh: "自动扫描" },
  { value: "auto_keyword", zh: "规则命中" },
  { value: "auto_keyword_mention", zh: "提及连带" },
  { value: "import", zh: "导入" },
];

export const TIER_OPTIONS: { value: string; zh: string }[] = [
  { value: "human", zh: "人工确认" },
  { value: "rule", zh: "规则自动" },
  { value: "ai", zh: "AI 自动" },
  { value: "mention", zh: "提及连带" },
];

const CREATED_PRESETS: { value: string; zh: string; days?: number; older?: boolean }[] = [
  { value: "any", zh: "不限" },
  { value: "7d", zh: "7 天内注册", days: 7 },
  { value: "30d", zh: "30 天内注册", days: 30 },
  { value: "90d", zh: "90 天内注册", days: 90 },
  { value: "365d", zh: "1 年内注册", days: 365 },
  { value: "older1y", zh: "注册超过 1 年", days: 365, older: true },
];

function daysAgoYmd(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Human-readable chips for the currently APPLIED dimension filters. */
export function dimChipList(values: DimDraft): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  const add = (key: string, text: string) => {
    if ((values[key] || "").trim()) out.push({ key, text });
  };
  add("followers_min", `粉丝 ≥ ${values.followers_min}`);
  add("followers_max", `粉丝 ≤ ${values.followers_max}`);
  add("following_min", `关注 ≥ ${values.following_min}`);
  add("following_max", `关注 ≤ ${values.following_max}`);
  add("created_after", `注册晚于 ${values.created_after}`);
  add("created_before", `注册早于 ${values.created_before}`);
  add(
    "category",
    `类别：${CATEGORIES.find((c) => c.value === values.category)?.zh || values.category}`,
  );
  add("verdict", `判定：${VERDICTS[values.verdict || ""]?.zh || values.verdict}`);
  add("source", `来源：${SOURCE_OPTIONS.find((s) => s.value === values.source)?.zh || values.source}`);
  add("tier", `收录：${TIER_OPTIONS.find((t) => t.value === values.tier)?.zh || values.tier}`);
  return out;
}

function DimSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; zh: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[11.5px] font-normal text-muted-foreground">{label}</Label>
      <Select value={value || "any"} onValueChange={(v) => onChange(v === "any" ? "" : v)}>
        <SelectTrigger className="h-8 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">不限</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.zh}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function NumInput({
  label,
  value,
  ph,
  onChange,
  onEnter,
}: {
  label: string;
  value: string;
  ph: string;
  onChange: (v: string) => void;
  onEnter: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[11.5px] font-normal text-muted-foreground">{label}</Label>
      <Input
        type="number"
        min={0}
        value={value}
        placeholder={ph}
        className="h-8"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter();
          }
        }}
      />
    </div>
  );
}

/** The structured-dimension half of the advanced filter panel. Controlled:
 *  the parent owns the draft and applies it (all fields at once). */
export function DimFilterFields({
  mode,
  draft,
  setDraft,
  onEnter,
}: {
  mode: "queue" | "blacklist";
  draft: DimDraft;
  setDraft: (updater: (d: DimDraft) => DimDraft) => void;
  onEnter: () => void;
}) {
  const set = (k: string, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  // Which preset (if any) the current created_* pair corresponds to — keeps
  // the select in sync when a preset filled the dates.
  const presetValue = (() => {
    for (const p of CREATED_PRESETS) {
      if (!p.days) continue;
      const ymd = daysAgoYmd(p.days);
      if (p.older && draft.created_before === ymd && !draft.created_after) return p.value;
      if (!p.older && draft.created_after === ymd && !draft.created_before) return p.value;
    }
    return draft.created_after || draft.created_before ? "custom" : "any";
  })();
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label className="text-[11.5px] font-normal text-muted-foreground">注册时间</Label>
        <Select
          value={presetValue}
          onValueChange={(v) => {
            const p = CREATED_PRESETS.find((x) => x.value === v);
            if (!p || !p.days) {
              setDraft((d) => ({ ...d, created_after: "", created_before: "" }));
              return;
            }
            const ymd = daysAgoYmd(p.days);
            setDraft((d) =>
              p.older
                ? { ...d, created_after: "", created_before: ymd }
                : { ...d, created_after: ymd, created_before: "" },
            );
          }}
        >
          <SelectTrigger className="h-8 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CREATED_PRESETS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.zh}
              </SelectItem>
            ))}
            {presetValue === "custom" && (
              <SelectItem value="custom" disabled>
                自定义区间
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-[11.5px] font-normal text-muted-foreground">注册区间（起 / 止）</Label>
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={draft.created_after || ""}
            className="h-8"
            onChange={(e) => set("created_after", e.target.value)}
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            type="date"
            value={draft.created_before || ""}
            className="h-8"
            onChange={(e) => set("created_before", e.target.value)}
          />
        </div>
      </div>
      <NumInput
        label="粉丝数 ≥"
        value={draft.followers_min || ""}
        ph="如 0"
        onChange={(v) => set("followers_min", v)}
        onEnter={onEnter}
      />
      <NumInput
        label="粉丝数 ≤"
        value={draft.followers_max || ""}
        ph="如 50"
        onChange={(v) => set("followers_max", v)}
        onEnter={onEnter}
      />
      <NumInput
        label="关注数 ≥"
        value={draft.following_min || ""}
        ph="如 500"
        onChange={(v) => set("following_min", v)}
        onEnter={onEnter}
      />
      <NumInput
        label="关注数 ≤"
        value={draft.following_max || ""}
        ph="如 100"
        onChange={(v) => set("following_max", v)}
        onEnter={onEnter}
      />
      <DimSelect
        label="类别"
        value={draft.category || ""}
        options={CATEGORIES.map((c) => ({ value: c.value, zh: c.zh }))}
        onChange={(v) => set("category", v)}
      />
      <DimSelect
        label="判定"
        value={draft.verdict || ""}
        options={Object.entries(VERDICTS).map(([value, v]) => ({ value, zh: v.zh }))}
        onChange={(v) => set("verdict", v)}
      />
      {mode === "queue" ? (
        <DimSelect
          label="来源"
          value={draft.source || ""}
          options={SOURCE_OPTIONS}
          onChange={(v) => set("source", v)}
        />
      ) : (
        <DimSelect
          label="收录方式"
          value={draft.tier || ""}
          options={TIER_OPTIONS}
          onChange={(v) => set("tier", v)}
        />
      )}
    </>
  );
}
