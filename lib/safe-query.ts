/**
 * Ledgerline's database is updated in steps (the numbered SQL files). If the app code for a step goes live
 * before its SQL has been run, a query that names a new column fails. Rather than letting that look like
 * "no data", pages use these helpers to fall back to the older query, keep working, and say what's missing.
 */

export interface QueryError {
  code?: string;
  message?: string;
}

/** True when a query failed because it named a column that doesn't exist yet (a SQL update hasn't been run). */
export function isMissingColumn(error: QueryError | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || /column .* does not exist/i.test(error.message ?? "") || /could not find the .* column/i.test(error.message ?? "");
}

/** True when a query failed because a table (or relationship) doesn't exist yet. */
export function isMissingTable(error: QueryError | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /relation .* does not exist/i.test(error.message ?? "") || /could not find the table/i.test(error.message ?? "");
}

export interface FallbackResult<T> {
  data: T | null;
  count?: number | null;
  error: QueryError | null;
  /** The newer query failed for a missing column, so the older one was used. */
  degraded: boolean;
}

/** Runs `primary`; if it fails only because of a missing column, runs `fallback` instead and flags it. */
export async function withFallback<T = any>(
  primary: () => PromiseLike<{ data: T | null; count?: number | null; error: QueryError | null }>,
  fallback: () => PromiseLike<{ data: T | null; count?: number | null; error: QueryError | null }>
): Promise<FallbackResult<T>> {
  const first = await primary();
  if (!first.error) return { ...first, degraded: false };
  if (isMissingColumn(first.error) || isMissingTable(first.error)) {
    const second = await fallback();
    return { ...second, degraded: true };
  }
  return { ...first, degraded: false };
}
