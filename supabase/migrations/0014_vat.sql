-- 0014: VAT (Nigeria Tax Act 2025: 7.5% standard rate, with zero-rated, exempt and out-of-scope supplies).
-- Per-entity VAT settings, and a VAT tag on journal entry lines so a VAT return can be summarized from
-- posted entries. The rate is a setting, and every tagged line stores the rate it used, so a future change
-- in the rate never rewrites earlier entries. Safe to run more than once. Run it in the Supabase SQL editor.

-- ────────────────────────────────────────────────────────────────
-- 1. Entity VAT settings
-- ────────────────────────────────────────────────────────────────
alter table entities add column if not exists vat_registered boolean not null default false;
alter table entities add column if not exists vat_number text;
alter table entities add column if not exists vat_rate numeric(5,2) not null default 7.5;
alter table entities add column if not exists vat_output_account_id uuid references accounts(id) on delete set null;
alter table entities add column if not exists vat_input_account_id uuid references accounts(id) on delete set null;
-- The share of input VAT that can be reclaimed. 100 when costs relate to taxable and zero-rated sales;
-- less when some also serve exempt sales (for the business and its tax adviser to determine).
alter table entities add column if not exists vat_input_recoverable_percent numeric(5,2) not null default 100;

alter table entities drop constraint if exists entities_vat_rate_check;
alter table entities add constraint entities_vat_rate_check check (vat_rate >= 0 and vat_rate <= 100);
alter table entities drop constraint if exists entities_vat_recoverable_check;
alter table entities add constraint entities_vat_recoverable_check check (vat_input_recoverable_percent >= 0 and vat_input_recoverable_percent <= 100);

-- ────────────────────────────────────────────────────────────────
-- 2. VAT tags on journal entry lines
-- ────────────────────────────────────────────────────────────────
-- A tagged line is the revenue or expense line; vat_amount is the VAT on it, which sits on its own line
-- in the entity's VAT account. Entries that merely pay the VAT bill carry no tags.
alter table journal_entry_lines add column if not exists vat_code text;
alter table journal_entry_lines add column if not exists vat_direction text;
alter table journal_entry_lines add column if not exists vat_rate numeric(5,2);
alter table journal_entry_lines add column if not exists vat_amount numeric(16,2) not null default 0;
alter table journal_entry_lines add column if not exists vat_category text;

alter table journal_entry_lines drop constraint if exists journal_entry_lines_vat_code_check;
alter table journal_entry_lines add constraint journal_entry_lines_vat_code_check
  check (vat_code is null or vat_code in ('STD', 'ZERO', 'EXEMPT', 'OUT'));

alter table journal_entry_lines drop constraint if exists journal_entry_lines_vat_direction_check;
alter table journal_entry_lines add constraint journal_entry_lines_vat_direction_check
  check (vat_direction is null or vat_direction in ('sales', 'purchases'));

-- Only standard-rated supplies can carry VAT.
alter table journal_entry_lines drop constraint if exists journal_entry_lines_vat_amount_check;
alter table journal_entry_lines add constraint journal_entry_lines_vat_amount_check
  check (vat_amount >= 0 and (vat_code = 'STD' or vat_amount = 0));

create index if not exists journal_entry_lines_vat_idx on journal_entry_lines (journal_entry_id) where vat_code is not null;
