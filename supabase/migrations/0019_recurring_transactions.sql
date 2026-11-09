-- 0019: recurring entries (templates that prepare draft journal entries on a schedule) and a log of the
-- automatic daily job. Safe to run more than once. Run it in the Supabase SQL editor.

-- ────────────────────────────────────────────────────────────────
-- 1. Recurring templates
-- ────────────────────────────────────────────────────────────────
create table if not exists recurring_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text,
  frequency text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  interval_count integer not null default 1 check (interval_count between 1 and 52),
  -- 1 to 31; 31 means "the last day of the month"
  day_of_month integer check (day_of_month between 1 and 31),
  -- 0 (Sunday) to 6 (Saturday), for weekly schedules
  weekday integer check (weekday between 0 and 6),
  start_date date not null,
  end_date date,
  -- The date the next draft will be dated. Moves forward each time a draft is prepared.
  next_run_date date not null,
  -- Prepare the draft this many days before its date, so it can be reviewed in good time.
  lead_days integer not null default 0 check (lead_days between 0 and 30),
  status text not null default 'active' check (status in ('active', 'paused', 'ended')),
  -- [{ "accountId": "...", "debit": 0, "credit": 0, "memo": "..." }, ...]
  lines jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_run_at timestamptz
);

create index if not exists recurring_templates_due_idx on recurring_templates (status, next_run_date);
create index if not exists recurring_templates_org_idx on recurring_templates (organization_id);

-- One row per draft prepared. The unique key means a date can only ever be prepared once,
-- even if the daily job and a person press "run" at the same moment.
create table if not exists recurring_runs (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references recurring_templates(id) on delete cascade,
  run_date date not null,
  entry_id uuid references journal_entries(id) on delete set null,
  status text not null check (status in ('created', 'failed')),
  message text,
  created_at timestamptz not null default now(),
  unique (template_id, run_date)
);

create index if not exists recurring_runs_entry_idx on recurring_runs (entry_id);

alter table recurring_templates enable row level security;
alter table recurring_runs enable row level security;

drop policy if exists "members read recurring templates" on recurring_templates;
create policy "members read recurring templates" on recurring_templates for select using (is_org_member(organization_id));

drop policy if exists "accountant+ insert recurring templates" on recurring_templates;
create policy "accountant+ insert recurring templates" on recurring_templates for insert
  with check (current_role_in_org(organization_id) = any (array['owner', 'controller', 'accountant']));

drop policy if exists "accountant+ update recurring templates" on recurring_templates;
create policy "accountant+ update recurring templates" on recurring_templates for update
  using (current_role_in_org(organization_id) = any (array['owner', 'controller', 'accountant']))
  with check (current_role_in_org(organization_id) = any (array['owner', 'controller', 'accountant']));

drop policy if exists "accountant+ delete recurring templates" on recurring_templates;
create policy "accountant+ delete recurring templates" on recurring_templates for delete
  using (current_role_in_org(organization_id) = any (array['owner', 'controller', 'accountant']));

drop policy if exists "members read recurring runs" on recurring_runs;
create policy "members read recurring runs" on recurring_runs for select
  using (exists (select 1 from recurring_templates t where t.id = recurring_runs.template_id and is_org_member(t.organization_id)));

drop policy if exists "accountant+ write recurring runs" on recurring_runs;
create policy "accountant+ write recurring runs" on recurring_runs for all
  using (exists (select 1 from recurring_templates t where t.id = recurring_runs.template_id
                 and current_role_in_org(t.organization_id) = any (array['owner', 'controller', 'accountant'])))
  with check (exists (select 1 from recurring_templates t where t.id = recurring_runs.template_id
                      and current_role_in_org(t.organization_id) = any (array['owner', 'controller', 'accountant'])));

-- ────────────────────────────────────────────────────────────────
-- 2. A log of the automatic daily job, so you can see it is running
-- ────────────────────────────────────────────────────────────────
create table if not exists job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  ran_at timestamptz not null default now(),
  ok boolean not null default true,
  message text
);

create index if not exists job_runs_job_idx on job_runs (job, ran_at desc);

alter table job_runs enable row level security;

-- Anyone signed in can see that the job ran (the log holds no business data); only the server writes to it.
drop policy if exists "signed-in users read job runs" on job_runs;
create policy "signed-in users read job runs" on job_runs for select using (auth.uid() is not null);

-- ────────────────────────────────────────────────────────────────
-- 3. Indexes for scale
-- ────────────────────────────────────────────────────────────────
-- These keep common lookups fast as the number of customers and rows grows. They don't change what anything does.

-- "Assigned to me" and the dashboard counts.
create index if not exists exceptions_assigned_idx on exceptions (assigned_to, status) where assigned_to is not null;
create index if not exists close_checklist_assignee_idx on close_checklist_items (assignee_id) where assignee_id is not null;
-- "Waiting for your review".
create index if not exists reconciliations_review_idx on reconciliations (reviewer_id) where review_status = 'pending';
-- The ledger items a journal entry produced (found by entry id, instead of scanning every transaction).
create index if not exists transactions_journal_entry_idx on transactions ((raw_payload ->> 'journal_entry_id')) where raw_payload ->> 'journal_entry_id' is not null;
-- The journal entry list (filter by entity and status, newest first).
create index if not exists journal_entries_list_idx on journal_entries (entity_id, status, entry_date desc);
-- Clearing out old, already-read notifications.
create index if not exists notifications_cleanup_idx on notifications (created_at) where read_at is not null;
create index if not exists job_runs_ran_idx on job_runs (ran_at);
