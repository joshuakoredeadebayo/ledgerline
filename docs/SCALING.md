# Scaling notes

What was done so Ledgerline keeps working as customers and data grow, and what to do next as it grows further.

## What is bounded today

- **Every list is paged or capped.** Lists show 50 per page (exceptions, journal entries, notifications up to 100).
  Reports fetch in pages of 1,000 until complete (`lib/fetch-all.ts`), so a busy month is never silently cut off.
- **The daily job** (`/api/cron/daily`) works in bounded steps: it finds due templates with one indexed, paged query,
  checks accounts for 50 templates at a time in a single lookup, runs 8 templates side by side, and stops starting new
  work after 40 seconds. Anything it didn't reach stays due and is taken first, oldest first, on the next run.
  It uses about 6 database calls per template (a test fails if that creeps above 14).
- **Nothing is prepared twice.** A unique key on (template, date) makes overlapping runs, retries and the
  "Prepare now" button safe.
- **Housekeeping.** Read notifications older than 90 days and job-log rows older than 180 days are removed by the daily job.
- **The bell** asks for one small count about every 90 seconds, only while the tab is visible, with random spread.
- **The database-updates check** is remembered for 5 minutes per server instead of running on every page view.
- **Indexes** cover assignments, review requests, journal entry lists, notification cleanup and the ledger items a
  journal entry produced (`0019_recurring_transactions.sql`, section 3).
- **Input limits:** comments 2,000 characters and 20 a minute per person; recurring entries 50 lines, start date within 2000 to 2100.

## Capacity, honestly

On the free "Hobby" plan the daily job can run once a day and has 60 seconds. At the assumed ~20 ms per database call
and 8 at a time, one run prepares roughly 2,000 to 3,000 templates. Monthly entries cluster on the 1st and the 25th, so
the busiest mornings matter most. The job log (Settings, Organization) says "N left for the next run" whenever a run is
cut short. If you see that regularly:

1. Move to a Vercel plan that allows an hourly (or every 15 minutes) schedule: change `schedule` in `vercel.json`
   (for example `"0 * * * *"`). The job is safe to run that often; it only does what is due.
2. Encourage "Prepare the draft N days ahead" on templates, which spreads the load across days.
3. Raise Supabase compute size if database latency becomes the limit.

## Next steps when the numbers call for them

- Use Supabase Realtime for notifications (push) instead of polling.
- Split the daily job by organization batches (fan-out) if a single run is no longer enough.
- Partition `audit_log` by month once it passes tens of millions of rows.
- Add a read replica for reports.

## Keeping it from breaking

- Run `npm test` before every push. It checks the money arithmetic, the schedule maths, the importers and the
  daily job at scale (2,000 templates, overlapping runs, a cut-off run resuming). Add a test with every bug you fix.
- Run `npm run typecheck` as well; the live build refuses to deploy on type errors.
- Database changes are numbered SQL files run once each in the Supabase SQL editor. Settings, Organization shows
  which are missing, and pages fall back gracefully (and say so) instead of showing empty lists.
- Never add a foreign key between two tables that already link the other way: it makes "embedded" queries ambiguous
  (this broke the exceptions list once; see `0018_fix_embed_ambiguity.sql`).
