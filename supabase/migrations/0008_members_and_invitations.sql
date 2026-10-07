-- 0008: team management — invitations, a safe member directory, owner guard rails.
-- Run this once in the Supabase SQL editor (or `supabase db push`).

-- ────────────────────────────────────────────────────────────────
-- 1. Invitations
-- ────────────────────────────────────────────────────────────────
-- An owner/admin creates an invitation for an email address and shares the
-- link. The invitee signs up through that link; the signup trigger below
-- attaches them to the inviting organization instead of creating a new one.

create table organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin','controller','accountant','auditor')),
  token text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  revoked_at timestamptz
);

-- One open invitation per email per organization.
create unique index organization_invitations_one_open
  on organization_invitations (organization_id, lower(email))
  where accepted_at is null and revoked_at is null;

alter table organization_invitations enable row level security;

create policy "owner/admin can read invitations" on organization_invitations for select
  using (current_role_in_org(organization_id) in ('owner','admin'));

create policy "owner/admin can create invitations" on organization_invitations for insert
  with check (current_role_in_org(organization_id) in ('owner','admin'));

create policy "owner/admin can update invitations" on organization_invitations for update
  using (current_role_in_org(organization_id) in ('owner','admin'))
  with check (current_role_in_org(organization_id) in ('owner','admin'));

-- ────────────────────────────────────────────────────────────────
-- 2. Read helpers (emails live in auth.users, which app users can't read directly)
-- ────────────────────────────────────────────────────────────────

-- What the signup page needs to greet an invitee. Callable before sign-in.
-- Returns nothing for an unknown, used, revoked or expired token.
create or replace function lookup_invitation(p_token text)
returns table (invited_email text, invited_role text, organization_name text)
language sql stable security definer
set search_path = public
as $$
  select i.email, i.role, o.name
  from organization_invitations i
  join organizations o on o.id = i.organization_id
  where i.token = p_token
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now();
$$;

grant execute on function lookup_invitation(text) to anon, authenticated;

-- The roster with emails, only for people who belong to that organization.
create or replace function list_org_members(p_org uuid)
returns table (user_id uuid, email text, role text, joined_at timestamptz, invited_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  select m.user_id, u.email::text, m.role, m.joined_at, m.invited_at
  from organization_members m
  join auth.users u on u.id = m.user_id
  where m.organization_id = p_org
    and is_org_member(p_org);
$$;

grant execute on function list_org_members(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 3. Signup trigger: honour an invitation instead of always creating an org
-- ────────────────────────────────────────────────────────────────

create or replace function handle_new_user_org()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  inv record;
begin
  -- Signed up through an invitation link: join the inviting organization.
  if new.raw_user_meta_data->>'invite_token' is not null then
    select * into inv
    from organization_invitations
    where token = new.raw_user_meta_data->>'invite_token'
      and accepted_at is null
      and revoked_at is null
      and expires_at > now()
      and lower(email) = lower(new.email);

    if found then
      insert into organization_members (organization_id, user_id, role, joined_at)
      values (inv.organization_id, new.id, inv.role, now());

      update organization_invitations set accepted_at = now() where id = inv.id;
      return new;
    end if;
  end if;

  -- Normal signup: provision a fresh organization with this user as owner.
  if not exists (select 1 from organization_members where user_id = new.id) then
    insert into organizations (name) values (coalesce(new.raw_user_meta_data->>'org_name', 'My Organization'))
    returning id into new_org_id;

    insert into organization_members (organization_id, user_id, role, joined_at)
    values (new_org_id, new.id, 'owner', now());
  end if;
  return new;
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- 4. Guard rails on membership changes
-- ────────────────────────────────────────────────────────────────
-- The existing policy lets any owner/admin edit any membership row. These
-- rules close the obvious holes, whatever the app code does:
--   * only an owner can create, change or remove an owner
--   * an organization always keeps at least one owner
-- Changes made without a signed-in user (signup provisioning, cascading
-- deletes) are trusted and skipped.

create or replace function guard_member_changes()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  org uuid;
  caller_role text;
  other_owners integer;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    org := old.organization_id;
  else
    org := new.organization_id;
  end if;
  caller_role := current_role_in_org(org);

  if tg_op in ('UPDATE', 'DELETE') then
    if old.role = 'owner' then
      if caller_role is distinct from 'owner' then
        raise exception 'Only an owner can change or remove an owner.';
      end if;

      if tg_op = 'DELETE' or new.role <> 'owner' then
        select count(*) into other_owners
        from organization_members
        where organization_id = old.organization_id
          and role = 'owner'
          and joined_at is not null
          and id <> old.id;
        if other_owners = 0 then
          raise exception 'An organization must keep at least one owner.';
        end if;
      end if;
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if new.role = 'owner' and (tg_op = 'INSERT' or old.role <> 'owner') then
      if caller_role is distinct from 'owner' then
        raise exception 'Only an owner can make someone an owner.';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger guard_member_changes
  before insert or update or delete on organization_members
  for each row execute function guard_member_changes();
