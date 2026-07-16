-- ============================================================================
-- KonX backend schema (Supabase / Postgres)
-- Creates the tables, security rules, and helper functions the app needs.
-- Applied with `supabase db push` (or pasted into the Supabase SQL editor).
-- ============================================================================

-- 1) PROFILES: one row per user. Holds the "Personalize" data + the current plan.
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text,
  preferred_name text,
  role           text,
  style          text,
  goals          text,
  notes          text,
  plan           text not null default 'free',
  created_at     timestamptz not null default now()
);

-- 2) USAGE_DAILY: one counter per user per day, to enforce free-vs-paid limits.
create table if not exists public.usage_daily (
  user_id uuid    not null references auth.users(id) on delete cascade,
  day     date    not null default current_date,
  count   integer not null default 0,
  primary key (user_id, day)
);

-- 3) SUBSCRIPTIONS: filled in by the Paystack/Flutterwave webhook (added later).
create table if not exists public.subscriptions (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  plan               text not null default 'free',
  status             text not null default 'inactive',
  provider           text,           -- 'paystack' | 'flutterwave'
  provider_ref       text,           -- the provider's subscription/customer id
  current_period_end timestamptz,
  updated_at         timestamptz not null default now()
);

-- 4) HISTORY + SAVED: optional cloud sync so they follow the user across PCs.
create table if not exists public.history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  instruction text,
  source      text,
  result      text,
  model       text,
  engine      text
);
create table if not exists public.saved (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  instruction text,
  source      text,
  result      text,
  model       text,
  engine      text
);

-- ============================================================================
-- ROW LEVEL SECURITY — each user can only ever touch THEIR OWN rows.
-- (The AI proxy uses the service-role key, which bypasses RLS for metering.)
-- ============================================================================
alter table public.profiles      enable row level security;
alter table public.usage_daily   enable row level security;
alter table public.subscriptions enable row level security;
alter table public.history       enable row level security;
alter table public.saved         enable row level security;

drop policy if exists "own profile select" on public.profiles;
drop policy if exists "own profile update" on public.profiles;
create policy "own profile select" on public.profiles for select using (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own usage select" on public.usage_daily;
create policy "own usage select" on public.usage_daily for select using (auth.uid() = user_id);

drop policy if exists "own subscription select" on public.subscriptions;
create policy "own subscription select" on public.subscriptions for select using (auth.uid() = user_id);

drop policy if exists "own history all" on public.history;
create policy "own history all" on public.history for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own saved all" on public.saved;
create policy "own saved all" on public.saved for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- NEW-USER TRIGGER — auto-create a profile + subscription row on sign-up.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
    on conflict (id) do nothing;
  insert into public.subscriptions (user_id, plan, status) values (new.id, 'free', 'inactive')
    on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- ATOMIC USAGE INCREMENT — called by the AI Edge Function after a successful
-- rewrite. Returns the new count for today.
-- ============================================================================
create or replace function public.increment_usage(p_user uuid)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  new_count integer;
begin
  insert into public.usage_daily (user_id, day, count)
  values (p_user, current_date, 1)
  on conflict (user_id, day)
  do update set count = public.usage_daily.count + 1
  returning count into new_count;
  return new_count;
end;
$$;
