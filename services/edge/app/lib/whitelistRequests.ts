export function omitResolvedRequests<T extends { id: number }>(
  rows: T[],
  resolvedIds: Iterable<number>,
): T[] {
  const resolved = new Set(resolvedIds);
  return resolved.size === 0 ? rows : rows.filter((row) => !resolved.has(row.id));
}
