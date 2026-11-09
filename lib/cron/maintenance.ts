/**
 * Housekeeping the daily job does so the database doesn't grow without limit: old notifications that have
 * already been read, and old entries in the job log. Works in small batches and stops at the deadline, so it
 * can never hold up the real work or run long.
 */

const READ_NOTIFICATION_DAYS = 90;
const JOB_LOG_DAYS = 180;
const BATCH = 500;
const MAX_BATCHES = 6;

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

async function deleteInBatches(admin: any, table: string, buildSelect: () => any, deadlineAt: number): Promise<number> {
  let removed = 0;
  for (let i = 0; i < MAX_BATCHES && Date.now() < deadlineAt; i++) {
    const { data, error } = await buildSelect().limit(BATCH);
    if (error || !data || data.length === 0) break;
    const ids = (data as { id: string }[]).map((r) => r.id);
    const { error: deleteError } = await admin.from(table).delete().in("id", ids);
    if (deleteError) break;
    removed += ids.length;
    if (ids.length < BATCH) break;
  }
  return removed;
}

export async function pruneOldRows(admin: any, deadlineAt: number): Promise<{ notifications: number; jobRuns: number }> {
  const notifications = await deleteInBatches(
    admin,
    "notifications",
    () => admin.from("notifications").select("id").not("read_at", "is", null).lt("created_at", daysAgo(READ_NOTIFICATION_DAYS)),
    deadlineAt
  );
  const jobRuns = await deleteInBatches(admin, "job_runs", () => admin.from("job_runs").select("id").lt("ran_at", daysAgo(JOB_LOG_DAYS)), deadlineAt);
  return { notifications, jobRuns };
}
