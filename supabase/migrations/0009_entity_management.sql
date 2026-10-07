-- 0009: entity & account management — archiving, account editing, bank disconnect,
-- overview statistics, and the account/linking policies that used to live in a loose
-- file at app/(app)/entities/[entityId]/account_linking_rls.sql.
-- Safe to run more than once. Run it in the Supabase SQL editor.

-- ────────────────────────────────────────────────────────────────
-- 1. New columns
-- ────────────────────────────────────────────────────────────────

-- Archiving is a soft delete: nothing is removed, so history and the audit trail survive.
alter table entities add column if not exists archived_at timestamptz;
alter table accounts add column if not exists archived_at timestamptz;

-- Remembers whether an account was reconcilable before it was archived, so restoring it
-- (or its entity) puts it back the way it was.
alter table accounts add column if not exists archived_was_reconcilable boolean;

-- Set once a person edits an account by hand. Re-importing from QuickBooks then leaves
-- that account's name, type and reconciliation flag alone instead of overwriting them.
alter table accounts add column if not exists user_edited boolean not null default false;

-- A disconnected bank keeps its accounts and transaction history; it just stops syncing.
alter table plaid_items add column if not exists disconnected_at timestamptz;

-- ────────────────────────────────────────────────────────────────
-- 2. Policies
-- ────────────────────────────────────────────────────────────────

-- Accounts had no UPDATE policy, so renaming or toggling an account was impossible.
drop policy if exists "owner/admin/controller update accounts" on accounts;
create policy "owner/admin/controller update accounts" on accounts
  for update
  using (
    current_role_in_org((select organization_id from entities where entities.id = accounts.entity_id))
      = any (array['owner','admin','controller'])
  )
  with check (
    current_role_in_org((select organization_id from entities where entities.id = accounts.entity_id))
      = any (array['owner','admin','controller'])
  );

-- Moved here from account_linking_rls.sql (needed by "Link accounts"). Re-created with
-- drop-if-exists so it is harmless if you already ran the loose file by hand.
drop policy if exists "owner/admin/controller delete accounts" on accounts;
create policy "owner/admin/controller delete accounts" on accounts
  for delete using (
    current_role_in_org((select organization_id from entities where entities.id = accounts.entity_id))
      = any (array['owner','admin','controller'])
  );

drop policy if exists "accountant+ update je_lines" on journal_entry_lines;
create policy "accountant+ update je_lines" on journal_entry_lines
  for update using (
    current_role_in_org((
      select e.organization_id from journal_entries je
      join entities e on e.id = je.entity_id
      where je.id = journal_entry_lines.journal_entry_id
    )) = any (array['owner','controller','accountant'])
  );

drop policy if exists "accountant+ delete reconciliations" on reconciliations;
create policy "accountant+ delete reconciliations" on reconciliations
  for delete using (
    current_role_in_org((select organization_id from entities where entities.id = reconciliations.entity_id))
      = any (array['owner','controller','accountant'])
  );

drop policy if exists "accountant+ delete exceptions" on exceptions;
create policy "accountant+ delete exceptions" on exceptions
  for delete using (
    current_role_in_org((select organization_id from entities where entities.id = exceptions.entity_id))
      = any (array['owner','controller','accountant'])
  );

-- ────────────────────────────────────────────────────────────────
-- 3. Overview statistics (run as the signed-in user, so row security still applies)
-- ────────────────────────────────────────────────────────────────

create or replace function entities_overview()
returns table (
  entity_id uuid,
  account_count bigint,
  reconcilable_count bigint,
  open_exceptions bigint,
  unmatched_count bigint,
  last_txn_date date
)
language sql stable security invoker
set search_path = public
as $$
  select
    e.id,
    (select count(*) from accounts a where a.entity_id = e.id and a.archived_at is null),
    (select count(*) from accounts a where a.entity_id = e.id and a.archived_at is null and a.is_reconcilable),
    (select count(*) from exceptions x where x.entity_id = e.id and x.status = 'open'),
    (select count(*) from transactions t where t.entity_id = e.id and t.status = 'unmatched'),
    (select max(t.transaction_date) from transactions t where t.entity_id = e.id)
  from entities e;
$$;

grant execute on function entities_overview() to authenticated;

create or replace function entity_account_stats(p_entity uuid)
returns table (account_id uuid, txn_count bigint, unmatched_count bigint, last_txn_date date)
language sql stable security invoker
set search_path = public
as $$
  select t.account_id, count(*), count(*) filter (where t.status = 'unmatched'), max(t.transaction_date)
  from transactions t
  where t.entity_id = p_entity
  group by t.account_id;
$$;

grant execute on function entity_account_stats(uuid) to authenticated;
