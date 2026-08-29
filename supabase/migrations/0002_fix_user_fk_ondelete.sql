-- Fix FK constraints referencing auth.users so deleting a user account
-- doesn't get blocked by "who did this" attribution columns.
--
-- These become ON DELETE SET NULL: the business record itself (a journal
-- entry, a confirmed match, an audit log line) survives untouched — only
-- the pointer to who performed it gets cleared. This matters for real
-- pilot usage too, not just test cleanup: someone leaving the org later
-- shouldn't mean their historical journal entries or audit trail become
-- undeletable or force a cascade that erases real financial records.
--
-- organization_members.user_id intentionally stays ON DELETE CASCADE —
-- a membership genuinely cannot exist without the user it belongs to.

alter table matches drop constraint matches_created_by_fkey;
alter table matches add constraint matches_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table matches drop constraint matches_confirmed_by_fkey;
alter table matches add constraint matches_confirmed_by_fkey
  foreign key (confirmed_by) references auth.users(id) on delete set null;

alter table journal_entries drop constraint journal_entries_created_by_fkey;
alter table journal_entries add constraint journal_entries_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table close_periods drop constraint close_periods_closed_by_fkey;
alter table close_periods add constraint close_periods_closed_by_fkey
  foreign key (closed_by) references auth.users(id) on delete set null;

alter table close_checklist_items drop constraint close_checklist_items_assignee_id_fkey;
alter table close_checklist_items add constraint close_checklist_items_assignee_id_fkey
  foreign key (assignee_id) references auth.users(id) on delete set null;

alter table audit_log drop constraint audit_log_actor_id_fkey;
alter table audit_log add constraint audit_log_actor_id_fkey
  foreign key (actor_id) references auth.users(id) on delete set null;

alter table attachments drop constraint attachments_uploaded_by_fkey;
alter table attachments add constraint attachments_uploaded_by_fkey
  foreign key (uploaded_by) references auth.users(id) on delete set null;

alter table exceptions drop constraint exceptions_resolved_by_fkey;
alter table exceptions add constraint exceptions_resolved_by_fkey
  foreign key (resolved_by) references auth.users(id) on delete set null;
