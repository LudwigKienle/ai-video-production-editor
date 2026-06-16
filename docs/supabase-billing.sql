-- Billing tables for Stripe subscription tracking

create table if not exists billing_accounts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  status text,
  price_id text,
  current_period_end timestamp with time zone,
  cancel_at_period_end boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create unique index if not exists billing_accounts_team_id_key on billing_accounts(team_id);

create table if not exists billing_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete set null,
  stripe_event_id text unique,
  type text,
  payload jsonb,
  created_at timestamp with time zone default now()
);

create table if not exists billing_plans (
  id text primary key,
  name text not null,
  price_cents integer not null,
  interval text not null,
  mode text not null,
  included_credits_cents integer default 0,
  premium_access boolean default false,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists team_billing (
  team_id uuid primary key references teams(id) on delete cascade,
  mode text not null,
  plan_id text references billing_plans(id) on delete set null,
  credit_balance_cents integer default 0,
  byo_entitled boolean default false,
  trial_started_at timestamp with time zone,
  trial_ends_at timestamp with time zone,
  trial_active boolean default false,
  status text,
  last_usage_at timestamp with time zone,
  auto_topup_enabled boolean default false,
  auto_topup_threshold_cents integer default 1000,
  auto_topup_pack_id text default 'credits-1000',
  updated_at timestamp with time zone default now()
);

create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  delta_cents integer not null,
  reason text,
  source text,
  stripe_event_id text,
  created_at timestamp with time zone default now()
);

create table if not exists customer_profiles (
  team_id uuid primary key references teams(id) on delete cascade,
  user_id uuid not null,
  name text,
  email text,
  company text,
  phone text,
  country text,
  vat_id text,
  address_line1 text,
  city text,
  postal_code text,
  stripe_customer_id text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists byok_provider_keys (
  team_id uuid references teams(id) on delete cascade,
  provider text not null,
  encrypted_key text not null,
  key_mask text not null,
  updated_by uuid,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  primary key (team_id, provider),
  constraint byok_provider_keys_provider_check check (
    provider in ('gemini', 'replicate', 'xai', 'fal', 'ltx', 'elevenlabs', 'worldlabs')
  )
);

create table if not exists byok_spend_limits (
  team_id uuid primary key references teams(id) on delete cascade,
  daily_cap_usd numeric(12,5) not null default 25,
  hard_stop_enabled boolean not null default true,
  updated_by uuid,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists byok_spend_ledger (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  provider text not null,
  kind text not null,
  model text,
  units integer not null default 1,
  estimated_usd numeric(12,5) not null default 0,
  request_url text,
  http_method text,
  response_status integer,
  note text,
  created_by uuid,
  created_at timestamp with time zone default now()
);

create index if not exists byok_spend_ledger_team_day_idx
  on byok_spend_ledger(team_id, created_at desc);

alter table billing_accounts enable row level security;
alter table billing_events enable row level security;
alter table billing_plans enable row level security;
alter table team_billing enable row level security;
alter table credit_ledger enable row level security;
alter table customer_profiles enable row level security;
alter table byok_provider_keys enable row level security;
alter table byok_spend_limits enable row level security;
alter table byok_spend_ledger enable row level security;

create policy "billing_accounts_select" on billing_accounts
  for select
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = billing_accounts.team_id and tm.user_id = auth.uid()
    )
  );

create policy "billing_events_select" on billing_events
  for select
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = billing_events.team_id and tm.user_id = auth.uid()
        and tm.role in ('owner','admin')
    )
  );

create policy "billing_plans_select" on billing_plans
  for select
  using (true);

create policy "team_billing_select" on team_billing
  for select
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = team_billing.team_id and tm.user_id = auth.uid()
    )
  );

create policy "team_billing_update" on team_billing
  for update
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = team_billing.team_id and tm.user_id = auth.uid()
        and tm.role in ('owner','admin')
    )
  )
  with check (
    exists (
      select 1 from team_members tm
      where tm.team_id = team_billing.team_id and tm.user_id = auth.uid()
        and tm.role in ('owner','admin')
    )
  );

create policy "credit_ledger_select" on credit_ledger
  for select
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = credit_ledger.team_id and tm.user_id = auth.uid()
    )
  );

create policy "customer_profiles_select" on customer_profiles
  for select
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = customer_profiles.team_id and tm.user_id = auth.uid()
    )
  );

