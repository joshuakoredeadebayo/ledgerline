-- 0015: collaboration — notifications, comments, assignments, and preparer/reviewer sign-off.
-- Safe to run more than once. Run it in the Supabase SQL editor.

-- ────────────────────────────────────────────────────────────────
-- 1. Notifications
-- ────────────────────────────────────────────────────────────────
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link_url text,
  -- Lets a reminder be raised once per person without repeating every day.
  dedupe_key text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, dedupe_key)
);

create index if not exists notifications_user_idx on notifications (user_id, read_at, created_at desc);

alter table notifications enable row level security;

drop policy if exists "read own notifications" on notifications;
create policy "read own notifications" on notifications for select using (user_id = auth.uid());

drop policy if exists "update own notifications" on notifications;
create policy "update own notifications" on notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "delete own notifications" on notifications;
create policy "delete own notifications" on notifications for delete using (user_id = auth.uid());

-- Anyone in an organization can notify another member of the same organization.
drop policy if exists "members notify members" on notifications;
create policy "members notify members" on notifications for insert
  with check (
    is_org_member(organization_id)
    and exists (
      select 1 from organization_members m
      where m.organization_id = notifications.organization_id
        and m.user_id = notifications.user_id
        and m.joined_at is not null
    )
  );

create table if not exists notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_assignments boolean not null default true,
  email_reviews boolean not null default true,
  email_mentions boolean not null default true,
  email_reminders boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table notification_preferences enable row level security;

drop policy if exists "own notification preferences" on notification_preferences;
create policy "own notification preferences" on notification_preferences for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────────
-- 2. Comments
-- ────────────────────────────────────────────────────────────────
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  target_type text not null check (target_type in ('reconciliation', 'exception', 'journal_entry', 'close_task')),
  target_id uuid not null,
  body text not null check (char_length(body) between 1 and 2000),
  author_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists comments_target_idx on comments (target_type, target_id, created_at);

alter table comments enable row level security;

drop policy if exists "members read comments" on comments;
create policy "members read comments" on comments for select using (is_org_member(organization_id));

drop policy if exists "members write own comments" on comments;
create policy "members write own comments" on comments for insert
  with check (is_org_member(organization_id) and author_id = auth.uid());

-- Authors can remove (soft-delete) their own comments; nobody can rewrite someone else's.
drop policy if exists "authors update own comments" on comments;
create policy "authors update own comments" on comments for update
  using (author_id = auth.uid()) with check (author_id = auth.uid());

-- ────────────────────────────────────────────────────────────────
-- 3. Assignments
-- ────────────────────────────────────────────────────────────────
alter table exceptions add column if not exists assigned_to uuid references auth.users(id) on delete set null;
alter table exceptions add column if not exists assigned_at timestamptz;
alter table exceptions add column if not exists due_date date;
alter table close_checklist_items add column if not exists due_date date;

-- ────────────────────────────────────────────────────────────────
-- 4. Sign-off (preparer and reviewer)
-- ────────────────────────────────────────────────────────────────
alter table organizations add column if not exists require_signoff boolean not null default false;

alter table reconciliations add column if not exists submitted_by uuid references auth.users(id) on delete set null;
alter table reconciliations add column if not exists submitted_at timestamptz;
alter table reconciliations add column if not exists reviewer_id uuid references auth.users(id) on delete set null;
alter table reconciliations add column if not exists review_status text;
alter table reconciliations add column if not exists review_note text;
alter table reconciliations add column if not exists reviewed_by uuid references auth.users(id) on delete set null;
alter table reconciliations add column if not exists reviewed_at timestamptz;

alter table reconciliations drop constraint if exists reconciliations_review_status_check;
alter table reconciliations add constraint reconciliations_review_status_check
  check (review_status is null or review_status in ('pending', 'changes_requested', 'approved'));

-- When an organization requires sign-off, a period can only be finalized after someone other than
-- the preparer has reviewed and approved it. Enforced here so no route around the app can skip it.
create or replace function guard_reconciliation_signoff()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  needs boolean;
begin
  if new.status = 'finalized' and old.status is distinct from 'finalized' then
    select o.require_signoff into needs
    from organizations o
    join entities e on e.organization_id = o.id
    where e.id = new.entity_id;

    if coalesce(needs, false) then
      if new.submitted_by is null or new.reviewed_by is null or new.review_status is distinct from 'approved' then
        raise exception 'Sign-off is required: submit this period for review, and have it approved, before it can be finalized.';
      end if;
      if new.reviewed_by = new.submitted_by then
        raise exception 'Sign-off is required: the reviewer must be a different person from the preparer.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_reconciliation_signoff on reconciliations;
create trigger guard_reconciliation_signoff
  before update on reconciliations
  for each row execute function guard_reconciliation_signoff();

-- Journal entries: with sign-off on, the person who wrote an entry can't be the one who posts it.
-- (Reversing entries, which are generated from an already-posted entry, are exempt.)
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
