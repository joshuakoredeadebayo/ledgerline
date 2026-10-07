/** Shared helpers for the Audit log page and its CSV export. */

export const AUDIT_CATEGORIES: { value: string; label: string; prefixes: string[] }[] = [
  { value: "all", label: "All activity", prefixes: [] },
  { value: "matching", label: "Matching", prefixes: ["match."] },
  { value: "reconciliation", label: "Reconciliation", prefixes: ["reconciliation."] },
  { value: "close", label: "Period close", prefixes: ["close_period.", "close_checklist_item."] },
  { value: "entities", label: "Entities & accounts", prefixes: ["entity.", "account."] },
  { value: "members", label: "Members & invitations", prefixes: ["member.", "invitation."] },
  { value: "organization", label: "Organization", prefixes: ["organization.", "audit_log."] },
];

/** Narrows an audit_log query to one category (no-op for "all" or unknown values). */
export function applyAuditCategory<T extends { or: (filters: string) => T }>(query: T, category: string | undefined): T {
  const found = AUDIT_CATEGORIES.find((c) => c.value === category);
  if (!found || found.prefixes.length === 0) return query;
  // PostgREST uses * as the wildcard inside or(...) filters.
  return query.or(found.prefixes.map((p) => `action.like.${p}*`).join(","));
}

/** "match.created_manual" -> "Match created manual" */
export function humanizeAction(action: string): string {
  const text = action.replace(/[._]/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type Json = Record<string, unknown> | null | undefined;

const isPrimitive = (v: unknown): v is string | number | boolean => ["string", "number", "boolean"].includes(typeof v);

/** One short line describing what changed, e.g. "role: accountant → controller". */
export function summarizeChange(before: Json, after: Json): string {
  const source = after ?? before;
  if (!source) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (!isPrimitive(value)) continue;
    const prior = after && before ? before[key] : undefined;
    parts.push(
      prior !== undefined && isPrimitive(prior) && prior !== value
        ? `${key}: ${prior} → ${value}`
        : `${key}: ${value}`
    );
    if (parts.length === 3) break;
  }
  const text = parts.join(" · ");
  return text.length > 110 ? `${text.slice(0, 107)}…` : text;
}
