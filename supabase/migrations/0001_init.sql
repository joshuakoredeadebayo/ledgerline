-- Ledgerline — initial schema
-- Role model: owner | admin | controller | accountant | auditor
-- Every table below is scoped to an organization (directly or via entity_id)
-- and locked down with RLS. audit_log is insert-only at the database level.

create extension if not exists "pgcrypto";

-- ────────────────────────────────────────────────────────────────
-- Core tenancy
-- ────────────────────────────────────────────────────────────────

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'trial' check (plan in ('trial','starter','growth','enterprise')),
  created_at timestamptz not null default now()
);

create table organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','controller','accountant','auditor')),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  unique (organization_id, user_id)
);

create index on organization_members (user_id);

-- Helper: role of the current user within a given org. Used by every policy below.
create or replace function current_role_in_org(org_id uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select role from organization_members
  where organization_id = org_id and user_id = auth.uid() and joined_at is not null
  limit 1;
$$;

-- Helper: is the current user a member of the org at all (any role)?
create or replace function is_org_member(org_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from organization_members
    where organization_id = org_id and user_id = auth.uid() and joined_at is not null
  );
$$;

-- ────────────────────────────────────────────────────────────────
-- Entities & chart of accounts
-- ────────────────────────────────────────────────────────────────

create table entities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  currency text not null default 'USD',
  fiscal_year_end date,
  created_at timestamptz not null default now()
);

create index on entities (organization_id);

create table accounts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  external_id text,
  code text,
  name text not null,
  account_type text not null check (account_type in ('asset','liability','equity','revenue','expense')),
  is_reconcilable boolean not null default true,
  created_at timestamptz not null default now()
);

create index on accounts (entity_id);

-- ────────────────────────────────────────────────────────────────
-- Transactions, matching, exceptions
-- ────────────────────────────────────────────────────────────────

create table transactions (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  source text not null check (source in ('plaid','quickbooks','xero','netsuite','manual')),
  external_id text,
  amount numeric(14,2) not null,
  currency text not null default 'USD',
  transaction_date date not null,
  description text,
  raw_payload jsonb,
  status text not null default 'unmatched' check (status in ('unmatched','matched','excluded')),
  created_at timestamptz not null default now(),
  unique (source, external_id)
);

create index on transactions (entity_id, status);
create index on transactions (account_id);

create table matches (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  match_type text not null check (match_type in ('auto','manual','suggested')),
  confidence_score numeric(4,3),
  status text not null default 'pending_review' check (status in ('pending_review','confirmed','rejected')),
  created_by uuid references auth.users(id),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create index on matches (entity_id, status);

create table match_lines (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  transaction_id uuid not null references transactions(id) on delete cascade,
  side text not null check (side in ('bank','ledger'))
);

create index on match_lines (match_id);
create index on match_lines (transaction_id);

create table exceptions (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  transaction_id uuid references transactions(id) on delete cascade,
  exception_type text not null check (exception_type in ('unmatched','duplicate','variance_threshold','stale')),
  severity text not null default 'medium' check (severity in ('low','medium','high')),
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index on exceptions (entity_id, status);

-- ────────────────────────────────────────────────────────────────
-- Journal entries — append-only ledger
-- ────────────────────────────────────────────────────────────────

create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  entry_date date not null,
  description text,
  status text not null default 'draft' check (status in ('draft','posted','reversed')),
  reversed_entry_id uuid references journal_entries(id),
  created_by uuid references auth.users(id),
  posted_at timestamptz,
  created_at timestamptz not null default now()
);

create index on journal_entries (entity_id, status);

create table journal_entry_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references journal_entries(id) on delete cascade,
  account_id uuid not null references accounts(id),
  debit numeric(14,2) not null default 0,
  credit numeric(14,2) not null default 0,
  memo text,
  constraint debit_or_credit check (
    (debit > 0 and credit = 0) or (credit > 0 and debit = 0)
  )
);

create index on journal_entry_lines (journal_entry_id);

-- ────────────────────────────────────────────────────────────────
-- Close process
-- ────────────────────────────────────────────────────────────────

create table close_periods (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'open' check (status in ('open','in_review','closed','locked')),
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  unique (entity_id, period_start, period_end)
);

