import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { fmtN, PAGE_SIZE_LABEL } from "@/lib/format";

/** Which page buttons to show: always first/last and a window around the
 *  current page, with ellipses standing in for the rest. 2,013 pages can't all
 *  be buttons. */
function pageWindow(page: number, count: number): (number | "…")[] {
  const out: (number | "…")[] = [];
  const push = (n: number) => out.push(n);
  const from = Math.max(1, page - 1);
  const to = Math.min(count - 2, page + 1);
  push(0);
  if (from > 1) out.push("…");
  for (let i = from; i <= to; i++) push(i);
  if (to < count - 2) out.push("…");
  if (count > 1) push(count - 1);
  return out;
}

/** Page navigation + "命中 N 条" for a filtered list. Replaces the old
 *  「加载更多」 accumulator, which asked the maintainer to click 2,000 times to
 *  reach the end of a 200K list and only ever showed how much had been loaded,
 *  never how much matched. */
export function ListPager({
  page,
  pageCount,
  total,
  loaded,
  onPage,
}: {
  page: number;
  pageCount: number | null;
  total: number | null;
  loaded: number;
  onPage: (p: number) => void;
}) {
  const last = (pageCount ?? 1) - 1;
  const from = total === 0 ? 0 : page * 100 + 1;
  const to = page * 100 + loaded;
  return (
    <div className="flex flex-col items-center gap-2 py-4 text-[12.5px] text-muted-foreground">
      <span>
        {total == null ? (
          `已加载 ${fmtN(loaded)} 条`
        ) : (
          <>
            命中 <b className="tabular-nums text-foreground">{fmtN(total)}</b> 条 · 当前第{" "}
            <b className="tabular-nums text-foreground">{fmtN(page + 1)}</b>/{fmtN(pageCount ?? 1)}{" "}
            页（{fmtN(from)}–{fmtN(to)}）{PAGE_SIZE_LABEL}
          </>
        )}
      </span>
      {(pageCount ?? 1) > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                aria-disabled={page === 0}
                className={page === 0 ? "pointer-events-none opacity-40" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  if (page > 0) onPage(page - 1);
                }}
              />
            </PaginationItem>
            {pageWindow(page, pageCount ?? 1).map((p, i) =>
              p === "…" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: ellipses have no id
                <PaginationItem key={`gap-${i}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink
                    href="#"
                    isActive={p === page}
                    onClick={(e) => {
                      e.preventDefault();
                      onPage(p);
                    }}
                  >
                    {p + 1}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <PaginationNext
                href="#"
                aria-disabled={page >= last}
                className={page >= last ? "pointer-events-none opacity-40" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  if (page < last) onPage(page + 1);
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
