-- 0013: balance-based reconciliation.
-- A bank reconciliation is signed off by showing that the balance on the statement, adjusted for
-- items still in transit, equals the balance in the books, adjusted for items not yet recorded.
-- These two columns hold the closing balances a person enters for a period.
-- Safe to run more than once. Run it in the Supabase SQL editor.

alter table reconciliations add column if not exists statement_closing_balance numeric(16,2);
alter table reconciliations add column if not exists book_closing_balance numeric(16,2);
alter table reconciliations add column if not exists balances_entered_by uuid references auth.users(id) on delete set null;
alter table reconciliations add column if not exists balances_entered_at timestamptz;
