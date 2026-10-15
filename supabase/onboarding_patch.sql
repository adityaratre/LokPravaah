-- JANWATCH profile onboarding migration
-- Safe to re-run on the existing project; run in Supabase SQL Editor as project owner.

alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists city text;
alter table public.profiles add column if not exists ward text;
alter table public.profiles add column if not exists account_type text not null default 'citizen';
alter table public.profiles add column if not exists preferred_service text;

-- Keep account types as user profile labels only. This does NOT grant admin privileges.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_account_type_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles add constraint profiles_account_type_check
      check (account_type in ('citizen','volunteer','organisation'));
  end if;
end $$;

-- Supabase's auth-user trigger normally creates a profile, but this policy also permits
-- an authenticated user to create their own row if that trigger was missing for older users.
drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own"
  on public.profiles for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Refresh schema metadata for PostgREST when available.
notify pgrst, 'reload schema';
