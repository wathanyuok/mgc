-- =====================================================================
--  User Management (RBAC) — Permission Groups + per-menu permissions + Users
--  Supports the YIP Lease System Flow swimlanes (Approver vs Finance officer).
--  Phase: management screens first; login enforcement wired later.
-- =====================================================================

create table if not exists permission_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  is_admin    boolean not null default false,  -- full access shortcut
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- One row per (group, menu) with the three access levels.
create table if not exists group_permissions (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references permission_groups(id) on delete cascade,
  menu_key    text not null,
  can_view    boolean not null default false,
  can_edit    boolean not null default false,
  can_approve boolean not null default false,
  unique (group_id, menu_key)
);
create index if not exists idx_group_perms_group on group_permissions(group_id);

create table if not exists app_users (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        text not null unique,
  group_id     uuid references permission_groups(id) on delete set null,
  status       text not null default 'Active',   -- Active / Inactive
  auth_user_id uuid,                              -- link to supabase auth (later)
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists idx_app_users_group on app_users(group_id);

-- RLS — open policy to match the rest of the prototype (tighten when login lands)
alter table permission_groups enable row level security;
alter table group_permissions enable row level security;
alter table app_users         enable row level security;

drop policy if exists "anon_all_permission_groups" on permission_groups;
create policy "anon_all_permission_groups" on permission_groups for all using (true) with check (true);
drop policy if exists "anon_all_group_permissions" on group_permissions;
create policy "anon_all_group_permissions" on group_permissions for all using (true) with check (true);
drop policy if exists "anon_all_app_users" on app_users;
create policy "anon_all_app_users" on app_users for all using (true) with check (true);

-- Seed a default Admin group
insert into permission_groups (name, description, is_admin)
select 'Admin', 'เข้าถึงทุกเมนู (full access)', true
where not exists (select 1 from permission_groups where name = 'Admin');
