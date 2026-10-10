/**
 * Supabase returns at most 1,000 rows per request, silently. That is fine for a screen that
 * pages, and dangerous for a report that must be complete. This keeps asking for the next
 * page until a short page comes back, so a report never quietly leaves rows out.
 *
 * `build` receives the row range for each request and returns the query for it, e.g.
 *   fetchAll((from, to) => supabase.from("transactions").select("*").eq("account_id", id).range(from, to))
 */
export async function fetchAll<T = any>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  { pageSize = 1000, maxRows = 50000 }: { pageSize?: number; maxRows?: number } = {}
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

/** Splits a list so long `in (...)` filters stay within URL limits. */
export function chunkList<T>(items: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