create policy "customer_profiles_update" on customer_profiles
  for update
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = customer_profiles.team_id and tm.user_id = auth.uid()
        and tm.role in ('owner','admin')
    )
  )
  with check (
    exists (
      select 1 from team_members tm
      where tm.team_id = customer_profiles.team_id and tm.user_id = auth.uid()
        and tm.role in ('owner','admin')
    )
  );

create policy "byok_provider_keys_select" on byok_provider_keys
  for select
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = byok_provider_keys.team_id and tm.user_id = auth.uid()
    )
  );

create policy "byok_provider_keys_insert" on byok_provider_keys
  for insert
  with check (
    exists (
      select 1 from team_members tm
      where tm.team_id = byok_provider_keys.team_id and tm.user_id = auth.uid()
        and tm.role in ('owner','admin')
    )
  );

create policy "byok_provider_keys_update" on byok_provider_keys
  for update
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = byok_provider_keys.team_id and tm.user_id = auth.uid()
        and tm.role in ('owner','admin')
    )
  )
  with check (
    exists (
      select 1 from team_members tm
      where tm.team_id = byok_provider_keys.team_id and tm.user_id = auth.uid()
        and tm.role in ('owner','admin')
    )
  );

create policy "byok_provider_keys_delete" on byok_provider_keys
  for delete
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = byok_provider_keys.team_id and tm.user_id = auth.uid()
        and tm.role in ('owner','admin')
    )
  );

create policy "byok_spend_limits_select" on byok_spend_limits
  for select
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = byok_spend_limits.team_id and tm.user_id = auth.uid()
    )
  );

create policy "byok_spend_limits_insert" on byok_spend_limits
  for insert
  with check (
    exists (
      select 1 from team_members tm
      where tm.team_id = byok_spend_limits.team_id and tm.user_id = auth.uid()
        and tm.role in ('owner','admin')
    )
  );

create policy "byok_spend_limits_update" on byok_spend_limits
  for update
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = byok_spend_limits.team_id and tm.user_id = auth.uid()
        and tm.role in ('owner','admin')
    )
  )
  with check (
    exists (
      select 1 from team_members tm
      where tm.team_id = byok_spend_limits.team_id and tm.user_id = auth.uid()
        and tm.role in ('owner','admin')
    )
  );

create policy "byok_spend_limits_delete" on byok_spend_limits
  for delete
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = byok_spend_limits.team_id and tm.user_id = auth.uid()
        and tm.role in ('owner','admin')
    )
  );

create policy "byok_spend_ledger_select" on byok_spend_ledger
  for select
  using (
    exists (
      select 1 from team_members tm
      where tm.team_id = byok_spend_ledger.team_id and tm.user_id = auth.uid()
    )
  );

insert into billing_plans (id, name, price_cents, interval, mode, included_credits_cents, premium_access)
values
  ('byo', 'Bring Your Own Keys', 2900, 'one_time', 'byo', 0, true),
  ('lite', 'Hosted Lite', 99, 'month', 'hosted_lite', 0, false),
  ('starter', 'Starter', 900, 'month', 'hosted_plan', 800, false),
  ('pro', 'Pro', 2900, 'month', 'hosted_plan', 2800, true),
  ('studio', 'Studio', 7900, 'month', 'hosted_plan', 8000, true),
  ('credits-1000', 'Credit Pack 1000', 1000, 'one_time', 'credit_pack', 1000, false),
  ('credits-2500', 'Credit Pack 2500', 2500, 'one_time', 'credit_pack', 2500, false),
  ('credits-5000', 'Credit Pack 5000', 5000, 'one_time', 'credit_pack', 5000, false),
  ('credits-10000', 'Credit Pack 10000', 10000, 'one_time', 'credit_pack', 10000, false)
on conflict (id) do nothing;

alter table team_billing
  add column if not exists auto_topup_enabled boolean default false;
alter table team_billing
  add column if not exists auto_topup_threshold_cents integer default 1000;
alter table team_billing
  add column if not exists auto_topup_pack_id text default 'credits-1000';
alter table team_billing
  add column if not exists trial_started_at timestamp with time zone;
alter table team_billing
  add column if not exists trial_ends_at timestamp with time zone;
alter table team_billing
  add column if not exists trial_active boolean default false;
alter table team_billing
  add column if not exists status text;
alter table team_billing
  add column if not exists last_usage_at timestamp with time zone;
