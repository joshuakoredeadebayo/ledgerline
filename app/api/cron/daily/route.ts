import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDueTemplates } from "@/lib/recurring-engine";
import { pruneOldRows } from "@/lib/cron/maintenance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Constant-time comparison, so the secret can't be guessed from how long a wrong one takes to reject. */
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The daily job. Vercel calls this once a day (see vercel.json) and sends the project's CRON_SECRET as a
 * bearer token. Anyone else is refused, so the address can't be used to trigger work.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ ok: false, error: "CRON_SECRET isn't set on the server." }, { status: 503 });

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ") || !sameSecret(header.slice(7), secret)) {
    return Response.json({ ok: false, error: "Not authorized." }, { status: 401 });
  }

  const admin = createAdminClient() as any;
  const started = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  // The platform allows this function 60 seconds. Stop starting new work after 40 and leave a margin; anything
  // not reached stays due and is picked up first on the next run (oldest first), so nothing is lost.
  const deadlineAt = started + 40_000;
  const summary: Record<string, unknown> = { today };
  let ok = true;
  const notes: string[] = [];

  try {
    const recurring = await runDueTemplates(admin, { today, deadlineAt, concurrency: 8 });
    summary.recurring = { ...recurring, problems: recurring.problems.slice(0, 20) };
    notes.push(`Recurring: ${recurring.created} prepared, ${recurring.failed} failed${recurring.timedOut ? `, ${recurring.deferred} left for the next run` : ""}.`);
    if (recurring.failed > 0) ok = false;
  } catch (err) {
    ok = false;
    notes.push(`Recurring failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const pruned = await pruneOldRows(admin, started + 50_000);
    summary.pruned = pruned;
    if (pruned.notifications + pruned.jobRuns > 0) notes.push(`Cleaned up ${pruned.notifications} old notifications.`);
  } catch (err) {
    notes.push(`Cleanup skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  const message = `${notes.join(" ")} (${((Date.now() - started) / 1000).toFixed(1)}s)`;
  summary.durationMs = Date.now() - started;

  // A line in the log so owners can see the job is running (Settings, Organization).
  await admin.from("job_runs").insert({ job: "daily", ok, message: message.slice(0, 500) });

  return Response.json({ ok, ...summary });
}
