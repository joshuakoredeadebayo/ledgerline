-- Reconciliation as a first-class, period-scoped object with a status
-- lifecycle — per the account's reconciliation workflow spec: Draft →
-- Needs Review → Reconciled → Finalized → Reopened.
--
-- Design principle: this table is never manually created or manually
-- transitioned by a user in the normal flow. It's lazily created the
-- first time someone opens an account's matching workspace for a given
-- period, and its status/balances are recomputed automatically every
-- time a match is confirmed, rejected, or a transaction is added. The
-- ONLY explicit human actions are Finalize and Reopen — everything else
-- is a byproduct of reconciling as usual.

create table reconciliations (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft','needs_review','reconciled','finalized','reopened')),
  opening_balance_book numeric(14,2) not null default 0,
  opening_balance_external numeric(14,2) not null default 0,
  book_total numeric(14,2) not null default 0,
  external_total numeric(14,2) not null default 0,
  unexplained_difference numeric(14,2) not null default 0,
  prepared_by uuid references auth.users(id) on delete set null,
  finalized_by uuid references auth.users(id) on delete set null,
  finalized_at timestamptz,
  reopened_reason text,
  created_at timestamptz not null default now(),
  unique (account_id, period_start, period_end)
);

create index on reconciliations (account_id, status);

-- Matches and exceptions now optionally belong to a reconciliation period.
-- Nullable + ON DELETE SET NULL: a reconciliation record disappearing
-- should never take real match/exception history down with it.
alter table matches add column reconciliation_id uuid references reconciliations(id) on delete set null;
alter table exceptions add column reconciliation_id uuid references reconciliations(id) on delete set null;

create index on matches (reconciliation_id);
create index on exceptions (reconciliation_id);

alter table reconciliations enable row level security;

create policy "members can read reconciliations" on reconciliations for select
  using (is_org_member((select organization_id from entities where id = entity_id)));

-- Broad accountant+ write access at the RLS layer (matching/status
-- recompute happens as a side effect of everyday reconciliation work,
-- which accountants already do). The finer-grained rule — that only a
-- controller or owner may actually finalize or reopen a period — is
-- enforced in application code (see lib/actions/reconciliation.ts),
-- the same pattern already used for close_periods.
create policy "accountant+ manage reconciliations" on reconciliations for insert
  with check (current_role_in_org((select organization_id from entities where id = entity_id)) in ('owner','controller','accountant'));

create policy "accountant+ update reconciliations" on reconciliations for update
  using (current_role_in_org((select organization_id from entities where id = entity_id)) in ('owner','controller','accountant'));
