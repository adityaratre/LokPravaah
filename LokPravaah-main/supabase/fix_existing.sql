-- JANWATCH existing-project compatibility patch (idempotent).
-- Apply this in Supabase SQL Editor after the base schema is already installed.
-- Do NOT paste service-role keys into the frontend .env file.

-- Ensure the admin predicate exists before it is referenced by policies.
create or replace function public.is_janwatch_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role in ('admin', 'super_admin')
  );
$$;

-- 1) Restore profile rows for auth users that existed before the profile trigger.
insert into public.profiles (id, display_name, avatar_url)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
  u.raw_user_meta_data->>'avatar_url'
from auth.users u
on conflict (id) do update
set display_name = coalesce(public.profiles.display_name, excluded.display_name),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url);

-- 2) Ensure the profile trigger is in place for future Google sign-ins.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_janwatch on auth.users;
create trigger on_auth_user_created_janwatch
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- 3) Keep least-privilege report access. Public reports are readable; users can
-- also read their own non-public rows. Only admins can change status/other fields.
drop policy if exists "reports read public or own" on public.reports;
create policy "reports read public or own"
on public.reports for select to anon, authenticated
using (visibility = 'public' or reporter_id = auth.uid() or public.is_janwatch_admin());

drop policy if exists "reports insert own" on public.reports;
create policy "reports insert own"
on public.reports for insert to authenticated
with check (reporter_id = auth.uid());

drop policy if exists "reports update admin only" on public.reports;
create policy "reports update admin only"
on public.reports for update to authenticated
using (public.is_janwatch_admin())
with check (public.is_janwatch_admin());

-- 4) Make sure vote policies enforce one support vote per user/report.
-- The primary key on (report_id, user_id) remains the duplicate-vote guard.
drop policy if exists "votes insert own" on public.report_votes;
create policy "votes insert own"
on public.report_votes for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.reports r
    where r.id = report_id and r.visibility = 'public'
  )
);

-- 5) Keep evidence private and allow access only to the owner folder or admins.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('citizen-evidence', 'citizen-evidence', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'])
on conflict (id) do update
set public = false,
    file_size_limit = 52428800,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'];

drop policy if exists "evidence upload own folder" on storage.objects;
create policy "evidence upload own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'citizen-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "evidence read own or admin" on storage.objects;
create policy "evidence read own or admin"
on storage.objects for select to authenticated
using (
  bucket_id = 'citizen-evidence'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_janwatch_admin())
);

drop policy if exists "evidence delete own or admin" on storage.objects;
create policy "evidence delete own or admin"
on storage.objects for delete to authenticated
using (
  bucket_id = 'citizen-evidence'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_janwatch_admin())
);

-- 6) Audit status changes made through the admin console.
create or replace function public.janwatch_log_report_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    new.updated_at := now();
    insert into public.report_events (report_id, actor_id, event_type, note)
    values (
      new.id,
      auth.uid(),
      'status_changed',
      'Status changed from ' || old.status::text || ' to ' || new.status::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists janwatch_report_status_audit on public.reports;
create trigger janwatch_report_status_audit
before update of status on public.reports
for each row execute procedure public.janwatch_log_report_status_change();
