import { useCallback, useEffect, useRef, useState } from "react";
import { AuthError } from "./adminApi";

/** Applied filter set: server query-param name → value ("" = off). */
export type Filters = Record<string, string>;

export const PAGE_SIZE = 100;

export function filterQuery(
  filters: Filters,
  sort: string,
  page: number,
  withTotal: boolean,
): string {
  const parts = [`limit=${PAGE_SIZE}`, `offset=${page * PAGE_SIZE}`];
  if (sort) parts.push(`sort=${encodeURIComponent(sort)}`);
  if (withTotal) parts.push("total=1");
  for (const [k, v] of Object.entries(filters)) {
    if (v) parts.push(`${k}=${encodeURIComponent(v)}`);
  }
  return `?${parts.join("&")}`;
}

/** Page-numbered list driven by one filter object, shared by 待审队列 and 黑名单.
 *  The match total is fetched when the filter set changes and reused while
 *  paging — turning a page must not re-scan the partition just to redraw the
 *  same number. */
export function useFilteredList<T>(
  fetchPage: (qs: string) => Promise<{ rows: T[]; total?: number | null; sort?: string }>,
  defaultSort: string,
  onAuth: () => void,
  initialFilters: Filters = {},
) {
  const [rows, setRows] = useState<T[]>([]);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sort, setSort] = useState(defaultSort);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestId = useRef(0);
  // The fetch closes over tab state; keep it in a ref so `run` stays stable and
  // a re-render can't schedule a duplicate initial load.
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  const run = useCallback(
    async (f: Filters, so: string, p: number, withTotal: boolean) => {
      const id = ++requestId.current;
      setLoading(true);
      setError(false);
      try {
        let r = await fetchRef.current(filterQuery(f, so, p, withTotal));
        if (id !== requestId.current) return;
        if (withTotal && typeof r.total === "number" && p > 0 && p * PAGE_SIZE >= r.total) {
          const last = Math.max(0, Math.ceil(r.total / PAGE_SIZE) - 1);
          setPage(last);
          r = await fetchRef.current(filterQuery(f, so, last, true));
          if (id !== requestId.current) return;
        }
        setRows(r.rows);
        if (withTotal && typeof r.total === "number") setTotal(r.total);
        if (r.sort) setSort(r.sort);
      } catch (e) {
        if (id !== requestId.current) return;
        setError(true);
        setRows([]);
        if (e instanceof AuthError) onAuth();
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [onAuth],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only initial load
  useEffect(() => {
    run(initialFilters, defaultSort, 0, true);
    return () => { requestId.current++; };
  }, []);

  const apply = useCallback(
    (f: Filters, so?: string) => {
      const nextSort = so ?? sort;
      setFilters(f);
      setSort(nextSort);
      setPage(0);
      run(f, nextSort, 0, true);
    },
    [run, sort],
  );

  const goPage = useCallback(
    (p: number) => {
      setPage(p);
      run(filters, sort, p, false);
    },
    [run, filters, sort],
  );

  /** After a mutation: same page, and re-count (rows may have left the set). */
  const reload = useCallback(() => run(filters, sort, page, true), [run, filters, sort, page]);

  const pageCount = total == null ? null : Math.max(1, Math.ceil(total / PAGE_SIZE));
  return { rows, setRows, filters, sort, page, total, pageCount, loading, error, apply, goPage, reload };
}
