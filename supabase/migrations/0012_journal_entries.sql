-- 0012: Journal entries.
--   * accountants (and above) can edit and delete their own drafts, but never a posted entry
--   * a posted entry can no longer be changed — only reversed
--   * an entry can only be posted when it has at least two lines and debits equal credits
-- The rules live in the database as well as the app, so no route around the app can break them.
-- Safe to run more than once. Run it in the Supabase SQL editor.

-- ────────────────────────────────────────────────────────────────
-- 1. Policies: drafts are editable, everything else is read-only
-- ────────────────────────────────────────────────────────────────

drop policy if exists "accountant+ update draft journal_entries" on journal_entries;
create policy "accountant+ update draft journal_entries" on journal_entries
  for update
  using (
    status = 'draft'
    and current_role_in_org((select organization_id from entities where entities.id = journal_entries.entity_id))
      = any (array['owner','controller','accountant'])
  )
  with check (
    status = 'draft'
    and current_role_in_org((select organization_id from entities where entities.id = journal_entries.entity_id))
      = any (array['owner','controller','accountant'])
  );

drop policy if exists "accountant+ delete draft journal_entries" on journal_entries;
create policy "accountant+ delete draft journal_entries" on journal_entries
  for delete
  using (
    status = 'draft'
    and current_role_in_org((select organization_id from entities where entities.id = journal_entries.entity_id))
      = any (array['owner','controller','accountant'])
  );

-- Lines: only while the entry is still a draft (replaces the broader policies from 0001 and 0009).
drop policy if exists "accountant+ write je_lines" on journal_entry_lines;
drop policy if exists "accountant+ update je_lines" on journal_entry_lines;
drop policy if exists "accountant+ write draft je_lines" on journal_entry_lines;
drop policy if exists "accountant+ update draft je_lines" on journal_entry_lines;
drop policy if exists "accountant+ delete draft je_lines" on journal_entry_lines;

create policy "accountant+ write draft je_lines" on journal_entry_lines
  for insert
  with check (
    exists (
      select 1
      from journal_entries j
      join entities e on e.id = j.entity_id
      where j.id = journal_entry_lines.journal_entry_id
        and j.status = 'draft'
        and current_role_in_org(e.organization_id) = any (array['owner','controller','accountant'])
    )
  );

create policy "accountant+ update draft je_lines" on journal_entry_lines
  for update
  using (
    exists (
      select 1
      from journal_entries j
      join entities e on e.id = j.entity_id
      where j.id = journal_entry_lines.journal_entry_id
        and j.status = 'draft'
        and current_role_in_org(e.organization_id) = any (array['owner','controller','accountant'])
    )
  );

create policy "accountant+ delete draft je_lines" on journal_entry_lines
  for delete
  using (
    exists (
      select 1
      from journal_entries j
      join entities e on e.id = j.entity_id
      where j.id = journal_entry_lines.journal_entry_id
        and j.status = 'draft'
        and current_role_in_org(e.organization_id) = any (array['owner','controller','accountant'])
    )
  );

-- ────────────────────────────────────────────────────────────────
-- 2. Guard rails
-- ────────────────────────────────────────────────────────────────

create or replace function guard_journal_entries()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  line_count integer;
  total_debit numeric;
  total_credit numeric;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only a draft journal entry can be deleted.';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.status = 'draft' then
    if new.status = 'posted' then
      select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
        into line_count, total_debit, total_credit
      from journal_entry_lines
      where journal_entry_id = old.id;

      if line_count < 2 then
        raise exception 'A journal entry needs at least two lines before it can be posted.';
      end if;
      if total_debit <> total_credit then
        raise exception 'Debits and credits must be equal before a journal entry can be posted.';
      end if;
      new.posted_at := coalesce(new.posted_at, now());
    elsif new.status = 'reversed' then
      raise exception 'A draft journal entry cannot be reversed.';
    end if;
  elsif old.status = 'posted' then
    if new.status <> 'reversed'
       or new.entry_date <> old.entry_date
       or new.entity_id <> old.entity_id
       or coalesce(new.description, '') <> coalesce(old.description, '') then
      raise exception 'A posted journal entry cannot be changed. Reverse it instead.';
    end if;
  else
    raise exception 'A reversed journal entry cannot be changed.';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_journal_entries on journal_entries;
create trigger guard_journal_entries
  before update or delete on journal_entries
  for each row execute function guard_journal_entries();

create or replace function guard_journal_lines()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  parent_id uuid;
  parent_status text;
begin
  if tg_op = 'DELETE' then
    parent_id := old.journal_entry_id;
  else
    parent_id := new.journal_entry_id;
  end if;

  -- No parent row means the entry itself is being deleted (a draft, per the rule above).
  select status into parent_status from journal_entries where id = parent_id;
  if parent_status is not null and parent_status <> 'draft' then
    raise exception 'The lines of a posted or reversed journal entry cannot be changed.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_journal_lines on journal_entry_lines;
create trigger guard_journal_lines
  before insert or update or delete on journal_entry_lines
  for each row execute function guard_journal_lines();
