-- 0018: fixes pages that showed no exceptions, no accounts and no suggested matches.
--
-- Update 0014 (VAT) linked an entity to its two VAT accounts with foreign keys. That gave the database two
-- extra links between "entities" and "accounts", so every query that asked for an account's entity became
-- ambiguous and failed. The app now names the link it means, and this update removes the two extra links so
-- the ambiguity can't come back. The VAT accounts are still checked by the app when VAT settings are saved
-- (they must be active accounts of the same entity), and accounts are archived rather than deleted, so
-- nothing is lost by dropping them.
--
-- Safe to run more than once. Run it in the Supabase SQL editor.

alter table entities drop constraint if exists entities_vat_output_account_id_fkey;
alter table entities drop constraint if exists entities_vat_input_account_id_fkey;
