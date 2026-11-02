-- 0016: sending posted journal entries to QuickBooks.
-- Records where each entry ended up, and lets those bookkeeping columns change on an entry that is
-- already posted (the content of a posted entry still can't change). Safe to run more than once.

alter table journal_entries add column if not exists qb_journal_entry_id text;
alter table journal_entries add column if not exists qb_synced_at timestamptz;
alter table journal_entries add column if not exists qb_error text;

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

      -- With sign-off required, the person who wrote an entry can't be the one who posts it.
      -- Reversing entries, generated from an already-posted entry, are exempt.
      if auth.uid() is not null
         and new.reversed_entry_id is null
         and old.created_by = auth.uid()
         and exists (
           select 1
           from organizations o
           join entities e on e.organization_id = o.id
           where e.id = old.entity_id and o.require_signoff
         ) then
        raise exception 'Sign-off is required: a different person must post this entry.';
      end if;

      new.posted_at := coalesce(new.posted_at, now());
    elsif new.status = 'reversed' then
      raise exception 'A draft journal entry cannot be reversed.';
    end if;
  else
    -- Posted or reversed: the content is fixed. The only allowed changes are posted -> reversed, and the
    -- QuickBooks columns that record where the entry was sent.
    if (new.status <> old.status and not (old.status = 'posted' and new.status = 'reversed'))
       or new.entry_date <> old.entry_date
       or new.entity_id <> old.entity_id
       or coalesce(new.description, '') <> coalesce(old.description, '')
       or new.created_by is distinct from old.created_by
       or new.reversed_entry_id is distinct from old.reversed_entry_id
       or new.posted_at is distinct from old.posted_at then
      raise exception 'A posted journal entry cannot be changed. Reverse it instead.';
    end if;
  end if;

  return new;
end;
$$;
