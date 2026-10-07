import { NextResponse } from "next/server";
import { getCurrentMembership } from "@/lib/actions/membership";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { applyAuditCategory } from "@/lib/audit-log";

const MAX_ROWS = 10000;

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: Request) {
  const membership = await getCurrentMembership();
  if (!membership) return new NextResponse("Not signed in.", { status: 401 });
  if (!can(membership.role, "audit_log.export")) return new NextResponse("Forbidden.", { status: 403 });

  const category = new URL(request.url).searchParams.get("category") ?? undefined;
  const supabase = (await createClient()) as any;

  const { data, error } = await applyAuditCategory(
    supabase
      .from("audit_log")
      .select("created_at, actor_id, action, target_table, target_id, before, after")
      .eq("organization_id", membership.organizationId)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS),
    category
  );
  if (error) return new NextResponse(error.message, { status: 500 });

  const { data: roster } = await supabase.rpc("list_org_members", { p_org: membership.organizationId });
  const emailById = new Map<string, string>(((roster ?? []) as any[]).map((m) => [m.user_id, m.email]));

  const header = ["Time (UTC)", "Actor", "Action", "Target table", "Target id", "Before", "After"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of data ?? []) {
    lines.push(
      [
        r.created_at,
        r.actor_id ? (emailById.get(r.actor_id) ?? "Former member") : "System",
        r.action,
        r.target_table,
        r.target_id,
        r.before,
        r.after,
      ]
        .map(csvCell)
        .join(",")
    );
  }

  // The export itself is an auditable event.
  await supabase.from("audit_log").insert({
    organization_id: membership.organizationId,
    actor_id: membership.userId,
    action: "audit_log.exported",
    target_table: "audit_log",
    after: { rows: (data ?? []).length, category: category ?? "all" },
  });

  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse("\uFEFF" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${day}.csv"`,
    },
  });
}