create index on close_periods (entity_id, status);

create table close_checklist_items (
  id uuid primary key default gen_random_uuid(),
  close_period_id uuid not null references close_periods(id) on delete cascade,
  title text not null,
  description text,
  assignee_id uuid references auth.users(id),
  due_date date,
  status text not null default 'not_started' check (status in ('not_started','in_progress','complete','blocked')),
  completed_at timestamptz,
  sort_order int not null default 0
);

create index on close_checklist_items (close_period_id);

-- ────────────────────────────────────────────────────────────────
-- Audit log — insert-only, no update/delete policy ever
-- ────────────────────────────────────────────────────────────────

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  entity_id uuid references entities(id) on delete set null,
  actor_id uuid references auth.users(id),
  action text not null,
  target_table text,
  target_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index on audit_log (organization_id, created_at desc);
create index on audit_log (entity_id, created_at desc);

-- ────────────────────────────────────────────────────────────────
-- Attachments & sync jobs
-- ────────────────────────────────────────────────────────────────

create table attachments (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  storage_path text not null,
  related_table text not null,
  related_id uuid not null,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table sync_jobs (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  job_type text not null check (job_type in ('plaid_sync','quickbooks_sync')),
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  error text,
  started_at timestamptz,
  completed_at timestamptz
);

create index on sync_jobs (entity_id, status);

-- ════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════

alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table entities enable row level security;
alter table accounts enable row level security;
alter table transactions enable row level security;
alter table matches enable row level security;
alter table match_lines enable row level security;
alter table exceptions enable row level security;
alter table journal_entries enable row level security;
alter table journal_entry_lines enable row level security;
alter table close_periods enable row level security;
alter table close_checklist_items enable row level security;
alter table audit_log enable row level security;
alter table attachments enable row level security;
alter table sync_jobs enable row level security;

-- organizations: members can read; only owner can update/delete
create policy "members can read org" on organizations for select
  using (is_org_member(id));

create policy "owner can update org" on organizations for update
  using (current_role_in_org(id) = 'owner');

-- organization_members: members can read the roster; owner/admin can manage
create policy "members can read roster" on organization_members for select
  using (is_org_member(organization_id));

create policy "owner/admin can manage members" on organization_members for all
  using (current_role_in_org(organization_id) in ('owner','admin'))
  with check (current_role_in_org(organization_id) in ('owner','admin'));

-- entities: members read; owner/admin manage
create policy "members can read entities" on entities for select
  using (is_org_member(organization_id));

create policy "owner/admin manage entities" on entities for insert
  with check (current_role_in_org(organization_id) in ('owner','admin'));

create policy "owner/admin update entities" on entities for update
  using (current_role_in_org(organization_id) in ('owner','admin'));

-- Generic pattern for entity-scoped tables: resolve org via entities.
-- accounts
create policy "members can read accounts" on accounts for select
  using (is_org_member((select organization_id from entities where id = entity_id)));

create policy "owner/admin/controller manage accounts" on accounts for insert
  with check (current_role_in_org((select organization_id from entities where id = entity_id)) in ('owner','admin','controller'));

-- transactions: all roles read (auditor included); accountant+ can write via matching flows
create policy "members can read transactions" on transactions for select
  using (is_org_member((select organization_id from entities where id = entity_id)));

create policy "accountant+ update transactions" on transactions for update
  using (current_role_in_org((select organization_id from entities where id = entity_id))
         in ('owner','controller','accountant'));

-- matches: read for all; write for accountant+
create policy "members can read matches" on matches for select
  using (is_org_member((select organization_id from entities where id = entity_id)));

create policy "accountant+ create matches" on matches for insert
  with check (current_role_in_org((select organization_id from entities where id = entity_id))
              in ('owner','controller','accountant'));

create policy "accountant+ update matches" on matches for update
  using (current_role_in_org((select organization_id from entities where id = entity_id))
         in ('owner','controller','accountant'));

-- match_lines follow matches
create policy "members can read match_lines" on match_lines for select
  using (is_org_member((select organization_id from entities e join matches m on m.entity_id = e.id where m.id = match_id)));

create policy "accountant+ create match_lines" on match_lines for insert
  with check (current_role_in_org((select organization_id from entities e join matches m on m.entity_id = e.id where m.id = match_id))
              in ('owner','controller','accountant'));

-- exceptions: read all; resolve by accountant+
create policy "members can read exceptions" on exceptions for select
  using (is_org_member((select organization_id from entities where id = entity_id)));

create policy "accountant+ update exceptions" on exceptions for update
  using (current_role_in_org((select organization_id from entities where id = entity_id))
         in ('owner','controller','accountant'));

-- journal_entries: read all; accountant+ draft; only controller/owner post
create policy "members can read journal_entries" on journal_entries for select
  using (is_org_member((select organization_id from entities where id = entity_id)));

create policy "accountant+ draft journal_entries" on journal_entries for insert
  with check (
    current_role_in_org((select organization_id from entities where id = entity_id)) in ('owner','controller','accountant')
    and status = 'draft'
  );

create policy "controller+ post journal_entries" on journal_entries for update
  using (current_role_in_org((select organization_id from entities where id = entity_id)) in ('owner','controller'));

create policy "members can read je_lines" on journal_entry_lines for select
  using (is_org_member((select organization_id from entities e join journal_entries j on j.entity_id = e.id where j.id = journal_entry_id)));

create policy "accountant+ write je_lines" on journal_entry_lines for insert
  with check (current_role_in_org((select organization_id from entities e join journal_entries j on j.entity_id = e.id where j.id = journal_entry_id))
              in ('owner','controller','accountant'));

-- close_periods: read all; only controller/owner manage and lock
create policy "members can read close_periods" on close_periods for select
  using (is_org_member((select organization_id from entities where id = entity_id)));

create policy "controller+ manage close_periods" on close_periods for all
  using (current_role_in_org((select organization_id from entities where id = entity_id)) in ('owner','controller'))
  with check (current_role_in_org((select organization_id from entities where id = entity_id)) in ('owner','controller'));

-- close_checklist_items: read all; controller/owner manage, assignee can update their own item's status
create policy "members can read checklist" on close_checklist_items for select
  using (is_org_member((select organization_id from entities e join close_periods p on p.entity_id = e.id where p.id = close_period_id)));

create policy "controller+ manage checklist" on close_checklist_items for insert
  with check (current_role_in_org((select organization_id from entities e join close_periods p on p.entity_id = e.id where p.id = close_period_id))
              in ('owner','controller'));

create policy "assignee or controller+ update checklist item" on close_checklist_items for update
  using (
    assignee_id = auth.uid()
    or current_role_in_org((select organization_id from entities e join close_periods p on p.entity_id = e.id where p.id = close_period_id)) in ('owner','controller')
  );

-- audit_log: read for all members (auditor included); INSERT ONLY, no update/delete policy exists
create policy "members can read audit_log" on audit_log for select
  using (is_org_member(organization_id));

create policy "system can insert audit_log" on audit_log for insert
  with check (is_org_member(organization_id));
-- Deliberately no UPDATE or DELETE policy on audit_log — with RLS enabled
-- and no permissive policy for those commands, they are rejected outright.

-- attachments: read all; accountant+ upload
create policy "members can read attachments" on attachments for select
  using (is_org_member((select organization_id from entities where id = entity_id)));

create policy "accountant+ upload attachments" on attachments for insert
  with check (current_role_in_org((select organization_id from entities where id = entity_id))
              in ('owner','controller','accountant'));

-- sync_jobs: read all; writes happen via service-role client only (no direct user policy)
create policy "members can read sync_jobs" on sync_jobs for select
  using (is_org_member((select organization_id from entities where id = entity_id)));

-- ────────────────────────────────────────────────────────────────
-- Bootstrap trigger: new user signup -> org + owner membership
-- ────────────────────────────────────────────────────────────────

create or replace function handle_new_user_org()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  new_org_id uuid;
begin
  -- Only auto-provision an org if this signup didn't come from an invite
  -- (invited users get their organization_members row created by the invite flow instead).
  if not exists (select 1 from organization_members where user_id = new.id) then
    insert into organizations (name) values (coalesce(new.raw_user_meta_data->>'org_name', 'My Organization'))
    returning id into new_org_id;

    insert into organization_members (organization_id, user_id, role, joined_at)
    values (new_org_id, new.id, 'owner', now());
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user_org();
