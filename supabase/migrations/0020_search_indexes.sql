-- 0020: makes the search box fast.
-- Searching for part of a word ("uber" inside "UBER TRIP 4823") can't use a normal index. A trigram index can,
-- so search stays quick as the number of transactions grows into the millions.
-- Safe to run more than once. Run it in the Supabase SQL editor.

create extension if not exists pg_trgm with schema extensions;

create index if not exists transactions_description_trgm_idx on transactions using gin (description extensions.gin_trgm_ops);
create index if not exists journal_entries_description_trgm_idx on journal_entries using gin (description extensions.gin_trgm_ops);
create index if not exists accounts_name_trgm_idx on accounts using gin (name extensions.gin_trgm_ops);
create index if not exists entities_name_trgm_idx on entities using gin (name extensions.gin_trgm_ops);
create index if not exists recurring_templates_name_trgm_idx on recurring_templates using gin (name extensions.gin_trgm_ops);
