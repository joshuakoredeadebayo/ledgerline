-- 0017: a built-in check that shows which database updates (the numbered SQL files) have been run.
-- Owners see the result under Settings, Organization, and as a banner when something is missing.
-- It reads only the structure of the database, never your data. Safe to run more than once.

create or replace function schema_health()
returns table (migration text, description text, applied boolean)
language sql stable security definer
set search_path = public
as $$
  with checks (migration, description, applied) as (
    values
      ('0008', 'Team invitations and the member directory',
        exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'organization_invitations')),
      ('0009', 'Archiving, account editing and entity statistics',
        exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'entities' and column_name = 'archived_at')),
      ('0010', 'Exception reasons and notes',
        exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'exceptions' and column_name = 'resolution_reason')),
      ('0011', 'QuickBooks connection per entity',
        exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quickbooks_items' and column_name = 'entity_id')),
      ('0012', 'Journal entry rules (drafts, posting, reversal)',
        exists (select 1 from pg_trigger where tgname = 'guard_journal_lines')),
      ('0013', 'Statement and book closing balances',
        exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'reconciliations' and column_name = 'statement_closing_balance')),
      ('0014', 'VAT settings and VAT tags',
        exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'entities' and column_name = 'vat_registered')),
      ('0015', 'Notifications, comments, assignments and sign-off',
        exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'notifications')
        and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'exceptions' and column_name = 'assigned_to')
        and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'organizations' and column_name = 'require_signoff')),
      ('0016', 'Sending journal entries to QuickBooks',
        exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'journal_entries' and column_name = 'qb_journal_entry_id')),
      ('0018', 'Fix for pages showing no exceptions or accounts',
        not exists (select 1 from pg_constraint where conname in ('entities_vat_output_account_id_fkey', 'entities_vat_input_account_id_fkey')))
  )
  select migration, description, applied from checks order by migration;
$$;

grant execute on function schema_health() to authenticated;
