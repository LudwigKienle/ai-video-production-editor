-- AI Video Production Editor Portal MVP schema

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  seats integer default 1,
  created_at timestamp with time zone default now()
);

create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  user_id uuid not null,
  role text check (role in ('owner','admin','editor','viewer')) default 'viewer',
  created_at timestamp with time zone default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  name text not null,
  status text default 'draft',
  created_by uuid,
  updated_at timestamp with time zone default now(),
  last_opened_at timestamp with time zone
);

create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  type text not null,
  quantity integer default 1,
  created_at timestamp with time zone default now()
);
